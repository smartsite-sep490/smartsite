import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseMf06AssessmentPage,
  parseMf06AssessmentResponse,
} from '../src/mf06-assessment-api.js';
const row = {
  assessmentId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  siteId: '33333333-3333-4333-8333-333333333333',
  eventId: '44444444-4444-4444-8444-444444444444',
  cameraId: '55555555-5555-4555-8555-555555555555',
  zoneId: '66666666-6666-4666-8666-666666666666',
  capturedAt: '2026-10-12T01:02:03.123456Z',
  assessedAt: '2026-10-12T01:02:04.123456Z',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  outcome: 'UNAVAILABLE',
  reasonCode: 'IDENTITY_UNAVAILABLE',
  evaluatorVersion: 'software-fixture-v1',
  provenance: 'UNAVAILABLE',
};
test('public assessment parser retains exact historical clocks and safe fields', () => {
  assert.deepEqual(parseMf06AssessmentResponse(row), row);
  assert.deepEqual(parseMf06AssessmentPage({ items: [row], total: 1, offset: 0, limit: 20 }), {
    items: [row],
    total: 1,
    offset: 0,
    limit: 20,
  });
});
test('synthetic, private, malformed and incompatible outcomes cannot become public records', () => {
  for (const bad of [
    { ...row, outcome: 'ALLOWED', reasonCode: 'AUTHORIZED', provenance: 'UNAVAILABLE' },
    { ...row, provenance: 'SYNTHETIC_TEST' },
    { ...row, workerId: 'private-worker' },
    { ...row, authorityArtifact: { body: 'private' } },
    { ...row, reasonCode: 'UNAUTHORIZED' },
    { ...row, assessmentId: 'not-uuid' },
    { ...row, capturedAt: 'yesterday' },
    { ...row, evaluatorVersion: '' },
    { ...row, outcome: 'PROCESSING' },
    { ...row, purpose: 'OTHER' },
    null,
  ])
    assert.throws(() => parseMf06AssessmentResponse(bad), /Invalid MF06/);
});
test('pagination rejects invalid totals, offsets, sizes, duplicate IDs and oversized pages', () => {
  for (const bad of [
    { items: [row, row], total: 2, offset: 0, limit: 20 },
    { items: [row], total: 0, offset: 0, limit: 20 },
    { items: [], total: 0, offset: -1, limit: 20 },
    { items: [], total: 0, offset: 0, limit: 101 },
    { items: [], total: 0, offset: 0, limit: 0 },
    { items: [], total: Infinity, offset: 0, limit: 20 },
    { items: [row], total: 1, offset: 0, limit: 20, token: 'private' },
  ])
    assert.throws(() => parseMf06AssessmentPage(bad), /Invalid MF06/);
});

test('assessment delivery preserves exact source sequence and distinguishes partial from complete', () => {
  const frameDelivery = {
    frameId: row.eventId,
    sequenceNumber: '18446744073709551615',
    partCount: 2,
    receivedParts: 1,
    status: 'PARTIAL',
  };
  for (const delivery of [
    frameDelivery,
    { ...frameDelivery, receivedParts: 2, status: 'COMPLETE' },
  ]) {
    assert.deepEqual(parseMf06AssessmentResponse({ ...row, frameDelivery: delivery }), {
      ...row,
      frameDelivery: delivery,
    });
  }
  for (const bad of [
    { ...frameDelivery, status: 'COMPLETE' },
    { ...frameDelivery, receivedParts: 2 },
    { ...frameDelivery, receivedParts: 0 },
    { ...frameDelivery, receivedParts: 3 },
    { ...frameDelivery, partCount: 1025 },
    { ...frameDelivery, sequenceNumber: '18446744073709551616' },
    { ...frameDelivery, sequenceNumber: '01' },
    { ...frameDelivery, sequenceNumber: 1 },
    { ...frameDelivery, eventId: row.eventId },
    null,
  ])
    assert.throws(
      () => parseMf06AssessmentResponse({ ...row, frameDelivery: bad }),
      /Invalid MF06/,
    );
});
