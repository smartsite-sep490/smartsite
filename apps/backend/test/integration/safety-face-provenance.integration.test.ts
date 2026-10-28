import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { CanonicalSafetyFaceProvenance1794268800000 } from '../../src/database/migrations/1794268800000-CanonicalSafetyFaceProvenance.js';
import { SafetyFaceProfileMetadataReader } from '../../src/modules/workforce/safety-face-profile.reader.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { FaceProfileEntity } from '../../src/database/entities/face-profile.entity.js';
import { setTimeout as delay } from 'node:timers/promises';

const database = createIsolatedTestDatabase();
const db = database.dataSource;
const candidate = new CanonicalSafetyFaceProvenance1794268800000();
const reader = new SafetyFaceProfileMetadataReader();
async function migrate(direction: 'up' | 'down') {
  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    await candidate[direction](runner);
    await runner.commitTransaction();
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
}
before(async () => {
  await database.initialize();
  assert(db.migrations.some((migration) => migration.name === candidate.name));
  assert.deepEqual((await db.driver.createSchemaBuilder().log()).upQueries, []);
});
after(() => database.dispose());

test('provenance migration requires a transaction and rejects namespace shadows before DDL', async () => {
  const runner = db.createQueryRunner();
  await runner.connect();
  try {
    for (const method of ['up', 'down'] as const) {
      await assert.rejects(candidate[method](runner), /requires a transaction/);
      for (const table of [
        'face_profile',
        'worker',
        'app_user',
        'safety_face_consent',
        'safety_face_consent_revocation',
      ]) {
        await runner.startTransaction();
        try {
          await runner.query(`CREATE TEMP TABLE ${table}(id uuid) ON COMMIT DROP`);
          await assert.rejects(candidate[method](runner), /Temporary/);
        } finally {
          await runner.rollbackTransaction();
        }
      }
      const [{ name }] = await runner.query('SELECT current_schema() AS name');
      assert.match(name, /^isolated_test_[a-f0-9]{32}$/);
      await runner.startTransaction();
      try {
        await runner.query(`CREATE SCHEMA "${name}_empty"`);
        await runner.query(`SET LOCAL search_path="${name}_empty","${name}"`);
        await assert.rejects(candidate[method](runner), /target schema/);
      } finally {
        await runner.rollbackTransaction();
      }
    }
    await runner.startTransaction();
    try {
      await assert.rejects(candidate.up(runner), /Existing Safety Face objects/);
    } finally {
      await runner.rollbackTransaction();
    }
    const functions: { proconfig: string[] | null }[] = await runner.query(
      "SELECT proconfig FROM pg_catalog.pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname LIKE 'mf06_face_%'",
    );
    assert.equal(functions.length, 4);
    assert(
      functions.every((row) =>
        row.proconfig?.some(
          (value) => value.startsWith('search_path=pg_catalog,') && value.endsWith(', pg_temp'),
        ),
      ),
    );
    const [{ name }] = await runner.query('SELECT current_schema() AS name');
    await runner.startTransaction();
    try {
      await runner.query(`CREATE SCHEMA "${name}_incomplete"`);
      for (const table of ['face_profile', 'worker', 'app_user'])
        await runner.query(`CREATE TABLE "${name}_incomplete".${table}(id uuid PRIMARY KEY)`);
      await runner.query(`SET LOCAL search_path="${name}_incomplete","${name}"`);
      await assert.rejects(candidate.up(runner), /Canonical main Face consent\/deletion/);
    } finally {
      await runner.rollbackTransaction();
    }
  } finally {
    await runner.release();
  }
});

const hash = 'a'.repeat(64);
async function profile(method = 'SUPERVISED_WORKER_CONFIRMATION') {
  const siteId = randomUUID(),
    userId = randomUUID(),
    workerId = randomUUID(),
    profileId = randomUUID();
  await db.query('INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,$1::uuid::text)', [
    siteId,
  ]);
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic actor','not-a-runtime-password')",
    [userId],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,external_id,display_name) VALUES($1,$2,$1::uuid::text,'Synthetic worker')",
    [workerId, siteId],
  );
  const reference = randomUUID().replaceAll('-', '').repeat(2);
  await db.query(
    `INSERT INTO face_profile(id,worker_id,user_id,encrypted_template,profile_reference_hash,model_version,status,
    consent_version,consented_at,created_by_user_id,consent_method) VALUES($1,$2,NULL,$3,$4,'synthetic-v1','ACTIVE',
    'enrollment-v1',statement_timestamp(),$5,$6)`,
    [profileId, workerId, 'x'.repeat(128), reference, userId, method],
  );
  const revision = (
    await db.query('SELECT safety_revision FROM face_profile WHERE id=$1', [profileId])
  )[0].safety_revision as string;
  return { siteId, userId, workerId, profileId, reference, revision };
}
type Profile = Awaited<ReturnType<typeof profile>>;
async function grant(p: Profile, revision = p.revision) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO safety_face_consent(id,profile_id,profile_revision,purpose,consent_version,consent_method,
    consented_at,source_record_id,source_record_hash,recorded_by_user_id)
    VALUES($1,$2,$3,'SAFETY_MF06','safety-v1','SUPERVISED_WORKER_CONFIRMATION',statement_timestamp(),$4,$5,$6)`,
    [id, p.profileId, revision, randomUUID(), hash, p.userId],
  );
  return id;
}
const reference = (p: Profile) => ({
  profileReferenceHash: p.reference,
  profileRevision: p.revision,
  modelVersion: 'synthetic-v1',
});
async function lookup(p: Profile) {
  return reader.findCurrentForSafety(db.manager, p.siteId, reference(p));
}
async function rejected(action: Promise<unknown>, code = '23514') {
  await assert.rejects(action, (error: unknown) => (error as { code?: string }).code === code);
}

test('migration provides a database-owned revision without creating consent records', async () => {
  const columns = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='face_profile'",
  );
  assert.equal(
    columns.some((row: { column_name: string }) => row.column_name === 'safety_revision'),
    true,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS count FROM safety_face_consent'))[0].count,
    0,
  );
  await migrate('down');
  assert.deepEqual(
    await reader.findCurrentForSafety(db.manager, randomUUID(), {
      profileReferenceHash: hash,
      profileRevision: randomUUID(),
      modelVersion: 'synthetic-v1',
    }),
    { state: 'UNAVAILABLE' },
  );
  await migrate('up');
});

test('populated Main profile upgrade preserves enrollment bytes without creating Safety consent', async () => {
  const p = await profile('LEGACY_UNVERIFIED');
  const snapshot = () =>
    db.query("SELECT to_jsonb(p)-'safety_revision' AS value FROM face_profile p WHERE id=$1", [
      p.profileId,
    ]);
  const before = await snapshot();
  await migrate('down');
  assert.deepEqual(await snapshot(), before);
  await migrate('up');
  assert.deepEqual(await snapshot(), before);
  const [{ safety_revision: revision }] = await db.query(
    'SELECT safety_revision FROM face_profile WHERE id=$1',
    [p.profileId],
  );
  assert.notEqual(revision, p.revision);
  assert.deepEqual(await lookup({ ...p, revision }), { state: 'UNAVAILABLE' });
  assert.equal((await db.query('SELECT count(*)::int AS n FROM safety_face_consent'))[0].n, 0);
  assert.deepEqual((await db.driver.createSchemaBuilder().log()).upQueries, []);
});

test('existing legacy and enrollment consent alone never becomes Safety consent', async () => {
  const legacy = await profile('LEGACY_UNVERIFIED');
  const enrolled = await profile();
  assert.deepEqual(await lookup(legacy), { state: 'UNAVAILABLE' });
  assert.deepEqual(await lookup(enrolled), { state: 'UNAVAILABLE' });
  assert.equal(
    (await db.query('SELECT count(*)::int AS count FROM safety_face_consent'))[0].count,
    0,
  );
  await rejected(grant(legacy));
});

test('eligible Safety metadata maps Worker from the database without requiring a login account or leaking a template', async () => {
  const p = await profile();
  const consentId = await grant(p);
  assert.deepEqual(await lookup(p), {
    state: 'ELIGIBLE_METADATA',
    workerId: p.workerId,
    siteId: p.siteId,
    profileId: p.profileId,
    profileRevision: p.revision,
    consentId,
  });
  assert.deepEqual(await reader.findCurrentForSafety(db.manager, randomUUID(), reference(p)), {
    state: 'UNAVAILABLE',
  });
  assert.deepEqual(
    await reader.findCurrentForSafety(db.manager, p.siteId, {
      ...reference(p),
      modelVersion: 'other',
    }),
    { state: 'UNAVAILABLE' },
  );
});

test('Main entity reads hide the Safety revision and encrypted template', async () => {
  const p = await profile();
  const visible = await db.getRepository(FaceProfileEntity).findOneByOrFail({ id: p.profileId });
  assert.equal(visible.safetyRevision, undefined);
  assert.equal(visible.encryptedTemplate, undefined);
  assert.equal(visible.consentMethod, 'SUPERVISED_WORKER_CONFIRMATION');
});

test('business profile changes rotate backend revision and invalidate old consent/candidate after I/O', async () => {
  const p = await profile();
  await grant(p);
  assert.equal((await lookup(p)).state, 'ELIGIBLE_METADATA');
  await db.query("UPDATE face_profile SET model_version='synthetic-v2' WHERE id=$1", [p.profileId]);
  const revision = (
    await db.query('SELECT safety_revision FROM face_profile WHERE id=$1', [p.profileId])
  )[0].safety_revision;
  assert.notEqual(revision, p.revision);
  assert.deepEqual(await lookup(p), { state: 'UNAVAILABLE' });
  assert.deepEqual(
    await reader.findCurrentForSafety(db.manager, p.siteId, {
      ...reference(p),
      profileRevision: revision,
      modelVersion: 'synthetic-v2',
    }),
    { state: 'UNAVAILABLE' },
  );
  await rejected(grant(p));
  await rejected(
    db.query('UPDATE face_profile SET safety_revision=$2 WHERE id=$1', [p.profileId, p.revision]),
  );
});

test('consent grant and revocation are immutable and a revoked grant is not eligible', async () => {
  const p = await profile();
  const consentId = await grant(p);
  await rejected(
    db.query('UPDATE safety_face_consent SET consent_version=$2 WHERE id=$1', [
      consentId,
      'changed',
    ]),
  );
  await rejected(db.query('DELETE FROM safety_face_consent WHERE id=$1', [consentId]));
  await db.query(
    `INSERT INTO safety_face_consent_revocation(consent_id,revoked_at,source_record_id,source_record_hash,recorded_by_user_id)
    VALUES($1,statement_timestamp(),$2,$3,$4)`,
    [consentId, randomUUID(), hash, p.userId],
  );
  assert.deepEqual(await lookup(p), { state: 'UNAVAILABLE' });
  await rejected(
    db.query('DELETE FROM safety_face_consent_revocation WHERE consent_id=$1', [consentId]),
  );
  await rejected(migrate('down'));
});

test('immutable consent provenance cannot be truncated', async () => {
  const before = await db.query('SELECT id FROM safety_face_consent ORDER BY id');
  assert(before.length > 0);
  const runner = db.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await rejected(runner.query('TRUNCATE safety_face_consent_revocation,safety_face_consent'));
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
  assert.deepEqual(await db.query('SELECT id FROM safety_face_consent ORDER BY id'), before);
});

test('a temporary Face profile cannot forge consent eligibility for a permanent legacy profile', async () => {
  const p = await profile('LEGACY_UNVERIFIED');
  const runner = db.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const [{ name }] = await runner.query('SELECT current_schema() AS name');
    assert.match(name, /^isolated_test_[a-f0-9]{32}$/);
    await runner.query(
      `CREATE TEMP TABLE face_profile (LIKE "${name}".face_profile) ON COMMIT DROP`,
    );
    await runner.query(
      `INSERT INTO pg_temp.face_profile SELECT * FROM "${name}".face_profile WHERE id=$1`,
      [p.profileId],
    );
    await runner.query(
      "UPDATE pg_temp.face_profile SET consent_method='SUPERVISED_WORKER_CONFIRMATION' WHERE id=$1",
      [p.profileId],
    );
    await rejected(
      runner.query(
        `INSERT INTO "${name}".safety_face_consent(id,profile_id,profile_revision,purpose,consent_version,consent_method,consented_at,source_record_id,source_record_hash,recorded_by_user_id)
      VALUES($1,$2,$3,'SAFETY_MF06','synthetic-v1','SUPERVISED_WORKER_CONFIRMATION',statement_timestamp(),$4,$5,$6)`,
        [randomUUID(), p.profileId, p.revision, randomUUID(), hash, p.userId],
      ),
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
  assert.deepEqual(await lookup(p), { state: 'UNAVAILABLE' });
});

test('Worker disablement and profile revocation/deletion invalidate metadata without fabricating identity', async () => {
  for (const sql of [
    'UPDATE worker SET is_active=false WHERE id=$1',
    "UPDATE face_profile SET status='REVOKED',revoked_at=statement_timestamp() WHERE worker_id=$1",
    'UPDATE face_profile SET encrypted_template=NULL,deleted_at=statement_timestamp() WHERE worker_id=$1',
  ]) {
    const p = await profile();
    await grant(p);
    // Main requires template removal only alongside a non-active profile.
    if (sql.includes('encrypted_template'))
      await db.query("UPDATE face_profile SET status='REVOKED' WHERE id=$1", [p.profileId]);
    await db.query(sql, [p.workerId]);
    assert.deepEqual(await lookup(p), { state: 'UNAVAILABLE' });
  }
});

test('malformed references fail closed before SQL parameter casting', async () => {
  const p = await profile();
  for (const altered of [
    { profileRevision: 'AI-value' },
    { profileReferenceHash: '' },
    { modelVersion: '' },
  ])
    assert.deepEqual(
      await reader.findCurrentForSafety(db.manager, p.siteId, { ...reference(p), ...altered }),
      { state: 'UNAVAILABLE' },
    );
});

test('revoking the latest consent cannot resurrect an older consent for the same profile revision', async () => {
  const p = await profile();
  await grant(p);
  const latest = await grant(p);
  await db.query(
    `INSERT INTO safety_face_consent_revocation(consent_id,revoked_at,source_record_id,source_record_hash,recorded_by_user_id)
    VALUES($1,statement_timestamp(),$2,$3,$4)`,
    [latest, randomUUID(), hash, p.userId],
  );
  assert.deepEqual(await lookup(p), { state: 'UNAVAILABLE' });
});

test('finalization locks keep revocation outside the atomic validation window', async () => {
  const p = await profile();
  const consentId = await grant(p);
  assert.deepEqual(await reader.findCurrentForSafety(db.manager, p.siteId, reference(p), true), {
    state: 'UNAVAILABLE',
  });
  const finalization = db.createQueryRunner(),
    revocation = db.createQueryRunner();
  try {
    await finalization.startTransaction('SERIALIZABLE');
    assert.equal(
      (await reader.findCurrentForSafety(finalization.manager, p.siteId, reference(p), true)).state,
      'ELIGIBLE_METADATA',
    );
    await revocation.startTransaction();
    await revocation.query("SET LOCAL lock_timeout='50ms'");
    await rejected(
      revocation.query(
        `INSERT INTO safety_face_consent_revocation(consent_id,revoked_at,source_record_id,source_record_hash,recorded_by_user_id)
      VALUES($1,statement_timestamp(),$2,$3,$4)`,
        [consentId, randomUUID(), hash, p.userId],
      ),
      '55P03',
    );
    await revocation.rollbackTransaction();
    await finalization.commitTransaction();
    await db.query(
      `INSERT INTO safety_face_consent_revocation(consent_id,revoked_at,source_record_id,source_record_hash,recorded_by_user_id)
      VALUES($1,statement_timestamp(),$2,$3,$4)`,
      [consentId, randomUUID(), hash, p.userId],
    );
    assert.deepEqual(await lookup(p), { state: 'UNAVAILABLE' });
  } finally {
    if (revocation.isTransactionActive) await revocation.rollbackTransaction();
    if (finalization.isTransactionActive) await finalization.rollbackTransaction();
    await revocation.release();
    await finalization.release();
  }
});

test('finalization requires a serializable transaction rather than a stale read-committed snapshot', async () => {
  const p = await profile();
  await grant(p);
  const runner = db.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    assert.deepEqual(
      await reader.findCurrentForSafety(runner.manager, p.siteId, reference(p), true),
      { state: 'UNAVAILABLE' },
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
});

test('revocation winning the lock cannot leave finalization eligible from an older snapshot', async () => {
  const p = await profile();
  const consentId = await grant(p);
  const revoker = db.createQueryRunner(),
    finalizer = db.createQueryRunner();
  await revoker.connect();
  await finalizer.connect();
  let read:
    | Promise<{ result?: Awaited<ReturnType<typeof reader.findCurrentForSafety>>; error?: unknown }>
    | undefined;
  try {
    await revoker.startTransaction();
    await revoker.query(
      `INSERT INTO safety_face_consent_revocation(consent_id,revoked_at,source_record_id,source_record_hash,recorded_by_user_id)
      VALUES($1,statement_timestamp(),$2,$3,$4)`,
      [consentId, randomUUID(), hash, p.userId],
    );
    const [{ pid: revokerPid }] = await revoker.query('SELECT pg_backend_pid() AS pid');
    await finalizer.startTransaction('SERIALIZABLE');
    const [{ pid: finalizerPid }] = await finalizer.query('SELECT pg_backend_pid() AS pid');
    read = reader.findCurrentForSafety(finalizer.manager, p.siteId, reference(p), true).then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const [{ waiting }] = await db.query(
        'SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS waiting',
        [finalizerPid, revokerPid],
      );
      if (waiting) {
        blocked = true;
        break;
      }
      await delay(5);
    }
    assert(blocked, 'Finalization must reach the contended lock before revocation commits');
    await revoker.commitTransaction();
    const outcome = await read;
    if (outcome.error) {
      assert.equal((outcome.error as { code?: string }).code, '40001');
    } else {
      await finalizer.commitTransaction();
      assert.deepEqual(outcome.result, { state: 'UNAVAILABLE' });
    }
  } finally {
    if (revoker.isTransactionActive) await revoker.rollbackTransaction();
    if (read) await read;
    if (finalizer.isTransactionActive) await finalizer.rollbackTransaction();
    await revoker.release();
    await finalizer.release();
  }
  assert.deepEqual(await lookup(p), { state: 'UNAVAILABLE' });
});

test('a consent grant after the snapshot fences finalization without changing profile bytes or revision', async () => {
  const p = await profile();
  await grant(p);
  const snapshot = () =>
    db.query('SELECT to_jsonb(p) AS value FROM face_profile p WHERE id=$1', [p.profileId]);
  const before = await snapshot();
  const runner = db.createQueryRunner();
  await runner.connect();
  await runner.startTransaction('SERIALIZABLE');
  try {
    await runner.query('SELECT id FROM face_profile WHERE id=$1', [p.profileId]);
    await grant(p);
    await rejected(
      reader.findCurrentForSafety(runner.manager, p.siteId, reference(p), true),
      '40001',
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
  assert.deepEqual(await snapshot(), before);
  assert.equal((await lookup(p)).state, 'ELIGIBLE_METADATA');
});
