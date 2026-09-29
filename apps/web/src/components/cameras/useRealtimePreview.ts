import { useEffect, useState } from 'react';
import {
  createPreviewDecoder,
  parseRealtimePreview,
  type RealtimePreview,
} from './realtimePreview';

export interface DecodedPreview {
  frame: RealtimePreview;
  image: HTMLImageElement;
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

export function useRealtimePreview(url: string | null) {
  const [state, setState] = useState<{
    url: string | null;
    preview: DecodedPreview | null;
    connected: boolean;
    error: string | null;
  }>({ url, preview: null, connected: false, error: null });
  useEffect(() => {
    if (!url) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stale: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      decoder.reset();
      clearTimeout(stale);
      setState((previous) => ({ ...previous, url, preview: null }));
    };
    const decoder = createPreviewDecoder(
      decodeImage,
      (frame, image) => {
        if (disposed) return;
        setState({ url, preview: { frame, image }, connected: true, error: null });
        clearTimeout(stale);
        stale = setTimeout(() => {
          invalidate();
          setState((previous) => ({ ...previous, url, error: 'No fresh camera frame received' }));
        }, 5000);
      },
      () => {
        invalidate();
        setState((previous) => ({ ...previous, url, error: 'Camera frame could not be decoded' }));
      },
    );
    const connect = () => {
      if (disposed) return;
      const current = new WebSocket(url);
      socket = current;
      let session: string | null = null;
      let sequence = -1n;
      current.onopen = () => {
        if (disposed || socket !== current) return;
        setState({ url, preview: null, connected: true, error: null });
      };
      current.onmessage = (message) => {
        if (disposed || socket !== current) return;
        try {
          if (typeof message.data !== 'string' || message.data.length > 2_000_000)
            throw new Error();
          const payload: unknown = JSON.parse(message.data);
          const frame = parseRealtimePreview(payload);
          if (session === frame.sessionId && BigInt(frame.sequenceNumber) <= sequence) return;
          session = frame.sessionId;
          sequence = BigInt(frame.sequenceNumber);
          decoder.push(frame);
        } catch {
          invalidate();
          setState((previous) => ({
            ...previous,
            url,
            error: 'Synchronized camera preview unavailable',
          }));
        }
      };
      current.onerror = () => {
        if (disposed || socket !== current) return;
        invalidate();
        setState({ url, preview: null, connected: false, error: 'WebSocket connection error' });
      };
      current.onclose = () => {
        if (disposed || socket !== current) return;
        invalidate();
        setState((previous) => ({ ...previous, url, preview: null, connected: false }));
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
  }, [url]);
  // A URL change must never expose the previous camera's frame while the new effect connects.
  return state.url === url && url !== null
    ? state
    : { preview: null, connected: false, error: null };
}
