/** Additive transport contract. The internal tracked reader is not registered by this module. */
export interface TrackedEpisodeObservationOptions {
  offset?: number;
  limit?: number;
  /** Keep the first page's exact upper fence for subsequent pages; never convert to Number. */
  throughSequence?: string;
  alertId?: string;
}
export interface TrackedEpisodeOriginalObservation {
  alertId: string;
  eventId: string;
  personObservationIndex: number;
  payloadHash: string;
  sourceSequence: string;
  capturedAt: string;
  observationIndexes: number[];
  /** Descriptors only. Availability requires an authenticated media read and SHA verification. */
  frames: { evidenceIndex: number; sha256: string }[];
}
export interface TrackedEpisodeObservationPage {
  episodeId: string;
  contentRevision: number;
  throughSequence: string;
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  items: TrackedEpisodeOriginalObservation[];
}
export type TrackedEpisodeMediaRepresentation = 'FRAME' | 'SUBJECT';
export interface TrackedEpisodeMediaQuery {
  personObservationIndex: number;
  evidenceIndex: number;
  representation: TrackedEpisodeMediaRepresentation;
}
export interface TrackedEpisodeMediaSource {
  alertId: string;
  eventId: string;
  personObservationIndex: number;
  evidenceIndex: number;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fields(input: unknown, allowed: readonly string[]): Record<string, string> | null {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return null;
  const result: Record<string, string> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !allowed.includes(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !('value' in descriptor) || typeof descriptor.value !== 'string')
      return null;
    result[key] = descriptor.value;
  }
  return result;
}
function integer(value: string, max: number): number | null {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= max ? number : null;
}
/** Exact HTTP query parsing only. Site, episode, finding and actor are authorized by Backend. */
export function parseTrackedEpisodeObservationQuery(
  input: unknown,
): TrackedEpisodeObservationOptions | null {
  try {
    const value = fields(input, ['offset', 'limit', 'throughSequence', 'alertId']);
    if (!value) return null;
    const result: TrackedEpisodeObservationOptions = {};
    if (value.offset !== undefined) {
      const n = integer(value.offset, Number.MAX_SAFE_INTEGER);
      if (n === null) return null;
      result.offset = n;
    }
    if (value.limit !== undefined) {
      const n = integer(value.limit, 20);
      if (n === null || n < 1) return null;
      result.limit = n;
    }
    if (value.throughSequence !== undefined) {
      if (
        !/^(0|[1-9][0-9]{0,19})$/.test(value.throughSequence) ||
        BigInt(value.throughSequence) > 18446744073709551615n
      )
        return null;
      result.throughSequence = value.throughSequence;
    }
    if (value.alertId !== undefined) {
      if (!UUID.test(value.alertId)) return null;
      result.alertId = value.alertId.toLowerCase();
    }
    return result;
  } catch {
    return null;
  }
}
/** SUBJECT means a mechanical original PERSON crop, never Face/Worker identity. */
export function parseTrackedEpisodeMediaQuery(input: unknown): TrackedEpisodeMediaQuery | null {
  try {
    const value = fields(input, ['personObservationIndex', 'evidenceIndex', 'representation']);
    if (!value) return null;
    if (value.personObservationIndex === undefined || value.evidenceIndex === undefined)
      return null;
    const personObservationIndex = integer(value.personObservationIndex, 255),
      evidenceIndex = integer(value.evidenceIndex, 255);
    const representation = value.representation ?? 'FRAME';
    if (
      personObservationIndex === null ||
      evidenceIndex === null ||
      !['FRAME', 'SUBJECT'].includes(representation)
    )
      return null;
    return {
      personObservationIndex,
      evidenceIndex,
      representation: representation as TrackedEpisodeMediaRepresentation,
    };
  } catch {
    return null;
  }
}

function objectFields(input: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return null;
  const own = Reflect.ownKeys(input);
  if (own.length !== keys.length) return null;
  const result: Record<string, unknown> = {};
  for (const key of own) {
    if (typeof key !== 'string' || !keys.includes(key)) return null;
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (!field?.enumerable || !('value' in field)) return null;
    result[key] = field.value;
  }
  return result;
}
function arrayValues(input: unknown, max: number): unknown[] | null {
  if (
    !Array.isArray(input) ||
    input.length > max ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    Reflect.ownKeys(input).length !== input.length + 1
  )
    return null;
  const values = [];
  for (let i = 0; i < input.length; i++) {
    const d = Object.getOwnPropertyDescriptor(input, String(i));
    if (!d?.enumerable || !('value' in d)) return null;
    values.push(d.value);
  }
  return values;
}
const uint64 = (v: unknown): v is string =>
  typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n;
const safe = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
const id = (v: unknown): v is string =>
  typeof v === 'string' && UUID.test(v) && v === v.toLowerCase();
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const time = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d\d-\d\d[Tt](?:[01]\d|2[0-3]):[0-5]\d:(?:[0-5]\d|60)(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
    v,
  ) &&
  Number.isFinite(Date.parse(v.replace(/:60(?=\.|[Zz]|[+-])/, ':59')));

/** Runtime response validation against the exact requested episode, page and optional finding.
 * Shape/hash descriptors are not a claim that bytes are available or a Worker is identified.
 */
export function parseTrackedEpisodeObservationPage(
  input: unknown,
  episodeId: string,
  options: TrackedEpisodeObservationOptions = {},
): TrackedEpisodeObservationPage | null {
  try {
    if (!id(episodeId)) return null;
    const p = objectFields(input, [
      'episodeId',
      'contentRevision',
      'throughSequence',
      'offset',
      'limit',
      'total',
      'hasMore',
      'items',
    ]);
    if (
      !p ||
      p.episodeId !== episodeId ||
      !safe(p.contentRevision, 2147483647) ||
      p.contentRevision < 1 ||
      !uint64(p.throughSequence) ||
      !safe(p.offset) ||
      !safe(p.limit, 20) ||
      p.limit < 1 ||
      !safe(p.total) ||
      typeof p.hasMore !== 'boolean' ||
      p.offset !== (options.offset ?? 0) ||
      p.limit !== (options.limit ?? 20) ||
      (options.throughSequence !== undefined && p.throughSequence !== options.throughSequence)
    )
      return null;
    const rawItems = arrayValues(p.items, p.limit);
    if (!rawItems) return null;
    const expected = Math.min(p.limit, Math.max(0, p.total - p.offset));
    if (rawItems.length !== expected || p.hasMore !== p.offset + rawItems.length < p.total)
      return null;
    const items: TrackedEpisodeOriginalObservation[] = [],
      seen = new Set<string>();
    const eventHeaders = new Map<string, string>();
    let previous: bigint | null = null;
    for (const raw of rawItems) {
      const item = objectFields(raw, [
        'alertId',
        'eventId',
        'personObservationIndex',
        'payloadHash',
        'sourceSequence',
        'capturedAt',
        'observationIndexes',
        'frames',
      ]);
      if (
        !item ||
        !id(item.alertId) ||
        !id(item.eventId) ||
        !safe(item.personObservationIndex, 255) ||
        !hash(item.payloadHash) ||
        !uint64(item.sourceSequence) ||
        BigInt(item.sourceSequence) > BigInt(p.throughSequence) ||
        !time(item.capturedAt) ||
        (options.alertId !== undefined && item.alertId !== options.alertId.toLowerCase())
      )
        return null;
      const current = BigInt(item.sourceSequence);
      if (previous !== null && current > previous) return null;
      previous = current;
      const key = `${item.alertId}:${item.eventId}:${item.personObservationIndex}`;
      if (seen.has(key)) return null;
      seen.add(key);
      const indexes = arrayValues(item.observationIndexes, 256),
        rawFrames = arrayValues(item.frames, 256);
      if (
        !indexes?.length ||
        !rawFrames ||
        indexes.some((i) => !safe(i, 255) || i === item.personObservationIndex) ||
        new Set(indexes).size !== indexes.length
      )
        return null;
      const frames: { evidenceIndex: number; sha256: string }[] = [];
      const frameIndexes = new Set<number>();
      for (const rawFrame of rawFrames) {
        const frame = objectFields(rawFrame, ['evidenceIndex', 'sha256']);
        if (
          !frame ||
          !safe(frame.evidenceIndex, 255) ||
          !hash(frame.sha256) ||
          frameIndexes.has(frame.evidenceIndex)
        )
          return null;
        frameIndexes.add(frame.evidenceIndex);
        frames.push({ evidenceIndex: frame.evidenceIndex, sha256: frame.sha256 });
      }
      const header = JSON.stringify([
        item.payloadHash,
        item.sourceSequence,
        item.capturedAt,
        frames,
      ]);
      if (eventHeaders.has(item.eventId) && eventHeaders.get(item.eventId) !== header) return null;
      eventHeaders.set(item.eventId, header);
      items.push({
        alertId: item.alertId,
        eventId: item.eventId,
        personObservationIndex: item.personObservationIndex,
        payloadHash: item.payloadHash,
        sourceSequence: item.sourceSequence,
        capturedAt: item.capturedAt,
        observationIndexes: indexes as number[],
        frames,
      });
    }
    return {
      episodeId,
      contentRevision: p.contentRevision,
      throughSequence: p.throughSequence,
      offset: p.offset,
      limit: p.limit,
      total: p.total,
      hasMore: p.hasMore,
      items,
    };
  } catch {
    return null;
  }
}
