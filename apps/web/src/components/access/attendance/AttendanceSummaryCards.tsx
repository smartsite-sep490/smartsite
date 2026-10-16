import { translate as tr } from '../../../i18n';
import { attendanceHours } from './attendance-display';
import { IconClock, IconUsers, IconAlertCircle } from '../../icons';
import type { AttendanceSummaryResponse } from '@smartsite/contracts';

export function AttendanceSummaryCards({
  summary,
  isLoading,
}: {
  summary: AttendanceSummaryResponse | null | undefined;
  isLoading?: boolean;
}) {
  if (isLoading || !summary) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs animate-pulse"
          >
            <div className="h-4 bg-slate-100 rounded-md w-24 mb-3" />
            <div className="h-8 bg-slate-100 rounded-md w-16 mb-2" />
            <div className="h-3 bg-slate-100 rounded-md w-32" />
          </div>
        ))}
      </div>
    );
  }

  // 1. Total Workers
  const totalWorkers = summary.totalWorkers;

  // 2. Total Working Hours & change percent
  const totalMinutes = summary.totalMinutes;
  const changePercent = summary.workingMinutesChangePercent;

  // 3. Absent Today
  const absentCount = summary.absentTodayCount;
  const absentPercent = totalWorkers > 0 ? Math.round((absentCount / totalWorkers) * 100) : 0;

  // 4. Overtime Hours & worker count
  const overtimeMinutes = summary.overtimeMinutes;
  const overtimeWorkers = summary.overtimeWorkerCount;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Card 1: TOTAL WORKERS */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col justify-between hover:border-slate-300 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {tr('attendance_report.total_workers')}
          </span>
          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <IconUsers className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <p className="text-3xl font-black text-[#071A2B] font-mono leading-none">
            {totalWorkers}
          </p>
          <p className="text-xs text-slate-400 font-medium mt-2">
            {tr('attendance_report.on_this_site')}
          </p>
        </div>
      </div>

      {/* Card 2: TOTAL WORKING HOURS */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col justify-between hover:border-slate-300 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {tr('attendance_report.total_working_hours')}
          </span>
          <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
            <IconClock className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <p className="text-3xl font-black text-[#071A2B] font-mono leading-none">
            {attendanceHours(totalMinutes)}
          </p>
          <p className="text-xs font-medium mt-2">
            {changePercent !== null ? (
              <span className={changePercent >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                {changePercent >= 0 ? `+${changePercent}%` : `${changePercent}%`}{' '}
                <span className="text-slate-400">
                  {tr('attendance_report.compared_to_last_period', { percent: '' }).trim()}
                </span>
              </span>
            ) : summary.provisionalMinutes > 0 ? (
              <span className="text-amber-600">
                + {attendanceHours(summary.provisionalMinutes)}{' '}
                {tr('attendance_report.provisional')}
              </span>
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </p>
        </div>
      </div>

      {/* Card 3: ABSENT TODAY (Note: NO Present Today card per strict requirement) */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col justify-between hover:border-slate-300 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {tr('attendance_report.absent_today')}
          </span>
          <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
            <IconAlertCircle className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-black text-[#071A2B] font-mono leading-none">
              {absentCount}
            </span>
            <span className="text-base font-bold text-slate-400 font-mono">/ {totalWorkers}</span>
          </div>
          <p className="text-xs text-rose-600 font-semibold mt-2">{absentPercent}%</p>
        </div>
      </div>

      {/* Card 4: OVERTIME HOURS */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col justify-between hover:border-slate-300 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {tr('attendance_report.overtime_hours')}
          </span>
          <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <IconClock className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <p className="text-3xl font-black text-[#071A2B] font-mono leading-none">
            {attendanceHours(overtimeMinutes)}
          </p>
          <p className="text-xs text-slate-500 font-medium mt-2">
            {tr('attendance_report.workers_count', { count: overtimeWorkers })}
          </p>
        </div>
      </div>
    </div>
  );
}
