import {
  parseCameraConfigurationImageResponse,
  type CameraConfigurationImageResponse,
} from '@smartsite/contracts/camera-configuration-image';
import { ApiError } from './index';

export const MAX_CONFIGURATION_IMAGE_RESPONSE_BYTES = 1_500_000;

export type BodyReadRunner = <T>(read: () => Promise<T>, signal?: AbortSignal) => Promise<T>;

function cancelStreamSafely(cancel: () => Promise<void> | undefined): void {
  try {
    void cancel()?.catch(() => undefined);
  } catch {
    // Stream may already be locked or closed by the runtime adapter.
  }
}

export function discardAbortedResponse(response: Response, signal?: AbortSignal): void {
  if (signal?.aborted) cancelStreamSafely(() => response.body?.cancel());
}

export async function readBoundedResponseJson(
  response: Response,
  maxBytes: number,
  readBody: BodyReadRunner,
  signal?: AbortSignal,
): Promise<unknown> {
  if (
    !response.body ||
    typeof response.body.getReader !== 'function' ||
    response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
      'application/json'
  ) {
    cancelStreamSafely(() => response.body?.cancel());
    throw new ApiError(
      'invalid-response',
      'Backend returned an unreadable JSON response.',
      response.status,
    );
  }
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)
  ) {
    cancelStreamSafely(() => response.body?.cancel());
    throw new ApiError(
      'invalid-response',
      'Backend response content-length exceeds the allowed byte limit.',
      response.status,
    );
  }

  let text: string;
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const row = await readBody(() => reader.read(), signal);
        if (row.done) break;
        if (!row.value || row.value.byteLength === 0) continue;
        totalBytes += row.value.byteLength;
        if (totalBytes > maxBytes) {
          throw new ApiError(
            'invalid-response',
            'Backend response body exceeds the allowed byte limit.',
            response.status,
          );
        }
        chunks.push(row.value);
      }
    } finally {
      cancelStreamSafely(() => reader.cancel());
      try {
        reader.releaseLock();
      } catch {
        // Ignore if lock was already released.
      }
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(merged);
    } catch {
      throw new ApiError(
        'invalid-response',
        'Backend returned malformed UTF-8 JSON bytes.',
        response.status,
      );
    }
  } else {
    throw new ApiError(
      'invalid-response',
      'Backend returned an unreadable JSON response.',
      response.status,
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError('invalid-response', 'Backend returned invalid JSON.', response.status);
  }
}

export function parseScopedCameraConfigurationImage(
  payload: unknown,
  siteId: string,
  cameraId: string,
): CameraConfigurationImageResponse {
  try {
    const image = parseCameraConfigurationImageResponse(payload);
    if (
      image.siteId.toLowerCase() !== siteId.toLowerCase() ||
      image.cameraId.toLowerCase() !== cameraId.toLowerCase()
    ) {
      throw new Error('Scope mismatch');
    }
    return image;
  } catch {
    throw new ApiError('invalid-response', 'Backend returned invalid camera configuration image.');
  }
}
