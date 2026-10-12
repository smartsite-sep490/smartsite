import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { AttendanceDaysView } from './AttendanceDaysView';
import { WorkerAttendanceSummary } from './WorkerAttendanceSummary';
import { attendanceLabel } from './attendance-display';
import { SmartDatePicker } from '../../ui';
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
  const [date, setDate] = useState(initialValue.slice(0, 10) || defaultDate);
  const [hour, setHour] = useState(initialValue.slice(11, 13));
  const [minute, setMinute] = useState(initialValue.slice(14, 16) || '00');
  const update = (nextDate: string, nextHour: string, nextMinute: string) => {
    setDate(nextDate);
    setHour(nextHour);
    setMinute(nextMinute);
    onChange(nextDate && nextHour && nextMinute ? `${nextDate}T${nextHour}:${nextMinute}:00` : '');
  };
  const timeClass =
    'min-h-11 w-full rounded-xl bg-white px-3 text-sm font-semibold tabular-nums text-[#071A2B] ring-1 ring-slate-200/80 outline-none focus:ring-2 focus:ring-[#F66B17]';
  return (
    <fieldset className="min-w-0 rounded-2xl bg-white/80 p-4 ring-1 ring-slate-200/70 space-y-3">
      <legend className="px-1 text-xs font-bold text-[#071A2B]">{label}</legend>
      <SmartDatePicker
        label={`${label} date`}
        value={date}
        disablePast={false}
        onChange={(value) => update(value, hour, minute)}
      />
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <label className="space-y-1 text-[11px] font-semibold text-slate-500">
          <span className="block">Hour · 00–23</span>
          <select
            aria-label={`${label} hour`}
            className={timeClass}
            value={hour}
            onChange={(e) => update(date, e.target.value, minute)}
          >
            <option value="">Hour</option>
            {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <span aria-hidden="true" className="pb-3 text-lg text-slate-400">
          :
        </span>
        <label className="space-y-1 text-[11px] font-semibold text-slate-500">
          <span className="block">Minute</span>
          <select
            aria-label={`${label} minute`}
            className={timeClass}
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
      if (!session) throw new Error('Select a current attendance session.');
      if (
        overview.data?.hasPendingCorrection ||
        overview.data?.corrections.some((c) => c.status === 'PENDING')
      )
        throw new Error('Wait for the contractor to review your pending attendance correction.');
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
  if (!isWorker && overview.isPending) return <p role="status">Loading attendance…</p>;
  if (!isWorker && overview.error)
    return (
      <div role="alert">
        {overview.error.message} <button onClick={() => void overview.refetch()}>Retry</button>
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
          <h2 className="text-sm font-bold text-[#071A2B]">Recent attendance</h2>
          {selectedDayId && (
            <p className="text-xs text-slate-500 mt-0.5">
              Showing session intervals for selected day.{' '}
              <button
                onClick={() => setSelectedDayId('')}
                className="font-bold text-[#F66B17] hover:underline"
              >
                Show recent sessions
              </button>
            </p>
          )}
        </div>
      </div>

      {!data.sessions.length && (
        <p className="text-xs text-slate-400 py-4 text-center">No attendance sessions recorded.</p>
      )}

      {!!data.sessions.length && (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50/70 border-b border-slate-100">
                <th className="p-3 font-bold uppercase tracking-wider text-slate-400 text-[10px]">
                  Worker
                </th>
                <th className="p-3 font-bold uppercase tracking-wider text-slate-400 text-[10px]">
                  In
                </th>
                <th className="p-3 font-bold uppercase tracking-wider text-slate-400 text-[10px]">
                  Out
                </th>
                <th className="p-3 font-bold uppercase tracking-wider text-slate-400 text-[10px]">
                  Status
                </th>
                <th className="p-3 font-bold uppercase tracking-wider text-slate-400 text-[10px]">
                  Minutes
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.sessions.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-3 font-bold text-[#071A2B]">{s.workerName}</td>
                  <td className="p-3 text-slate-600">
                    {s.effectiveInAt
                      ? new Date(s.effectiveInAt).toLocaleString()
                      : s.status === 'NEEDS_REVIEW' || s.status === 'IGNORED'
                        ? 'Duplicate IN · see day detail'
                        : 'Missing'}
                  </td>
                  <td className="p-3 text-slate-600">
                    {s.status === 'NEEDS_REVIEW' || s.status === 'IGNORED'
                      ? '—'
                      : s.effectiveOutAt
                        ? new Date(s.effectiveOutAt).toLocaleString()
                        : 'Open / missing'}
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
            Request an attendance correction
          </h3>
          {hasPendingCorrection && (
            <p role="status" className="text-xs text-amber-700">
              Your attendance correction is awaiting contractor review. You can submit another
              request after it is approved or rejected.
            </p>
          )}
          <fieldset disabled={hasPendingCorrection || correction.isPending} className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 sm:col-span-2">
                Session
                <select
                  value={sessionId}
                  onChange={(e) => {
                    setSessionId(e.target.value);
                    const selected = data.sessions.find((session) => session.id === e.target.value);
                    setProposedIn(localDateTime(selected?.effectiveInAt));
                    setProposedOut(localDateTime(selected?.effectiveOutAt));
                  }}
                  className="mt-1 block w-full rounded-lg border border-slate-200 bg-white p-2 text-xs font-semibold text-[#071A2B] focus:border-[#F66B17] focus:ring-2 focus:ring-orange-100 focus:outline-none"
                >
                  <option value="">Select session</option>
                  {data.sessions.map(
                    (s) =>
                      s.status !== 'IGNORED' &&
                      s.status !== 'NEEDS_REVIEW' && (
                        <option key={s.id} value={s.id}>
                          {s.workerName} ·{' '}
                          {s.status === 'MISSING_IN' && s.effectiveOutAt
                            ? `Exit ${new Date(s.effectiveOutAt).toLocaleString()} (${attendanceLabel(s.status)})`
                            : s.effectiveInAt
                              ? `${new Date(s.effectiveInAt).toLocaleString()}${!s.effectiveOutAt ? ` (${attendanceLabel('MISSING_OUT')})` : ''}`
                              : s.effectiveOutAt
                                ? new Date(s.effectiveOutAt).toLocaleString()
                                : s.status}
                        </option>
                      ),
                  )}
                </select>
              </label>
              <CorrectionTimeField
                key={`${sessionId}-in`}
                label="Proposed in"
                initialValue={proposedIn}
                defaultDate={correctionDate}
                onChange={setProposedIn}
              />
              <CorrectionTimeField
                key={`${sessionId}-out`}
                label="Proposed out"
                initialValue={proposedOut}
                defaultDate={correctionDate}
                onChange={setProposedOut}
              />
            </div>
            <p className="text-xs text-slate-500">
              24-hour time · 08:00 = 8 AM · 17:00 = 5 PM. Timezone:{' '}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}.
            </p>
            {data.sessions.find((s) => s.id === sessionId)?.status === 'MISSING_IN' && (
              <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                Enter the actual entry time. The recorded exit is prefilled and stays unchanged
                unless you explicitly edit it.
              </p>
            )}
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Reason
              <input
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-[#071A2B] focus:border-[#F66B17] focus:ring-2 focus:ring-orange-100 focus:outline-none"
                value={reason}
                maxLength={1000}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button
              className="rounded-xl bg-[#071A2B] text-white px-4 py-2 text-xs font-bold disabled:opacity-50 hover:bg-slate-800 transition-colors"
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
              Send to Contractor Representative
            </button>
          </fieldset>
          {correction.error && (
            <p role="alert" className="text-xs text-red-600 font-semibold">
              {correction.error.message}
            </p>
          )}
          {correction.isSuccess && (
            <p role="status" className="text-xs text-emerald-700 font-semibold">
              Correction requested.
            </p>
          )}
        </div>
      )}

      {!!data.corrections.length && (
        <div className="space-y-3 pt-2">
          <h3 className="text-xs font-bold text-[#071A2B] uppercase tracking-wider">
            Correction requests
          </h3>
          {data.corrections.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#071A2B]">{c.workerName}</span>
                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-bold text-slate-600 uppercase">
                  {c.status}
                </span>
              </div>
              <p className="text-slate-600">{c.reason}</p>
              {data.canReviewCorrection && (
                <p className="text-slate-600">
                  Recorded interval:{' '}
                  {(() => {
                    const session = data.sessions.find((s) => s.id === c.attendanceSessionId);
                    return `${session?.effectiveInAt ? new Date(session.effectiveInAt).toLocaleString() : 'Missing check-in'} – ${session?.effectiveOutAt ? new Date(session.effectiveOutAt).toLocaleString() : 'Missing checkout'}`;
                  })()}
                </p>
              )}
              <p className="text-[11px] text-slate-400">
                Proposed interval: {new Date(c.proposedInAt).toLocaleString()} –{' '}
                {new Date(c.proposedOutAt).toLocaleString()}
              </p>
              {c.reviewNote && (
                <p className="text-[11px] text-emerald-700 font-medium">
                  Review note: {c.reviewNote}
                </p>
              )}
              {data.canReviewCorrection && c.status === 'PENDING' && (
                <div className="mt-2.5 flex gap-2">
                  <button
                    disabled={review.isPending}
                    onClick={() => review.mutate({ id: c.id, approve: true })}
                    className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-bold disabled:opacity-50 hover:bg-emerald-700 transition-colors"
                  >
                    Approve correction
                  </button>
                  <button
                    disabled={review.isPending}
                    onClick={() => {
                      setRejectingId(c.id);
                      setReviewNote('');
                    }}
                    className="rounded-lg border border-red-200 text-red-600 px-3 py-1.5 text-xs font-bold disabled:opacity-50 hover:bg-red-50 transition-colors"
                  >
                    Reject correction
                  </button>
                </div>
              )}
              {data.canReviewCorrection && c.status === 'PENDING' && rejectingId === c.id && (
                <div className="space-y-2 pt-2">
                  <label className="block">
                    Rejection reason
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
                    Confirm rejection
                  </button>
                  <button
                    disabled={review.isPending}
                    onClick={() => {
                      setRejectingId(null);
                      setReviewNote('');
                    }}
                  >
                    Cancel rejection
                  </button>
                </div>
              )}
            </div>
          ))}
          {review.error && (
            <p role="alert" className="text-xs text-red-600 font-semibold">
              {review.error.message}
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
          <h2 className="text-2xl font-bold tracking-tight text-[#071A2B]">My Work Hours</h2>
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
