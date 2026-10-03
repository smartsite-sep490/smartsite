import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AccountResponse, ProvisionableRoleAssignment } from '../src/management-api.js';
import {
  parseObservationIdentityContextResponse,
  parseObservationIdentityMutationResponse,
  parseObservationIdentityDecisionPage,
  parseObservationIdentityWorkerPage,
} from '../src/management-api.js';
import { randomUUID } from 'node:crypto';

function identityResponseFixture() {
  const eventId = randomUUID();
  const subjectRef = {
    eventId,
    personObservationIndex: 0,
    payloadHash: 'a'.repeat(64),
    cameraId: randomUUID(),
    cameraExternalId: 'SYNTHETIC',
    streamSessionId: randomUUID(),
    capturedAt: '2026-10-01T00:00:00Z',
    trackId: 7,
    personBoundingBox: { x1: 0.1, y1: 0.1, x2: 0.8, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
  };
  const manual = {
    id: randomUUID(),
    revision: 1,
    action: 'RESOLVE',
    workerId: randomUUID(),
    actorUserId: randomUUID(),
    reason: 'Synthetic person reviewed.',
    scope: 'EXACT_OBSERVATION',
    verificationMethod: 'MANUAL',
    recordedAt: '2026-10-01T01:00:00.000Z',
  };
  const decision = { ...manual, subjectRef, evidenceIndex: 0, evidenceSha256: 'b'.repeat(64) };
  const subject = {
    personObservationIndex: 0,
    trackId: 7,
    subjectRef,
    subjectRefSource: 'RAW_EVENT',
    technicalIdentity: { status: 'UNKNOWN', candidates: [] },
    latestManualDecision: manual,
    revision: 1,
    canResolve: true,
    resolveBlockReason: null,
    canClear: true,
    clearBlockReason: null,
    originalZoneDecisions: { items: [], total: 0 },
  };
  const context = {
    eventId,
    payloadHash: 'a'.repeat(64),
    eventConsistent: true,
    frames: [{ index: 0, kind: 'FRAME', sha256: 'b'.repeat(64), available: true }],
    subjects: [subject],
  };
  return { context, subject, decision };
}

test('identity management response parsing is closed and binds event/PERSON/media/manual state', () => {
  const f = identityResponseFixture();
  assert.deepEqual(parseObservationIdentityContextResponse(f.context), f.context);
  for (const mutate of [
    (v: typeof f.context) => {
      (v as unknown as Record<string, unknown>).rawPayload = { private: true };
    },
    (v: typeof f.context) => {
      v.subjects[0]!.subjectRef.eventId = randomUUID();
    },
    (v: typeof f.context) => {
      v.subjects[0]!.subjectRef.personBoundingBox.x2 = 0.05;
    },
    (v: typeof f.context) => {
      v.frames[0]!.sha256 = 'wrong';
    },
    (v: typeof f.context) => {
      v.subjects[0]!.latestManualDecision.revision = 2;
    },
    (v: typeof f.context) => {
      v.subjects.push(v.subjects[0]!);
    },
    (v: typeof f.context) => {
      v.eventConsistent = false;
    },
  ]) {
    const v = structuredClone(f.context);
    mutate(v);
    assert.equal(parseObservationIdentityContextResponse(v), undefined);
  }
});

test('identity command responses keep original replay revision and reject Worker/authority confusion', () => {
  const f = identityResponseFixture();
  const response = { recordedDecision: f.decision, latestRevision: 3, replayed: true };
  assert.deepEqual(parseObservationIdentityMutationResponse(response), response);
  assert.equal(
    parseObservationIdentityMutationResponse({ ...response, latestRevision: 0 }),
    undefined,
  );
  assert.equal(
    parseObservationIdentityMutationResponse({
      ...response,
      recordedDecision: { ...f.decision, scope: 'WHOLE_ALERT' },
    }),
    undefined,
  );
  assert.equal(
    parseObservationIdentityMutationResponse({
      ...response,
      recordedDecision: { ...f.decision, action: 'CLEAR' },
    }),
    undefined,
  );
  assert.equal(
    parseObservationIdentityMutationResponse({
      ...response,
      recordedDecision: { ...f.decision, workerId: 'CANDIDATE-EXTERNAL-ID' },
    }),
    undefined,
  );
});

test('identity decision and Worker pages enforce bounds, order, closed fields and optional Site binding', () => {
  const f = identityResponseFixture();
  const page = { items: [f.decision], total: 1 };
  assert.deepEqual(parseObservationIdentityDecisionPage(page), page);
  assert.equal(
    parseObservationIdentityDecisionPage({ items: [f.decision, f.decision], total: 2 }),
    undefined,
  );
  assert.equal(
    parseObservationIdentityDecisionPage({
      items: Array.from({ length: 101 }, () => f.decision),
      total: 101,
    }),
    undefined,
  );
  const siteId = randomUUID();
  const worker = {
    id: randomUUID(),
    siteId,
    externalId: 'W-001',
    displayName: 'Synthetic Worker',
    isActive: false,
  };
  assert.deepEqual(parseObservationIdentityWorkerPage({ items: [worker], total: 1 }, siteId), {
    items: [worker],
    total: 1,
  });
  assert.equal(
    parseObservationIdentityWorkerPage({ items: [worker], total: 1 }, randomUUID()),
    undefined,
  );
  assert.equal(
    parseObservationIdentityWorkerPage({ items: [{ ...worker, embedding: 'private' }], total: 1 }),
    undefined,
  );
});

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;

test('account responses and role mutation inputs represent every provisionable role', () => {
  const account: AccountResponse = {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'role-catalog',
    displayName: 'Role Catalog',
    roleAssignments: [
      { role: 'ADMIN', siteId: null },
      { role: 'SITE_MANAGER', siteId: '00000000-0000-4000-8000-000000000002' },
      {
        role: 'CONTRACTOR_REPRESENTATIVE',
        siteId: '00000000-0000-4000-8000-000000000002',
      },
      { role: 'SAFETY_OFFICER', siteId: '00000000-0000-4000-8000-000000000002' },
      { role: 'SECURITY_OFFICER', siteId: '00000000-0000-4000-8000-000000000002' },
      { role: 'WORKER', siteId: '00000000-0000-4000-8000-000000000002' },
    ],
    isActive: true,
    mustChangePassword: false,
  };
  const provisionableRolesStayRestricted: Equal<
    ProvisionableRoleAssignment['role'],
    'ADMIN' |
      'SITE_MANAGER' |
      'CONTRACTOR_REPRESENTATIVE' |
      'SAFETY_OFFICER' |
      'SECURITY_OFFICER' |
      'WORKER'
  > = true;

  assert.deepEqual(
    account.roleAssignments.map(({ role }) => role),
    [
      'ADMIN',
      'SITE_MANAGER',
      'CONTRACTOR_REPRESENTATIVE',
      'SAFETY_OFFICER',
      'SECURITY_OFFICER',
      'WORKER',
    ],
  );
  assert.equal(provisionableRolesStayRestricted, true);
});
