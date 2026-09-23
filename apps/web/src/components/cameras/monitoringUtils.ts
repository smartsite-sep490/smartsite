import type { VideoTestDetection } from './videoTestFixture';

export interface Size2D {
  width: number;
  height: number;
}

export type NormalizedPoint = [number, number];

/**
 * Builds a WebSocket URL with an authentication token query parameter.
 * If the URL already contains a token query parameter, it is preserved.
 * Otherwise, the token from environment or argument is appended.
 * If no token is provided, returns an error.
 */
export function buildAiWebSocketUrl(
  rawUrl?: string,
  token?: string,
): { url: string | null; error: string | null } {
  const base = rawUrl?.trim() || 'ws://127.0.0.1:8000/ws/realtime';

  try {
    const protoCheck = base.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://');
    const parsed = new URL(protoCheck);
    const existingToken = parsed.searchParams.get('token');
    if (existingToken && existingToken.trim().length > 0) {
      return { url: base, error: null };
    }
  } catch {
    if (/[?&]token=[^&]+/.test(base)) {
      return { url: base, error: null };
    }
  }

  const trimmedToken = token?.trim();
  if (!trimmedToken) {
    return {
      url: null,
      error:
        'Realtime AI WebSocket requires an authentication token. Set VITE_AI_BACKEND_SERVICE_TOKEN or VITE_AI_WS_TOKEN.',
    };
  }

  const separator = base.includes('?') ? '&' : '?';
  return {
    url: `${base}${separator}token=${encodeURIComponent(trimmedToken)}`,
    error: null,
  };
}

/**
 * Separates socket offline state (null) from live empty detections ([]).
 * When live detections is empty array, it represents a valid empty live frame
 * and must NOT fall back to historical/test timeline fixtures.
 */
export function getEffectiveDetections(
  liveDetections: VideoTestDetection[] | null,
  fallbackDetections: VideoTestDetection[],
): { detections: VideoTestDetection[]; isLive: boolean } {
  if (liveDetections === null) {
    return { detections: fallbackDetections, isLive: false };
  }
  return { detections: liveDetections, isLive: true };
}

/**
 * Selects the primary detection for badges and summary cards in RestrictedZoneView.
 * Prioritizes the first active (intruding) track, and falls back to index 0.
 */
export function getPrimaryZoneDetection(
  detections: VideoTestDetection[],
): VideoTestDetection | null {
  if (!detections || detections.length === 0) return null;
  return detections.find((d) => d.active) ?? detections[0] ?? null;
}

/**
 * Generates a unique React key for PPE event table rows.
 * Prevents row merging when an event contains multiple missing PPE observations.
 */
export function getPpeEventRowKey(eventId: string, trackId: number, ppeItem?: string): string {
  return `${eventId}-${trackId}-${ppeItem ?? 'OBSERVATION'}`;
}

/**
 * Generates a unique React key for Zone event table rows.
 */
export function getZoneEventRowKey(eventId: string, trackId: number): string {
  return `${eventId}-${trackId}`;
}

/**
 * Maps a normalized point (0..1) on the video container element to the
 * normalized coordinate space (0..1) of the actual video frame when CSS object-cover is applied.
 */
export function mapContainerPointToVideoNormalized(
  point: NormalizedPoint,
  containerSize: Size2D,
  videoSize: Size2D,
): NormalizedPoint {
  if (
    containerSize.width <= 0 ||
    containerSize.height <= 0 ||
    videoSize.width <= 0 ||
    videoSize.height <= 0
  ) {
    return [Math.min(1, Math.max(0, point[0])), Math.min(1, Math.max(0, point[1]))];
  }

  const scale = Math.max(
    containerSize.width / videoSize.width,
    containerSize.height / videoSize.height,
  );
  const renderedWidth = videoSize.width * scale;
  const renderedHeight = videoSize.height * scale;
  const cropX = (renderedWidth - containerSize.width) / 2;
  const cropY = (renderedHeight - containerSize.height) / 2;

  const containerPixelX = point[0] * containerSize.width;
  const containerPixelY = point[1] * containerSize.height;

  const videoPixelX = containerPixelX + cropX;
  const videoPixelY = containerPixelY + cropY;

  const normX = Math.min(1, Math.max(0, videoPixelX / renderedWidth));
  const normY = Math.min(1, Math.max(0, videoPixelY / renderedHeight));

  return [normX, normY];
}

/**
 * Maps a normalized point (0..1) on the actual video frame to the
 * normalized coordinate space (0..1) on the container element under CSS object-cover.
 */
export function mapVideoNormalizedToContainerNormalized(
  point: NormalizedPoint,
  containerSize: Size2D,
  videoSize: Size2D,
): NormalizedPoint {
  if (
    containerSize.width <= 0 ||
    containerSize.height <= 0 ||
    videoSize.width <= 0 ||
    videoSize.height <= 0
  ) {
    return [Math.min(1, Math.max(0, point[0])), Math.min(1, Math.max(0, point[1]))];
  }

  const scale = Math.max(
    containerSize.width / videoSize.width,
    containerSize.height / videoSize.height,
  );
  const renderedWidth = videoSize.width * scale;
  const renderedHeight = videoSize.height * scale;
  const cropX = (renderedWidth - containerSize.width) / 2;
  const cropY = (renderedHeight - containerSize.height) / 2;

  const videoPixelX = point[0] * renderedWidth;
  const videoPixelY = point[1] * renderedHeight;

  const containerPixelX = videoPixelX - cropX;
  const containerPixelY = videoPixelY - cropY;

  const normX = Math.min(1, Math.max(0, containerPixelX / containerSize.width));
  const normY = Math.min(1, Math.max(0, containerPixelY / containerSize.height));

  return [normX, normY];
}

/**
 * Formats a Date object or current time to HH:mm:ss.
 */
export function formatClockTime(date = new Date()): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Creates an export payload clearly labeled as a browser-local draft.
 * Does NOT claim to be a contract v1 configuration file.
 */
export function exportZoneBrowserDraft(
  zonePolygon: NormalizedPoint[],
  cameraExternalId = 'CAM-04',
): { filename: string; content: string; label: string } {
  const payload = {
    _disclaimer:
      'Browser-local restricted zone draft. This configuration is stored in browser local storage and does not update AI socket detections or backend contracts.',
    cameraExternalId,
    regionId: 'crane-operation-zone-draft',
    coordinateSpace: 'NORMALIZED_0_1',
    polygon: zonePolygon,
    exportedAt: new Date().toISOString(),
  };

  const camSlug = cameraExternalId.toLowerCase().replace(/^cam-/, 'camera-');
  return {
    filename: `smartsite-restricted-zone-draft.${camSlug}.json`,
    content: `${JSON.stringify(payload, null, 2)}\n`,
    label: 'Browser-local draft (not a contract v1 configuration)',
  };
}
