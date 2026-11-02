import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseSafetyEpisodeInboxOptions,
  parseSafetyEpisodeInboxPage,
  parseSafetyEpisodeReadResponse,
} from '../src/safety-episode-inbox-response.js';
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const time = '2026-11-02T03:00:00.000Z';
const page = () => ({
  items: [
    {
      id,
      episode: {
        id: other,
        siteId: id,
        cameraId: other,
        subject: { kind: 'TRACKED', segmentId: other, scopeSha256: 'a'.repeat(64) },
        configurationBundleId: null,
        firstObservedAt: time,
        lastObservedAt: time,
        contentRevision: 2,
        collectionState: 'COLLECTING',
        findingCount: 2,
      },
      seenRevision: 1,
      unread: true,
      firstDeliveredAt: time,
      updatedAt: time,
    },
  ],
  total: 1,
  unreadCount: 1,
});
test('inbox options snapshot defaults and reject coercion, extras and accessors', () => {
  assert.deepEqual(parseSafetyEpisodeInboxOptions({}), { offset: 0, limit: 20, readStatus: 'ALL' });
  const uppercase = 'ABCDEFAB-1111-4111-8111-111111111111';
  assert.equal(
    parseSafetyEpisodeInboxOptions({ siteId: uppercase })?.siteId,
    uppercase.toLowerCase(),
  );
  for (const value of [
    { limit: 101 },
    { offset: -1 },
    { limit: '20' },
    { readStatus: 'other' },
    { recipient: id },
  ])
    assert.equal(parseSafetyEpisodeInboxOptions(value), null);
  let reads = 0;
  const getter = Object.defineProperty({}, 'siteId', {
    enumerable: true,
    get() {
      reads++;
      return id;
    },
  });
  assert.equal(parseSafetyEpisodeInboxOptions(getter), null);
  assert.equal(reads, 0);
});
test('mixed inbox summaries are detached, preserve TRACKED and explicit EVENT_LOCAL, accept empty later page', () => {
  const many = page();
  many.items[0]!.episode.findingCount = 300;
  assert.ok(parseSafetyEpisodeInboxPage(many));
  const original = page();
  const result = parseSafetyEpisodeInboxPage(original, { siteId: id });
  assert.ok(result);
  assert.equal(result.items[0]!.episode.subject.kind, 'TRACKED');
  original.items[0]!.episode.subject.scopeSha256 = 'b'.repeat(64);
  assert.equal(
    result.items[0]!.episode.subject.kind === 'TRACKED' &&
      result.items[0]!.episode.subject.scopeSha256,
    'a'.repeat(64),
  );
  const legacy = page();
  Object.assign(legacy.items[0]!.episode, {
    subject: { kind: 'EVENT_LOCAL', eventId: id, personObservationIndex: 0 },
  });
  assert.ok(parseSafetyEpisodeInboxPage(legacy));
  assert.ok(parseSafetyEpisodeInboxPage({ items: [], total: 1, unreadCount: 0 }, { offset: 20 }));
});
test('inbox rejects wrong scope, false unread/counts, duplicate subjects, mixed metadata and unsafe revisions', () => {
  for (const mutate of [
    (p: ReturnType<typeof page>) => {
      p.items[0]!.episode.siteId = other;
    },
    (p: ReturnType<typeof page>) => {
      p.items[0]!.unread = false;
    },
    (p: ReturnType<typeof page>) => {
      p.items[0]!.seenRevision = 3;
    },
    (p: ReturnType<typeof page>) => {
      p.items[0]!.episode.contentRevision = Number.MAX_SAFE_INTEGER + 1;
    },
    (p: ReturnType<typeof page>) => {
      p.unreadCount = 2;
    },
    (p: ReturnType<typeof page>) => {
      p.items[0]!.unread = false;
      p.items[0]!.seenRevision = 2;
    },
    (p: ReturnType<typeof page>) => {
      p.items.push(p.items[0]!);
      p.total = 2;
      p.unreadCount = 2;
    },
    (p: ReturnType<typeof page>) => {
      Object.assign(p.items[0]!.episode.subject, { eventId: id });
    },
    (p: ReturnType<typeof page>) => {
      p.items[0]!.episode.lastObservedAt = 'invalid';
    },
  ]) {
    const p = page();
    mutate(p);
    assert.equal(parseSafetyEpisodeInboxPage(p, { siteId: id }), null);
  }
  const read = page();
  read.items[0]!.seenRevision = 2;
  read.items[0]!.unread = false;
  read.unreadCount = 0;
  assert.equal(parseSafetyEpisodeInboxPage(read, { readStatus: 'UNREAD' }), null);
  const getter = page();
  let reads = 0;
  Object.defineProperty(getter.items[0]!.episode, 'subject', {
    enumerable: true,
    get() {
      reads++;
      return {};
    },
  });
  assert.equal(parseSafetyEpisodeInboxPage(getter), null);
  assert.equal(reads, 0);
});
test('read reply binds exact recipient and displayed revision without swallowing unseen material changes', () => {
  const reply = { id, contentRevision: 3, seenRevision: 2, unread: true };
  assert.deepEqual(parseSafetyEpisodeReadResponse(reply, id, 2), reply);
  assert.ok(parseSafetyEpisodeReadResponse({ ...reply, seenRevision: 3, unread: false }, id, 2));
  for (const value of [
    { ...reply, id: other },
    { ...reply, seenRevision: 1 },
    { ...reply, unread: false },
    { ...reply, seenRevision: 4 },
    { ...reply, extra: true },
  ])
    assert.equal(parseSafetyEpisodeReadResponse(value, id, 2), null);
});
