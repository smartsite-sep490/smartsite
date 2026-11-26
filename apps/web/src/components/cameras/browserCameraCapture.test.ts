import { describe, expect, it, vi } from 'vitest';
import {
  acquireBrowserCameraStream,
  BrowserCameraCaptureError,
  computeBoundedDimensions,
  encodeVideoFrameToJpeg,
  releaseBrowserCameraStream,
} from './browserCameraCapture';

function makeJpegBytes(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(size));
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xe0;
  return bytes;
}

describe('browserCameraCapture', () => {
  it('computes aspect-preserving bounded dimensions within [64, max] limits', () => {
    expect(computeBoundedDimensions(1920, 1080, 640, 480)).toEqual({ width: 640, height: 360 });
    expect(computeBoundedDimensions(640, 480, 640, 480)).toEqual({ width: 640, height: 480 });
    expect(computeBoundedDimensions(480, 960, 640, 480)).toEqual({ width: 240, height: 480 });
    expect(computeBoundedDimensions(40, 40, 640, 480)).toEqual({ width: 64, height: 64 });
  });

  it('steps JPEG quality down to satisfy maxBytes and fails honestly with FRAME_TOO_LARGE when still oversized', async () => {
    const qualitiesTried: number[] = [];
    const fakeCtx = { drawImage: vi.fn() };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => fakeCtx),
      toBlob: vi.fn((cb: BlobCallback, _type?: string, quality?: number) => {
        qualitiesTried.push(quality ?? 1);
        const bytes = makeJpegBytes((quality ?? 1) > 0.7 ? 150_000 : 95_000);
        cb(new Blob([bytes], { type: 'image/jpeg' }));
      }),
    } as unknown as HTMLCanvasElement;
    const fakeVideo = {
      readyState: 2,
      videoWidth: 1280,
      videoHeight: 720,
    } as HTMLVideoElement;

    const encoded = await encodeVideoFrameToJpeg(fakeVideo, {
      maxWidth: 640,
      maxHeight: 480,
      maxBytes: 130_000,
      canvas: fakeCanvas,
    });

    expect(encoded.width).toBe(640);
    expect(encoded.height).toBe(360);
    expect(encoded.jpegBytes.byteLength).toBe(95_000);
    expect(qualitiesTried).toEqual([0.82, 0.68]);

    const alwaysHugeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => fakeCtx),
      toBlob: vi.fn((cb: BlobCallback) => {
        cb(new Blob([makeJpegBytes(200_000)], { type: 'image/jpeg' }));
      }),
    } as unknown as HTMLCanvasElement;

    await expect(
      encodeVideoFrameToJpeg(fakeVideo, {
        maxWidth: 640,
        maxHeight: 480,
        maxBytes: 130_000,
        canvas: alwaysHugeCanvas,
      }),
    ).rejects.toMatchObject({
      name: 'BrowserCameraCaptureError',
      code: 'FRAME_TOO_LARGE',
    });
  });

  it('classifies getUserMedia errors cleanly and stops every track on release', async () => {
    await expect(
      acquireBrowserCameraStream({
        maxWidth: 640,
        maxHeight: 480,
        mediaDevices: undefined,
      }),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof BrowserCameraCaptureError && err.code === 'UNSUPPORTED',
    );

    const deniedErr = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    await expect(
      acquireBrowserCameraStream({
        maxWidth: 640,
        maxHeight: 480,
        mediaDevices: {
          getUserMedia: vi.fn().mockRejectedValue(deniedErr),
          enumerateDevices: vi.fn(),
        } as unknown as MediaDevices,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    const stopTrack = vi.fn();
    const fakeStream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    const fakeVideo = { srcObject: fakeStream } as unknown as HTMLVideoElement;
    releaseBrowserCameraStream(fakeStream, fakeVideo);
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(fakeVideo.srcObject).toBeNull();
  });
});
