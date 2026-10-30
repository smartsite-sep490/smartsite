import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { computeCanonicalPayloadHash, computeWorkerEventBindingHash } from '@smartsite/contracts';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('admission column upgrade preserves legacy bytes and populated rollback refuses history loss', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    // Fresh profile contains the additive column; remove only its empty latest migration.
    const [fresh] = await db.query(`SELECT is_nullable,data_type FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='ai_observation_event' AND column_name='admission_context'`);
    assert.deepEqual(fresh, { is_nullable: 'YES', data_type: 'jsonb' });
    await db.undoLastMigration();
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='ai_observation_event' AND column_name='admission_context'`,
        )
      )[0].n,
      0,
    );
    const eventId = randomUUID(),
      session = randomUUID();
    const payload = {
      eventId,
      schemaVersion: '1.0.0',
      cameraExternalId: 'Synthetic_unregistered',
      streamSessionId: session,
      capturedAt: new Date().toISOString(),
      frameDimensions: { width: 120, height: 80 },
      observations: [],
      evidence: [],
    };
    const hash = computeCanonicalPayloadHash(payload);
    await db.query(
      `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,stream_session_id,captured_at,raw_payload,processing_status)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,'SKIPPED_UNKNOWN_CAMERA')`,
      [
        eventId,
        hash,
        payload.cameraExternalId,
        session,
        payload.capturedAt,
        JSON.stringify(payload),
      ],
    );
    const [before] = await db.query(
      'SELECT to_jsonb(e) AS value FROM ai_observation_event e WHERE event_id=$1',
      [eventId],
    );
    await db.runMigrations();
    const [after] = await db.query(
      "SELECT to_jsonb(e)-'admission_context' AS value,admission_context FROM ai_observation_event e WHERE event_id=$1",
      [eventId],
    );
    assert.deepEqual(after.value, before.value);
    assert.equal(after.admission_context, null);
    // Storage-only synthetic metadata, not evidence that the application authenticated it.
    const context = {
      schemaVersion: '1.0.0' as const,
      cameraId: randomUUID(),
      workerGenerationId: randomUUID(),
      streamSessionId: session,
      configurationVersion: 1,
      bundleSha256: 'a'.repeat(64),
      viewRevision: 1,
      receiptCommandId: randomUUID(),
      sourceKind: 'LIVE' as const,
    };
    const admission = {
      schemaVersion: '1.0.0',
      context,
      bindingHash: computeWorkerEventBindingHash(hash, context),
      classification: 'REVIEW_ONLY',
      admittedAt: new Date().toISOString(),
    };
    await db.query(
      'UPDATE ai_observation_event SET admission_context=$2::jsonb WHERE event_id=$1',
      [eventId, JSON.stringify(admission)],
    );
    await assert.rejects(db.undoLastMigration(), /Event admission history must be retained/);
    const [retained] = await db.query(
      'SELECT raw_payload,payload_hash,admission_context FROM ai_observation_event WHERE event_id=$1',
      [eventId],
    );
    assert.deepEqual(retained.raw_payload, payload);
    assert.equal(retained.payload_hash, hash);
    assert.deepEqual(retained.admission_context, admission);
    assert.equal((await db.runMigrations()).length, 0);
    await assert.rejects(
      db.query("UPDATE ai_observation_event SET admission_context='[]'::jsonb WHERE event_id=$1", [
        eventId,
      ]),
      /chk_ai_event_admission_object/,
    );
    assert.deepEqual(
      (
        await db.query('SELECT admission_context FROM ai_observation_event WHERE event_id=$1', [
          eventId,
        ])
      )[0].admission_context,
      admission,
    );
  } finally {
    await owned.dispose();
  }
});
