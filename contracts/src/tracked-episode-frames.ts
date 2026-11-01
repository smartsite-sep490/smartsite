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
