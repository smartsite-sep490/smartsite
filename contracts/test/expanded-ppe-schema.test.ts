import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateObservationEvent } from '@smartsite/contracts';

function payload(item: string, version = '1.1.0', status = 'MISSING') {
  return {
    eventId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
    schemaVersion: version,
    cameraExternalId: 'CAM-01',
    streamSessionId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf7',
    capturedAt: '2026-10-06T00:00:00.000Z',
    frameDimensions: { width: 1920, height: 1080 },
    observations: [
      {
        type: 'PPE',
        trackId: 1,
        ppeItem: item,
        status,
        regionId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf8',
        geometryVersion: 1,
      },
    ],
    evidence: [],
  };
}

for (const item of ['GLOVES', 'BOOTS', 'GOGGLES']) {
  test(`expanded v1.1 accepts explicit ${item} evidence`, () => {
    assert.equal(validateObservationEvent(payload(item)).isValid, true);
    assert.equal(validateObservationEvent(payload(item, '1.1.0', 'PRESENT')).isValid, true);
  });
  test(`legacy v1 rejects ${item} without a version change`, () => {
    assert.equal(validateObservationEvent(payload(item, '1.0.0')).isValid, false);
  });
}

test('both versions retain legacy helmet/vest evidence', () => {
  for (const version of ['1.0.0', '1.1.0']) {
    for (const item of ['HARD_HAT', 'SAFETY_VEST']) {
      assert.equal(validateObservationEvent(payload(item, version)).isValid, true);
    }
  }
});

test('expanded schema retains strict bounds, geometry and explicit statuses', () => {
  assert.equal(validateObservationEvent(payload('GLOVES', '1.1.0', 'UNKNOWN')).isValid, false);
  assert.equal(validateObservationEvent(payload('HARNESS')).isValid, false);
  assert.equal(validateObservationEvent(payload('GLOVES', '2.0.0')).isValid, false);
  assert.equal(validateObservationEvent({ ...payload('BOOTS'), extra: true }).isValid, false);
  const invalid = payload('GOGGLES');
  assert.equal(
    validateObservationEvent({
      ...invalid,
      observations: [
        {
          ...invalid.observations[0],
          boundingBox: {
            x1: 0.8,
            y1: 0.2,
            x2: 0.1,
            y2: 0.5,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        },
      ],
    }).isValid,
    false,
  );
});
