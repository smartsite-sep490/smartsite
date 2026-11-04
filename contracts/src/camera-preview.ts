import { PPE_ITEMS, type PpeItem } from './ppe-items.js';

export const EXPERIMENTAL_OBJECT_CLASSES = [
  'Person',
  'Hardhat',
  'NO-Hardhat',
  'Safety Vest',
  'NO-Safety Vest',
  'Gloves',
  'NO-Gloves',
  'Boots',
  'NO-Boots',
  'Goggles',
  'NO-Goggles',
  'Mask',
  'NO-Mask',
  'fullbody-Harness',
  'Lanyard-Hook',
] as const;

export type CameraPreviewModelObjects = {
  modelFamily: 'yolo11s';
  experimental: true;
  scope: 'OBJECT_DETECTION_ONLY';
  artifactId: string;
  artifactSha256: string;
  detections: {
    classId: number;
    className: (typeof EXPERIMENTAL_OBJECT_CLASSES)[number];
    confidence: number;
    boundingBox: {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      coordinateSpace: 'NORMALIZED_0_1';
    };
  }[];
};

export type CameraPreviewDetection = {
  trackId: number;
  confidence: number;
  active: boolean;
  label: string;
  boundingBox: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    coordinateSpace?: 'NORMALIZED_0_1';
  };
  ppeStatus?: Partial<Record<PpeItem, 'PRESENT' | 'MISSING' | 'UNKNOWN'>>;
  alertState?: 'UNKNOWN' | 'PENDING_CONFIRMATION' | 'COMPLIANT' | 'CONFIRMED';
  confirmedMissingItems?: PpeItem[];
  regionId?: string | null;
};
export type CameraPreviewFrame = {
  type: 'frame';
  previewVersion: 1;
  cameraExternalId: string;
  sessionId: string;
  sequenceNumber: string;
  capturedAt: string;
  width: number;
  height: number;
  imageDataUrl: string;
  detections: CameraPreviewDetection[];
  zoneDetections: CameraPreviewDetection[];
  zonePolygons: { regionId: string; geometryVersion: number; coordinates: [number, number][] }[];
  /** Same-frame raw objects, separate from wearer states and business decisions. */
  modelObjects?: CameraPreviewModelObjects;
};
export type CameraPreviewResponse = {
  siteId: string;
  cameraId: string;
  cameraExternalId: string;
  sourceKind: 'LIVE' | 'REPLAY';
  frame: CameraPreviewFrame;
};
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
/** Raw display pixels only. AI evidence stays on its original analyzed frame. */
export type CameraMediaFrame = {
  type: 'media-frame';
  mediaVersion: 1;
  cameraExternalId: string;
  sessionId: string;
  sequenceNumber: string;
  capturedAt: string;
  width: number;
  height: number;
  imageDataUrl: string;
};
export function parseCameraMediaFrame(value: unknown): CameraMediaFrame {
  check(object(value) && value.type === 'media-frame' && value.mediaVersion === 1);
  check(
    Object.keys(value).length === 9 &&
      Object.keys(value).every((key) =>
        [
          'type',
          'mediaVersion',
          'cameraExternalId',
          'sessionId',
          'sequenceNumber',
          'capturedAt',
          'width',
          'height',
          'imageDataUrl',
        ].includes(key),
      ),
  );
  check(
    text(value.cameraExternalId, 128) && text(value.sessionId, 36) && uuid.test(value.sessionId),
  );
  check(text(value.sequenceNumber, 19) && /^(0|[1-9][0-9]{0,18})$/.test(value.sequenceNumber));
  check(BigInt(value.sequenceNumber) <= 9223372036854775807n);
  check(
    text(value.capturedAt, 64) &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value.capturedAt,
      ) &&
      Number.isFinite(Date.parse(value.capturedAt)),
  );
  check(
    Number.isInteger(value.width) && (value.width as number) >= 1 && (value.width as number) <= 640,
  );
  check(
    Number.isInteger(value.height) &&
      (value.height as number) >= 1 &&
      (value.height as number) <= 640,
  );
  check(
    text(value.imageDataUrl, 180000) &&
      /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.imageDataUrl),
  );
  return structuredClone(value) as CameraMediaFrame;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function check(condition: unknown): asserts condition {
  if (!condition) throw new Error('Camera preview is unavailable or malformed');
}
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const unit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
function validateModelObjects(value: unknown): void {
  check(object(value));
  check(
    Object.keys(value).every((key) =>
      [
        'modelFamily',
        'experimental',
        'scope',
        'artifactId',
        'artifactSha256',
        'detections',
      ].includes(key),
    ),
  );
  check(
    value.modelFamily === 'yolo11s' &&
      value.experimental === true &&
      value.scope === 'OBJECT_DETECTION_ONLY',
  );
  check(text(value.artifactId, 128) && !value.artifactId.includes('\0'));
  check(typeof value.artifactSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.artifactSha256));
  check(Array.isArray(value.detections) && value.detections.length <= 1024);
  for (const item of value.detections) {
    check(object(item));
    check(
      Object.keys(item).every((key) =>
        ['classId', 'className', 'confidence', 'boundingBox'].includes(key),
      ),
    );
    check(
      Number.isInteger(item.classId) &&
        (item.classId as number) >= 0 &&
        (item.classId as number) < EXPERIMENTAL_OBJECT_CLASSES.length,
    );
    check(
      item.className === EXPERIMENTAL_OBJECT_CLASSES[item.classId as number] &&
        unit(item.confidence),
    );
    check(object(item.boundingBox));
    const b = item.boundingBox;
    check(Object.keys(b).every((key) => ['x1', 'y1', 'x2', 'y2', 'coordinateSpace'].includes(key)));
    check(b.coordinateSpace === 'NORMALIZED_0_1');
    check(unit(b.x1) && unit(b.y1) && unit(b.x2) && unit(b.y2) && b.x1 < b.x2 && b.y1 < b.y2);
  }
}
function validateDetections(value: unknown, ppe: boolean): void {
  check(Array.isArray(value) && value.length <= 1024);
  for (const item of value) {
    check(object(item) && Number.isSafeInteger(item.trackId) && (item.trackId as number) >= 0);
    check(
      Object.keys(item).every((key) =>
        [
          'trackId',
          'confidence',
          'active',
          'label',
          'boundingBox',
          'ppeStatus',
          'alertState',
          'confirmedMissingItems',
          'regionId',
        ].includes(key),
      ),
    );
    check(unit(item.confidence) && typeof item.active === 'boolean' && text(item.label, 128));
    check(object(item.boundingBox));
    const b = item.boundingBox;
    check(Object.keys(b).every((key) => ['x1', 'y1', 'x2', 'y2', 'coordinateSpace'].includes(key)));
    check(b.coordinateSpace === undefined || b.coordinateSpace === 'NORMALIZED_0_1');
    check(unit(b.x1) && unit(b.y1) && unit(b.x2) && unit(b.y2) && b.x1 < b.x2 && b.y1 < b.y2);
    if (ppe || item.ppeStatus !== undefined) {
      const statuses = item.ppeStatus;
      check(object(statuses));
      check(['HARD_HAT', 'SAFETY_VEST'].every((k) => k in statuses));
      for (const [key, state] of Object.entries(statuses)) {
        check(
          PPE_ITEMS.includes(key as PpeItem) &&
            ['PRESENT', 'MISSING', 'UNKNOWN'].includes(state as string),
        );
      }
    }
    check(
      item.alertState === undefined ||
        ['UNKNOWN', 'PENDING_CONFIRMATION', 'COMPLIANT', 'CONFIRMED'].includes(
          item.alertState as string,
        ),
    );
    if (item.confirmedMissingItems !== undefined) {
      const items = item.confirmedMissingItems;
      check(
        Array.isArray(items) &&
          items.length <= PPE_ITEMS.length &&
          new Set(items).size === items.length,
      );
      check(items.every((key: unknown) => PPE_ITEMS.includes(key as PpeItem)));
    }
    check(item.regionId === undefined || item.regionId === null || text(item.regionId, 128));
  }
}
export function parseCameraPreviewFrame(value: unknown): CameraPreviewFrame {
  check(object(value) && value.type === 'frame' && value.previewVersion === 1);
  check(
    text(value.cameraExternalId, 128) && text(value.sessionId, 36) && uuid.test(value.sessionId),
  );
  check(text(value.sequenceNumber, 19) && /^(0|[1-9][0-9]{0,18})$/.test(value.sequenceNumber));
  check(BigInt(value.sequenceNumber) <= 9223372036854775807n);
  check(
    text(value.capturedAt, 64) &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value.capturedAt,
      ) &&
      Number.isFinite(Date.parse(value.capturedAt)),
  );
  check(
    Number.isInteger(value.width) &&
      (value.width as number) >= 1 &&
      (value.width as number) <= 1280,
  );
  check(
    Number.isInteger(value.height) &&
      (value.height as number) >= 1 &&
      (value.height as number) <= 1280,
  );
  check(
    text(value.imageDataUrl, 1_400_000) &&
      /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.imageDataUrl),
  );
  validateDetections(value.detections, true);
  validateDetections(value.zoneDetections, false);
  if (value.modelObjects !== undefined) validateModelObjects(value.modelObjects);
  check(Array.isArray(value.zonePolygons) && value.zonePolygons.length <= 64);
  for (const p of value.zonePolygons) {
    check(
      object(p) &&
        text(p.regionId, 128) &&
        Number.isSafeInteger(p.geometryVersion) &&
        (p.geometryVersion as number) >= 1,
    );
    check(
      Object.keys(p).every((key) => ['regionId', 'geometryVersion', 'coordinates'].includes(key)),
    );
    check(Array.isArray(p.coordinates) && p.coordinates.length >= 3 && p.coordinates.length <= 64);
    check(
      p.coordinates.every(
        (point: unknown) => Array.isArray(point) && point.length === 2 && point.every(unit),
      ),
    );
  }
  check(
    Object.keys(value).every((key) =>
      [
        'type',
        'previewVersion',
        'cameraExternalId',
        'sessionId',
        'sequenceNumber',
        'capturedAt',
        'width',
        'height',
        'imageDataUrl',
        'detections',
        'zoneDetections',
        'zonePolygons',
        'modelObjects',
      ].includes(key),
    ),
  );
  return value as unknown as CameraPreviewFrame;
}
export function parseCameraPreviewResponse(value: unknown): CameraPreviewResponse {
  check(object(value));
  check(
    text(value.siteId, 36) &&
      uuid.test(value.siteId) &&
      text(value.cameraId, 36) &&
      uuid.test(value.cameraId),
  );
  check(value.sourceKind === 'LIVE' || value.sourceKind === 'REPLAY');
  const frame = parseCameraPreviewFrame(value.frame);
  check(value.cameraExternalId === frame.cameraExternalId);
  check(
    Object.keys(value).every((key) =>
      ['siteId', 'cameraId', 'cameraExternalId', 'sourceKind', 'frame'].includes(key),
    ),
  );
  return value as unknown as CameraPreviewResponse;
}
