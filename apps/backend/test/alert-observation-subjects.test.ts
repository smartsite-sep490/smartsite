import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveAlertObservationSubjects } from '../src/modules/safety/alerts/alert-observation-subjects.js';

const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const person = (trackId: number) => ({ type: 'PERSON', trackId });
const ppe = (trackId: number) => ({ type: 'PPE', trackId });

test('three flagged people among ten retain exact original indices and separate findings', () => {
  const observations = Array.from({ length: 10 }, (_, track) => [ppe(track), person(track)]).flat();
  const original = structuredClone(observations);
  const result = resolveAlertObservationSubjects(eventId, observations, [
    { alertId: 'hat-2', trackId: 2 },
    { alertId: 'vest-2', trackId: 2 },
    { alertId: 'hat-5', trackId: 5 },
    { alertId: 'vest-5', trackId: 5 },
    { alertId: 'zone-9', trackId: 9 },
  ]);
  assert.deepEqual(
    [...result],
    [
      ['hat-2', 5],
      ['vest-2', 5],
      ['hat-5', 11],
      ['vest-5', 11],
      ['zone-9', 19],
    ],
  );
  assert.deepEqual(observations, original);
});

test('missing or duplicate PERSON remains unresolved, without losing the alert mapping', () => {
  const result = resolveAlertObservationSubjects(
    eventId,
    [ppe(0), person(1), person(1)],
    [
      { alertId: 'missing', trackId: 0 },
      { alertId: 'ambiguous', trackId: 1 },
    ],
  );
  assert.deepEqual(
    [...result],
    [
      ['missing', null],
      ['ambiguous', null],
    ],
  );
});

test('same alert with conflicting or unresolved subjects remains unresolved in either order', () => {
  for (const tracks of [
    [0, 1],
    [1, 0],
    [0, 99],
    [99, 0],
    [0, 1, 0],
  ]) {
    const result = resolveAlertObservationSubjects(
      eventId,
      [person(0), person(1)],
      tracks.map((trackId) => ({ alertId: 'shared', trackId })),
    );
    assert.deepEqual([...result], [['shared', null]]);
  }
});

test('repeated same subject is idempotent and track zero is valid', () => {
  const result = resolveAlertObservationSubjects(
    eventId,
    [person(0), ppe(0), ppe(0)],
    [
      { alertId: 'hat', trackId: 0 },
      { alertId: 'hat', trackId: 0 },
    ],
  );
  assert.deepEqual([...result], [['hat', 0]]);
});

test('a reused track is resolved from this event only, not from previous array order', () => {
  assert.equal(
    resolveAlertObservationSubjects(
      eventId,
      [ppe(3), person(3)],
      [{ alertId: 'legacy-cooldown-alert', trackId: 3 }],
    ).get('legacy-cooldown-alert'),
    1,
  );
  assert.equal(
    resolveAlertObservationSubjects(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      [person(3), ppe(3)],
      [{ alertId: 'legacy-cooldown-alert', trackId: 3 }],
    ).get('legacy-cooldown-alert'),
    0,
  );
});

test('invalid event or track cannot acquire a subject reference', () => {
  assert.equal(
    resolveAlertObservationSubjects('invalid', [person(1)], [{ alertId: 'a', trackId: 1 }]).get(
      'a',
    ),
    null,
  );
  for (const trackId of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
    assert.equal(
      resolveAlertObservationSubjects(eventId, [person(trackId)], [{ alertId: 'a', trackId }]).get(
        'a',
      ),
      null,
    );
  }
});
