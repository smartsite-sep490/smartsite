import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { CameraMediaFrame, CameraPreviewFrame } from '@smartsite/contracts/camera-preview';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { registerRawCameraMediaCanvasCatalog } from './raw-camera-media-canvas-catalog';

registerRawCameraMediaCanvasCatalog();

export type RawCameraMediaLineage = Pick<
  CameraMediaFrame,
  'cameraExternalId' | 'sessionId' | 'sequenceNumber' | 'capturedAt'
>;

export interface RawCameraMediaCanvasProps {
  image: HTMLImageElement | null;
  frame?: RawCameraMediaLineage | null;
  geometry?: Pick<CameraPreviewFrame, 'cameraExternalId' | 'sessionId' | 'zonePolygons'> | null;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * RawCameraMediaCanvas renders an unanalyzed, raw camera video frame for a selected LIVE camera.
 *
 * Strict constraints:
 * - NEVER draw AI bounding boxes, PPE detections, confidence labels, or person identity overlays.
 * - Configured polygons may be drawn only for the same camera and capture session.
 * - Clears canvas immediately when image is null (e.g. stream stall, scope change, or unmount).
 * - Exposes browser lineage attributes (cameraExternalId, sessionId, sequenceNumber, capturedAt)
 *   so Root can match displayed raw frames with the original encoding observer without exposing dataUrls or AI fields.
 */
export function RawCameraMediaCanvas({
  image,
  frame,
  geometry,
  width = 640,
  height = 480,
  className = 'w-full h-full object-contain',
}: RawCameraMediaCanvasProps) {
  registerRawCameraMediaCanvasCatalog();
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hasMatchingGeometry = Boolean(
    image &&
    frame?.cameraExternalId &&
    frame.sessionId &&
    geometry?.cameraExternalId === frame.cameraExternalId &&
    geometry?.sessionId === frame.sessionId,
  );

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
      if (hasMatchingGeometry && geometry) {
        // Paint in image coordinates so object-contain and fullscreen scale pixels and geometry together.
        for (const polygon of geometry.zonePolygons) {
          context.beginPath();
          polygon.coordinates.forEach(([x, y], index) => {
            const px = Math.round(x * targetWidth),
              py = Math.round(y * targetHeight);
            if (index === 0) context.moveTo(px, py);
            else context.lineTo(px, py);
          });
          context.closePath();
          context.strokeStyle = '#38bdf8';
          context.lineWidth = 3;
          context.stroke();
        }
      }
    } else {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [image, width, height, geometry, hasMatchingGeometry]);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
      <canvas
        ref={canvasRef}
        data-testid="raw-camera-media-canvas"
        className={className}
        role="img"
        aria-label={
          hasMatchingGeometry && geometry?.zonePolygons.length
            ? `${t('ppe.rawCanvas.ariaLabel')}. ${t('ppe.rawCanvas.configuredRegions', { count: geometry.zonePolygons.length })}`
            : t('ppe.rawCanvas.ariaLabel')
        }
        data-media-camera={frame?.cameraExternalId ?? undefined}
        data-media-session={frame?.sessionId ?? undefined}
        data-media-sequence={frame?.sequenceNumber ?? undefined}
        data-media-captured-at={frame?.capturedAt ?? undefined}
      />
    </div>
  );
}
