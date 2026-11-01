import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseTrackedEpisodeObservationQuery,
  parseTrackedEpisodeMediaQuery,
  parseTrackedEpisodeObservationPage,
} from '../src/tracked-episode-frames.js';
const alertId = '11111111-1111-4111-8111-111111111111';
test('observation HTTP query retains uint64 text and bounded page controls', () => {
  assert.deepEqual(parseTrackedEpisodeObservationQuery({}), {});
  assert.deepEqual(
    parseTrackedEpisodeObservationQuery({
      offset: '20',
      limit: '10',
      throughSequence: '18446744073709551615',
      alertId,
    }),
    { offset: 20, limit: 10, throughSequence: '18446744073709551615', alertId },
  );
});

const episodeId = '22222222-2222-4222-8222-222222222222',
  eventId = '33333333-3333-4333-8333-333333333333';
const page = () => ({
  episodeId,
  contentRevision: 2,
  throughSequence: '9007199254740993',
  offset: 0,
  limit: 20,
  total: 1,
  hasMore: false,
  items: [
    {
      alertId,
      eventId,
      personObservationIndex: 0,
      payloadHash: 'a'.repeat(64),
      sourceSequence: '9007199254740993',
      capturedAt: '2026-11-01T10:00:00.123456789Z',
      observationIndexes: [1, 2],
      frames: [{ evidenceIndex: 0, sha256: 'b'.repeat(64) }],
    },
  ],
});
test('response parser binds episode/page/finding fence and preserves original uint64 nanosecond text', () => {
  const input = page(),
    result = parseTrackedEpisodeObservationPage(input, episodeId, {});
  assert.deepEqual(result, input);
  assert.notEqual(result, input);
  assert.notEqual(result?.items, input.items);
  assert.equal(parseTrackedEpisodeObservationPage(input, eventId, {}), null);
  assert.equal(parseTrackedEpisodeObservationPage(input, episodeId, { alertId: eventId }), null);
  assert.equal(parseTrackedEpisodeObservationPage(input, episodeId, { offset: 1 }), null);
  assert.equal(
    parseTrackedEpisodeObservationPage(input, episodeId, { throughSequence: '2' }),
    null,
  );
});
test('response parser rejects malformed consistency fields duplicate sources and hidden metadata', () => {
  for (const change of [
    { hasMore: true },
    { total: 0 },
    { limit: 21 },
    { contentRevision: 0 },
    { items: [...page().items, ...page().items] },
    { throughSequence: '18446744073709551616' },
    { uri: 'local://private' },
  ])
    assert.equal(parseTrackedEpisodeObservationPage({ ...page(), ...change }, episodeId, {}), null);
  for (const change of [
    { sourceSequence: 9007199254740992 },
    { sourceSequence: '9007199254740994' },
    { observationIndexes: [1, 1] },
    { frames: [{ evidenceIndex: 0, sha256: 'bad' }] },
    { frames: [...page().items[0]!.frames, ...page().items[0]!.frames] },
    { personObservationIndex: 256 },
    { capturedAt: 'yesterday' },
    { workerId: eventId },
  ])
    assert.equal(
      parseTrackedEpisodeObservationPage(
        { ...page(), items: [{ ...page().items[0], ...change }] },
        episodeId,
        {},
      ),
      null,
    );
  let reads = 0;
  const input = page();
  Object.defineProperty(input.items[0], 'frames', {
    enumerable: true,
    get() {
      reads++;
      return [];
    },
  });
  assert.equal(parseTrackedEpisodeObservationPage(input, episodeId, {}), null);
  assert.equal(reads, 0);
});
test('response cannot give conflicting immutable headers for the same event across findings', () => {
  const p = page();
  p.total = 2;
  p.items.push({ ...p.items[0]!, alertId: episodeId, payloadHash: 'c'.repeat(64) });
  assert.equal(parseTrackedEpisodeObservationPage(p, episodeId, {}), null);
});
test('observation query rejects coercion overflow extra flags and duplicate arrays', () => {
  for (const input of [
    { limit: '0' },
    { limit: '21' },
    { offset: '9007199254740992' },
    { offset: '01' },
    { offset: 0 },
    { limit: ['1', '2'] },
    { throughSequence: Number('9007199254740993') },
    { throughSequence: '18446744073709551616' },
    { throughSequence: '01' },
    { alertId: 'bad' },
    { siteId: alertId },
    { allowLegacy: 'true' },
    { limit: undefined },
    null,
    [],
  ])
    assert.equal(parseTrackedEpisodeObservationQuery(input), null, JSON.stringify(input));
});
test('media query explicitly chooses full frame or mechanical subject crop', () => {
  assert.deepEqual(
    parseTrackedEpisodeMediaQuery({ personObservationIndex: '0', evidenceIndex: '255' }),
    { personObservationIndex: 0, evidenceIndex: 255, representation: 'FRAME' },
  );
  assert.deepEqual(
    parseTrackedEpisodeMediaQuery({
      personObservationIndex: '1',
      evidenceIndex: '0',
      representation: 'SUBJECT',
    }),
    { personObservationIndex: 1, evidenceIndex: 0, representation: 'SUBJECT' },
  );
  for (const input of [
    {},
    { personObservationIndex: '256', evidenceIndex: '0' },
    { personObservationIndex: '0', evidenceIndex: '-1' },
    { personObservationIndex: '0', evidenceIndex: '0', representation: 'FACE' },
    { personObservationIndex: '0', evidenceIndex: '0', identity: 'KNOWN' },
  ])
    assert.equal(parseTrackedEpisodeMediaQuery(input), null);
});
test('both query parsers reject accessors without invoking untrusted getters', () => {
  let reads = 0;
  const input = Object.defineProperty({}, 'limit', {
    enumerable: true,
    get() {
      reads++;
      throw Error('getter');
    },
  });
  assert.equal(parseTrackedEpisodeObservationQuery(input), null);
  assert.equal(parseTrackedEpisodeMediaQuery(input), null);
  assert.equal(reads, 0);
});
test('both query parsers reject prototype symbols hidden fields and thrown proxy traps', () => {
  for (const input of [
    new (class {
      limit = '1';
    })(),
    { [Symbol('role')]: 'ADMIN' },
    Object.defineProperty({}, 'limit', { value: '1' }),
    new Proxy(
      {},
      {
        ownKeys() {
          throw Error('trap');
        },
      },
    ),
  ]) {
    assert.equal(parseTrackedEpisodeObservationQuery(input), null);
    assert.equal(parseTrackedEpisodeMediaQuery(input), null);
  }
  assert.deepEqual(
    parseTrackedEpisodeObservationQuery(Object.assign(Object.create(null), { limit: '1' })),
    { limit: 1 },
  );
});
