import type {
  SafetyEpisodeInboxOptions,
  SafetyEpisodeInboxPage,
  SafetyEpisodeInboxSummary,
  SafetyEpisodeReadResponse,
} from './safety-episode-api.js';

function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> | null {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return null;
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || ![...required, ...optional].includes(key)) return null;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d?.enumerable || !('value' in d)) return null;
    result[key] = d.value;
  }
  return required.every((key) => Object.hasOwn(result, key)) ? result : null;
}
const safe = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const time = (v: unknown): v is string =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const attempt = <T>(read: () => T | null): T | null => {
  try {
    return read();
  } catch {
    return null;
  }
};

export function parseSafetyEpisodeInboxOptions(
  value: unknown,
):
  | (Required<Pick<SafetyEpisodeInboxOptions, 'offset' | 'limit' | 'readStatus'>> &
      Pick<SafetyEpisodeInboxOptions, 'siteId'>)
  | null {
  return attempt(() => {
    const v = fields(value, [], ['offset', 'limit', 'siteId', 'readStatus']);
    if (!v) return null;
    const offset = v.offset === undefined ? 0 : v.offset,
      limit = v.limit === undefined ? 20 : v.limit,
      readStatus = v.readStatus === undefined ? 'ALL' : v.readStatus;
    if (
      !safe(offset) ||
      !safe(limit, 100) ||
      limit < 1 ||
      (readStatus !== 'ALL' && readStatus !== 'UNREAD') ||
      (v.siteId !== undefined && (typeof v.siteId !== 'string' || !uuid(v.siteId.toLowerCase())))
    )
      return null;
    return {
      offset,
      limit,
      readStatus: readStatus as 'ALL' | 'UNREAD',
      ...(v.siteId === undefined ? {} : { siteId: (v.siteId as string).toLowerCase() }),
    };
  });
}

function summary(value: unknown): SafetyEpisodeInboxSummary | null {
  const v = fields(value, [
    'id',
    'siteId',
    'cameraId',
    'subject',
    'configurationBundleId',
    'firstObservedAt',
    'lastObservedAt',
    'contentRevision',
    'collectionState',
    'findingCount',
  ]);
  if (
    !v ||
    !uuid(v.id) ||
    !uuid(v.siteId) ||
    !uuid(v.cameraId) ||
    v.configurationBundleId !== null ||
    !time(v.firstObservedAt) ||
    !time(v.lastObservedAt) ||
    v.lastObservedAt < v.firstObservedAt ||
    !safe(v.contentRevision, 2147483647) ||
    v.contentRevision < 1 ||
    !safe(v.findingCount) ||
    v.findingCount < 1 ||
    (v.collectionState !== 'COLLECTING' && v.collectionState !== 'SEALED')
  )
    return null;
  const tracked = fields(v.subject, ['kind', 'segmentId', 'scopeSha256']);
  const local = fields(v.subject, ['kind', 'eventId', 'personObservationIndex']);
  let subject: SafetyEpisodeInboxSummary['subject'];
  if (
    tracked?.kind === 'TRACKED' &&
    uuid(tracked.segmentId) &&
    typeof tracked.scopeSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(tracked.scopeSha256)
  )
    subject = { kind: 'TRACKED', segmentId: tracked.segmentId, scopeSha256: tracked.scopeSha256 };
  else if (
    local?.kind === 'EVENT_LOCAL' &&
    uuid(local.eventId) &&
    safe(local.personObservationIndex, 255)
  )
    subject = {
      kind: 'EVENT_LOCAL',
      eventId: local.eventId,
      personObservationIndex: local.personObservationIndex,
    };
  else return null;
  return {
    id: v.id,
    siteId: v.siteId,
    cameraId: v.cameraId,
    subject,
    configurationBundleId: null,
    firstObservedAt: v.firstObservedAt,
    lastObservedAt: v.lastObservedAt,
    contentRevision: v.contentRevision,
    collectionState: v.collectionState as 'COLLECTING' | 'SEALED',
    findingCount: v.findingCount,
  };
}

export function parseSafetyEpisodeInboxPage(
  value: unknown,
  options: SafetyEpisodeInboxOptions = {},
): SafetyEpisodeInboxPage | null {
  return attempt(() => {
    const expected = parseSafetyEpisodeInboxOptions(options),
      v = fields(value, ['items', 'total', 'unreadCount']);
    if (
      !expected ||
      !v ||
      !safe(v.total) ||
      !safe(v.unreadCount) ||
      v.unreadCount > v.total ||
      !Array.isArray(v.items) ||
      Object.getPrototypeOf(v.items) !== Array.prototype ||
      v.items.length > expected.limit ||
      Reflect.ownKeys(v.items).length !== v.items.length + 1 ||
      v.items.length !== Math.min(expected.limit, Math.max(0, v.total - expected.offset)) ||
      (expected.readStatus === 'UNREAD' && v.total !== v.unreadCount)
    )
      return null;
    const items: SafetyEpisodeInboxPage['items'] = [],
      ids = new Set<string>(),
      episodes = new Set<string>();
    for (let i = 0; i < v.items.length; i++) {
      const d = Object.getOwnPropertyDescriptor(v.items, String(i));
      if (!d?.enumerable || !('value' in d)) return null;
      const row = fields(d.value, [
        'id',
        'episode',
        'seenRevision',
        'unread',
        'firstDeliveredAt',
        'updatedAt',
      ]);
      if (!row) return null;
      const e = summary(row.episode);
      if (
        !e ||
        !uuid(row.id) ||
        ids.has(row.id) ||
        episodes.has(e.id) ||
        (expected.siteId !== undefined && e.siteId !== expected.siteId) ||
        !safe(row.seenRevision, e.contentRevision) ||
        typeof row.unread !== 'boolean' ||
        row.unread !== row.seenRevision < e.contentRevision ||
        (expected.readStatus === 'UNREAD' && !row.unread) ||
        !time(row.firstDeliveredAt) ||
        !time(row.updatedAt) ||
        row.updatedAt < row.firstDeliveredAt
      )
        return null;
      ids.add(row.id);
      episodes.add(e.id);
      items.push({
        id: row.id,
        episode: e,
        seenRevision: row.seenRevision,
        unread: row.unread,
        firstDeliveredAt: row.firstDeliveredAt,
        updatedAt: row.updatedAt,
      });
    }
    const pageUnread = items.filter((i) => i.unread).length;
    if (pageUnread > v.unreadCount || items.length - pageUnread > v.total - v.unreadCount)
      return null;
    return { items, total: v.total, unreadCount: v.unreadCount };
  });
}

export function parseSafetyEpisodeReadResponse(
  value: unknown,
  id: string,
  displayedRevision: number,
): SafetyEpisodeReadResponse | null {
  return attempt(() => {
    const v = fields(value, ['id', 'contentRevision', 'seenRevision', 'unread']);
    if (
      !v ||
      !uuid(id) ||
      v.id !== id ||
      !safe(displayedRevision, 2147483647) ||
      displayedRevision < 1 ||
      !safe(v.contentRevision, 2147483647) ||
      v.contentRevision < displayedRevision ||
      !safe(v.seenRevision, v.contentRevision) ||
      v.seenRevision < displayedRevision ||
      typeof v.unread !== 'boolean' ||
      v.unread !== v.seenRevision < v.contentRevision
    )
      return null;
    return {
      id,
      contentRevision: v.contentRevision,
      seenRevision: v.seenRevision,
      unread: v.unread,
    };
  });
}
