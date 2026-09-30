import {
  createPreviewDecoder,
  parseRealtimePreview,
  type RealtimePreview,
} from './realtimePreview';

export interface DecodedPreview {
  frame: RealtimePreview;
  image: HTMLImageElement;
}

export interface RealtimePreviewState {
  url: string | null;
  preview: DecodedPreview | null;
  connected: boolean;
  error: string | null;
}

async function decodeImage(frame: RealtimePreview) {
  const image = new Image();
  image.src = frame.imageDataUrl;
  await image.decode();
  if (image.naturalWidth !== frame.width || image.naturalHeight !== frame.height) {
    throw new Error('Preview image dimensions do not match metadata');
  }
  return image;
}

export function connectRealtimePreview(
  url: string,
  publish: (state: RealtimePreviewState) => void,
) {
  let disposed = false;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stale: ReturnType<typeof setTimeout> | undefined;
  let state: RealtimePreviewState = { url, preview: null, connected: false, error: null };
  const update = (patch: Partial<RealtimePreviewState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    publish(state);
  };
  const invalidate = () => {
    decoder.reset();
    clearTimeout(stale);
    update({ preview: null });
  };
  const armFrameDeadline = () => {
    clearTimeout(stale);
    stale = setTimeout(() => {
      invalidate();
      update({ error: 'No fresh camera frame received' });
    }, 5000);
  };
  const decoder = createPreviewDecoder(
    decodeImage,
    (frame, image) => {
      if (disposed) return;
      update({ preview: { frame, image }, connected: true, error: null });
      armFrameDeadline();
    },
    () => {
      invalidate();
      update({ error: 'Camera frame could not be decoded' });
    },
  );
  const connect = () => {
    if (disposed) return;
    let current: WebSocket;
    try {
      current = new WebSocket(url);
    } catch {
      update({
        preview: null,
        connected: false,
        error: 'WebSocket connection could not be started',
      });
      return;
    }
    socket = current;
    let session: string | null = null;
    let sequence = -1n;
    current.onopen = () => {
      if (disposed || socket !== current) return;
      update({ preview: null, connected: true, error: null });
      armFrameDeadline();
    };
    current.onmessage = (message) => {
      if (disposed || socket !== current) return;
      try {
        if (typeof message.data !== 'string' || message.data.length > 2_000_000) throw new Error();
        const payload: unknown = JSON.parse(message.data);
        const frame = parseRealtimePreview(payload);
        if (session === frame.sessionId && BigInt(frame.sequenceNumber) <= sequence) return;
        session = frame.sessionId;
        sequence = BigInt(frame.sequenceNumber);
        decoder.push(frame);
      } catch {
        invalidate();
        update({ error: 'Synchronized camera preview unavailable' });
      }
    };
    current.onerror = () => {
      if (disposed || socket !== current) return;
      invalidate();
      update({ connected: false, error: 'WebSocket connection error' });
    };
    current.onclose = () => {
      if (disposed || socket !== current) return;
      socket = null;
      current.onopen = current.onmessage = current.onerror = current.onclose = null;
      invalidate();
      update({ connected: false });
      retry = setTimeout(connect, 3000);
    };
  };
  connect();
  return () => {
    disposed = true;
    decoder.reset();
    clearTimeout(retry);
    clearTimeout(stale);
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    }
  };
}
