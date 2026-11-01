import type {
  TrackedEpisodeMediaRepresentation,
  TrackedEpisodeMediaSource,
} from '@smartsite/contracts/tracked-episode-frames';
import { ApiError } from './errors';
import { discardResponseBody, type BodyReadRunner } from './camera-configuration-response';

const MAX_MEDIA_BYTES = 1_048_576;
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const invalid = () =>
  new ApiError('invalid-response', 'Invalid tracked evidence response or source.');

export interface TrackedEpisodeMediaResult {
  blob: Blob;
  sha256: string;
  frameSha256: string;
  /** SUBJECT is a mechanical PERSON crop, not an identity decision. */
  representation: TrackedEpisodeMediaRepresentation;
}

export function trackedEpisodeMediaPath(
  siteId: string,
  episodeId: string,
  source: TrackedEpisodeMediaSource,
  representation: TrackedEpisodeMediaRepresentation,
  expectedFrameSha256: string,
): string {
  try {
    if (!source || ![Object.prototype, null].includes(Object.getPrototypeOf(source)))
      throw invalid();
    const fields = Object.getOwnPropertyDescriptors(source);
    const keys = ['alertId', 'eventId', 'personObservationIndex', 'evidenceIndex'];
    if (
      Reflect.ownKeys(fields).length !== keys.length ||
      keys.some((key) => !fields[key]?.enumerable || !('value' in fields[key]!))
    )
      throw invalid();
    const alert = fields.alertId!.value as unknown;
    const event = fields.eventId!.value as unknown;
    const person = fields.personObservationIndex!.value as unknown;
    const evidence = fields.evidenceIndex!.value as unknown;
    if (
      [siteId, episodeId, alert, event].some((id) => typeof id !== 'string' || !UUID.test(id)) ||
      [person, evidence].some(
        (n) => typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 255,
      ) ||
      !['FRAME', 'SUBJECT'].includes(representation) ||
      typeof expectedFrameSha256 !== 'string' ||
      !SHA.test(expectedFrameSha256)
    )
      throw invalid();
    return (
      `/sites/${siteId}/safety-episodes/${episodeId}/findings/${alert}/events/${event}/frame?` +
      new URLSearchParams({
        personObservationIndex: String(person),
        evidenceIndex: String(evidence),
        representation,
      })
    );
  } catch {
    throw invalid();
  }
}

export async function readTrackedEpisodeMediaResponse(
  response: Response,
  expectedFrameSha256: string,
  representation: TrackedEpisodeMediaRepresentation,
  readBody: BodyReadRunner,
  signal?: AbortSignal,
): Promise<TrackedEpisodeMediaResult> {
  const frameSha256 = response.headers.get('x-smartsite-frame-sha256');
  const sha256 = response.headers.get('x-smartsite-content-sha256');
  const length = response.headers.get('content-length');
  if (
    response.status !== 200 ||
    !response.body ||
    response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'image/jpeg' ||
    frameSha256 !== expectedFrameSha256 ||
    !sha256 ||
    !SHA.test(sha256) ||
    response.headers.get('x-smartsite-media-representation') !== representation ||
    (representation === 'FRAME' && sha256 !== frameSha256) ||
    (length !== null &&
      (!/^\d+$/.test(length) || Number(length) < 4 || Number(length) > MAX_MEDIA_BYTES))
  ) {
    discardResponseBody(response);
    throw invalid();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await readBody(() => reader.read(), signal);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_MEDIA_BYTES) throw invalid();
      chunks.push(part.value);
    }
  } finally {
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      /* Already closed. */
    }
    reader.releaseLock();
  }
  if (size < 4 || (length !== null && size !== Number(length))) throw invalid();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Signature only; the authorized Backend reader performs bounded JPEG decoding/dimension checks.
  if (
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes[2] !== 255 ||
    bytes[size - 2] !== 255 ||
    bytes[size - 1] !== 217
  )
    throw invalid();
  let digest: ArrayBuffer;
  try {
    digest = await readBody(() => globalThis.crypto.subtle.digest('SHA-256', bytes), signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw invalid();
  }
  const actual = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join(
    '',
  );
  if (actual !== sha256) throw invalid();
  return {
    blob: new Blob([bytes.buffer], { type: 'image/jpeg' }),
    sha256,
    frameSha256,
    representation,
  };
}
