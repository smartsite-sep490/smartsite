import { useEffect, useState } from 'react';
import { connectRealtimePreview, type RealtimePreviewState } from './realtimePreviewConnection';

export type { DecodedPreview } from './realtimePreviewConnection';

export function useRealtimePreview(url: string | null) {
  const [state, setState] = useState<RealtimePreviewState>({
    url,
    preview: null,
    connected: false,
    error: null,
  });
  useEffect(() => {
    if (!url) return;
    return connectRealtimePreview(url, setState);
  }, [url]);
  // A URL change must never expose the previous camera's frame while the new effect connects.
  return state.url === url && url !== null
    ? state
    : { preview: null, connected: false, error: null };
}
