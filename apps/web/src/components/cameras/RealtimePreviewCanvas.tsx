import { localizedDetectionLabel } from '../../i18n/labels';
import { translate as tr, uiLanguage } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { useLayoutEffect, useRef } from 'react';
import type { DecodedPreview } from './useRealtimePreview';

export function RealtimePreviewCanvas({
  preview,
  mode,
}: {
  preview: DecodedPreview;
  mode: 'ppe' | 'zone';
}) {
  useTranslation();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const language = uiLanguage();
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const { frame, image } = preview;
    canvas.width = frame.width;
    canvas.height = frame.height;
    // Image and boxes are painted together; no independently animated DOM boxes.
    context.drawImage(image, 0, 0, frame.width, frame.height);
    if (mode === 'zone') {
      for (const region of frame.zonePolygons) {
        context.beginPath();
        region.coordinates.forEach(([x, y], index) => {
          if (index === 0) context.moveTo(x * frame.width, y * frame.height);
          else context.lineTo(x * frame.width, y * frame.height);
        });
        context.closePath();
        context.fillStyle = 'rgba(223,34,37,0.12)';
        context.strokeStyle = '#DF2225';
        context.lineWidth = 3;
        context.fill();
        context.stroke();
      }
    }
    context.lineWidth = 2;
    context.font = 'bold 14px sans-serif';
    for (const detection of mode === 'ppe' ? frame.detections : frame.zoneDetections) {
      const box = detection.boundingBox;
      if (!box) continue;
      const x = box.x1 * frame.width;
      const y = box.y1 * frame.height;
      context.strokeStyle = detection.active ? '#F66B17' : '#d6d3d1';
      context.fillStyle = context.strokeStyle;
      context.strokeRect(x, y, (box.x2 - box.x1) * frame.width, (box.y2 - box.y1) * frame.height);
      const label = localizedDetectionLabel(detection.label) + ' · #' + detection.trackId;
      const width = Math.min(context.measureText(label).width, frame.width - 8);
      const labelX = Math.max(4, Math.min(x, frame.width - width - 4));
      context.fillText(label, labelX, Math.max(16, y - 5), frame.width - 8);
    }
  }, [preview, mode, language]);
  return (
    <canvas
      ref={canvasRef}
      aria-label={tr('realtime_preview_canvas.synchronized_ai_camera_frame')}
      data-frame-id={`${preview.frame.sessionId}:${preview.frame.sequenceNumber}`}
      className="absolute inset-0 w-full h-full object-cover"
    />
  );
}
