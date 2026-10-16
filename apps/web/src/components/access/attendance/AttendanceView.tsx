import { localizedError } from '../../../i18n/messages';
import { localizedLabel } from '../../../i18n/labels';
import { uiLocale } from '../../../i18n';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import { useMemo, useRef, useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { AttendanceDaysView } from './AttendanceDaysView';
import { WorkerAttendanceSummary } from './WorkerAttendanceSummary';
import { attendanceDate, attendanceLabel } from './attendance-display';
import { AttendanceSummaryCards } from './AttendanceSummaryCards';
import { AttendanceWorkersTable } from './AttendanceWorkersTable';
import { WorkerAttendanceDetailPanel } from './WorkerAttendanceDetailPanel';
import { SmartDatePicker, SmartTimePicker, Tabs } from '../../ui';
import {
  IconSearch,
  IconRefresh,
  IconExport,
  IconCalendar,
  IconClock,
} from '../../icons';
import type { AttendanceReportStatus } from '@smartsite/contracts';

function localDateTime(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, -1);
}

function CorrectionTimeField({
  label,
  initialValue,
  defaultDate,
  onChange,
}: {
  label: string;
  initialValue: string;
  defaultDate: string;
  onChange: (value: string) => void;
}) {
  useTranslation();

  const [date, setDate] = useState(initialValue.slice(0, 10) || defaultDate);
  const [hour, setHour] = useState(initialValue.slice(11, 13));
  const [minute, setMinute] = useState(initialValue.slice(14, 16) || '00');
  const update = (nextDate: string, nextHour: string, nextMinute: string) => {
    setDate(nextDate);
    setHour(nextHour);
    setMinute(nextMinute);
    onChange(nextDate && nextHour && nextMinute ? `${nextDate}T${nextHour}:${nextMinute}:00` : '');
  };

  const timeValue = hour ? `${hour}:${minute || '00'}` : '';

  return (
    <fieldset className="min-w-0 rounded-2xl bg-white/80 p-4 ring-1 ring-slate-200/70 space-y-3">
      <legend className="px-1 text-xs font-bold text-[#071A2B]">{label}</legend>
      <SmartDatePicker
        label={tr('common.value_date', { value1: label })}
        value={date}
        disablePast={false}
        onChange={(value) => update(value, hour, minute)}
      />
      <SmartTimePicker
        label={tr('common.value_time', { value1: label })}
        value={timeValue}
        minuteStep={1}
        placeholder={tr('common.select_time')}
        onChange={(val) => {
          if (!val) {
            update(date, '', '');
            return;
          }
          const [h = '', m = '00'] = val.split(':');
          update(date, h, m);
        }}
      />
      {/* Accessible fallback controls for testing & screen readers */}
      <div className="sr-only">
        <label>
          <span>{tr('common.value_hour', { value1: label })}</span>
          <select
            aria-label={tr('common.value_hour', { value1: label })}
            value={hour}
            onChange={(e) => update(date, e.target.value, minute)}
          >
            <option value="">{tr('common.hour')}</option>
            {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{tr('common.value_minute', { value1: label })}</span>
          <select
            aria-label={tr('common.value_minute', { value1: label })}
            value={minute}
            onChange={(e) => update(date, hour, e.target.value)}
          >
            {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  );
}

export function AttendanceView({
  apiUrl,
  token,
  siteId,
  sessionScope,
  isWorker,
}: {
  apiUrl: string;
  token: string;
  siteId: string;
  sessionScope: string;
  isWorker?: boolean;
}) {
  useTranslation();

  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const cache = useQueryClient();
  const timezone = 'Asia/Ho_Chi_Minh';

  // Compute 7-day range (e.g. today minus 6 days to today, or current week)
  const defaultDates = useMemo(() => {
    const todayStr = attendanceDate(new Date(), timezone);
    const todayMs = Date.parse(`${todayStr}T00:00:00Z`);
    const fromStr = new Date(todayMs - 6 * 86400000).toISOString().slice(0, 10);
    return { fromDate: fromStr, toDate: todayStr };
  }, [timezone]);

  const [fromDate, setFromDate] = useState(defaultDates.fromDate);
  const [toDate, setToDate] = useState(defaultDates.toDate);
  const [contractorId] = useState<string | undefined>(undefined);
  const [shiftId, setShiftId] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<AttendanceReportStatus | ''>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const pageSize = 20;

  // Selected worker for detail panel view
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);

  // Correction drawer / review state (MF03 compatibility)
  const [selectedDayId, setSelectedDayId] = useState(
    () => new URLSearchParams(window.location.search).get('dayId') ?? '',
  );
  const [showWorkflowSection, setShowWorkflowSection] = useState(() => Boolean(selectedDayId));
  const [correctionTab, setCorrectionTab] = useState<'pending' | 'history'>('pending');
  const [activeSubTab, setActiveSubTab] = useState<'timesheet' | 'requests'>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('subtab') === 'requests') return 'requests';
      if (window.location.hash === '#attendance-correction-form') return 'requests';
    }
    return 'timesheet';
  });
  const [isExporting, setIsExporting] = useState(false);

  const handleSelectSubTab = (tab: 'timesheet' | 'requests') => {
    setActiveSubTab(tab);
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      const url = new URL(window.location.href);
      if (tab === 'requests') {
        url.searchParams.set('subtab', 'requests');
      } else {
        url.searchParams.delete('subtab');
      }
      window.history.replaceState({}, '', url.toString());
    }
  };

  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === '#attendance-correction-form') {
        setActiveSubTab('requests');
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset pagination offset whenever filter criteria change
  const [prevFilterKey, setPrevFilterKey] = useState(
    `${fromDate}:${toDate}:${shiftId ?? ''}:${statusFilter}:${siteId}`,
  );
  const currentFilterKey = `${fromDate}:${toDate}:${shiftId ?? ''}:${statusFilter}:${siteId}`;
  if (prevFilterKey !== currentFilterKey) {
    setPrevFilterKey(currentFilterKey);
    setOffset(0);
  }

  // Week navigation helpers
  const handlePreviousWeek = () => {
    const currentFromMs = Date.parse(`${fromDate}T00:00:00Z`);
    const currentToMs = Date.parse(`${toDate}T00:00:00Z`);
    const diffMs = currentToMs - currentFromMs + 86400000;
    const newFrom = new Date(currentFromMs - diffMs).toISOString().slice(0, 10);
    const newTo = new Date(currentToMs - diffMs).toISOString().slice(0, 10);
    setFromDate(newFrom);
    setToDate(newTo);
  };

  const handleNextWeek = () => {
    const currentFromMs = Date.parse(`${fromDate}T00:00:00Z`);
    const currentToMs = Date.parse(`${toDate}T00:00:00Z`);
    const diffMs = currentToMs - currentFromMs + 86400000;
    const newFrom = new Date(currentFromMs + diffMs).toISOString().slice(0, 10);
    const newTo = new Date(currentToMs + diffMs).toISOString().slice(0, 10);
    setFromDate(newFrom);
    setToDate(newTo);
  };

  // Query: Shifts for filter selector
  const shiftsQuery = useQuery({
    queryKey: ['attendance-shifts-filter', apiUrl, sessionScope, siteId],
    queryFn: () => client.listShifts(token, siteId),
    staleTime: 60000,
  });

  // Query: Summary (Header KPI cards)
  const summaryQueryKey = [
    'attendance-summary',
    apiUrl,
    sessionScope,
    siteId,
    fromDate,
    toDate,
    timezone,
    contractorId,
    shiftId,
    debouncedSearch,
    statusFilter || undefined,
  ];

  const hasReportsApi = typeof client.attendanceSummary === 'function';

  const summary = useQuery({
    queryKey: summaryQueryKey,
    enabled: hasReportsApi,
    queryFn: () =>
      client.attendanceSummary(token, siteId, {
        fromDate,
        toDate,
        timezone,
        ...(contractorId ? { contractorId } : {}),
        ...(shiftId ? { shiftId } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(statusFilter ? { todayStatus: statusFilter } : {}),
      }),
    refetchInterval: 30000,
  });

  // Query: Workers Table
  const workersQueryKey = [
    'attendance-workers',
    apiUrl,
    sessionScope,
    siteId,
    fromDate,
    toDate,
    timezone,
    contractorId,
    shiftId,
    debouncedSearch,
    statusFilter || undefined,
    offset,
    pageSize,
  ];

  const workers = useQuery({
    queryKey: workersQueryKey,
    enabled: hasReportsApi,
    queryFn: () =>
      client.attendanceWorkers(token, siteId, {
        fromDate,
        toDate,
        timezone,
        ...(contractorId ? { contractorId } : {}),
        ...(shiftId ? { shiftId } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(statusFilter ? { todayStatus: statusFilter } : {}),
        offset,
        limit: pageSize,
      }),
    refetchInterval: 30000,
  });

  // Invalidation & Refresh
  const invalidateAll = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: ['attendance', apiUrl, sessionScope, siteId] }),
      cache.invalidateQueries({ queryKey: ['attendance-summary', apiUrl, sessionScope, siteId] }),
      cache.invalidateQueries({ queryKey: ['attendance-workers', apiUrl, sessionScope, siteId] }),
      cache.invalidateQueries({
        queryKey: ['attendance-worker-report', apiUrl, sessionScope, siteId],
      }),
      cache.invalidateQueries({ queryKey: ['attendance-days', apiUrl, sessionScope, siteId] }),
      cache.invalidateQueries({
        queryKey: ['attendance-day-detail', apiUrl, sessionScope, siteId],
      }),
      cache.invalidateQueries({
        queryKey: ['attendance-timesheets', apiUrl, sessionScope, siteId],
      }),
      cache.invalidateQueries({ queryKey: ['notifications'] }),
    ]);

  // Export CSV handler: exports all pages within current scope
  const handleExportCsv = async () => {
    try {
      setIsExporting(true);
      const allWorkers: Array<import('@smartsite/contracts').AttendanceWorkerReport> = [];
      let currentOffset = 0;
      const fetchLimit = 100;
      let totalToFetch = 1;

      while (currentOffset < totalToFetch) {
        const pageRes = await client.attendanceWorkers(token, siteId, {
          fromDate,
          toDate,
          timezone,
          ...(contractorId ? { contractorId } : {}),
          ...(shiftId ? { shiftId } : {}),
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(statusFilter ? { todayStatus: statusFilter } : {}),
          offset: currentOffset,
          limit: fetchLimit,
        });
        totalToFetch = pageRes.total;
        allWorkers.push(...pageRes.items);
        if (!pageRes.items.length) break;
        currentOffset += pageRes.items.length;
      }

      // Generate CSV content
      const headers = [
        'Worker Code',
        'Worker Name',
        'Today Status',
        'Total Minutes',
        'Regular Minutes',
        'Overtime Minutes',
        'Provisional Minutes',
        'Days Present',
        'Days Required',
        'Attendance Rate (%)',
      ];

      const rows = allWorkers.map((w) => [
        `"${w.workerCode.replace(/"/g, '""')}"`,
        `"${w.workerName.replace(/"/g, '""')}"`,
        `"${w.todayStatus}"`,
        w.totalMinutes,
        w.regularMinutes,
        w.overtimeMinutes,
        w.provisionalMinutes,
        w.presentDays,
        w.requiredDays,
        w.attendanceRate !== null ? w.attendanceRate : '',
      ]);

      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `attendance-${siteId}-${fromDate}-${toDate}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  // Legacy correction overview query for review workflow
  const overviewKey = ['attendance', apiUrl, sessionScope, siteId];
  const overview = useQuery({
    queryKey: [...overviewKey, selectedDayId],
    queryFn: async () =>
      (await client.attendanceOverview(
        token,
        siteId,
        selectedDayId ? { dayId: selectedDayId } : {},
      )) ?? null,
    refetchInterval: 30000,
  });

  const [sessionId, setSessionId] = useState('');
  const [proposedIn, setProposedIn] = useState('');
  const [proposedOut, setProposedOut] = useState('');
  const [reason, setReason] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);

  const correction = useMutation({
    mutationFn: () => {
      const session = overview.data?.sessions.find((s) => s.id === sessionId);
      if (!session) throw new Error(tr('attendance_view.select_a_current_attendance_session'));
      if (
        overview.data?.hasPendingCorrection ||
        overview.data?.corrections.some((c) => c.status === 'PENDING')
      )
        throw new Error(
          tr(
            'attendance_view.wait_for_the_contractor_to_review_your_pending_attendance_correction',
          ),
        );
      const input = {
        expectedSessionVersion: session.version,
        proposedInAt: new Date(proposedIn).toISOString(),
        proposedOutAt: new Date(proposedOut).toISOString(),
        reason: reason.trim(),
      };
      const fingerprint = JSON.stringify([sessionId, input]);
      if (request.current?.fingerprint !== fingerprint)
        request.current = { fingerprint, id: crypto.randomUUID() };
      return client.requestAttendanceCorrection(token, siteId, session.id, {
        requestId: request.current.id,
        ...input,
      });
    },
    onSuccess: () => {
      request.current = null;
      return invalidateAll();
    },
  });

  const review = useMutation({
    mutationFn: (input: { id: string; approve: boolean }) =>
      client.reviewAttendanceCorrection(token, siteId, input.id, {
        approve: input.approve,
        ...(!input.approve ? { reviewNote: reviewNote.trim() } : {}),
      }),
    onSuccess: () => {
      setRejectingId(null);
      setReviewNote('');
      return invalidateAll();
    },
  });

  if (!hasReportsApi && !isWorker && overview.isPending)
    return <p role="status">{tr('common.loading_attendance')}</p>;
  if (!hasReportsApi && !isWorker && overview.error)
    return (
      <div role="alert">
        {localizedError(overview.error.message)}{' '}
        <button onClick={() => void overview.refetch()}>{tr('common.retry')}</button>
      </div>
    );

  const data = overview.data;
  const correctionSession = data?.sessions.find((s) => s.id === sessionId);
  const correctionDate = localDateTime(
    correctionSession?.effectiveInAt ??
      correctionSession?.effectiveOutAt ??
      new Date().toISOString(),
  ).slice(0, 10);
  const hasPendingCorrection = Boolean(
    data?.hasPendingCorrection || data?.corrections.some((c) => c.status === 'PENDING'),
  );
  const managementReports = hasReportsApi && !isWorker;
  const pendingCorrections = data?.corrections.filter((c) => c.status === 'PENDING') ?? [];
  const visibleCorrections = managementReports
    ? (data?.corrections.filter((c) =>
        correctionTab === 'pending' ? c.status === 'PENDING' : c.status !== 'PENDING',
      ) ?? [])
    : (data?.corrections ?? []);

  const daysView = (
    <AttendanceDaysView
      apiUrl={apiUrl}
      token={token}
      siteId={siteId}
      sessionScope={sessionScope}
      selectedDayId={selectedDayId}
      onSelectDay={setSelectedDayId}
      isWorker={isWorker}
      activeSubTab={activeSubTab}
    >
      {isWorker && (
        <WorkerAttendanceSummary
          apiUrl={apiUrl}
          token={token}
          siteId={siteId}
          sessionScope={sessionScope}
          selectedDayId={selectedDayId}
        />
      )}
    </AttendanceDaysView>
  );

  const correctionSection = data ? (
    <section
      id="attendance-correction-form"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5 overflow-hidden"
    >
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div>
          <h2 className="text-sm font-bold text-[#071A2B]">
            {tr(
              data.canReviewCorrection ? 'common.correction_requests' : 'common.recent_attendance',
            )}
          </h2>
          {selectedDayId && (
            <p className="text-xs text-slate-500 mt-0.5">
              {tr('attendance_view.showing_session_intervals_for_selected_day')}{' '}
              <button
                onClick={() => setSelectedDayId('')}
                className="font-bold text-[#F66B17] hover:underline cursor-pointer"
              >
                {tr('common.show_recent_sessions')}
              </button>
            </p>
          )}
        </div>
      </div>

      {!managementReports && !data.sessions.length && (
        <p className="text-xs text-slate-400 py-4 text-center">
          {tr('attendance_view.no_attendance_sessions_recorded')}
        </p>
      )}

      {!managementReports && !!data.sessions.length && (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50/70 border-b border-slate-100">
                <th className="p-3 font-bold uppercase tracking-wider text-slate-400 text-[10px]">
                  {tr('common.worker')}
                </th>
                <th className="p-3 font-bold uppercase tracking-wider text-slate-400 text-[10px]">
                  {tr('common.in')}
                </th>
                <th className="p-3 font-bold uppercase tracking-wider text-slate-400 text-[10px]">
                  {tr('common.out')}
                </th>
                <th className="p-3 font-bold uppercase tracking-wider text-slate-400 text-[10px]">
                  {tr('common.status')}
                </th>
                <th className="p-3 font-bold uppercase tracking-wider text-slate-400 text-[10px]">
                  {tr('common.minutes')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.sessions.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-3 font-bold text-[#071A2B]">{s.workerName}</td>
                  <td className="p-3 text-slate-600">
                    {s.effectiveInAt
                      ? new Date(s.effectiveInAt).toLocaleString(uiLocale())
                      : s.status === 'NEEDS_REVIEW' || s.status === 'IGNORED'
                        ? tr('attendance_view.duplicate_in_see_day_detail')
                        : tr('common.missing')}
                  </td>
                  <td className="p-3 text-slate-600">
                    {s.status === 'NEEDS_REVIEW' || s.status === 'IGNORED'
                      ? '—'
                      : s.effectiveOutAt
                        ? new Date(s.effectiveOutAt).toLocaleString(uiLocale())
                        : tr('common.open_missing')}
                  </td>
                  <td className="p-3 font-semibold text-slate-700">{attendanceLabel(s.status)}</td>
                  <td className="p-3 font-mono text-slate-700">{s.workedMinutes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.canRequestCorrection && (
        <div className="space-y-3.5 rounded-xl border border-slate-200 bg-slate-50/40 p-4">
          <h3 className="text-xs font-bold text-[#071A2B] uppercase tracking-wider">
            {tr('attendance_view.request_an_attendance_correction')}
          </h3>
          {hasPendingCorrection && (
            <p role="status" className="text-xs text-amber-700">
              {tr(
                'attendance_view.your_attendance_correction_is_awaiting_contractor_review_you_can_submit_another_re',
              )}
            </p>
          )}
          <fieldset disabled={hasPendingCorrection || correction.isPending} className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#607A96] sm:col-span-2">
                {tr('common.session')}
                <select
                  value={sessionId}
                  onChange={(e) => {
                    setSessionId(e.target.value);
                    const selected = data.sessions.find((session) => session.id === e.target.value);
                    setProposedIn(localDateTime(selected?.effectiveInAt));
                    setProposedOut(localDateTime(selected?.effectiveOutAt));
                  }}
                  className="mt-1.5 block w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-semibold text-[#071A2B] placeholder-slate-400 hover:border-slate-300 focus:border-[#071A2B] focus:bg-white focus:ring-4 focus:ring-[#071A2B]/5 shadow-sm outline-none transition-all duration-300"
                >
                  <option value="">{tr('common.select_session')}</option>
                  {data.sessions.map(
                    (s) =>
                      s.status !== 'IGNORED' &&
                      s.status !== 'NEEDS_REVIEW' && (
                        <option key={s.id} value={s.id}>
                          {s.workerName} ·{' '}
                          {s.status === 'MISSING_IN' && s.effectiveOutAt
                            ? tr('common.exit_value_value', {
                                value1: new Date(s.effectiveOutAt).toLocaleString(uiLocale()),
                                value2: attendanceLabel(s.status),
                              })
                            : s.effectiveInAt
                              ? `${new Date(s.effectiveInAt).toLocaleString(uiLocale())}${!s.effectiveOutAt ? ` (${attendanceLabel('MISSING_OUT')})` : ''}`
                              : s.effectiveOutAt
                                ? new Date(s.effectiveOutAt).toLocaleString(uiLocale())
                                : attendanceLabel(s.status)}
                        </option>
                      ),
                  )}
                </select>
              </label>
              <CorrectionTimeField
                key={`${sessionId}-in`}
                label={tr('common.proposed_in')}
                initialValue={proposedIn}
                defaultDate={correctionDate}
                onChange={setProposedIn}
              />
              <CorrectionTimeField
                key={`${sessionId}-out`}
                label={tr('common.proposed_out')}
                initialValue={proposedOut}
                defaultDate={correctionDate}
                onChange={setProposedOut}
              />
            </div>
            <p className="text-xs text-slate-500">
              {tr('common.timezone_value', {
                value1: Intl.DateTimeFormat().resolvedOptions().timeZone,
              })}
            </p>
            {data.sessions.find((s) => s.id === sessionId)?.status === 'MISSING_IN' && (
              <p className="text-xs text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200">
                {tr(
                  'attendance_view.enter_the_actual_entry_time_the_recorded_exit_is_prefilled_and_stays_unchanged_unl',
                )}
              </p>
            )}
            <label className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#607A96]">
              {tr('common.reason')}
              <input
                className="mt-1.5 block w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-semibold text-[#071A2B] placeholder-slate-400 hover:border-slate-300 focus:border-[#071A2B] focus:bg-white focus:ring-4 focus:ring-[#071A2B]/5 shadow-sm outline-none transition-all duration-300"
                value={reason}
                maxLength={1000}
                placeholder={tr('attendance_view.reason_for_attendance_correction_request')}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button
              className="rounded-2xl bg-[#071A2B] text-white px-5 py-3 text-xs font-bold disabled:opacity-50 hover:bg-[#0c2840] transition-colors shadow-sm cursor-pointer"
              disabled={
                hasPendingCorrection ||
                correction.isPending ||
                !sessionId ||
                !proposedIn ||
                !proposedOut ||
                !reason.trim()
              }
              onClick={() => correction.mutate()}
            >
              {tr('attendance_view.send_to_contractor_representative')}
            </button>
          </fieldset>
          {correction.error && (
            <p role="alert" className="text-xs text-red-600 font-semibold">
              {localizedError(correction.error.message)}
            </p>
          )}
          {correction.isSuccess && (
            <p role="status" className="text-xs text-emerald-700 font-semibold">
              {tr('common.correction_requested')}
            </p>
          )}
        </div>
      )}

      {managementReports && (
        <>
          {data.canReviewCorrection && pendingCorrections.length > 0 && (
            <p
              role="status"
              className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
            >
              {tr('attendance_view.pending_correction_notice', {
                count: pendingCorrections.length,
              })}
            </p>
          )}
          <Tabs
            items={[
              {
                id: 'pending',
                label: tr('common.pending_review'),
                count: pendingCorrections.length,
              },
              { id: 'history', label: tr('common.request_history') },
            ]}
            activeTab={correctionTab}
            onChange={setCorrectionTab}
          />
        </>
      )}
      {managementReports && !visibleCorrections.length && (
        <div
          role="status"
          className="rounded-2xl border border-slate-100 py-10 text-center text-sm text-slate-500"
        >
          {tr(
            correctionTab === 'pending'
              ? 'attendance_view.no_pending_corrections'
              : 'attendance_view.no_correction_history',
          )}
        </div>
      )}
      {!!visibleCorrections.length && (
        <div className="space-y-3 pt-2">
          {!managementReports && (
            <h3 className="text-xs font-bold text-[#071A2B] uppercase tracking-wider">
              {tr('common.correction_requests')}
            </h3>
          )}
          {visibleCorrections.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#071A2B]">{c.workerName}</span>
                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-bold text-slate-600 uppercase">
                  {localizedLabel(c.status)}
                </span>
              </div>
              <p className="text-slate-600">{c.reason}</p>
              {data.canReviewCorrection && (
                <p className="text-slate-600">
                  {tr('common.recorded_interval_value', {
                    value1: (() => {
                      const session = data.sessions.find((s) => s.id === c.attendanceSessionId);
                      return `${session?.effectiveInAt ? new Date(session.effectiveInAt).toLocaleString(uiLocale()) : tr('common.missing_check_in')} – ${session?.effectiveOutAt ? new Date(session.effectiveOutAt).toLocaleString(uiLocale()) : tr('common.missing_checkout')}`;
                    })(),
                  })}
                </p>
              )}
              <p className="text-[11px] text-slate-400">
                {tr('attendance_view.proposed_interval_value_value', {
                  value1: new Date(c.proposedInAt).toLocaleString(uiLocale()),
                  value2: new Date(c.proposedOutAt).toLocaleString(uiLocale()),
                })}
              </p>
              {c.reviewNote && (
                <p className="text-[11px] text-emerald-700 font-medium">
                  {tr('common.review_note_value', { value1: c.reviewNote })}
                </p>
              )}
              {data.canReviewCorrection && c.status === 'PENDING' && (
                <div className="mt-2.5 flex gap-2">
                  <button
                    disabled={review.isPending}
                    onClick={() => review.mutate({ id: c.id, approve: true })}
                    className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-bold disabled:opacity-50 hover:bg-emerald-700 transition-colors"
                  >
                    {tr('common.approve_correction')}
                  </button>
                  <button
                    disabled={review.isPending}
                    onClick={() => {
                      setRejectingId(c.id);
                      setReviewNote('');
                    }}
                    className="rounded-lg border border-red-200 text-red-600 px-3 py-1.5 text-xs font-bold disabled:opacity-50 hover:bg-red-50 transition-colors"
                  >
                    {tr('common.reject_correction')}
                  </button>
                </div>
              )}
              {data.canReviewCorrection && c.status === 'PENDING' && rejectingId === c.id && (
                <div className="space-y-2 pt-2">
                  <label className="block">
                    {tr('common.rejection_reason')}
                    <textarea
                      className="mt-1 block w-full rounded-lg border border-slate-200 p-2"
                      value={reviewNote}
                      maxLength={1000}
                      onChange={(e) => setReviewNote(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={review.isPending || !reviewNote.trim()}
                    onClick={() => review.mutate({ id: c.id, approve: false })}
                  >
                    {tr('common.confirm_rejection')}
                  </button>
                  <button
                    disabled={review.isPending}
                    onClick={() => {
                      setRejectingId(null);
                      setReviewNote('');
                    }}
                  >
                    {tr('common.cancel_rejection')}
                  </button>
                </div>
              )}
            </div>
          ))}
          {review.error && (
            <p role="alert" className="text-xs text-red-600 font-semibold">
              {localizedError(review.error.message)}
            </p>
          )}
        </div>
      )}
    </section>
  ) : null;

  if (isWorker || !hasReportsApi) {
    if (isWorker) {
      return (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200/60">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-[#071A2B]">
                {activeSubTab === 'requests'
                  ? tr('attendance_report.requests_title')
                  : tr('common.my_work_hours')}
              </h1>
              <p className="text-xs text-slate-500 font-medium mt-1">
                {activeSubTab === 'requests'
                  ? tr('attendance_report.requests_subtitle')
                  : tr('attendance_report.subtitle')}
              </p>
            </div>

            {/* Segmented Switcher for Worker */}
            <div className="inline-flex items-center p-1 rounded-2xl bg-slate-100/90 border border-slate-200/80 shadow-2xs gap-1">
              <button
                type="button"
                onClick={() => handleSelectSubTab('timesheet')}
                aria-pressed={activeSubTab === 'timesheet'}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
                  activeSubTab === 'timesheet'
                    ? 'bg-white text-[#071A2B] shadow-xs ring-1 ring-slate-200/60'
                    : 'text-slate-500 hover:text-[#071A2B] hover:bg-white/60'
                }`}
              >
                <IconCalendar className="w-3.5 h-3.5 text-slate-500" />
                <span>{tr('attendance_report.subtab_timesheet')}</span>
              </button>
              <button
                type="button"
                onClick={() => handleSelectSubTab('requests')}
                aria-pressed={activeSubTab === 'requests'}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
                  activeSubTab === 'requests'
                    ? 'bg-white text-[#071A2B] shadow-xs ring-1 ring-slate-200/60'
                    : 'text-slate-500 hover:text-[#071A2B] hover:bg-white/60'
                }`}
              >
                <IconClock className="w-3.5 h-3.5 text-[#F66B17]" />
                <span>{tr('attendance_report.subtab_requests')}</span>
                {hasPendingCorrection && <span className="w-2 h-2 rounded-full bg-[#F66B17]" />}
              </button>
            </div>
          </div>
          {daysView}
          <div className={activeSubTab === 'timesheet' ? 'hidden' : 'block mt-6'}>
            {correctionSection}
          </div>
        </div>
      );
    }
    if (!data) return null;
    return (
      <>
        {daysView}
        {correctionSection}
      </>
    );
  }

  // Management / Contractor Representative attendance interface
  return (
    <div className="space-y-6">
      {/* Top Main Heading & Sub-Nav */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200/60">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-[#071A2B]">
              {activeSubTab === 'requests'
                ? tr('attendance_report.requests_title')
                : tr('attendance_report.title')}
            </h1>
            <p className="text-xs text-slate-500 font-medium mt-1">
              {activeSubTab === 'requests'
                ? tr('attendance_report.requests_subtitle')
                : tr('attendance_report.subtitle')}
            </p>
          </div>

          {/* Segmented Switcher for Manager */}
          <div className="inline-flex items-center p-1 rounded-2xl bg-slate-100/90 border border-slate-200/80 shadow-2xs gap-1 ml-0 sm:ml-4">
            <button
              type="button"
              onClick={() => handleSelectSubTab('timesheet')}
              aria-pressed={activeSubTab === 'timesheet'}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
                activeSubTab === 'timesheet'
                  ? 'bg-white text-[#071A2B] shadow-xs ring-1 ring-slate-200/60'
                  : 'text-slate-500 hover:text-[#071A2B] hover:bg-white/60'
              }`}
            >
              <IconCalendar className="w-3.5 h-3.5 text-slate-500" />
              <span>{tr('attendance_report.subtab_timesheet')}</span>
            </button>
            <button
              type="button"
              onClick={() => handleSelectSubTab('requests')}
              aria-pressed={activeSubTab === 'requests'}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
                activeSubTab === 'requests'
                  ? 'bg-white text-[#071A2B] shadow-xs ring-1 ring-slate-200/60'
                  : 'text-slate-500 hover:text-[#071A2B] hover:bg-white/60'
              }`}
            >
              <IconClock className="w-3.5 h-3.5 text-[#F66B17]" />
              <span>{tr('attendance_report.subtab_requests')}</span>
              {pendingCorrections.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[10px] font-black bg-[#F66B17] text-white shadow-2xs">
                  {pendingCorrections.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2.5">
          {data?.canReviewCorrection && pendingCorrections.length > 0 && (
            <a
              href="#attendance-correction-form"
              onClick={() => {
                handleSelectSubTab('requests');
                setCorrectionTab('pending');
              }}
              className="rounded-xl border border-orange-200 bg-orange-50 px-3.5 py-2 text-xs font-bold text-orange-800 hover:bg-orange-100 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {tr('common.correction_requests')} ({pendingCorrections.length})
            </a>
          )}
          <button
            onClick={() => void invalidateAll()}
            title={tr('common.refresh')}
            aria-label={tr('common.refresh')}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs cursor-pointer"
          >
            <IconRefresh className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{tr('common.refresh')}</span>
          </button>
        </div>
      </div>

      {/* ── TIMESHEET TAB VIEW ── */}
      <div className={activeSubTab === 'requests' ? 'hidden' : 'space-y-6'}>
        {/* 4 Summary Cards (Total Workers, Total Working Hours, Absent Today, Overtime Hours) */}
        <AttendanceSummaryCards summary={summary.data} isLoading={summary.isPending} />

        {summary.error && (
          <div
            role="alert"
            className="flex items-center justify-between p-4 rounded-2xl border border-red-200 bg-red-50 text-xs text-red-700"
          >
            <span>{localizedError(summary.error.message)}</span>
            <button
              onClick={() => void summary.refetch()}
              className="font-bold underline hover:no-underline"
            >
              {tr('attendance_report.retry')}
            </button>
          </div>
        )}

        {/* Conditional View: Worker Detail Panel vs Worker Roster List */}
        {selectedWorkerId ? (
          <WorkerAttendanceDetailPanel
            apiUrl={apiUrl}
            token={token}
            siteId={siteId}
            sessionScope={sessionScope}
            workerId={selectedWorkerId}
            fromDate={fromDate}
            toDate={toDate}
            timezone={timezone}
            onBack={() => {
              setSelectedWorkerId(null);
              setSelectedDayId('');
              setShowWorkflowSection(false);
            }}
            onSelectDayForCorrection={(dayId) => {
              setSelectedDayId(dayId);
              setShowWorkflowSection(true);
            }}
            onPreviousWeek={handlePreviousWeek}
            onNextWeek={handleNextWeek}
          />
        ) : (
          <div className="space-y-4">
            {/* Filter Bar (Search, Status, Shifts, Date Range, Export) */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl border border-slate-200/80 bg-white shadow-xs">
              {/* Search Input */}
              <div className="relative flex-1 min-w-[240px] max-w-sm">
                <IconSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={tr('attendance_report.search_placeholder')}
                  className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50/50 text-xs font-semibold text-[#071A2B] placeholder:text-slate-400 focus:bg-white focus:border-[#F66B17] focus:ring-2 focus:ring-orange-100 focus:outline-none transition-all"
                />
              </div>

              {/* Selectors Group */}
              <div className="flex flex-wrap items-center gap-2.5">
                {/* Status Select */}
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as AttendanceReportStatus | '')}
                  aria-label={tr('attendance_report.today_status')}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:border-slate-300 focus:border-[#F66B17] focus:ring-2 focus:ring-orange-100 focus:outline-none cursor-pointer shadow-2xs"
                >
                  <option value="">{tr('attendance_report.all_status')}</option>
                  <option value="PRESENT">{localizedLabel('PRESENT')}</option>
                  <option value="ABSENT">{localizedLabel('ABSENT')}</option>
                  <option value="NEEDS_REVIEW">{localizedLabel('NEEDS_REVIEW')}</option>
                  <option value="SCHEDULED">{localizedLabel('SCHEDULED')}</option>
                  <option value="NOT_ARRIVED">{localizedLabel('NOT_ARRIVED')}</option>
                  <option value="OFF">{localizedLabel('OFF')}</option>
                  <option value="APPROVED_LEAVE">{localizedLabel('APPROVED_LEAVE')}</option>
                  <option value="UNAVAILABLE">{localizedLabel('UNAVAILABLE')}</option>
                </select>

                {/* Shifts Select */}
                <select
                  value={shiftId ?? ''}
                  onChange={(e) => setShiftId(e.target.value || undefined)}
                  aria-label={tr('attendance_report.all_shifts')}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:border-slate-300 focus:border-[#F66B17] focus:ring-2 focus:ring-orange-100 focus:outline-none cursor-pointer shadow-2xs"
                >
                  <option value="">{tr('attendance_report.all_shifts')}</option>
                  {shiftsQuery.data?.items.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>

                {/* Date Controls */}
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white shadow-2xs">
                  <IconCalendar className="w-4 h-4 text-slate-400" />
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="text-xs font-semibold text-slate-700 outline-none bg-transparent cursor-pointer"
                    aria-label={tr('common.from')}
                  />
                  <span className="text-slate-400 text-xs">–</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="text-xs font-semibold text-slate-700 outline-none bg-transparent cursor-pointer"
                    aria-label={tr('common.to')}
                  />
                </div>

                {/* Export Button */}
                <button
                  onClick={handleExportCsv}
                  disabled={isExporting}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
                >
                  <IconExport className="w-3.5 h-3.5 text-slate-500" />
                  <span>
                    {isExporting
                      ? tr('attendance_report.exporting')
                      : tr('attendance_report.export')}
                  </span>
                </button>
              </div>
            </div>

            {/* Workers Table Component */}
            <AttendanceWorkersTable
              workers={workers.data?.items ?? []}
              total={workers.data?.total ?? 0}
              offset={offset}
              limit={pageSize}
              isLoading={workers.isPending}
              timezone={timezone}
              onSelectWorker={(id) => {
                setSelectedWorkerId(id);
                setSelectedDayId('');
                setShowWorkflowSection(false);
              }}
              onPageChange={setOffset}
            />
          </div>
        )}

        {/* Additional day-level review and timesheet controls */}
        {(selectedWorkerId || selectedDayId) && (
          <div className="pt-4 border-t border-slate-200/60">
            <button
              aria-expanded={showWorkflowSection}
              aria-controls="attendance-day-workflow"
              onClick={() => setShowWorkflowSection((prev) => !prev)}
              className="text-xs font-bold text-slate-500 hover:text-[#071A2B] transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span>
                {showWorkflowSection ? '▲' : '▼'} {tr('attendance_report.attendance_records')} &{' '}
                {tr('attendance_report.manage_workflow')}
              </span>
            </button>

            {showWorkflowSection && (
              <div
                id="attendance-day-workflow"
                className="mt-4 space-y-6 animate-in fade-in duration-200"
              >
                <AttendanceDaysView
                  key={selectedWorkerId ?? selectedDayId}
                  apiUrl={apiUrl}
                  token={token}
                  siteId={siteId}
                  sessionScope={sessionScope}
                  selectedDayId={selectedDayId}
                  onSelectDay={setSelectedDayId}
                  isWorker={isWorker}
                  workerId={selectedWorkerId ?? undefined}
                  activeSubTab="timesheet"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── REQUESTS TAB VIEW ── */}
      <div className={activeSubTab === 'timesheet' ? 'hidden' : 'space-y-6'}>
        {overview.isPending && <p role="status">{tr('common.loading_attendance')}</p>}
        {overview.error && (
          <div role="alert">
            {localizedError(overview.error.message)}{' '}
            <button onClick={() => void overview.refetch()}>{tr('common.retry')}</button>
          </div>
        )}

        {/* Section 1: Overtime & Leave (Review & Queue) */}
        {activeSubTab === 'requests' && (
          <AttendanceDaysView
            apiUrl={apiUrl}
            token={token}
            siteId={siteId}
            sessionScope={sessionScope}
            selectedDayId={selectedDayId}
            onSelectDay={setSelectedDayId}
            isWorker={isWorker}
            activeSubTab="requests"
          />
        )}

        {/* Section 2: Attendance Corrections (Review & Queue) */}
        {correctionSection}
      </div>
    </div>
  );
}
