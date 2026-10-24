import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { SafetyFaceProvenance1791590400003 } from '../../src/database/migrations/1791590400003-SafetyFaceProvenance.js';
import { SafetyFaceProfileMetadataReader } from '../../src/modules/workforce/safety-face-profile.reader.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const database = createIsolatedTestDatabase({ legacy: true });
const db = database.dataSource;
const candidate = new SafetyFaceProvenance1791590400003();
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
  // Main Face consent/deletion prerequisites, not a claim of full main compatibility.
  // The candidate is intentionally unregistered until the coordinated main graph is reconciled.
  await db.query(`ALTER TABLE face_profile ADD COLUMN consent_method VARCHAR(50) NOT NULL DEFAULT 'LEGACY_UNVERIFIED',
    ADD COLUMN deleted_at TIMESTAMPTZ; ALTER TABLE face_profile DROP CONSTRAINT chk_face_profile_database_template,
    ADD CONSTRAINT chk_face_profile_database_template CHECK(status <> 'ACTIVE' OR
    (encrypted_template IS NOT NULL AND length(encrypted_template) BETWEEN 100 AND 32768));`);
  await migrate('up');
});
after(() => database.dispose());

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
    await finalization.startTransaction();
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
