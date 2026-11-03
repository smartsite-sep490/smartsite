import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { AiObservationEventEntity } from '../src/database/entities/ai-observation-event.entity.js';
import { readConsistentMf06RawEvent } from '../src/modules/safety/assessments/mf06-observation-event.js';
import { snapshotMf06Json } from '../src/modules/safety/assessments/mf06-json-snapshot.js';

function event() {
  const raw = {
    schemaVersion: '1.0.0',
    eventId: randomUUID(),
    cameraExternalId: 'synthetic-camera',
    streamSessionId: randomUUID(),
    capturedAt: '2026-10-28T00:00:00.123Z',
    frameDimensions: { width: 640, height: 480 },
    observations: [{ type: 'PERSON', trackId: 7, confidence: 0.9 }],
    evidence: [],
  };
  return Object.assign(new AiObservationEventEntity(), {
    eventId: raw.eventId,
    payloadHash: computeCanonicalPayloadHash(raw),
    cameraExternalId: raw.cameraExternalId,
    streamSessionId: raw.streamSessionId,
    capturedAt: new Date(raw.capturedAt),
    rawPayload: raw,
  });
}

test('MF06 source reader snapshots the stored raw event and rejects inconsistent headers/hash', () => {
  const stored = event();
  const selected = readConsistentMf06RawEvent(stored);
  assert.deepEqual(selected, stored.rawPayload);
  assert.notEqual(selected, stored.rawPayload);
  for (const patch of [
    { eventId: randomUUID() },
    { payloadHash: '0'.repeat(64) },
    { cameraExternalId: 'another-camera' },
    { streamSessionId: randomUUID() },
    { capturedAt: new Date('2026-10-28T00:00:00.124Z') },
  ])
    assert.equal(readConsistentMf06RawEvent(Object.assign(event(), patch)), null);
});

test('MF06 source reader never invokes caller raw accessors or JSON hooks', () => {
  let calls = 0;
  const stored = event();
  Object.defineProperty(stored, 'rawPayload', {
    enumerable: true,
    get() {
      calls++;
      return {};
    },
  });
  assert.equal(readConsistentMf06RawEvent(stored), null);
  const hooked = event();
  Object.assign(hooked.rawPayload, {
    toJSON() {
      calls++;
      return {};
    },
  });
  assert.equal(readConsistentMf06RawEvent(hooked), null);
  assert.equal(calls, 0);
});

test('MF06 JSON snapshot rejects unsafe descriptors, cycles, sparse arrays and resource overflow', () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  let deep: unknown = {};
  for (let i = 0; i < 34; i++) deep = { next: deep };
  for (const input of [
    cycle,
    deep,
    new Array(2),
    { value: Infinity },
    { [Symbol('x')]: 1 },
    Object.create({ inherited: true }),
    { text: 'x'.repeat(2_097_153) },
    Object.defineProperty({}, 'value', {
      get() {
        throw Error('must not run');
      },
      enumerable: true,
    }),
  ])
    assert.throws(() => snapshotMf06Json(input));
  const input = { nested: [{ text: 'safe', value: 3 }] };
  const snapshot = snapshotMf06Json(input);
  input.nested[0]!.text = 'changed';
  assert.deepEqual(snapshot, { nested: [{ text: 'safe', value: 3 }] });
});
