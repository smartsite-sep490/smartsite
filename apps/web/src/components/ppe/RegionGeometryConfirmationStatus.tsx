import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  parseRegionGeometryConfirmation,
  type ConfirmedRegionGeometryConfirmation,
} from '@smartsite/contracts/camera-region-geometry-confirmation';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { useLocale } from '../../i18n/ppe-locale';
import { SAFETY_NAMESPACE, translateSafetyNamespaceKey } from '../../i18n/runtime';

const CONFIRMATION_KEYS = {
  unconfirmed: 'regionSetup.list.confirmation.unconfirmed',
  manuallyConfirmed: 'regionSetup.list.confirmation.manuallyConfirmed',
  needsRevalidation: 'regionSetup.list.confirmation.needsRevalidation',
  unavailable: 'regionSetup.list.confirmation.unavailable',
  detailsSummary: 'regionSetup.list.confirmation.detailsSummary',
  viewRevision: 'regionSetup.list.confirmation.viewRevision',
  referenceId: 'regionSetup.list.confirmation.referenceId',
  confirmedAt: 'regionSetup.list.confirmation.confirmedAt',
  scopeNote: 'regionSetup.list.confirmation.scopeNote',
} as const;

type ConfirmationCatalogKey = (typeof CONFIRMATION_KEYS)[keyof typeof CONFIRMATION_KEYS];

const en: Record<ConfirmationCatalogKey, string> = {
  [CONFIRMATION_KEYS.unconfirmed]: 'no confirmation recorded',
  [CONFIRMATION_KEYS.manuallyConfirmed]: 'Region confirmed on image',
  [CONFIRMATION_KEYS.needsRevalidation]: 'review required after view changed',
  [CONFIRMATION_KEYS.unavailable]: 'confirmation status unavailable',
  [CONFIRMATION_KEYS.detailsSummary]: 'Confirmation details',
  [CONFIRMATION_KEYS.viewRevision]: 'View revision: v{viewRevision}',
  [CONFIRMATION_KEYS.referenceId]: 'Reference ID: {referenceId}',
  [CONFIRMATION_KEYS.confirmedAt]: 'Confirmed at: {confirmedAt}',
  [CONFIRMATION_KEYS.scopeNote]:
    'Confirms the boundary on this image only; camera and monitoring readiness are separate.',
};

const vi: Record<ConfirmationCatalogKey, string> = {
  [CONFIRMATION_KEYS.unconfirmed]: 'chưa ghi nhận xác nhận',
  [CONFIRMATION_KEYS.manuallyConfirmed]: 'Đã xác nhận vùng trên ảnh',
  [CONFIRMATION_KEYS.needsRevalidation]: 'cần kiểm tra lại sau khi khung nhìn thay đổi',
  [CONFIRMATION_KEYS.unavailable]: 'trạng thái xác nhận không khả dụng',
  [CONFIRMATION_KEYS.detailsSummary]: 'Chi tiết xác nhận',
  [CONFIRMATION_KEYS.viewRevision]: 'Phiên bản khung nhìn: v{viewRevision}',
  [CONFIRMATION_KEYS.referenceId]: 'Mã ảnh tham chiếu: {referenceId}',
  [CONFIRMATION_KEYS.confirmedAt]: 'Xác nhận lúc: {confirmedAt}',
  [CONFIRMATION_KEYS.scopeNote]:
    'Chỉ xác nhận ranh giới trên ảnh; chưa xác nhận camera hay giám sát đang hoạt động.',
};

function ensureRegionGeometryConfirmationCatalog(): void {
  registerFeatureCatalog({ en, vi });
}

ensureRegionGeometryConfirmationCatalog();

type EvaluatedConfirmation =
  | { readonly kind: 'UNCONFIRMED'; readonly provenance: null }
  | {
      readonly kind: 'MANUALLY_CONFIRMED' | 'NEEDS_REVALIDATION';
      readonly provenance: ConfirmedRegionGeometryConfirmation;
    }
  | { readonly kind: 'INVALID'; readonly provenance: null };

function evaluateGeometryConfirmation(raw: unknown): EvaluatedConfirmation {
  if (raw === undefined) {
    return { kind: 'UNCONFIRMED', provenance: null };
  }
  try {
    const parsed = parseRegionGeometryConfirmation(raw);
    if (parsed.status === 'UNCONFIRMED') {
      return { kind: 'UNCONFIRMED', provenance: null };
    }
    return { kind: parsed.status, provenance: parsed };
  } catch {
    return { kind: 'INVALID', provenance: null };
  }
}

export interface RegionGeometryConfirmationStatusProps {
  readonly geometryConfirmation?: unknown;
}

export function RegionGeometryConfirmationStatus({
  geometryConfirmation,
}: RegionGeometryConfirmationStatusProps) {
  ensureRegionGeometryConfirmationCatalog();
  const { locale } = useLocale();
  useTranslation(SAFETY_NAMESPACE);

  const tConfirmation = (
    key: ConfirmationCatalogKey,
    params?: Record<string, string | number>,
  ): string => translateSafetyNamespaceKey(locale, key, params);

  const evaluated = evaluateGeometryConfirmation(geometryConfirmation);

  const badgeConfig: {
    readonly labelKey: ConfirmationCatalogKey;
    readonly className: string;
  } =
    evaluated.kind === 'MANUALLY_CONFIRMED'
      ? {
          labelKey: CONFIRMATION_KEYS.manuallyConfirmed,
          className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        }
      : evaluated.kind === 'NEEDS_REVALIDATION'
        ? {
            labelKey: CONFIRMATION_KEYS.needsRevalidation,
            className: 'border-amber-300 bg-amber-50 text-amber-900',
          }
        : evaluated.kind === 'INVALID'
          ? {
              labelKey: CONFIRMATION_KEYS.unavailable,
              className: 'border-rose-200 bg-rose-50 text-rose-800',
            }
          : {
              labelKey: CONFIRMATION_KEYS.unconfirmed,
              className: 'border-slate-200 bg-slate-100 text-slate-700',
            };

  return (
    <div
      data-testid="region-geometry-confirmation-status"
      data-confirmation-state={evaluated.kind}
      className="min-w-0 inline-flex flex-wrap items-center gap-1.5"
    >
      <span
        className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-snug break-words [overflow-wrap:anywhere] whitespace-normal ${badgeConfig.className}`}
      >
        {tConfirmation(badgeConfig.labelKey)}
      </span>

      {evaluated.provenance && (
        <details
          data-testid="region-geometry-confirmation-details"
          className="group/region-conf-details min-w-0 text-[11px] text-slate-600"
        >
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              {tConfirmation(CONFIRMATION_KEYS.detailsSummary)}
            </span>
            <span
              aria-hidden="true"
              className="shrink-0 text-[10px] text-slate-400 transition-transform duration-150 group-open/region-conf-details:rotate-180"
            >
              ▾
            </span>
          </summary>
          {/* Do not expose raw confirmedByUserId actor UUID; show reference/view provenance only. */}
          <div className="mt-1 min-w-0 space-y-1 rounded-lg border border-slate-200/80 bg-white px-2.5 py-1.5 text-[11px] text-slate-600">
            <div className="min-w-0 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono tabular-nums">
              <span className="min-w-0 max-w-full break-all">
                {tConfirmation(CONFIRMATION_KEYS.viewRevision, {
                  viewRevision: evaluated.provenance.viewRevision,
                })}
              </span>
              <span aria-hidden="true">·</span>
              <span className="min-w-0 max-w-full break-all">
                {tConfirmation(CONFIRMATION_KEYS.referenceId, {
                  referenceId: evaluated.provenance.referenceId,
                })}
              </span>
              <span aria-hidden="true">·</span>
              <span className="min-w-0 max-w-full break-all">
                {tConfirmation(CONFIRMATION_KEYS.confirmedAt, {
                  confirmedAt: evaluated.provenance.confirmedAt,
                })}
              </span>
            </div>
            <p className="min-w-0 break-words [overflow-wrap:anywhere] text-[11px] text-slate-500">
              {tConfirmation(CONFIRMATION_KEYS.scopeNote)}
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
