import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, after, test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import { AuthService, type AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { AuthorizationHistoryCutover1793232000000 } from '../../src/database/migrations/1793232000000-AuthorizationHistoryCutover.js';
import { MainAuthorityCutoverService } from '../../src/modules/zones/main-authority-cutover.service.js';
import {
  MAIN_AUTHORITY_CUTOVER_RELEASE_FILES,
  MAIN_AUTHORITY_CUTOVER_RUNTIME_FILES,
  type MainAuthorityCutoverReleaseConfig,
} from '../../src/modules/zones/main-authority-cutover-release.js';

const owned = createIsolatedTestDatabase({ preAuthorityCutover72: true }),
  db = owned.dataSource;
const sha256 = (body: Buffer | string) => createHash('sha256').update(body).digest('hex');
let auth: AuthService,
  guard: UserAuthGuard,
  request: AuthenticatedRequest,
  config: MainAuthorityCutoverReleaseConfig,
  service: MainAuthorityCutoverService,
  refreshToken: string,
  actor: string;
let manifest: {
  [key: string]: unknown;
  runtimeFiles: Array<{ path: string; sha256: string }>;
  writerReview: { completeWriterClosureEstablished: boolean };
};
let fixturePath: string;

before(async () => {
  console.log(`ownedAuthorityCutoverServiceSchema=${(db.options as { schema: string }).schema}`);
  await owned.initialize();
  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    await new AuthorizationHistoryCutover1793232000000().up(runner);
    await runner.commitTransaction();
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
  actor = randomUUID();
  const siteId = randomUUID();
  const password = 'Synthetic-Cutover-Session-123!';
  await db.query(
    "INSERT INTO site(id,code,name) VALUES($1,'SYNTHETIC-CUTOVER-SITE','Synthetic Cutover Site')",
    [siteId],
  );
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic Admin',$2,false)",
    [actor, await hashPassword(password)],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL),($3,$2,'SAFETY_OFFICER',$4)",
    [randomUUID(), actor, randomUUID(), siteId],
  );
  auth = new AuthService(db, new AuthTokenService(new JwtService(), createTestConfig()));
  guard = new UserAuthGuard(auth);
  const login = await auth.login(actor, password, AuthClientType.WEB);
  refreshToken = login.refreshToken;
  request = { headers: { authorization: `Bearer ${login.accessToken}` } };
  await guard.authenticateRequest(request);
  fixturePath = await mkdtemp('D:/Ky9-FPT/SmartSiteData/runs/cutover-service-synthetic-');
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
    } as typeof manifest.writerReview,
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
  service = new MainAuthorityCutoverService(db, guard, config, createTestConfig());
});
after(() => owned.dispose());

const status = (wanted: number) => (error: unknown) =>
  (error as { getStatus?: () => number }).getStatus?.() === wanted;
async function state() {
  return {
    control: await db.query('SELECT * FROM authorization_history_control'),
    epochs: await db.query('SELECT * FROM authorization_history_epoch ORDER BY epoch_id'),
    baselines: await db.query(
      'SELECT epoch_id,command_id,snapshot_hash FROM authorization_history_baseline ORDER BY epoch_id',
    ),
    commands: await db.query(
      'SELECT command_id FROM authorization_history_command ORDER BY command_id',
    ),
  };
}

test('Actual original WEB bearer and current global Admin commit synthetic cutover with postcommit witness', async () => {
  const original = guard.authenticateRequest.bind(guard),
    bound: AuthenticatedRequest[] = [];
  guard.authenticateRequest = async (req, manager) => {
    bound.push(req);
    assert.equal(manager?.queryRunner?.isTransactionActive, true);
    return original(req, manager);
  };
  try {
    const result = await service.activate(request, null);
    assert.equal(result.commitStatus, 'COMMITTED');
    assert.equal(result.provenance, 'SYNTHETIC_TEST');
    assert.equal(result.witnessConfirmed, true);
    assert.deepEqual(bound, [request, request]);
    assert.deepEqual(await db.query('SELECT epoch_id FROM authorization_history_control'), [
      { epoch_id: result.epochId },
    ]);
    assert.deepEqual(
      await db.query('SELECT state FROM authorization_history_epoch WHERE epoch_id=$1', [
        result.epochId,
      ]),
      [{ state: 'READY' }],
    );
  } finally {
    guard.authenticateRequest = original;
  }
});

test('Stale expected pointer is 409 and cannot leave a command, epoch or baseline', async () => {
  const prior = await state();
  await assert.rejects(service.activate(request, null), status(409));
  assert.deepEqual(await state(), prior);
});

test('Two concurrent activations with one expected pointer produce one commit and one 409', async () => {
  const prior = await state(),
    expected = prior.control[0].epoch_id;
  const results = await Promise.allSettled([
    service.activate(request, expected),
    service.activate(request, expected),
  ]);
  const success = results.filter((r) => r.status === 'fulfilled');
  const failure = results.filter((r) => r.status === 'rejected');
  assert.equal(success.length, 1);
  assert.equal(failure.length, 1);
  assert.equal(status(409)((failure[0] as PromiseRejectedResult).reason), true);
  const next = await state();
  assert.equal(next.baselines.length, prior.baselines.length + 1);
  assert.equal(next.commands.length, prior.commands.length + 1);
  assert.deepEqual(
    await db.query(
      'SELECT state,closed_at IS NOT NULL AS closed FROM authorization_history_epoch WHERE epoch_id=$1',
      [expected],
    ),
    [{ state: 'CLOSED', closed: true }],
  );
});

test('Pinned but unclosed writer review is refused without database changes', async () => {
  const prior = await state();
  const bytes = JSON.stringify({
    ...manifest,
    writerReview: { ...manifest.writerReview, completeWriterClosureEstablished: false },
  });
  const path = join(fixturePath, 'unqualified-manifest.json');
  await writeFile(path, bytes, { flag: 'wx' });
  await assert.rejects(
    new MainAuthorityCutoverService(
      db,
      guard,
      { ...config, manifestPath: path, reviewedManifestSha256: sha256(bytes) },
      createTestConfig(),
    ).activate(request, prior.control[0].epoch_id),
    status(503),
  );
  assert.deepEqual(await state(), prior);
});

test('Changed review pin or release file is refused without database changes', async () => {
  const prior = await state();
  await assert.rejects(
    new MainAuthorityCutoverService(
      db,
      guard,
      { ...config, reviewedManifestSha256: 'd'.repeat(64) },
      createTestConfig(),
    ).activate(request, prior.control[0].epoch_id),
    status(503),
  );
  const target = resolve(fixturePath, MAIN_AUTHORITY_CUTOVER_RELEASE_FILES[0]!);
  const bytes = await readFile(target);
  try {
    await writeFile(target, 'SYNTHETIC_CHANGED_BYTES');
    await assert.rejects(service.activate(request, prior.control[0].epoch_id), status(503));
  } finally {
    await writeFile(target, bytes);
  }
  assert.deepEqual(await state(), prior);
});

test('Disabled installed control guard is refused before an epoch is inserted', async () => {
  const prior = await state();
  await db.query(
    'ALTER TABLE authorization_history_control DISABLE TRIGGER trg_mf06_authority_control_update',
  );
  try {
    await assert.rejects(service.activate(request, prior.control[0].epoch_id), status(503));
  } finally {
    await db.query(
      'ALTER TABLE authorization_history_control ENABLE TRIGGER trg_mf06_authority_control_update',
    );
  }
  assert.deepEqual(await state(), prior);
});

test('Current Admin role revocation is 403 despite a valid original bearer', async () => {
  await db.query(
    "DELETE FROM user_role_assignment WHERE user_id=$1 AND role='ADMIN' AND site_id IS NULL",
    [actor],
  );
  const prior = await state();
  try {
    await assert.rejects(service.activate(request, prior.control[0].epoch_id), status(403));
    assert.deepEqual(await state(), prior);
  } finally {
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
      [randomUUID(), actor],
    );
  }
});

test('Missing postcommit witness returns explicit committed/unconfirmed, not a retryable rollback claim', async () => {
  const expected = (await state()).control[0].epoch_id;
  const original = db.query.bind(db);
  db.query = async (sql: string, ...args: unknown[]) => {
    if (sql.startsWith('INSERT INTO authorization_history_commit_receipt'))
      throw new Error('Synthetic receipt failure');
    return original(sql, ...(args as []));
  };
  try {
    const result = await service.activate(request, expected);
    assert.equal(result.commitStatus, 'COMMITTED');
    assert.equal(result.witnessConfirmed, false);
    assert.deepEqual(await db.query('SELECT epoch_id FROM authorization_history_control'), [
      { epoch_id: result.epochId },
    ]);
  } finally {
    db.query = original;
  }
});

test('Baseline resource limit 54000 maps to 413 PAYLOAD_TOO_LARGE without residue', async () => {
  const prior = await state();
  await db.query(`
    CREATE OR REPLACE FUNCTION synthetic_cutover_baseline_error() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN RAISE EXCEPTION 'Synthetic baseline error' USING ERRCODE = TG_ARGV[0]; END $fn$;
    CREATE TRIGGER trg_00_synthetic_cutover_baseline_error
    BEFORE INSERT ON authorization_history_baseline
    FOR EACH ROW EXECUTE FUNCTION synthetic_cutover_baseline_error('54000');
  `);
  try {
    await assert.rejects(service.activate(request, prior.control[0].epoch_id), status(413));
    assert.deepEqual(await state(), prior);
  } finally {
    await db.query(
      'DROP TRIGGER IF EXISTS trg_00_synthetic_cutover_baseline_error ON authorization_history_baseline',
    );
    await db.query('DROP FUNCTION IF EXISTS synthetic_cutover_baseline_error()');
  }
});

test('Baseline availability error 55000 maps to 503 SERVICE_UNAVAILABLE without residue', async () => {
  const prior = await state();
  await db.query(`
    CREATE OR REPLACE FUNCTION synthetic_cutover_baseline_error() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN RAISE EXCEPTION 'Synthetic baseline error' USING ERRCODE = TG_ARGV[0]; END $fn$;
    CREATE TRIGGER trg_00_synthetic_cutover_baseline_error
    BEFORE INSERT ON authorization_history_baseline
    FOR EACH ROW EXECUTE FUNCTION synthetic_cutover_baseline_error('55000');
  `);
  try {
    await assert.rejects(service.activate(request, prior.control[0].epoch_id), status(503));
    assert.deepEqual(await state(), prior);
  } finally {
    await db.query(
      'DROP TRIGGER IF EXISTS trg_00_synthetic_cutover_baseline_error ON authorization_history_baseline',
    );
    await db.query('DROP FUNCTION IF EXISTS synthetic_cutover_baseline_error()');
  }
});

test('Synthetic release manifest is refused with 503 when NODE_ENV is production without database changes', async () => {
  const prior = await state();
  const productionConfig = createTestConfig();
  productionConfig.set('NODE_ENV', 'production');
  await assert.rejects(
    new MainAuthorityCutoverService(db, guard, config, productionConfig).activate(
      request,
      prior.control[0].epoch_id,
    ),
    status(503),
  );
  assert.deepEqual(await state(), prior);
});

test('Repinned synthetic manifest with mismatched sourceRegistryHash is refused with 503 without database changes', async () => {
  const prior = await state();
  const bytes = JSON.stringify({ ...manifest, sourceRegistryHash: 'e'.repeat(64) });
  const path = join(fixturePath, 'mismatched-source-registry-manifest.json');
  await writeFile(path, bytes, { flag: 'wx' });
  await assert.rejects(
    new MainAuthorityCutoverService(
      db,
      guard,
      { ...config, manifestPath: path, reviewedManifestSha256: sha256(bytes) },
      createTestConfig(),
    ).activate(request, prior.control[0].epoch_id),
    status(503),
  );
  assert.deepEqual(await state(), prior);
});

test('Repinned synthetic manifest with altered runtimeFiles digest is refused with 503 without database changes', async () => {
  const prior = await state();
  const runtimeFiles = manifest.runtimeFiles.map((file, index) =>
    index === 0 ? { ...file, sha256: 'f'.repeat(64) } : file,
  );
  const bytes = JSON.stringify({ ...manifest, runtimeFiles });
  const path = join(fixturePath, 'mismatched-runtime-files-manifest.json');
  await writeFile(path, bytes, { flag: 'wx' });
  await assert.rejects(
    new MainAuthorityCutoverService(
      db,
      guard,
      { ...config, manifestPath: path, reviewedManifestSha256: sha256(bytes) },
      createTestConfig(),
    ).activate(request, prior.control[0].epoch_id),
    status(503),
  );
  assert.deepEqual(await state(), prior);
});

test('Logout before readback leaves committed cutover intact; replay with revoked bearer is 401', async () => {
  const prior = await state(),
    original = guard.authenticateRequest.bind(guard);
  let calls = 0;
  guard.authenticateRequest = async (req, manager) => {
    if (++calls === 2) await auth.logout(refreshToken, AuthClientType.WEB);
    return original(req, manager);
  };
  try {
    await assert.rejects(service.activate(request, prior.control[0].epoch_id), status(401));
  } finally {
    guard.authenticateRequest = original;
  }
  const committed = await state();
  assert.notDeepEqual(committed.control, prior.control);
  assert.equal(committed.baselines.length, prior.baselines.length + 1);
  await assert.rejects(service.activate(request, committed.control[0].epoch_id), status(401));
  assert.deepEqual(await state(), committed);
});

test('MOBILE Admin bearer cannot activate the WEB-only authority cutover', async () => {
  const login = await auth.login(actor, 'Synthetic-Cutover-Session-123!', AuthClientType.MOBILE);
  const mobileRequest: AuthenticatedRequest = {
    headers: { authorization: `Bearer ${login.accessToken}` },
  };
  await guard.authenticateRequest(mobileRequest);
  const before = await state();
  const [control] = await db.query(
    'SELECT epoch_id FROM authorization_history_control WHERE singleton=1',
  );
  await assert.rejects(service.activate(mobileRequest, control.epoch_id), status(401));
  assert.deepEqual(await state(), before);
});

test('caller-supplied WEB marker cannot replace a MOBILE session at transactional reauthorization', async () => {
  const login = await auth.login(actor, 'Synthetic-Cutover-Session-123!', AuthClientType.MOBILE);
  const forgedRequest: AuthenticatedRequest = {
    headers: { authorization: `Bearer ${login.accessToken}` },
  };
  await guard.authenticateRequest(forgedRequest);
  forgedRequest.clientType = AuthClientType.WEB;
  const before = await state();
  const [control] = await db.query(
    'SELECT epoch_id FROM authorization_history_control WHERE singleton=1',
  );
  await assert.rejects(service.activate(forgedRequest, control.epoch_id), status(401));
  assert.deepEqual(await state(), before);
});
