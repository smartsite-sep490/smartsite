import React, { useLayoutEffect, useMemo, useRef } from 'react';
import type { DecodedPreview } from './useRealtimePreview';
import {
  computeOverlayLabels,
  formatPpeCompactLabel,
  type PlacedDetectionOverlay,
} from './overlayLayoutUtils';

export interface RealtimePreviewCanvasProps {
  preview: DecodedPreview;
  mode: 'ppe' | 'zone';
}

export function RealtimePreviewCanvas({ preview, mode }: RealtimePreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Accessible current-frame text list derived synchronously for screen readers & semantic DOM
  const detections = useMemo(
    () => (mode === 'ppe' ? preview.frame.detections : preview.frame.zoneDetections),
    [preview.frame, mode],
  );

  const accessibleItems = useMemo(() => {
    return detections.map((det) => {
      if (mode === 'zone') {
        const regionSuffix = det.regionId ? ` · Khu vực: ${det.regionId}` : '';
        return `Track #${det.trackId ?? '?'}${regionSuffix}: ${det.label}.`;
      }
      return formatPpeCompactLabel(det).accessibleSummary;
    });
  }, [detections, mode]);

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

    // 4. Zone polygons (in zone mode)
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
        context.fillStyle = 'rgba(223,34,37,0.12)';
        context.strokeStyle = '#DF2225';
        context.lineWidth = 3;
        context.fill();
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
  }, [preview, mode, detections]);

  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none">
      <canvas
        ref={canvasRef}
        role="region"
        aria-label="Synchronized AI camera frame"
        data-frame-id={`${preview.frame.sessionId}:${preview.frame.sequenceNumber}`}
        className="w-full h-full object-cover"
      />

      {/* Screen-reader accessible current-frame text list */}
      <ul className="sr-only" aria-label="Current frame observations">
        {accessibleItems.map((summary, idx) => (
          <li key={`${idx}-${summary}`}>{summary}</li>
        ))}
      </ul>

      {/* Compact visible details list overlay for sighted users (default collapsed, pointer-events-auto on control only) */}
      {detections.length > 0 && (
        <div className="absolute bottom-2 right-2 z-20 pointer-events-none max-w-xs">
          <details
            className="pointer-events-auto group rounded bg-stone-950/85 backdrop-blur-xs border border-stone-800 text-[11px] text-stone-300 shadow-md transition-all"
            aria-label="Chi tiết quan sát trong khung hình"
          >
            <summary className="cursor-pointer select-none px-2.5 py-1 font-semibold text-stone-200 hover:text-white flex items-center justify-between gap-2 list-none">
              <span>Khung hình ({detections.length} quan sát)</span>
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
                        Track #{det.trackId ?? '?'}
                        {det.regionId && (
                          <span className="font-normal text-stone-400 text-[9px] ml-1.5">
                            (Khu vực: {det.regionId})
                          </span>
                        )}
                      </span>
                      <span className="text-stone-400 font-mono text-[9px]">{timeStr}</span>
                    </div>
                    <div className="text-stone-400">Box px: {boxStr}</div>
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
