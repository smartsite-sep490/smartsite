import { useLayoutEffect, useRef } from 'react';
import type { CameraMediaFrame } from '@smartsite/contracts/camera-preview';

export type RawCameraMediaLineage = Pick<
  CameraMediaFrame,
  'cameraExternalId' | 'sessionId' | 'sequenceNumber' | 'capturedAt'
>;

export interface RawCameraMediaCanvasProps {
  image: HTMLImageElement | null;
  frame?: RawCameraMediaLineage | null;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * RawCameraMediaCanvas renders an unanalyzed, raw camera video frame for a selected LIVE camera.
 *
 * Strict constraints:
 * - NEVER draw AI bounding boxes, PPE detections, confidence labels, or person identity overlays.
 * - Draws strictly the raw decoded image from the camera media stream.
 * - Clears canvas immediately when image is null (e.g. stream stall, scope change, or unmount).
 * - Exposes browser lineage attributes (cameraExternalId, sessionId, sequenceNumber, capturedAt)
 *   so Root can match displayed raw frames with the original encoding observer without exposing dataUrls or AI fields.
 */
export function RawCameraMediaCanvas({
  image,
  frame,
  width = 640,
  height = 480,
  className = 'w-full h-full object-contain',
}: RawCameraMediaCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    if (image) {
      const targetWidth = image.naturalWidth || width;
      const targetHeight = image.naturalHeight || height;
      if (canvas.width !== targetWidth) canvas.width = targetWidth;
      if (canvas.height !== targetHeight) canvas.height = targetHeight;
      context.drawImage(image, 0, 0, targetWidth, targetHeight);
    } else {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [image, width, height]);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
      <canvas
        ref={canvasRef}
        data-testid="raw-camera-media-canvas"
        className={className}
        role="img"
        aria-label="Raw unanalyzed camera live video stream"
        data-media-camera={frame?.cameraExternalId ?? undefined}
        data-media-session={frame?.sessionId ?? undefined}
        data-media-sequence={frame?.sequenceNumber ?? undefined}
        data-media-captured-at={frame?.capturedAt ?? undefined}
      />
    </div>
  );
}
