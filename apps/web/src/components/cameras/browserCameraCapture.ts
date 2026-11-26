import {
  BROWSER_CAMERA_UPLINK_MAX_DIMENSION,
  BROWSER_CAMERA_UPLINK_MIN_DIMENSION,
  isJpegPayload,
} from '@smartsite/contracts/browser-camera-uplink';

export interface BrowserCameraDevice {
  deviceId: string;
  label: string;
}

export type BrowserCameraCaptureErrorCode =
  | 'UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'DEVICE_BUSY'
  | 'VIDEO_NOT_READY'
  | 'FRAME_TOO_LARGE'
  | 'ENCODE_FAILED';

export class BrowserCameraCaptureError extends Error {
  constructor(
    readonly code: BrowserCameraCaptureErrorCode,
    message = 'Browser camera capture failed',
  ) {
    super(message);
    this.name = 'BrowserCameraCaptureError';
  }
}

export interface EncodedBrowserFrame {
  width: number;
  height: number;
  jpegBytes: Uint8Array;
}

const JPEG_QUALITY_STEPS = [0.82, 0.68, 0.54, 0.4] as const;

export function computeBoundedDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const clampedMaxW = Math.min(
    BROWSER_CAMERA_UPLINK_MAX_DIMENSION,
    Math.max(BROWSER_CAMERA_UPLINK_MIN_DIMENSION, Math.floor(maxWidth)),
  );
  const clampedMaxH = Math.min(
    BROWSER_CAMERA_UPLINK_MAX_DIMENSION,
    Math.max(BROWSER_CAMERA_UPLINK_MIN_DIMENSION, Math.floor(maxHeight)),
  );
  const safeW = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : clampedMaxW;
  const safeH = Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : clampedMaxH;

  const scale = Math.min(1, clampedMaxW / safeW, clampedMaxH / safeH);
  const width = Math.max(
    BROWSER_CAMERA_UPLINK_MIN_DIMENSION,
    Math.min(clampedMaxW, Math.round(safeW * scale)),
  );
  const height = Math.max(
    BROWSER_CAMERA_UPLINK_MIN_DIMENSION,
    Math.min(clampedMaxH, Math.round(safeH * scale)),
  );
  return { width, height };
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  // Fallback for environments where Blob.prototype.arrayBuffer is not polyfilled.
  const buffer = await new Response(blob).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function encodeVideoFrameToJpeg(
  video: HTMLVideoElement,
  options: {
    maxWidth: number;
    maxHeight: number;
    maxBytes: number;
    canvas?: HTMLCanvasElement;
  },
): Promise<EncodedBrowserFrame> {
  if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new BrowserCameraCaptureError('VIDEO_NOT_READY');
  }
  const { width, height } = computeBoundedDimensions(
    video.videoWidth,
    video.videoHeight,
    options.maxWidth,
    options.maxHeight,
  );
  const canvas = options.canvas ?? document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new BrowserCameraCaptureError('ENCODE_FAILED');
  }
  context.drawImage(video, 0, 0, width, height);

  let sawOversized = false;
  for (const quality of JPEG_QUALITY_STEPS) {
    const blob = await canvasToJpegBlob(canvas, quality);
    if (!blob) continue;
    const bytes = await blobToUint8Array(blob);
    if (!isJpegPayload(bytes)) continue;
    if (bytes.byteLength <= options.maxBytes) {
      return { width, height, jpegBytes: bytes };
    }
    sawOversized = true;
  }

  throw new BrowserCameraCaptureError(sawOversized ? 'FRAME_TOO_LARGE' : 'ENCODE_FAILED');
}

export async function enumerateBrowserVideoDevices(
  mediaDevices: MediaDevices | undefined = typeof navigator !== 'undefined'
    ? navigator.mediaDevices
    : undefined,
): Promise<BrowserCameraDevice[]> {
  if (!mediaDevices?.enumerateDevices) return [];
  try {
    const list = await mediaDevices.enumerateDevices();
    return list
      .filter((entry) => entry.kind === 'videoinput')
      .map((entry, index) => ({
        deviceId: entry.deviceId,
        label: entry.label?.trim() || `#${index + 1}`,
      }));
  } catch {
    return [];
  }
}

export async function acquireBrowserCameraStream(options: {
  deviceId?: string;
  maxWidth: number;
  maxHeight: number;
  mediaDevices?: MediaDevices;
}): Promise<MediaStream> {
  const mediaDevices =
    'mediaDevices' in options
      ? options.mediaDevices
      : typeof navigator !== 'undefined'
        ? navigator.mediaDevices
        : undefined;

  if (!mediaDevices?.getUserMedia) {
    throw new BrowserCameraCaptureError('UNSUPPORTED');
  }

  try {
    return await mediaDevices.getUserMedia({
      video: {
        width: { ideal: options.maxWidth },
        height: { ideal: options.maxHeight },
        ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : { facingMode: 'user' }),
      },
      audio: false,
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new BrowserCameraCaptureError('PERMISSION_DENIED');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new BrowserCameraCaptureError('NOT_FOUND');
    }
    throw new BrowserCameraCaptureError('DEVICE_BUSY');
  }
}

export function releaseBrowserCameraStream(
  stream: MediaStream | null,
  videoElement?: HTMLVideoElement | null,
): void {
  if (stream) {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // Track may already be ended.
      }
    }
    if (videoElement && videoElement.srcObject === stream) {
      videoElement.srcObject = null;
    }
  } else if (videoElement && videoElement.srcObject) {
    videoElement.srcObject = null;
  }
}
