import {
  parseCameraPreviewFrame,
  type CameraPreviewDetection,
  type CameraPreviewFrame,
} from '@smartsite/contracts/camera-preview';
import type { PpeItem } from '@smartsite/contracts/ppe-items';
import type { VideoTestDetection } from './videoTestFixture';

export { EXPERIMENTAL_OBJECT_CLASSES } from '@smartsite/contracts/camera-preview';
export const POSITIVE_PPE_OBJECT_CLASSES = [
  'Hardhat',
  'Safety Vest',
  'Gloves',
  'Boots',
  'Goggles',
  'Mask',
  'fullbody-Harness',
  'Lanyard-Hook',
] as const;
export const NEGATIVE_PPE_OBJECT_CLASSES = [
  'NO-Hardhat',
  'NO-Safety Vest',
  'NO-Gloves',
  'NO-Boots',
  'NO-Goggles',
  'NO-Mask',
] as const;

type WearerState = 'PRESENT' | 'MISSING' | 'UNKNOWN';
export type ScopedPreviewDetection = Omit<
  VideoTestDetection,
  'ppeStatus' | 'confirmedMissingItems'
> & {
  ppeStatus: Record<'HARD_HAT' | 'SAFETY_VEST', WearerState> &
    Partial<Record<PpeItem, WearerState>>;
  confirmedMissingItems?: readonly PpeItem[];
};
export type ScopedRealtimePreview = Omit<
  CameraPreviewFrame,
  'type' | 'previewVersion' | 'detections' | 'zoneDetections'
> & {
  detections: ScopedPreviewDetection[];
  zoneDetections: ScopedPreviewDetection[];
};
export interface ScopedDecodedPreview {
  frame: ScopedRealtimePreview;
  image: HTMLImageElement;
}

function toDisplayDetection(
  value: CameraPreviewDetection,
  cameraExternalId: string,
  mode: 'ppe' | 'zone',
): ScopedPreviewDetection {
  return {
    ...value,
    cameraExternalId,
    regionId: value.regionId ?? undefined,
    ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'UNKNOWN', ...value.ppeStatus },
    // Ephemeral frame-local display key, never a persisted MF08 alert ID or Worker identity.
    eventId: `REALTIME-${mode}-TRACK-${value.trackId}`,
    timecode: 'LIVE',
  };
}

/** Canonical scoped Backend frame; existing Main WebSocket/replay parser remains unchanged. */
export function parseScopedRealtimePreview(value: unknown): ScopedRealtimePreview {
  const frame = parseCameraPreviewFrame(value);
  return {
    ...frame,
    detections: frame.detections.map((item) =>
      toDisplayDetection(item, frame.cameraExternalId, 'ppe'),
    ),
    zoneDetections: frame.zoneDetections.map((item) =>
      toDisplayDetection(item, frame.cameraExternalId, 'zone'),
    ),
  };
}
