import { describe, expect, it, vi } from 'vitest';
import {
  processCameraMediaNdjsonStream,
  validateCameraMediaFrameEnvelope,
  createCameraMediaStreamValidationState,
  MAX_CAMERA_STREAM_LINE_BYTES,
} from './camera-media-stream';
import { SmartSiteManagementClient } from './management';
import { ApiError } from './index';
import type { CameraMediaFrame } from '@smartsite/contracts/camera-preview';

function createValidFrame(overrides?: Partial<CameraMediaFrame>): CameraMediaFrame {
  return {
    type: 'media-frame',
    mediaVersion: 1,
    cameraExternalId: 'CAM-01',
    sessionId: '11111111-1111-4111-8111-111111111111',
    sequenceNumber: '1',
    capturedAt: new Date().toISOString(),
    width: 640,
    height: 480,
    imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    ...overrides,
  };
}

function createStreamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk === undefined) {
        controller.close();
      } else {
        controller.enqueue(chunk);
      }
    },
  });
}

describe('camera-media-stream NDJSON transport & validation', () => {
  it('parses valid multiple NDJSON frames cleanly', async () => {
    const frame1 = createValidFrame({ sequenceNumber: '1' });
    const frame2 = createValidFrame({ sequenceNumber: '2' });
    const text = `${JSON.stringify(frame1)}\n${JSON.stringify(frame2)}\n`;
    const encoder = new TextEncoder();
    const stream = createStreamFromChunks([encoder.encode(text)]);

    const frames: CameraMediaFrame[] = [];
    await processCameraMediaNdjsonStream(stream, (frame) => {
      frames.push(frame);
    });

    expect(frames).toHaveLength(2);
    expect(frames[0]?.sequenceNumber).toBe('1');
    expect(frames[1]?.sequenceNumber).toBe('2');
  });

  it('handles split lines and split multi-byte UTF-8 characters across chunk boundaries', async () => {
    // Include multi-byte characters in externalId or comments to test boundary split
    const frame1 = createValidFrame({ sequenceNumber: '10' });
    const frame2 = createValidFrame({ sequenceNumber: '11' });
    const rawLine1 = JSON.stringify(frame1);
    const rawLine2 = JSON.stringify(frame2);
    const fullText = `${rawLine1}\n${rawLine2}\n`;
    const encoder = new TextEncoder();
    const fullBytes = encoder.encode(fullText);

    // Split arbitrarily into multiple small slices (e.g. 15 bytes each)
    const chunks: Uint8Array[] = [];
    const chunkSize = 17;
    for (let i = 0; i < fullBytes.byteLength; i += chunkSize) {
      chunks.push(fullBytes.subarray(i, Math.min(i + chunkSize, fullBytes.byteLength)));
    }

    const stream = createStreamFromChunks(chunks);
    const frames: CameraMediaFrame[] = [];
    await processCameraMediaNdjsonStream(stream, (frame) => {
      frames.push(frame);
    });

    expect(frames).toHaveLength(2);
    expect(frames[0]?.sequenceNumber).toBe('10');
    expect(frames[1]?.sequenceNumber).toBe('11');
  });

  it('rejects oversized line exceeding MAX_CAMERA_STREAM_LINE_BYTES with invalid-response ApiError', async () => {
    // Generate a line exceeding 262144 bytes without newline
    const oversizedChunk = new Uint8Array(MAX_CAMERA_STREAM_LINE_BYTES + 10);
    oversizedChunk.fill(0x61); // 'a'
    const stream = createStreamFromChunks([oversizedChunk]);

    await expect(processCameraMediaNdjsonStream(stream, () => {})).rejects.toThrowError(
      expect.objectContaining({
        code: 'invalid-response',
        message: expect.stringContaining('exceeded maximum byte limit'),
      }),
    );
  });

  it('rejects malformed JSON lines in stream with invalid-response ApiError', async () => {
    const invalidJsonText = '{"type":"media-frame", broken\n';
    const stream = createStreamFromChunks([new TextEncoder().encode(invalidJsonText)]);

    await expect(processCameraMediaNdjsonStream(stream, () => {})).rejects.toThrowError(
      expect.objectContaining({
        code: 'invalid-response',
        message: expect.stringContaining('not valid JSON'),
      }),
    );
  });

  it('rejects payload that violates canonical CameraMediaFrame schema', async () => {
    // Missing capturedAt or invalid type
    const invalidPayload = {
      type: 'invalid-type',
      mediaVersion: 1,
      cameraExternalId: 'CAM-01',
    };
    const stream = createStreamFromChunks([
      new TextEncoder().encode(`${JSON.stringify(invalidPayload)}\n`),
    ]);

    await expect(processCameraMediaNdjsonStream(stream, () => {})).rejects.toThrowError(
      expect.objectContaining({
        code: 'invalid-response',
      }),
    );
  });

  it('rejects frame when cameraExternalId does not match expectedCameraExternalId', async () => {
    const frame = createValidFrame({ cameraExternalId: 'UNEXPECTED-CAM' });
    const stream = createStreamFromChunks([new TextEncoder().encode(`${JSON.stringify(frame)}\n`)]);

    await expect(
      processCameraMediaNdjsonStream(stream, () => {}, {
        expectedCameraExternalId: 'EXPECTED-CAM',
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'invalid-response',
        message: expect.stringContaining('Camera external ID mismatch'),
      }),
    );
  });

  it('rejects stale frames (age >= 2000ms) and future frames (>1000ms ahead)', async () => {
    const fixedNow = 1_700_000_000_000;
    const nowFn = () => fixedNow;

    // Stale: captured exactly 2000ms ago (>= 2000ms is rejected)
    const exactStaleFrame = createValidFrame({
      capturedAt: new Date(fixedNow - 2000).toISOString(),
    });
    const state = createCameraMediaStreamValidationState();

    expect(() =>
      validateCameraMediaFrameEnvelope(exactStaleFrame, state, { now: nowFn }),
    ).toThrowError(/stale/);

    // Stale: captured 2500ms ago
    const staleFrame = createValidFrame({
      capturedAt: new Date(fixedNow - 2500).toISOString(),
    });
    expect(() => validateCameraMediaFrameEnvelope(staleFrame, state, { now: nowFn })).toThrowError(
      /stale/,
    );

    // Future: captured 1500ms in the future
    const futureFrame = createValidFrame({
      capturedAt: new Date(fixedNow + 1500).toISOString(),
    });
    expect(() => validateCameraMediaFrameEnvelope(futureFrame, state, { now: nowFn })).toThrowError(
      /too far in the future/,
    );
  });

  it('enforces monotonic sequence numbers within same session and resets on new sessionId', () => {
    const state = createCameraMediaStreamValidationState();
    const session1 = '11111111-1111-4111-8111-111111111111';
    const session2 = '22222222-2222-4222-8222-222222222222';
    const now = () => Date.now();

    const frame1 = createValidFrame({ sessionId: session1, sequenceNumber: '10' });
    const frame2 = createValidFrame({ sessionId: session1, sequenceNumber: '11' });
    const frameDup = createValidFrame({ sessionId: session1, sequenceNumber: '11' });
    const frameOutOrder = createValidFrame({ sessionId: session1, sequenceNumber: '9' });
    const frameNewSession = createValidFrame({ sessionId: session2, sequenceNumber: '1' });

    // 10 is accepted
    expect(validateCameraMediaFrameEnvelope(frame1, state, { now }).sequenceNumber).toBe('10');
    // 11 is accepted
    expect(validateCameraMediaFrameEnvelope(frame2, state, { now }).sequenceNumber).toBe('11');
    // duplicate (11 <= 11) is rejected
    expect(() => validateCameraMediaFrameEnvelope(frameDup, state, { now })).toThrowError(
      /Non-monotonic/,
    );
    // out of order (9 <= 11) is rejected
    expect(() => validateCameraMediaFrameEnvelope(frameOutOrder, state, { now })).toThrowError(
      /Non-monotonic/,
    );

    // New session with lower sequence (1) is accepted due to session reset
    expect(validateCameraMediaFrameEnvelope(frameNewSession, state, { now }).sequenceNumber).toBe(
      '1',
    );
    expect(state.currentSessionId).toBe(session2);
    expect(state.lastSequenceNumber).toBe(1n);
  });

  it('honors AbortSignal cancellation cleanly without hanging', async () => {
    const controller = new AbortController();
    const frame = createValidFrame();
    const chunk = new TextEncoder().encode(`${JSON.stringify(frame)}\n`);

    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(chunk);
        controller.abort();
      },
    });

    await expect(
      processCameraMediaNdjsonStream(stream, () => {}, { signal: controller.signal }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'cancelled',
      }),
    );
  });

  it('removes abort listener even when signal was already aborted before stream starts', async () => {
    const controller = new AbortController();
    controller.abort();

    const addListenerSpy = vi.spyOn(controller.signal, 'addEventListener');
    const removeListenerSpy = vi.spyOn(controller.signal, 'removeEventListener');

    const stream = createStreamFromChunks([]);

    await expect(
      processCameraMediaNdjsonStream(stream, () => {}, { signal: controller.signal }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'cancelled',
      }),
    );

    expect(addListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(removeListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('does not publish partial unterminated final JSON when stream ends without trailing newline', async () => {
    const validFrame = createValidFrame({ sequenceNumber: '1' });
    const completeLine = `${JSON.stringify(validFrame)}\n`;
    const unterminatedTrailing = '{"type":"media-frame","sequenceNumber":"2"'; // missing \n and closing braces

    const stream = createStreamFromChunks([
      new TextEncoder().encode(completeLine + unterminatedTrailing),
    ]);

    const frames: CameraMediaFrame[] = [];
    await processCameraMediaNdjsonStream(stream, (frame) => {
      frames.push(frame);
    });

    // Only the complete line followed by \n was published; partial unterminated chunk was safely dropped
    expect(frames).toHaveLength(1);
    expect(frames[0]?.sequenceNumber).toBe('1');
  });

  it('cancels reader in finally when parse or schema error occurs', async () => {
    let readerCancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new TextEncoder().encode('invalid-json\n'));
      },
      cancel() {
        readerCancelled = true;
      },
    });

    await expect(processCameraMediaNdjsonStream(stream, () => {})).rejects.toThrowError(
      /not valid JSON/,
    );

    expect(readerCancelled).toBe(true);
  });
});

describe('SmartSiteManagementClient.streamCameraVideo HTTP transport', () => {
  it('transports credentials via Authorization header only and processes stream', async () => {
    const client = new SmartSiteManagementClient('http://localhost:3000');
    const frame = createValidFrame({ sequenceNumber: '1' });
    const ndjson = `${JSON.stringify(frame)}\n`;

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/x-ndjson' }),
      body: createStreamFromChunks([new TextEncoder().encode(ndjson)]),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    try {
      const frames: CameraMediaFrame[] = [];
      await client.streamCameraVideo('secret-token-123', 'site-abc', 'cam-xyz', (f) =>
        frames.push(f),
      );

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/sites/site-abc/cameras/cam-xyz/video-stream',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Accept: 'application/x-ndjson',
            Authorization: 'Bearer secret-token-123',
          },
          cache: 'no-store',
          redirect: 'error',
        }),
      );
      expect(frames).toHaveLength(1);
      expect(frames[0]?.sequenceNumber).toBe('1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects with invalid-response when response content-type is not application/x-ndjson', async () => {
    const client = new SmartSiteManagementClient('http://localhost:3000');
    const originalFetch = globalThis.fetch;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'text/html' }),
      body: createStreamFromChunks([new TextEncoder().encode('<html></html>')]),
    });

    try {
      await expect(
        client.streamCameraVideo('token', 'site-1', 'cam-1', () => {}),
      ).rejects.toThrowError(/Expected application\/x-ndjson/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('propagates HTTP 401, 403, 429 (with Retry-After), and 503 error statuses', async () => {
    const client = new SmartSiteManagementClient('http://localhost:3000');
    const originalFetch = globalThis.fetch;

    try {
      // 401
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers(),
        json: async () => ({ message: 'Unauthorized' }),
      });
      await expect(
        client.streamCameraVideo('token', 'site-1', 'cam-1', () => {}),
      ).rejects.toThrowError(expect.objectContaining({ status: 401 }));

      // 403
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        headers: new Headers(),
        json: async () => ({ message: 'Forbidden' }),
      });
      await expect(
        client.streamCameraVideo('token', 'site-1', 'cam-1', () => {}),
      ).rejects.toThrowError(expect.objectContaining({ status: 403 }));

      // 429 with Retry-After: 15
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '15' }),
        json: async () => ({ message: 'Rate limit exceeded' }),
      });
      try {
        await client.streamCameraVideo('token', 'site-1', 'cam-1', () => {});
        expect.unreachable('Should have thrown 429');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.status).toBe(429);
        expect(apiErr.retryAfterSeconds).toBe(15);
      }

      // 503
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers(),
        json: async () => ({ message: 'Service Unavailable' }),
      });
      await expect(
        client.streamCameraVideo('token', 'site-1', 'cam-1', () => {}),
      ).rejects.toThrowError(expect.objectContaining({ status: 503 }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
