import { computeCanonicalPayloadHash, validateObservationEvent } from '@smartsite/contracts';
import { snapshotMf06Json } from './mf06-json-snapshot.js';

export interface Mf06ExpectedFrameEvent {
  readonly eventId: string;
  readonly streamSessionId: string;
  readonly payloadHash: string;
}

/** Technical reference only; does not establish media bytes, identity or authority. */
export interface Mf06FrameReference {
  readonly eventId: string;
  readonly streamSessionId: string;
  readonly sequenceNumber: number;
  readonly uri: string;
  readonly sha256: string;
  readonly payloadHash: string;
  readonly frameDimensions: Readonly<{ width: number; height: number }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const LOCAL_FRAME_URI_RE =
  /^local:\/\/evidence\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(0|[1-9][0-9]*)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg$/i;

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const isSha256 = (v: unknown): v is string => typeof v === 'string' && SHA256_RE.test(v);
const isPosSafeInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;

export function selectMf06FrameReference(
  raw: unknown,
  expected: Mf06ExpectedFrameEvent,
): Mf06FrameReference | null {
  try {
    const exp = asRecord(snapshotMf06Json(expected));
    const saved = snapshotMf06Json(raw);
    const rec = asRecord(saved);
    if (!exp || !rec || rec.schemaVersion !== '1.2.0') return null;

    const { eventId: expEventId, streamSessionId: expSessionId, payloadHash } = exp;
    if (!isUuid(expEventId) || !isUuid(expSessionId) || !isSha256(payloadHash)) return null;

    if (
      !validateObservationEvent(saved).isValid ||
      computeCanonicalPayloadHash(saved) !== payloadHash
    ) {
      return null;
    }

    const eventId = expEventId.toLowerCase();
    const streamSessionId = expSessionId.toLowerCase();
    if (
      !isUuid(rec.eventId) ||
      rec.eventId.toLowerCase() !== eventId ||
      !isUuid(rec.streamSessionId) ||
      rec.streamSessionId.toLowerCase() !== streamSessionId
    ) {
      return null;
    }

    const dims = asRecord(rec.frameDimensions);
    const width = dims?.width;
    const height = dims?.height;
    if (!isPosSafeInt(width) || !isPosSafeInt(height) || !Array.isArray(rec.evidence)) return null;

    let selected: { sequenceNumber: number; uri: string; sha256: string } | null = null;
    for (const entry of rec.evidence) {
      const item = asRecord(entry);
      if (!item || item.kind !== 'FRAME') continue;
      if (typeof item.uri !== 'string' || !isSha256(item.sha256)) return null;
      const match = LOCAL_FRAME_URI_RE.exec(item.uri);
      if (!match) return null;
      const [, uriSessionId = '', seqText = '', uriEventId = ''] = match;
      const sequenceNumber = Number(seqText);
      if (
        uriSessionId.toLowerCase() !== streamSessionId ||
        uriEventId.toLowerCase() !== eventId ||
        !Number.isSafeInteger(sequenceNumber) ||
        sequenceNumber < 0 ||
        String(sequenceNumber) !== seqText
      ) {
        return null;
      }
      if (!selected) {
        selected = { sequenceNumber, uri: item.uri, sha256: item.sha256 };
      } else if (selected.uri !== item.uri || selected.sha256 !== item.sha256) {
        return null;
      }
    }

    if (!selected) return null;

    return Object.freeze({
      eventId,
      streamSessionId,
      sequenceNumber: selected.sequenceNumber,
      uri: selected.uri,
      sha256: selected.sha256,
      payloadHash,
      frameDimensions: Object.freeze({ width, height }),
    });
  } catch {
    return null;
  }
}
