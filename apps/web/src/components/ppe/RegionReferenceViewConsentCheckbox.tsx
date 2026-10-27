import React from 'react';
import { useTranslation } from 'react-i18next';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { useLocale } from '../../i18n/ppe-locale';
import { SAFETY_NAMESPACE, translateSafetyNamespaceKey } from '../../i18n/runtime';

const CONSENT_CHECKBOX_LABEL_KEY = 'regionSetup.reference.confirmViewCheckboxLabel';

const en: Readonly<Record<typeof CONSENT_CHECKBOX_LABEL_KEY, string>> = {
  [CONSENT_CHECKBOX_LABEL_KEY]: 'I checked that the drawn region matches this reference image',
};

const vi: Readonly<Record<typeof CONSENT_CHECKBOX_LABEL_KEY, string>> = {
  [CONSENT_CHECKBOX_LABEL_KEY]: 'Tôi đã kiểm tra vùng vừa vẽ khớp với ảnh tham chiếu này',
};

function ensureRegionReferenceViewConsentCatalog(): void {
  registerFeatureCatalog({ en, vi });
}

ensureRegionReferenceViewConsentCatalog();

export interface RegionReferenceViewConsentCheckboxProps {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onCheckedChange: (nextChecked: boolean) => void;
}

export function RegionReferenceViewConsentCheckbox({
  checked,
  disabled,
  onCheckedChange,
}: RegionReferenceViewConsentCheckboxProps) {
  ensureRegionReferenceViewConsentCatalog();
  const { locale } = useLocale();
  useTranslation(SAFETY_NAMESPACE);

  const label = translateSafetyNamespaceKey(locale, CONSENT_CHECKBOX_LABEL_KEY);

  return (
    <label
      data-testid="region-reference-view-consent"
      className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-xs leading-snug transition-colors ${
        disabled
          ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
          : checked
            ? 'cursor-pointer border-emerald-200 bg-emerald-50/60 text-slate-800'
            : 'cursor-pointer border-slate-200 bg-slate-50/70 text-slate-700 hover:border-slate-300'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span className="min-w-0 break-words [overflow-wrap:anywhere] font-medium">{label}</span>
    </label>
  );
}
