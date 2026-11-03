import { computeCanonicalPayloadHash, type ObservationFramePartition } from '@smartsite/contracts';
import { snapshotMf06Json } from './mf06-json-snapshot.js';
import { validateMf06ObservationEvent } from './mf06-observation-event.js';

export interface Mf06ExpectedFrameEvent {
  readonly eventId: string;
  readonly streamSessionId: string;
  readonly payloadHash: string;
}

/** Technical reference only; does not establish media bytes, identity or authority. */
export interface Mf06FrameReference {
  readonly framePartition?: Readonly<ObservationFramePartition>;
  readonly eventId: string;
  readonly streamSessionId: string;
  readonly sequenceNumber: number | string;
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

/** Keep legacy numeric references while preserving v1.4 uint64 sequences exactly. */
export function mf06FrameSequenceText(
  reference: Pick<Mf06FrameReference, 'sequenceNumber' | 'framePartition'>,
): string | null {
  const value = reference.sequenceNumber;
  const part = reference.framePartition;
  if (part === undefined) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : null;
  }
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]{0,19})$/.test(value) ||
    BigInt(value) > 18_446_744_073_709_551_615n ||
    part.sequenceNumber !== value ||
    typeof part.frameId !== 'string' ||
    !UUID_RE.test(part.frameId) ||
    part.frameId !== part.frameId.toLowerCase() ||
    !Number.isInteger(part.partIndex) ||
    !Number.isInteger(part.partCount) ||
    part.partCount < 1 ||
    part.partCount > 1024 ||
    part.partIndex < 0 ||
    part.partIndex >= part.partCount
  )
    return null;
  return value;
}

export function selectMf06FrameReference(
  raw: unknown,
  expected: Mf06ExpectedFrameEvent,
): Mf06FrameReference | null {
  try {
    const exp = asRecord(snapshotMf06Json(expected));
    const saved = snapshotMf06Json(raw);
    const rec = asRecord(saved);
    if (!exp || !rec || !['1.2.0', '1.3.0', '1.4.0'].includes(rec.schemaVersion as string))
      return null;

    const { eventId: expEventId, streamSessionId: expSessionId, payloadHash } = exp;
    if (!isUuid(expEventId) || !isUuid(expSessionId) || !isSha256(payloadHash)) return null;

    if (
      !validateMf06ObservationEvent(saved).isValid ||
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

    const partition =
      rec.schemaVersion === '1.4.0'
        ? (rec.framePartition as unknown as ObservationFramePartition)
        : undefined;
    let selected: { sequenceNumber: number | string; uri: string; sha256: string } | null = null;
    for (const entry of rec.evidence) {
      const item = asRecord(entry);
      if (!item || item.kind !== 'FRAME') continue;
      if (typeof item.uri !== 'string' || !isSha256(item.sha256)) return null;
      const match = LOCAL_FRAME_URI_RE.exec(item.uri);
      if (!match) return null;
      const [, uriSessionId = '', seqText = '', uriEventId = ''] = match;
      const sequenceNumber = partition ? seqText : Number(seqText);
      if (
        uriSessionId.toLowerCase() !== streamSessionId ||
        uriEventId.toLowerCase() !== eventId ||
        mf06FrameSequenceText({
          sequenceNumber,
          framePartition: partition,
        }) !== seqText
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
      ...(partition ? { framePartition: Object.freeze({ ...partition }) } : {}),
    });
  } catch {
    return null;
  }
}
