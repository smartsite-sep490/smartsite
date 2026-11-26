import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconBuilding2 } from '../icons';
import { SmartNativeSelect } from '../ui/SmartNativeSelect';

export const worksiteControlClass = 'min-w-0 w-full text-sm font-semibold';

export function WorksitePickerFrame({
  id,
  label,
  children,
}: {
  id: string;
  label?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex w-fit min-w-0 max-w-full items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-3 py-2 sm:max-w-md">
      <span aria-hidden="true" className="shrink-0 text-[#F66B17]">
        <IconBuilding2 />
      </span>
      <label htmlFor={id} className="shrink-0 text-sm font-medium text-slate-600">
        {label ?? t('common.site_fa7955')}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function WorksitePicker({
  id,
  value,
  sites,
  onChange,
}: {
  id: string;
  value: string;
  sites: { id: string; name: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <WorksitePickerFrame id={id}>
      <SmartNativeSelect
        id={id}
        value={value}
        className={worksiteControlClass}
        onChange={(event) => onChange(event.target.value)}
      >
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </SmartNativeSelect>
    </WorksitePickerFrame>
  );
}
