export const BROWSER_CAMERA_UPLINK_SCHEMA_VERSION = '1.0.0' as const;

export const BROWSER_CAMERA_UPLINK_MIN_DIMENSION = 64;
export const BROWSER_CAMERA_UPLINK_MAX_DIMENSION = 1280;
/** Defaults fit directly into CameraMediaFrame (<= 640px, <= 180,000-char data URL) with zero server re-encode. */
export const BROWSER_CAMERA_UPLINK_DEFAULT_MAX_WIDTH = 640;
export const BROWSER_CAMERA_UPLINK_DEFAULT_MAX_HEIGHT = 480;
export const BROWSER_CAMERA_UPLINK_DEFAULT_MAX_FRAME_BYTES = 130_000;
/** Hard ceiling aligned with 250 KiB multi-instance UNLOGGED row limit. */
export const BROWSER_CAMERA_UPLINK_MAX_FRAME_BYTES = 256_000;

export const BROWSER_CAMERA_UPLINK_MIN_INTERVAL_MS = 500;
/** 1.5 FPS (~90 req/min) fits safely within default HTTP_RATE_LIMIT_LIMIT=120/60s. */
export const BROWSER_CAMERA_UPLINK_DEFAULT_INTERVAL_MS = 667;
export const BROWSER_CAMERA_UPLINK_MAX_INTERVAL_MS = 5_000;

/** Freshness boundaries aligned with CameraMediaFrame validation. */
export const BROWSER_CAMERA_UPLINK_MAX_PAST_AGE_MS = 2_000;
export const BROWSER_CAMERA_UPLINK_MAX_FUTURE_SKEW_MS = 1_000;

export const BROWSER_CAMERA_UPLINK_START_LEASE_TTL_MS = 15_000;
export const BROWSER_CAMERA_UPLINK_SLIDING_LEASE_TTL_MS = 10_000;

export const BROWSER_CAMERA_UPLINK_STATES = ['ACTIVE', 'STOPPED', 'EXPIRED', 'REVOKED'] as const;
export type BrowserCameraUplinkState = (typeof BROWSER_CAMERA_UPLINK_STATES)[number];

export const BROWSER_CAMERA_UPLINK_STOP_REASONS = [
  'USER_STOPPED',
  'PAGE_HIDDEN',
  'SOURCE_SWITCHED',
  'TRACK_ENDED',
  'AUTH_REVOKED',
  'CLIENT_ERROR',
] as const;
export type BrowserCameraUplinkStopReason = (typeof BROWSER_CAMERA_UPLINK_STOP_REASONS)[number];

export const BROWSER_CAMERA_UPLINK_ERROR_CODES = [
  'LEASE_HELD',
  'LEASE_EXPIRED',
  'LEASE_NOT_FOUND',
  'FRAME_TOO_LARGE',
  'FRAME_STALE',
  'INVALID_MEDIA_TYPE',
  'UNSUPPORTED_CAPABILITY',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'CAMERA_INACTIVE',
  'RATE_LIMITED',
] as const;
export type BrowserCameraUplinkErrorCode = (typeof BROWSER_CAMERA_UPLINK_ERROR_CODES)[number];

export interface BrowserCameraUplinkStartCommand {
  clientSessionId: string;
  deviceLabel?: string;
  targetIntervalMs?: number;
}

export interface BrowserCameraUplinkStartResponse {
  schemaVersion: typeof BROWSER_CAMERA_UPLINK_SCHEMA_VERSION;
  leaseId: string;
  siteId: string;
  cameraId: string;
  state: 'ACTIVE';
  leaseExpiresAt: string;
  maxFrameBytes: number;
  maxWidth: number;
  maxHeight: number;
  recommendedIntervalMs: number;
}

export interface BrowserCameraUplinkFrameMetadata {
  leaseId: string;
  sequence: number;
  capturedAt: string;
  width: number;
  height: number;
  byteLength: number;
}

export interface BrowserCameraUplinkFrameReceipt {
  schemaVersion: typeof BROWSER_CAMERA_UPLINK_SCHEMA_VERSION;
  leaseId: string;
  sequence: number;
  acceptedAt: string;
  leaseExpiresAt: string;
  width: number;
  height: number;
  byteLength: number;
}

export interface BrowserCameraUplinkStopCommand {
  leaseId: string;
  reason?: BrowserCameraUplinkStopReason;
}

export interface BrowserCameraUplinkStopResponse {
  schemaVersion: typeof BROWSER_CAMERA_UPLINK_SCHEMA_VERSION;
  leaseId: string;
  state: 'STOPPED';
  stoppedAt: string;
}

export interface BrowserCameraUplinkStatusResponse {
  schemaVersion: typeof BROWSER_CAMERA_UPLINK_SCHEMA_VERSION;
  supported: boolean;
  siteId: string;
  cameraId: string;
  state: BrowserCameraUplinkState | 'IDLE';
  activeLeaseId?: string | null;
  ownedByCurrentUser?: boolean;
  lastSequence?: number | null;
  lastFrameCapturedAt?: string | null;
  leaseExpiresAt?: string | null;
  width?: number | null;
  height?: number | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new Error(`${label} contains unsupported field '${key}'`);
    }
  }
}

function parseUuid(value: unknown, field: string): string {
  check(typeof value === 'string' && UUID_PATTERN.test(value), `${field} must be a valid UUID`);
  return value;
}

function parseTimestamp(value: unknown, field: string): string {
  check(
    typeof value === 'string' &&
      value.length <= 64 &&
      RFC3339_PATTERN.test(value) &&
      Number.isFinite(Date.parse(value)),
    `${field} must be a valid RFC 3339 timestamp`,
  );
  return value;
}

function parseIntRange(value: unknown, min: number, max: number, field: string): number {
  check(
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max,
    `${field} must be an integer between ${min} and ${max}`,
  );
  return value;
}

function parseNonEmptyText(value: unknown, max: number, field: string): string {
  check(
    typeof value === 'string' && value.trim().length > 0 && value.length <= max,
    `${field} must be a non-empty string of at most ${max} characters`,
  );
  return value;
}

export function isJpegPayload(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function isFreshBrowserUplinkTimestamp(
  capturedAt: string,
  nowMs: number = Date.now(),
): boolean {
  if (typeof capturedAt !== 'string' || !RFC3339_PATTERN.test(capturedAt)) return false;
  const capturedMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedMs) || !Number.isFinite(nowMs)) return false;
  const ageMs = nowMs - capturedMs;
  if (ageMs >= BROWSER_CAMERA_UPLINK_MAX_PAST_AGE_MS) return false;
  const futureMs = capturedMs - nowMs;
  if (futureMs > BROWSER_CAMERA_UPLINK_MAX_FUTURE_SKEW_MS) return false;
  return true;
}

export function parseBrowserCameraUplinkStartCommand(
  value: unknown,
): BrowserCameraUplinkStartCommand {
  check(isRecord(value), 'Browser uplink start command must be an object');
  assertOnlyKeys(
    value,
    ['clientSessionId', 'deviceLabel', 'targetIntervalMs'],
    'Browser uplink start command',
  );
  const clientSessionId = parseNonEmptyText(value.clientSessionId, 128, 'clientSessionId');
  const result: BrowserCameraUplinkStartCommand = { clientSessionId };
  if (value.deviceLabel !== undefined) {
    result.deviceLabel = parseNonEmptyText(value.deviceLabel, 160, 'deviceLabel');
  }
  if (value.targetIntervalMs !== undefined) {
    result.targetIntervalMs = parseIntRange(
      value.targetIntervalMs,
      BROWSER_CAMERA_UPLINK_MIN_INTERVAL_MS,
      BROWSER_CAMERA_UPLINK_MAX_INTERVAL_MS,
      'targetIntervalMs',
    );
  }
  return result;
}

export function parseBrowserCameraUplinkStartResponse(
  value: unknown,
): BrowserCameraUplinkStartResponse {
  check(isRecord(value), 'Browser uplink start response must be an object');
  assertOnlyKeys(
    value,
    [
      'schemaVersion',
      'leaseId',
      'siteId',
      'cameraId',
      'state',
      'leaseExpiresAt',
      'maxFrameBytes',
      'maxWidth',
      'maxHeight',
      'recommendedIntervalMs',
    ],
    'Browser uplink start response',
  );
  check(
    value.schemaVersion === BROWSER_CAMERA_UPLINK_SCHEMA_VERSION,
    'Unsupported browser uplink schemaVersion',
  );
  check(value.state === 'ACTIVE', 'Browser uplink start response state must be ACTIVE');
  return {
    schemaVersion: BROWSER_CAMERA_UPLINK_SCHEMA_VERSION,
    leaseId: parseUuid(value.leaseId, 'leaseId'),
    siteId: parseUuid(value.siteId, 'siteId'),
    cameraId: parseUuid(value.cameraId, 'cameraId'),
    state: 'ACTIVE',
    leaseExpiresAt: parseTimestamp(value.leaseExpiresAt, 'leaseExpiresAt'),
    maxFrameBytes: parseIntRange(
      value.maxFrameBytes,
      1024,
      BROWSER_CAMERA_UPLINK_MAX_FRAME_BYTES,
      'maxFrameBytes',
    ),
    maxWidth: parseIntRange(
      value.maxWidth,
      BROWSER_CAMERA_UPLINK_MIN_DIMENSION,
      BROWSER_CAMERA_UPLINK_MAX_DIMENSION,
      'maxWidth',
    ),
    maxHeight: parseIntRange(
      value.maxHeight,
      BROWSER_CAMERA_UPLINK_MIN_DIMENSION,
      BROWSER_CAMERA_UPLINK_MAX_DIMENSION,
      'maxHeight',
    ),
    recommendedIntervalMs: parseIntRange(
      value.recommendedIntervalMs,
      BROWSER_CAMERA_UPLINK_MIN_INTERVAL_MS,
      BROWSER_CAMERA_UPLINK_MAX_INTERVAL_MS,
      'recommendedIntervalMs',
    ),
  };
}

export function parseBrowserCameraUplinkFrameMetadata(
  value: unknown,
): BrowserCameraUplinkFrameMetadata {
  check(isRecord(value), 'Browser uplink frame metadata must be an object');
  assertOnlyKeys(
    value,
    ['leaseId', 'sequence', 'capturedAt', 'width', 'height', 'byteLength'],
    'Browser uplink frame metadata',
  );
  return {
    leaseId: parseUuid(value.leaseId, 'leaseId'),
    sequence: parseIntRange(value.sequence, 1, Number.MAX_SAFE_INTEGER, 'sequence'),
    capturedAt: parseTimestamp(value.capturedAt, 'capturedAt'),
    width: parseIntRange(
      value.width,
      BROWSER_CAMERA_UPLINK_MIN_DIMENSION,
      BROWSER_CAMERA_UPLINK_MAX_DIMENSION,
      'width',
    ),
    height: parseIntRange(
      value.height,
      BROWSER_CAMERA_UPLINK_MIN_DIMENSION,
      BROWSER_CAMERA_UPLINK_MAX_DIMENSION,
      'height',
    ),
    byteLength: parseIntRange(
      value.byteLength,
      3,
      BROWSER_CAMERA_UPLINK_MAX_FRAME_BYTES,
      'byteLength',
    ),
  };
}

export function parseBrowserCameraUplinkFrameReceipt(
  value: unknown,
): BrowserCameraUplinkFrameReceipt {
  check(isRecord(value), 'Browser uplink frame receipt must be an object');
  assertOnlyKeys(
    value,
    [
      'schemaVersion',
      'leaseId',
      'sequence',
      'acceptedAt',
      'leaseExpiresAt',
      'width',
      'height',
      'byteLength',
    ],
    'Browser uplink frame receipt',
  );
  check(
    value.schemaVersion === BROWSER_CAMERA_UPLINK_SCHEMA_VERSION,
    'Unsupported browser uplink schemaVersion',
  );
  return {
    schemaVersion: BROWSER_CAMERA_UPLINK_SCHEMA_VERSION,
    leaseId: parseUuid(value.leaseId, 'leaseId'),
    sequence: parseIntRange(value.sequence, 1, Number.MAX_SAFE_INTEGER, 'sequence'),
    acceptedAt: parseTimestamp(value.acceptedAt, 'acceptedAt'),
    leaseExpiresAt: parseTimestamp(value.leaseExpiresAt, 'leaseExpiresAt'),
    width: parseIntRange(
      value.width,
      BROWSER_CAMERA_UPLINK_MIN_DIMENSION,
      BROWSER_CAMERA_UPLINK_MAX_DIMENSION,
      'width',
    ),
    height: parseIntRange(
      value.height,
      BROWSER_CAMERA_UPLINK_MIN_DIMENSION,
      BROWSER_CAMERA_UPLINK_MAX_DIMENSION,
      'height',
    ),
    byteLength: parseIntRange(
      value.byteLength,
      3,
      BROWSER_CAMERA_UPLINK_MAX_FRAME_BYTES,
      'byteLength',
    ),
  };
}

export function parseBrowserCameraUplinkStopCommand(
  value: unknown,
): BrowserCameraUplinkStopCommand {
  check(isRecord(value), 'Browser uplink stop command must be an object');
  assertOnlyKeys(value, ['leaseId', 'reason'], 'Browser uplink stop command');
  const leaseId = parseUuid(value.leaseId, 'leaseId');
  if (value.reason === undefined) return { leaseId };
  check(
    typeof value.reason === 'string' &&
      (BROWSER_CAMERA_UPLINK_STOP_REASONS as readonly string[]).includes(value.reason),
    'Invalid browser uplink stop reason',
  );
  return { leaseId, reason: value.reason as BrowserCameraUplinkStopReason };
}

export function parseBrowserCameraUplinkStopResponse(
  value: unknown,
): BrowserCameraUplinkStopResponse {
  check(isRecord(value), 'Browser uplink stop response must be an object');
  assertOnlyKeys(
    value,
    ['schemaVersion', 'leaseId', 'state', 'stoppedAt'],
    'Browser uplink stop response',
  );
  check(
    value.schemaVersion === BROWSER_CAMERA_UPLINK_SCHEMA_VERSION,
    'Unsupported browser uplink schemaVersion',
  );
  check(value.state === 'STOPPED', 'Browser uplink stop response state must be STOPPED');
  return {
    schemaVersion: BROWSER_CAMERA_UPLINK_SCHEMA_VERSION,
    leaseId: parseUuid(value.leaseId, 'leaseId'),
    state: 'STOPPED',
    stoppedAt: parseTimestamp(value.stoppedAt, 'stoppedAt'),
  };
}

export function parseBrowserCameraUplinkStatusResponse(
  value: unknown,
): BrowserCameraUplinkStatusResponse {
  check(isRecord(value), 'Browser uplink status response must be an object');
  assertOnlyKeys(
    value,
    [
      'schemaVersion',
      'supported',
      'siteId',
      'cameraId',
      'state',
      'activeLeaseId',
      'ownedByCurrentUser',
      'lastSequence',
      'lastFrameCapturedAt',
      'leaseExpiresAt',
      'width',
      'height',
    ],
    'Browser uplink status response',
  );
  check(
    value.schemaVersion === BROWSER_CAMERA_UPLINK_SCHEMA_VERSION,
    'Unsupported browser uplink schemaVersion',
  );
  check(typeof value.supported === 'boolean', 'supported must be a boolean');
  const validStates: readonly string[] = ['IDLE', ...BROWSER_CAMERA_UPLINK_STATES];
  check(
    typeof value.state === 'string' && validStates.includes(value.state),
    'Invalid browser uplink status state',
  );

  const response: BrowserCameraUplinkStatusResponse = {
    schemaVersion: BROWSER_CAMERA_UPLINK_SCHEMA_VERSION,
    supported: value.supported,
    siteId: parseUuid(value.siteId, 'siteId'),
    cameraId: parseUuid(value.cameraId, 'cameraId'),
    state: value.state as BrowserCameraUplinkState | 'IDLE',
  };

  if (value.activeLeaseId !== undefined) {
    response.activeLeaseId =
      value.activeLeaseId === null ? null : parseUuid(value.activeLeaseId, 'activeLeaseId');
  }
  if (value.ownedByCurrentUser !== undefined) {
    check(typeof value.ownedByCurrentUser === 'boolean', 'ownedByCurrentUser must be a boolean');
    response.ownedByCurrentUser = value.ownedByCurrentUser;
  }
  if (value.lastSequence !== undefined) {
    response.lastSequence =
      value.lastSequence === null
        ? null
        : parseIntRange(value.lastSequence, 0, Number.MAX_SAFE_INTEGER, 'lastSequence');
  }
  if (value.lastFrameCapturedAt !== undefined) {
    response.lastFrameCapturedAt =
      value.lastFrameCapturedAt === null
        ? null
        : parseTimestamp(value.lastFrameCapturedAt, 'lastFrameCapturedAt');
  }
  if (value.leaseExpiresAt !== undefined) {
    response.leaseExpiresAt =
      value.leaseExpiresAt === null ? null : parseTimestamp(value.leaseExpiresAt, 'leaseExpiresAt');
  }
  if (value.width !== undefined) {
    response.width =
      value.width === null
        ? null
        : parseIntRange(
            value.width,
            BROWSER_CAMERA_UPLINK_MIN_DIMENSION,
            BROWSER_CAMERA_UPLINK_MAX_DIMENSION,
            'width',
          );
  }
  if (value.height !== undefined) {
    response.height =
      value.height === null
        ? null
        : parseIntRange(
            value.height,
            BROWSER_CAMERA_UPLINK_MIN_DIMENSION,
            BROWSER_CAMERA_UPLINK_MAX_DIMENSION,
            'height',
          );
  }
  return response;
}
