export type BackendHealth = { status: 'ok'; service: 'smartsite-backend' };
export type RequestOptions = { signal?: AbortSignal; timeoutMs?: number };
export type ApiErrorCode = 'http' | 'network' | 'invalid-response' | 'timeout' | 'cancelled';

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status?: number,
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
    if (!response.ok) {
      throw new ApiError('http', `Backend returned HTTP ${response.status}.`, response.status);
    }
    const body = await response.text();
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
