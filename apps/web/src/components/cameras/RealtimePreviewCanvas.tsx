import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { translate as tr, uiLanguage } from '../../i18n';
import { useLocale } from '../../i18n/ppe-locale';
import type { DecodedPreview } from './useRealtimePreview';
import { POSITIVE_PPE_OBJECT_CLASSES, NEGATIVE_PPE_OBJECT_CLASSES } from './realtimePreview';
import {
  computeOverlayLabels,
  formatPpeCompactLabel,
  type PlacedDetectionOverlay,
} from './overlayLayoutUtils';

export interface RealtimePreviewCanvasProps {
  preview: DecodedPreview;
  mode: 'ppe' | 'zone';
  showModelObjects?: boolean;
  filterClasses?: readonly string[];
}

export function RealtimePreviewCanvas({
  preview,
  mode,
  showModelObjects = false,
  filterClasses,
}: RealtimePreviewCanvasProps) {
  useTranslation();
  const { t } = useLocale();
  const language = uiLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Accessible current-frame text list derived synchronously for screen readers & semantic DOM
  const detections = useMemo(
    () => (mode === 'ppe' ? preview.frame.detections : preview.frame.zoneDetections),
    [preview.frame, mode],
  );

  const accessibleItems = useMemo(() => {
    return detections.map((det) => {
      if (mode === 'zone') {
        const regionSuffix = det.regionId
          ? ` · ${t('ppe.previewCanvas.regionPrefix')}: ${det.regionId}`
          : '';
        return `${t('ppe.trackLabel', { id: det.trackId ?? '?' })}${regionSuffix}: ${det.label}.`;
      }
      return formatPpeCompactLabel(det).accessibleSummary;
    });
  }, [detections, mode, t]);

  const accessibleModelObjects = useMemo(() => {
    if (!preview.frame.modelObjects?.detections.length) return [];
    return preview.frame.modelObjects.detections.map((obj) =>
      t('ppe.previewCanvas.experimentalObjectSummary', {
        className: obj.className,
        confidence: Math.round(obj.confidence * 100),
      }),
    );
  }, [preview.frame.modelObjects, t]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const { frame, image } = preview;

    // 1. Canvas resize resets context state each frame
    canvas.width = frame.width;
    canvas.height = frame.height;

    // 2. CRITICAL: Set context.font to actual rendering font BEFORE measureText
    const renderFont = 'bold 11px sans-serif';
    context.font = renderFont;
    context.textBaseline = 'middle';

    // 3. Raw image and boxes are painted together; exact synchronized frame
    context.drawImage(image, 0, 0, frame.width, frame.height);

    // Geometry-only preview polygons do not carry Backend access policy.
    if (mode === 'zone') {
      for (const region of frame.zonePolygons) {
        context.beginPath();
        region.coordinates.forEach(([x, y], index) => {
          const px = Math.round(x * frame.width);
          const py = Math.round(y * frame.height);
          if (index === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        });
        context.closePath();
        context.strokeStyle = '#94a3b8';
        context.lineWidth = 3;
        context.stroke();
      }
    }

    // 5. Compute deterministic collision-avoiding label placements on exact-frame coordinates
    const overlays: PlacedDetectionOverlay[] = computeOverlayLabels(detections, mode, {
      canvasWidth: frame.width,
      canvasHeight: frame.height,
      measureTextWidth: (text) => context.measureText(text).width,
      badgeHeight: 18,
      paddingX: 6,
      margin: 4,
    });

    // 6. Draw exact Person bounding boxes (no lerp, no child PPE boxes fabricated)
    // All valid Person boxes are stroked even when badge is omitted due to crowding
    for (const item of overlays) {
      const { boxPx, style } = item;
      context.lineWidth = style.lineWidth;
      context.strokeStyle = style.boxStroke;
      context.strokeRect(boxPx.left, boxPx.top, boxPx.width, boxPx.height);
    }

    // 7. Draw neutral compact badges if collision-free slot was available
    for (const item of overlays) {
      if (!item.badge) continue;
      const { rect, text } = item.badge;
      const { style } = item;

      // Badge pill background
      context.fillStyle = style.badgeBg;
      context.fillRect(rect.left, rect.top, rect.width, rect.height);

      // Badge border
      context.strokeStyle = style.badgeBorder;
      context.lineWidth = 1;
      context.strokeRect(rect.left, rect.top, rect.width, rect.height);

      // Badge text
      context.fillStyle = style.badgeText;
      context.font = renderFont;
      context.fillText(text, rect.left + 6, Math.round(rect.top + rect.height / 2));
    }

    // 8. Draw raw experimental modelObjects bounding boxes if toggled on
    if (showModelObjects && frame.modelObjects?.detections) {
      for (const obj of frame.modelObjects.detections) {
        const isPositivePpe = (POSITIVE_PPE_OBJECT_CLASSES as readonly string[]).includes(
          obj.className,
        );
        const isNegativePpe = (NEGATIVE_PPE_OBJECT_CLASSES as readonly string[]).includes(
          obj.className,
        );

        // Apply display filter preset if provided (display focus only)
        if (
          filterClasses &&
          filterClasses.length > 0 &&
          isPositivePpe &&
          !filterClasses.includes(obj.className)
        ) {
          continue;
        }

        const { x1, y1, x2, y2 } = obj.boundingBox;
        const left = Math.round(x1 * frame.width);
        const top = Math.round(y1 * frame.height);
        const width = Math.round((x2 - x1) * frame.width);
        const height = Math.round((y2 - y1) * frame.height);

        context.lineWidth = 1.5;
        if (isPositivePpe) {
          context.strokeStyle = '#0284c7'; // Sky-600
        } else if (isNegativePpe) {
          context.strokeStyle = '#dc2626'; // Red-600
        } else {
          context.strokeStyle = '#9333ea'; // Purple-600 (Person)
        }
        context.strokeRect(left, top, width, height);

        // Compact tag
        const tagText = `${obj.className} ${Math.round(obj.confidence * 100)}%`;
        const textWidth = context.measureText(tagText).width;
        const tagHeight = 14;
        const tagTop = Math.max(0, top - tagHeight - 2);

        context.fillStyle = isPositivePpe
          ? 'rgba(2, 132, 199, 0.85)'
          : isNegativePpe
            ? 'rgba(220, 38, 38, 0.85)'
            : 'rgba(147, 51, 234, 0.85)';
        context.fillRect(left, tagTop, textWidth + 6, tagHeight);

        context.fillStyle = '#ffffff';
        context.font = 'bold 9px sans-serif';
        context.fillText(tagText, left + 3, Math.round(tagTop + tagHeight / 2));
      }
    }
  }, [preview, mode, detections, showModelObjects, filterClasses, language]);

  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none">
      {mode === 'zone' && preview.frame.zonePolygons.length > 0 && (
        <span className="absolute bottom-2 left-2 z-10 rounded bg-slate-950/80 px-2 py-1 text-xs text-slate-200">
          {t('ppe.previewCanvas.observationBoundaries')}
        </span>
      )}
      <canvas
        ref={canvasRef}
        role="region"
        aria-label={tr('realtime_preview_canvas.synchronized_ai_camera_frame')}
        data-frame-id={`${preview.frame.sessionId}:${preview.frame.sequenceNumber}`}
        className="w-full h-full object-cover"
      />

      {/* Screen-reader accessible current-frame text list */}
      <ul className="sr-only" aria-label={t('ppe.previewCanvas.currentFrameObservationsAria')}>
        {accessibleItems.map((summary, idx) => (
          <li key={`${idx}-${summary}`}>{summary}</li>
        ))}
        {accessibleModelObjects.map((summary, idx) => (
          <li key={`model-obj-${idx}`}>{summary}</li>
        ))}
      </ul>

      {/* Compact visible details list overlay for sighted users (default collapsed, pointer-events-auto on control only) */}
      {detections.length > 0 && (
        <div className="absolute bottom-2 right-2 z-20 pointer-events-none max-w-xs">
          <details
            className="pointer-events-auto group rounded bg-stone-950/85 backdrop-blur-xs border border-stone-800 text-[11px] text-stone-300 shadow-md transition-all"
            aria-label={t('ppe.previewCanvas.frameDetailsAria')}
          >
            <summary className="cursor-pointer select-none px-2.5 py-1 font-semibold text-stone-200 hover:text-white flex items-center justify-between gap-2 list-none">
              <span>
                {t('ppe.previewCanvas.frameObservationsCount', { count: detections.length })}
              </span>
              <span className="text-[9px] text-stone-400 group-open:rotate-180 transition-transform">
                ▼
              </span>
            </summary>
            <div className="p-2 pt-1 border-t border-stone-800/80 max-h-48 overflow-y-auto space-y-1.5 text-[10px] text-stone-300">
              {detections.map((det, idx) => {
                const box = det.boundingBox;
                const boxStr = box
                  ? `[${Math.round(box.x1 * preview.frame.width)}, ${Math.round(box.y1 * preview.frame.height)}, ${Math.round((box.x2 - box.x1) * preview.frame.width)}×${Math.round((box.y2 - box.y1) * preview.frame.height)}]`
                  : 'N/A';
                const timeStr = preview.frame.capturedAt
                  ? new Date(preview.frame.capturedAt).toLocaleTimeString()
                  : det.timecode || 'LIVE';
                return (
                  <div
                    key={`${det.trackId ?? '?'}-${det.eventId ?? '?'}-${det.regionId ?? 'default'}-${idx}`}
                    className="border-b border-stone-800/60 pb-1.5 last:border-0 last:pb-0"
                  >
                    <div className="flex items-center justify-between font-bold text-stone-200">
                      <span>
                        {t('ppe.trackLabel', { id: det.trackId ?? '?' })}
                        {det.regionId && (
                          <span className="font-normal text-stone-400 text-[9px] ml-1.5">
                            {t('ppe.previewCanvas.regionParen', { regionId: det.regionId })}
                          </span>
                        )}
                      </span>
                      <span className="text-stone-400 font-mono text-[9px]">{timeStr}</span>
                    </div>
                    <div className="text-stone-400">
                      {t('ppe.previewCanvas.boxPx', { box: boxStr })}
                    </div>
                    <div className="text-stone-300">{accessibleItems[idx]}</div>
                  </div>
                );
              })}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
