import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import {
  appendSafetyFaceGrant,
  appendSafetyFaceRevocation,
} from '../../src/modules/workforce/identity/safety-face-receipt-store.js';
import { SafetyFaceProfileMetadataReader } from '../../src/modules/workforce/safety-face-profile.reader.js';

test('trusted Face receipts append idempotently without implicit enrollment consent or cross-Site grants', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const siteId = randomUUID(),
      workerId = randomUUID(),
      profileId = randomUUID(),
      actorUserId = randomUUID();
    await db.query('INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,$1::uuid::text)', [
      siteId,
    ]);
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic receipt actor','synthetic-non-login')",
      [actorUserId],
    );
    await db.query(
      "INSERT INTO worker(id,site_id,external_id,display_name) VALUES($1,$2,$1::uuid::text,'Synthetic worker')",
      [workerId, siteId],
    );
    await db.query(
      "INSERT INTO face_profile(id,worker_id,encrypted_template,profile_reference_hash,model_version,status,consent_version,consented_at,created_by_user_id,consent_method) VALUES($1,$2,$3,$4,'synthetic-v1','ACTIVE','enrollment-v1',statement_timestamp(),$5,'SUPERVISED_WORKER_CONFIRMATION')",
      [profileId, workerId, 'x'.repeat(128), 'a'.repeat(64), actorUserId],
    );
    const [{ safety_revision: profileRevision }] = await db.query(
      'SELECT safety_revision FROM face_profile WHERE id=$1',
      [profileId],
    );
    const input = {
      siteId,
      workerId,
      profileId,
      profileRevision,
      actorUserId,
      sourceRecordId: randomUUID(),
      sourceRecordHash: 'b'.repeat(64),
      occurredAt: new Date().toISOString(),
      consentVersion: 'synthetic-safety-v1',
      purpose: 'SAFETY_MF06' as const,
    };
    const reader = new SafetyFaceProfileMetadataReader();
    const lookup = () =>
      reader.findCurrentForSafety(db.manager, siteId, {
        profileReferenceHash: 'a'.repeat(64),
        profileRevision,
        modelVersion: 'synthetic-v1',
      });
    assert.equal((await lookup()).state, 'UNAVAILABLE');
    await assert.rejects(
      db.transaction((tx) => appendSafetyFaceGrant(tx, { ...input, siteId: randomUUID() })),
      /scope|profile/i,
    );
    await assert.rejects(
      db.transaction((tx) =>
        appendSafetyFaceGrant(tx, { ...input, profileRevision: randomUUID() }),
      ),
      /scope|profile/i,
    );
    const grant = await db.transaction((tx) => appendSafetyFaceGrant(tx, input));
    assert.equal(grant.replayed, false);
    const retry = await db.transaction((tx) => appendSafetyFaceGrant(tx, input));
    assert.deepEqual(retry, { id: grant.id, replayed: true });
    await assert.rejects(
      db.transaction((tx) =>
        appendSafetyFaceGrant(tx, { ...input, sourceRecordHash: 'c'.repeat(64) }),
      ),
      /conflict/i,
    );
    assert.equal((await lookup()).state, 'ELIGIBLE_METADATA');
    const duplicates = await Promise.all(
      Array.from({ length: 4 }, () => db.transaction((tx) => appendSafetyFaceGrant(tx, input))),
    );
    assert.ok(duplicates.every((r) => r.id === grant.id && r.replayed));
    const revoke = {
      siteId,
      workerId,
      consentId: grant.id,
      actorUserId,
      sourceRecordId: randomUUID(),
      sourceRecordHash: 'd'.repeat(64),
      occurredAt: new Date().toISOString(),
    };
    await assert.rejects(
      db.transaction((tx) => appendSafetyFaceRevocation(tx, { ...revoke, siteId: randomUUID() })),
      /scope|consent/i,
    );
    assert.equal(
      (await db.transaction((tx) => appendSafetyFaceRevocation(tx, revoke))).replayed,
      false,
    );
    assert.equal(
      (await db.transaction((tx) => appendSafetyFaceRevocation(tx, revoke))).replayed,
      true,
    );
    await assert.rejects(
      db.transaction((tx) =>
        appendSafetyFaceRevocation(tx, { ...revoke, sourceRecordHash: 'e'.repeat(64) }),
      ),
      /conflict/i,
    );
    assert.equal((await lookup()).state, 'UNAVAILABLE');
    assert.equal((await db.query('SELECT count(*)::int n FROM safety_face_consent'))[0].n, 1);
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM safety_face_consent_revocation'))[0].n,
      1,
    );
    const nextGrant = {
      ...input,
      sourceRecordId: randomUUID(),
      occurredAt: new Date().toISOString(),
    };
    const simultaneous = await Promise.all(
      Array.from({ length: 4 }, () => db.transaction((tx) => appendSafetyFaceGrant(tx, nextGrant))),
    );
    assert.equal(new Set(simultaneous.map((result) => result.id)).size, 1);
    assert.equal(simultaneous.filter((result) => !result.replayed).length, 1);
    assert.equal((await db.query('SELECT count(*)::int n FROM safety_face_consent'))[0].n, 2);
    await db.query(
      "UPDATE face_profile SET status='REVOKED',revoked_at=statement_timestamp() WHERE id=$1",
      [profileId],
    );
    const laterRevocation = {
      ...revoke,
      consentId: simultaneous[0]!.id,
      sourceRecordId: randomUUID(),
      occurredAt: new Date().toISOString(),
    };
    assert.equal(
      (await db.transaction((tx) => appendSafetyFaceRevocation(tx, laterRevocation))).replayed,
      false,
    );
    assert.equal(
      (await db.transaction((tx) => appendSafetyFaceRevocation(tx, laterRevocation))).replayed,
      true,
    );
    assert.equal((await lookup()).state, 'UNAVAILABLE');
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM safety_face_consent_revocation'))[0].n,
      2,
    );
    await assert.rejects(
      db.transaction((tx) => appendSafetyFaceGrant(tx, { ...input, sourceRecordId: randomUUID() })),
      /profile/i,
    );
    await assert.rejects(appendSafetyFaceGrant(db.manager, input), /transaction/i);
  } finally {
    await owned.dispose();
  }
});
