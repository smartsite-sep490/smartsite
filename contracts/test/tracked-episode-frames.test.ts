import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseTrackedEpisodeObservationQuery,
  parseTrackedEpisodeMediaQuery,
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
