import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import { SafetyAlertEvidenceService } from '../../src/modules/safety/alerts/safety-alert-evidence.service.js';
import { ObservationIdentityResolutionService } from '../../src/modules/safety/identity/observation-identity-resolution.service.js';
import type { WorkerReferenceReader } from '../../src/modules/safety/identity/worker-reference.port.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';

const owned = createIsolatedTestDatabase(),
  db = owned.dataSource;
before(() => owned.initialize());
after(() => owned.dispose());

test('manual RESOLVE/CLEAR revise only the exact episode; retries and failed decisions do not', async () => {
  const site = randomUUID(),
    camera = randomUUID(),
    event = randomUUID(),
    session = randomUUID(),
    user = randomUUID(),
    worker = randomUUID();
  const episodes = [randomUUID(), randomUUID()],
    alerts = [randomUUID(), randomUUID()];
  const root = join(tmpdir(), `episode-identity-${randomUUID()}`);
  await mkdir(root);
  const bytes = Buffer.from([255, 216, 255, 217]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(root, `${session}_1_${event}.jpg`), bytes);
  const raw = {
    schemaVersion: '1.2.0',
    eventId: event,
    cameraExternalId: camera,
    streamSessionId: session,
    capturedAt: '2026-10-29T00:00:00Z',
    frameDimensions: { width: 640, height: 480 },
    observations: [7, 8].map((trackId) => ({
      type: 'PERSON',
      trackId,
      boundingBox: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
    })),
    evidence: [{ kind: 'FRAME', uri: `local://evidence/${session}/1/${event}.jpg`, sha256 }],
  };
  const hash = computeCanonicalPayloadHash(raw);
  await db.query('INSERT INTO site(id,code,name) VALUES($1::uuid,$1::text,$1::text)', [site]);
  await db.query(
    `INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1::uuid,$1::text,$1::text,'SYNTHETIC_NOT_USABLE')`,
    [user],
  );
  await db.query(
    'INSERT INTO worker(id,site_id,external_id,display_name) VALUES($1::uuid,$2,$1::text,$1::text)',
    [worker, site],
  );
  await db.query(
    'INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1::uuid,$2,$1::text,$1::text,$1::text)',
    [camera, site],
  );
  await db.query(
    `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at,raw_payload,processing_status)
    VALUES($1,$2,$3::text,$3::uuid,$4,$5,$6::jsonb,'PROCESSED')`,
    [event, hash, camera, session, raw.capturedAt, JSON.stringify(raw)],
  );
  for (const [index, episode] of episodes.entries()) {
    await db.query(
      `INSERT INTO safety_episode(id,site_id,camera_id,event_id,person_observation_index,payload_hash,first_observed_at,last_observed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$7)`,
      [episode, site, camera, event, index, hash, raw.capturedAt],
    );
    await db.query(
      `INSERT INTO safety_alert(id,site_id,episode_id,alert_type,candidate_subtype,grouping_key,first_detected_at,last_detected_at)
      VALUES($1::uuid,$2,$3,'PPE_VIOLATION','PPE_HARD_HAT_MISSING',$1::text,now(),now())`,
      [alerts[index], site, episode],
    );
    await db.query(
      'INSERT INTO alert_detection_mapping(alert_id,event_id,person_observation_index) VALUES($1,$2,$3)',
      [alerts[index], event, index],
    );
  }
  // Synthetic port qualification isolates revision behavior; not real Workforce/human identity acceptance.
  const workers: WorkerReferenceReader = {
    findForReview: async (_manager, siteId, workerId) =>
      siteId === site && workerId === worker
        ? {
            id: worker,
            siteId: site,
            externalId: worker,
            displayName: 'Synthetic Worker',
            isActive: true,
          }
        : null,
    listForReview: async () => ({ items: [], total: 0 }),
  };
  const service = new ObservationIdentityResolutionService(
    db,
    new SafetyAlertEvidenceService(db, createTestConfig({ EVIDENCE_LOCAL_ROOT: root })),
    workers,
  );
  const input = {
    commandId: randomUUID(),
    action: 'RESOLVE',
    expectedRevision: 0,
    expectedEventHash: hash,
    workerId: worker,
    evidenceIndex: 0,
    expectedEvidenceSha256: sha256,
    reason: 'Synthetic exact-observation identity review',
  };
  const revise = (body: unknown) => service.decide(site, alerts[0]!, event, 0, user, body);
  const versions = async () =>
    (
      await db.query(
        'SELECT id,content_revision FROM safety_episode WHERE event_id=$1 ORDER BY person_observation_index',
        [event],
      )
    ).map((row: { content_revision: number }) => row.content_revision);
  await revise(input);
  assert.deepEqual(await versions(), [2, 1]);
  assert.equal((await revise(input)).replayed, true);
  assert.deepEqual(await versions(), [2, 1]);
  const clear = {
    commandId: randomUUID(),
    action: 'CLEAR',
    expectedRevision: 1,
    expectedEventHash: hash,
    reason: 'Synthetic identity association cleared',
  };
  await revise(clear);
  assert.deepEqual(await versions(), [3, 1]);
  assert.equal((await revise(clear)).replayed, true);
  await db.query('UPDATE safety_episode SET content_revision=2147483647 WHERE id=$1', [
    episodes[0],
  ]);
  const exhausted = randomUUID();
  await assert.rejects(
    revise({ ...input, commandId: exhausted, expectedRevision: 2 }),
    (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 409,
  );
  const [head] = await db.query(
    'SELECT revision FROM observation_identity_resolution WHERE event_id=$1 AND person_observation_index=0',
    [event],
  );
  assert.equal(head.revision, 2);
  assert.equal(
    (await db.query('SELECT id FROM observation_identity_decision WHERE id=$1', [exhausted]))
      .length,
    0,
  );
});
