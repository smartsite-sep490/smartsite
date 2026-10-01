import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { HttpStatus } from '@nestjs/common';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { ObservationIdentityContextService } from '../src/modules/safety/identity/observation-identity-context.service.js';
import type { ObservationIdentityResolutionService } from '../src/modules/safety/identity/observation-identity-resolution.service.js';
import type { SafetyAlertEvidenceService } from '../src/modules/safety/alerts/safety-alert-evidence.service.js';
import type { ZoneAccessManagementService } from '../src/modules/zones/zone-access-management.service.js';
import type { WorkerReferenceReader } from '../src/modules/safety/identity/worker-reference.port.js';
import { identityContextResponse } from '../src/modules/safety/identity/observation-identity-response.dto.js';

function fixture(withReader = true) {
  const siteId = randomUUID(),
    alertId = randomUUID(),
    eventId = randomUUID(),
    sessionId = randomUUID(),
    cameraId = randomUUID();
  const box = { x1: 0.1, y1: 0.1, x2: 0.8, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' };
  const raw = {
    eventId,
    schemaVersion: '1.0.0',
    cameraExternalId: 'SYNTHETIC',
    streamSessionId: sessionId,
    capturedAt: '2026-10-01T00:00:00Z',
    frameDimensions: { width: 100, height: 100 },
    observations: [
      { type: 'PERSON', trackId: 7, boundingBox: box },
      { type: 'PERSON', trackId: 8, boundingBox: box },
    ],
    evidence: [{ kind: 'FRAME', uri: `local://evidence/${sessionId}/1/${eventId}.jpg` }],
  };
  const state = {
    event: {
      eventId,
      payloadHash: computeCanonicalPayloadHash(raw),
      rawPayload: raw as unknown,
      cameraExternalId: raw.cameraExternalId,
      streamSessionId: sessionId,
      capturedAt: new Date(raw.capturedAt),
      resolvedCameraId: cameraId,
    },
    heads: [] as { head: Record<string, unknown>; decision: Record<string, unknown> | null }[],
  };
  let mediaAvailable = true;
  const zoneCalls: unknown[][] = [];
  const zones = {
    async listObservationDecisions(...args: unknown[]) {
      zoneCalls.push(args);
      return { items: [], total: 0 };
    },
  };
  const evidence = {
    summarize() {
      return [{ index: 0, kind: 'FRAME', available: true }];
    },
    async readFrameForIdentityReview() {
      if (!mediaAvailable)
        throw new PublicHttpException(HttpStatus.NOT_FOUND, {
          code: 'NOT_FOUND',
          message: 'Synthetic missing media',
        });
      return {
        bytes: Buffer.from('synthetic'),
        fileName: 'not-exposed.jpg',
        sha256: 'f'.repeat(64),
      };
    },
  };
  const records = {
    async readContextRecords() {
      return state;
    },
  };
  const reader = {
    async findForReview() {
      return null;
    },
    async listForReview() {
      return { items: [], total: 0 };
    },
  };
  const service = new ObservationIdentityContextService(
    records as unknown as ObservationIdentityResolutionService,
    evidence as unknown as SafetyAlertEvidenceService,
    zones as unknown as ZoneAccessManagementService,
    withReader ? (reader as WorkerReferenceReader) : undefined,
  );
  const manual = (action: 'RESOLVE' | 'CLEAR' = 'RESOLVE') => {
    const headId = randomUUID();
    const decision = {
      id: randomUUID(),
      resolutionId: headId,
      siteId,
      revision: 2,
      workerId: action === 'RESOLVE' ? randomUUID() : null,
      actorUserId: randomUUID(),
      action,
      reason: 'Synthetic reviewed person.',
      verificationMethod: 'MANUAL',
      scope: 'EXACT_OBSERVATION',
      recordedAt: new Date(raw.capturedAt),
    };
    const ref = {
      eventId,
      personObservationIndex: 0,
      payloadHash: state.event.payloadHash,
      cameraId,
      cameraExternalId: raw.cameraExternalId,
      streamSessionId: sessionId,
      capturedAt: raw.capturedAt,
      trackId: 7,
      personBoundingBox: box,
    };
    state.heads = [
      {
        head: {
          id: headId,
          eventId,
          personObservationIndex: 0,
          siteId,
          payloadHash: state.event.payloadHash,
          subjectRef: ref,
          revision: 2,
          currentDecisionId: decision.id,
        },
        decision,
      },
    ];
    return decision;
  };
  return {
    service,
    siteId,
    alertId,
    eventId,
    raw,
    state,
    manual,
    zoneCalls,
    setMediaAvailable(v: boolean) {
      mediaAvailable = v;
    },
    get() {
      return service.get(siteId, alertId, eventId);
    },
  };
}

test('identity Worker picker scopes the observation before reading and projects only Worker reference fields', async () => {
  const siteId = randomUUID(),
    alertId = randomUUID(),
    eventId = randomUUID(),
    workerId = randomUUID();
  let calls = 0,
    scoped = false;
  const records = {
    async readContextRecords() {
      scoped = true;
      throw new PublicHttpException(HttpStatus.NOT_FOUND, {
        code: 'NOT_FOUND',
        message: 'Synthetic inaccessible observation',
      });
    },
  };
  const reader = {
    async listForReview() {
      calls++;
      assert.ok(scoped);
      return {
        items: [
          {
            id: workerId,
            siteId,
            externalId: 'W-1',
            displayName: 'Synthetic',
            isActive: false,
            embedding: 'private',
          },
        ],
        total: 1,
      };
    },
  };
  const service = new ObservationIdentityContextService(
    records as unknown as ObservationIdentityResolutionService,
    {} as SafetyAlertEvidenceService,
    {} as ZoneAccessManagementService,
    reader as unknown as WorkerReferenceReader,
  );
  await assert.rejects(
    () => service.listWorkers(siteId, alertId, eventId),
    (e) => e instanceof PublicHttpException && e.getStatus() === 404,
  );
  assert.equal(calls, 0);
  records.readContextRecords = async () => {
    scoped = true;
    return {} as never;
  };
  assert.deepEqual(await service.listWorkers(siteId, alertId, eventId), {
    items: [{ id: workerId, siteId, externalId: 'W-1', displayName: 'Synthetic', isActive: false }],
    total: 1,
  });
  reader.listForReview = async () => ({
    items: [
      {
        id: workerId,
        siteId: randomUUID(),
        externalId: 'W-1',
        displayName: 'Synthetic',
        isActive: false,
        embedding: 'private',
      },
    ],
    total: 1,
  });
  await assert.rejects(
    () => service.listWorkers(siteId, alertId, eventId),
    (e) => e instanceof PublicHttpException && e.getStatus() === 503,
  );
  const unavailable = new ObservationIdentityContextService(
    records as unknown as ObservationIdentityResolutionService,
    {} as SafetyAlertEvidenceService,
    {} as ZoneAccessManagementService,
  );
  await assert.rejects(
    () => unavailable.listWorkers(siteId, alertId, eventId),
    (e) => e instanceof PublicHttpException && e.getStatus() === 503,
  );
});

test('context returns both PERSONs without selecting a default Worker or leaking raw media fields', async () => {
  const f = fixture();
  const context = await f.get();
  assert.deepEqual(
    context.subjects.map((s) => s.personObservationIndex),
    [0, 1],
  );
  assert.ok(
    context.subjects.every(
      (s) => s.canResolve && !s.canClear && s.latestManualDecision === null && s.revision === 0,
    ),
  );
  assert.equal(context.frames[0]?.sha256, 'f'.repeat(64));
  for (const secret of ['local://', 'not-exposed.jpg', 'rawPayload', 'bytes'])
    assert.ok(!JSON.stringify(context).includes(secret));
});

test('context keeps conflicting technical candidates separate from exact manual Worker', async () => {
  const f = fixture();
  const decision = f.manual();
  f.raw.observations.push(
    ...(['CANDIDATE-A', 'CANDIDATE-B'].map((candidateWorkerId) => ({
      type: 'IDENTITY_CANDIDATE',
      trackId: 7,
      status: 'CANDIDATE',
      candidateWorkerId,
      similarityScore: 0.8,
    })) as unknown as typeof f.raw.observations),
  );
  f.state.event.payloadHash = computeCanonicalPayloadHash(f.raw);
  // Fixture head must bind the same immutable event as its decision.
  f.state.heads[0]!.head.payloadHash = f.state.event.payloadHash;
  (f.state.heads[0]!.head.subjectRef as { payloadHash: string }).payloadHash =
    f.state.event.payloadHash;
  const context = await f.get();
  const person = context.subjects[0]!;
  assert.equal(person.technicalIdentity.status, 'CONFLICTED');
  assert.deepEqual(
    person.technicalIdentity.candidates.map((c) => c.candidateWorkerId),
    ['CANDIDATE-A', 'CANDIDATE-B'],
  );
  assert.equal(person.latestManualDecision?.workerId, decision.workerId);
  assert.equal(context.subjects[1]?.latestManualDecision, null);
});

test('missing frame blocks RESOLVE but active recorded resolution still allows CLEAR', async () => {
  const f = fixture();
  f.manual();
  f.setMediaAvailable(false);
  const context = await f.get();
  assert.equal(context.subjects[0]?.canResolve, false);
  assert.equal(context.subjects[0]?.canClear, true);
  assert.equal(context.frames[0]?.sha256, null);
});

test('corrupt raw payload retains persisted subject and CLEAR without inventing technical identity', async () => {
  const f = fixture();
  f.manual();
  f.state.event.rawPayload = { corrupt: true };
  const context = await f.get();
  assert.equal(context.subjects.length, 1);
  assert.equal(context.subjects[0]?.subjectRefSource, 'PERSISTED_REVIEW');
  assert.equal(context.subjects[0]?.canClear, true);
  assert.equal(context.subjects[0]?.canResolve, false);
  assert.equal(context.subjects[0]?.technicalIdentity.status, 'UNAVAILABLE');
});

test('unavailable Worker reader and already CLEAR are separate disabled capabilities', async () => {
  const f = fixture(false);
  f.manual('CLEAR');
  const context = await f.get();
  assert.equal(context.subjects[0]?.resolveBlockReason, 'WORKER_READER_UNAVAILABLE');
  assert.equal(context.subjects[0]?.canClear, false);
  assert.equal(context.subjects[0]?.latestManualDecision?.action, 'CLEAR');
});

test('original Zone decisions are read by exact Site/event/track without inferring policy outcomes', async () => {
  const f = fixture();
  const context = await f.get();
  assert.deepEqual(f.zoneCalls, [
    [f.siteId, f.eventId, 7, 0, 100],
    [f.siteId, f.eventId, 8, 0, 100],
  ]);
  assert.deepEqual(context.subjects[0]?.originalZoneDecisions, { items: [], total: 0 });
});

test('inconsistent persisted head disables both review capabilities and does not project a trusted decision', async () => {
  const f = fixture();
  f.manual();
  (f.state.heads[0]!.head.subjectRef as { payloadHash: string }).payloadHash = 'a'.repeat(64);
  const person = (await f.get()).subjects[0]!;
  assert.equal(person.canResolve, false);
  assert.equal(person.resolveBlockReason, 'STATE_INCONSISTENT');
  assert.equal(person.canClear, false);
  assert.equal(person.latestManualDecision, null);
});

test('context preserves raw indices and blocks duplicate PERSON tracks without replacing boxes', async () => {
  const f = fixture();
  f.raw.observations.unshift({
    type: 'ZONE_ENTRY',
    trackId: 9,
    regionId: randomUUID(),
    geometryVersion: 1,
  } as unknown as (typeof f.raw.observations)[number]);
  f.raw.observations[2]!.trackId = 7;
  f.state.event.payloadHash = computeCanonicalPayloadHash(f.raw);
  const context = await f.get();
  assert.deepEqual(
    context.subjects.map((s) => s.personObservationIndex),
    [1, 2],
  );
  assert.ok(
    context.subjects.every(
      (s) => !s.canResolve && s.subjectRef === null && s.technicalIdentity.status === 'UNAVAILABLE',
    ),
  );
  assert.deepEqual(f.zoneCalls, []);
});

test('corrupt raw and inconsistent persisted ref project an unavailable subject without foreign attribution or a wire failure', async () => {
  const f = fixture();
  f.manual();
  f.state.event.rawPayload = { corrupt: true };
  (f.state.heads[0]!.head.subjectRef as { payloadHash: string }).payloadHash = 'a'.repeat(64);
  const context = await f.get(),
    subject = context.subjects[0]!;
  assert.equal(subject.subjectRef, null);
  assert.equal(subject.trackId, null);
  assert.equal(subject.latestManualDecision, null);
  assert.equal(subject.resolveBlockReason, 'STATE_INCONSISTENT');
  assert.equal(subject.clearBlockReason, 'STATE_INCONSISTENT');
  assert.deepEqual(f.zoneCalls, []);
  assert.doesNotThrow(() => identityContextResponse(context));
});

test('persisted review must match the original PERSON reference and immutable event headers', async () => {
  for (const change of [
    (ref: Record<string, unknown>) => {
      ref.trackId = 8;
    },
    (ref: Record<string, unknown>) => {
      ref.cameraId = randomUUID();
    },
    (ref: Record<string, unknown>) => {
      ref.streamSessionId = randomUUID();
    },
    (ref: Record<string, unknown>) => {
      ref.cameraExternalId = 'OTHER-CAMERA';
    },
    (ref: Record<string, unknown>) => {
      ref.capturedAt = '2026-10-02T00:00:00Z';
    },
    (ref: Record<string, unknown>) => {
      ref.personBoundingBox = {
        x1: 0.2,
        y1: 0.1,
        x2: 0.8,
        y2: 0.9,
        coordinateSpace: 'NORMALIZED_0_1',
      };
    },
  ]) {
    const f = fixture();
    f.manual();
    change(f.state.heads[0]!.head.subjectRef as Record<string, unknown>);
    const subject = (await f.get()).subjects[0]!;
    assert.equal(subject.latestManualDecision, null);
    assert.equal(subject.resolveBlockReason, 'STATE_INCONSISTENT');
    assert.equal(subject.canClear, false);
  }
});

test('persisted UUID casing does not invalidate the same event/camera/session subject', async () => {
  const f = fixture();
  f.manual();
  const ref = f.state.heads[0]!.head.subjectRef as Record<string, string>;
  for (const field of ['eventId', 'cameraId', 'streamSessionId'])
    ref[field] = ref[field]!.toUpperCase();
  const subject = (await f.get()).subjects[0]!;
  assert.equal(subject.canResolve, true);
  assert.equal(subject.canClear, true);
  assert.notEqual(subject.latestManualDecision, null);
});

test('historical review remains clearable when Camera deletion nulls the event FK', async () => {
  const f = fixture();
  f.manual();
  (f.state.event as { resolvedCameraId: string | null }).resolvedCameraId = null;
  const subject = (await f.get()).subjects[0]!;
  assert.equal(subject.canResolve, false);
  assert.equal(subject.canClear, true);
  assert.notEqual(subject.latestManualDecision, null);
  assert.equal(subject.subjectRefSource, 'PERSISTED_REVIEW');
});

test('persisted subject refs project only known fields and never leak additional stored metadata', async () => {
  const f = fixture();
  f.manual();
  f.state.event.rawPayload = { corrupt: true };
  const ref = f.state.heads[0]!.head.subjectRef as Record<string, unknown>;
  ref.internalPath = 'private-camera-path';
  ref.embedding = 'private-embedding';
  const box = ref.personBoundingBox as Record<string, unknown>;
  box.internalUri = 'private-evidence-uri';
  const context = await f.get();
  const json = JSON.stringify(context);
  for (const privateField of ['private-camera-path', 'private-embedding', 'private-evidence-uri'])
    assert.equal(json.includes(privateField), false);
  assert.equal(context.subjects[0]?.canClear, true);
});

test('penultimate revision permits the final valid command; maximum revision disables both capabilities', async () => {
  const f = fixture();
  f.manual();
  f.state.heads[0]!.head.revision = 2147483646;
  f.state.heads[0]!.decision!.revision = 2147483646;
  const penultimate = (await f.get()).subjects[0]!;
  assert.equal(penultimate.canResolve, true);
  assert.equal(penultimate.canClear, true);
  f.state.heads[0]!.head.revision = 2147483647;
  f.state.heads[0]!.decision!.revision = 2147483647;
  const maximum = (await f.get()).subjects[0]!;
  assert.equal(maximum.resolveBlockReason, 'REVISION_EXHAUSTED');
  assert.equal(maximum.clearBlockReason, 'REVISION_EXHAUSTED');
});
