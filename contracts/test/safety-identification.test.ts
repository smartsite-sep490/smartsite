import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SAFETY_IDENTIFICATION_OUTCOMES as rootOutcomes,
  SAFETY_IDENTIFICATION_STATUSES as rootStatuses,
} from '../src/index.js';
import {
  SAFETY_IDENTIFICATION_OUTCOMES,
  SAFETY_IDENTIFICATION_STATUSES,
  type CreateSafetyIdentificationRequest,
  type SafetyIdentificationRequest,
} from '../src/safety-identification-api.js';

test('safety-identification canonical statuses, outcomes, and root/subpath exports match', () => {
  assert.deepEqual(SAFETY_IDENTIFICATION_STATUSES, ['OPEN', 'RESPONDED', 'CLOSED', 'CANCELLED']);
  assert.deepEqual(SAFETY_IDENTIFICATION_OUTCOMES, [
    'IDENTIFIED',
    'PARTIAL',
    'UNRESOLVED',
    'DISPUTED',
  ]);
  assert.equal(rootStatuses, SAFETY_IDENTIFICATION_STATUSES);
  assert.equal(rootOutcomes, SAFETY_IDENTIFICATION_OUTCOMES);
});

test('safety-identification request types preserve both EVENT_LOCAL and TRACKED episode subjects and explicit evidence availability', () => {
  const createCmd: CreateSafetyIdentificationRequest = {
    commandId: '11111111-1111-4111-8111-111111111111',
    episodeId: '22222222-2222-4222-8222-222222222222',
    assignedTo: '33333333-3333-4333-8333-333333333333',
    reason: 'Verify unknown worker in restricted zone',
    dueAt: null,
    evidenceRefs: [],
    evidenceApproval: {
      preview: {
        episodeId: '22222222-2222-4222-8222-222222222222',
        alertId: '44444444-4444-4444-8444-444444444444',
        eventId: '55555555-5555-4555-8555-555555555555',
        personObservationIndex: 0,
        evidenceIndex: 0,
        masks: [{ left: 0, top: 0, right: 5000, bottom: 5000 }],
      },
      frameSha256: 'a'.repeat(64),
      sha256: 'b'.repeat(64),
    },
  };
  const trackedRequest: SafetyIdentificationRequest = {
    id: '66666666-6666-4666-8666-666666666666',
    siteId: '77777777-7777-4777-8777-777777777777',
    episodeId: createCmd.episodeId,
    subject: {
      kind: 'TRACKED',
      segmentId: '88888888-8888-4888-8888-888888888888',
      scopeSha256: 'c'.repeat(64),
    },
    assignedTo: createCmd.assignedTo,
    requestedBy: '99999999-9999-4999-8999-999999999999',
    reason: createCmd.reason,
    status: 'OPEN',
    version: 1,
    dueAt: null,
    evidenceRefs: [],
    evidenceAvailability: {
      status: 'UNAVAILABLE',
      reason: 'SUBJECT_DERIVATIVE_UNAVAILABLE',
    },
    result: null,
    createdAt: '2026-11-16T00:00:00.000Z',
    updatedAt: '2026-11-16T00:00:00.000Z',
  };
  assert.equal(trackedRequest.subject.kind, 'TRACKED');
  assert.equal(trackedRequest.evidenceAvailability.status, 'UNAVAILABLE');
});
