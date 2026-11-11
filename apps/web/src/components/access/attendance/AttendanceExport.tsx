import { useLayoutEffect, useRef, useState } from 'react';
import type { AttendanceExportResponse, AttendanceReportQuery } from '@smartsite/contracts';
import { translate as tr, uiLanguage } from '../../../i18n';
import { IconExport } from '../../icons';
import { createAttendanceExport, type AttendanceExportFormat } from './attendance-export';

export function AttendanceExport({
  filters,
  shiftName,
  disabled,
  loadReport,
}: {
  filters: AttendanceReportQuery;
  shiftName?: string;
  disabled: boolean;
  loadReport: (
    filters: AttendanceReportQuery,
    signal: AbortSignal,
  ) => Promise<AttendanceExportResponse>;
}) {
  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState<'error' | 'empty'>();
  const active = useRef<AbortController | null>(null);

  // The caller keys this component by API, site, and authentication scope.
  useLayoutEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );

  const exportReport = async (format: AttendanceExportFormat) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const frozenFilters = { ...filters };
    const language = uiLanguage();
    const frozenShiftName = shiftName;
    const exportedAt = new Date();
    setIsExporting(true);
    setMessage(undefined);
    try {
      const report = await loadReport(frozenFilters, controller.signal);
      if (controller.signal.aborted) return;
      if (!report.items.length) {
        setMessage('empty');
        return;
      }
      const blob = await createAttendanceExport(format, report, frozenFilters, {
        language,
        exportedAt,
        shiftName: frozenShiftName,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const link = document.createElement('a');
      link.href = url;
      link.download = `attendance-${report.siteId}-${report.fromDate}-${report.toDate}.${format}`;
      link.click();
    } catch {
      if (!controller.signal.aborted) setMessage('error');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setIsExporting(false);
      }
    }
  };

  const actions = [
    ['csv', tr('attendance_report.export')],
    ['xlsx', tr('attendance_export.excel')],
    ['pdf', tr('attendance_export.pdf')],
  ] as const;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {actions.map(([format, label]) => (
          <button
            key={format}
            type="button"
            onClick={() => void exportReport(format)}
            disabled={disabled || isExporting}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
          >
            <IconExport aria-hidden="true" className="w-3.5 h-3.5 text-slate-500" />
            {label}
          </button>
        ))}
      </div>
      {isExporting && (
        <p role="status" className="text-xs text-slate-500">
          {tr('attendance_report.exporting')}
        </p>
      )}
      {message === 'empty' && (
        <p role="status" className="text-xs text-slate-500">
          {tr('attendance_export.empty')}
        </p>
      )}
      {message === 'error' && (
        <p role="alert" className="text-xs text-red-700">
          {tr('attendance_export.failed')}
        </p>
      )}
    </div>
  );
}
