import { useTranslation } from 'react-i18next';
import { SAFETY_NAMESPACE, translateSafetyNamespaceKey, uiLanguage } from '../../i18n/runtime';
import {
  registerCameraRegionReferenceCatalog,
  type CameraRegionReferenceCatalogKey,
} from './camera-region-reference-catalog';

const CONSENT_CHECKBOX_LABEL_KEY: CameraRegionReferenceCatalogKey =
  'regionSetup.reference.confirmViewCheckboxLabel';

registerCameraRegionReferenceCatalog();

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
  registerCameraRegionReferenceCatalog();
  useTranslation(SAFETY_NAMESPACE);

  const label = translateSafetyNamespaceKey(uiLanguage(), CONSENT_CHECKBOX_LABEL_KEY);

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
