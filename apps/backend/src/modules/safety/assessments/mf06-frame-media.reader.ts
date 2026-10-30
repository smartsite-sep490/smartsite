import sharp from 'sharp';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';
import {
  cropSafetySubjectFrame,
  type SafetySubjectCrop,
} from '../identity/safety-subject-cropper.js';
import type { ObservationSubjectRef } from '../identity/observation-identity.types.js';
import { projectObservationSubjectRef } from '../identity/observation-identity-subject-ref.js';
import { mf06FrameSequenceText, type Mf06FrameReference } from './mf06-frame-reference.js';
import { snapshotMf06Json } from './mf06-json-snapshot.js';

const LIMITS = { maxFrameBytes: 1_048_576, maxFramePixels: 16_000_000, maxCropBytes: 1_048_576 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

export interface Mf06VerifiedFrameMedia {
  readonly bytes: Buffer;
  readonly fileName: string;
  readonly sha256: string;
}

async function readBoundedFrame(
  root: string,
  name: string,
  signal?: AbortSignal,
): Promise<Buffer | null> {
  signal?.throwIfAborted();
  const rootStat = await lstat(root);
  signal?.throwIfAborted();
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
  const resolvedRoot = await realpath(root);
  signal?.throwIfAborted();
  const candidate = join(resolvedRoot, name);
  const before = await lstat(candidate, { bigint: true });
  signal?.throwIfAborted();
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size < 4n ||
    before.size > BigInt(LIMITS.maxFrameBytes)
  )
    return null;
  if (dirname(await realpath(candidate)) !== resolvedRoot) return null;
  signal?.throwIfAborted();
  const handle = await open(
    candidate,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    signal?.throwIfAborted();
    const opened = await handle.stat({ bigint: true });
    signal?.throwIfAborted();
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      return null;
    // Never allocate from an untrusted file size or let a concurrent append grow the read.
    const buffer = Buffer.alloc(LIMITS.maxFrameBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      signal?.throwIfAborted();
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    signal?.throwIfAborted();
    if (
      length > LIMITS.maxFrameBytes ||
      BigInt(length) !== after.size ||
      after.size !== opened.size ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs
    )
      return null;
    return Buffer.from(buffer.subarray(0, length));
  } finally {
    await handle.close();
  }
}

/** Reads and verifies a full JPEG frame against an event-committed Mf06FrameReference. */
export async function readMf06FrameMedia(
  root: string,
  reference: Mf06FrameReference,
  signal?: AbortSignal,
): Promise<Mf06VerifiedFrameMedia | null> {
  try {
    if (signal?.aborted || !isAbsolute(root)) return null;
    const ref = snapshotMf06Json(reference) as Mf06FrameReference;
    if (
      ![ref.uri, ref.sha256, ref.eventId, ref.streamSessionId, ref.payloadHash].every(
        (value) => typeof value === 'string',
      )
    )
      return null;
    if (
      !UUID.test(ref.eventId) ||
      !UUID.test(ref.streamSessionId) ||
      !HASH.test(ref.sha256) ||
      !HASH.test(ref.payloadHash) ||
      mf06FrameSequenceText(ref) === null
    )
      return null;
    const { width, height } = ref.frameDimensions;
    if (
      ![width, height].every((v) => Number.isSafeInteger(v) && v > 0) ||
      width * height > LIMITS.maxFramePixels
    )
      return null;
    const session = ref.streamSessionId.toLowerCase(),
      event = ref.eventId.toLowerCase();
    if (ref.uri.toLowerCase() !== `local://evidence/${session}/${ref.sequenceNumber}/${event}.jpg`)
      return null;
    const fileName = `${session}_${ref.sequenceNumber}_${event}.jpg`;
    const bytes = await readBoundedFrame(root, fileName, signal);
    signal?.throwIfAborted();
    if (
      !bytes ||
      bytes[0] !== 0xff ||
      bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff ||
      bytes[bytes.length - 1] !== 0xd9 ||
      createHash('sha256').update(bytes).digest('hex') !== ref.sha256
    )
      return null;
    const metadata = await sharp(bytes, { limitInputPixels: LIMITS.maxFramePixels }).metadata();
    signal?.throwIfAborted();
    if (
      metadata.format !== 'jpeg' ||
      metadata.width !== width ||
      metadata.height !== height ||
      (metadata.orientation ?? 1) !== 1
    )
      return null;
    return Object.freeze({ bytes, fileName, sha256: ref.sha256 });
  } catch {
    return null;
  }
}

/** Receives a claim-bound reference; checksum/crop equality is not Worker identity or authority. */
export async function readMf06SubjectMedia(
  root: string,
  reference: Mf06FrameReference,
  subject: ObservationSubjectRef,
  signal?: AbortSignal,
): Promise<SafetySubjectCrop | null> {
  try {
    if (signal?.aborted || !isAbsolute(root)) return null;
    const ref = snapshotMf06Json(reference) as Mf06FrameReference;
    const selected = projectObservationSubjectRef(snapshotMf06Json(subject));
    if (
      ![ref.uri, ref.sha256, ref.eventId, ref.streamSessionId, ref.payloadHash].every(
        (value) => typeof value === 'string',
      )
    )
      return null;
    if (
      !selected ||
      !UUID.test(ref.eventId) ||
      !UUID.test(ref.streamSessionId) ||
      !HASH.test(ref.sha256) ||
      !HASH.test(ref.payloadHash) ||
      mf06FrameSequenceText(ref) === null
    )
      return null;
    if (
      selected.eventId.toLowerCase() !== ref.eventId.toLowerCase() ||
      selected.streamSessionId.toLowerCase() !== ref.streamSessionId.toLowerCase() ||
      selected.payloadHash !== ref.payloadHash
    )
      return null;
    const { width, height } = ref.frameDimensions;
    const frame = await readMf06FrameMedia(root, ref, signal);
    signal?.throwIfAborted();
    if (!frame) return null;
    // shortcut: Sharp decode cannot be preempted here; isolate it before requiring a hard cancellation deadline.
    const crop = await cropSafetySubjectFrame(
      { bytes: frame.bytes, sha256: frame.sha256, width, height },
      selected,
      LIMITS,
    );
    signal?.throwIfAborted();
    return crop;
  } catch {
    // Filesystem/decoder errors can contain private paths; unavailable media carries no details.
    return null;
  }
}
