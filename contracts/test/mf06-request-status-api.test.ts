import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as api from '../src/mf06-assessment-api.js';
const parsers = api as unknown as {
  parseMf06RequestStatusResponse?: (v: unknown) => unknown;
  parseMf06RequestStatusPage?: (v: unknown) => unknown;
};
const id = '00000000-0000-4000-8000-000000000001';
const base = {
  requestId: id,
  siteId: id,
  eventId: id,
  cameraId: id,
  zoneId: id,
  capturedAt: '2026-10-13T01:00:00.123456Z',
  requestedAt: '2026-10-13T01:00:01Z',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  jobStatus: 'PENDING',
  attemptCount: 0,
  deadlineAt: '2026-10-13T01:10:01Z',
  deadlinePassed: false,
  assessmentId: null,
};
function parse(v: unknown) {
  assert.equal(
    typeof parsers.parseMf06RequestStatusResponse,
    'function',
    'Request status parser missing',
  );
  return parsers.parseMf06RequestStatusResponse!(v);
}
function page(v: unknown) {
  assert.equal(
    typeof parsers.parseMf06RequestStatusPage,
    'function',
    'Request status page parser missing',
  );
  return parsers.parseMf06RequestStatusPage!(v);
}
for (const status of ['NOT_QUEUED', 'PENDING', 'CLAIMED', 'SUCCEEDED', 'FAILED', 'CANCELLED'])
  test(`safe request status ${status} retains raw state and nullable job shape`, () => {
    const value = {
      ...base,
      jobStatus: status,
      attemptCount: status === 'NOT_QUEUED' ? null : 1,
      deadlineAt: status === 'NOT_QUEUED' ? null : base.deadlineAt,
      assessmentId: status === 'SUCCEEDED' ? id : null,
    };
    assert.deepEqual(parse(value), value);
  });
test('deadline passed does not rewrite persisted PENDING/CLAIMED/terminal state', () => {
  for (const status of ['PENDING', 'CLAIMED', 'FAILED', 'CANCELLED'])
    assert.deepEqual(parse({ ...base, jobStatus: status, attemptCount: 1, deadlinePassed: true }), {
      ...base,
      jobStatus: status,
      attemptCount: 1,
      deadlinePassed: true,
    });
});
for (const [label, patch] of [
  ['Worker/private fields', { workerId: id }],
  ['lease token', { leaseToken: id }],
  ['raw error', { lastErrorCode: 'PRIVATE' }],
  ['unknown state', { jobStatus: 'EXPIRED' }],
  ['negative attempt', { attemptCount: -1 }],
  ['unsafe attempt', { attemptCount: 9007199254740992 }],
  ['missing job deadline', { deadlineAt: null }],
  ['fake completion', { jobStatus: 'SUCCEEDED', attemptCount: 1 }],
  ['assessment on pending', { assessmentId: id }],
  ['unknown purpose', { purpose: 'FACE_IDENTITY' }],
  ['bad time', { requestedAt: '2026-02-30T00:00:00Z' }],
  ['bad UUID', { eventId: 'private' }],
  ['notqueued deadline', { jobStatus: 'NOT_QUEUED', attemptCount: null }],
  ['notqueued attempts', { jobStatus: 'NOT_QUEUED', deadlineAt: null }],
] as const)
  test(`reject ${label}`, () =>
    assert.throws(() => parse({ ...base, ...patch }), /Invalid MF06 request status/));
test('page enforces bounds, exact keys and case-insensitive duplicate request IDs', () => {
  const value = { items: [base], total: 1, offset: 0, limit: 20 };
  assert.deepEqual(page(value), value);
  for (const bad of [
    { ...value, total: 0 },
    { ...value, limit: 101 },
    { ...value, offset: -1 },
    { ...value, secret: 'private' },
    { ...value, items: [base, { ...base, requestId: id.toUpperCase() }], total: 2 },
  ])
    assert.throws(() => page(bad), /Invalid MF06 request status page/);
});
