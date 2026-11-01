import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as tracked from '../src/tracked-episode-frames.js';
import {
  parseTrackedEpisodeObservationQuery,
  parseTrackedEpisodeMediaQuery,
  parseTrackedEpisodeObservationPage,
} from '../src/tracked-episode-frames.js';
const alertId = '11111111-1111-4111-8111-111111111111';
const identitySource = {
  alertId,
  eventId: '33333333-3333-4333-8333-333333333333',
  personObservationIndex: 0,
  evidenceIndex: 0,
};
const identity = () => ({
  episodeId: '22222222-2222-4222-8222-222222222222',
  siteId: alertId,
  source: { ...identitySource },
  subjectRef: {
    eventId: identitySource.eventId,
    personObservationIndex: 0,
    payloadHash: 'a'.repeat(64),
    cameraId: '44444444-4444-4444-8444-444444444444',
    cameraExternalId: 'synthetic-camera',
    streamSessionId: '55555555-5555-4555-8555-555555555555',
    capturedAt: '2026-11-01T10:00:00.000000001Z',
    trackId: 1,
    personBoundingBox: { x1: 0.1, y1: 0.1, x2: 0.6, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
  },
  revision: 0,
  latestDecision: null as unknown,
});
test('tracked identity preserves exact original scope and explicit CLEAR without borrowing another frame', () => {
  const parse = Reflect.get(tracked, 'parseTrackedObservationIdentity');
  assert.equal(typeof parse, 'function');
  const input = identity();
  assert.deepEqual(parse(input, alertId, input.episodeId, identitySource, 'a'.repeat(64)), input);
  input.revision = 1;
  input.latestDecision = {
    id: '66666666-6666-4666-8666-666666666666',
    revision: 1,
    action: 'CLEAR',
    workerId: null,
    actorUserId: '77777777-7777-4777-8777-777777777777',
    reason: 'Synthetic clear fixture',
    scope: 'EXACT_OBSERVATION',
    verificationMethod: 'MANUAL',
    recordedAt: '2026-11-01T11:00:00Z',
    subjectRef: structuredClone(input.subjectRef),
    evidenceIndex: null,
    evidenceSha256: null,
  };
  const result = parse(input, alertId, input.episodeId, identitySource, 'a'.repeat(64));
  assert.ok(result && result.latestDecision);
  assert.equal(result.latestDecision.action, 'CLEAR');
  input.subjectRef.personBoundingBox.x1 = 0.2;
  assert.equal(result.subjectRef.personBoundingBox.x1, 0.1);
});
test('tracked identity rejects mismatched hash/person/revision, foreign decision refs and nested getters', () => {
  const parse = Reflect.get(tracked, 'parseTrackedObservationIdentity');
  assert.equal(typeof parse, 'function');
  const base = identity();
  const foreignDecision = {
    id: '66666666-6666-4666-8666-666666666666',
    revision: 1,
    action: 'CLEAR',
    workerId: null,
    actorUserId: '77777777-7777-4777-8777-777777777777',
    reason: 'Synthetic clear fixture',
    scope: 'EXACT_OBSERVATION',
    verificationMethod: 'MANUAL',
    recordedAt: '2026-11-01T11:00:00Z',
    subjectRef: { ...base.subjectRef, capturedAt: '2026-11-01T10:00:00.000000002Z' },
    evidenceIndex: null,
    evidenceSha256: null,
  };
  for (const input of [
    { ...base, revision: 1 },
    { ...base, source: { ...identitySource, personObservationIndex: 1 } },
    { ...base, subjectRef: { ...base.subjectRef, payloadHash: 'b'.repeat(64) } },
    { ...base, workerId: alertId },
    { ...base, subjectRef: { ...base.subjectRef, personObservationIndex: 1 } },
    { ...base, revision: 1, latestDecision: foreignDecision },
    {
      ...base,
      revision: 1,
      latestDecision: {
        ...foreignDecision,
        subjectRef: {
          ...base.subjectRef,
          personBoundingBox: { ...base.subjectRef.personBoundingBox, x1: 0.2 },
        },
      },
    },
  ])
    assert.equal(parse(input, alertId, base.episodeId, identitySource, 'a'.repeat(64)), null);
  let calls = 0;
  const getter = Object.defineProperty({ ...base.subjectRef }, 'capturedAt', {
    enumerable: true,
    get() {
      calls++;
      return base.subjectRef.capturedAt;
    },
  });
  assert.equal(
    parse({ ...base, subjectRef: getter }, alertId, base.episodeId, identitySource, 'a'.repeat(64)),
    null,
  );
  assert.equal(calls, 0);
});
const detail = () => ({
  episodeId: '22222222-2222-4222-8222-222222222222',
  siteId: alertId,
  cameraId: '33333333-3333-4333-8333-333333333333',
  subject: {
    kind: 'TRACKED',
    segmentId: '44444444-4444-4444-8444-444444444444',
    scopeSha256: 'a'.repeat(64),
  },
  firstObservedAt: '2026-11-01T10:00:00.000001Z',
  lastObservedAt: '2026-11-01T10:01:00.000002Z',
  contentRevision: 2,
  collectionState: 'COLLECTING',
  findings: [
    {
      alertId,
      alertType: 'PPE_VIOLATION',
      candidateSubtype: 'MISSING_HARD_HAT',
      status: 'PENDING_REVIEW',
      alertRevision: 0,
      zoneId: null,
      observationCount: 3,
    },
  ],
});
test('tracked detail binds Site/episode and detaches metadata without anchor identity/evidence', () => {
  const parse = Reflect.get(tracked, 'parseTrackedEpisodeDetail');
  assert.equal(typeof parse, 'function');
  const input = detail();
  const result = parse(input, input.siteId, input.episodeId);
  assert.deepEqual(result, input);
  input.findings[0]!.observationCount = 99;
  assert.equal(result.findings[0].observationCount, 3);
  assert.equal(parse(detail(), input.cameraId, input.episodeId), null);
});
test('tracked detail rejects legacy subjects, duplicate findings, unsafe counts and unsolicited identity', () => {
  const parse = Reflect.get(tracked, 'parseTrackedEpisodeDetail');
  assert.equal(typeof parse, 'function');
  const base = detail();
  for (const input of [
    { ...base, subject: { kind: 'EVENT_LOCAL', eventId: alertId, personObservationIndex: 0 } },
    { ...base, subject: { ...base.subject, workerId: alertId } },
    { ...base, findings: [base.findings[0], base.findings[0]] },
    { ...base, findings: [] },
    { ...base, findings: Array(257).fill(base.findings[0]) },
    { ...base, findings: [{ ...base.findings[0], observationCount: 0 }] },
    { ...base, findings: [{ ...base.findings[0], status: 'SAFE' }] },
    { ...base, findings: [{ ...base.findings[0], alertRevision: -1 }] },
    { ...base, identityDecision: { workerId: alertId } },
    { ...base, contentRevision: Number.MAX_SAFE_INTEGER },
    { ...base, lastObservedAt: '2026-10-01T00:00:00Z' },
    Object.defineProperty({ ...base }, 'cameraId', {
      get() {
        throw new Error('Do not invoke');
      },
    }),
  ])
    assert.equal(parse(input, base.siteId, base.episodeId), null);
});
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
