import { hasDuplicateJsonKeys } from './duplicate-json-keys.js';
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
export const CAMERA_PREVIEW_ZONE_ANCHORS = ['BOTTOM_CENTER', 'BOX_CENTER'] as const;
export type CameraPreviewZoneAnchor = (typeof CAMERA_PREVIEW_ZONE_ANCHORS)[number];

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
  /** Technical point tested against zone polygons; omitted means legacy BOTTOM_CENTER. */
  zoneAnchor?: CameraPreviewZoneAnchor;
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
export const CAMERA_OVERLAY_METADATA_VERSION = 1 as const;
export type CameraOverlayMetadataVersion = typeof CAMERA_OVERLAY_METADATA_VERSION;
export const SUPPORTED_CAMERA_OVERLAY_METADATA_VERSIONS = Object.freeze([
  CAMERA_OVERLAY_METADATA_VERSION,
] as const);
export const MAX_CAMERA_OVERLAY_METADATA_BYTES = 32_768;
export const MAX_CAMERA_OVERLAY_DETECTIONS = 256;
export const MAX_CAMERA_OVERLAY_MODEL_OBJECTS = 512;
export const MAX_CAMERA_MEDIA_FRAME_BYTES = 262_144;

/** Pixel-free aligned live overlay packet sent only via explicit raw-stream opt-in. */
export type CameraOverlayMetadataFrame = {
  type: 'overlay-metadata';
  overlayVersion: CameraOverlayMetadataVersion;
  sourceKind: 'LIVE';
  cameraExternalId: string;
  sessionId: string;
  sequenceNumber: string;
  capturedAt: string;
  width: number;
  height: number;
  zoneAnchor?: CameraPreviewZoneAnchor;
  zonePolygons: CameraPreviewFrame['zonePolygons'];
  detections: CameraPreviewDetection[];
  zoneDetections: CameraPreviewDetection[];
  modelObjects?: CameraPreviewModelObjects;
};

export type CameraMediaStreamPacket = CameraMediaFrame | CameraOverlayMetadataFrame;

/** Explicit opt-in options for multiplexed raw camera stream consumers; null/undefined disables overlay metadata. */
export type OptInCameraMediaStreamOptions = {
  overlayVersion?: number | null;
};

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
const RFC3339_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-](\d{2}):(\d{2}))$/;
const FORBIDDEN_OVERLAY_KEYS = new Set([
  'imageDataUrl',
  'image',
  'imageBytes',
  'imageSha256',
  'jpeg',
  'jpegBase64',
  'dataUrl',
  'pixels',
  'frame',
  'bytes',
  'mediaVersion',
  'previewVersion',
  'schemaVersion',
]);
const OVERLAY_METADATA_REQUIRED_KEYS = [
  'type',
  'overlayVersion',
  'sourceKind',
  'cameraExternalId',
  'sessionId',
  'sequenceNumber',
  'capturedAt',
  'width',
  'height',
  'zonePolygons',
  'detections',
  'zoneDetections',
] as const;
const OVERLAY_METADATA_ALLOWED_KEYS = new Set<string>([
  ...OVERLAY_METADATA_REQUIRED_KEYS,
  'zoneAnchor',
  'modelObjects',
]);
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

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
  validateFrameEnvelope(value, { maxDimension: 640 });
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
function isSafeText(value: unknown, max: number, requireNonBlank: boolean): value is string {
  return (
    text(value, max) &&
    !value.includes('\0') &&
    !LONE_SURROGATE.test(value) &&
    (!requireNonBlank || value.trim().length > 0)
  );
}
function parseRfc3339EpochMicros(value: unknown): bigint | null {
  if (!text(value, 64)) return null;
  const match = RFC3339_TIMESTAMP.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  let offsetMinutes = 0;
  const tz = match[8];
  if (tz !== 'Z') {
    const tzHours = Number(match[9]);
    const tzMinutes = Number(match[10]);
    if (tzHours > 23 || tzMinutes > 59) return null;
    offsetMinutes = (tz.startsWith('-') ? -1 : 1) * (tzHours * 60 + tzMinutes);
  }
  if (!Number.isFinite(Date.parse(value))) return null;
  const epochMs = BigInt(utc.getTime()) - BigInt(offsetMinutes) * 60_000n;
  const micros = BigInt((match[7] ?? '').padEnd(6, '0'));
  return epochMs * 1000n + micros;
}
function validatePlainJsonValue(value: unknown, depth = 0): void {
  check(depth <= 16);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    check(!value.includes('\0') && !LONE_SURROGATE.test(value));
    return;
  }
  if (typeof value === 'number') {
    check(Number.isFinite(value) && !Object.is(value, -0));
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      check(i in value && value[i] !== undefined);
      validatePlainJsonValue(value[i], depth + 1);
    }
    return;
  }
  check(typeof value === 'object' && value !== undefined);
  const proto: unknown = Object.getPrototypeOf(value);
  check(proto === Object.prototype || proto === null);
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    check(!key.includes('\0') && !LONE_SURROGATE.test(key) && entry !== undefined);
    validatePlainJsonValue(entry, depth + 1);
  }
}
function validateFrameEnvelope(
  value: Record<string, unknown>,
  options: { maxDimension: number; strict?: boolean },
): void {
  const strict = options.strict === true;
  check(
    (strict ? isSafeText(value.cameraExternalId, 128, true) : text(value.cameraExternalId, 128)) &&
      text(value.sessionId, 36) &&
      uuid.test(value.sessionId),
  );
  check(text(value.sequenceNumber, 19) && /^(0|[1-9][0-9]{0,18})$/.test(value.sequenceNumber));
  check(BigInt(value.sequenceNumber) <= 9223372036854775807n);
  if (strict) {
    check(parseRfc3339EpochMicros(value.capturedAt) !== null);
  } else {
    check(
      text(value.capturedAt, 64) &&
        RFC3339_TIMESTAMP.test(value.capturedAt) &&
        Number.isFinite(Date.parse(value.capturedAt)),
    );
  }
  check(
    Number.isInteger(value.width) &&
      (value.width as number) >= 1 &&
      (value.width as number) <= options.maxDimension,
  );
  check(
    Number.isInteger(value.height) &&
      (value.height as number) >= 1 &&
      (value.height as number) <= options.maxDimension,
  );
}
function validateModelObjects(value: unknown, maxDetections = 1024, strict = false): void {
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
  check(isSafeText(value.artifactId, 128, strict));
  check(typeof value.artifactSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.artifactSha256));
  check(Array.isArray(value.detections) && value.detections.length <= maxDetections);
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
function validateDetections(
  value: unknown,
  ppe: boolean,
  maxItems = 1024,
  strictSemantics = false,
): void {
  check(Array.isArray(value) && value.length <= maxItems);
  const seenKeys = strictSemantics ? new Set<string>() : null;
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
    check(
      unit(item.confidence) &&
        typeof item.active === 'boolean' &&
        (strictSemantics ? isSafeText(item.label, 128, true) : text(item.label, 128)),
    );
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
    check(
      item.regionId === undefined ||
        item.regionId === null ||
        (strictSemantics ? isSafeText(item.regionId, 128, true) : text(item.regionId, 128)),
    );
    if (seenKeys) {
      const normalizedRegion = typeof item.regionId === 'string' ? item.regionId.toLowerCase() : '';
      const dedupKey = ppe ? String(item.trackId) : `${item.trackId}:${normalizedRegion}`;
      check(!seenKeys.has(dedupKey));
      seenKeys.add(dedupKey);
      const statuses = item.ppeStatus as Partial<Record<PpeItem, string>> | undefined;
      const missing = item.confirmedMissingItems as readonly PpeItem[] | undefined;
      if (missing !== undefined && statuses !== undefined) {
        check(missing.every((missingItem) => statuses[missingItem] === 'MISSING'));
      }
      if (item.alertState === 'COMPLIANT') {
        check(missing === undefined || missing.length === 0);
        if (statuses !== undefined) {
          check(!Object.values(statuses).includes('MISSING'));
        }
      }
      if (ppe && item.alertState === 'CONFIRMED' && missing !== undefined) {
        check(missing.length > 0);
      }
    }
  }
}
function validateZonePolygons(value: unknown, uniqueRegionIds = false): void {
  check(Array.isArray(value) && value.length <= 64);
  const seenRegionIds = uniqueRegionIds ? new Set<string>() : null;
  for (const p of value) {
    check(
      object(p) &&
        (uniqueRegionIds ? isSafeText(p.regionId, 128, true) : text(p.regionId, 128)) &&
        Number.isSafeInteger(p.geometryVersion) &&
        (p.geometryVersion as number) >= 1,
    );
    check(
      Object.keys(p).every((key) => ['regionId', 'geometryVersion', 'coordinates'].includes(key)),
    );
    if (seenRegionIds) {
      const normalizedRegionId = (p.regionId as string).toLowerCase();
      check(!seenRegionIds.has(normalizedRegionId));
      seenRegionIds.add(normalizedRegionId);
    }
    check(Array.isArray(p.coordinates) && p.coordinates.length >= 3 && p.coordinates.length <= 64);
    check(
      p.coordinates.every(
        (point: unknown) => Array.isArray(point) && point.length === 2 && point.every(unit),
      ),
    );
  }
}
export function parseCameraPreviewFrame(value: unknown): CameraPreviewFrame {
  check(object(value) && value.type === 'frame' && value.previewVersion === 1);
  validateFrameEnvelope(value, { maxDimension: 1280 });
  check(
    text(value.imageDataUrl, 1_400_000) &&
      /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.imageDataUrl),
  );
  validateDetections(value.detections, true);
  validateDetections(value.zoneDetections, false);
  check(
    value.zoneAnchor === undefined ||
      value.zoneAnchor === 'BOTTOM_CENTER' ||
      value.zoneAnchor === 'BOX_CENTER',
  );
  if (value.modelObjects !== undefined) validateModelObjects(value.modelObjects);
  validateZonePolygons(value.zonePolygons);
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
        'zoneAnchor',
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

/** Validates an explicit query/header opt-in version; returns null only when omitted. */
export function parseOptInOverlayMetadataVersion(
  value: unknown,
): CameraOverlayMetadataVersion | null {
  if (value === undefined) return null;
  if (
    value === CAMERA_OVERLAY_METADATA_VERSION ||
    value === String(CAMERA_OVERLAY_METADATA_VERSION)
  ) {
    return CAMERA_OVERLAY_METADATA_VERSION;
  }
  throw new Error('Camera preview is unavailable or malformed');
}

/** Validates a pixel-free aligned live overlay-metadata packet with strict size, identity and semantic bounds. */
export function parseCameraOverlayMetadataFrame(value: unknown): CameraOverlayMetadataFrame {
  check(
    object(value) &&
      value.type === 'overlay-metadata' &&
      value.overlayVersion === CAMERA_OVERLAY_METADATA_VERSION &&
      value.sourceKind === 'LIVE',
  );
  validatePlainJsonValue(value);
  for (const key of Object.keys(value)) {
    check(!FORBIDDEN_OVERLAY_KEYS.has(key) && OVERLAY_METADATA_ALLOWED_KEYS.has(key));
  }
  for (const requiredKey of OVERLAY_METADATA_REQUIRED_KEYS) {
    check(requiredKey in value);
  }
  validateFrameEnvelope(value, { maxDimension: 1280, strict: true });
  check(
    !('zoneAnchor' in value) ||
      value.zoneAnchor === 'BOTTOM_CENTER' ||
      value.zoneAnchor === 'BOX_CENTER',
  );
  validateZonePolygons(value.zonePolygons, true);
  validateDetections(value.detections, true, MAX_CAMERA_OVERLAY_DETECTIONS, true);
  validateDetections(value.zoneDetections, false, MAX_CAMERA_OVERLAY_DETECTIONS, true);
  if ('modelObjects' in value) {
    validateModelObjects(value.modelObjects, MAX_CAMERA_OVERLAY_MODEL_OBJECTS, true);
  }
  check(utf8Encoder.encode(JSON.stringify(value)).byteLength <= MAX_CAMERA_OVERLAY_METADATA_BYTES);
  return structuredClone(value) as CameraOverlayMetadataFrame;
}

function parseCameraJsonPayload(
  payload: string | Uint8Array,
  maxBytes: number,
): { data: unknown; byteLength: number } {
  check(typeof payload === 'string' || payload instanceof Uint8Array);
  const byteLength =
    typeof payload === 'string' ? utf8Encoder.encode(payload).byteLength : payload.byteLength;
  check(byteLength <= maxBytes);
  let rawText: string;
  try {
    rawText = typeof payload === 'string' ? payload : utf8Decoder.decode(payload);
  } catch {
    throw new Error('Camera preview is unavailable or malformed');
  }
  check(!rawText.startsWith('\uFEFF') && !LONE_SURROGATE.test(rawText));
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error('Camera preview is unavailable or malformed');
  }
  check(!hasDuplicateJsonKeys(rawText));
  return { data, byteLength };
}

/** Decodes a UTF-8 wire payload and validates it as a bounded overlay-metadata packet. */
export function parseCameraOverlayMetadataPayload(
  payload: string | Uint8Array,
): CameraOverlayMetadataFrame {
  const { data } = parseCameraJsonPayload(payload, MAX_CAMERA_OVERLAY_METADATA_BYTES);
  return parseCameraOverlayMetadataFrame(data);
}

function resolveOptInStreamOptions(
  options?: OptInCameraMediaStreamOptions,
): CameraOverlayMetadataVersion | null {
  if (options === undefined) return null;
  check(object(options));
  check(Object.keys(options).every((key) => key === 'overlayVersion'));
  if (
    !('overlayVersion' in options) ||
    options.overlayVersion === undefined ||
    options.overlayVersion === null
  ) {
    return null;
  }
  check(options.overlayVersion === CAMERA_OVERLAY_METADATA_VERSION);
  return CAMERA_OVERLAY_METADATA_VERSION;
}

/** Parses one multiplexed raw-stream packet while rejecting overlay-metadata unless explicitly opted in. */
export function parseOptInCameraMediaStreamPacket(
  value: unknown,
  options?: OptInCameraMediaStreamOptions,
): CameraMediaStreamPacket {
  const optedInVersion = resolveOptInStreamOptions(options);
  check(object(value));
  if (value.type === 'media-frame') {
    return parseCameraMediaFrame(value);
  }
  if (value.type === 'overlay-metadata') {
    check(optedInVersion === CAMERA_OVERLAY_METADATA_VERSION);
    return parseCameraOverlayMetadataFrame(value);
  }
  throw new Error('Camera preview is unavailable or malformed');
}

/** Decodes one multiplexed NDJSON line and enforces packet-specific byte ceilings before parsing. */
export function parseOptInCameraMediaStreamPayload(
  payload: string | Uint8Array,
  options?: OptInCameraMediaStreamOptions,
): CameraMediaStreamPacket {
  const optedInVersion = resolveOptInStreamOptions(options);
  const { data, byteLength } = parseCameraJsonPayload(payload, MAX_CAMERA_MEDIA_FRAME_BYTES);
  check(object(data));
  if (data.type === 'overlay-metadata') {
    check(
      optedInVersion === CAMERA_OVERLAY_METADATA_VERSION &&
        byteLength <= MAX_CAMERA_OVERLAY_METADATA_BYTES,
    );
    return parseCameraOverlayMetadataFrame(data);
  }
  if (data.type === 'media-frame') {
    return parseCameraMediaFrame(data);
  }
  throw new Error('Camera preview is unavailable or malformed');
}

/** Verifies whether a raw media-frame and an overlay-metadata packet share exact camera/session/sequence/instant identity. */
export function isAlignedMediaAndOverlayIdentity(
  media: Pick<CameraMediaFrame, 'cameraExternalId' | 'sessionId' | 'sequenceNumber' | 'capturedAt'>,
  metadata: Pick<
    CameraOverlayMetadataFrame,
    'cameraExternalId' | 'sessionId' | 'sequenceNumber' | 'capturedAt'
  >,
): boolean {
  if (!object(media) || !object(metadata)) return false;
  if (
    !isSafeText(media.cameraExternalId, 128, true) ||
    !isSafeText(metadata.cameraExternalId, 128, true) ||
    !text(media.sessionId, 36) ||
    !uuid.test(media.sessionId) ||
    !text(metadata.sessionId, 36) ||
    !uuid.test(metadata.sessionId) ||
    !text(media.sequenceNumber, 19) ||
    !/^(0|[1-9][0-9]{0,18})$/.test(media.sequenceNumber) ||
    BigInt(media.sequenceNumber) > 9223372036854775807n ||
    !text(metadata.sequenceNumber, 19) ||
    !/^(0|[1-9][0-9]{0,18})$/.test(metadata.sequenceNumber) ||
    BigInt(metadata.sequenceNumber) > 9223372036854775807n
  ) {
    return false;
  }
  const mediaEpochUs = parseRfc3339EpochMicros(media.capturedAt);
  const metadataEpochUs = parseRfc3339EpochMicros(metadata.capturedAt);
  if (mediaEpochUs === null || metadataEpochUs === null) return false;
  return (
    media.cameraExternalId === metadata.cameraExternalId &&
    media.sessionId.toLowerCase() === metadata.sessionId.toLowerCase() &&
    media.sequenceNumber === metadata.sequenceNumber &&
    mediaEpochUs === metadataEpochUs
  );
}
