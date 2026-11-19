import { useRef, useState, type PointerEvent } from 'react';
import { IconEye, IconX } from '../icons';
import { Badge, Button } from '../ui';
import {
  C02_MASK_GRID_SIZE,
  C02_MAX_MASKS,
  computeContainedImageRect,
  formatMaskPercentSummary,
  mapPointerToBasisPoints,
  normalizeMaskFromPoints,
  type BasisPoint,
  type MaskRectBp,
} from './identificationEvidenceMaskMath';

export interface IdentificationEvidenceCropStageProps {
  vietnamese: boolean;
  disabled: boolean;
  cropUrl?: string;
  cropLoading: boolean;
  cropError: boolean;
  masks: readonly MaskRectBp[];
  onLoadCrop: () => void;
  onCropDecodeError: () => void;
  onAddMask: (mask: MaskRectBp) => void;
  onRemoveMaskAt: (index: number) => void;
  onClearMasks: () => void;
}

export function IdentificationEvidenceCropStage({
  vietnamese,
  disabled,
  cropUrl,
  cropLoading,
  cropError,
  masks,
  onLoadCrop,
  onCropDecodeError,
  onAddMask,
  onRemoveMaskAt,
  onClearMasks,
}: IdentificationEvidenceCropStageProps) {
  const pickCopy = (vi: string, en: string) => (vietnamese ? vi : en);
  const stageRef = useRef<HTMLDivElement>(null);
  const [loadedCropState, setLoadedCropState] = useState<{
    url: string;
    naturalWidth: number;
    naturalHeight: number;
  } | null>(null);
  const [dragState, setDragState] = useState<{
    pointerId: number;
    start: BasisPoint;
    current: BasisPoint;
  } | null>(null);

  const naturalDims =
    cropUrl && loadedCropState?.url === cropUrl ? loadedCropState : null;
  const canDraw = Boolean(!disabled && cropUrl && naturalDims && masks.length < C02_MAX_MASKS);

  function resolvePointerBasis(e: PointerEvent<HTMLDivElement>): BasisPoint | null {
    const stageEl = stageRef.current;
    if (!stageEl || !naturalDims) return null;
    const rawRect = stageEl.getBoundingClientRect();
    const hasInnerLayout = stageEl.clientWidth > 0 && stageEl.clientHeight > 0;
    const innerRect = {
      left: rawRect.left + (hasInnerLayout ? stageEl.clientLeft : 0),
      top: rawRect.top + (hasInnerLayout ? stageEl.clientTop : 0),
      width: hasInnerLayout ? stageEl.clientWidth : rawRect.width,
      height: hasInnerLayout ? stageEl.clientHeight : rawRect.height,
    };
    const contained = computeContainedImageRect(
      innerRect,
      naturalDims.naturalWidth,
      naturalDims.naturalHeight,
    );
    if (!contained) return null;
    return mapPointerToBasisPoints(e.clientX, e.clientY, contained);
  }

  const activeDraftMask =
    !disabled && dragState ? normalizeMaskFromPoints(dragState.start, dragState.current, 25) : null;

  return (
    <div className="space-y-2.5 rounded-xl border border-slate-200/90 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="neutral" className="normal-case text-[11px] font-semibold">
              {pickCopy('Bước 1 · Che vùng nhạy cảm', 'Step 1 · Mask sensitive areas')}
            </Badge>
            <span className="text-xs font-semibold text-[#071A2B]">
              {pickCopy('Kéo trực tiếp trên ảnh cắt đối tượng', 'Drag directly on protected subject crop')}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-600">
            {pickCopy(
              'API không mở ảnh gốc thô riêng; thao tác này tải ảnh cắt đối tượng qua luồng xem trước được phép (không lộ toàn khung hình camera) để bạn kéo khung che mặt/thẻ tên trước khi tạo ảnh xem trước cuối.',
              'Original raw storage is not exposed separately; this loads the Officer-scoped subject crop preview (never the full camera frame) so you can drag privacy boxes over faces or badges before generating the final shared preview.',
            )}
          </p>
        </div>

        {!cropUrl && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="c02-load-authoring-crop"
            isLoading={cropLoading}
            disabled={disabled || cropLoading}
            leftIcon={<IconEye className="h-3.5 w-3.5" />}
            onClick={onLoadCrop}
          >
            {cropLoading
              ? pickCopy('Đang tải ảnh cắt…', 'Loading subject crop…')
              : pickCopy('Tải ảnh cắt để kéo vùng che', 'Load subject crop to draw masks')}
          </Button>
        )}
      </div>

      {cropError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950"
        >
          <span>
            {pickCopy(
              'Không tải được ảnh cắt để vẽ trực tiếp. Bạn vẫn có thể nhập tọa độ % bên dưới hoặc thử tải lại.',
              'Could not load the subject crop for pointer masking. You can still use the percentage inputs below or retry.',
            )}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || cropLoading}
            onClick={onLoadCrop}
          >
            {pickCopy('Thử lại', 'Retry')}
          </Button>
        </div>
      )}

      {cropUrl && (
        <div className="space-y-2">
          {!naturalDims && (
            <>
              <p role="status" className="text-xs text-slate-600">
                {pickCopy('Đang đọc kích thước ảnh cắt…', 'Measuring subject crop dimensions…')}
              </p>
              <img
                data-testid="c02-authoring-crop-img"
                src={cropUrl}
                alt={pickCopy('Ảnh cắt đối tượng để vẽ vùng che', 'Protected subject crop for masking')}
                className="sr-only"
                onLoad={(event) => {
                  const el = event.currentTarget;
                  if (el.naturalWidth > 0 && el.naturalHeight > 0) {
                    setLoadedCropState({
                      url: cropUrl,
                      naturalWidth: el.naturalWidth,
                      naturalHeight: el.naturalHeight,
                    });
                  } else {
                    onCropDecodeError();
                  }
                }}
                onError={() => onCropDecodeError()}
              />
            </>
          )}

          {naturalDims && (
            <div className="space-y-1.5">
              <div
                ref={stageRef}
                data-testid="c02-crop-mask-stage"
                onPointerDown={(e) => {
                  if (!canDraw || e.button !== 0) return;
                  const pt = resolvePointerBasis(e);
                  if (!pt) return;
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  setDragState({ pointerId: e.pointerId, start: pt, current: pt });
                }}
                onPointerMove={(e) => {
                  if (!dragState || dragState.pointerId !== e.pointerId) return;
                  if (!canDraw) {
                    setDragState(null);
                    return;
                  }
                  const pt = resolvePointerBasis(e);
                  if (!pt) return;
                  setDragState((prev) => (prev ? { ...prev, current: pt } : null));
                }}
                onPointerUp={(e) => {
                  if (!dragState || dragState.pointerId !== e.pointerId) return;
                  const pt = resolvePointerBasis(e) ?? dragState.current;
                  const completed = normalizeMaskFromPoints(dragState.start, pt);
                  setDragState(null);
                  if (completed && canDraw) {
                    onAddMask(completed);
                  }
                }}
                onPointerCancel={() => setDragState(null)}
                onLostPointerCapture={() => setDragState(null)}
                className={`relative flex max-h-80 w-full items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950 select-none touch-none ${
                  canDraw ? 'cursor-crosshair' : 'cursor-default'
                }`}
              >
                <div
                  className="relative max-h-80 max-w-full"
                  style={{
                    aspectRatio: `${naturalDims.naturalWidth} / ${naturalDims.naturalHeight}`,
                  }}
                >
                  <img
                    data-testid="c02-authoring-crop-img"
                    src={cropUrl}
                    draggable={false}
                    alt={pickCopy(
                      'Ảnh cắt đối tượng để vẽ vùng che',
                      'Protected subject crop for masking',
                    )}
                    onError={() => onCropDecodeError()}
                    className="block max-h-80 w-auto max-w-full object-contain pointer-events-none select-none"
                  />
                  <div className="pointer-events-none absolute inset-0">
                    {masks.map((m, idx) => (
                      <div
                        key={`${m.left}-${m.top}-${m.right}-${m.bottom}-${idx}`}
                        style={{
                          left: `${(m.left / C02_MASK_GRID_SIZE) * 100}%`,
                          top: `${(m.top / C02_MASK_GRID_SIZE) * 100}%`,
                          width: `${((m.right - m.left) / C02_MASK_GRID_SIZE) * 100}%`,
                          height: `${((m.bottom - m.top) / C02_MASK_GRID_SIZE) * 100}%`,
                        }}
                        className="absolute border-2 border-amber-400 bg-slate-950/85 flex items-start justify-start p-0.5"
                      >
                        <span className="rounded bg-amber-400 px-1 text-[10px] font-bold leading-tight text-slate-950 tabular-nums">
                          #{idx + 1}
                        </span>
                      </div>
                    ))}
                    {activeDraftMask && (
                      <div
                        data-testid="c02-draft-mask-rect"
                        style={{
                          left: `${(activeDraftMask.left / C02_MASK_GRID_SIZE) * 100}%`,
                          top: `${(activeDraftMask.top / C02_MASK_GRID_SIZE) * 100}%`,
                          width: `${((activeDraftMask.right - activeDraftMask.left) / C02_MASK_GRID_SIZE) * 100}%`,
                          height: `${((activeDraftMask.bottom - activeDraftMask.top) / C02_MASK_GRID_SIZE) * 100}%`,
                        }}
                        className="absolute border-2 border-dashed border-sky-300 bg-sky-500/25"
                      />
                    )}
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                {pickCopy(
                  'Nhấn giữ và kéo trên ảnh cắt để che mặt, biển tên hoặc chi tiết nhạy cảm (tối đa 32 vùng). Sau khi vẽ xong, bấm Xem trước ảnh để kiểm tra ảnh JPEG từ máy chủ.',
                  'Click and drag across the crop to cover faces, badges, or bystanders (up to 32 masks). Then click Preview image below to inspect the server-rendered JPEG.',
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {masks.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {masks.map((m, idx) => (
            <span
              key={`${m.left}-${m.top}-${m.right}-${m.bottom}-${idx}`}
              data-testid={`c02-mask-chip-${idx}`}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-800 tabular-nums"
            >
              <span className="font-bold text-[#071A2B]">#{idx + 1}</span>
              <span>{formatMaskPercentSummary(m)}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={pickCopy(`Xóa vùng che ${idx + 1}`, `Remove mask ${idx + 1}`)}
                onClick={() => onRemoveMaskAt(idx)}
                className="ml-0.5 rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900 cursor-pointer"
              >
                <IconX className="h-3 w-3" />
              </button>
            </span>
          ))}
          {masks.length > 1 && (
            <button
              type="button"
              disabled={disabled}
              onClick={onClearMasks}
              className="rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 cursor-pointer"
            >
              {pickCopy('Xóa tất cả vùng che', 'Clear all masks')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
