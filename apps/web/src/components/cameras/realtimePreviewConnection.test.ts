import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectRealtimePreview, type RealtimePreviewState } from './realtimePreviewConnection';

const packet = {
  type: 'frame',
  previewVersion: 1,
  width: 4,
  height: 2,
  sessionId: '00000000-0000-4000-8000-000000000001',
  sequenceNumber: '10',
  cameraExternalId: 'CAM-01',
  capturedAt: '2026-09-30T00:00:00Z',
  imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  detections: [],
  zoneDetections: [],
};

class FakeSocket {
  static instances: FakeSocket[] = [];
  static failConstruction = false;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor() {
    if (FakeSocket.failConstruction) throw new Error('private-token-must-not-leak');
    FakeSocket.instances.push(this);
  }
  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

let decode: () => Promise<void>;
class FakeImage {
  src = '';
  naturalWidth = 4;
  naturalHeight = 2;
  decode() {
    return decode();
  }
}

function fixture() {
  const updates: RealtimePreviewState[] = [];
  const stop = connectRealtimePreview('ws://127.0.0.1:8000/ws/realtime', (state) =>
    updates.push(state),
  );
  const socket = FakeSocket.instances.at(-1)!;
  return { updates, stop, socket };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  FakeSocket.failConstruction = false;
  decode = () => Promise.resolve();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('Image', FakeImage);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('preview connection lifecycle', () => {
  it('reports an open connection that never supplies its first frame', async () => {
    const { socket, updates, stop } = fixture();
    socket.onopen?.();
    await vi.advanceTimersByTimeAsync(5000);
    expect(updates.at(-1)?.error).toBe('No fresh camera frame received');
    expect(updates.at(-1)?.preview).toBeNull();
    stop();
  });

  it('handles socket construction failure without crashing or exposing credentials', () => {
    FakeSocket.failConstruction = true;
    const updates: RealtimePreviewState[] = [];
    expect(() => {
      const stop = connectRealtimePreview('invalid-url', (state) => updates.push(state));
      stop();
    }).not.toThrow();
    expect(updates.at(-1)?.error).toBe('WebSocket connection could not be started');
    expect(updates.at(-1)?.connected).toBe(false);
  });

  it('keeps valid empty frames, ignores older sequences and clears stalled pixels', async () => {
    const { socket, updates, stop } = fixture();
    socket.onopen?.();
    socket.message(packet);
    await vi.advanceTimersByTimeAsync(0);
    expect(updates.at(-1)?.preview?.frame.sequenceNumber).toBe('10');
    expect(updates.at(-1)?.preview?.frame.detections).toEqual([]);
    socket.message({ ...packet, sequenceNumber: '9' });
    await vi.advanceTimersByTimeAsync(0);
    expect(updates.at(-1)?.preview?.frame.sequenceNumber).toBe('10');
    await vi.advanceTimersByTimeAsync(5000);
    expect(updates.at(-1)?.preview).toBeNull();
    socket.message({ ...packet, sequenceNumber: '11' });
    await vi.advanceTimersByTimeAsync(0);
    expect(updates.at(-1)?.preview?.frame.sequenceNumber).toBe('11');
    expect(updates.at(-1)?.error).toBeNull();
    stop();
  });

  it('cannot publish a late decode or queued callback after disposal', async () => {
    let finish!: () => void;
    decode = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const { socket, updates, stop } = fixture();
    socket.onopen?.();
    socket.message(packet);
    const queuedCallback = socket.onmessage!;
    const before = updates.length;
    stop();
    finish();
    queuedCallback({ data: JSON.stringify(packet) });
    await vi.advanceTimersByTimeAsync(10000);
    expect(updates).toHaveLength(before);
    expect(socket.close).toHaveBeenCalledOnce();
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('ignores a queued message from a closed socket before reconnect starts', async () => {
    const { socket, updates, stop } = fixture();
    socket.onopen?.();
    socket.message(packet);
    await vi.advanceTimersByTimeAsync(0);
    const queuedCallback = socket.onmessage!;
    socket.onclose?.();
    queuedCallback({ data: JSON.stringify({ ...packet, sequenceNumber: '11' }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(updates.at(-1)?.preview).toBeNull();
    expect(updates.at(-1)?.connected).toBe(false);
    stop();
  });

  it('recovers a new session after disconnect and never publishes the old decode', async () => {
    let finish!: () => void;
    decode = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const { socket, updates, stop } = fixture();
    socket.onopen?.();
    socket.message(packet);
    socket.onclose?.();
    finish();
    await vi.advanceTimersByTimeAsync(3000);
    expect(updates.at(-1)?.preview).toBeNull();
    const replacement = FakeSocket.instances.at(-1)!;
    expect(replacement).not.toBe(socket);
    decode = () => Promise.resolve();
    replacement.onopen?.();
    const sessionId = '00000000-0000-4000-8000-000000000002';
    replacement.message({ ...packet, sessionId, sequenceNumber: '0' });
    await vi.advanceTimersByTimeAsync(0);
    expect(updates.at(-1)?.preview?.frame.sessionId).toBe(sessionId);
    stop();
  });
});
