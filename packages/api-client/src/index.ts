export type BackendHealth = { status: 'ok'; service: 'smartsite-backend' };
export type RequestOptions = { signal?: AbortSignal; timeoutMs?: number };
export type ApiErrorCode = 'http' | 'network' | 'invalid-response' | 'timeout' | 'cancelled';
export const BACKEND_ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMIT_EXCEEDED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_SERVER_ERROR',
  'HTTP_ERROR',
  'VALIDATION_FAILED',
  'INVALID_JSON',
  'AI_EVENT_ID_CONFLICT',
  'AI_INGESTION_UNAVAILABLE',
  'DATABASE_UNAVAILABLE',
] as const;
export type BackendErrorCode = (typeof BACKEND_ERROR_CODES)[number];
export type BackendValidationIssue = { code: string; path: string; message: string };
export type BackendErrorEnvelope = {
  success: false;
  statusCode: number;
  code: BackendErrorCode;
  message: string;
  requestId: string;
  timestamp: string;
  path: string;
  issues?: BackendValidationIssue[];
  status?: 'error';
  service?: 'smartsite-backend';
  database?: 'down';
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseBackendErrorEnvelope(
  value: unknown,
  expectedStatus?: number,
): BackendErrorEnvelope | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.success !== false ||
    !Number.isInteger(value.statusCode) ||
    (value.statusCode as number) < 400 ||
    (value.statusCode as number) > 599 ||
    (expectedStatus !== undefined && value.statusCode !== expectedStatus) ||
    !BACKEND_ERROR_CODES.includes(value.code as BackendErrorCode) ||
    typeof value.message !== 'string' ||
    typeof value.requestId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.requestId) ||
    typeof value.timestamp !== 'string' ||
    !Number.isFinite(Date.parse(value.timestamp)) ||
    typeof value.path !== 'string' ||
    !value.path.startsWith('/') ||
    value.path.includes('?')
  ) {
    return undefined;
  }

  let issues: BackendValidationIssue[] | undefined;
  if (value.issues !== undefined) {
    if (!Array.isArray(value.issues)) return undefined;
    issues = [];
    for (const issue of value.issues) {
      if (
        !isRecord(issue) ||
        typeof issue.code !== 'string' ||
        !/^[A-Z][A-Z0-9_]{0,63}$/.test(issue.code) ||
        typeof issue.path !== 'string' ||
        !issue.path.startsWith('/') ||
        typeof issue.message !== 'string'
      ) {
        return undefined;
      }
      issues.push({ code: issue.code, path: issue.path, message: issue.message });
    }
  }

  const readiness = [value.status, value.service, value.database];
  if (
    readiness.some((item) => item !== undefined) &&
    !(
      value.status === 'error' &&
      value.service === 'smartsite-backend' &&
      value.database === 'down'
    )
  ) {
    return undefined;
  }

  return {
    success: false,
    statusCode: value.statusCode as number,
    code: value.code as BackendErrorCode,
    message: value.message,
    requestId: value.requestId,
    timestamp: value.timestamp,
    path: value.path,
    ...(issues ? { issues } : {}),
    ...(value.status === 'error'
      ? {
          status: 'error' as const,
          service: 'smartsite-backend' as const,
          database: 'down' as const,
        }
      : {}),
  };
}

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status?: number,
    public readonly backendError?: BackendErrorEnvelope,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** baseUrl is the backend origin (or reverse-proxy prefix), without /api/v1. */
export async function getBackendHealth(
  baseUrl: string,
  { signal, timeoutMs = 8_000 }: RequestOptions = {},
): Promise<BackendHealth> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/health/live`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      let backendError: BackendErrorEnvelope | undefined;
      try {
        backendError = parseBackendErrorEnvelope(JSON.parse(body), response.status);
      } catch {
        // A proxy or upstream may return HTML or malformed JSON; never surface it to callers.
      }
      throw new ApiError(
        'http',
        backendError?.message ?? `Backend returned HTTP ${response.status}.`,
        response.status,
        backendError,
      );
    }
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      throw new ApiError('invalid-response', 'Backend returned an invalid health response.');
    }
    if (
      typeof data !== 'object' ||
      data === null ||
      !('status' in data) ||
      data.status !== 'ok' ||
      !('service' in data) ||
      data.service !== 'smartsite-backend'
    ) {
      throw new ApiError('invalid-response', 'Backend returned an invalid health response.');
    }
    return { status: 'ok', service: 'smartsite-backend' };
  } catch (error) {
    if (signal?.aborted) throw new ApiError('cancelled', 'Request cancelled.');
    if (timedOut) throw new ApiError('timeout', 'Backend request timed out.');
    if (error instanceof ApiError) throw error;
    throw new ApiError('network', 'Could not connect to the backend.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}
