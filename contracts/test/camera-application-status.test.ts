import assert from 'node:assert/strict';
import { test } from 'node:test';

test('camera application status rejects impossible readiness, scope and receipt shapes', async () => {
  const modulePath = '../src/camera-application-status.js';
  const module = await import(modulePath).catch(() => ({}));
  const parse = (module as { parseCameraApplicationStatus?: (value: unknown) => unknown })
    .parseCameraApplicationStatus;
  assert.equal(typeof parse, 'function');
  const value = {
    cameraId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    siteId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    desiredRevision: 2,
    reportedRevision: 2,
    applicationState: 'LOADED',
    observedAt: '2026-10-27T00:00:01.000Z',
    lastReceiptAt: '2026-10-27T00:00:00.000Z',
    viewValidity: 'UNCONFIRMED',
    reasonCode: null,
  };
  assert.deepEqual(parse!(value), value);
  assert.deepEqual(
    parse!({
      ...value,
      reportedRevision: null,
      lastReceiptAt: null,
      applicationState: 'UNCONFIRMED',
    }),
    { ...value, reportedRevision: null, lastReceiptAt: null, applicationState: 'UNCONFIRMED' },
  );
  for (const invalid of [
    null,
    [],
    { ...value, cameraId: 'wrong' },
    { ...value, desiredRevision: 0 },
    { ...value, reportedRevision: 1 },
    { ...value, lastReceiptAt: null },
    { ...value, reportedRevision: 3 },
    { ...value, viewValidity: 'VALID' },
    { ...value, observedAt: 'tomorrow' },
    { ...value, lastReceiptAt: '2026-10-27T00:00:02.000Z' },
    { ...value, secret: 'forbidden' },
    { ...value, applicationState: 'UNCONFIRMED' },
    { ...value, applicationState: { toString: () => 'LOADED' } },
    { ...value, viewValidity: { toString: () => 'UNCONFIRMED' } },
    { ...value, reasonCode: 'UNSUPPORTED_PPE' },
  ])
    assert.equal(parse!(invalid), null);
});
