import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { EntityManager } from 'typeorm';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { ZoneEntryAssessmentRequestEntity } from '../src/database/entities/zone-entry-assessment-request.entity.js';
import { AiObservationEventEntity } from '../src/database/entities/ai-observation-event.entity.js';
import { EventProcessingStatus } from '../src/database/entities/enums.js';
import {
  inspectMf06StoredBinding,
  type Mf06StoredBindingInspection,
} from '../src/modules/safety/assessments/mf06-request-context.js';
import {
  bindMf06FaceInvocation,
  type Mf06FaceBinding,
} from '../src/modules/safety/assessments/mf06-face-binding.js';
import type { SafetySubjectCrop } from '../src/modules/safety/identity/safety-subject-cropper.js';
import {
  Mf06CandidateMetadataService,
  type Mf06CandidateProfileReader,
} from '../src/modules/safety/assessments/mf06-candidate-metadata.service.js';
import type {
  SafetyFaceProfileLookup,
  SafetyFaceProfileReference,
} from '../src/modules/workforce/safety-face-profile.reader.js';

// -----------------------------------------------------------------------------
// Fixture Construction & Fake Collaborators
// -----------------------------------------------------------------------------

interface SyntheticFixture {
  siteId: string;
  requestId: string;
  eventId: string;
  cameraId: string;
  streamSessionId: string;
  regionId: string;
  zoneId: string;
  workerId: string;
  profileId: string;
  profileRevision: string;
  consentId: string;
  invocationId: string;
  modelVersion: string;
  request: ZoneEntryAssessmentRequestEntity;
  event: AiObservationEventEntity;
  stored: Extract<Mf06StoredBindingInspection, { status: 'MATCHED' }>;
  crop: SafetySubjectCrop;
  prepared: Extract<Mf06FaceBinding, { state: 'BOUND_UNATTESTED' }>;
  response: Record<string, unknown>;
  profileLookup: Extract<SafetyFaceProfileLookup, { state: 'ELIGIBLE_METADATA' }>;
}

function createSyntheticFixture(
  channel: 'SYNTHETIC_TEST' | 'TRUSTED_SERVICE' = 'SYNTHETIC_TEST',
): SyntheticFixture {
  const siteId = randomUUID(),
    requestId = randomUUID(),
    eventId = randomUUID(),
    cameraId = randomUUID(),
    streamSessionId = randomUUID(),
    regionId = randomUUID(),
    zoneId = randomUUID(),
    workerId = randomUUID(),
    profileId = randomUUID(),
    profileRevision = randomUUID(),
    consentId = randomUUID(),
    invocationId = randomUUID(),
    modelVersion = 'synthetic-v1';

  const box = { x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' as const };
  const rawPayload = {
    schemaVersion: '1.0.0',
    eventId,
    cameraExternalId: 'CAM-SYNTHETIC-01',
    streamSessionId,
    capturedAt: '2026-10-12T00:00:00.000Z',
    frameDimensions: { width: 1280, height: 720 },
    observations: [
      { type: 'PERSON', trackId: 10, boundingBox: box },
      { type: 'ZONE_ENTRY', trackId: 10, regionId, geometryVersion: 1 },
    ],
    evidence: [{ kind: 'FRAME', uri: `local://evidence/${streamSessionId}/1/${eventId}.jpg` }],
  };
  const payloadHash = computeCanonicalPayloadHash(rawPayload);

  const event = {
    eventId,
    payloadHash,
    cameraExternalId: 'CAM-SYNTHETIC-01',
    resolvedCameraId: cameraId,
    streamSessionId,
    capturedAt: new Date(rawPayload.capturedAt),
    rawPayload,
    processingStatus: EventProcessingStatus.PROCESSED,
  } as AiObservationEventEntity;

  const request = {
    requestId,
    eventId,
    payloadHash,
    personObservationIndex: 0,
    zoneObservationIndex: 1,
    subjectBindingStatus: 'BOUND',
    trackId: 10,
    siteId,
    cameraId,
    cameraExternalId: 'CAM-SYNTHETIC-01',
    streamSessionId,
    regionId,
    geometryVersion: 1,
    zoneId,
    capturedAt: new Date(rawPayload.capturedAt),
    requestedPurpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    requestRevision: 1,
    bindingHash: 'b'.repeat(64),
    requestedAt: new Date('2026-10-12T00:00:01.000Z'),
  } as ZoneEntryAssessmentRequestEntity;

  const storedInspection = inspectMf06StoredBinding(request, event);
  assert.equal(storedInspection.status, 'MATCHED');
  const stored = storedInspection as Extract<Mf06StoredBindingInspection, { status: 'MATCHED' }>;

  const cropBytes = Buffer.from('synthetic-crop-jpeg-bytes-content-for-test-bounded-444');
  const crop: SafetySubjectCrop = {
    bytes: cropBytes,
    cropSha256: createHash('sha256').update(cropBytes).digest('hex'),
    frameSha256: 'f'.repeat(64),
    subject: stored.subject!,
    rectangle: { left: 10, top: 10, width: 50, height: 80 },
    cropAlgorithmVersion: 'PERSON_FLOOR_CEIL_JPEG95_444_V1',
  };

  const boundResult = bindMf06FaceInvocation(stored, crop, invocationId, modelVersion);
  assert.equal(boundResult.state, 'BOUND_UNATTESTED');
  const prepared = boundResult as Extract<Mf06FaceBinding, { state: 'BOUND_UNATTESTED' }>;

  const profileReferenceHash = 'e'.repeat(64);
  const response = {
    ...prepared.invocation,
    state: 'CANDIDATE' as const,
    provenance: channel,
    profileReferenceHash,
    profileRevision,
  };

  const profileLookup: Extract<SafetyFaceProfileLookup, { state: 'ELIGIBLE_METADATA' }> = {
    state: 'ELIGIBLE_METADATA',
    workerId,
    siteId,
    profileId,
    profileRevision,
    consentId,
  };

  return {
    siteId,
    requestId,
    eventId,
    cameraId,
    streamSessionId,
    regionId,
    zoneId,
    workerId,
    profileId,
    profileRevision,
    consentId,
    invocationId,
    modelVersion,
    request,
    event,
    stored,
    crop,
    prepared,
    response,
    profileLookup,
  };
}

interface FakeManagerOptions {
  isTransactionActive?: boolean;
  isolationLevel?: string;
  request?: ZoneEntryAssessmentRequestEntity | null;
  event?: AiObservationEventEntity | null;
  queryError?: Error;
  repositoryError?: Error;
}

function createFakeManager(options: FakeManagerOptions = {}): EntityManager {
  const {
    isTransactionActive = true,
    isolationLevel = 'serializable',
    request,
    event,
    queryError,
    repositoryError,
  } = options;

  return {
    queryRunner: {
      isTransactionActive,
    },
    query: async (sql: string) => {
      if (queryError) throw queryError;
      if (/transaction_isolation/i.test(sql)) {
        return [{ transaction_isolation: isolationLevel }];
      }
      if (/mf06_assessment_request/i.test(sql)) {
        return request ? [request] : [];
      }
      if (/ai_observation_event/i.test(sql)) {
        return event ? [event] : [];
      }
      return [];
    },
    getRepository: (entity: unknown) => {
      if (repositoryError) throw repositoryError;
      return {
        findOneBy: async (criteria: Record<string, unknown>) => {
          if (repositoryError) throw repositoryError;
          if (entity === ZoneEntryAssessmentRequestEntity) {
            if (!request) return null;
            if (criteria.requestId && criteria.requestId !== request.requestId.toLowerCase())
              return null;
            if (criteria.siteId && criteria.siteId !== request.siteId.toLowerCase()) return null;
            return request;
          }
          if (entity === AiObservationEventEntity) {
            if (!event) return null;
            if (criteria.eventId && criteria.eventId !== event.eventId.toLowerCase()) return null;
            return event;
          }
          return null;
        },
        findOne: async () => {
          if (repositoryError) throw repositoryError;
          if (entity === ZoneEntryAssessmentRequestEntity) return request ?? null;
          if (entity === AiObservationEventEntity) return event ?? null;
          return null;
        },
      };
    },
    findOneBy: async (entity: unknown) => {
      if (repositoryError) throw repositoryError;
      if (entity === ZoneEntryAssessmentRequestEntity) return request ?? null;
      if (entity === AiObservationEventEntity) return event ?? null;
      return null;
    },
    findOne: async (entity: unknown) => {
      if (repositoryError) throw repositoryError;
      if (entity === ZoneEntryAssessmentRequestEntity) return request ?? null;
      if (entity === AiObservationEventEntity) return event ?? null;
      return null;
    },
  } as unknown as EntityManager;
}

function createFakeProfileReader(
  lookupResult: SafetyFaceProfileLookup = { state: 'UNAVAILABLE' },
  onLookup?: (
    manager: EntityManager,
    siteId: string,
    reference: SafetyFaceProfileReference,
    lockForFinalization: boolean,
  ) => void,
): Mf06CandidateProfileReader {
  return {
    findCurrentForSafety: async (manager, siteId, reference, lockForFinalization) => {
      onLookup?.(manager, siteId, reference, lockForFinalization);
      return lookupResult;
    },
  };
}

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test('candidate snapshots reject prepared/crop/subject accessors before SQL without invoking them', async () => {
  for (const target of ['prepared', 'crop', 'subject'] as const) {
    const f = createSyntheticFixture('SYNTHETIC_TEST');
    f.crop.subject = { ...f.crop.subject };
    let hooks = 0,
      queries = 0;
    const object = target === 'prepared' ? f.prepared : target === 'crop' ? f.crop : f.crop.subject;
    const key = target === 'prepared' ? 'state' : target === 'crop' ? 'bytes' : 'eventId';
    Object.defineProperty(object, key, {
      enumerable: true,
      get() {
        hooks++;
        throw Error('Caller hook');
      },
    });
    const manager = {
      queryRunner: { isTransactionActive: true },
      query: async () => {
        queries++;
        throw Error('No query');
      },
    } as unknown as EntityManager;
    const service = new Mf06CandidateMetadataService(createFakeProfileReader(), 'SYNTHETIC_TEST');
    assert.deepEqual(
      await service.revalidate(manager, f.siteId, f.requestId, f.prepared, f.crop, f.response),
      { state: 'UNAVAILABLE', reason: 'INVALID_BINDING' },
    );
    assert.equal(hooks, 0);
    assert.equal(queries, 0);
  }
});

// -----------------------------------------------------------------------------
// Test Suite: Mf06CandidateMetadataService
// -----------------------------------------------------------------------------

test('1. default DISABLED channel returns SERVICE_DISABLED without performing database or profile lookup', async () => {
  const f = createSyntheticFixture();
  let profileCalls = 0;
  let dbQueries = 0;

  const mockProfiles: Mf06CandidateProfileReader = {
    findCurrentForSafety: async () => {
      profileCalls++;
      return f.profileLookup;
    },
  };

  const manager = {
    queryRunner: { isTransactionActive: true },
    query: async () => {
      dbQueries++;
      return [{ transaction_isolation: 'serializable' }];
    },
    getRepository: () => {
      dbQueries++;
      return { findOneBy: async () => f.request };
    },
  } as unknown as EntityManager;

  const service = new Mf06CandidateMetadataService(mockProfiles);
  const result = await service.revalidate(
    manager,
    f.siteId,
    f.requestId,
    f.prepared,
    f.crop,
    f.response,
  );

  assert.deepEqual(result, { state: 'UNAVAILABLE', reason: 'SERVICE_DISABLED' });
  assert.equal(profileCalls, 0);
  assert.equal(dbQueries, 0);
});

test('2. positive synthetic test returns ELIGIBLE_PROFILE_METADATA with non-established identity and authority', async () => {
  const f = createSyntheticFixture('SYNTHETIC_TEST');
  const manager = createFakeManager({ request: f.request, event: f.event });
  const mockProfiles = createFakeProfileReader(f.profileLookup);
  const service = new Mf06CandidateMetadataService(mockProfiles, 'SYNTHETIC_TEST');

  const result = await service.revalidate(
    manager,
    f.siteId,
    f.requestId,
    f.prepared,
    f.crop,
    f.response,
  );

  assert.deepEqual(result, {
    state: 'ELIGIBLE_PROFILE_METADATA',
    provenance: 'SYNTHETIC_TEST',
    siteId: f.siteId,
    requestId: f.requestId,
    bindingDigest: f.prepared.invocation.bindingDigest,
    contextDigest: f.stored.contextDigest,
    workerId: f.profileLookup.workerId,
    profileId: f.profileLookup.profileId,
    profileRevision: f.profileLookup.profileRevision,
    consentId: f.profileLookup.consentId,
    identityEstablished: false,
    authorityEstablished: false,
  });
});

test('3. positive trusted service channel produces ELIGIBLE_PROFILE_METADATA with TRUSTED_SERVICE provenance', async () => {
  const f = createSyntheticFixture('TRUSTED_SERVICE');
  const manager = createFakeManager({ request: f.request, event: f.event });
  const mockProfiles = createFakeProfileReader(f.profileLookup);
  const service = new Mf06CandidateMetadataService(mockProfiles, 'TRUSTED_SERVICE');

  const result = await service.revalidate(
    manager,
    f.siteId,
    f.requestId,
    f.prepared,
    f.crop,
    f.response,
  );

  assert.deepEqual(result, {
    state: 'ELIGIBLE_PROFILE_METADATA',
    provenance: 'TRUSTED_SERVICE',
    siteId: f.siteId,
    requestId: f.requestId,
    bindingDigest: f.prepared.invocation.bindingDigest,
    contextDigest: f.stored.contextDigest,
    workerId: f.profileLookup.workerId,
    profileId: f.profileLookup.profileId,
    profileRevision: f.profileLookup.profileRevision,
    consentId: f.profileLookup.consentId,
    identityEstablished: false,
    authorityEstablished: false,
  });
});

test('4. transaction requirements enforce active transaction and serializable isolation level', async () => {
  const f = createSyntheticFixture();
  const mockProfiles = createFakeProfileReader(f.profileLookup);
  const service = new Mf06CandidateMetadataService(mockProfiles, 'SYNTHETIC_TEST');

  const invalidTransactionCases: { name: string; options: FakeManagerOptions }[] = [
    {
      name: 'inactive transaction',
      options: { isTransactionActive: false, request: f.request, event: f.event },
    },
    {
      name: 'read committed isolation',
      options: { isolationLevel: 'read committed', request: f.request, event: f.event },
    },
    {
      name: 'repeatable read isolation',
      options: { isolationLevel: 'repeatable read', request: f.request, event: f.event },
    },
  ];

  for (const { name, options } of invalidTransactionCases) {
    const manager = createFakeManager(options);
    const result = await service.revalidate(
      manager,
      f.siteId,
      f.requestId,
      f.prepared,
      f.crop,
      f.response,
    );
    assert.deepEqual(
      result,
      { state: 'UNAVAILABLE', reason: 'TRANSACTION_REQUIRED' },
      `failed for ${name}`,
    );
  }
});

test('5. missing assessment request or mismatched site and request IDs return INVALID_BINDING', async () => {
  const f = createSyntheticFixture();
  const mockProfiles = createFakeProfileReader(f.profileLookup);
  const service = new Mf06CandidateMetadataService(mockProfiles, 'SYNTHETIC_TEST');

  const invalidBindingCases: {
    name: string;
    siteId: string;
    requestId: string;
    request: ZoneEntryAssessmentRequestEntity | null;
  }[] = [
    { name: 'request not found in DB', siteId: f.siteId, requestId: f.requestId, request: null },
    {
      name: 'siteId mismatch against parameter',
      siteId: randomUUID(),
      requestId: f.requestId,
      request: f.request,
    },
    {
      name: 'requestId mismatch against parameter',
      siteId: f.siteId,
      requestId: randomUUID(),
      request: f.request,
    },
  ];

  for (const { name, siteId, requestId, request } of invalidBindingCases) {
    const manager = createFakeManager({ request, event: f.event });
    const result = await service.revalidate(
      manager,
      siteId,
      requestId,
      f.prepared,
      f.crop,
      f.response,
    );
    assert.deepEqual(
      result,
      { state: 'UNAVAILABLE', reason: 'INVALID_BINDING' },
      `failed for ${name}`,
    );
  }
});

test('6. missing or inconsistent observation event state invalidates stored binding with INVALID_BINDING', async () => {
  const f = createSyntheticFixture();
  const mockProfiles = createFakeProfileReader(f.profileLookup);
  const service = new Mf06CandidateMetadataService(mockProfiles, 'SYNTHETIC_TEST');

  const invalidEventCases: { name: string; event: AiObservationEventEntity | null }[] = [
    { name: 'event not found in DB', event: null },
    {
      name: 'payloadHash mismatch',
      event: { ...f.event, payloadHash: '0'.repeat(64) } as AiObservationEventEntity,
    },
    {
      name: 'capturedAt mismatch',
      event: {
        ...f.event,
        capturedAt: new Date('2026-10-12T00:05:00.000Z'),
      } as AiObservationEventEntity,
    },
    {
      name: 'processingStatus clock-skew skipped',
      event: {
        ...f.event,
        processingStatus: EventProcessingStatus.SKIPPED_CLOCK_SKEW,
      } as AiObservationEventEntity,
    },
  ];

  for (const { name, event } of invalidEventCases) {
    const manager = createFakeManager({ request: f.request, event });
    const result = await service.revalidate(
      manager,
      f.siteId,
      f.requestId,
      f.prepared,
      f.crop,
      f.response,
    );
    assert.deepEqual(
      result,
      { state: 'UNAVAILABLE', reason: 'INVALID_BINDING' },
      `failed for ${name}`,
    );
  }
});

test('7. tampered crop bytes or mismatched media metadata fail recomputed binding with INVALID_BINDING', async () => {
  const f = createSyntheticFixture();
  const manager = createFakeManager({ request: f.request, event: f.event });
  const mockProfiles = createFakeProfileReader(f.profileLookup);
  const service = new Mf06CandidateMetadataService(mockProfiles, 'SYNTHETIC_TEST');

  const tamperedCropCases: { name: string; crop: SafetySubjectCrop }[] = [
    {
      name: 'tampered crop bytes differing from digest',
      crop: { ...f.crop, bytes: Buffer.from('forged-different-crop-bytes-content') },
    },
    {
      name: 'mismatched frame digest',
      crop: { ...f.crop, frameSha256: '9'.repeat(64) },
    },
    {
      name: 'unsupported crop algorithm version',
      crop: {
        ...f.crop,
        cropAlgorithmVersion:
          'UNSUPPORTED_ALGO' as unknown as SafetySubjectCrop['cropAlgorithmVersion'],
      },
    },
    {
      name: 'subject divergence with different trackId',
      crop: { ...f.crop, subject: { ...f.crop.subject, trackId: 999 } },
    },
  ];

  for (const { name, crop } of tamperedCropCases) {
    const result = await service.revalidate(
      manager,
      f.siteId,
      f.requestId,
      f.prepared,
      crop,
      f.response,
    );
    assert.deepEqual(
      result,
      { state: 'UNAVAILABLE', reason: 'INVALID_BINDING' },
      `failed for ${name}`,
    );
  }
});

test('8. prepared binding divergence or invocation tampering fails recomputed equality with INVALID_BINDING', async () => {
  const f = createSyntheticFixture();
  const manager = createFakeManager({ request: f.request, event: f.event });
  const mockProfiles = createFakeProfileReader(f.profileLookup);
  const service = new Mf06CandidateMetadataService(mockProfiles, 'SYNTHETIC_TEST');

  const tamperedBindingCases: { name: string; prepared: Mf06FaceBinding }[] = [
    {
      name: 'unavailable binding state',
      prepared: { state: 'UNAVAILABLE', reason: 'INVALID_BINDING' },
    },
    {
      name: 'tampered bindingDigest in prepared invocation',
      prepared: {
        state: 'BOUND_UNATTESTED',
        invocation: { ...f.prepared.invocation, bindingDigest: 'a'.repeat(64) },
      },
    },
    {
      name: 'divergent trackId in prepared invocation',
      prepared: {
        state: 'BOUND_UNATTESTED',
        invocation: { ...f.prepared.invocation, trackId: 777 },
      },
    },
    {
      name: 'divergent requestRevision in prepared invocation',
      prepared: {
        state: 'BOUND_UNATTESTED',
        invocation: { ...f.prepared.invocation, requestRevision: 99 },
      },
    },
    {
      name: 'divergent invocationId in prepared invocation',
      prepared: {
        state: 'BOUND_UNATTESTED',
        invocation: { ...f.prepared.invocation, invocationId: randomUUID() },
      },
    },
  ];

  for (const { name, prepared } of tamperedBindingCases) {
    const result = await service.revalidate(
      manager,
      f.siteId,
      f.requestId,
      prepared,
      f.crop,
      f.response,
    );
    assert.deepEqual(
      result,
      { state: 'UNAVAILABLE', reason: 'INVALID_BINDING' },
      `failed for ${name}`,
    );
  }
});

test('9. forged worker field or invalid response schema rejected with INVALID_RESPONSE', async () => {
  const f = createSyntheticFixture('SYNTHETIC_TEST');
  const manager = createFakeManager({ request: f.request, event: f.event });
  const mockProfiles = createFakeProfileReader(f.profileLookup);
  const service = new Mf06CandidateMetadataService(mockProfiles, 'SYNTHETIC_TEST');

  const invalidResponseCases: { name: string; response: unknown }[] = [
    {
      name: 'forged workerId field inside response',
      response: { ...f.response, workerId: f.workerId },
    },
    {
      name: 'provenance mismatch between channel and response',
      response: { ...f.response, provenance: 'TRUSTED_SERVICE' },
    },
    {
      name: 'forbidden candidate state',
      response: { ...f.response, state: 'VERIFIED' },
    },
    {
      name: 'missing profileReferenceHash',
      response: { ...f.response, profileReferenceHash: undefined },
    },
    {
      name: 'non-object response',
      response: 'INVALID_WIRE_PAYLOAD',
    },
  ];

  for (const { name, response } of invalidResponseCases) {
    const result = await service.revalidate(
      manager,
      f.siteId,
      f.requestId,
      f.prepared,
      f.crop,
      response,
    );
    assert.deepEqual(
      result,
      { state: 'UNAVAILABLE', reason: 'INVALID_RESPONSE' },
      `failed for ${name}`,
    );
  }
});

test('10. response correlation mismatch against invocation fields returns CORRELATION_MISMATCH', async () => {
  const f = createSyntheticFixture('SYNTHETIC_TEST');
  const manager = createFakeManager({ request: f.request, event: f.event });
  const mockProfiles = createFakeProfileReader(f.profileLookup);
  const service = new Mf06CandidateMetadataService(mockProfiles, 'SYNTHETIC_TEST');

  const correlationMismatchCases: { name: string; key: string; value: unknown }[] = [
    { name: 'mismatched requestId', key: 'requestId', value: randomUUID() },
    { name: 'mismatched eventId', key: 'eventId', value: randomUUID() },
    { name: 'mismatched bindingDigest', key: 'bindingDigest', value: '0'.repeat(64) },
    { name: 'mismatched siteId', key: 'siteId', value: randomUUID() },
    { name: 'mismatched cameraId', key: 'cameraId', value: randomUUID() },
    { name: 'mismatched trackId', key: 'trackId', value: 999 },
    { name: 'mismatched regionId', key: 'regionId', value: randomUUID() },
  ];

  for (const { name, key, value } of correlationMismatchCases) {
    const modifiedResponse = { ...f.response, [key]: value };
    const result = await service.revalidate(
      manager,
      f.siteId,
      f.requestId,
      f.prepared,
      f.crop,
      modifiedResponse,
    );
    assert.deepEqual(
      result,
      { state: 'UNAVAILABLE', reason: 'CORRELATION_MISMATCH' },
      `failed for ${name}`,
    );
  }
});

test('11. identity resolver unavailable response returns IDENTITY_UNAVAILABLE without profile lookup', async () => {
  const f = createSyntheticFixture('SYNTHETIC_TEST');
  const manager = createFakeManager({ request: f.request, event: f.event });
  let profileLookups = 0;
  const mockProfiles: Mf06CandidateProfileReader = {
    findCurrentForSafety: async () => {
      profileLookups++;
      return f.profileLookup;
    },
  };
  const service = new Mf06CandidateMetadataService(mockProfiles, 'SYNTHETIC_TEST');

  const unavailableReasons = ['NO_MATCH', 'UNSUPPORTED', 'SERVICE_UNAVAILABLE', 'ABORTED'] as const;
  for (const reason of unavailableReasons) {
    const unavailableResponse = {
      ...f.prepared.invocation,
      state: 'UNAVAILABLE',
      provenance: 'SYNTHETIC_TEST',
      reason,
    };
    const result = await service.revalidate(
      manager,
      f.siteId,
      f.requestId,
      f.prepared,
      f.crop,
      unavailableResponse,
    );
    assert.deepEqual(result, { state: 'UNAVAILABLE', reason: 'IDENTITY_UNAVAILABLE' });
  }
  assert.equal(profileLookups, 0);
});

test('12. missing, revoked, or unavailable profile and consent return PROFILE_UNAVAILABLE', async () => {
  const f = createSyntheticFixture('SYNTHETIC_TEST');
  const manager = createFakeManager({ request: f.request, event: f.event });
  const mockProfiles = createFakeProfileReader({ state: 'UNAVAILABLE' });
  const service = new Mf06CandidateMetadataService(mockProfiles, 'SYNTHETIC_TEST');

  const result = await service.revalidate(
    manager,
    f.siteId,
    f.requestId,
    f.prepared,
    f.crop,
    f.response,
  );

  assert.deepEqual(result, { state: 'UNAVAILABLE', reason: 'PROFILE_UNAVAILABLE' });
});

test('13. profile metadata site or revision divergence returns PROFILE_UNAVAILABLE', async () => {
  const f = createSyntheticFixture('SYNTHETIC_TEST');
  const manager = createFakeManager({ request: f.request, event: f.event });

  const divergenceCases: { name: string; lookup: SafetyFaceProfileLookup }[] = [
    {
      name: 'siteId divergence in returned profile',
      lookup: { ...f.profileLookup, siteId: randomUUID() },
    },
    {
      name: 'profileRevision divergence in returned profile',
      lookup: { ...f.profileLookup, profileRevision: randomUUID() },
    },
    {
      name: 'malformed non-UUID workerId',
      lookup: { ...f.profileLookup, workerId: 'malformed-non-uuid-worker-id' },
    },
  ];

  for (const { name, lookup } of divergenceCases) {
    const mockProfiles = createFakeProfileReader(lookup);
    const service = new Mf06CandidateMetadataService(mockProfiles, 'SYNTHETIC_TEST');
    const result = await service.revalidate(
      manager,
      f.siteId,
      f.requestId,
      f.prepared,
      f.crop,
      f.response,
    );
    assert.deepEqual(
      result,
      { state: 'UNAVAILABLE', reason: 'PROFILE_UNAVAILABLE' },
      `failed for ${name}`,
    );
  }
});

test('14. forwards exact lookup parameters to profile reader with finalization lock', async () => {
  const f = createSyntheticFixture('SYNTHETIC_TEST');
  const manager = createFakeManager({ request: f.request, event: f.event });

  let recordedManager: EntityManager | undefined;
  let recordedSiteId: string | undefined;
  let recordedRef: SafetyFaceProfileReference | undefined;
  let recordedLock: boolean | undefined;

  const mockProfiles = createFakeProfileReader(f.profileLookup, (m, site, ref, lock) => {
    recordedManager = m;
    recordedSiteId = site;
    recordedRef = ref;
    recordedLock = lock;
  });

  const service = new Mf06CandidateMetadataService(mockProfiles, 'SYNTHETIC_TEST');
  await service.revalidate(manager, f.siteId, f.requestId, f.prepared, f.crop, f.response);

  assert.equal(recordedManager, manager, 'Profile lookup must actually occur');
  assert.equal(recordedSiteId, f.siteId);
  assert.equal(recordedRef?.profileReferenceHash, f.response.profileReferenceHash);
  assert.equal(recordedRef?.profileRevision, f.response.profileRevision);
  assert.equal(recordedRef?.modelVersion, f.prepared.invocation.modelVersion);
  assert.equal(recordedLock, true);
});

test('15. transient database failures during transaction or profile read propagate untouched', async () => {
  const f = createSyntheticFixture('SYNTHETIC_TEST');
  const transientDbOutage = new Error('Transient PostgreSQL connection dropped');
  const serializationFailure = new Error(
    'could not serialize access due to concurrent update (40001)',
  );

  // Subcase 1: DB query error during isolation check or request read
  const brokenQueryManager = createFakeManager({
    request: f.request,
    event: f.event,
    queryError: transientDbOutage,
  });
  const service1 = new Mf06CandidateMetadataService(
    createFakeProfileReader(f.profileLookup),
    'SYNTHETIC_TEST',
  );
  await assert.rejects(
    service1.revalidate(brokenQueryManager, f.siteId, f.requestId, f.prepared, f.crop, f.response),
    (err) => err === transientDbOutage,
  );

  // Subcase 2: DB repository error during entity read
  const brokenRepoManager = createFakeManager({
    request: f.request,
    event: f.event,
    repositoryError: transientDbOutage,
  });
  const service2 = new Mf06CandidateMetadataService(
    createFakeProfileReader(f.profileLookup),
    'SYNTHETIC_TEST',
  );
  await assert.rejects(
    service2.revalidate(brokenRepoManager, f.siteId, f.requestId, f.prepared, f.crop, f.response),
    (err) => err === transientDbOutage,
  );

  // Subcase 3: Transient error during profile lookup
  const manager = createFakeManager({ request: f.request, event: f.event });
  const throwingProfiles: Mf06CandidateProfileReader = {
    findCurrentForSafety: async () => {
      throw serializationFailure;
    },
  };
  const service3 = new Mf06CandidateMetadataService(throwingProfiles, 'SYNTHETIC_TEST');
  await assert.rejects(
    service3.revalidate(manager, f.siteId, f.requestId, f.prepared, f.crop, f.response),
    (err) => err === serializationFailure,
  );
});

test('caller mutation during isolation query cannot replace saved invocation, crop or response', async () => {
  const f = createSyntheticFixture();
  const manager = createFakeManager({ request: f.request, event: f.event });
  const started = latch(),
    proceed = latch();
  const query = manager.query.bind(manager);
  manager.query = async (sql: string, parameters?: unknown[]) => {
    if (/^SHOW transaction_isolation$/.test(sql)) {
      started.release();
      await proceed.promise;
    }
    return query(sql, parameters);
  };
  const expectedBinding = f.prepared.invocation.bindingDigest;
  const expectedRevision = f.profileRevision;
  const service = new Mf06CandidateMetadataService(
    createFakeProfileReader(f.profileLookup),
    'SYNTHETIC_TEST',
  );
  const pending = service.revalidate(
    manager,
    f.siteId,
    f.requestId,
    f.prepared,
    f.crop,
    f.response,
  );
  await started.promise;
  f.crop.bytes[0] = (f.crop.bytes[0] ?? 0) ^ 1;
  f.crop.subject = { ...f.crop.subject, trackId: 999 };
  f.prepared.invocation.invocationId = randomUUID();
  f.response.profileRevision = randomUUID();
  proceed.release();
  const result = await pending;
  assert.equal(result.state, 'ELIGIBLE_PROFILE_METADATA');
  if (result.state !== 'ELIGIBLE_PROFILE_METADATA') assert.fail('Expected metadata');
  assert.equal(result.bindingDigest, expectedBinding);
  assert.equal(result.profileRevision, expectedRevision);
});

test('profile reader result is snapshotted before asynchronous savepoint release', async () => {
  const f = createSyntheticFixture();
  const manager = createFakeManager({ request: f.request, event: f.event });
  const started = latch(),
    proceed = latch();
  const query = manager.query.bind(manager);
  manager.query = async (sql: string, parameters?: unknown[]) => {
    if (/^RELEASE SAVEPOINT /.test(sql)) {
      started.release();
      await proceed.promise;
    }
    return query(sql, parameters);
  };
  const service = new Mf06CandidateMetadataService(
    createFakeProfileReader(f.profileLookup),
    'SYNTHETIC_TEST',
  );
  const pending = service.revalidate(
    manager,
    f.siteId,
    f.requestId,
    f.prepared,
    f.crop,
    f.response,
  );
  await started.promise;
  f.profileLookup.workerId = randomUUID();
  proceed.release();
  const result = await pending;
  assert.equal(result.state, 'ELIGIBLE_PROFILE_METADATA');
  if (result.state !== 'ELIGIBLE_PROFILE_METADATA') assert.fail('Expected metadata');
  assert.equal(result.workerId, f.workerId);
});

test('optional metadata failure restores the subtransaction before returning unavailable', async () => {
  const f = createSyntheticFixture();
  const manager = createFakeManager({ request: f.request, event: f.event });
  let poisoned = false,
    rollbacks = 0;
  const query = manager.query.bind(manager);
  manager.query = (async (sql: string, parameters?: unknown[]) => {
    if (/^ROLLBACK TO SAVEPOINT /.test(sql)) {
      poisoned = false;
      rollbacks++;
      return [];
    }
    if (poisoned) throw Object.assign(new Error('Failed transaction'), { code: '25P02' });
    return query(sql, parameters);
  }) as EntityManager['query'];
  const profiles: Mf06CandidateProfileReader = {
    async findCurrentForSafety() {
      poisoned = true;
      return { state: 'UNAVAILABLE' };
    },
  };
  const result = await new Mf06CandidateMetadataService(profiles, 'SYNTHETIC_TEST').revalidate(
    manager,
    f.siteId,
    f.requestId,
    f.prepared,
    f.crop,
    f.response,
  );
  assert.deepEqual(result, { state: 'UNAVAILABLE', reason: 'PROFILE_UNAVAILABLE' });
  assert.equal(rollbacks, 1);
  assert.equal(poisoned, false);
  await manager.query('SELECT 1');
});

test('oversized crops and malformed request identifiers are rejected before query or profile work', async () => {
  const f = createSyntheticFixture();
  let queries = 0,
    profiles = 0;
  const manager = createFakeManager({ request: f.request, event: f.event });
  manager.query = (async () => {
    queries++;
    return [];
  }) as EntityManager['query'];
  const reader: Mf06CandidateProfileReader = {
    async findCurrentForSafety() {
      profiles++;
      return f.profileLookup;
    },
  };
  const service = new Mf06CandidateMetadataService(reader, 'SYNTHETIC_TEST');
  assert.deepEqual(
    await service.revalidate(
      manager,
      f.siteId,
      f.requestId,
      f.prepared,
      { ...f.crop, bytes: Buffer.alloc(2 * 1024 * 1024 + 1) },
      f.response,
    ),
    { state: 'UNAVAILABLE', reason: 'INVALID_BINDING' },
  );
  assert.deepEqual(
    await service.revalidate(manager, 'bad', f.requestId, f.prepared, f.crop, f.response),
    { state: 'UNAVAILABLE', reason: 'INVALID_BINDING' },
  );
  assert.equal(queries, 0);
  assert.equal(profiles, 0);
});

function rebindFixtureAsV12(
  f: SyntheticFixture,
  cropFrameSha256: string,
  storedFrameSha256: string,
  version: '1.2.0' | '1.3.0' = '1.2.0',
) {
  const rawPayload = {
    ...(f.event.rawPayload as Record<string, unknown>),
    schemaVersion: version,
    evidence: [
      {
        kind: 'FRAME',
        uri: `local://evidence/${f.streamSessionId}/1/${f.eventId}.jpg`,
        sha256: storedFrameSha256,
      },
    ],
  };
  const payloadHash = computeCanonicalPayloadHash(rawPayload);
  const event = { ...f.event, rawPayload, payloadHash } as AiObservationEventEntity;
  const request = { ...f.request, payloadHash } as ZoneEntryAssessmentRequestEntity;
  const storedInspection = inspectMf06StoredBinding(request, event);
  assert.equal(storedInspection.status, 'MATCHED');
  const stored = storedInspection as Extract<Mf06StoredBindingInspection, { status: 'MATCHED' }>;

  const cropBytes =
    cropFrameSha256 === storedFrameSha256
      ? f.crop.bytes
      : Buffer.from('foreign-crop-jpeg-bytes-content-for-test-bounded-444');
  const crop: SafetySubjectCrop = {
    ...f.crop,
    bytes: cropBytes,
    cropSha256: createHash('sha256').update(cropBytes).digest('hex'),
    frameSha256: cropFrameSha256,
    subject: stored.subject!,
  };
  const bound = bindMf06FaceInvocation(stored, crop, f.invocationId, f.modelVersion);
  assert.equal(bound.state, 'BOUND_UNATTESTED');
  const prepared = bound as Extract<Mf06FaceBinding, { state: 'BOUND_UNATTESTED' }>;
  const response = { ...f.response, ...prepared.invocation };
  return { request, event, stored, crop, prepared, response };
}

test('v1.2 stored event with matching bound FRAME sha256 permits existing candidate metadata path', async () => {
  const f = createSyntheticFixture();
  const v12 = rebindFixtureAsV12(f, 'f'.repeat(64), 'f'.repeat(64));
  let profileCalls = 0;
  const manager = createFakeManager({ request: v12.request, event: v12.event });
  const service = new Mf06CandidateMetadataService(
    createFakeProfileReader(f.profileLookup, () => {
      profileCalls++;
    }),
    'SYNTHETIC_TEST',
  );

  const result = await service.revalidate(
    manager,
    f.siteId,
    f.requestId,
    v12.prepared,
    v12.crop,
    v12.response,
  );
  assert.equal(result.state, 'ELIGIBLE_PROFILE_METADATA');
  if (result.state !== 'ELIGIBLE_PROFILE_METADATA') return;
  assert.equal(result.workerId, f.workerId.toLowerCase());
  assert.equal(result.bindingDigest, v12.prepared.invocation.bindingDigest);
  assert.equal(result.contextDigest, v12.stored.contextDigest);
  assert.equal(profileCalls, 1);
});

test('rehashed foreign crop/frame with rebound invocation but SHA different from stored v1.2 FRAME is rejected as INVALID_BINDING before profile reader', async () => {
  const f = createSyntheticFixture();
  const v12Mismatch = rebindFixtureAsV12(f, 'a'.repeat(64), 'f'.repeat(64));
  let profileCalls = 0;
  const manager = createFakeManager({ request: v12Mismatch.request, event: v12Mismatch.event });
  const service = new Mf06CandidateMetadataService(
    createFakeProfileReader(f.profileLookup, () => {
      profileCalls++;
    }),
    'SYNTHETIC_TEST',
  );

  const result = await service.revalidate(
    manager,
    f.siteId,
    f.requestId,
    v12Mismatch.prepared,
    v12Mismatch.crop,
    v12Mismatch.response,
  );
  assert.deepEqual(result, { state: 'UNAVAILABLE', reason: 'INVALID_BINDING' });
  assert.equal(profileCalls, 0);
});

test('v1.3 stored FRAME permits matched metadata', async () => {
  const f = createSyntheticFixture();
  const v13 = rebindFixtureAsV12(f, 'f'.repeat(64), 'f'.repeat(64), '1.3.0');
  let profileCalls = 0;
  const manager = createFakeManager({ request: v13.request, event: v13.event });
  const service = new Mf06CandidateMetadataService(
    createFakeProfileReader(f.profileLookup, () => {
      profileCalls++;
    }),
    'SYNTHETIC_TEST',
  );

  const result = await service.revalidate(
    manager,
    f.siteId,
    f.requestId,
    v13.prepared,
    v13.crop,
    v13.response,
  );
  assert.equal(result.state, 'ELIGIBLE_PROFILE_METADATA');
  if (result.state !== 'ELIGIBLE_PROFILE_METADATA') return;
  assert.equal(result.workerId, f.workerId.toLowerCase());
  assert.equal(result.bindingDigest, v13.prepared.invocation.bindingDigest);
  assert.equal(result.contextDigest, v13.stored.contextDigest);
  assert.equal(profileCalls, 1);
});

test('v1.3 foreign rebound frame is refused before profile lookup', async () => {
  const f = createSyntheticFixture();
  const v13Mismatch = rebindFixtureAsV12(f, 'a'.repeat(64), 'f'.repeat(64), '1.3.0');
  let profileCalls = 0;
  const manager = createFakeManager({ request: v13Mismatch.request, event: v13Mismatch.event });
  const service = new Mf06CandidateMetadataService(
    createFakeProfileReader(f.profileLookup, () => {
      profileCalls++;
    }),
    'SYNTHETIC_TEST',
  );

  const result = await service.revalidate(
    manager,
    f.siteId,
    f.requestId,
    v13Mismatch.prepared,
    v13Mismatch.crop,
    v13Mismatch.response,
  );
  assert.deepEqual(result, { state: 'UNAVAILABLE', reason: 'INVALID_BINDING' });
  assert.equal(profileCalls, 0);
});
