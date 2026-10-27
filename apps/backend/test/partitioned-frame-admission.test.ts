import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataSource, EntityManager } from 'typeorm';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import * as admission from '../src/integrations/ai/partitioned-frame-admission.js';
import { createTestConfig } from './support/config.js';
import { AiIngestionService } from '../src/integrations/ai/ai-ingestion.service.js';
import { ObservationContextResolverService } from '../src/modules/zones/observation-context-resolver.service.js';
import { AlertCandidateEvaluator } from '../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../src/modules/safety/alerts/durable-grouping.service.js';
import { SchedulingNotificationService } from '../src/modules/workforce/notifications/scheduling-notification.service.js';

const cameraId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
function part(index = 0) {
  return {
    eventId: `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`,
    schemaVersion: '1.4.0',
    cameraExternalId: 'CAM-1',
    streamSessionId: sessionId,
    capturedAt: '2026-10-27T10:00:00.123456789Z',
    frameDimensions: { width: 640, height: 480 },
    framePartition: {
      frameId: '44444444-4444-4444-8444-444444444444',
      sequenceNumber: '9007199254740993',
      partIndex: index,
      partCount: 3,
    },
    observations: [{ type: 'PERSON', trackId: 7, confidence: 0.9 }],
    evidence: [],
  };
}
function row(event: Record<string, unknown> & { eventId: string }) {
  return {
    eventId: event.eventId,
    payloadHash: computeCanonicalPayloadHash(event),
    rawPayload: event,
  };
}
function manager(rows: unknown[] = [], active = true) {
  const queries: string[] = [];
  return {
    queries,
    value: {
      queryRunner: { isTransactionActive: active },
      query: async (sql: string) => {
        queries.push(sql);
        return sql.includes('pg_advisory') ? [] : rows;
      },
    } as unknown as EntityManager,
  };
}

test('requires transaction and returns immutable frame scope only after serial admission', async () => {
  await assert.rejects(admission.admitPartitionedFrame(manager([], false).value, part(), cameraId));
  const db = manager();
  const scope = await admission.admitPartitionedFrame(db.value, part(), cameraId);
  assert.equal(scope?.frameId, part().framePartition.frameId);
  assert.equal(scope?.cameraId, cameraId);
  assert(Object.isFrozen(scope));
  assert.match(db.queries[0]!, /pg_advisory_xact_lock/);
});

test('legacy events do not enter multipart SQL path', async () => {
  const db = manager();
  assert.equal(
    await admission.admitPartitionedFrame(db.value, { schemaVersion: '1.3.0' }, cameraId),
    undefined,
  );
  assert.equal(db.queries.length, 0);
});

for (const field of [
  'capturedAt',
  'cameraExternalId',
  'sequenceNumber',
  'partCount',
  'frameDimensions',
] as const) {
  test(`rejects incompatible sibling ${field}`, async () => {
    const sibling = part(1);
    if (field === 'capturedAt') sibling.capturedAt = '2026-10-27T10:00:00.123456788Z';
    if (field === 'cameraExternalId') sibling.cameraExternalId = 'OTHER';
    if (field === 'sequenceNumber') sibling.framePartition.sequenceNumber = '9007199254740994';
    if (field === 'partCount') sibling.framePartition.partCount = 4;
    if (field === 'frameDimensions') sibling.frameDimensions.width = 1280;
    await assert.rejects(
      admission.admitPartitionedFrame(manager([row(sibling)]).value, part(), cameraId),
      (error: unknown) => (error as { getStatus(): number }).getStatus() === 409,
    );
  });
}

test('same-index different event cannot create another part; identical event retry remains idempotent', async () => {
  const current = part();
  await admission.admitPartitionedFrame(manager([row(current)]).value, current, cameraId);
  const duplicate = { ...current, eventId: part(2).eventId };
  await assert.rejects(
    admission.admitPartitionedFrame(manager([row(current)]).value, duplicate, cameraId),
  );
});

test('repeated subject context cannot change while contradictory identity remains data', async () => {
  const sibling = part(1);
  sibling.observations[0]!.confidence = 0.8;
  await assert.rejects(
    admission.admitPartitionedFrame(manager([row(sibling)]).value, part(), cameraId),
  );
});

test('stored hash corruption fails unavailable rather than establishing frame trust', async () => {
  const stored = { ...row(part(1)), payloadHash: 'a'.repeat(64) };
  await assert.rejects(
    admission.admitPartitionedFrame(manager([stored]).value, part(), cameraId),
    (error: unknown) => (error as { getStatus(): number }).getStatus() === 503,
  );
});

test('changed event ID payload retains legacy conflict code regardless of sibling row order', async () => {
  const original = part();
  const changed = { ...original, frameDimensions: { width: 1280, height: 480 } };
  await assert.rejects(
    admission.admitPartitionedFrame(
      manager([row(part(1)), row(original)]).value,
      changed,
      cameraId,
    ),
    (error: unknown) =>
      (error as { getResponse(): { code: string } }).getResponse().code === 'AI_EVENT_ID_CONFLICT',
  );
});

test('rollout defaults closed and uses explicit validated booleans', () => {
  assert.equal(createTestConfig().get('AI_PARTITIONED_FRAME_ENABLED'), false);
  assert.equal(
    createTestConfig({ AI_PARTITIONED_FRAME_ENABLED: 'true' }).get('AI_PARTITIONED_FRAME_ENABLED'),
    true,
  );
  assert.throws(() => createTestConfig({ AI_PARTITIONED_FRAME_ENABLED: 'yes' }));
});

test('ambiguous identity context is preserved and compared without mutating the raw payload', async () => {
  const prior = {
    ...part(),
    observations: [
      ...part().observations,
      { type: 'IDENTITY_CANDIDATE', trackId: 7, status: 'UNKNOWN' },
      { type: 'IDENTITY_CANDIDATE', trackId: 7, status: 'UNAVAILABLE' },
    ],
  };
  const current = { ...part(1), observations: [...prior.observations].reverse() };
  const hash = computeCanonicalPayloadHash(current);
  await admission.admitPartitionedFrame(
    manager([
      {
        eventId: prior.eventId,
        payloadHash: computeCanonicalPayloadHash(prior),
        rawPayload: prior,
      },
    ]).value,
    current,
    cameraId,
  );
  assert.equal(computeCanonicalPayloadHash(current), hash);
});

test('one source sequence cannot be relabeled with another frame ID', async () => {
  const prior = part();
  const current = {
    ...part(1),
    framePartition: { ...part(1).framePartition, frameId: '55555555-5555-4555-8555-555555555555' },
  };
  await assert.rejects(
    admission.admitPartitionedFrame(manager([row(prior)]).value, current, cameraId),
    (error: unknown) => (error as { getStatus(): number }).getStatus() === 409,
  );
});

test('enabled assessment intake without its enqueue service returns unavailable before persistence', async () => {
  let writes = 0;
  const source = {
    transaction: async () => {
      writes++;
      throw new Error('must not persist');
    },
  } as unknown as DataSource;
  const config = createTestConfig({
    AI_PARTITIONED_FRAME_ENABLED: 'true',
    MF06_ENQUEUE_ENABLED: 'true',
    MF06_ENQUEUE_MAX_OUTSTANDING: '100',
  });
  const service = new AiIngestionService(
    source,
    new ObservationContextResolverService(),
    new AlertCandidateEvaluator(),
    new DurableGroupingService(config, new SchedulingNotificationService(source)),
    config,
    () => new Date('2026-10-27T10:00:01Z'),
  );
  await assert.rejects(
    service.ingestEvent({
      ...part(),
      observations: [
        ...part().observations,
        {
          type: 'ZONE_ENTRY',
          trackId: 7,
          regionId: '66666666-6666-4666-8666-666666666666',
          geometryVersion: 1,
        },
      ],
    }),
    (error: unknown) => (error as { getStatus(): number }).getStatus() === 503,
  );
  assert.equal(writes, 0);
});

test('same frame parts cannot commit different full-frame image digests', async () => {
  const evidence = (sha256: string) => [
    { kind: 'FRAME', uri: 'local://synthetic/frame.jpg', sha256 },
  ];
  const first = { ...part(), evidence: evidence('a'.repeat(64)) };
  const second = { ...part(1), evidence: evidence('b'.repeat(64)) };
  await assert.rejects(
    admission.admitPartitionedFrame(manager([row(first)]).value, second, cameraId),
    (error: unknown) => (error as { getStatus(): number }).getStatus() === 409,
  );
});

test('one part cannot present contradictory full-frame digests', async () => {
  const payload = {
    ...part(),
    evidence: [
      { kind: 'FRAME', uri: 'local://synthetic/a.jpg', sha256: 'a'.repeat(64) },
      { kind: 'FRAME', uri: 'local://synthetic/b.jpg', sha256: 'b'.repeat(64) },
    ],
  };
  await assert.rejects(
    admission.admitPartitionedFrame(manager().value, payload, cameraId),
    (error: unknown) => (error as { getStatus(): number }).getStatus() === 409,
  );
});

test('identical frame digest can use different part-local URIs and preserve absent evidence honestly', async () => {
  const first = {
    ...part(),
    evidence: [{ kind: 'FRAME', uri: 'local://synthetic/a.jpg', sha256: 'a'.repeat(64) }],
  };
  const second = {
    ...part(1),
    evidence: [{ kind: 'FRAME', uri: 'local://synthetic/b.jpg', sha256: 'a'.repeat(64) }],
  };
  assert(await admission.admitPartitionedFrame(manager([row(first)]).value, second, cameraId));
  assert(await admission.admitPartitionedFrame(manager([row(first)]).value, part(2), cameraId));
});
