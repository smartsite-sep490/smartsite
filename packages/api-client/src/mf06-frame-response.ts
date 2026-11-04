import { ApiError } from './errors';
import { discardResponseBody, type BodyReadRunner } from './camera-configuration-response';

export const MAX_MF06_FRAME_BYTES = 1_048_576;

/** Backend verifies event SHA; the client bounds and validates the delivered JPEG envelope. */
export async function readMf06FrameResponse(
  response: Response,
  read: BodyReadRunner,
  signal?: AbortSignal,
): Promise<Blob> {
  if (
    response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'image/jpeg' ||
    !response.body
  ) {
    discardResponseBody(response);
    throw new ApiError('invalid-response', 'Backend returned invalid MF06 image.');
  }
  const length = response.headers.get('content-length');
  if (
    length !== null &&
    (!/^\d+$/.test(length) ||
      !Number.isSafeInteger(Number(length)) ||
      Number(length) > MAX_MF06_FRAME_BYTES)
  ) {
    discardResponseBody(response);
    throw new ApiError('invalid-response', 'MF06 image exceeds maximum size.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await read(() => reader.read(), signal);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_MF06_FRAME_BYTES)
        throw new ApiError('invalid-response', 'MF06 image exceeds maximum size.');
      chunks.push(new Uint8Array(part.value));
    }
    if (length !== null && size !== Number(length))
      throw new ApiError('invalid-response', 'Incomplete MF06 image.');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (
      size < 4 ||
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      bytes[size - 2] !== 255 ||
      bytes[size - 1] !== 217
    )
      throw new ApiError('invalid-response', 'Backend returned invalid MF06 JPEG.');
    return new Blob([bytes], { type: 'image/jpeg' });
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
