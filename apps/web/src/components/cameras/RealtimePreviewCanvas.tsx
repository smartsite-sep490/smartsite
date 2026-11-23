import { localizedDetectionLabel } from '../../i18n/labels';
import { translate as tr, uiLanguage } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { useLayoutEffect, useRef } from 'react';
import type { DecodedPreview } from './useRealtimePreview';
import { registerScopedPreviewCanvasCatalog } from './scoped-preview-canvas-catalog';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';

registerScopedPreviewCanvasCatalog();

export function RealtimePreviewCanvas({
  preview,
  mode,
}: {
  preview: DecodedPreview;
  mode: 'ppe' | 'zone';
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);

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
      const zoneAnchor = frame.zoneAnchor ?? 'BOTTOM_CENTER';
      context.fillStyle = '#38bdf8';
      for (const person of frame.detections) {
        const box = person.boundingBox;
        if (!box) continue;
        const x = Math.round(((box.x1 + box.x2) / 2) * frame.width);
        const y = Math.round(
          (zoneAnchor === 'BOX_CENTER' ? (box.y1 + box.y2) / 2 : box.y2) * frame.height,
        );
        context.fillRect(x - 3, y - 3, 6, 6);
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
    <>
      {mode === 'zone' && preview.frame.zonePolygons.length > 0 && (
        <span className="absolute bottom-2 left-2 z-10 max-w-sm rounded bg-slate-950/80 px-2 py-1 text-xs text-slate-200 pointer-events-none">
          {t(
            preview.frame.zoneAnchor === 'BOX_CENTER'
              ? 'ppe.previewCanvas.zoneAnchorHelpBoxCenter'
              : 'ppe.previewCanvas.zoneAnchorHelp',
          )}
        </span>
      )}
      <canvas
        ref={canvasRef}
        aria-label={tr('realtime_preview_canvas.synchronized_ai_camera_frame')}
        data-frame-id={`${preview.frame.sessionId}:${preview.frame.sequenceNumber}`}
        className="absolute inset-0 w-full h-full object-cover"
      />
    </>
  );
}
