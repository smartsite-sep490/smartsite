import { localizedError } from '../../../i18n/messages';
import { localizedLabel } from '../../../i18n/labels';
import { uiLocale } from '../../../i18n';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { AttendanceDaysView } from './AttendanceDaysView';
import { WorkerAttendanceSummary } from './WorkerAttendanceSummary';
import { attendanceLabel } from './attendance-display';
import { SmartDatePicker, SmartTimePicker } from '../../ui';
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
  const key = ['attendance', apiUrl, sessionScope, siteId];
  const [selectedDayId, setSelectedDayId] = useState(
    () => new URLSearchParams(window.location.search).get('dayId') ?? '',
  );
  const overview = useQuery({
    queryKey: [...key, selectedDayId],
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
  const invalidate = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: key }),
      cache.invalidateQueries({ queryKey: ['attendance-days', apiUrl, sessionScope, siteId] }),
      cache.invalidateQueries({
        queryKey: ['attendance-day-detail', apiUrl, sessionScope, siteId],
      }),
      cache.invalidateQueries({
        queryKey: ['attendance-timesheets', apiUrl, sessionScope, siteId],
      }),
      cache.invalidateQueries({ queryKey: ['notifications'] }),
    ]);
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
      return invalidate();
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
      return invalidate();
    },
  });
  if (!isWorker && overview.isPending)
    return <p role="status">{tr('common.loading_attendance')}</p>;
  if (!isWorker && overview.error)
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
  if (!data && !isWorker) return null;

  const daysView = (
    <AttendanceDaysView
      apiUrl={apiUrl}
      token={token}
      siteId={siteId}
      sessionScope={sessionScope}
      selectedDayId={selectedDayId}
      onSelectDay={setSelectedDayId}
      isWorker={isWorker}
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
          <h2 className="text-sm font-bold text-[#071A2B]">{tr('common.recent_attendance')}</h2>
          {selectedDayId && (
            <p className="text-xs text-slate-500 mt-0.5">
              {tr('attendance_view.showing_session_intervals_for_selected_day')}{' '}
              <button
                onClick={() => setSelectedDayId('')}
                className="font-bold text-[#F66B17] hover:underline"
              >
                {tr('common.show_recent_sessions')}
              </button>
            </p>
          )}
        </div>
      </div>

      {!data.sessions.length && (
        <p className="text-xs text-slate-400 py-4 text-center">
          {tr('attendance_view.no_attendance_sessions_recorded')}
        </p>
      )}

      {!!data.sessions.length && (
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
                  className="mt-1.5 block w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-semibold text-[#071A2B] hover:border-slate-300 focus:border-[#071A2B] focus:bg-white focus:ring-4 focus:ring-[#071A2B]/5 shadow-sm outline-none transition-all duration-300"
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
                                : s.status}
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

      {!!data.corrections.length && (
        <div className="space-y-3 pt-2">
          <h3 className="text-xs font-bold text-[#071A2B] uppercase tracking-wider">
            {tr('common.correction_requests')}
          </h3>
          {data.corrections.map((c) => (
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

  if (isWorker) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[#071A2B]">
            {tr('common.my_work_hours')}
          </h2>
        </div>
        {daysView}
        {correctionSection}
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
