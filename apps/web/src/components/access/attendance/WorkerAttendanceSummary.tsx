import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconCheck,
  IconTrendingUp,
  IconAlertTriangle,
} from '../../icons';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import {
  attendanceDate,
  attendanceHours,
  attendanceLabel,
  attendanceTime,
} from './attendance-display';

export function WorkerAttendanceSummary({
  apiUrl,
  token,
  siteId,
  sessionScope,
  selectedDayId,
}: {
  apiUrl: string;
  token: string;
  siteId: string;
  sessionScope: string;
  selectedDayId: string;
}) {
  useTranslation();

  const [isExpanded, setIsExpanded] = useState(false);
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const scope = [apiUrl, sessionScope, siteId];
  const context = useQuery({
    queryKey: ['attendance-worker-context', ...scope],
    queryFn: () => client.attendanceDays(token, siteId, { limit: 1 }),
    refetchInterval: 30000,
  });
  // Use the latest workday's configured timezone; before any attendance exists,
  // explicitly use the device timezone rather than invent a Site timezone.
  const timezone =
    context.data?.items[0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = attendanceDate(new Date(), timezone);
  const fromDate = `${today.slice(0, 7)}-01`;
  const toDate = `${today.slice(0, 7)}-${new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate()}`;
  const enabled = context.isSuccess;
  const current = useQuery({
    queryKey: ['attendance-worker-today', ...scope, today],
    enabled,
    queryFn: () =>
      client.attendanceDays(token, siteId, { fromDate: today, toDate: today, limit: 1 }),
    refetchInterval: 30000,
  });
  const monthly = useQuery({
    queryKey: ['attendance-worker-month', ...scope, fromDate, toDate],
    enabled,
    queryFn: () => client.attendanceTimesheets(token, siteId, { fromDate, toDate }),
    refetchInterval: 30000,
  });
  const attention = useQuery({
    queryKey: ['attendance-worker-attention', ...scope, fromDate, toDate],
    enabled,
    queryFn: () =>
      client.attendanceDays(token, siteId, { fromDate, toDate, status: 'NEEDS_REVIEW', limit: 1 }),
    refetchInterval: 30000,
  });
  const dayId = selectedDayId || current.data?.items[0]?.id || '';
  const detail = useQuery({
    queryKey: ['attendance-day-detail', ...scope, dayId],
    enabled: enabled && !!dayId,
    queryFn: () => client.attendanceDayDetail(token, siteId, dayId),
    refetchInterval: 30000,
  });

  const cards = [
    {
      get label() {
        return tr('common.today_s_recorded_hours');
      },
      icon: IconClock,
      iconBg: 'bg-orange-50 text-[#F66B17] border border-orange-100/60',
      query: current,
      value: attendanceHours(current.data?.items[0]?.provisionalMinutes ?? 0),
    },
    {
      get label() {
        return tr('worker_attendance_summary.confirmed_hours_this_month');
      },
      icon: IconCheck,
      iconBg: 'bg-emerald-50 text-emerald-600 border border-emerald-100/60',
      query: monthly,
      value: attendanceHours(monthly.data?.items.reduce((n, r) => n + r.totalMinutes, 0) ?? 0),
    },
    {
      get label() {
        return tr('worker_attendance_summary.confirmed_overtime_this_month');
      },
      icon: IconTrendingUp,
      iconBg: 'bg-blue-50 text-blue-600 border border-blue-100/60',
      query: monthly,
      value: attendanceHours(monthly.data?.items.reduce((n, r) => n + r.overtimeMinutes, 0) ?? 0),
    },
    {
      get label() {
        return tr('worker_attendance_summary.days_needing_attention_this_month');
      },
      icon: IconAlertTriangle,
      iconBg: 'bg-amber-50 text-amber-600 border border-amber-100/60',
      query: attention,
      value: String(attention.data?.total ?? 0),
    },
  ];

  if (context.isError)
    return (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 flex items-center justify-between">
        <span>{tr('common.work_hours_unavailable')}</span>
        <button
          onClick={() => void context.refetch()}
          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 transition-colors"
        >
          {tr('common.retry_summary')}
        </button>
      </div>
    );

  const sessions = detail.data?.sessions ?? [];

  return (
    <div className="space-y-4">
      {/* ── 4 UNIFIED METRIC CARDS (NO SMALL TEXT FOOTNOTES) ──── */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="group relative rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-xs transition-all hover:border-slate-300 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div
                  className={`flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-xl ${card.iconBg} shadow-2xs transition-transform group-hover:scale-105`}
                >
                  <Icon className="h-5 w-5" />
                </div>
              </div>

              <div className="mt-3 sm:mt-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {card.label}
                </p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-xl sm:text-2xl font-black tracking-tight text-[#071A2B]">
                    {card.query.isError
                      ? tr('common.unavailable')
                      : card.query.isPending
                        ? tr('common.loading')
                        : card.value}
                  </span>
                </div>
              </div>

              {card.query.isError && (
                <div className="mt-3">
                  <button
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-100 transition-colors"
                    onClick={() => void card.query.refetch()}
                    aria-label={tr('common.retry_value', { value1: card.label })}
                  >
                    {tr('common.retry_value', { value1: card.label })}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── ATTENDANCE INTERVALS EXPANDABLE DRAWER ─────────────── */}
      <section className="rounded-2xl border border-slate-200/80 bg-white shadow-xs overflow-hidden transition-all">
        <button
          type="button"
          className="w-full flex items-center justify-between p-4 sm:p-5 text-left group hover:bg-slate-50/50 transition-colors cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-orange-50 text-[#F66B17] flex items-center justify-center border border-orange-100/60 shadow-2xs">
              <IconClock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-[#071A2B] group-hover:text-[#F66B17] transition-colors text-sm">
                {selectedDayId
                  ? tr('worker_attendance_summary.attendance_intervals_value', {
                      value1: detail.data?.day.workDate ?? tr('common.selected_day'),
                    })
                  : tr('common.today_s_attendance_intervals')}
              </h3>
              <p className="text-xs text-slate-400 font-medium mt-0.5">
                {detail.data?.day.timezone ?? timezone} ·{' '}
                {selectedDayId ? tr('common.selected_workday') : today}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200/80 bg-white text-xs font-semibold text-slate-600 group-hover:border-slate-300 group-hover:text-[#071A2B] shadow-2xs transition-all">
            <span>{isExpanded ? tr('common.hide_details') : tr('common.view_details')}</span>
            {isExpanded ? (
              <IconChevronDown className="w-3.5 h-3.5" />
            ) : (
              <IconChevronRight className="w-3.5 h-3.5" />
            )}
          </div>
        </button>

        {isExpanded && (
          <div className="p-5 pt-0 border-t border-slate-100 animate-in fade-in slide-in-from-top-2 duration-200">
            {current.isError && !selectedDayId ? (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 flex items-center justify-between"
              >
                <span>{tr('common.today_s_attendance_unavailable')}</span>
                <button
                  onClick={() => void current.refetch()}
                  className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                >
                  {tr('common.retry_today')}
                </button>
              </div>
            ) : context.isPending || current.isPending || (!!dayId && detail.isPending) ? (
              <p role="status" className="mt-4 text-xs text-slate-500 font-medium">
                {tr('common.loading_intervals')}
              </p>
            ) : detail.isError ? (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 flex items-center justify-between"
              >
                <span>{tr('common.intervals_unavailable')}</span>
                <button
                  onClick={() => void detail.refetch()}
                  className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                >
                  {tr('common.retry_intervals')}
                </button>
              </div>
            ) : !dayId ? (
              <p className="mt-4 text-xs text-slate-500 font-medium">
                {tr('worker_attendance_summary.no_attendance_recorded_today')}
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 bg-slate-50/80 px-3.5 py-2 rounded-xl border border-slate-100">
                  <span>
                    {detail.data?.day.shiftName ??
                      tr('worker_attendance_summary.no_shift_linked_to_this_attendance_day')}
                  </span>
                  {detail.data?.day.startsAt && (
                    <span className="text-slate-400">
                      · {attendanceTime(detail.data.day.startsAt, detail.data.day.timezone)} →{' '}
                      {attendanceTime(detail.data.day.endsAt, detail.data.day.timezone)}
                    </span>
                  )}
                </div>

                {!sessions.length && (
                  <p className="text-xs text-slate-400 py-2">
                    {tr('worker_attendance_summary.no_attendance_intervals_recorded')}
                  </p>
                )}

                <div className="divide-y divide-slate-100 rounded-xl border border-slate-100 overflow-hidden">
                  {sessions.map((s) => {
                    const duplicate =
                      s.status === 'IGNORED' || (s.status === 'NEEDS_REVIEW' && !s.effectiveInAt);
                    const tz = detail.data!.day.timezone;
                    return (
                      <div
                        key={s.id}
                        className="p-3.5 space-y-1.5 text-xs bg-white hover:bg-slate-50/50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#071A2B]">
                            {attendanceLabel(s.status)}
                          </span>
                          {s.workedMinutes !== null && (
                            <span className="font-mono font-bold text-emerald-700 text-xs">
                              {attendanceHours(s.workedMinutes)}
                            </span>
                          )}
                        </div>
                        {duplicate ? (
                          <p className="text-slate-600">
                            {tr(
                              'worker_attendance_summary.duplicate_check_in_value_no_work_hours_added',
                              { value1: attendanceTime(s.rawInAt, tz) },
                            )}
                          </p>
                        ) : (
                          <p className="text-slate-600 font-medium">
                            {s.effectiveInAt
                              ? attendanceTime(s.effectiveInAt, tz)
                              : tr('common.missing_check_in')}{' '}
                            →{' '}
                            {s.effectiveOutAt
                              ? attendanceTime(s.effectiveOutAt, tz)
                              : tr('common.open_session')}
                          </p>
                        )}
                        {s.status === 'MISSING_IN' && (
                          <p className="text-amber-700 font-medium">
                            {tr(
                              'worker_attendance_summary.the_value_check_out_has_no_matching_check_in',
                              { value1: attendanceTime(s.rawOutAt ?? s.effectiveOutAt, tz) },
                            )}
                          </p>
                        )}
                        {!duplicate && s.status === 'CORRECTED' && (
                          <p className="text-[11px] text-slate-400">
                            {tr('worker_attendance_summary.original_events_value_value', {
                              value1: attendanceTime(s.rawInAt, tz),
                              value2: attendanceTime(s.rawOutAt, tz),
                            })}
                          </p>
                        )}
                        {s.ignoreReason && (
                          <p className="text-[11px] text-slate-500">
                            {tr('common.reason_value', { value1: s.ignoreReason })}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
