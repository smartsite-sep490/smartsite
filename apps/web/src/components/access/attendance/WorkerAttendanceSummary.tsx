import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IconChevronDown, IconChevronRight } from '../../icons';
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
      label: "Today's Recorded Hours",
      query: current,
      value: attendanceHours(current.data?.items[0]?.provisionalMinutes ?? 0),
      note: 'Provisional',
    },
    {
      label: 'Confirmed Hours This Month',
      query: monthly,
      value: attendanceHours(monthly.data?.items.reduce((n, r) => n + r.totalMinutes, 0) ?? 0),
      note: 'Confirmed only',
    },
    {
      label: 'Confirmed Overtime This Month',
      query: monthly,
      value: attendanceHours(monthly.data?.items.reduce((n, r) => n + r.overtimeMinutes, 0) ?? 0),
      note: 'Included in confirmed hours',
    },
    {
      label: 'Days Needing Attention This Month',
      query: attention,
      value: String(attention.data?.total ?? 0),
      note: 'All days in this month',
    },
  ];
  if (context.isError)
    return (
      <div role="alert">
        Work hours unavailable.{' '}
        <button onClick={() => void context.refetch()}>Retry summary</button>
      </div>
    );
  const sessions = detail.data?.sessions ?? [];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold text-slate-600">{card.label}</p>
            <p className="mt-2 text-xl font-bold text-[#071A2B]">
              {card.query.isError ? 'Unavailable' : card.query.isPending ? 'Loading…' : card.value}
            </p>
            <p className="mt-1 text-xs text-slate-500">{card.note}</p>
            {card.query.isError && (
              <button className="mt-2 text-xs underline" onClick={() => void card.query.refetch()}>
                Retry {card.label}
              </button>
            )}
          </div>
        ))}
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
        <div
          className="flex items-center justify-between cursor-pointer group"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div>
            <h3 className="font-bold text-[#071A2B] group-hover:text-[#F66B17] transition-colors">
              {selectedDayId
                ? `Attendance intervals · ${detail.data?.day.workDate ?? 'Selected day'}`
                : "Today's attendance intervals"}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {detail.data?.day.timezone ?? timezone} · {selectedDayId ? 'Selected workday' : today}
            </p>
          </div>
          <button
            className="flex items-center gap-1 text-xs font-semibold text-slate-500 group-hover:text-[#F66B17] transition-colors"
          >
            {isExpanded ? 'Hide details' : 'View details'}
            {isExpanded ? <IconChevronDown className="w-4 h-4" /> : <IconChevronRight className="w-4 h-4" />}
          </button>
        </div>

        {isExpanded && (
          <div className="pt-2 animate-in fade-in slide-in-from-top-2 duration-200">
            {current.isError && !selectedDayId ? (
              <div role="alert">
                Today's attendance unavailable.{' '}
                <button onClick={() => void current.refetch()}>Retry today</button>
              </div>
            ) : context.isPending || current.isPending || (!!dayId && detail.isPending) ? (
              <p role="status">Loading intervals…</p>
            ) : detail.isError ? (
              <div role="alert">
                Intervals unavailable.{' '}
                <button onClick={() => void detail.refetch()}>Retry intervals</button>
              </div>
            ) : !dayId ? (
              <p>No attendance recorded today.</p>
            ) : (
          <>
            <p className="text-sm">
              {detail.data?.day.shiftName ?? 'No shift linked to this attendance day'}
              {detail.data?.day.startsAt && (
                <>
                  {' '}
                  · {attendanceTime(detail.data.day.startsAt, detail.data.day.timezone)} →{' '}
                  {attendanceTime(detail.data.day.endsAt, detail.data.day.timezone)}
                </>
              )}
            </p>
            {!sessions.length && <p>No attendance intervals recorded.</p>}
            <div className="divide-y divide-slate-100">
              {sessions.map((s) => {
                const duplicate =
                  s.status === 'IGNORED' || (s.status === 'NEEDS_REVIEW' && !s.effectiveInAt);
                const tz = detail.data!.day.timezone;
                return (
                  <div key={s.id} className="py-3 space-y-1 text-sm">
                    <p className="font-semibold">{attendanceLabel(s.status)}</p>
                    {duplicate ? (
                      <p>
                        Duplicate check-in · {attendanceTime(s.rawInAt, tz)} · No work hours added
                      </p>
                    ) : (
                      <p>
                        {s.effectiveInAt ? attendanceTime(s.effectiveInAt, tz) : 'Missing check-in'}{' '}
                        → {s.effectiveOutAt ? attendanceTime(s.effectiveOutAt, tz) : 'Open session'}
                        {s.workedMinutes !== null && <> · {attendanceHours(s.workedMinutes)}</>}
                      </p>
                    )}
                    {s.status === 'MISSING_IN' && (
                      <p className="text-amber-700">
                        The {attendanceTime(s.rawOutAt ?? s.effectiveOutAt, tz)} check-out has no
                        matching check-in.
                      </p>
                    )}
                    {!duplicate && s.status === 'CORRECTED' && (
                      <p className="text-xs text-slate-500">
                        Original events: {attendanceTime(s.rawInAt, tz)} →{' '}
                        {attendanceTime(s.rawOutAt, tz)}
                      </p>
                    )}
                    {s.ignoreReason && (
                      <p className="text-xs text-slate-500">Reason: {s.ignoreReason}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
          </div>
        )}
      </section>
    </div>
  );
}
