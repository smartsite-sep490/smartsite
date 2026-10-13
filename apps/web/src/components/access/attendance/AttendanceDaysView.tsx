import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { loadAllPages } from '../../workforce/load-all-pages';
import { attendanceLabel } from './attendance-display';
import { attendanceDate } from './attendance-display';
import { requestTimeInstant, requestShiftTimes, requestWallTime } from './attendance-request-time';
import type {
  AttendanceDayResponse,
  AttendanceDayStatus,
  AttendanceTimeRequestResponse,
  AttendanceSessionResponse,
} from '@smartsite/contracts';
import {
  IconChevronRight,
  IconChevronLeft,
  IconRefresh,
  IconClock,
  IconCalendar,
  IconCheck,
  IconX,
  IconEye,
  IconAlertTriangle,
  IconFilter,
  IconUsers,
} from '../../icons';

const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
const shiftTime = (value: string | null, timezone: string) =>
  value ? new Date(value).toLocaleString(undefined, { timeZone: timezone }) : 'Unavailable';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    IN_PROGRESS: { label: 'In Progress', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    NEEDS_REVIEW: { label: 'Needs Review', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    CONFIRMED: { label: 'Confirmed', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    MISSING_IN: { label: 'Missing IN', cls: 'bg-red-50 text-red-700 border-red-200' },
    IGNORED: { label: 'Ignored', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
    PENDING: { label: 'Pending approval', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    PENDING_MANAGER: {
      label: 'Pending approval',
      cls: 'bg-amber-50 text-amber-700 border-amber-200',
    },
    APPROVED: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    REJECTED: { label: 'Rejected', cls: 'bg-red-50 text-red-700 border-red-200' },
  };
  const cfg = map[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${cfg.cls}`}
    >
      {attendanceLabel(status)}
    </span>
  );
}

export function AttendanceDaysView({
  apiUrl,
  token,
  siteId,
  sessionScope,
  selectedDayId,
  onSelectDay,
  isWorker,
  children,
}: {
  apiUrl: string;
  token: string;
  siteId: string;
  sessionScope: string;
  selectedDayId?: string;
  onSelectDay?: (id: string) => void;
  isWorker?: boolean;
  children?: React.ReactNode;
}) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const cache = useQueryClient();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [workerFilter, setWorkerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<AttendanceDayStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AttendanceDayResponse | null>(null);
  const [kind, setKind] = useState<'OVERTIME' | 'LEAVE'>('OVERTIME');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [rejectingRequest, setRejectingRequest] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [requestKind, setRequestKind] = useState<'OVERTIME' | 'LEAVE'>('OVERTIME');
  const [requestStatus, setRequestStatus] = useState<'' | 'PENDING' | 'APPROVED' | 'REJECTED'>('');
  const [requestOffset, setRequestOffset] = useState(0);
  const requestId = useRef<{ fingerprint: string; id: string } | null>(null);
  const [submittedRequest, setSubmittedRequest] = useState<{
    id: string;
    kind: 'OVERTIME' | 'LEAVE';
  } | null>(null);

  const query = useQuery({
    queryKey: [
      'attendance-days',
      apiUrl,
      sessionScope,
      siteId,
      fromDate,
      toDate,
      workerFilter,
      statusFilter,
      offset,
    ],
    queryFn: () =>
      client.attendanceDays(token, siteId, {
        ...(fromDate ? { fromDate } : {}),
        ...(toDate ? { toDate } : {}),
        ...(workerFilter ? { workerId: workerFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        offset,
        limit: 20,
      }),
    refetchInterval: 30000,
  });

  const schedules = useQuery({
    queryKey: ['attendance-schedules', apiUrl, sessionScope, siteId],
    queryFn: ({ signal }) =>
      loadAllPages(
        (page) => client.listWorkerSchedules(token, siteId, { ...page, status: 'ACTIVE' }),
        signal,
      ),
    enabled: query.data?.canRequest === true,
    refetchInterval: 30000,
  });

  const requestShifts = useQuery({
    queryKey: ['attendance-request-shifts', apiUrl, sessionScope, siteId],
    queryFn: () => client.listShifts(token, siteId),
    enabled: query.data?.canRequest === true,
    refetchInterval: 30000,
  });
  const availableSchedules = (schedules.data?.items ?? [])
    .flatMap((schedule) => {
      const shift = requestShifts.data?.items.find((s) => s.id === schedule.shiftId);
      if (!schedule.isActive || !shift) return [];
      try {
        if (schedule.workDate < attendanceDate(new Date(), shift.timezone)) return [];
        return [{ schedule, shift, ...requestShiftTimes(schedule.workDate, shift) }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const workers = useQuery({
    queryKey: ['attendance-workers', apiUrl, sessionScope, siteId],
    queryFn: ({ signal }) =>
      loadAllPages((page) => client.listWorkers(token, siteId, page), signal),
    enabled: query.data?.canReview === true,
  });

  const detailId =
    selected?.id ?? selectedDayId ?? new URLSearchParams(window.location.search).get('dayId') ?? '';
  const detail = useQuery({
    queryKey: ['attendance-day-detail', apiUrl, sessionScope, siteId, detailId],
    enabled: !!detailId,
    queryFn: () => client.attendanceDayDetail(token, siteId, detailId),
    refetchInterval: 30000,
  });

  const timesheets = useQuery({
    queryKey: [
      'attendance-timesheets',
      apiUrl,
      sessionScope,
      siteId,
      fromDate,
      toDate,
      workerFilter,
    ],
    queryFn: () =>
      client.attendanceTimesheets(token, siteId, {
        ...(workerFilter ? { workerId: workerFilter } : {}),
        ...(fromDate ? { fromDate } : {}),
        ...(toDate ? { toDate } : {}),
      }),
    refetchInterval: 30000,
  });

  const [scheduleId, setScheduleId] = useState('');
  const selectedRequestSchedule = availableSchedules.find((s) => s.schedule.id === scheduleId);
  const suggestTimes = (id: string, requestKind: 'OVERTIME' | 'LEAVE', selectedAt: Date) => {
    setScheduleId(id);
    const entry = availableSchedules.find((s) => s.schedule.id === id);
    if (!entry) {
      setStartsAt('');
      setEndsAt('');
      return;
    }
    if (requestKind === 'LEAVE') {
      setStartsAt(entry.startsAt);
      setEndsAt(entry.endsAt);
    } else {
      const end = requestTimeInstant(entry.endsAt, entry.shift.timezone);
      const start = new Date(Math.max(+end, Math.ceil((+selectedAt + 60000) / 60000) * 60000));
      setStartsAt(requestWallTime(start, entry.shift.timezone));
      setEndsAt(requestWallTime(new Date(+start + 3600000), entry.shift.timezone));
    }
    request.reset();
  };
  const timeRequests = useQuery({
    queryKey: [
      'attendance-time-requests',
      apiUrl,
      sessionScope,
      siteId,
      workerFilter,
      requestKind,
      requestStatus,
      requestOffset,
    ],
    queryFn: () =>
      client.attendanceTimeRequests(token, siteId, {
        kind: requestKind,
        ...(workerFilter ? { workerId: workerFilter } : {}),
        ...(requestStatus ? { status: requestStatus } : {}),
        offset: requestOffset,
        limit: 20,
      }),
    enabled: query.isSuccess,
    refetchInterval: 30000,
  });

  const submittedStatus = useQuery({
    queryKey: [
      'attendance-submitted-request',
      apiUrl,
      sessionScope,
      siteId,
      submittedRequest?.kind,
      submittedRequest?.id,
    ],
    enabled: !!submittedRequest && query.data?.canRequest === true,
    queryFn: async ({ signal }) => {
      const result = await loadAllPages(
        (page) =>
          client.attendanceTimeRequests(token, siteId, { ...page, kind: submittedRequest!.kind }),
        signal,
      );
      return result.items.find((r) => r.id === submittedRequest!.id) ?? null;
    },
    refetchInterval: 15000,
  });

  const invalidate = async () => {
    await cache.invalidateQueries({
      queryKey: ['attendance-submitted-request', apiUrl, sessionScope, siteId],
    });
    await Promise.all([
      cache.invalidateQueries({
        queryKey: ['attendance-time-requests', apiUrl, sessionScope, siteId],
      }),
      cache.invalidateQueries({ queryKey: ['attendance-days', apiUrl, sessionScope, siteId] }),
      cache.invalidateQueries({ queryKey: ['attendance', apiUrl, sessionScope, siteId] }),
      cache.invalidateQueries({ queryKey: ['notifications'] }),
      cache.invalidateQueries({
        queryKey: ['attendance-day-detail', apiUrl, sessionScope, siteId],
      }),
      cache.invalidateQueries({
        queryKey: ['attendance-timesheets', apiUrl, sessionScope, siteId],
      }),
      ...[
        'attendance-worker-context',
        'attendance-worker-today',
        'attendance-worker-month',
        'attendance-worker-attention',
      ].map((name) => cache.invalidateQueries({ queryKey: [name, apiUrl, sessionScope, siteId] })),
    ]);
  };

  const request = useMutation({
    mutationFn: async () => {
      if (!scheduleId || !startsAt || !endsAt || !reason.trim())
        throw new Error('Select a schedule, start, end and reason.');
      if (!selectedRequestSchedule || schedules.isError || requestShifts.isError)
        throw new Error('Select a current assigned shift.');
      const start = requestTimeInstant(startsAt, selectedRequestSchedule.shift.timezone);
      const end = requestTimeInstant(endsAt, selectedRequestSchedule.shift.timezone);
      const shiftStart = requestTimeInstant(
        selectedRequestSchedule.startsAt,
        selectedRequestSchedule.shift.timezone,
      );
      const shiftEnd = requestTimeInstant(
        selectedRequestSchedule.endsAt,
        selectedRequestSchedule.shift.timezone,
      );
      if (end <= start) throw new Error('End time must follow start time.');
      if (kind === 'OVERTIME' && (start <= new Date() || (start < shiftEnd && end > shiftStart)))
        throw new Error('Overtime must start in the future, outside regular shift hours.');
      if (
        kind === 'OVERTIME' &&
        startsAt.slice(0, 10) !==
          attendanceDate(
            start >= shiftEnd ? shiftEnd : shiftStart,
            selectedRequestSchedule.shift.timezone,
          )
      )
        throw new Error('Overtime must start on the assigned shift day.');
      if (kind === 'LEAVE' && (start < shiftStart || end > shiftEnd))
        throw new Error('Leave must be within the assigned shift.');
      const input = {
        workerScheduleId: scheduleId,
        kind,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        reason: reason.trim(),
      };
      const fingerprint = JSON.stringify(input);
      if (requestId.current?.fingerprint !== fingerprint)
        requestId.current = { fingerprint, id: crypto.randomUUID() };
      const result = await client.requestAttendanceTime(token, siteId, {
        ...input,
        requestId: requestId.current.id,
      });
      return { ...result, kind: input.kind };
    },
    onSuccess: async (result) => {
      setSubmittedRequest({ id: result.id, kind: result.kind });
      requestId.current = null;
      setReason('');
      await invalidate();
    },
  });

  const review = useMutation({
    mutationFn: ({
      r,
      approve,
      reason,
    }: {
      r: AttendanceTimeRequestResponse;
      approve: boolean;
      reason?: string;
    }) =>
      client.reviewAttendanceTime(token, siteId, r.id, r.kind, {
        approve,
        ...(!approve ? { reviewNote: reason?.trim() ?? '' } : {}),
      }),
    onSuccess: async () => {
      setRejectingRequest('');
      setRejectionReason('');
      await invalidate();
    },
  });

  const confirm = useMutation({
    mutationFn: (day: AttendanceDayResponse) =>
      client.confirmAttendanceDay(token, siteId, day.id, {
        expectedVersion: detail.data?.day?.version ?? day.version,
        reviewNote: reviewNote.trim(),
      }),
    onSuccess: invalidate,
  });

  const ignoreDuplicate = useMutation({
    mutationFn: (session: AttendanceSessionResponse) =>
      client.ignoreDuplicateAttendance(token, siteId, session.id, {
        expectedSessionVersion: session.version,
        reason: reviewNote.trim(),
      }),
    onSuccess: invalidate,
  });

  const handleRefresh = () =>
    void Promise.all([
      query.refetch(),
      timesheets.refetch(),
      timeRequests.refetch(),
      ...(query.data?.canRequest ? [schedules.refetch(), requestShifts.refetch()] : []),
      ...(query.data?.canReview ? [workers.refetch()] : []),
      ...(detailId ? [detail.refetch()] : []),
      ...(submittedRequest ? [submittedStatus.refetch()] : []),
      cache.invalidateQueries({ queryKey: ['attendance', apiUrl, sessionScope, siteId] }),
      ...[
        'attendance-worker-context',
        'attendance-worker-today',
        'attendance-worker-month',
        'attendance-worker-attention',
      ].map((name) => cache.invalidateQueries({ queryKey: [name, apiUrl, sessionScope, siteId] })),
    ]);

  if (query.isPending)
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-6 text-xs text-slate-500">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#F66B17] border-t-transparent" />
        <span>Loading daily attendance…</span>
      </div>
    );

  if (query.error)
    return (
      <div
        role="alert"
        className="flex items-center justify-between rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700"
      >
        <span>{query.error.message}</span>
        <button
          onClick={() => void query.refetch()}
          className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 transition-colors"
        >
          <IconRefresh className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );

  const data = query.data;
  if (!data) return null;

  const activeDay = detail.data?.day ?? selected;

  return (
    <section className="space-y-5">
      {/* ── KPI METRICS CARDS ───────────────────────────────────── */}
      {!isWorker && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-50 text-[#F66B17] flex items-center justify-center shrink-0">
              <IconClock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Total Days
              </p>
              <p className="text-lg font-extrabold text-[#071A2B]">{data.total}</p>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <IconCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Confirmed · This page
              </p>
              <p className="text-lg font-extrabold text-[#071A2B]">
                {data.items.filter((d) => d.status === 'CONFIRMED').length}
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <IconAlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Needs Review · This page
              </p>
              <p className="text-lg font-extrabold text-[#071A2B]">
                {data.items.filter((d) => d.status === 'NEEDS_REVIEW').length}
              </p>
            </div>
          </div>
          {!isWorker && (
            <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <IconUsers className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Workers · This page
                </p>
                <p className="text-lg font-extrabold text-[#071A2B]">
                  {new Set(data.items.map((d) => d.workerId)).size}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {children}

      {/* ── MAIN ATTENDANCE TABLE ──────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-xs overflow-hidden">
        {/* Card Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-50 text-[#F66B17] flex items-center justify-center">
              <IconClock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#071A2B]">Daily Work Hours</h2>
              <p className="text-[11px] text-slate-400 font-medium">
                MF03 · Attendance & Timesheets
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isWorker && (
              <a
                href={`/access?siteId=${encodeURIComponent(siteId)}&tab=worker-enrollment`}
                className="flex items-center gap-1.5 rounded-lg bg-[#071A2B] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition-colors"
              >
                <IconUsers className="w-3.5 h-3.5 text-orange-400" />
                <span>+ Enrol Worker</span>
              </a>
            )}
            <button
              onClick={handleRefresh}
              title="Refresh"
              aria-label="Refresh"
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-all"
            >
              <IconRefresh className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="px-6 py-4 bg-slate-50/60 border-b border-slate-100">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label
                htmlFor="filter-from-date"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
              >
                From
              </label>
              <div className="relative">
                <IconCalendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  id="filter-from-date"
                  type="date"
                  className="pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#071A2B] focus:border-[#F66B17] focus:ring-2 focus:ring-orange-100 focus:outline-none"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    setOffset(0);
                  }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label
                htmlFor="filter-to-date"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
              >
                To
              </label>
              <div className="relative">
                <IconCalendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  id="filter-to-date"
                  type="date"
                  className="pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#071A2B] focus:border-[#F66B17] focus:ring-2 focus:ring-orange-100 focus:outline-none"
                  value={toDate}
                  onChange={(e) => {
                    setToDate(e.target.value);
                    setOffset(0);
                  }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label
                htmlFor="filter-status"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
              >
                Status
              </label>
              <div className="relative">
                <IconFilter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <select
                  id="filter-status"
                  className="pl-8 pr-8 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#071A2B] focus:border-[#F66B17] focus:ring-2 focus:ring-orange-100 focus:outline-none appearance-none cursor-pointer"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as AttendanceDayStatus | '');
                    setOffset(0);
                  }}
                >
                  <option value="">All Statuses</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="NEEDS_REVIEW">Needs Review</option>
                  <option value="CONFIRMED">Confirmed</option>
                </select>
              </div>
            </div>
            {data.canReview && (
              <div className="space-y-1">
                <label
                  htmlFor="filter-worker"
                  className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
                >
                  Worker
                </label>
                <div className="relative">
                  <IconUsers className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <select
                    id="filter-worker"
                    className="pl-8 pr-8 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#071A2B] focus:border-[#F66B17] focus:ring-2 focus:ring-orange-100 focus:outline-none appearance-none cursor-pointer"
                    value={workerFilter}
                    onChange={(e) => {
                      setWorkerFilter(e.target.value);
                      setOffset(0);
                      setRequestOffset(0);
                    }}
                  >
                    <option value="">All Workers</option>
                    {workers.data?.items.map((worker) => (
                      <option key={worker.id} value={worker.id}>
                        {worker.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Table */}
        {!data.items.length ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
              <IconCalendar className="w-5 h-5" />
            </div>
            <p className="text-sm font-semibold text-slate-500">No attendance days in this range</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100">
                  {(isWorker
                    ? ['Date', 'Shift', 'Recorded Hours', 'Confirmed Hours']
                    : [
                        'Worker / Date',
                        'Shift',
                        'Presence',
                        'Regular',
                        'Overtime',
                        'Provisional',
                        'Confirmed',
                        'Status',
                        '',
                      ]
                  ).map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.items.map((day) => {
                  const isSelected = selected?.id === day.id;
                  return (
                    <tr
                      key={day.id}
                      className={`transition-colors ${isSelected ? 'bg-orange-50/60' : 'hover:bg-slate-50/70'}`}
                    >
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          {!isWorker && (
                            <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[10px] font-bold shrink-0">
                              {day.workerName.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div>
                            {!isWorker && (
                              <p className="text-xs font-bold text-[#071A2B]">{day.workerName}</p>
                            )}
                            <p className="text-[11px] text-slate-400">{day.workDate}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-600 whitespace-nowrap">
                        {day.shiftName ?? <span className="text-slate-400 italic">Unassigned</span>}
                        {day.breakStartsAt && day.breakEndsAt && (
                          <p className="text-[11px] text-slate-500">
                            Unpaid break: {shiftTime(day.breakStartsAt, day.timezone)}–
                            {shiftTime(day.breakEndsAt, day.timezone)}
                          </p>
                        )}
                      </td>
                      {!isWorker && (
                        <>
                          <td className="px-4 py-3.5 text-xs font-semibold text-slate-700 whitespace-nowrap">
                            {day.presence === 'INSIDE' ? 'Open session' : 'No open session'}
                          </td>
                          <td className="px-4 py-3.5 text-xs font-mono text-slate-700 whitespace-nowrap">
                            {hours(day.regularMinutes)}
                          </td>
                          <td className="px-4 py-3.5 text-xs font-mono text-slate-700 whitespace-nowrap">
                            {hours(day.overtimeMinutes)}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3.5 text-xs font-mono text-slate-500 whitespace-nowrap">
                        {hours(day.provisionalMinutes)}
                      </td>
                      <td className="px-4 py-3.5 text-xs font-mono whitespace-nowrap">
                        {day.confirmedMinutes === null ? (
                          <span className="text-slate-400 italic">Awaiting confirmation</span>
                        ) : (
                          <span className="text-emerald-700">{hours(day.confirmedMinutes)}</span>
                        )}
                      </td>
                      {!isWorker && (
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="space-y-1">
                            <StatusBadge status={day.status} />
                            {day.anomalies.length > 0 && (
                              <p className="text-[10px] text-amber-600 font-medium">
                                {day.anomalies.map(attendanceLabel).join(', ')}
                              </p>
                            )}
                          </div>
                        </td>
                      )}
                      {!isWorker && (
                        <td className="px-4 py-3.5">
                          <button
                            aria-label="View"
                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                              isSelected
                                ? 'bg-[#F66B17] text-white'
                                : 'border border-slate-200 text-slate-600 hover:border-[#F66B17] hover:text-[#F66B17]'
                            }`}
                            onClick={() => {
                              if (isSelected) {
                                setSelected(null);
                                onSelectDay?.('');
                              } else {
                                setSelected(day);
                                onSelectDay?.(day.id);
                                setScheduleId(day.scheduleId ?? '');
                              }
                            }}
                          >
                            <IconEye className="w-3 h-3" />
                            {isSelected ? 'Hide' : 'View'}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-100 bg-slate-50/40">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 20))}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 disabled:opacity-40 hover:bg-white transition-colors"
          >
            <IconChevronLeft className="w-3.5 h-3.5" /> Previous
          </button>
          <span className="text-xs text-slate-500 font-medium">{data.total} days total</span>
          <button
            disabled={offset + 20 >= data.total}
            onClick={() => setOffset(offset + 20)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 disabled:opacity-40 hover:bg-white transition-colors"
          >
            Next <IconChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── DETAIL PANEL (shown only when a row is selected) ───── */}
      {activeDay && (
        <div className="rounded-2xl border border-[#F66B17]/30 bg-white shadow-xs overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-orange-50/40">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-orange-100 text-[#F66B17] flex items-center justify-center">
                <IconEye className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#071A2B]">
                  {activeDay.workerName}
                  <span className="ml-2 text-slate-400 font-normal">·</span>
                  <span className="ml-2 text-slate-500 font-semibold">{activeDay.workDate}</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  {activeDay.startsAt ? new Date(activeDay.startsAt).toLocaleString() : '—'}
                  {' → '}
                  {activeDay.endsAt ? new Date(activeDay.endsAt).toLocaleString() : '—'} (
                  {activeDay.timezone})
                </p>
                {activeDay.breakStartsAt && activeDay.breakEndsAt && (
                  <p className="text-xs text-slate-500">
                    Unpaid break: {shiftTime(activeDay.breakStartsAt, activeDay.timezone)}–
                    {shiftTime(activeDay.breakEndsAt, activeDay.timezone)}. Only time overlapping
                    presence is deducted.
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => {
                setSelected(null);
                onSelectDay?.('');
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-500 hover:border-slate-300 transition-colors"
            >
              <IconX className="w-3.5 h-3.5" /> Close
            </button>
          </div>

          <div className="p-6 space-y-5">
            {/* Schedule Changed Warning */}
            {activeDay.anomalies.includes('SCHEDULE_CHANGED') && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <IconAlertTriangle className="w-4 h-4 text-amber-600" />
                  <h4 className="text-sm font-bold text-amber-800">Resolve Changed Schedule</h4>
                </div>
                <p className="text-xs text-amber-800">Original shift used for attendance</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-amber-200 bg-white p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-1">
                      Original Shift
                    </p>
                    <p className="text-xs font-semibold text-slate-700">{activeDay.shiftName}</p>
                    <p className="text-[11px] text-slate-500">
                      {shiftTime(activeDay.startsAt, activeDay.timezone)} →{' '}
                      {shiftTime(activeDay.endsAt, activeDay.timezone)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Current Assigned Shift
                    </p>
                    {detail.data?.currentSchedule ? (
                      <>
                        <p className="text-xs font-semibold text-slate-700">
                          {detail.data.currentSchedule.shiftName}
                        </p>
                        {detail.data.currentSchedule.isActive === false && (
                          <p className="text-[11px] text-red-600 font-bold">Inactive schedule</p>
                        )}
                        <p className="text-[11px] text-slate-500">
                          {shiftTime(
                            detail.data.currentSchedule.startsAt,
                            detail.data.currentSchedule.timezone,
                          )}
                          {' → '}
                          {shiftTime(
                            detail.data.currentSchedule.endsAt,
                            detail.data.currentSchedule.timezone,
                          )}
                        </p>
                      </>
                    ) : detail.isPending ? (
                      <p className="text-[11px] text-slate-400">Loading…</p>
                    ) : (
                      <p className="text-[11px] text-slate-400">Unavailable</p>
                    )}
                  </div>
                </div>
                {data.canReview && (
                  <a
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#F66B17] hover:underline"
                    href={`/workforce?siteId=${encodeURIComponent(siteId)}&tab=schedule`}
                  >
                    Open workforce schedule <IconChevronRight className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}

            {/* Work Intervals */}
            <div className="space-y-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Work Intervals
              </h4>
              {detail.isPending && (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#F66B17] border-t-transparent" />
                  Loading intervals…
                </div>
              )}
              {detail.data?.sessions.some((s) => s.status === 'MISSING_IN') && (
                <div className="flex items-start justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-start gap-2">
                    <IconAlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-700">
                      Missing IN: request a correction with the actual entry time.
                    </p>
                  </div>
                  {isWorker && (
                    <a
                      href="#attendance-correction-form"
                      className="text-xs font-bold text-amber-800 underline hover:text-amber-900 shrink-0"
                    >
                      Request correction ↓
                    </a>
                  )}
                </div>
              )}
              {detail.data?.sessions.some((s) => s.effectiveInAt && !s.effectiveOutAt) && (
                <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <IconClock className="w-3.5 h-3.5 text-blue-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-blue-700">Open session · checkout not recorded</p>
                </div>
              )}
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                {detail.data?.sessions.map((s) => (
                  <div key={s.id} className="px-4 py-3 bg-white">
                    {s.status === 'IGNORED' || (s.status === 'NEEDS_REVIEW' && !s.effectiveInAt) ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-slate-600">
                            Duplicate IN:{' '}
                            {s.rawInAt ? new Date(s.rawInAt).toLocaleString() : 'Recorded entry'}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {s.status === 'IGNORED'
                              ? 'Ignored — no work hours added'
                              : 'Needs representative review'}
                          </p>
                          {s.ignoreReason && (
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              Reason: {s.ignoreReason}
                            </p>
                          )}
                        </div>
                        <StatusBadge status={s.status} />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-slate-700">
                            {s.effectiveInAt
                              ? new Date(s.effectiveInAt).toLocaleString()
                              : 'Missing entry'}
                            {' → '}
                            {s.effectiveOutAt
                              ? new Date(s.effectiveOutAt).toLocaleString()
                              : 'Awaiting checkout'}
                          </p>
                          {s.effectiveInAt && !s.effectiveOutAt && (
                            <p className="text-[11px] text-blue-600">
                              Open session · checkout not recorded
                            </p>
                          )}
                          {!s.effectiveInAt && s.status !== 'IGNORED' && (
                            <p className="text-[11px] text-amber-600">
                              Incomplete evidence · hours not counted
                            </p>
                          )}
                        </div>
                        <StatusBadge status={s.status} />
                      </div>
                    )}
                    {s.canIgnoreDuplicate && (
                      <button
                        className="mt-2 flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:border-[#F66B17] hover:text-[#F66B17] transition-colors disabled:opacity-50"
                        disabled={ignoreDuplicate.isPending || reviewNote.trim().length < 5}
                        onClick={() => ignoreDuplicate.mutate(s)}
                      >
                        Ignore duplicate IN
                      </button>
                    )}
                  </div>
                ))}
                {detail.isSuccess && !detail.data?.sessions.length && (
                  <div className="px-4 py-6 text-center text-xs text-slate-400">
                    No work intervals recorded.
                  </div>
                )}
              </div>
            </div>

            {/* Review note & Confirm early departure */}
            {(() => {
              const canConfirmEarly =
                data.canReview &&
                activeDay.anomalies.includes('EARLY_CHECKOUT') &&
                !activeDay.anomalies.includes('SCHEDULE_CHANGED');
              const hasDuplicateToIgnore =
                data.canReview &&
                (detail.data?.sessions.some((s) => s.canIgnoreDuplicate) ?? false);
              const hasActionableReview = canConfirmEarly || hasDuplicateToIgnore;

              if (!data.canReview || !hasActionableReview) return null;

              return (
                <div className="space-y-3 pt-2">
                  <div className="space-y-1">
                    <label
                      htmlFor="review-note-input"
                      className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
                    >
                      Review note
                    </label>
                    <input
                      id="review-note-input"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-[#071A2B] focus:border-[#F66B17] focus:ring-2 focus:ring-orange-100 focus:outline-none"
                      maxLength={1000}
                      placeholder="Add a note for your review decision…"
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                    />
                  </div>

                  {canConfirmEarly && (
                    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs text-slate-600">
                        Confirm actual hours for early departure?
                      </p>
                      <button
                        disabled={confirm.isPending || !reviewNote.trim()}
                        onClick={() => confirm.mutate(activeDay)}
                        aria-label="Confirm actual hours for early departure"
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50 hover:bg-emerald-700 transition-colors"
                      >
                        <IconCheck className="w-3.5 h-3.5" /> Confirm actual hours for early departure
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── REQUEST OVERTIME / LEAVE ─────────────────────────── */}
      {data.canRequest && submittedRequest && (
        <section
          className="rounded-2xl border border-emerald-200 bg-white p-6 space-y-3"
          aria-label="Submitted request"
        >
          <h3 className="font-bold text-[#071A2B]">Request submitted.</h3>
          <p className="text-sm text-slate-600">
            Your {submittedRequest.kind === 'OVERTIME' ? 'overtime' : 'leave'} request was sent to
            your contractor representative.
          </p>
          <div aria-live="polite">
            {submittedStatus.isPending ? (
              <p>Loading request status…</p>
            ) : submittedStatus.isError || !submittedStatus.data ? (
              <div role="alert">
                Status unavailable.{' '}
                <button className="underline" onClick={() => void submittedStatus.refetch()}>
                  Retry request status
                </button>
              </div>
            ) : (
              <>
                <StatusBadge status={submittedStatus.data.status} />
                <p className="mt-2 text-sm">
                  {new Date(submittedStatus.data.startsAt).toLocaleString('en-GB', {
                    hour12: false,
                  })}{' '}
                  →{' '}
                  {new Date(submittedStatus.data.endsAt).toLocaleString('en-GB', { hour12: false })}
                </p>
                <p className="text-sm text-slate-600">{submittedStatus.data.reason}</p>
                {submittedStatus.data.reviewNote && (
                  <p className="text-sm">Review: {submittedStatus.data.reviewNote}</p>
                )}
                {['PENDING', 'PENDING_MANAGER'].includes(submittedStatus.data.status) && (
                  <p className="mt-2 text-sm text-amber-700">
                    Waiting for your contractor representative to review this request.
                  </p>
                )}
              </>
            )}
          </div>
          <button
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold"
            onClick={() => {
              setSubmittedRequest(null);
              request.reset();
            }}
          >
            New request
          </button>
        </section>
      )}
      {data.canRequest && !submittedRequest ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="text-sm font-bold text-[#071A2B]">Request Overtime or Leave</h3>
          </div>
          {(schedules.isPending || requestShifts.isPending) && (
            <p role="status" className="p-6">
              Loading assigned shifts…
            </p>
          )}
          {(schedules.isError || requestShifts.isError) && (
            <div role="alert" className="p-6">
              Assigned shifts unavailable.{' '}
              <button
                onClick={() => {
                  void schedules.refetch();
                  void requestShifts.refetch();
                }}
              >
                Retry assigned shifts
              </button>
            </div>
          )}
          {schedules.isSuccess && requestShifts.isSuccess && !availableSchedules.length && (
            <p className="p-6">
              No current or upcoming assigned shifts. Contact your contractor representative.
            </p>
          )}
          {availableSchedules.length > 0 && !schedules.isError && !requestShifts.isError && (
            <form
              className="p-6 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                request.mutate();
              }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label
                    htmlFor="assigned-shift"
                    className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
                  >
                    Assigned shift
                  </label>
                  <select
                    id="assigned-shift"
                    required
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#071A2B] focus:border-[#F66B17] focus:outline-none"
                    value={selectedRequestSchedule ? scheduleId : ''}
                    onChange={(e) => suggestTimes(e.target.value, kind, new Date())}
                  >
                    <option value="">Select shift</option>
                    {availableSchedules.map(({ schedule, shift, startsAt, endsAt }) => (
                      <option key={schedule.id} value={schedule.id}>
                        {schedule.workDate} · {shift.name} · {startsAt.slice(11)}–{endsAt.slice(11)}{' '}
                        ({shift.timezone})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="request-kind"
                    className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
                  >
                    Request Type
                  </label>
                  <select
                    id="request-kind"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#071A2B] focus:border-[#F66B17] focus:outline-none"
                    value={kind}
                    onChange={(e) => {
                      const next = e.target.value as 'OVERTIME' | 'LEAVE';
                      setKind(next);
                      suggestTimes(scheduleId, next, new Date());
                    }}
                  >
                    <option value="OVERTIME">Overtime</option>
                    <option value="LEAVE">Leave (whole or partial shift)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="request-start"
                    className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
                  >
                    Start Date & Time
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <IconCalendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                      <input
                        id="request-start-date"
                        aria-label="Start date"
                        type="date"
                        required
                        className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#071A2B] focus:border-[#F66B17] focus:outline-none"
                        value={startsAt.slice(0, 10)}
                        onChange={(e) =>
                          setStartsAt(`${e.target.value}T${startsAt.split('T')[1] ?? ''}`)
                        }
                      />
                    </div>
                    <div className="relative flex-1">
                      <IconClock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                      <input
                        id="request-start"
                        aria-label="Start time"
                        type="time"
                        required
                        className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#071A2B] focus:border-[#F66B17] focus:outline-none"
                        value={startsAt.split('T')[1] ?? ''}
                        onChange={(e) => setStartsAt(`${startsAt.slice(0, 10)}T${e.target.value}`)}
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="request-end"
                    className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
                  >
                    End Date & Time
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <IconCalendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                      <input
                        id="request-end-date"
                        aria-label="End date"
                        type="date"
                        required
                        className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#071A2B] focus:border-[#F66B17] focus:outline-none"
                        value={endsAt.slice(0, 10)}
                        onChange={(e) =>
                          setEndsAt(`${e.target.value}T${endsAt.split('T')[1] ?? ''}`)
                        }
                      />
                    </div>
                    <div className="relative flex-1">
                      <IconClock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                      <input
                        id="request-end"
                        aria-label="End time"
                        type="time"
                        required
                        className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#071A2B] focus:border-[#F66B17] focus:outline-none"
                        value={endsAt.split('T')[1] ?? ''}
                        onChange={(e) => setEndsAt(`${endsAt.slice(0, 10)}T${e.target.value}`)}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label
                    htmlFor="request-reason"
                    className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
                  >
                    Reason
                  </label>
                  <input
                    id="request-reason"
                    required
                    minLength={5}
                    maxLength={1000}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-[#071A2B] focus:border-[#F66B17] focus:outline-none"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  aria-label="Submit request"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#071A2B] text-white text-xs font-bold disabled:opacity-50 hover:bg-slate-800 transition-colors"
                  disabled={request.isPending || !selectedRequestSchedule}
                >
                  Submit request
                </button>
                {request.isSuccess && (
                  <span className="flex items-center gap-1 text-xs text-emerald-700 font-semibold">
                    <IconCheck className="w-3.5 h-3.5" /> Request submitted.
                  </span>
                )}
              </div>
              {request.error && (
                <p role="alert" className="text-xs text-red-600">
                  {request.error.message}
                </p>
              )}
            </form>
          )}
        </div>
      ) : null}

      {/* ── TIME REQUESTS QUEUE ─────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-[#071A2B]">Time Requests</h3>
          <div className="flex items-center gap-2">
            <label htmlFor="queue-kind" className="sr-only">
              Queue type
            </label>
            <select
              id="queue-kind"
              aria-label="Queue type"
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#071A2B] focus:outline-none"
              value={requestKind}
              onChange={(e) => {
                setRequestKind(e.target.value as 'OVERTIME' | 'LEAVE');
                setRequestOffset(0);
              }}
            >
              <option value="OVERTIME">Overtime</option>
              <option value="LEAVE">Leave</option>
            </select>
            <label htmlFor="queue-status" className="sr-only">
              Request status
            </label>
            <select
              id="queue-status"
              aria-label="Request status"
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#071A2B] focus:outline-none"
              value={requestStatus}
              onChange={(e) => {
                setRequestStatus(e.target.value as typeof requestStatus);
                setRequestOffset(0);
              }}
            >
              <option value="">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>
        </div>

        <div className="divide-y divide-slate-50">
          {timeRequests.isPending && (
            <div className="flex items-center gap-2 p-5 text-xs text-slate-400">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#F66B17] border-t-transparent" />
              Loading time requests…
            </div>
          )}
          {timeRequests.error && (
            <div
              role="alert"
              className="flex items-center justify-between p-5 text-xs text-red-600"
            >
              <span>{timeRequests.error.message}</span>
              <button
                aria-label="Retry time requests"
                onClick={() => void timeRequests.refetch()}
                className="font-bold underline"
              >
                Retry time requests
              </button>
            </div>
          )}
          {timeRequests.data?.items.length === 0 && (
            <div className="px-6 py-8 text-center text-xs text-slate-400">No time requests.</div>
          )}
          {!timeRequests.isError &&
            timeRequests.data?.items.map((r) => (
              <div key={`${r.kind}:${r.id}`} className="px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-[#071A2B]">{r.workerName}</span>
                      <StatusBadge status={r.status} />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {r.kind}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {new Date(r.startsAt).toLocaleString()} →{' '}
                      {new Date(r.endsAt).toLocaleString()}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{r.reason}</p>
                    {r.reviewNote && (
                      <p className="text-[11px] text-emerald-700 mt-0.5">Review: {r.reviewNote}</p>
                    )}
                  </div>
                  {data.canReview && ['PENDING', 'PENDING_MANAGER'].includes(r.status) && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        disabled={review.isPending}
                        onClick={() => review.mutate({ r, approve: true })}
                        title="Approve this request"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50 hover:bg-emerald-700 transition-colors"
                      >
                        <IconCheck className="w-3 h-3" /> Approve
                      </button>
                      <button
                        disabled={review.isPending}
                        onClick={() => {
                          setRejectingRequest(`${r.kind}:${r.id}`);
                          setRejectionReason('');
                        }}
                        title="Enter a reason to reject this request"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-bold disabled:opacity-50 hover:bg-red-50 transition-colors"
                      >
                        <IconX className="w-3 h-3" /> Reject
                      </button>
                    </div>
                  )}
                </div>
                {data.canReview &&
                  ['PENDING', 'PENDING_MANAGER'].includes(r.status) &&
                  rejectingRequest === `${r.kind}:${r.id}` && (
                    <form
                      className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 space-y-3"
                      aria-label="Reject request"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (rejectionReason.trim())
                          review.mutate({ r, approve: false, reason: rejectionReason });
                      }}
                    >
                      <label
                        htmlFor={`rejection-${r.id}`}
                        className="block text-sm font-semibold text-red-800"
                      >
                        Reason for rejection
                      </label>
                      <textarea
                        id={`rejection-${r.id}`}
                        required
                        maxLength={1000}
                        value={rejectionReason}
                        onChange={(event) => setRejectionReason(event.target.value)}
                        className="w-full rounded-lg border border-red-200 bg-white p-3 text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={review.isPending || !rejectionReason.trim()}
                          className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          Confirm rejection
                        </button>
                        <button
                          type="button"
                          disabled={review.isPending}
                          onClick={() => {
                            setRejectingRequest('');
                            setRejectionReason('');
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        >
                          Cancel rejection
                        </button>
                      </div>
                    </form>
                  )}
              </div>
            ))}
        </div>

        {(timeRequests.data?.total ?? 0) > 0 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100 bg-slate-50/40">
            <button
              aria-label="Previous requests"
              disabled={timeRequests.isFetching || requestOffset === 0}
              onClick={() => setRequestOffset(Math.max(0, requestOffset - 20))}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 disabled:opacity-40 hover:bg-white transition-colors"
            >
              <IconChevronLeft className="w-3.5 h-3.5" /> Previous
            </button>
            <span className="text-xs text-slate-500">{timeRequests.data?.total ?? 0} requests</span>
            <button
              aria-label="Next requests"
              disabled={
                timeRequests.isFetching ||
                !timeRequests.data ||
                requestOffset + 20 >= timeRequests.data.total
              }
              onClick={() => setRequestOffset(requestOffset + 20)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 disabled:opacity-40 hover:bg-white transition-colors"
            >
              Next <IconChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ── CONFIRMED TIMESHEET ──────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-[#071A2B]">
            Confirmed Timesheet · Selected Date Range
          </h3>
        </div>
        <div className="divide-y divide-slate-50">
          {timesheets.isPending && (
            <div className="p-5 text-xs text-slate-400">Loading timesheet…</div>
          )}
          {timesheets.isError && (
            <div role="alert" className="p-5 text-sm text-red-700">
              Timesheet unavailable.{' '}
              <button onClick={() => void timesheets.refetch()}>Retry timesheet</button>
            </div>
          )}
          {timesheets.isSuccess && timesheets.data.items.length === 0 && (
            <div className="p-5 text-xs text-slate-400">No confirmed hours in this range.</div>
          )}
          {timesheets.data?.items?.map((row) => (
            <div key={row.workerId} className="flex items-center justify-between px-6 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[10px] font-bold">
                  {row.workerName.slice(0, 2).toUpperCase()}
                </div>
                <span className="text-xs font-bold text-[#071A2B]">{row.workerName}</span>
                <span className="text-[11px] text-slate-400">
                  {row.confirmedDays} confirmed days
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono">
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">Regular</p>
                  <p className="font-semibold text-slate-700">{hours(row.regularMinutes)}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">Overtime</p>
                  <p className="font-semibold text-slate-700">{hours(row.overtimeMinutes)}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">Total</p>
                  <p className="font-bold text-[#071A2B]">{hours(row.totalMinutes)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Error messages */}
      {[
        review.error,
        confirm.error,
        ignoreDuplicate.error,
        schedules.error,
        workers.error,
        detail.error,
        timesheets.error,
      ]
        .filter(Boolean)
        .map((error, i) => (
          <p role="alert" key={i} className="text-xs text-red-600 font-semibold px-1">
            {error!.message}
          </p>
        ))}
    </section>
  );
}
