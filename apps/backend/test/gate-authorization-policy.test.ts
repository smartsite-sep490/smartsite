import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorizeGateEntry } from '../src/modules/workforce/gate-authorization-policy.js';

const evaluatedAt = new Date('2026-09-29T08:00:00.000Z');

test('a gate-specific assignment permits Gate 1 but not another gate', () => {
  const assignment = { ...subject().assignment, gateId: 'gate-north-01' };
  assert.equal(
    authorizeGateEntry(subject({ assignment, gateId: 'gate-north-01' })).authorization,
    'ALLOWED',
  );
  assert.deepEqual(authorizeGateEntry(subject({ assignment, gateId: 'gate-west-02' })), {
    authorization: 'DENIED',
    reasonCode: 'GATE_MISMATCH',
  });
  assert.equal(authorizeGateEntry(subject({ assignment })).authorization, 'DENIED');
});

function subject(overrides: Partial<Parameters<typeof authorizeGateEntry>[0]> = {}) {
  return {
    workerActive: true,
    contractorActive: true,
    contractorParticipatesAtSite: true,
    faceProfileStatus: 'ACTIVE' as const,
    authorizationDataAvailable: true,
    siteId: 'site-a',
    evaluatedAt,
    assignment: {
      status: 'APPROVED' as const,
      siteId: 'site-a',
      validFrom: new Date('2026-09-29T07:00:00.000Z'),
      validUntil: null,
    },
    ...overrides,
  };
}

test('gate authorization requires an active worker, contractor, face profile and approved current assignment', () => {
  assert.deepEqual(authorizeGateEntry(subject()), {
    authorization: 'ALLOWED',
    reasonCode: 'VALID_ASSIGNMENT',
  });
  assert.deepEqual(authorizeGateEntry(subject({ contractorActive: false })), {
    authorization: 'DENIED',
    reasonCode: 'CONTRACTOR_INACTIVE',
  });
  assert.deepEqual(authorizeGateEntry(subject({ contractorParticipatesAtSite: false })), {
    authorization: 'DENIED',
    reasonCode: 'CONTRACTOR_SITE_PARTICIPATION_INVALID',
  });
  assert.deepEqual(authorizeGateEntry(subject({ faceProfileStatus: 'REVOKED' })), {
    authorization: 'DENIED',
    reasonCode: 'FACE_PROFILE_REVOKED',
  });
});

test('gate authorization fails closed for cross-site, expired and unavailable data', () => {
  assert.deepEqual(
    authorizeGateEntry(subject({ assignment: { ...subject().assignment, siteId: 'site-b' } })),
    { authorization: 'DENIED', reasonCode: 'SITE_MISMATCH' },
  );
  assert.deepEqual(
    authorizeGateEntry(
      subject({
        assignment: {
          ...subject().assignment,
          validUntil: new Date('2026-09-29T08:00:00.000Z'),
        },
      }),
    ),
    { authorization: 'DENIED', reasonCode: 'ASSIGNMENT_EXPIRED' },
  );
  assert.deepEqual(authorizeGateEntry(subject({ authorizationDataAvailable: false })), {
    authorization: 'MANUAL_REVIEW',
    reasonCode: 'AUTHORIZATION_DATA_UNAVAILABLE',
  });
});
