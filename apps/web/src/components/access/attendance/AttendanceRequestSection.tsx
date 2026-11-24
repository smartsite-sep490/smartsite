import type { ReactNode } from 'react';
import { translate as tr } from '../../../i18n';

export function AttendanceRequestSection({
  title,
  children,
  initiallyOpen = false,
}: {
  title: string;
  children: ReactNode;
  initiallyOpen?: boolean;
}) {
  return (
    <details
      open={initiallyOpen || undefined}
      className="group/request rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-sm font-bold text-[#071A2B] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-orange-500 [&::-webkit-details-marker]:hidden">
        <h3>{title}</h3>
        <span className="shrink-0 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 group-open/request:bg-orange-50 group-open/request:text-orange-800">
          <span className="group-open/request:hidden">{tr('common.expand')} +</span>
          <span className="hidden group-open/request:inline">{tr('common.collapse')} −</span>
        </span>
      </summary>
      <div className="border-t border-slate-100">{children}</div>
    </details>
  );
}
