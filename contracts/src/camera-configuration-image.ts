/** An explicit frozen authoring reference, never analyzed monitoring evidence. */
export const CONFIGURATION_REFERENCE_LIFETIME_MS = 300_000;
export const MAX_CONFIGURATION_JPEG_BYTES = 1_048_576;

export interface CameraConfigurationImageFrame {
  cameraExternalId: string;
  sessionId: string;
  sequenceNumber: string;
  capturedAt: string;
  width: number;
  height: number;
  imageDataUrl: string;
  /** SHA of the original JPEG bytes; the Backend must independently verify it. */
  imageSha256: string;
}
export interface CameraConfigurationSourceImage {
  schemaVersion: 1;
  purpose: 'REGION_CONFIGURATION';
  sourceKind: 'LIVE' | 'REPLAY';
  frame: CameraConfigurationImageFrame;
}
export interface CameraConfigurationImageResponse extends CameraConfigurationSourceImage {
  siteId: string;
  cameraId: string;
  configurationVersion: number;
  referenceExpiresAt: string;
}

/** Metadata only. The Backend must match persisted issuance and current view/grants on use. */
export interface CameraConfigurationImageReference {
  readonly schemaVersion: '1.0.0';
  readonly purpose: 'REGION_CONFIGURATION';
  readonly sourceKind: 'LIVE' | 'REPLAY';
  readonly referenceId: string;
  readonly siteId: string;
  readonly cameraId: string;
  readonly sessionId: string;
  readonly imageSha256: string;
  readonly width: number;
  readonly height: number;
  readonly capturedAt: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly configurationVersion: number;
  readonly viewRevision: number;
}

export interface CameraConfigurationReferenceResponse {
  readonly image: CameraConfigurationImageResponse;
  readonly reference: CameraConfigurationImageReference;
  readonly viewValidity: 'UNCONFIRMED';
}

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const frameKeys = [
  'cameraExternalId',
  'sessionId',
  'sequenceNumber',
  'capturedAt',
  'width',
  'height',
  'imageDataUrl',
  'imageSha256',
];
const sourceKeys = ['schemaVersion', 'purpose', 'sourceKind', 'frame'];
const responseKeys = [
  ...sourceKeys,
  'siteId',
  'cameraId',
  'configurationVersion',
  'referenceExpiresAt',
];
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
  Object.getOwnPropertySymbols(value).length === 0;
const text = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= limit;
function check(value: unknown): asserts value {
  if (!value) throw new Error('Camera configuration image is unavailable or malformed');
}
function exact(value: Record<string, unknown>, keys: string[]): void {
  check(
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)),
  );
}
function timestamp(value: unknown): number {
  check(
    text(value, 64) &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value),
  );
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  check(month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!);
  check(
    Number(value.slice(11, 13)) <= 23 &&
      Number(value.slice(14, 16)) <= 59 &&
      Number(value.slice(17, 19)) <= 59,
  );
  const parsed = Date.parse(value);
  check(Number.isFinite(parsed));
  return parsed;
}
function dimensions(width: unknown, height: unknown): void {
  for (const dimension of [width, height])
    check(
      Number.isInteger(dimension) && (dimension as number) >= 64 && (dimension as number) <= 1280,
    );
}

/** Bounds the transport and checks JPEG marker dimensions, not full image decode. */
export function decodeConfigurationJpeg(
  frame: Pick<CameraConfigurationImageFrame, 'imageDataUrl' | 'width' | 'height'>,
): Uint8Array {
  dimensions(frame.width, frame.height);
  check(text(frame.imageDataUrl, 1_400_000));
  const prefix = 'data:image/jpeg;base64,';
  check(frame.imageDataUrl.startsWith(prefix));
  const encoded = frame.imageDataUrl.slice(prefix.length);
  check(encoded.length > 0 && encoded.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded));
  let raw: string;
  try {
    raw = atob(encoded);
  } catch {
    check(false);
  }
  check(raw.length <= MAX_CONFIGURATION_JPEG_BYTES && btoa(raw) === encoded);
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  check(
    bytes.length >= 4 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[bytes.length - 2] === 255 &&
      bytes[bytes.length - 1] === 217,
  );
  let offset = 2;
  let hasDimensions = false;
  while (offset < bytes.length - 2) {
    check(bytes[offset++] === 255);
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    check(marker !== undefined && marker !== 0 && marker !== 216 && marker !== 217);
    check(offset + 2 <= bytes.length - 2);
    const length = bytes[offset]! * 256 + bytes[offset + 1]!;
    check(length >= 2 && offset + length <= bytes.length - 2);
    if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
      check(!hasDimensions && length >= 8);
      check(bytes[offset + 3]! * 256 + bytes[offset + 4]! === frame.height);
      check(bytes[offset + 5]! * 256 + bytes[offset + 6]! === frame.width);
      hasDimensions = true;
    }
    if (marker === 218) break;
    offset += length;
  }
  check(hasDimensions);
  return bytes;
}

function validateFrame(value: unknown): asserts value is CameraConfigurationImageFrame {
  check(object(value));
  exact(value, frameKeys);
  check(text(value.cameraExternalId, 128) && !/[\p{Cc}\p{Cs}]/u.test(value.cameraExternalId));
  check(text(value.sessionId, 36) && uuid.test(value.sessionId));
  check(text(value.sequenceNumber, 19) && /^(0|[1-9][0-9]{0,18})$/.test(value.sequenceNumber));
  check(BigInt(value.sequenceNumber) <= 9223372036854775807n);
  timestamp(value.capturedAt);
  dimensions(value.width, value.height);
  check(text(value.imageSha256, 64) && /^[a-f0-9]{64}$/.test(value.imageSha256));
  decodeConfigurationJpeg(value as unknown as CameraConfigurationImageFrame);
}
function validateSource(value: Record<string, unknown>): void {
  check(value.schemaVersion === 1 && value.purpose === 'REGION_CONFIGURATION');
  check(value.sourceKind === 'LIVE' || value.sourceKind === 'REPLAY');
  validateFrame(value.frame);
}
export function parseCameraConfigurationSourceImage(
  value: unknown,
): CameraConfigurationSourceImage {
  check(object(value));
  exact(value, sourceKeys);
  validateSource(value);
  return structuredClone(value) as unknown as CameraConfigurationSourceImage;
}
export function parseCameraConfigurationImageResponse(
  value: unknown,
): CameraConfigurationImageResponse {
  check(object(value));
  exact(value, responseKeys);
  validateSource(value);
  check(text(value.siteId, 36) && uuid.test(value.siteId));
  check(text(value.cameraId, 36) && uuid.test(value.cameraId));
  check(
    Number.isSafeInteger(value.configurationVersion) && (value.configurationVersion as number) > 0,
  );
  const lifetime =
    timestamp(value.referenceExpiresAt) -
    timestamp((value.frame as CameraConfigurationImageFrame).capturedAt);
  check(lifetime > 0 && lifetime <= CONFIGURATION_REFERENCE_LIFETIME_MS);
  return structuredClone(value) as unknown as CameraConfigurationImageResponse;
}

/** Structural validation does not establish server issuance, current expiry or camera stability. */
export function parseCameraConfigurationImageReference(
  value: unknown,
): CameraConfigurationImageReference {
  check(object(value));
  exact(value, [
    'schemaVersion',
    'purpose',
    'sourceKind',
    'referenceId',
    'siteId',
    'cameraId',
    'sessionId',
    'imageSha256',
    'width',
    'height',
    'capturedAt',
    'issuedAt',
    'expiresAt',
    'configurationVersion',
    'viewRevision',
  ]);
  check(value.schemaVersion === '1.0.0' && value.purpose === 'REGION_CONFIGURATION');
  check(value.sourceKind === 'LIVE' || value.sourceKind === 'REPLAY');
  for (const key of ['referenceId', 'siteId', 'cameraId', 'sessionId'])
    check(text(value[key], 36) && uuid.test(value[key] as string));
  check(text(value.imageSha256, 64) && /^[a-f0-9]{64}$/.test(value.imageSha256));
  dimensions(value.width, value.height);
  for (const key of ['configurationVersion', 'viewRevision'])
    check(Number.isSafeInteger(value[key]) && (value[key] as number) > 0);
  const captured = timestamp(value.capturedAt);
  const issued = timestamp(value.issuedAt);
  const expires = timestamp(value.expiresAt);
  // Match existing image-read freshness bounds without extending a frame's reference lifetime.
  check(issued - captured >= -1000 && issued - captured <= 2000);
  check(
    expires > issued && expires <= Math.min(captured, issued) + CONFIGURATION_REFERENCE_LIFETIME_MS,
  );
  return structuredClone(value) as unknown as CameraConfigurationImageReference;
}

/** Validates payload coherence only, not persisted Backend authority or JPEG cryptographic integrity. */
export function parseCameraConfigurationReferenceResponse(
  value: unknown,
): CameraConfigurationReferenceResponse {
  check(object(value));
  exact(value, ['image', 'reference', 'viewValidity']);
  check(value.viewValidity === 'UNCONFIRMED');
  const image = parseCameraConfigurationImageResponse(value.image);
  const reference = parseCameraConfigurationImageReference(value.reference);
  check(
    image.siteId.toLowerCase() === reference.siteId.toLowerCase() &&
      image.cameraId.toLowerCase() === reference.cameraId.toLowerCase() &&
      image.frame.sessionId.toLowerCase() === reference.sessionId.toLowerCase() &&
      image.sourceKind === reference.sourceKind &&
      image.frame.imageSha256 === reference.imageSha256 &&
      image.frame.width === reference.width &&
      image.frame.height === reference.height &&
      image.configurationVersion === reference.configurationVersion &&
      timestamp(image.frame.capturedAt) === timestamp(reference.capturedAt) &&
      timestamp(image.referenceExpiresAt) === timestamp(reference.expiresAt),
  );
  return { image, reference, viewValidity: 'UNCONFIRMED' };
}
