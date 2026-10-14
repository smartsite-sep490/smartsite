import {
  parseCameraMediaFrame,
  type CameraMediaFrame,
} from '@smartsite/contracts/camera-preview';
import { ApiError } from './index';

export const MAX_CAMERA_STREAM_LINE_BYTES = 262144; // 262,144 bytes = 256 KB max NDJSON line

export interface CameraVideoStreamOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  expectedCameraExternalId?: string;
  now?: () => number;
}

export interface CameraMediaStreamValidationState {
  currentSessionId: string | null;
  lastSequenceNumber: bigint;
}

export function createCameraMediaStreamValidationState(): CameraMediaStreamValidationState {
  return {
    currentSessionId: null,
    lastSequenceNumber: -1n,
  };
}

/**
 * Validates a parsed CameraMediaFrame according to strict client-side streaming constraints:
 * 1. Matches expected camera external ID if provided.
 * 2. Monotonic sequence within the same stream session; resets sequence tracking when sessionId changes.
 * 3. Freshness: frame age must be < 2000ms (age >= 2000ms is rejected) and future timestamps <= 1000ms.
 */
export function validateCameraMediaFrameEnvelope(
  frame: CameraMediaFrame,
  state: CameraMediaStreamValidationState,
  options?: {
    expectedCameraExternalId?: string;
    now?: () => number;
  },
): CameraMediaFrame {
  // 1. External ID check
  if (
    options?.expectedCameraExternalId !== undefined &&
    frame.cameraExternalId !== options.expectedCameraExternalId
  ) {
    throw new ApiError(
      'invalid-response',
      `Camera external ID mismatch: expected '${options.expectedCameraExternalId}', got '${frame.cameraExternalId}'.`,
    );
  }

  // 2. Timestamp freshness validation (age < 2000ms, future <= 1000ms; age >= 2000 is rejected)
  const currentTime = options?.now ? options.now() : Date.now();
  const capturedTime = Date.parse(frame.capturedAt);
  if (!Number.isFinite(capturedTime)) {
    throw new ApiError('invalid-response', 'Camera media frame has an invalid capturedAt timestamp.');
  }
  const ageMs = currentTime - capturedTime;
  if (ageMs >= 2000) {
    throw new ApiError('invalid-response', `Camera media frame is stale (${ageMs}ms old >= 2000ms limit).`);
  }
  const futureMs = capturedTime - currentTime;
  if (futureMs > 1000) {
    throw new ApiError(
      'invalid-response',
      `Camera media frame timestamp is too far in the future (${futureMs}ms > 1000ms limit).`,
    );
  }

  // 3. Monotonic sequence number validation per stream session
  const seq = BigInt(frame.sequenceNumber);
  if (frame.sessionId === state.currentSessionId) {
    if (seq <= state.lastSequenceNumber) {
      throw new ApiError(
        'invalid-response',
        `Non-monotonic sequence number in session '${frame.sessionId}': received ${seq} <= previous ${state.lastSequenceNumber}.`,
      );
    }
    state.lastSequenceNumber = seq;
  } else {
    // New stream session detected: reset sequence baseline
    state.currentSessionId = frame.sessionId;
    state.lastSequenceNumber = seq;
  }

  return frame;
}

/**
 * Streams and parses an NDJSON response from an incoming ReadableStream of Uint8Array chunks.
 * Handles split multi-byte UTF-8 sequences and lines split across chunk boundaries.
 * Strictly enforces MAX_CAMERA_STREAM_LINE_BYTES (262,144 bytes) per line.
 * Cancels the reader and cleans up event listeners in finally.
 * Drops incomplete trailing JSON on graceful stream termination (does not publish partial unterminated JSON).
 */
export async function processCameraMediaNdjsonStream(
  bodyStream: ReadableStream<Uint8Array>,
  onFrame: (frame: CameraMediaFrame) => void,
  options?: CameraVideoStreamOptions,
): Promise<void> {
  const reader = bodyStream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const validationState = createCameraMediaStreamValidationState();

  let lineChunks: Uint8Array[] = [];
  let currentLineBytes = 0;

  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  options?.signal?.addEventListener('abort', onAbort);

  const flushLine = () => {
    if (currentLineBytes === 0) {
      lineChunks = [];
      return;
    }
    if (currentLineBytes > MAX_CAMERA_STREAM_LINE_BYTES) {
      throw new ApiError(
        'invalid-response',
        `NDJSON line exceeded maximum byte limit of ${MAX_CAMERA_STREAM_LINE_BYTES} bytes (${currentLineBytes} bytes received).`,
      );
    }

    // Assemble concatenated Uint8Array line
    const merged = new Uint8Array(currentLineBytes);
    let offset = 0;
    for (const chunk of lineChunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    lineChunks = [];
    currentLineBytes = 0;

    let lineText: string;
    try {
      lineText = decoder.decode(merged).trim();
    } catch {
      throw new ApiError('invalid-response', 'NDJSON stream contained malformed UTF-8 bytes.');
    }

    if (lineText.length === 0) return;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(lineText);
    } catch {
      throw new ApiError('invalid-response', 'NDJSON stream line is not valid JSON.');
    }

    let parsedFrame: CameraMediaFrame;
    try {
      parsedFrame = parseCameraMediaFrame(parsedJson);
    } catch (err) {
      throw new ApiError(
        'invalid-response',
        err instanceof Error ? err.message : 'Invalid CameraMediaFrame payload.',
      );
    }

    const validated = validateCameraMediaFrameEnvelope(parsedFrame, validationState, {
      expectedCameraExternalId: options?.expectedCameraExternalId,
      now: options?.now,
    });

    onFrame(validated);
  };

  try {
    if (options?.signal?.aborted) {
      throw new ApiError('cancelled', 'Stream reading was cancelled.');
    }

    while (true) {
      if (options?.signal?.aborted) {
        throw new ApiError('cancelled', 'Stream reading was cancelled.');
      }
      const { done, value } = await reader.read();
      if (done) {
        // Do not publish partial unterminated final JSON if stream ends without trailing \n
        lineChunks = [];
        currentLineBytes = 0;
        break;
      }

      if (!value || value.byteLength === 0) continue;

      let chunkStart = 0;
      for (let i = 0; i < value.byteLength; i++) {
        // 0x0A is LF ('\n')
        if (value[i] === 0x0a) {
          const slice = value.subarray(chunkStart, i);
          if (slice.byteLength > 0) {
            currentLineBytes += slice.byteLength;
            lineChunks.push(slice);
          }
          flushLine();
          chunkStart = i + 1;
        }
      }

      if (chunkStart < value.byteLength) {
        const remaining = value.subarray(chunkStart);
        currentLineBytes += remaining.byteLength;
        if (currentLineBytes > MAX_CAMERA_STREAM_LINE_BYTES) {
          throw new ApiError(
            'invalid-response',
            `NDJSON line exceeded maximum byte limit of ${MAX_CAMERA_STREAM_LINE_BYTES} bytes.`,
          );
        }
        lineChunks.push(remaining);
      }
    }
  } catch (error) {
    if (options?.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw new ApiError('cancelled', 'Stream reading was cancelled.');
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError('network', error instanceof Error ? error.message : 'Error reading media stream.');
  } finally {
    options?.signal?.removeEventListener('abort', onAbort);
    try {
      await reader.cancel();
    } catch {
      // no-op
    }
    try {
      reader.releaseLock?.();
    } catch {
      // no-op
    }
  }
}
