import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
export function AttendanceView({
  apiUrl,
  token,
  siteId,
  sessionScope,
}: {
  apiUrl: string;
  token: string;
  siteId: string;
  sessionScope: string;
}) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const cache = useQueryClient();
  const key = ['attendance', apiUrl, sessionScope, siteId];
  const overview = useQuery({
    queryKey: key,
    queryFn: () => client.attendanceOverview(token, siteId),
  });
  const [sessionId, setSessionId] = useState('');
  const [proposedIn, setProposedIn] = useState('');
  const [proposedOut, setProposedOut] = useState('');
  const [reason, setReason] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const correction = useMutation({
    mutationFn: () => {
      const session = overview.data?.sessions.find((s) => s.id === sessionId);
      if (!session) throw new Error('Select a current attendance session.');
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
      void cache.invalidateQueries({ queryKey: key });
    },
  });
  const review = useMutation({
    mutationFn: (input: { id: string; approve: boolean }) =>
      client.reviewAttendanceCorrection(token, siteId, input.id, {
        approve: input.approve,
        reviewNote: reviewNote.trim(),
      }),
    onSuccess: () => cache.invalidateQueries({ queryKey: key }),
  });
  if (overview.isPending) return <p role="status">Loading attendance…</p>;
  if (overview.error)
    return (
      <div role="alert">
        {overview.error.message} <button onClick={() => void overview.refetch()}>Retry</button>
      </div>
    );
  const data = overview.data;
  if (!data) return null;
  return (
    <section className="space-y-4 rounded-2xl border bg-white p-6">
      <h2 className="text-lg font-bold">Recent attendance</h2>
      <p className="text-sm text-slate-600">
        Attendance comes from explicit work check-in/out actions. Temporary gate passages keep the
        work session open. Corrections change effective times and preserve the original events.
      </p>
      {!data.sessions.length && <p className="text-sm text-slate-500">No attendance sessions.</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="p-2">Worker</th>
              <th className="p-2">In</th>
              <th className="p-2">Out</th>
              <th className="p-2">Status</th>
              <th className="p-2">Minutes</th>
            </tr>
          </thead>
          <tbody>
            {data.sessions.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-2">{s.workerName}</td>
                <td className="p-2">
                  {s.effectiveInAt ? new Date(s.effectiveInAt).toLocaleString() : 'Missing'}
                </td>
                <td className="p-2">
                  {s.effectiveOutAt
                    ? new Date(s.effectiveOutAt).toLocaleString()
                    : 'Open / missing'}
                </td>
                <td className="p-2">{s.status}</td>
                <td className="p-2">{s.workedMinutes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.canRequestCorrection && (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="font-semibold">Request an attendance correction</h3>
          <label className="block text-xs">
            Session
            <select
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="mt-1 block w-full rounded border p-2"
            >
              <option value="">Select session</option>
              {data.sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.workerName} ·{' '}
                  {s.effectiveInAt
                    ? new Date(s.effectiveInAt).toLocaleString()
                    : s.effectiveOutAt
                      ? new Date(s.effectiveOutAt).toLocaleString()
                      : s.status}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            Proposed in
            <input
              className="mt-1 block rounded border p-2"
              type="datetime-local"
              value={proposedIn}
              onChange={(e) => setProposedIn(e.target.value)}
            />
          </label>
          <label className="block text-xs">
            Proposed out
            <input
              className="mt-1 block rounded border p-2"
              type="datetime-local"
              value={proposedOut}
              onChange={(e) => setProposedOut(e.target.value)}
            />
          </label>
          <label className="block text-xs">
            Reason
            <input
              className="mt-1 block w-full rounded border p-2"
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            className="rounded border px-3 py-2 text-sm disabled:opacity-50"
            disabled={
              correction.isPending || !sessionId || !proposedIn || !proposedOut || !reason.trim()
            }
            onClick={() => correction.mutate()}
          >
            Send to Contractor Representative
          </button>
          {correction.error && <p role="alert">{correction.error.message}</p>}
          {correction.isSuccess && <p role="status">Correction requested.</p>}
        </div>
      )}
      {!!data.corrections.length && (
        <div className="space-y-3">
          <h3 className="font-semibold">Correction requests</h3>
          {data.canReviewCorrection && (
            <label className="block text-xs">
              Review reason
              <input
                className="mt-1 block w-full rounded border p-2"
                value={reviewNote}
                maxLength={1000}
                onChange={(e) => setReviewNote(e.target.value)}
              />
            </label>
          )}
          {data.corrections.map((c) => (
            <div key={c.id} className="rounded border p-3 text-sm">
              <p>
                {c.workerName} · {c.status} · {c.reason}
              </p>
              <p>
                {new Date(c.proposedInAt).toLocaleString()} –{' '}
                {new Date(c.proposedOutAt).toLocaleString()}
              </p>
              {c.reviewNote && <p>{c.reviewNote}</p>}
              {data.canReviewCorrection && c.status === 'PENDING' && (
                <div className="mt-2 flex gap-2">
                  <button
                    disabled={review.isPending || !reviewNote.trim()}
                    onClick={() => review.mutate({ id: c.id, approve: true })}
                    className="rounded border px-3 py-1 disabled:opacity-50"
                  >
                    Approve correction
                  </button>
                  <button
                    disabled={review.isPending || !reviewNote.trim()}
                    onClick={() => review.mutate({ id: c.id, approve: false })}
                    className="rounded border px-3 py-1 disabled:opacity-50"
                  >
                    Reject correction
                  </button>
                </div>
              )}
            </div>
          ))}
          {review.error && <p role="alert">{review.error.message}</p>}
        </div>
      )}
    </section>
  );
}
