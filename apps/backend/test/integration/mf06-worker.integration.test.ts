import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import {
  SiteEntity,
  CameraEntity,
  CameraObservationRegionEntity,
  ZoneEntity,
  ZoneType,
  ZoneRestrictionPolicy,
  CameraStatus,
} from '../../src/database/entities/index.js';
import { AiIngestionService } from '../../src/integrations/ai/ai-ingestion.service.js';
import { ObservationContextResolverService } from '../../src/modules/zones/observation-context-resolver.service.js';
import { AlertCandidateEvaluator } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';
import { Mf06IngestionEnqueueService } from '../../src/modules/safety/assessments/mf06-ingestion-enqueue.service.js';
import { Mf06JobLeaseService } from '../../src/modules/safety/assessments/mf06-job-lease.service.js';
import {
  Mf06AssessmentWorker,
  type Mf06AssessmentWorkPort,
} from '../../src/modules/safety/assessments/mf06-assessment-worker.service.js';
import { Mf06AssessmentStore } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';

const isolated = createIsolatedTestDatabase();
const db = isolated.dataSource;
before(async () => {
  await isolated.initialize();
});
after(() => isolated.dispose());
beforeEach(async () => {
  await db.query(
    "UPDATE zone_entry_assessment_job SET status='CANCELLED', head_revision=head_revision+1, lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE status IN ('PENDING','CLAIMED')",
  );
});

const options = {
  enabled: true,
  resolverTimeoutMs: 1000,
  drainTimeoutMs: 1000,
  maxDatabaseAttempts: 3,
};
const leases = () =>
  new Mf06JobLeaseService(db, { leaseSeconds: 60, maxAttempts: 3, retryDelaySeconds: 1 });
const store = new Mf06AssessmentStore(db);
async function fixture() {
  const siteId = randomUUID(),
    cameraId = randomUUID(),
    zoneId = randomUUID(),
    regionId = randomUUID(),
    eventId = randomUUID();
  await db
    .getRepository(SiteEntity)
    .insert({ id: siteId, code: siteId, name: 'Synthetic worker test Site' });
  await db.getRepository(CameraEntity).insert({
    id: cameraId,
    siteId,
    externalId: cameraId,
    code: cameraId,
    name: 'Synthetic camera metadata',
    status: CameraStatus.ACTIVE,
  });
  await db.getRepository(ZoneEntity).insert({
    id: zoneId,
    siteId,
    code: zoneId,
    name: 'Synthetic policy NONE',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
    requiredPpe: [],
  });
  await db.getRepository(CameraObservationRegionEntity).insert({
    id: regionId,
    cameraId,
    zoneId,
    version: 1,
    isActive: true,
    coordinateSpace: 'NORMALIZED_0_1',
    polygon: { type: 'Polygon', coordinates: [] },
  });
  const config = createTestConfig({
    MF06_ENQUEUE_ENABLED: 'true',
    MF06_ENQUEUE_MAX_OUTSTANDING: '100',
  });
  const ingest = new AiIngestionService(
    db,
    new ObservationContextResolverService(),
    new AlertCandidateEvaluator(),
    new DurableGroupingService(config, new SchedulingNotificationService(db)),
    config,
    undefined,
    undefined,
    new Mf06IngestionEnqueueService(db, config),
  );
  await ingest.ingestEvent({
    eventId,
    schemaVersion: '1.0.0',
    cameraExternalId: cameraId,
    streamSessionId: randomUUID(),
    capturedAt: new Date().toISOString(),
    frameDimensions: { width: 640, height: 480 },
    observations: [
      {
        type: 'PERSON',
        trackId: 7,
        confidence: 0.9,
        boundingBox: { x1: 0.1, y1: 0.1, x2: 0.8, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
      },
      { type: 'ZONE_ENTRY', trackId: 7, regionId, geometryVersion: 1 },
    ],
    evidence: [],
  });
  const [request] = (await db.query(
    'SELECT request_id,binding_hash FROM zone_entry_assessment_request WHERE event_id=$1',
    [eventId],
  )) as { request_id: string; binding_hash: string }[];
  assert.ok(request);
  return { siteId, eventId, requestId: request.request_id, bindingHash: request.binding_hash };
}
function workFor(
  f: Awaited<ReturnType<typeof fixture>>,
  reason: 'SERVICE_DISABLED' | 'PROFILE_REVOKED' = 'SERVICE_DISABLED',
): Mf06AssessmentWorkPort {
  const commandId = randomUUID();
  return {
    prepare: async (claim) => {
      assert.equal(claim.requestId, f.requestId);
      return { commandId };
    },
    finalize: (manager, claim) =>
      store.finalizeInTransaction(manager, {
        claim: {
          requestId: claim.requestId,
          leaseToken: claim.leaseToken,
          headRevision: claim.headRevision,
        },
        commandId,
        siteId: f.siteId,
        bindingHash: f.bindingHash,
        evaluatorVersion: 'SYNTHETIC_WORKER_FIXTURE_V1',
        outcome: 'UNAVAILABLE',
        reasonCode: reason,
        provenance: 'UNAVAILABLE',
        workerId: null,
        profileRevision: null,
        frameSha256: null,
        cropSha256: null,
        authorityArtifact: null,
      }),
  };
}

test('real ingestion→claim→SERIALIZABLE unavailable append preserves one assessment/job and stops after drain', async () => {
  const f = await fixture();
  const worker = new Mf06AssessmentWorker(db, leases(), workFor(f), options);
  assert.equal(await worker.runOnce(), 'COMPLETED');
  assert.equal(await worker.runOnce(), 'IDLE');
  const [row] = await db.query(
    'SELECT j.status,count(a.assessment_id)::integer AS assessments FROM zone_entry_assessment_job j LEFT JOIN zone_entry_assessment a USING(request_id) WHERE j.request_id=$1 GROUP BY j.status',
    [f.requestId],
  );
  assert.deepEqual(row, { status: 'SUCCEEDED', assessments: 1 });
  await worker.drain();
  assert.equal(await worker.runOnce(), 'IDLE');
});

test('ignored-signal preparation times out and late completion cannot append', async () => {
  const f = await fixture();
  let finish!: (value: unknown) => void;
  const work = workFor(f);
  work.prepare = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const worker = new Mf06AssessmentWorker(db, leases(), work, {
    ...options,
    resolverTimeoutMs: 10,
  });
  assert.equal(await worker.runOnce(), 'RETRY');
  finish({ late: true });
  await Promise.resolve();
  await Promise.resolve();
  const [row] = await db.query(
    'SELECT status,last_error_code FROM zone_entry_assessment_job WHERE request_id=$1',
    [f.requestId],
  );
  assert.deepEqual(row, { status: 'PENDING', last_error_code: 'RESOLVER_TIMEOUT' });
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::integer AS total FROM zone_entry_assessment WHERE request_id=$1',
        [f.requestId],
      )
    )[0].total,
    0,
  );
});

test('serialization retries use a fresh transaction while prepare executes exactly once', async () => {
  const f = await fixture(),
    work = workFor(f);
  let prepared = 0,
    attempts = 0;
  work.prepare = async () => {
    prepared++;
    return { synthetic: true };
  };
  const finalize = work.finalize;
  work.finalize = async (...args) => {
    attempts++;
    if (attempts < 3)
      await args[0].query(
        "DO $$ BEGIN RAISE EXCEPTION 'Synthetic serialization fixture' USING ERRCODE='40001'; END $$",
      );
    return finalize(...args);
  };
  assert.equal(await new Mf06AssessmentWorker(db, leases(), work, options).runOnce(), 'COMPLETED');
  assert.equal(prepared, 1);
  assert.equal(attempts, 3);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::integer AS total FROM zone_entry_assessment WHERE request_id=$1',
        [f.requestId],
      )
    )[0].total,
    1,
  );
});

test('database retry exhaustion returns the real claim to PENDING with its separate error code', async () => {
  const f = await fixture(),
    work = workFor(f);
  let attempts = 0;
  work.finalize = async (manager) => {
    attempts++;
    await manager.query(
      "DO $$ BEGIN RAISE EXCEPTION 'Synthetic exhausted transaction fixture' USING ERRCODE='40001'; END $$",
    );
    throw new Error('Unreachable');
  };
  assert.equal(await new Mf06AssessmentWorker(db, leases(), work, options).runOnce(), 'RETRY');
  assert.equal(attempts, 3);
  const [row] = await db.query(
    'SELECT status,last_error_code,attempt_count FROM zone_entry_assessment_job WHERE request_id=$1',
    [f.requestId],
  );
  assert.deepEqual(row, {
    status: 'PENDING',
    last_error_code: 'DATABASE_UNAVAILABLE',
    attempt_count: 1,
  });
});

test('drain during finalization rolls back an append before commit and cancels its timely claim', async () => {
  const f = await fixture(),
    work = workFor(f);
  let ready!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finalize = work.finalize;
  work.finalize = async (...args) => {
    const result = await finalize(...args);
    ready();
    await resume;
    return result;
  };
  const worker = new Mf06AssessmentWorker(db, leases(), work, options),
    run = worker.runOnce();
  await started;
  const drain = worker.drain();
  release();
  await drain;
  assert.equal(await run, 'CANCELLED');
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::integer AS total FROM zone_entry_assessment WHERE request_id=$1',
        [f.requestId],
      )
    )[0].total,
    0,
  );
  assert.equal(
    (
      await db.query('SELECT status FROM zone_entry_assessment_job WHERE request_id=$1', [
        f.requestId,
      ])
    )[0].status,
    'CANCELLED',
  );
});
