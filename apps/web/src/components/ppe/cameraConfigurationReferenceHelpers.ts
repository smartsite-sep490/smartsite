import {
  ApiError,
  CONFIGURATION_REFERENCE_LIFETIME_MS,
  parseCameraConfigurationImageResponse,
  type ApiErrorCode,
  type CameraConfigurationImageResponse,
  type SmartSiteManagementClient,
} from '@smartsite/api-client';

export const CONFIGURATION_DECODE_TIMEOUT_MS = 2_000;

export interface ConfigurationReferenceScopeInput {
  apiUrl: string;
  token: string;
  sessionScope: string;
  credentialId: number;
  siteId: string;
  cameraId: string;
  cameraExternalId: string;
  enabled: boolean;
}

const activeTokenNonceByOwner = new WeakMap<object, { token: string; nonce: number }>();
let nextTokenNonce = 0;

export function getOpaqueTokenNonce(owner: object, token: string): number {
  if (!token) {
    activeTokenNonceByOwner.delete(owner);
    return 0;
  }
  const existing = activeTokenNonceByOwner.get(owner);
  if (existing?.token === token) {
    return existing.nonce;
  }
  const nonce = ++nextTokenNonce;
  activeTokenNonceByOwner.set(owner, { token, nonce });
  return nonce;
}

export function resolveConfigurationReferenceScope(
  owner: object,
  options: ConfigurationReferenceScopeInput,
) {
  const normalizedApiUrl = options.apiUrl.trim().replace(/\/+$/, '');
  const trimmedToken = options.token.trim();
  const trimmedSessionScope = options.sessionScope.trim();
  const normalizedSiteId = options.siteId.trim().toLowerCase();
  const normalizedCameraId = options.cameraId.trim().toLowerCase();
  const trimmedExternalId = options.cameraExternalId.trim();
  const tokenNonce = getOpaqueTokenNonce(owner, trimmedToken);

  const isScopeReady = Boolean(
    options.enabled &&
    normalizedApiUrl &&
    trimmedToken &&
    trimmedSessionScope &&
    Number.isSafeInteger(options.credentialId) &&
    options.credentialId >= 0 &&
    normalizedSiteId &&
    normalizedCameraId &&
    trimmedExternalId,
  );

  const queryKey = [
    'ppe-camera-configuration-reference',
    normalizedApiUrl,
    trimmedSessionScope,
    options.credentialId,
    tokenNonce,
    normalizedSiteId,
    normalizedCameraId,
    trimmedExternalId,
  ] as const;

  return {
    normalizedApiUrl,
    trimmedToken,
    normalizedSiteId,
    normalizedCameraId,
    trimmedExternalId,
    isScopeReady,
    queryKey,
    activeScopeKey: JSON.stringify(queryKey),
  };
}

export function getEffectiveExpiryMs(response: CameraConfigurationImageResponse): number {
  const expiresAtMs = Date.parse(response.referenceExpiresAt);
  const capturedAtMs = Date.parse(response.frame.capturedAt);
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(capturedAtMs)) {
    return Number.NEGATIVE_INFINITY;
  }
  return Math.min(expiresAtMs, capturedAtMs + CONFIGURATION_REFERENCE_LIFETIME_MS);
}

const HTTP_STATUS_MESSAGES: Record<number, string> = {
  401: 'Not authorized to load camera configuration reference image.',
  403: 'Not authorized to load camera configuration reference image.',
  404: 'Camera configuration reference image was not found.',
  409: 'Camera configuration changed while loading reference image.',
  429: 'Too many camera configuration reference requests.',
  503: 'Camera configuration reference source is currently unavailable.',
};

function getSafeErrorMessage(code: ApiErrorCode, status?: number): string {
  if (code === 'timeout') return 'Camera configuration reference request timed out.';
  if (code === 'cancelled') return 'Camera configuration reference request was cancelled.';
  if (code === 'network') {
    return 'Could not connect to the backend for camera configuration reference.';
  }
  if (code === 'http') {
    if (status !== undefined && HTTP_STATUS_MESSAGES[status]) {
      return HTTP_STATUS_MESSAGES[status];
    }
    return typeof status === 'number'
      ? `Camera configuration reference request failed (HTTP ${status}).`
      : 'Camera configuration reference request failed.';
  }
  return 'Camera configuration reference image is invalid or unavailable.';
}

export function toSafeApiError(err: unknown): ApiError {
  if (err instanceof ApiError) {
    const status =
      typeof err.status === 'number' && Number.isSafeInteger(err.status) ? err.status : undefined;
    const retryAfterSeconds =
      typeof err.retryAfterSeconds === 'number' && Number.isFinite(err.retryAfterSeconds)
        ? err.retryAfterSeconds
        : undefined;
    return new ApiError(
      err.code,
      getSafeErrorMessage(err.code, status),
      status,
      undefined,
      retryAfterSeconds,
    );
  }
  return new ApiError('invalid-response', getSafeErrorMessage('invalid-response'));
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if ('name' in err && (err as { name: unknown }).name === 'AbortError') return true;
  return err instanceof ApiError && err.code === 'cancelled';
}

export function releaseImageElement(image: HTMLImageElement | null | undefined): void {
  if (!image) return;
  try {
    image.src = '';
  } catch {
    // Ignore DOM cleanup errors in non-browser stubs.
  }
}

async function decodeImageBounded(
  image: HTMLImageElement,
  signal: AbortSignal,
  isStale: () => boolean,
): Promise<void> {
  if (signal.aborted || isStale()) {
    releaseImageElement(image);
    throw new ApiError('cancelled', getSafeErrorMessage('cancelled'));
  }

  let decodePromise: Promise<void>;
  try {
    decodePromise = Promise.resolve(image.decode());
  } catch {
    releaseImageElement(image);
    throw new ApiError('invalid-response', getSafeErrorMessage('invalid-response'));
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
    };
    const fail = (code: ApiErrorCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      releaseImageElement(image);
      reject(new ApiError(code, getSafeErrorMessage(code)));
    };
    const onAbort = () => fail('cancelled');
    const timeoutId = setTimeout(() => fail('timeout'), CONFIGURATION_DECODE_TIMEOUT_MS);

    if (signal.aborted || isStale()) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });

    decodePromise.then(
      () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      },
      () => fail('invalid-response'),
    );
  });
}

export async function validateAndDecodeReference(
  raw: unknown,
  normalizedSiteId: string,
  normalizedCameraId: string,
  trimmedExternalId: string,
  signal: AbortSignal,
  isStale: () => boolean,
): Promise<{ parsed: CameraConfigurationImageResponse; image: HTMLImageElement }> {
  let parsed: CameraConfigurationImageResponse;
  try {
    parsed = parseCameraConfigurationImageResponse(raw);
  } catch {
    throw new ApiError('invalid-response', getSafeErrorMessage('invalid-response'));
  }

  if (
    parsed.siteId.toLowerCase() !== normalizedSiteId ||
    parsed.cameraId.toLowerCase() !== normalizedCameraId ||
    parsed.frame.cameraExternalId !== trimmedExternalId
  ) {
    throw new ApiError('invalid-response', getSafeErrorMessage('invalid-response'));
  }

  if (Date.now() >= getEffectiveExpiryMs(parsed)) {
    throw new ApiError('invalid-response', getSafeErrorMessage('invalid-response'));
  }

  const image = new Image();
  image.src = parsed.frame.imageDataUrl;
  await decodeImageBounded(image, signal, isStale);

  if (isStale()) {
    releaseImageElement(image);
    throw new ApiError('cancelled', getSafeErrorMessage('cancelled'));
  }

  if (
    image.naturalWidth !== parsed.frame.width ||
    image.naturalHeight !== parsed.frame.height ||
    Date.now() >= getEffectiveExpiryMs(parsed)
  ) {
    releaseImageElement(image);
    throw new ApiError('invalid-response', getSafeErrorMessage('invalid-response'));
  }

  return { parsed, image };
}

export async function executeConfigurationReferenceFetch(params: {
  client: SmartSiteManagementClient;
  token: string;
  siteId: string;
  cameraId: string;
  normalizedSiteId: string;
  normalizedCameraId: string;
  trimmedExternalId: string;
  controller: AbortController;
  querySignal: AbortSignal;
  isStale: () => boolean;
  onDecodedImage: (image: HTMLImageElement) => void;
}): Promise<CameraConfigurationImageResponse> {
  const { controller, querySignal, isStale } = params;
  const onQueryAbort = () => controller.abort();
  if (querySignal.aborted) {
    controller.abort();
  } else {
    querySignal.addEventListener('abort', onQueryAbort, { once: true });
  }

  try {
    const raw = await params.client.getCameraConfigurationImage(
      params.token,
      params.siteId,
      params.cameraId,
      { signal: controller.signal },
    );
    if (isStale()) {
      throw new ApiError('cancelled', getSafeErrorMessage('cancelled'));
    }

    const result = await validateAndDecodeReference(
      raw,
      params.normalizedSiteId,
      params.normalizedCameraId,
      params.trimmedExternalId,
      controller.signal,
      isStale,
    );
    params.onDecodedImage(result.image);
    return result.parsed;
  } finally {
    querySignal.removeEventListener('abort', onQueryAbort);
  }
}
