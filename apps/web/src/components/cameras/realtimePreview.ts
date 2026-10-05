import { PPE_ITEMS, type PpeItem } from '@smartsite/contracts/ppe-items';
import type { VideoTestDetection } from './videoTestFixture';

export interface RealtimePreview {
  zonePolygons: { regionId: string; geometryVersion: number; coordinates: [number, number][] }[];
  sessionId: string;
  sequenceNumber: string;
  cameraExternalId: string;
  capturedAt: string;
  width: number;
  height: number;
  imageDataUrl: string;
  detections: VideoTestDetection[];
  zoneDetections: VideoTestDetection[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function detections(value: unknown, camera: string, mode: 'ppe' | 'zone'): VideoTestDetection[] {
  if (!Array.isArray(value) || value.length > 1024) throw new Error('Invalid preview detections');
  return value.map((item: unknown) => {
    if (
      !record(item) ||
      !Number.isSafeInteger(item.trackId) ||
      (item.trackId as number) < 0 ||
      typeof item.confidence !== 'number' ||
      !Number.isFinite(item.confidence) ||
      item.confidence < 0 ||
      item.confidence > 1 ||
      typeof item.active !== 'boolean' ||
      typeof item.label !== 'string' ||
      item.label.length > 128 ||
      !record(item.boundingBox)
    ) {
      throw new Error('Invalid preview detection');
    }
    const box = item.boundingBox;
    const values = [box.x1, box.y1, box.x2, box.y2];
    if (
      !values.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) ||
      (box.x1 as number) >= (box.x2 as number) ||
      (box.y1 as number) >= (box.y2 as number)
    ) {
      throw new Error('Invalid preview box');
    }
    const status: VideoTestDetection['ppeStatus'] = {
      HARD_HAT: 'UNKNOWN',
      SAFETY_VEST: 'UNKNOWN',
    };
    if (mode === 'ppe') {
      if (!record(item.ppeStatus)) throw new Error('Invalid preview PPE status');
      for (const k of Object.keys(item.ppeStatus)) {
        if (!PPE_ITEMS.includes(k as PpeItem)) throw new Error('Invalid preview PPE status');
      }
      for (const key of ['HARD_HAT', 'SAFETY_VEST'] as const) {
        const state = item.ppeStatus[key];
        if (state !== 'UNKNOWN' && state !== 'MISSING' && state !== 'PRESENT')
          throw new Error('Invalid preview PPE status');
        status[key] = state;
      }
      for (const key of ['GLOVES', 'BOOTS', 'GOGGLES'] as const) {
        const state = item.ppeStatus[key];
        if (state !== undefined) {
          if (state !== 'UNKNOWN' && state !== 'MISSING' && state !== 'PRESENT')
            throw new Error('Invalid preview PPE status');
          status[key] = state;
        }
      }
    }
    const alertState = item.alertState;
    if (
      alertState !== undefined &&
      alertState !== 'UNKNOWN' &&
      alertState !== 'PENDING_CONFIRMATION' &&
      alertState !== 'COMPLIANT' &&
      alertState !== 'CONFIRMED'
    )
      throw new Error('Invalid preview alert state');
    const missing = item.confirmedMissingItems;
    if (
      missing !== undefined &&
      (!Array.isArray(missing) ||
        missing.length > PPE_ITEMS.length ||
        new Set(missing).size !== missing.length ||
        !missing.every((v): v is PpeItem => PPE_ITEMS.includes(v as PpeItem)))
    )
      throw new Error('Invalid preview PPE items');
    if (
      item.regionId !== undefined &&
      item.regionId !== null &&
      (typeof item.regionId !== 'string' || item.regionId.length > 128)
    )
      throw new Error('Invalid preview region');
    return {
      active: item.active,
      alertState,
      boundingBox: {
        x1: box.x1 as number,
        y1: box.y1 as number,
        x2: box.x2 as number,
        y2: box.y2 as number,
      },
      cameraExternalId: camera,
      confidence: item.confidence,
      confirmedMissingItems: missing as VideoTestDetection['confirmedMissingItems'],
      eventId: `REALTIME-${mode}-TRACK-${item.trackId}`,
      label: `${mode === 'ppe' ? 'MF04' : 'MF05'} ${item.label}`,
      ppeStatus: status,
      regionId: (item.regionId ?? undefined) as string | undefined,
      timecode: 'LIVE',
      trackId: item.trackId as number,
    };
  });
}

export function parseRealtimePreview(value: unknown): RealtimePreview {
  if (
    !record(value) ||
    value.type !== 'frame' ||
    value.previewVersion !== 1 ||
    typeof value.sessionId !== 'string' ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.sessionId) ||
    typeof value.sequenceNumber !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/.test(value.sequenceNumber) ||
    BigInt(value.sequenceNumber) > 9223372036854775807n ||
    typeof value.cameraExternalId !== 'string' ||
    value.cameraExternalId.length < 1 ||
    value.cameraExternalId.length > 128 ||
    typeof value.capturedAt !== 'string' ||
    value.capturedAt.length > 64 ||
    !Number.isFinite(Date.parse(value.capturedAt)) ||
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    (value.width as number) < 1 ||
    (value.height as number) < 1 ||
    (value.width as number) > 1280 ||
    (value.height as number) > 1280 ||
    typeof value.imageDataUrl !== 'string' ||
    value.imageDataUrl.length > 1_400_000 ||
    !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.imageDataUrl)
  ) {
    throw new Error('Synchronized preview unavailable or malformed');
  }
  const rawPolygons = value.zonePolygons ?? [];
  if (!Array.isArray(rawPolygons) || rawPolygons.length > 64)
    throw new Error('Invalid preview geometry');
  const zonePolygons = rawPolygons.map((polygon: unknown) => {
    if (
      !record(polygon) ||
      typeof polygon.regionId !== 'string' ||
      polygon.regionId.length > 128 ||
      !Number.isSafeInteger(polygon.geometryVersion) ||
      (polygon.geometryVersion as number) < 1 ||
      !Array.isArray(polygon.coordinates) ||
      polygon.coordinates.length < 3 ||
      polygon.coordinates.length > 64 ||
      !polygon.coordinates.every(
        (point: unknown) =>
          Array.isArray(point) &&
          point.length === 2 &&
          point.every(
            (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1,
          ),
      )
    ) {
      throw new Error('Invalid preview geometry');
    }
    return {
      regionId: polygon.regionId,
      geometryVersion: polygon.geometryVersion as number,
      coordinates: polygon.coordinates as [number, number][],
    };
  });
  return {
    zonePolygons,
    sessionId: value.sessionId,
    sequenceNumber: value.sequenceNumber,
    cameraExternalId: value.cameraExternalId,
    capturedAt: value.capturedAt,
    width: value.width as number,
    height: value.height as number,
    imageDataUrl: value.imageDataUrl,
    detections: detections(value.detections, value.cameraExternalId, 'ppe'),
    zoneDetections: detections(value.zoneDetections, value.cameraExternalId, 'zone'),
  };
}

// One active decode and one replaceable pending frame; reset invalidates in-flight work.
export function createPreviewDecoder<T>(
  decode: (frame: RealtimePreview) => Promise<T>,
  commit: (frame: RealtimePreview, image: T) => void,
  fail: () => void,
) {
  let generation = 0;
  let busy = false;
  let pending: RealtimePreview | null = null;
  let session: string | null = null;
  const drain = async () => {
    busy = true;
    while (pending) {
      const frame = pending;
      pending = null;
      const epoch = generation;
      try {
        const image = await decode(frame);
        if (epoch === generation) commit(frame, image);
      } catch {
        if (epoch === generation) fail();
      }
    }
    busy = false;
  };
  return {
    push(frame: RealtimePreview) {
      if (session !== frame.sessionId) {
        generation++;
        session = frame.sessionId;
      }
      pending = frame;
      if (!busy) void drain();
    },
    reset() {
      generation++;
      pending = null;
      session = null;
    },
  };
}
