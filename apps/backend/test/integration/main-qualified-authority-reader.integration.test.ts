import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { DataSource, type EntityManager } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import { AuthService, type AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { AuthorizationHistoryCutover1793059200000 } from '../../src/database/migrations/1793059200000-AuthorizationHistoryCutover.js';
import { hasMainAuthorityCapture } from '../../src/common/configuration/main-authority-capture-preflight.js';
import { readMainAuthoritySnapshot } from '../../src/modules/zones/main-authority-read-snapshot.js';
import { executeMainConfigurationCommand } from '../../src/common/configuration/main-configuration-authority.js';
import { MAIN_AUTHORITY_V2_SOURCES } from '../../src/common/configuration/main-team-authority-sources.js';
import { MainAuthorityBaselineService } from '../../src/modules/zones/main-authority-baseline.service.js';
import { MainAuthorityCutoverService } from '../../src/modules/zones/main-authority-cutover.service.js';
import {
  MAIN_AUTHORITY_CUTOVER_RELEASE_FILES,
  MAIN_AUTHORITY_CUTOVER_RUNTIME_FILES,
  type MainAuthorityCutoverReleaseConfig,
} from '../../src/modules/zones/main-authority-cutover-release.js';
import type { MainCapturedStateInput } from '../../src/modules/zones/main-authority-captured-state.reader.js';
import {
  MainQualifiedAuthorityReader,
  type MainQualifiedAuthorityPrepared,
} from '../../src/modules/zones/main-qualified-authority.reader.js';

const owned = createIsolatedTestDatabase(),
  db = owned.dataSource,
  schema = (db.options as { schema: string }).schema;
const sha256 = (body: Buffer | string) => createHash('sha256').update(body).digest('hex');
const quote = (id: string) => '"' + id.replaceAll('"', '""') + '"';

let guard: UserAuthGuard,
  request: AuthenticatedRequest,
  config: MainAuthorityCutoverReleaseConfig,
  cutover: MainAuthorityCutoverService,
  reader: MainQualifiedAuthorityReader,
  fixturePath: string,
  actor: string,
  subject: string,
  siteId: string,
  zoneId: string,
  manifest: Record<string, unknown> & {
    runtimeFiles: Array<{ path: string; sha256: string }>;
    writerReview: Record<string, unknown>;
  };

async function pgNowUtc(offsetSql = ''): Promise<string> {
  const [{ now }] = await db.query(
    `SELECT to_char((clock_timestamp()${offsetSql}) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`,
  );
  return now;
}

function makeInput(
  epochId: string,
  capturedAt: string,
  overrides: Partial<MainCapturedStateInput> = {},
): MainCapturedStateInput {
  return {
    epochId,
    siteId,
    zoneId,
    workerId: null,
    capturedAt,
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    ...overrides,
  };
}

/** Simulates the future WorkPort writable SERIALIZABLE TX with early 18-table SHARE locks and schema-only path. */
async function withWritableSnapshotFence<T>(
  operation: (manager: EntityManager) => Promise<T>,
  tables: readonly string[] = MAIN_AUTHORITY_V2_SOURCES.map(([, table]) => table),
): Promise<T> {
  return db.transaction('SERIALIZABLE', async (manager) => {
    await manager.query("SET LOCAL lock_timeout='1500ms'");
    await manager.query("SET LOCAL statement_timeout='5s'");
    if (tables.length) {
      await manager.query(
        `LOCK TABLE ${tables.map((table) => `${quote(schema)}.${quote(table)}`).join(',')} IN SHARE MODE`,
      );
    }
    const [temporary] = await manager.query('SELECT pg_catalog.pg_my_temp_schema()<>0 AS present');
    if (temporary?.present !== false) throw new Error('Temporary authority namespace unavailable');
    await manager.query("SELECT set_config('search_path',quote_ident($1),true)", [schema]);
    const [selected] = await manager.query('SELECT current_schema()=$1::text AS valid', [schema]);
    if (selected?.valid !== true) throw new Error('Selected authority schema unavailable');
    return operation(manager);
  });
}

async function mutateHistoryWithRestoredGuards(
  manager: EntityManager,
  mutate: () => Promise<void>,
): Promise<void> {
  const triggers: Array<{ relname: string; tgname: string; tgenabled: string }> =
    await manager.query(
      `SELECT c.relname,t.tgname,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
       WHERE c.relnamespace=current_schema()::regnamespace
         AND c.relname IN ('authorization_history_revision','authorization_history_commit_receipt')
         AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')`,
    );
  for (const t of triggers) {
    await manager.query(`ALTER TABLE ${quote(t.relname)} DISABLE TRIGGER ${quote(t.tgname)}`);
  }
  try {
    await mutate();
  } finally {
    for (const t of triggers) {
      const mode = t.tgenabled === 'A' ? 'ENABLE ALWAYS TRIGGER' : 'ENABLE TRIGGER';
      await manager.query(`ALTER TABLE ${quote(t.relname)} ${mode} ${quote(t.tgname)}`);
    }
  }
  assert.equal(await hasMainAuthorityCapture(manager), true);
}

before(async () => {
  console.log(`ownedQualifiedAuthorityReaderSchema=${schema}`);
  await owned.initialize();
  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    await new AuthorizationHistoryCutover1793059200000().up(runner);
    await runner.commitTransaction();
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
  actor = randomUUID();
  subject = randomUUID();
  siteId = randomUUID();
  zoneId = randomUUID();
  const password = 'Synthetic-Qualified-Reader-123!';
  await db.query(
    "INSERT INTO site(id,code,name) VALUES($1,'SYNTHETIC-READER-SITE','Synthetic Reader Site')",
    [siteId],
  );
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy,required_ppe) VALUES($1,$2,$1::uuid::text,'Synthetic Reader Zone','RESTRICTED','AUTHORIZATION_REQUIRED','{}')",
    [zoneId, siteId],
  );
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic Admin',$2,false)",
    [actor, await hashPassword(password)],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL),($3,$2,'SAFETY_OFFICER',$4)",
    [randomUUID(), actor, randomUUID(), siteId],
  );
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic history subject','synthetic-unusable-hash',false)",
    [subject],
  );
  const auth = new AuthService(db, new AuthTokenService(new JwtService(), createTestConfig()));
  guard = new UserAuthGuard(auth);
  const login = await auth.login(actor, password, AuthClientType.WEB);
  request = { headers: { authorization: `Bearer ${login.accessToken}` } };
  await guard.authenticateRequest(request);

  fixturePath = await mkdtemp('D:/Ky9-FPT/SmartSiteData/runs/qualified-reader-synthetic-');
  const sourceRoot = process.env.CUTOVER_TEST_SOURCE_ROOT;
  assert(sourceRoot, 'Explicit current source root is required');
  const files = [];
  for (const path of MAIN_AUTHORITY_CUTOVER_RELEASE_FILES) {
    const target = resolve(fixturePath, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(sourceRoot, path), target);
    files.push({ path, sha256: sha256(await readFile(target)) });
  }
  const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
  const runtimeFiles = [];
  for (const path of MAIN_AUTHORITY_CUTOVER_RUNTIME_FILES) {
    runtimeFiles.push({ path, sha256: sha256(await readFile(resolve(runtimeRoot, path))) });
  }
  const [registry] = await db.query(
    `SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(s) ORDER BY s.source_kind COLLATE "C")::text,'UTF8')),'hex') AS hash FROM authorization_history_source s`,
  );
  manifest = {
    version: 'MF06_REVIEWED_CUTOVER_RELEASE_V1',
    releaseCommit: 'a'.repeat(40),
    captureProfile: 'NAMED_V2_CONTROLLED_CUTOVER_V1',
    provenance: 'SYNTHETIC_TEST',
    sourceRegistryHash: registry.hash,
    files,
    runtimeFiles,
    writerReview: {
      protocol: 'PINNED_AUTHORITY_SOURCE_REVIEW_RECONCILIATION_V1',
      sourceIndexSha256: 'b'.repeat(64),
      methods: 1,
      files: 1,
      exactQuotesAndSourcePinsVerified: true,
      missingOrDuplicateMethods: false,
      completeWriterClosureEstablished: true,
      rows: [
        {
          file: 'modules/auth/auth.service.ts',
          method: 'syntheticFixtureOnly',
          fileSha256: files.find((file) => file.path.endsWith('/auth.service.ts'))!.sha256,
          methodBodySha256: 'c'.repeat(64),
          classification: 'MASKED_COMMAND',
        },
      ],
    },
  };
  const manifestPath = join(fixturePath, 'SYNTHETIC-NOT-OPERATIONAL-manifest.json');
  const bytes = JSON.stringify(manifest);
  await writeFile(manifestPath, bytes, { flag: 'wx' });
  config = {
    manifestPath,
    reviewedManifestSha256: sha256(bytes),
    releaseRoot: fixturePath,
    releaseCommit: 'a'.repeat(40),
  };
  cutover = new MainAuthorityCutoverService(db, guard, config, createTestConfig());
  reader = new MainQualifiedAuthorityReader(db, config, createTestConfig());
});

after(() => owned.dispose());

test('Synthetic valid prepared proof qualifies READY epoch with explicit non-operational provenance and revalidates in writable fenced TX', async () => {
  const activated = await cutover.activate(request, null);
  assert.equal(activated.commitStatus, 'COMMITTED');
  assert.equal(activated.witnessConfirmed, true);
  const input = makeInput(activated.epochId, await pgNowUtc());

  const prepared = await reader.prepare(input);
  assert.equal(prepared.status, 'QUALIFIED');
  assert.equal(prepared.epochId, activated.epochId);
  assert.equal(prepared.epochState, 'READY');
  assert.equal(prepared.provenance, 'SYNTHETIC_TEST');
  assert.equal(prepared.operationalAuthorityCoverageEstablished, false);
  assert.equal(prepared.syntheticCutoverMechanicsVerified, true);
  assert.equal(prepared.identityEstablished, false);
  assert.equal(prepared.manifestSha256, config.reviewedManifestSha256);

  const revalidated = await withWritableSnapshotFence((manager) =>
    reader.revalidate(manager, input, prepared),
  );
  assert.equal(revalidated, prepared);
});

test('Forged copied prepared object and archive Site/Zone/capturedAt/epochId binding drift are rejected', async () => {
  const [{ epoch_id: epochId }] = await db.query(
    'SELECT epoch_id FROM authorization_history_control',
  );
  const capturedAt = await pgNowUtc();
  const input = makeInput(epochId, capturedAt);
  const prepared = await reader.prepare(input);
  assert.equal(prepared.status, 'QUALIFIED');

  const copied: MainQualifiedAuthorityPrepared = { ...prepared };
  const cloned = structuredClone(prepared);
  assert.deepEqual(await withWritableSnapshotFence((m) => reader.revalidate(m, input, copied)), {
    status: 'UNAVAILABLE',
    reason: 'UNTRUSTED_PREPARED_ARCHIVE',
  });
  assert.deepEqual(await withWritableSnapshotFence((m) => reader.revalidate(m, input, cloned)), {
    status: 'UNAVAILABLE',
    reason: 'UNTRUSTED_PREPARED_ARCHIVE',
  });
  assert.deepEqual(
    await withWritableSnapshotFence((m) =>
      reader.revalidate(m, makeInput(randomUUID(), capturedAt), prepared),
    ),
    { status: 'UNAVAILABLE', reason: 'BINDING_MISMATCH' },
  );
  assert.deepEqual(
    await withWritableSnapshotFence((m) =>
      reader.revalidate(m, makeInput(epochId, capturedAt, { siteId: randomUUID() }), prepared),
    ),
    { status: 'UNAVAILABLE', reason: 'BINDING_MISMATCH' },
  );
  assert.deepEqual(
    await withWritableSnapshotFence((m) =>
      reader.revalidate(m, makeInput(epochId, capturedAt, { zoneId: randomUUID() }), prepared),
    ),
    { status: 'UNAVAILABLE', reason: 'BINDING_MISMATCH' },
  );
  assert.deepEqual(
    await withWritableSnapshotFence((m) =>
      reader.revalidate(m, makeInput(epochId, prepared.activatedAt), prepared),
    ),
    { status: 'UNAVAILABLE', reason: 'BINDING_MISMATCH' },
  );
});

test('Missing early SHARE locks or missing transaction in writable revalidate is rejected', async () => {
  const [{ epoch_id: epochId }] = await db.query(
    'SELECT epoch_id FROM authorization_history_control',
  );
  const input = makeInput(epochId, await pgNowUtc());
  const prepared = await reader.prepare(input);
  assert.equal(prepared.status, 'QUALIFIED');

  assert.deepEqual(await reader.revalidate(db.manager, input, prepared), {
    status: 'UNAVAILABLE',
    reason: 'TRANSACTION_REQUIRED',
  });
  assert.deepEqual(
    await readMainAuthoritySnapshot(db, (manager) => reader.revalidate(manager, input, prepared)),
    { status: 'UNAVAILABLE', reason: 'WRITABLE_TRANSACTION_REQUIRED' },
  );
  assert.deepEqual(
    await withWritableSnapshotFence((m) => reader.revalidate(m, input, prepared), []),
    { status: 'UNAVAILABLE', reason: 'SNAPSHOT_FENCE_REQUIRED' },
  );
  const seventeenTables = MAIN_AUTHORITY_V2_SOURCES.slice(0, 17).map(([, table]) => table);
  assert.deepEqual(
    await withWritableSnapshotFence((m) => reader.revalidate(m, input, prepared), seventeenTables),
    { status: 'UNAVAILABLE', reason: 'SNAPSHOT_FENCE_REQUIRED' },
  );
});

test('Future T, pre-baseline T, pre-activation T (baseline_at < T < activated_at), and STAGING->CLOSED epoch with baseline are rejected', async () => {
  const stagingSaved = await new MainAuthorityBaselineService(db).capture(
    { actorUserId: actor, reauthorize: async () => {} },
    config.reviewedManifestSha256,
  );
  await db.query("UPDATE authorization_history_epoch SET state='CLOSED' WHERE epoch_id=$1", [
    stagingSaved.epochId,
  ]);
  assert.deepEqual(await reader.prepare(makeInput(stagingSaved.epochId, await pgNowUtc())), {
    status: 'UNAVAILABLE',
    reason: 'EPOCH_WINDOW_UNQUALIFIED',
  });

  const [{ epoch_id: priorEpoch }] = await db.query(
    'SELECT epoch_id FROM authorization_history_control',
  );
  const nextEpoch = randomUUID();
  await executeMainConfigurationCommand(
    db,
    { actorUserId: actor, reauthorize: async () => {} },
    'MAIN_AUTHORITY_BASELINE',
    { epochId: nextEpoch, declaredWriterManifestHash: config.reviewedManifestSha256 },
    async (manager) => {
      await manager.query(
        'INSERT INTO authorization_history_epoch(epoch_id,writer_manifest_hash) VALUES($1,$2)',
        [nextEpoch, config.reviewedManifestSha256],
      );
      await manager.query(
        "INSERT INTO authorization_history_baseline(epoch_id,command_id) VALUES($1,current_setting('smartsite.mf06_command_id')::uuid)",
        [nextEpoch],
      );
      await manager.query('SELECT pg_sleep(0.02)');
      await manager.query(
        'UPDATE authorization_history_control SET epoch_id=$1 WHERE singleton=1 AND epoch_id=$2',
        [nextEpoch, priorEpoch],
      );
    },
  );
  const [times] = await db.query(
    `SELECT b.command_id,
      to_char((b.captured_at - interval '1 millisecond') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS pre_baseline_t,
      to_char((b.captured_at + ((e.activated_at - b.captured_at) / 2)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS pre_activation_t
     FROM authorization_history_epoch e JOIN authorization_history_baseline b USING(epoch_id) WHERE e.epoch_id=$1`,
    [nextEpoch],
  );
  assert.deepEqual(
    await reader.prepare(makeInput(nextEpoch, await pgNowUtc(" + interval '1 hour'"))),
    {
      status: 'UNAVAILABLE',
      reason: 'OBSERVATION_AFTER_TRANSACTION_START',
    },
  );
  assert.deepEqual(await reader.prepare(makeInput(nextEpoch, times.pre_baseline_t)), {
    status: 'UNAVAILABLE',
    reason: 'PRE_BASELINE',
  });
  assert.deepEqual(await reader.prepare(makeInput(nextEpoch, times.pre_activation_t)), {
    status: 'UNAVAILABLE',
    reason: 'COMMIT_TIME_UNCERTAIN',
  });

  await assert.rejects(
    withWritableSnapshotFence(async (manager) => {
      await mutateHistoryWithRestoredGuards(manager, async () => {
        await manager.query(
          'UPDATE authorization_history_commit_receipt SET confirmed_at=$2::timestamptz WHERE command_id=$1',
          [times.command_id, times.pre_activation_t],
        );
      });
      const qualify = await (
        reader as unknown as {
          qualifyEpoch: (
            m: EntityManager,
            e: string,
            t: string,
          ) => Promise<{ status: string; reason: string }>;
        }
      ).qualifyEpoch(manager, nextEpoch, times.pre_activation_t);
      assert.deepEqual(qualify, { status: 'UNAVAILABLE', reason: 'EPOCH_WINDOW_UNQUALIFIED' });
      throw new Error('ROLLBACK_TEST_MUTATION');
    }),
    /ROLLBACK_TEST_MUTATION/,
  );
});

test('State, revision, and witness drift are rejected by revalidate with restored guards', async () => {
  const [{ epoch_id: currentEpoch }] = await db.query(
    'SELECT epoch_id FROM authorization_history_control',
  );
  const delayedReceipts: Array<{ sql: string; args: unknown[] }> = [];
  const originalQuery = db.query.bind(db);
  db.query = async (sql: string, ...args: unknown[]) => {
    if (sql.startsWith('INSERT INTO authorization_history_commit_receipt')) {
      delayedReceipts.push({ sql, args });
      throw new Error('Synthetic delayed receipt');
    }
    return originalQuery(sql, ...(args as []));
  };
  try {
    await executeMainConfigurationCommand(
      db,
      { actorUserId: actor, reauthorize: async () => {} },
      'USER_ACCOUNT_STATUS',
      { targetUserId: subject, isActive: false },
      async (manager) => {
        await manager.query('UPDATE app_user SET is_active=false WHERE id=$1', [subject]);
      },
    );
  } finally {
    db.query = originalQuery;
  }
  const delayedReceiptSql = delayedReceipts[0];
  assert(delayedReceiptSql, 'Expected postcommit receipt SQL to be captured');
  assert.deepEqual(await reader.prepare(makeInput(currentEpoch, await pgNowUtc())), {
    status: 'UNAVAILABLE',
    reason: 'COMMIT_TIME_UNCERTAIN',
  });
  await db.query(delayedReceiptSql.sql, ...(delayedReceiptSql.args as []));

  const input = makeInput(currentEpoch, await pgNowUtc());
  const prepared = await reader.prepare(input);
  assert.equal(prepared.status, 'QUALIFIED');

  await assert.rejects(
    withWritableSnapshotFence(async (manager) => {
      await mutateHistoryWithRestoredGuards(manager, async () => {
        await manager.query(
          "UPDATE authorization_history_revision SET after_hash=repeat('0',64) WHERE source_id=$1::uuid",
          [subject],
        );
      });
      assert.deepEqual(await reader.revalidate(manager, input, prepared), {
        status: 'UNAVAILABLE',
        reason: 'CUTOVER_STATE_DRIFT',
      });
      throw new Error('ROLLBACK_REVISION_DRIFT');
    }),
    /ROLLBACK_REVISION_DRIFT/,
  );

  await assert.rejects(
    withWritableSnapshotFence(async (manager) => {
      await mutateHistoryWithRestoredGuards(manager, async () => {
        await manager.query(
          "UPDATE authorization_history_commit_receipt SET confirmed_at=confirmed_at - interval '1 microsecond' WHERE command_id=(SELECT command_id FROM authorization_history_baseline WHERE epoch_id=$1)",
          [currentEpoch],
        );
      });
      assert.deepEqual(await reader.revalidate(manager, input, prepared), {
        status: 'UNAVAILABLE',
        reason: 'CUTOVER_STATE_DRIFT',
      });
      throw new Error('ROLLBACK_WITNESS_DRIFT');
    }),
    /ROLLBACK_WITNESS_DRIFT/,
  );

  const nextActivation = await cutover.activate(request, currentEpoch);
  assert.equal(nextActivation.commitStatus, 'COMMITTED');
  assert.deepEqual(await withWritableSnapshotFence((m) => reader.revalidate(m, input, prepared)), {
    status: 'UNAVAILABLE',
    reason: 'CUTOVER_STATE_DRIFT',
  });
  const closedHistorical = await reader.prepare(input);
  assert.equal(closedHistorical.status, 'QUALIFIED');
  assert.equal(closedHistorical.epochState, 'CLOSED');
  assert.notEqual(closedHistorical.closedAt, null);
});

test('Actual uncommitted in-flight unmasked source writer blocks prepare on pg_locks ShareLock and rejects with HISTORY_GAP', async () => {
  const [{ epoch_id: currentEpoch }] = await db.query(
    'SELECT epoch_id FROM authorization_history_control',
  );
  const writerRunner = db.createQueryRunner(),
    observer = db.createQueryRunner();
  try {
    await writerRunner.startTransaction();
    await writerRunner.query('UPDATE app_user SET is_active=true WHERE id=$1', [subject]);
    const inflightT = await pgNowUtc();
    const pendingPrepare = reader.prepare(makeInput(currentEpoch, inflightT));
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const [state] = await observer.query(
        `SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
          JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT l.granted AND l.mode='ShareLock'
          AND n.nspname=$1 AND c.relname='app_user') AS waiting`,
        [schema],
      );
      if ((waiting = state.waiting)) break;
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 5));
    }
    assert.equal(waiting, true);
    await writerRunner.commitTransaction();
    assert.deepEqual(await pendingPrepare, { status: 'UNAVAILABLE', reason: 'HISTORY_GAP' });
  } finally {
    if (writerRunner.isTransactionActive) await writerRunner.rollbackTransaction();
    await writerRunner.release();
    await observer.release();
  }
});

test('Synthetic release is refused outside test environment and unclosed operational review is refused', async () => {
  const replacement = await cutover.activate(
    request,
    (await db.query('SELECT epoch_id FROM authorization_history_control'))[0].epoch_id,
  );
  const input = makeInput(replacement.epochId, await pgNowUtc());
  const prepared = await reader.prepare(input);
  assert.equal(prepared.status, 'QUALIFIED');

  const prodEnv = createTestConfig();
  prodEnv.set('NODE_ENV', 'production');
  const prodReader = new MainQualifiedAuthorityReader(db, config, prodEnv);
  assert.deepEqual(await prodReader.prepare(input), {
    status: 'UNAVAILABLE',
    reason: 'RELEASE_UNAVAILABLE',
  });

  const unclosedBytes = JSON.stringify({
    ...manifest,
    provenance: 'OPERATIONAL_REVIEWED',
    writerReview: { ...manifest.writerReview, completeWriterClosureEstablished: false },
  });
  const unclosedPath = join(fixturePath, 'unclosed-operational-manifest.json');
  await writeFile(unclosedPath, unclosedBytes, { flag: 'wx' });
  const unclosedReader = new MainQualifiedAuthorityReader(
    db,
    { ...config, manifestPath: unclosedPath, reviewedManifestSha256: sha256(unclosedBytes) },
    createTestConfig(),
  );
  assert.deepEqual(await unclosedReader.prepare(input), {
    status: 'UNAVAILABLE',
    reason: 'RELEASE_UNAVAILABLE',
  });
});

test('writable final validation refuses an oversized retrospective fact window', async () => {
  const [{ epoch_id: epochId }] = await db.query(
    'SELECT epoch_id FROM authorization_history_control',
  );
  const input = makeInput(epochId, await pgNowUtc());
  const prepared = await reader.prepare(input);
  assert.equal(prepared.status, 'QUALIFIED');
  await assert.rejects(
    withWritableSnapshotFence(async (manager) => {
      // Privileged corruption fixture only: restored guards must still reject the oversized window.
      await mutateHistoryWithRestoredGuards(manager, async () => {
        await manager.query(
          `INSERT INTO authorization_history_revision
        (source_kind,source_id,revision,epoch_id,command_id,transaction_id,operation,
          before_payload,after_payload,before_hash,after_hash,observed_at)
        SELECT 'USER_ACCOUNT',gen_random_uuid(),1,$1,b.command_id,pg_current_xact_id(),'INSERT',
          NULL,'{}'::jsonb,NULL,encode(sha256(convert_to('{}','UTF8')),'hex'),$2::timestamptz
        FROM authorization_history_baseline b CROSS JOIN generate_series(1,2049) WHERE b.epoch_id=$1`,
          [epochId, input.capturedAt],
        );
      });
      assert.deepEqual(await reader.revalidate(manager, input, prepared), {
        status: 'UNAVAILABLE',
        reason: 'RESOURCE_LIMIT',
      });
      throw new Error('ROLLBACK_RESOURCE_FIXTURE');
    }),
    /ROLLBACK_RESOURCE_FIXTURE/,
  );
});

test('first manual gap marker excludes later T even after a later gap row and CLOSED retirement', async () => {
  const [{ epoch_id: epochId }] = await db.query(
    'SELECT epoch_id FROM authorization_history_control',
  );
  const beforeGap = makeInput(epochId, await pgNowUtc());
  const original = await reader.prepare(beforeGap);
  assert.equal(original.status, 'QUALIFIED');
  await db.query("UPDATE authorization_history_epoch SET state='GAPPED' WHERE epoch_id=$1", [
    epochId,
  ]);
  const [{ at: exactGap }] = await db.query(
    `SELECT to_char(gapped_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
     FROM authorization_history_epoch WHERE epoch_id=$1`,
    [epochId],
  );
  assert.deepEqual(await reader.prepare(makeInput(epochId, exactGap)), {
    status: 'UNAVAILABLE',
    reason: 'HISTORY_GAP',
  });
  const afterGap = makeInput(epochId, await pgNowUtc());
  await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [subject]);
  assert.deepEqual(await reader.prepare(afterGap), {
    status: 'UNAVAILABLE',
    reason: 'HISTORY_GAP',
  });
  const historical = await reader.prepare(beforeGap);
  assert.equal(historical.status, 'QUALIFIED');
  assert.equal(historical.epochState, 'GAPPED');
  assert.notEqual(historical.gappedAt, null);
  assert.equal(historical.operationalAuthorityCoverageEstablished, false);
  assert.deepEqual(
    await withWritableSnapshotFence((m) => reader.revalidate(m, beforeGap, original)),
    {
      status: 'UNAVAILABLE',
      reason: 'CUTOVER_STATE_DRIFT',
    },
  );
  assert.equal(
    await withWritableSnapshotFence((m) => reader.revalidate(m, beforeGap, historical)),
    historical,
  );
  await cutover.activate(request, epochId);
  assert.deepEqual(await reader.prepare(afterGap), {
    status: 'UNAVAILABLE',
    reason: 'HISTORY_GAP',
  });
  const closed = await reader.prepare(beforeGap);
  assert.equal(closed.status, 'QUALIFIED');
  assert.equal(closed.epochState, 'CLOSED');
  assert.equal(closed.gappedAt, historical.gappedAt);
  assert.equal(
    await withWritableSnapshotFence((m) => reader.revalidate(m, beforeGap, closed)),
    closed,
  );
});

test('pooled temporary namespace produces an explicit unavailable preparation', async () => {
  const [{ epoch_id: epochId }] = await db.query(
    'SELECT epoch_id FROM authorization_history_control',
  );
  const input = makeInput(epochId, await pgNowUtc());
  const pooled = new DataSource({ ...db.options, extra: { ...db.options.extra, max: 1 } });
  await pooled.initialize();
  try {
    await pooled.query('CREATE TEMP TABLE site(id uuid)');
    const isolatedReader = new MainQualifiedAuthorityReader(pooled, config, createTestConfig());
    assert.deepEqual(await isolatedReader.prepare(input), {
      status: 'UNAVAILABLE',
      reason: 'SNAPSHOT_FENCE_REQUIRED',
    });
  } finally {
    await pooled.destroy();
  }
});
