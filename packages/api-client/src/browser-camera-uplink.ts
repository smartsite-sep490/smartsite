import {
  BROWSER_CAMERA_UPLINK_ERROR_CODES,
  BROWSER_CAMERA_UPLINK_MAX_FRAME_BYTES,
  isJpegPayload,
  parseBrowserCameraUplinkFrameMetadata,
  parseBrowserCameraUplinkFrameReceipt,
  parseBrowserCameraUplinkStartCommand,
  parseBrowserCameraUplinkStartResponse,
  parseBrowserCameraUplinkStatusResponse,
  parseBrowserCameraUplinkStopCommand,
  parseBrowserCameraUplinkStopResponse,
  type BrowserCameraUplinkErrorCode,
  type BrowserCameraUplinkFrameReceipt,
  type BrowserCameraUplinkStartCommand,
  type BrowserCameraUplinkStartResponse,
  type BrowserCameraUplinkStatusResponse,
  type BrowserCameraUplinkStopCommand,
  type BrowserCameraUplinkStopResponse,
} from '@smartsite/contracts/browser-camera-uplink';

export type BrowserCameraUplinkClientErrorCode =
  BrowserCameraUplinkErrorCode | 'HTTP_ERROR' | 'INVALID_RESPONSE' | 'NETWORK_ERROR';

export class BrowserCameraUplinkError extends Error {
  constructor(
    readonly status: number,
    readonly code: BrowserCameraUplinkClientErrorCode,
    message = 'Browser camera uplink request failed',
  ) {
    super(message);
    this.name = 'BrowserCameraUplinkError';
  }
}

export interface BrowserCameraUplinkFrameUpload {
  leaseId: string;
  sequence: number;
  capturedAt: string;
  width: number;
  height: number;
  jpegBytes: Uint8Array;
}

export interface BrowserCameraUplinkStopOptions {
  signal?: AbortSignal;
  keepalive?: boolean;
}

export interface BrowserCameraUplinkClient {
  status(
    apiUrl: string,
    token: string,
    siteId: string,
    cameraId: string,
    signal: AbortSignal,
  ): Promise<BrowserCameraUplinkStatusResponse>;
  start(
    apiUrl: string,
    token: string,
    siteId: string,
    cameraId: string,
    command: BrowserCameraUplinkStartCommand,
    signal: AbortSignal,
  ): Promise<BrowserCameraUplinkStartResponse>;
  uploadFrame(
    apiUrl: string,
    token: string,
    siteId: string,
    cameraId: string,
    frame: BrowserCameraUplinkFrameUpload,
    signal: AbortSignal,
  ): Promise<BrowserCameraUplinkFrameReceipt>;
  stop(
    apiUrl: string,
    token: string,
    siteId: string,
    cameraId: string,
    command: BrowserCameraUplinkStopCommand,
    options?: BrowserCameraUplinkStopOptions,
  ): Promise<BrowserCameraUplinkStopResponse | void>;
}

const MAX_JSON_RESPONSE_BYTES = 32_768;

function classifyStatusFallback(status: number): BrowserCameraUplinkClientErrorCode {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'LEASE_NOT_FOUND';
  if (status === 409) return 'LEASE_HELD';
  if (status === 413) return 'FRAME_TOO_LARGE';
  if (status === 415) return 'INVALID_MEDIA_TYPE';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 501) return 'UNSUPPORTED_CAPABILITY';
  return 'HTTP_ERROR';
}

function isKnownUplinkErrorCode(value: unknown): value is BrowserCameraUplinkErrorCode {
  return (
    typeof value === 'string' &&
    (BROWSER_CAMERA_UPLINK_ERROR_CODES as readonly string[]).includes(value)
  );
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    void response.body?.cancel().catch(() => {});
    return undefined;
  }
  const reader = response.body?.getReader();
  if (!reader) {
    try {
      const text = await response.text();
      if (text.length > MAX_JSON_RESPONSE_BYTES) return undefined;
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_JSON_RESPONSE_BYTES) return undefined;
      chunks.push(part.value);
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged)) as unknown;
  } catch {
    return undefined;
  }
}

async function parseErrorResponse(response: Response): Promise<BrowserCameraUplinkError> {
  const fallbackCode = classifyStatusFallback(response.status);
  const body = await readBoundedJson(response);
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const rawCode = (body as Record<string, unknown>).code;
    if (isKnownUplinkErrorCode(rawCode)) {
      return new BrowserCameraUplinkError(response.status, rawCode);
    }
  }
  return new BrowserCameraUplinkError(response.status, fallbackCode);
}

function basePath(apiUrl: string, siteId: string, cameraId: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/api/v1/sites/${encodeURIComponent(siteId)}/cameras/${encodeURIComponent(cameraId)}/browser-uplink`;
}

async function parseJsonOrThrow<T>(response: Response, parser: (value: unknown) => T): Promise<T> {
  if (!response.ok) {
    throw await parseErrorResponse(response);
  }
  const payload = await readBoundedJson(response);
  if (payload === undefined) {
    throw new BrowserCameraUplinkError(502, 'INVALID_RESPONSE');
  }
  try {
    return parser(payload);
  } catch {
    throw new BrowserCameraUplinkError(502, 'INVALID_RESPONSE');
  }
}

export const browserCameraUplinkClient: BrowserCameraUplinkClient = {
  async status(apiUrl, token, siteId, cameraId, signal) {
    const response = await fetch(`${basePath(apiUrl, siteId, cameraId)}/status`, {
      method: 'GET',
      signal,
      cache: 'no-store',
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    return parseJsonOrThrow(response, parseBrowserCameraUplinkStatusResponse);
  },

  async start(apiUrl, token, siteId, cameraId, command, signal) {
    const validated = parseBrowserCameraUplinkStartCommand(command);
    const response = await fetch(`${basePath(apiUrl, siteId, cameraId)}/start`, {
      method: 'POST',
      signal,
      cache: 'no-store',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(validated),
    });
    return parseJsonOrThrow(response, parseBrowserCameraUplinkStartResponse);
  },

  async uploadFrame(apiUrl, token, siteId, cameraId, frame, signal) {
    if (!isJpegPayload(frame.jpegBytes)) {
      throw new BrowserCameraUplinkError(415, 'INVALID_MEDIA_TYPE');
    }
    if (frame.jpegBytes.byteLength > BROWSER_CAMERA_UPLINK_MAX_FRAME_BYTES) {
      throw new BrowserCameraUplinkError(413, 'FRAME_TOO_LARGE');
    }
    let metadata;
    try {
      metadata = parseBrowserCameraUplinkFrameMetadata({
        leaseId: frame.leaseId,
        sequence: frame.sequence,
        capturedAt: frame.capturedAt,
        width: frame.width,
        height: frame.height,
        byteLength: frame.jpegBytes.byteLength,
      });
    } catch {
      throw new BrowserCameraUplinkError(400, 'HTTP_ERROR');
    }

    const response = await fetch(`${basePath(apiUrl, siteId, cameraId)}/frames`, {
      method: 'POST',
      signal,
      cache: 'no-store',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/jpeg',
        Accept: 'application/json',
        'X-Uplink-Lease-Id': metadata.leaseId,
        'X-Uplink-Sequence': String(metadata.sequence),
        'X-Uplink-Captured-At': metadata.capturedAt,
        'X-Uplink-Width': String(metadata.width),
        'X-Uplink-Height': String(metadata.height),
      },
      body: frame.jpegBytes.slice(),
    });
    return parseJsonOrThrow(response, parseBrowserCameraUplinkFrameReceipt);
  },

  async stop(apiUrl, token, siteId, cameraId, command, options) {
    const validated = parseBrowserCameraUplinkStopCommand(command);
    const response = await fetch(`${basePath(apiUrl, siteId, cameraId)}/stop`, {
      method: 'POST',
      signal: options?.signal,
      keepalive: options?.keepalive === true,
      cache: 'no-store',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(validated),
    });
    if (response.status === 204) return undefined;
    return parseJsonOrThrow(response, parseBrowserCameraUplinkStopResponse);
  },
};
