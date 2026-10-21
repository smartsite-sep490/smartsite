import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { DataSource, type EntityManager } from 'typeorm';
import { createQualifiedAuthorityFixture } from '../support/qualified-authority-fixture.js';
import { createTestConfig } from '../support/config.js';
import type { AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { hasMainAuthorityCapture } from '../../src/common/configuration/main-authority-capture-preflight.js';
import {
  MAIN_AUTHORITY_SNAPSHOT_TABLES,
  readMainAuthoritySnapshot,
} from '../../src/modules/zones/main-authority-read-snapshot.js';
import { executeMainConfigurationCommand } from '../../src/common/configuration/main-configuration-authority.js';
import { MAIN_AUTHORITY_V2_SOURCES } from '../../src/common/configuration/main-team-authority-sources.js';
import { MainAuthorityBaselineService } from '../../src/modules/zones/main-authority-baseline.service.js';
import { MainAuthorityCutoverService } from '../../src/modules/zones/main-authority-cutover.service.js';
import { type MainAuthorityCutoverReleaseConfig } from '../../src/modules/zones/main-authority-cutover-release.js';
import type { MainCapturedStateInput } from '../../src/modules/zones/main-authority-captured-state.reader.js';
import type { MainAuthorityArchiveContext } from '../../src/modules/zones/main-authority-archive-codec.js';
import {
  MainQualifiedAuthorityReader,
  type MainQualifiedAuthorityPrepared,
} from '../../src/modules/zones/main-qualified-authority.reader.js';

let fixture: Awaited<ReturnType<typeof createQualifiedAuthorityFixture>>,
  db: DataSource,
  schema: string;
const sha256 = (body: Buffer | string) => createHash('sha256').update(body).digest('hex');
const quote = (id: string) => '"' + id.replaceAll('"', '""') + '"';

let request: AuthenticatedRequest,
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

/** Simulates the future WorkPort writable SERIALIZABLE TX with early 20-table SHARE locks and schema-only path. */
async function withWritableSnapshotFence<T>(
  operation: (manager: EntityManager) => Promise<T>,
  tables: readonly string[] = MAIN_AUTHORITY_SNAPSHOT_TABLES,
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
  fixture = await createQualifiedAuthorityFixture();
  ({
    db,
    schema,
    request,
    config,
    cutover,
    reader,
    fixturePath,
    actor,
    subject,
    siteId,
    zoneId,
    manifest,
  } = fixture);
});
after(() => fixture?.dispose());

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
  assert.deepEqual(
    await withWritableSnapshotFence(
      (m) => reader.revalidate(m, input, prepared),
      MAIN_AUTHORITY_V2_SOURCES.map(([, table]) => table),
    ),
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

test('pending epoch gap transition drains before the authority snapshot', async () => {
  const [{ epoch_id: epochId }] = await db.query(
    'SELECT epoch_id FROM authorization_history_control',
  );
  const writer = db.createQueryRunner(),
    observer = db.createQueryRunner();
  try {
    await writer.startTransaction();
    await writer.query("UPDATE authorization_history_epoch SET state='GAPPED' WHERE epoch_id=$1", [
      epochId,
    ]);
    const input = makeInput(epochId, await pgNowUtc());
    const pending = reader.prepare(input);
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const [row] = await observer.query(
        `SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
        WHERE c.relnamespace=$1::regnamespace AND c.relname='authorization_history_epoch'
        AND l.mode='ShareLock' AND NOT l.granted) AS waiting`,
        [schema],
      );
      if ((waiting = row.waiting)) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(waiting, true, 'Pending epoch mutation must delay the first read snapshot');
    await writer.commitTransaction();
    assert.deepEqual(await pending, { status: 'UNAVAILABLE', reason: 'HISTORY_GAP' });
  } finally {
    if (writer.isTransactionActive) await writer.rollbackTransaction();
    await writer.release();
    await observer.release();
  }
});

test('worker selects the reviewed event-time epoch instead of the current pointer', async () => {
  const auto = reader as unknown as {
    prepareForEvent?: (
      context: MainAuthorityArchiveContext,
    ) => ReturnType<MainQualifiedAuthorityReader['prepare']>;
  };
  assert.equal(typeof auto.prepareForEvent, 'function', 'Worker needs event-time epoch selection');
  const prepare = (context: MainAuthorityArchiveContext) =>
    auto.prepareForEvent!.call(reader, context);
  const [{ epoch_id: previous }] = await db.query(
    'SELECT epoch_id FROM authorization_history_control',
  );
  const activated = await cutover.activate(request, previous);
  const context: MainAuthorityArchiveContext = {
    siteId,
    zoneId,
    workerId: null,
    capturedAt: await pgNowUtc(),
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  };
  const first = await prepare(context);
  assert.equal(first.status, 'QUALIFIED');
  assert.equal(first.epochId, activated.epochId);
  await cutover.activate(request, activated.epochId);
  const historical = await prepare(context);
  assert.equal(historical.status, 'QUALIFIED');
  assert.equal(historical.epochId, activated.epochId);
  assert.equal(historical.epochState, 'CLOSED');
  assert.deepEqual(await prepare({ ...context, capturedAt: '2000-01-01T00:00:00.000Z' }), {
    status: 'UNAVAILABLE',
    reason: 'EPOCH_WINDOW_UNQUALIFIED',
  });
  assert.deepEqual(await prepare({ ...context, capturedAt: 'invalid' }), {
    status: 'UNAVAILABLE',
    reason: 'INVALID_CAPTURE_TIME',
  });
  assert.deepEqual(await prepare({ ...context, siteId: randomUUID() }), {
    status: 'UNAVAILABLE',
    reason: 'SOURCE_SCOPE_MISMATCH',
  });
});
