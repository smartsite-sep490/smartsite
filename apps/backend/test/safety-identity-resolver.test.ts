import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  inspectSafetyFaceResponse,
  UnavailableSafetyIdentityResolver,
  type SafetyFaceInvocation,
} from '../src/modules/safety/assessments/safety-identity-resolver.port.js';

const input: SafetyFaceInvocation = {
  protocolVersion: 'SAFETY_MF06_FACE_V1',
  purpose: 'SAFETY_MF06',
  invocationId: '11111111-1111-4111-8111-111111111111',
  bindingDigest: 'a'.repeat(64),
  requestId: '22222222-2222-4222-8222-222222222222',
  eventId: '33333333-3333-4333-8333-333333333333',
  payloadHash: 'b'.repeat(64),
  siteId: '44444444-4444-4444-8444-444444444444',
  cameraId: '55555555-5555-4555-8555-555555555555',
  cameraExternalId: 'synthetic-camera',
  streamSessionId: '66666666-6666-4666-8666-666666666666',
  capturedAt: '2026-10-11T00:00:00.000Z',
  originalCapturedAt: '2026-10-11T00:00:00.000Z',
  personObservationIndex: 2,
  zoneObservationIndex: 3,
  trackId: 17,
  regionId: '77777777-7777-4777-8777-777777777777',
  geometryVersion: 4,
  zoneId: '88888888-8888-4888-8888-888888888888',
  requestRevision: 1,
  requestedPurpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  frameSha256: 'c'.repeat(64),
  cropSha256: 'd'.repeat(64),
  cropAlgorithmVersion: 'PERSON_FLOOR_CEIL_JPEG95_444_V1',
  modelVersion: 'synthetic-face-v1',
};
const response = () => ({
  ...input,
  state: 'CANDIDATE',
  provenance: 'SYNTHETIC_TEST',
  profileReferenceHash: 'e'.repeat(64),
  profileRevision: '99999999-9999-4999-8999-999999999999',
});

test('resolver rejects accessor and inherited response fields without executing hooks', () => {
  let calls = 0;
  const accessor = response();
  Object.defineProperty(accessor, 'state', {
    enumerable: true,
    get() {
      calls++;
      throw Error('Caller hook');
    },
  });
  assert.deepEqual(inspectSafetyFaceResponse(input, accessor, 'SYNTHETIC_TEST'), {
    state: 'UNAVAILABLE',
    reason: 'INVALID_RESPONSE',
  });
  assert.equal(calls, 0);
  assert.deepEqual(inspectSafetyFaceResponse(input, Object.create(response()), 'SYNTHETIC_TEST'), {
    state: 'UNAVAILABLE',
    reason: 'INVALID_RESPONSE',
  });
});

test('a correlated candidate exposes only profile reference/revision, never a supplied Worker', () => {
  assert.deepEqual(inspectSafetyFaceResponse(input, response(), 'SYNTHETIC_TEST'), {
    state: 'CANDIDATE_REFERENCE',
    profileReferenceHash: 'e'.repeat(64),
    profileRevision: '99999999-9999-4999-8999-999999999999',
    provenance: 'SYNTHETIC_TEST',
  });
  assert.equal(
    inspectSafetyFaceResponse(input, { ...response(), workerId: input.siteId }, 'SYNTHETIC_TEST')
      .state,
    'UNAVAILABLE',
  );
});

for (const [field, value] of Object.entries({
  invocationId: input.requestId,
  bindingDigest: 'f'.repeat(64),
  requestId: input.eventId,
  eventId: input.requestId,
  payloadHash: 'f'.repeat(64),
  siteId: input.cameraId,
  cameraId: input.siteId,
  cameraExternalId: 'other-camera',
  streamSessionId: input.siteId,
  capturedAt: '2026-10-11T00:00:00.001Z',
  originalCapturedAt: '2026-10-11T07:00:00+07:00',
  personObservationIndex: 1,
  zoneObservationIndex: 4,
  trackId: 18,
  regionId: input.zoneId,
  geometryVersion: 5,
  zoneId: input.regionId,
  requestRevision: 2,
  requestedPurpose: 'RETROSPECTIVE_REVIEW',
  frameSha256: 'f'.repeat(64),
  cropSha256: 'f'.repeat(64),
  modelVersion: 'other-face-model',
})) {
  test(`candidate for a different ${field} is rejected`, () => {
    assert.deepEqual(
      inspectSafetyFaceResponse(input, { ...response(), [field]: value }, 'SYNTHETIC_TEST'),
      { state: 'UNAVAILABLE', reason: 'CORRELATION_MISMATCH' },
    );
  });
}

test('Gate protocol/purpose, other crop algorithm and extra template fields cannot enter Safety', () => {
  for (const changed of [
    { protocolVersion: 'GATE_FACE_V1' },
    { purpose: 'GATE_ENTRY' },
    { cropAlgorithmVersion: 'WHOLE_FRAME' },
    { encryptedTemplate: 'private' },
  ])
    assert.deepEqual(
      inspectSafetyFaceResponse(input, { ...response(), ...changed }, 'SYNTHETIC_TEST'),
      { state: 'UNAVAILABLE', reason: 'INVALID_RESPONSE' },
    );
});

test('candidate requires both nonempty canonical profile reference and revision', () => {
  for (const changed of [
    { profileReferenceHash: null },
    { profileReferenceHash: '' },
    { profileReferenceHash: 'E'.repeat(64) },
    { profileRevision: null },
    { profileRevision: 'AI-chosen-revision' },
    { profileRevision: undefined },
  ])
    assert.deepEqual(
      inspectSafetyFaceResponse(input, { ...response(), ...changed }, 'SYNTHETIC_TEST'),
      { state: 'UNAVAILABLE', reason: 'INVALID_RESPONSE' },
    );
});

test('unavailable response cannot smuggle a candidate or an unknown reason', () => {
  const unavailable = {
    ...input,
    state: 'UNAVAILABLE',
    provenance: 'SYNTHETIC_TEST',
    reason: 'NO_MATCH',
  };
  assert.deepEqual(inspectSafetyFaceResponse(input, unavailable, 'SYNTHETIC_TEST'), {
    state: 'UNAVAILABLE',
    reason: 'IDENTITY_UNAVAILABLE',
  });
  for (const extra of [{ profileReferenceHash: 'e'.repeat(64) }, { reason: 'ALLOWED' }])
    assert.deepEqual(
      inspectSafetyFaceResponse(input, { ...unavailable, ...extra }, 'SYNTHETIC_TEST'),
      { state: 'UNAVAILABLE', reason: 'INVALID_RESPONSE' },
    );
});

test('wire provenance cannot upgrade a disabled or synthetic backend channel', () => {
  assert.deepEqual(inspectSafetyFaceResponse(input, response(), 'DISABLED'), {
    state: 'UNAVAILABLE',
    reason: 'SERVICE_DISABLED',
  });
  assert.deepEqual(
    inspectSafetyFaceResponse(
      input,
      { ...response(), provenance: 'TRUSTED_SERVICE' },
      'SYNTHETIC_TEST',
    ),
    { state: 'UNAVAILABLE', reason: 'INVALID_RESPONSE' },
  );
});

test('malformed backend invocation also fails closed despite matching transport echoes', () => {
  for (const changed of [
    { personObservationIndex: -1 },
    { trackId: NaN },
    { capturedAt: 'yesterday' },
    { requestRevision: 0 },
    { frameSha256: 'c'.repeat(64) + '\n' },
    { bindingDigest: 'a'.repeat(64) + '\n' },
  ]) {
    const malformed = { ...input, ...changed } as SafetyFaceInvocation;
    assert.deepEqual(
      inspectSafetyFaceResponse(malformed, { ...response(), ...changed }, 'SYNTHETIC_TEST'),
      { state: 'UNAVAILABLE', reason: 'INVALID_RESPONSE' },
    );
  }
});

test('default resolver is unavailable and honors abort without any network dependency', async () => {
  const adapter = new UnavailableSafetyIdentityResolver();
  const controller = new AbortController();
  const request = { invocation: input, cropBytes: Buffer.alloc(0), candidates: [] };
  assert.deepEqual(await adapter.resolve(request, controller.signal), {
    state: 'UNAVAILABLE',
    reason: 'SERVICE_DISABLED',
  });
  controller.abort();
  assert.deepEqual(await adapter.resolve(request, controller.signal), {
    state: 'UNAVAILABLE',
    reason: 'ABORTED',
  });
});
