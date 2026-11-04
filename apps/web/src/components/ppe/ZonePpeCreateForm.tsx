import type React from 'react';
import { IconAlertTriangle, IconCheck } from '../icons';
import type { ZonePpeSetupCopyKey } from './zone-ppe-setup-copy';
import type { CanonicalPpeItem } from './zone-ppe-setup-types';

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
            <label
              htmlFor="ppe-item-hard-hat"
              className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 p-3 bg-white hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
            >
              <input
                id="ppe-item-hard-hat"
                ref={firstPpeInputRef}
                aria-invalid={Boolean(ppeError)}
                aria-describedby={ppeError ? 'zone-ppe-error' : undefined}
                type="checkbox"
                checked={selectedPpe.includes('HARD_HAT')}
                onChange={() => onTogglePpe('HARD_HAT')}
                disabled={isCreatingZone}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <span className="text-xs font-medium text-slate-800">
                {t('zoneSetup.ppe.HARD_HAT')}{' '}
                <span className="text-[10px] text-emerald-700 font-bold">
                  {t('zoneSetup.ppe.coreTag')}
                </span>
              </span>
            </label>

            <label
              htmlFor="ppe-item-safety-vest"
              className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 p-3 bg-white hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
            >
              <input
                id="ppe-item-safety-vest"
                type="checkbox"
                checked={selectedPpe.includes('SAFETY_VEST')}
                onChange={() => onTogglePpe('SAFETY_VEST')}
                disabled={isCreatingZone}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <span className="text-xs font-medium text-slate-800">
                {t('zoneSetup.ppe.SAFETY_VEST')}{' '}
                <span className="text-[10px] text-emerald-700 font-bold">
                  {t('zoneSetup.ppe.coreTag')}
                </span>
              </span>
            </label>

            <label
              htmlFor="ppe-item-gloves"
              className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 p-3 bg-white hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
            >
              <input
                id="ppe-item-gloves"
                type="checkbox"
                checked={selectedPpe.includes('GLOVES')}
                onChange={() => onTogglePpe('GLOVES')}
                disabled={isCreatingZone}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <span className="text-xs font-medium text-slate-800">
                {t('zoneSetup.ppe.GLOVES')}{' '}
                <span className="text-[10px] text-sky-700 font-bold">
                  {t('zoneSetup.ppe.experimentalTag')}
                </span>
                <span className="text-[10px] text-slate-500 block">
                  {t('zoneSetup.ppe.experimentalNote')}
                </span>
              </span>
            </label>

            <label
              htmlFor="ppe-item-boots"
              className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 p-3 bg-white hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
            >
              <input
                id="ppe-item-boots"
                type="checkbox"
                checked={selectedPpe.includes('BOOTS')}
                onChange={() => onTogglePpe('BOOTS')}
                disabled={isCreatingZone}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <span className="text-xs font-medium text-slate-800">
                {t('zoneSetup.ppe.BOOTS')}{' '}
                <span className="text-[10px] text-sky-700 font-bold">
                  {t('zoneSetup.ppe.experimentalTag')}
                </span>
                <span className="text-[10px] text-slate-500 block">
                  {t('zoneSetup.ppe.experimentalNote')}
                </span>
              </span>
            </label>

            <label
              htmlFor="ppe-item-goggles"
              className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 p-3 bg-white hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
            >
              <input
                id="ppe-item-goggles"
                type="checkbox"
                checked={selectedPpe.includes('GOGGLES')}
                onChange={() => onTogglePpe('GOGGLES')}
                disabled={isCreatingZone}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <span className="text-xs font-medium text-slate-800">
                {t('zoneSetup.ppe.GOGGLES')}{' '}
                <span className="text-[10px] text-sky-700 font-bold">
                  {t('zoneSetup.ppe.experimentalTag')}
                </span>
                <span className="text-[10px] text-slate-500 block">
                  {t('zoneSetup.ppe.experimentalNote')}
                </span>
              </span>
            </label>

            <label
              htmlFor="ppe-item-harness"
              className="flex items-center gap-2.5 rounded-xl border border-dashed border-slate-200 p-3 bg-slate-50/70 opacity-60 cursor-not-allowed"
            >
              <input
                id="ppe-item-harness"
                type="checkbox"
                checked={false}
                disabled={true}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-xs text-slate-500">
                {t('zoneSetup.ppe.HARNESS')}{' '}
                <span className="text-[10px] text-slate-500 block">
                  {t('zoneSetup.ppe.notAvailableNote')}
                </span>
              </span>
            </label>

            <label
              htmlFor="ppe-item-mask"
              className="flex items-center gap-2.5 rounded-xl border border-dashed border-slate-200 p-3 bg-slate-50/70 opacity-60 cursor-not-allowed"
            >
              <input
                id="ppe-item-mask"
                type="checkbox"
                checked={false}
                disabled={true}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-xs text-slate-500">
                {t('zoneSetup.ppe.MASK')}{' '}
                <span className="text-[10px] text-slate-500 block">
                  {t('zoneSetup.ppe.notAvailableNote')}
                </span>
              </span>
            </label>

            <label
              htmlFor="ppe-item-hook"
              className="flex items-center gap-2.5 rounded-xl border border-dashed border-slate-200 p-3 bg-slate-50/70 opacity-60 cursor-not-allowed"
            >
              <input
                id="ppe-item-hook"
                type="checkbox"
                checked={false}
                disabled={true}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-xs text-slate-500">
                {t('zoneSetup.ppe.HOOK')}{' '}
                <span className="text-[10px] text-slate-500 block">
                  {t('zoneSetup.ppe.notAvailableNote')}
                </span>
              </span>
            </label>
          </div>
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
