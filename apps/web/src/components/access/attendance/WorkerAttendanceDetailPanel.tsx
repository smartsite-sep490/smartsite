import { useManagementClient } from '../../../features/auth/auth-session';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { translate as tr, uiLocale } from '../../../i18n';
import { userErrorMessage } from '../../../i18n/messages';
import { attendanceHours, attendanceLabel } from './attendance-display';
import { AttendanceStatusBadge } from './AttendanceStatusBadge';
import { AttendanceDailyBarChart } from './AttendanceDailyBarChart';
import { AttendanceDistributionDonut } from './AttendanceDistributionDonut';
import {
  IconArrowRight,
  IconChevronLeft,
  IconChevronRight,
  IconRefresh,
  IconCalendar,
  IconChevronDown,
} from '../../icons';
import type { AttendanceReportDay, AttendanceWorkerReport } from '@smartsite/contracts';

export function WorkerAttendanceDetailPanel({
  apiUrl,
  token,
  siteId,
  sessionScope,
  workerId,
  fromDate,
  toDate,
  timezone,
  onBack,
  onSelectDayForCorrection,
  onPreviousWeek,
  onNextWeek,
}: {
  apiUrl: string;
  token: string;
  siteId: string;
  sessionScope: string;
  workerId: string;
  fromDate: string;
  toDate: string;
  timezone: string;
  onBack: () => void;
  onSelectDayForCorrection?: (attendanceDayId: string) => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
}) {
  useTranslation();
  const client = useManagementClient(apiUrl);
  const [activeTab, setActiveTab] = useState<'records' | 'timesheet'>('records');
  const [expandedDayId, setExpandedDayId] = useState<string | null>(null);

  const workerQuery = useQuery({
    queryKey: [
      'attendance-worker-report',
      apiUrl,
      sessionScope,
      siteId,
      workerId,
      fromDate,
      toDate,
      timezone,
    ],
    queryFn: async () => {
      const res = await client.attendanceWorkers(token, siteId, {
        fromDate,
        toDate,
        timezone,
        workerId,
        includeDaily: true,
        limit: 1,
      });
      return res.items[0] ?? null;
    },
    refetchInterval: 30000,
  });

  // Query for session intervals of the selected day
  const dayDetailQuery = useQuery({
    queryKey: ['attendance-day-detail', apiUrl, sessionScope, siteId, expandedDayId],
    queryFn: () =>
      expandedDayId ? client.attendanceDayDetail(token, siteId, expandedDayId) : null,
    enabled: Boolean(expandedDayId),
    refetchInterval: 30000,
  });

  const worker: AttendanceWorkerReport | null = workerQuery.data ?? null;
  const daily: AttendanceReportDay[] = worker?.daily ?? [];

  const handleToggleDaySessions = (dayId: string | null) => {
    if (!dayId) return;
    setExpandedDayId((prev) => (prev === dayId ? null : dayId));
  };

  const formatShortTime = (isoString: string | null) => {
    if (!isoString) return '—';
    try {
      return new Intl.DateTimeFormat(uiLocale(), {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(isoString));
    } catch {
      return isoString;
    }
  };

  const formatDayDate = (dateStr: string) => {
    try {
      const d = new Date(`${dateStr}T00:00:00Z`);
      const weekday = d.toLocaleDateString(uiLocale(), { weekday: 'short', timeZone: 'UTC' });
      return `${weekday}, ${dateStr}`;
    } catch {
      return dateStr;
    }
  };

  return (
    <section aria-labelledby="worker-detail-heading" className="space-y-6">
      {/* Top Navigation & Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
            aria-label={tr('attendance_report.back_to_list')}
          >
            <IconChevronLeft className="w-4 h-4" />
            <span>{tr('attendance_report.back_to_list')}</span>
          </button>

          {worker && (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 text-[#071A2B] font-bold text-sm flex items-center justify-center border border-slate-200 shadow-xs">
                {worker.workerName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2
                    id="worker-detail-heading"
                    className="text-base font-extrabold text-[#071A2B]"
                  >
                    {worker.workerName}
                  </h2>
                  <AttendanceStatusBadge status={worker.todayStatus} />
                </div>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  {tr('common.id_value', { value1: worker.workerCode })}
                  {worker.todayFirstCheckInAt && (
                    <span className="ml-3 font-sans text-slate-500">
                      {tr('attendance_report.in_since', {
                        time: formatShortTime(worker.todayFirstCheckInAt),
                      })}
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Date range controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 shadow-xs">
            <IconCalendar className="w-4 h-4 text-slate-400" />
            <span>
              {fromDate} — {toDate}
            </span>
          </div>

          <div className="flex items-center rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
            <button
              onClick={onPreviousWeek}
              className="p-2 text-slate-600 hover:bg-slate-50 border-r border-slate-100 transition-colors"
              title={tr('attendance_report.previous_week')}
              aria-label={tr('attendance_report.previous_week')}
            >
              <IconChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={onNextWeek}
              className="p-2 text-slate-600 hover:bg-slate-50 transition-colors"
              title={tr('attendance_report.next_week')}
              aria-label={tr('attendance_report.next_week')}
            >
              <IconChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => void workerQuery.refetch()}
            className="p-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors shadow-xs"
            title={tr('common.refresh')}
            aria-label={tr('common.refresh')}
          >
            <IconRefresh className="w-4 h-4" />
          </button>
        </div>
      </div>

      {workerQuery.isPending && (
        <div className="p-12 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
          <div className="w-4 h-4 animate-spin rounded-full border-2 border-[#F66B17] border-t-transparent" />
          <span>{tr('attendance_report.loading_worker_detail')}</span>
        </div>
      )}

      {workerQuery.error && (
        <div
          role="alert"
          className="flex items-center justify-between p-4 rounded-2xl border border-red-200 bg-red-50 text-xs text-red-700"
        >
          <span>{userErrorMessage(workerQuery.error)}</span>
          <button
            onClick={() => void workerQuery.refetch()}
            className="font-bold underline hover:no-underline"
          >
            {tr('attendance_report.retry')}
          </button>
        </div>
      )}

      {worker && (
        <>
          {/* Top 3 Metric & Chart Columns (as in screenshot) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Column 1: Working Hours Summary Card */}
            <div className="lg:col-span-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#071A2B]">
                  {tr('attendance_report.working_hours_summary')}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {fromDate} — {toDate}
                </p>

                <div className="mt-4 pt-3 border-t border-slate-100">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    {tr('attendance_report.total_hours')}
                  </p>
                  <p className="text-2xl font-black text-[#071A2B] mt-1 font-mono">
                    {attendanceHours(worker.totalMinutes)}
                  </p>
                  {worker.provisionalMinutes > 0 && (
                    <p className="text-[11px] text-amber-600 font-medium mt-1">
                      + {attendanceHours(worker.provisionalMinutes)}{' '}
                      {tr('attendance_report.provisional')}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-100 mt-4">
                <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-100">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
                    {tr('attendance_report.regular_hours')}
                  </p>
                  <p className="text-sm font-bold text-blue-950 font-mono mt-0.5">
                    {attendanceHours(worker.regularMinutes)}
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-100">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                    {tr('attendance_report.overtime_hours')}
                  </p>
                  <p className="text-sm font-bold text-amber-950 font-mono mt-0.5">
                    {attendanceHours(worker.overtimeMinutes)}
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-100">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                    {tr('attendance_report.days_present')}
                  </p>
                  <p className="text-sm font-bold text-emerald-950 font-mono mt-0.5">
                    {worker.presentDays} / {worker.requiredDays}
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                    {tr('attendance_report.rate')}
                  </p>
                  <p className="text-sm font-bold text-[#071A2B] font-mono mt-0.5">
                    {worker.attendanceRate !== null ? `${worker.attendanceRate}%` : '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* Column 2: Daily Working Hours Stacked Bar Chart */}
            <div className="lg:col-span-6 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
              <AttendanceDailyBarChart daily={daily} />
            </div>

            {/* Column 3: Work Time Distribution Donut */}
            <div className="lg:col-span-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col justify-between">
              <AttendanceDistributionDonut
                regularMinutes={worker.regularMinutes}
                overtimeMinutes={worker.overtimeMinutes}
              />
            </div>
          </div>

          {/* Bottom Table Section: Attendance Records / Timesheet Detail */}
          <div className="rounded-2xl border border-slate-200/80 bg-white shadow-xs overflow-hidden">
            {/* Tabs Header */}
            <div className="flex items-center gap-6 px-6 pt-3 border-b border-slate-100">
              <button
                onClick={() => setActiveTab('records')}
                className={`pb-3 text-xs font-bold transition-colors relative cursor-pointer ${
                  activeTab === 'records'
                    ? 'text-[#F66B17] border-b-2 border-[#F66B17]'
                    : 'text-slate-400 hover:text-slate-700'
                }`}
              >
                {tr('attendance_report.attendance_records')}
              </button>
              <button
                onClick={() => setActiveTab('timesheet')}
                className={`pb-3 text-xs font-bold transition-colors relative cursor-pointer ${
                  activeTab === 'timesheet'
                    ? 'text-[#F66B17] border-b-2 border-[#F66B17]'
                    : 'text-slate-400 hover:text-slate-700'
                }`}
              >
                {tr('attendance_report.timesheet_detail')}
              </button>
            </div>

            {/* Tab 1: Attendance Records Table */}
            {activeTab === 'records' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50/70 border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="p-3.5 pl-6">{tr('attendance_report.date')}</th>
                      <th className="p-3.5">{tr('attendance_report.shift')}</th>
                      <th className="p-3.5">{tr('attendance_report.check_in')}</th>
                      <th className="p-3.5">{tr('attendance_report.check_out')}</th>
                      <th className="p-3.5">{tr('attendance_report.working_hours')}</th>
                      <th className="p-3.5">{tr('attendance_report.regular')}</th>
                      <th className="p-3.5">{tr('attendance_report.overtime')}</th>
                      <th className="p-3.5">{tr('attendance_report.status')}</th>
                      <th className="p-3.5 pr-6 text-right">{tr('attendance_report.sessions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {daily.map((day) => {
                      const isOff = day.status === 'OFF';
                      const isExpanded = expandedDayId === day.attendanceDayId;
                      const shiftName = day.shifts[0]?.name ?? (isOff ? tr('labels.OFF') : '—');

                      return (
                        <tr
                          key={day.workDate}
                          className={`hover:bg-slate-50/60 transition-colors ${
                            isExpanded ? 'bg-orange-50/20' : ''
                          }`}
                        >
                          <td className="p-3.5 pl-6 font-semibold text-[#071A2B] whitespace-nowrap">
                            {formatDayDate(day.workDate)}
                          </td>
                          <td className="p-3.5 text-slate-600 whitespace-nowrap">{shiftName}</td>
                          <td className="p-3.5 font-mono text-slate-700 whitespace-nowrap">
                            {formatShortTime(day.firstCheckInAt)}
                          </td>
                          <td className="p-3.5 font-mono text-slate-700 whitespace-nowrap">
                            {formatShortTime(day.lastCheckOutAt)}
                          </td>
                          <td className="p-3.5 font-mono font-bold text-[#071A2B] whitespace-nowrap">
                            {day.hoursStatus === 'CONFIRMED'
                              ? attendanceHours(day.totalMinutes)
                              : day.provisionalMinutes > 0
                                ? `${attendanceHours(day.provisionalMinutes)}*`
                                : attendanceHours(0)}
                          </td>
                          <td className="p-3.5 font-mono text-slate-600 whitespace-nowrap">
                            {attendanceHours(day.regularMinutes)}
                          </td>
                          <td className="p-3.5 font-mono text-slate-600 whitespace-nowrap">
                            {attendanceHours(day.overtimeMinutes)}
                          </td>
                          <td className="p-3.5 whitespace-nowrap">
                            <AttendanceStatusBadge status={day.status} />
                          </td>
                          <td className="p-3.5 pr-6 text-right whitespace-nowrap">
                            {day.attendanceDayId ? (
                              <button
                                onClick={() => handleToggleDaySessions(day.attendanceDayId)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors cursor-pointer"
                                aria-expanded={isExpanded}
                              >
                                <span>
                                  {tr(isExpanded ? 'common.hide_details' : 'common.view_details')}
                                </span>
                                <IconChevronDown
                                  className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                />
                              </button>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Tab 2: Timesheet Detail */}
            {activeTab === 'timesheet' && (
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    {tr('attendance_report.timesheet_detail')}
                  </h4>
                  <span className="text-xs text-slate-500">{tr('common.confirmed_only')}</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/70">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {tr('attendance_report.regular')}
                    </p>
                    <p className="text-lg font-bold text-[#071A2B] font-mono mt-1">
                      {attendanceHours(worker.regularMinutes)}
                    </p>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/70">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {tr('attendance_report.overtime')}
                    </p>
                    <p className="text-lg font-bold text-[#071A2B] font-mono mt-1">
                      {attendanceHours(worker.overtimeMinutes)}
                    </p>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/70">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {tr('attendance_report.total_hours')}
                    </p>
                    <p className="text-lg font-bold text-emerald-700 font-mono mt-1">
                      {attendanceHours(worker.totalMinutes)}
                    </p>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/70">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {tr('attendance_report.provisional')}
                    </p>
                    <p className="text-lg font-bold text-amber-700 font-mono mt-1">
                      {attendanceHours(worker.provisionalMinutes)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Expandable Session Detail Drawer */}
            {expandedDayId && (
              <div className="p-5 bg-slate-50/80 border-t border-slate-200/80 space-y-3">
                <div className="flex items-center justify-end">
                  {onSelectDayForCorrection && (
                    <button
                      onClick={() => onSelectDayForCorrection(expandedDayId)}
                      className="text-xs font-bold text-[#F66B17] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <span>{tr('attendance_report.manage_workflow')}</span>
                      <IconArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {dayDetailQuery.isPending && (
                  <p className="text-xs text-slate-500">{tr('common.loading_intervals')}</p>
                )}

                {dayDetailQuery.error && (
                  <p className="text-xs text-red-600 font-semibold">
                    {userErrorMessage(dayDetailQuery.error)}
                  </p>
                )}

                {dayDetailQuery.data && (
                  <div className="space-y-3">
                    <div className="p-3 rounded-xl bg-white border border-slate-200/80 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div>
                        <span className="text-slate-400 block text-[10px] font-bold uppercase">
                          {tr('attendance_report.scheduled_shift')}
                        </span>
                        <span className="font-semibold text-slate-800">
                          {dayDetailQuery.data.day.startsAt && dayDetailQuery.data.day.endsAt
                            ? `${formatShortTime(dayDetailQuery.data.day.startsAt)} - ${formatShortTime(dayDetailQuery.data.day.endsAt)}`
                            : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] font-bold uppercase">
                          {tr('attendance_report.shift_exits')}
                        </span>
                        <span className="font-semibold text-slate-800">
                          {tr('attendance_report.shift_exits_value', {
                            count: dayDetailQuery.data.day.exitCount ?? 0,
                            max:
                              dayDetailQuery.data.day.maxExitCount !== undefined
                                ? tr('attendance_report.max_exits_limit', {
                                    max: dayDetailQuery.data.day.maxExitCount,
                                  })
                                : '',
                          })}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] font-bold uppercase">
                          {tr('attendance_report.deducted_time')}
                        </span>
                        <span
                          className={`font-semibold font-mono ${(dayDetailQuery.data.day.deductedMinutes ?? 0) > 0 ? 'text-rose-600' : 'text-slate-700'}`}
                        >
                          {tr('attendance_report.deducted_minutes_value', {
                            minutes: dayDetailQuery.data.day.deductedMinutes ?? 0,
                          })}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] font-bold uppercase">
                          {tr('attendance_report.actual_working_hours')}
                        </span>
                        <span className="font-semibold font-mono text-emerald-700">
                          {attendanceHours(
                            dayDetailQuery.data.day.confirmedMinutes ??
                              dayDetailQuery.data.day.provisionalMinutes,
                          )}
                        </span>
                      </div>
                    </div>

                    {!dayDetailQuery.data.sessions.length ? (
                      <p className="text-xs text-slate-400 italic">
                        {tr('attendance_report.no_sessions_recorded')}
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {dayDetailQuery.data.sessions.map((session) => (
                          <div
                            key={session.id}
                            className="p-3 rounded-xl border border-slate-200 bg-white text-xs space-y-1 shadow-2xs"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-800">
                                {tr('attendance_report.effective_time', {
                                  in: formatShortTime(session.effectiveInAt),
                                  out: formatShortTime(session.effectiveOutAt),
                                })}
                              </span>
                              <span className="font-mono text-slate-500 font-bold">
                                {session.workedMinutes !== null
                                  ? attendanceHours(session.workedMinutes)
                                  : '—'}
                              </span>
                            </div>
                            {(session.rawInAt || session.rawOutAt) && (
                              <p className="text-[11px] text-slate-400">
                                {tr('attendance_report.raw_time', {
                                  in: formatShortTime(session.rawInAt ?? null),
                                  out: formatShortTime(session.rawOutAt ?? null),
                                })}
                              </p>
                            )}
                            <div className="flex items-center justify-between pt-1">
                              <span className="text-[10px] font-bold text-slate-500">
                                {attendanceLabel(session.status)}
                              </span>
                              {session.ignoreReason && (
                                <span className="text-[10px] text-slate-400 italic">
                                  {session.ignoreReason}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
