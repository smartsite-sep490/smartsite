import type React from 'react';
import { PPE_FAMILY_CATALOG } from '@smartsite/contracts/ppe-items';
import { isCoreBaselinePpeItem } from '../cameras/camera-ppe-policy-copy';
import { IconAlertTriangle, IconCheck } from '../icons';
import {
  ZONE_PPE_FAMILY_LABEL_KEY,
  ZONE_PPE_UNSUPPORTED_REASON_KEY,
  type ZonePpeSetupCopyKey,
} from './zone-ppe-setup-copy';
import type { CanonicalPpeItem } from './zone-ppe-setup-types';

const SELECTABLE_ZONE_PPE_CATALOG = PPE_FAMILY_CATALOG.filter((entry) => entry.policySelectable);
const NON_SELECTABLE_ZONE_PPE_CATALOG = PPE_FAMILY_CATALOG.filter(
  (entry) => !entry.policySelectable,
);

export interface ZonePpeCreateFormProps {
  canManageZones: boolean;
  zoneCode: string;
  zoneName: string;
  selectedPpe: CanonicalPpeItem[];
  codeError: string | null;
  nameError: string | null;
  ppeError: string | null;
  serverError: string | null;
  successFeedback: string | null;
  isCreatingZone: boolean;
  saving: boolean;
  zoneCodeInputRef: React.RefObject<HTMLInputElement | null>;
  zoneNameInputRef: React.RefObject<HTMLInputElement | null>;
  firstPpeInputRef: React.RefObject<HTMLInputElement | null>;
  t: (key: ZonePpeSetupCopyKey, params?: Record<string, string | number>) => string;
  onZoneCodeChange: (value: string) => void;
  onZoneNameChange: (value: string) => void;
  onTogglePpe: (item: CanonicalPpeItem) => void;
  onClearCreateForm: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function ZonePpeCreateForm({
  canManageZones,
  zoneCode,
  zoneName,
  selectedPpe,
  codeError,
  nameError,
  ppeError,
  serverError,
  successFeedback,
  isCreatingZone,
  saving,
  zoneCodeInputRef,
  zoneNameInputRef,
  firstPpeInputRef,
  t,
  onZoneCodeChange,
  onZoneNameChange,
  onTogglePpe,
  onClearCreateForm,
  onSubmit,
}: ZonePpeCreateFormProps) {
  if (!canManageZones) {
    return (
      <div
        role="note"
        className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"
      >
        {t('zoneSetup.readOnly.notice')}
      </div>
    );
  }

  return (
    <>
      {serverError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50/90 p-3 text-xs text-red-800 flex items-center gap-2"
        >
          <IconAlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <span>{serverError}</span>
        </div>
      )}

      {successFeedback && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-center gap-2"
        >
          <IconCheck className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{successFeedback}</span>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4 min-w-0 w-full max-w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0 w-full max-w-full">
          <div className="min-w-0 w-full">
            <label htmlFor="zone-code" className="block text-xs font-semibold text-slate-700 mb-1">
              {t('zoneSetup.field.codeLabel')}
            </label>
            <input
              id="zone-code"
              name="zoneCode"
              type="text"
              ref={zoneCodeInputRef}
              maxLength={64}
              value={zoneCode}
              onChange={(e) => onZoneCodeChange(e.target.value)}
              placeholder={t('zoneSetup.field.codePlaceholder')}
              disabled={isCreatingZone}
              aria-invalid={Boolean(codeError)}
              aria-describedby={codeError ? 'zone-code-error' : undefined}
              className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50 disabled:text-slate-400"
            />
            {codeError && (
              <p
                id="zone-code-error"
                role="alert"
                className="text-[11px] text-red-600 mt-1 font-medium"
              >
                {codeError}
              </p>
            )}
          </div>

          <div className="min-w-0 w-full">
            <label htmlFor="zone-name" className="block text-xs font-semibold text-slate-700 mb-1">
              {t('zoneSetup.field.nameLabel')}
            </label>
            <input
              id="zone-name"
              name="zoneName"
              type="text"
              ref={zoneNameInputRef}
              maxLength={255}
              value={zoneName}
              onChange={(e) => onZoneNameChange(e.target.value)}
              placeholder={t('zoneSetup.field.namePlaceholder')}
              disabled={isCreatingZone}
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? 'zone-name-error' : undefined}
              className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50 disabled:text-slate-400"
            />
            {nameError && (
              <p
                id="zone-name-error"
                role="alert"
                className="text-[11px] text-red-600 mt-1 font-medium"
              >
                {nameError}
              </p>
            )}
          </div>
        </div>

        <fieldset aria-describedby={ppeError ? 'zone-ppe-error' : undefined}>
          <legend className="block text-xs font-semibold text-slate-700 mb-2">
            {t('zoneSetup.field.ppeLegend')}
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {SELECTABLE_ZONE_PPE_CATALOG.map((entry, index) => {
              const isCore = isCoreBaselinePpeItem(entry.item);
              const inputId = `ppe-item-${entry.item.toLowerCase().replace(/_/g, '-')}`;
              return (
                <label
                  key={entry.item}
                  htmlFor={inputId}
                  className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 p-3 bg-white hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
                >
                  <input
                    id={inputId}
                    ref={index === 0 ? firstPpeInputRef : undefined}
                    aria-invalid={index === 0 ? Boolean(ppeError) : undefined}
                    aria-describedby={index === 0 && ppeError ? 'zone-ppe-error' : undefined}
                    type="checkbox"
                    checked={selectedPpe.includes(entry.item)}
                    onChange={() => onTogglePpe(entry.item)}
                    disabled={isCreatingZone}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <span className="text-xs font-medium text-slate-800">
                    {t(ZONE_PPE_FAMILY_LABEL_KEY[entry.item])}{' '}
                    <span
                      className={`text-[10px] font-bold ${
                        isCore ? 'text-emerald-700' : 'text-sky-700'
                      }`}
                    >
                      {t(isCore ? 'zoneSetup.ppe.coreTag' : 'zoneSetup.ppe.experimentalTag')}
                    </span>
                    {!isCore && (
                      <span className="text-[10px] text-slate-500 block">
                        {t('zoneSetup.ppe.experimentalNote')}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          {NON_SELECTABLE_ZONE_PPE_CATALOG.length > 0 && (
            <details
              data-testid="zone-ppe-catalog-not-selectable"
              className="group mt-3 min-w-0 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-3 py-2 text-xs text-slate-600"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium text-slate-700 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]">
                <span className="min-w-0 break-words">
                  {t('zoneSetup.ppe.unsupportedSummary', {
                    unsupportedCount: NON_SELECTABLE_ZONE_PPE_CATALOG.length,
                    totalCount: PPE_FAMILY_CATALOG.length,
                    names: NON_SELECTABLE_ZONE_PPE_CATALOG.map((entry) =>
                      t(ZONE_PPE_FAMILY_LABEL_KEY[entry.item]),
                    ).join(', '),
                  })}
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-xs text-slate-500 transition-transform duration-150 group-open:rotate-180"
                >
                  ▾
                </span>
              </summary>
              <div className="mt-2 space-y-2 border-t border-slate-200/80 pt-2">
                <ul className="grid grid-cols-1 md:grid-cols-3 gap-2 min-w-0">
                  {NON_SELECTABLE_ZONE_PPE_CATALOG.map((entry) => (
                    <li
                      key={entry.item}
                      data-ppe-family={entry.item}
                      data-unsupported-reason={entry.unsupportedReasonCode}
                      data-observation-semantics={entry.observationSemantics}
                      className="grid gap-1 rounded-lg border border-slate-200/90 bg-white p-2.5 min-w-0"
                    >
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span className="text-xs font-semibold text-slate-800 break-words">
                          {t(ZONE_PPE_FAMILY_LABEL_KEY[entry.item])}
                        </span>
                        <span className="inline-flex w-fit items-center rounded-md border border-amber-200/80 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                          {t(
                            entry.observationSemantics === 'PRESENT_ONLY'
                              ? 'zoneSetup.ppe.semantics.PRESENT_ONLY'
                              : 'zoneSetup.ppe.semantics.CONTRACT_PENDING',
                          )}
                        </span>
                      </div>
                      <p className="text-[11px] leading-snug text-slate-600 break-words">
                        {t(ZONE_PPE_UNSUPPORTED_REASON_KEY[entry.unsupportedReasonCode])}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] leading-snug text-slate-500 break-words">
                  {t('zoneSetup.ppe.catalogBoundaryNote', {
                    totalCount: PPE_FAMILY_CATALOG.length,
                    selectableCount: SELECTABLE_ZONE_PPE_CATALOG.length,
                    unsupportedCount: NON_SELECTABLE_ZONE_PPE_CATALOG.length,
                  })}
                </p>
              </div>
            </details>
          )}
          {ppeError && (
            <p
              id="zone-ppe-error"
              role="alert"
              className="text-[11px] text-red-600 mt-2 font-medium"
            >
              {ppeError}
            </p>
          )}
        </fieldset>

        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200/80">
          <button
            type="button"
            onClick={onClearCreateForm}
            disabled={saving}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            {t('zoneSetup.action.clearForm')}
          </button>
          <button
            type="submit"
            disabled={isCreatingZone}
            className="rounded-xl bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
          >
            {isCreatingZone ? (
              <>
                <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                {t('zoneSetup.action.saving')}
              </>
            ) : (
              t('zoneSetup.action.saveZonePpe')
            )}
          </button>
        </div>
      </form>
    </>
  );
}
