import { translate as tr, uiLocale } from '../../../i18n';
import { attendanceHours } from './attendance-display';
import { AttendanceStatusBadge } from './AttendanceStatusBadge';
import { IconEye } from '../../icons';
import type { AttendanceWorkerReport } from '@smartsite/contracts';

export function AttendanceWorkersTable({
  workers,
  total,
  offset,
  limit,
  isLoading,
  timezone,
  onSelectWorker,
  onPageChange,
}: {
  workers: AttendanceWorkerReport[];
  total: number;
  offset: number;
  limit: number;
  isLoading?: boolean;
  timezone: string;
  onSelectWorker: (workerId: string) => void;
  onPageChange: (newOffset: number) => void;
}) {
  const formatShortTime = (isoString: string | null) => {
    if (!isoString) return null;
    try {
      return new Intl.DateTimeFormat(uiLocale(), {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(isoString));
    } catch {
      return null;
    }
  };

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const fromRecord = total === 0 ? 0 : offset + 1;
  const toRecord = Math.min(total, offset + limit);

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-xs overflow-hidden">
      {/* Table Container */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-50/70 border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <th className="p-3.5 pl-6">{tr('attendance_report.worker')}</th>
              <th className="p-3.5">{tr('attendance_report.today_status')}</th>
              <th className="p-3.5">{tr('attendance_report.working_hours')}</th>
              <th className="p-3.5">{tr('attendance_report.regular')}</th>
              <th className="p-3.5">{tr('attendance_report.overtime')}</th>
              <th className="p-3.5">{tr('attendance_report.attendance_rate')}</th>
              <th className="p-3.5 pr-6 text-right">{tr('attendance_report.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="p-12 text-center text-slate-400">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 animate-spin rounded-full border-2 border-[#F66B17] border-t-transparent" />
                    <span>{tr('attendance_report.loading_workers')}</span>
                  </div>
                </td>
              </tr>
            ) : !workers.length ? (
              <tr>
                <td colSpan={7} className="p-12 text-center text-slate-400">
                  {tr('attendance_report.no_workers_found')}
                </td>
              </tr>
            ) : (
              workers.map((worker) => {
                const inTime = formatShortTime(worker.todayFirstCheckInAt);
                const outTime = formatShortTime(worker.todayLastCheckOutAt);
                const rate = worker.attendanceRate;

                // Rate progress bar color
                const rateColor =
                  rate === null
                    ? 'bg-slate-200'
                    : rate >= 80
                      ? 'bg-emerald-500'
                      : rate >= 50
                        ? 'bg-amber-500'
                        : 'bg-rose-500';

                return (
                  <tr
                    key={worker.workerId}
                    className="hover:bg-slate-50/70 transition-colors group"
                  >
                    {/* Worker Info Column */}
                    <td className="p-3.5 pl-6 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 text-[#071A2B] font-bold text-xs flex items-center justify-center border border-slate-200 shrink-0">
                          {worker.workerName.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-bold text-[#071A2B] group-hover:text-[#F66B17] transition-colors">
                            {worker.workerName}
                          </p>
                          <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                            {tr('common.id_value', { value1: worker.workerCode })}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Today Status Column */}
                    <td className="p-3.5 whitespace-nowrap">
                      <div>
                        <AttendanceStatusBadge status={worker.todayStatus} />
                        {inTime && (
                          <p className="text-[10px] text-slate-400 mt-1 font-medium">
                            {tr('attendance_report.in_since', { time: inTime })}
                          </p>
                        )}
                        {!inTime && outTime && (
                          <p className="text-[10px] text-slate-400 mt-1 font-medium">
                            {tr('attendance_report.out_at', { time: outTime })}
                          </p>
                        )}
                      </div>
                    </td>

                    {/* Total Working Hours Column */}
                    <td className="p-3.5 font-mono font-bold text-[#071A2B] whitespace-nowrap">
                      <div>
                        <span>{attendanceHours(worker.totalMinutes)}</span>
                        {worker.provisionalMinutes > 0 && (
                          <p className="text-[10px] text-amber-600 font-normal mt-0.5">
                            + {attendanceHours(worker.provisionalMinutes)}{' '}
                            {tr('attendance_report.provisional')}
                          </p>
                        )}
                      </div>
                    </td>

                    {/* Regular Hours Column */}
                    <td className="p-3.5 font-mono text-slate-600 whitespace-nowrap">
                      {attendanceHours(worker.regularMinutes)}
                    </td>

                    {/* Overtime Hours Column */}
                    <td className="p-3.5 font-mono text-slate-600 whitespace-nowrap">
                      {attendanceHours(worker.overtimeMinutes)}
                    </td>

                    {/* Attendance Rate Column with visual progress bar */}
                    <td className="p-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-3 min-w-[120px]">
                        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${rateColor} transition-all duration-300`}
                            style={{ width: `${rate ?? 0}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs font-bold text-[#071A2B] shrink-0">
                          {rate !== null ? `${rate}%` : '—'}
                        </span>
                      </div>
                      {worker.isProvisional && (
                        <p className="text-[9px] text-amber-600 font-medium mt-0.5">
                          {tr('attendance_report.provisional_note')}
                        </p>
                      )}
                    </td>

                    {/* Action Column */}
                    <td className="p-3.5 pr-6 text-right whitespace-nowrap">
                      <button
                        onClick={() => onSelectWorker(worker.workerId)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-2xs cursor-pointer"
                        aria-label={`${tr('attendance_report.view')} ${worker.workerName}`}
                      >
                        <IconEye className="w-3.5 h-3.5 text-slate-500" />
                        <span>{tr('attendance_report.view')}</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 bg-slate-50/50 border-t border-slate-100">
          <p className="text-xs text-slate-500">
            {tr('attendance_report.showing_workers', {
              from: fromRecord,
              to: toRecord,
              total,
            })}
          </p>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onPageChange(Math.max(0, offset - limit))}
              disabled={offset === 0 || isLoading}
              className="px-3 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
            >
              {tr('common.previous')}
            </button>
            <span className="text-xs text-slate-500 px-2 font-mono">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => onPageChange(offset + limit)}
              disabled={offset + limit >= total || isLoading}
              className="px-3 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
            >
              {tr('common.next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
