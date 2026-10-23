import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveEventLocalEpisodeSubject } from '../src/safety-episode-subject.js';

const eventId = '11111111-1111-4111-8111-111111111111';
const observations = [
  { type: 'PPE', trackId: 3 },
  { type: 'PERSON', trackId: 3 },
  { type: 'PPE', trackId: 3 },
  { type: 'PERSON', trackId: 7 },
  { type: 'PPE', trackId: 7 },
];

test('subject index addresses the original PERSON observation, not the filtered people list', () => {
  assert.deepEqual(resolveEventLocalEpisodeSubject(eventId, observations, 1), {
    kind: 'EVENT_LOCAL',
    eventId,
    personObservationIndex: 1,
  });
  assert.deepEqual(resolveEventLocalEpisodeSubject(eventId, observations, 3), {
    kind: 'EVENT_LOCAL',
    eventId,
    personObservationIndex: 3,
  });
  assert.equal(resolveEventLocalEpisodeSubject(eventId, observations, 0), null);
});

test('repeated PPE records do not create people or confuse two people in one frame', () => {
  const first = resolveEventLocalEpisodeSubject(eventId, observations, 1);
  assert.deepEqual(resolveEventLocalEpisodeSubject(eventId, observations, 1), first);
  assert.notDeepEqual(resolveEventLocalEpisodeSubject(eventId, observations, 3), first);
  assert.equal(resolveEventLocalEpisodeSubject(eventId, [{ type: 'PPE', trackId: 3 }], 0), null);
});

test('reused track IDs in another event never imply continuous identity', () => {
  const nextEvent = '22222222-2222-4222-8222-222222222222';
  assert.notDeepEqual(
    resolveEventLocalEpisodeSubject(nextEvent, observations, 1),
    resolveEventLocalEpisodeSubject(eventId, observations, 1),
  );
});

test('three flagged people among ten retain three distinct references, not one frame-wide subject', () => {
  const crowd = Array.from({ length: 10 }, (_, trackId) => ({ type: 'PERSON', trackId }));
  crowd.push(
    ...[2, 5, 8].flatMap((trackId) => [
      { type: 'PPE', trackId },
      { type: 'PPE', trackId },
    ]),
  );
  const subjects = [2, 5, 8].map((index) => resolveEventLocalEpisodeSubject(eventId, crowd, index));
  assert(subjects.every((subject) => subject !== null));
  assert.deepEqual(
    subjects.map((subject) => subject!.personObservationIndex),
    [2, 5, 8],
  );
  assert.equal(new Set(subjects.map((subject) => JSON.stringify(subject))).size, 3);
  assert.equal(resolveEventLocalEpisodeSubject(eventId, crowd, 10), null);
});

test('ambiguous duplicate PERSON tracks cannot be attached to an episode', () => {
  const duplicate = [...observations, { type: 'PERSON', trackId: 3 }];
  assert.equal(resolveEventLocalEpisodeSubject(eventId, duplicate, 1), null);
  assert.equal(resolveEventLocalEpisodeSubject(eventId, duplicate, 5), null);
  assert.ok(resolveEventLocalEpisodeSubject(eventId, duplicate, 3));
});

test('invalid event identifiers, indices and unsafe tracks fail closed; track zero is valid', () => {
  for (const id of ['', 'not-a-uuid', `${eventId} `])
    assert.equal(resolveEventLocalEpisodeSubject(id, observations, 1), null);
  for (const index of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, 5])
    assert.equal(resolveEventLocalEpisodeSubject(eventId, observations, index), null);
  for (const trackId of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(resolveEventLocalEpisodeSubject(eventId, [{ type: 'PERSON', trackId }], 0), null);
  assert.ok(resolveEventLocalEpisodeSubject(eventId, [{ type: 'PERSON', trackId: 0 }], 0));
});

test('UUID casing is normalized and source observations stay immutable', () => {
  const id = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
  const frozen = Object.freeze(observations.map((row) => Object.freeze({ ...row })));
  assert.equal(resolveEventLocalEpisodeSubject(id, frozen, 1)?.eventId, id.toLowerCase());
  assert.deepEqual(frozen, observations);
});
