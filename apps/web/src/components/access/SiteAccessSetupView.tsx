import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { AttendanceView } from './AttendanceView';

function localTime(offset: number) {
  const date = new Date(Date.now() + offset);
  return new Date(+date - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
export function SiteAccessSetupView({
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
  const key = ['access-control', apiUrl, sessionScope, siteId, 'access-setup'];
  const setup = useQuery({ queryKey: key, queryFn: () => client.accessSetup(token, siteId) });
  const [participationId, setParticipationId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [assignmentId, setAssignmentId] = useState('');
  const [permissionId, setPermissionId] = useState('');
  const [validFrom, setValidFrom] = useState(() => localTime(0));
  const [validUntil, setValidUntil] = useState(() => localTime(8 * 3600_000));
  const [reviewNote, setReviewNote] = useState('');
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const mutation = useMutation({
    mutationFn: async (action: 'contractor' | 'worker' | 'assignment') => {
      const interval = {
        validFrom: new Date(validFrom).toISOString(),
        validUntil: new Date(validUntil).toISOString(),
      };
      if (Date.parse(interval.validUntil) <= Date.parse(interval.validFrom))
        throw new Error('End must be later than start.');
      const fingerprint = JSON.stringify([
        action,
        participationId,
        zoneId,
        workerId,
        assignmentId,
        permissionId,
        interval,
      ]);
      if (request.current?.fingerprint !== fingerprint)
        request.current = { fingerprint, id: crypto.randomUUID() };
      if (action === 'contractor')
        return client.grantContractorZone(token, siteId, {
          requestId: request.current.id,
          siteContractorId: participationId,
          zoneId,
          ...interval,
        });
      if (action === 'worker')
        return client.grantWorkerZone(token, siteId, {
          requestId: request.current.id,
          workerAssignmentId: assignmentId,
          contractorZonePermissionId: permissionId,
          ...interval,
        });
      return client.createWorkerSiteZoneAssignment(token, workerId, {
        siteId,
        zoneIds: [zoneId],
        ...interval,
      });
    },
    onSuccess: () => {
      request.current = null;
      void cache.invalidateQueries({ queryKey: key });
    },
  });
  const review = useMutation({
    mutationFn: (input: { id: string; approve: boolean; version: number }) =>
      client.decideWorkerSiteZoneAssignment(token, input.id, input.approve, {
        expectedVersion: input.version,
        reviewNote: reviewNote.trim() || undefined,
      }),
    onSuccess: () => cache.invalidateQueries({ queryKey: key }),
  });
  const revoke = useMutation({
    mutationFn: (input: { id: string; kind: 'worker' | 'contractor' }) =>
      client.revokeZonePermission(token, siteId, input.id, input.kind),
    onSuccess: () => cache.invalidateQueries({ queryKey: key }),
  });
  const revokeAssignment = useMutation({
    mutationFn: (a: { id: string; version: number }) =>
      client.revokeWorkerAssignment(token, a.id, a.version, reviewNote.trim()),
    onSuccess: () => cache.invalidateQueries({ queryKey: key }),
  });
  const data = setup.data;
  if (setup.isPending) return <p role="status">Loading Site access setup…</p>;
  if (setup.error)
    return (
      <div role="alert">
        {setup.error.message} <button onClick={() => void setup.refetch()}>Retry</button>
      </div>
    );
  if (!data) return null;
  const permissionLabel = (id: string) => {
    const permission = data.contractorPermissions.find((p) => p.id === id);
    return permission
      ? `${data.participations.find((p) => p.id === permission.siteContractorId)?.name ?? 'Contractor'} / ${data.zones.find((z) => z.id === permission.zoneId)?.name ?? 'Zone'}`
      : 'Unavailable permission';
  };
  const inputClass = 'mt-1 block w-full rounded-lg border border-slate-300 p-2 text-sm';
  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-2xl border bg-white p-6">
        <h2 className="text-lg font-bold">Worker assignments and Zone permissions</h2>
        <p className="text-sm text-slate-600">
          Site Manager approves Worker assignments and grants Contractor zones. The Contractor
          Representative assigns Worker zones within both approved intervals.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold">
            Start{' '}
            <input
              className={inputClass}
              type="datetime-local"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
            />
          </label>
          <label className="text-xs font-semibold">
            End{' '}
            <input
              className={inputClass}
              type="datetime-local"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </label>
          <label className="text-xs font-semibold">
            Zone{' '}
            <select
              className={inputClass}
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
            >
              <option value="">Select Zone</option>
              {data.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {data.canGrantContractorZones && (
          <div className="space-y-3 rounded-xl bg-slate-50 p-4">
            <label className="text-xs font-semibold">
              Contractor at this Site{' '}
              <select
                className={inputClass}
                value={participationId}
                onChange={(e) => setParticipationId(e.target.value)}
              >
                <option value="">Select Contractor</option>
                {data.participations.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={
                mutation.isPending || !participationId || !zoneId || !validFrom || !validUntil
              }
              onClick={() => mutation.mutate('contractor')}
            >
              Grant Contractor Zone
            </button>
          </div>
        )}
        {data.canGrantWorkerZones && (
          <div className="space-y-3 rounded-xl bg-slate-50 p-4">
            <label className="text-xs font-semibold">
              Worker{' '}
              <select
                className={inputClass}
                value={workerId}
                onChange={(e) => setWorkerId(e.target.value)}
              >
                <option value="">Select Worker</option>
                {data.workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="rounded border px-4 py-2 text-sm disabled:opacity-50"
              disabled={mutation.isPending || !workerId || !zoneId || !validFrom || !validUntil}
              onClick={() => mutation.mutate('assignment')}
            >
              Request Site assignment
            </button>
            <label className="block text-xs font-semibold">
              Approved Worker assignment{' '}
              <select
                className={inputClass}
                value={assignmentId}
                onChange={(e) => setAssignmentId(e.target.value)}
              >
                <option value="">Select assignment</option>
                {data.assignments
                  .filter((a) => a.status === 'APPROVED' && a.validUntil)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.workerName} · {new Date(a.validUntil!).toLocaleString()}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-xs font-semibold">
              Contractor Zone permission{' '}
              <select
                className={inputClass}
                value={permissionId}
                onChange={(e) => setPermissionId(e.target.value)}
              >
                <option value="">Select Contractor permission</option>
                {data.contractorPermissions
                  .filter(
                    (p) =>
                      !p.revokedAt &&
                      p.siteContractorId ===
                        data.assignments.find((a) => a.id === assignmentId)?.siteContractorId,
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {permissionLabel(p.id)}
                    </option>
                  ))}
              </select>
            </label>
            <button
              className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={
                mutation.isPending || !assignmentId || !permissionId || !validFrom || !validUntil
              }
              onClick={() => mutation.mutate('worker')}
            >
              Grant Worker Zone
            </button>
          </div>
        )}
        {mutation.error && (
          <p role="alert" className="text-sm text-red-700">
            {mutation.error.message}
          </p>
        )}
        {mutation.isSuccess && (
          <p role="status" className="text-sm text-green-700">
            Access setup saved.
          </p>
        )}
      </section>
      <section className="space-y-3 rounded-2xl border bg-white p-6">
        <h3 className="font-bold">Site assignments</h3>
        {data.canReviewAssignments && (
          <label className="block text-xs">
            Review reason{' '}
            <input
              className={inputClass}
              value={reviewNote}
              maxLength={1000}
              onChange={(e) => setReviewNote(e.target.value)}
            />
          </label>
        )}
        {!data.assignments.length && (
          <p className="text-sm text-slate-500">No Site assignment requests.</p>
        )}
        {data.assignments.map((a) => (
          <div
            key={a.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm"
          >
            <span>
              {a.workerName} · {a.status} ·{' '}
              {a.validUntil ? new Date(a.validUntil).toLocaleString() : 'Expiry required'}
            </span>
            {a.reviewNote && <span>{a.reviewNote}</span>}
            {data.canReviewAssignments && a.status === 'APPROVED' && (
              <button
                disabled={revokeAssignment.isPending || !reviewNote.trim()}
                onClick={() => revokeAssignment.mutate(a)}
                className="rounded border px-3 py-1"
              >
                Revoke assignment
              </button>
            )}
            {data.canReviewAssignments && ['PENDING', 'SAFETY_REVIEWED'].includes(a.status) && (
              <>
                <button
                  disabled={review.isPending}
                  onClick={() => review.mutate({ id: a.id, approve: true, version: a.version })}
                  className="rounded bg-green-700 px-3 py-1 text-white"
                >
                  Approve
                </button>
                <button
                  disabled={review.isPending}
                  onClick={() => review.mutate({ id: a.id, approve: false, version: a.version })}
                  className="rounded border px-3 py-1"
                >
                  Reject
                </button>
              </>
            )}
          </div>
        ))}
        {review.error && <p role="alert">{review.error.message}</p>}
        {revokeAssignment.error && <p role="alert">{revokeAssignment.error.message}</p>}
      </section>
      <section className="space-y-3 rounded-2xl border bg-white p-6">
        <h3 className="font-bold">Contractor Zone permissions</h3>
        {!data.contractorPermissions.length && (
          <p className="text-sm text-slate-500">No Contractor Zone permissions.</p>
        )}
        {data.contractorPermissions.map((p) => (
          <div key={p.id} className="flex flex-wrap gap-3 rounded-lg border p-3 text-sm">
            <span>
              {permissionLabel(p.id)} ·{' '}
              {p.revokedAt ? 'REVOKED' : new Date(p.validUntil).toLocaleString()}
            </span>
            {data.canGrantContractorZones && !p.revokedAt && (
              <button
                disabled={revoke.isPending}
                onClick={() => revoke.mutate({ id: p.id, kind: 'contractor' })}
                className="rounded border px-3 py-1"
              >
                Revoke Contractor Zone
              </button>
            )}
          </div>
        ))}
        <h3 className="pt-3 font-bold">Worker Zone permissions</h3>
        {!data.workerPermissions.length && (
          <p className="text-sm text-slate-500">No Worker Zone permissions.</p>
        )}
        {data.workerPermissions.map((p) => (
          <div key={p.id} className="flex flex-wrap gap-3 rounded-lg border p-3 text-sm">
            <span>
              {data.assignments.find((a) => a.id === p.workerAssignmentId)?.workerName} ·{' '}
              {permissionLabel(p.contractorZonePermissionId)} ·{' '}
              {p.revokedAt ? 'REVOKED' : new Date(p.validUntil).toLocaleString()}
            </span>
            {data.canGrantWorkerZones && !p.revokedAt && (
              <button
                disabled={revoke.isPending}
                onClick={() => revoke.mutate({ id: p.id, kind: 'worker' })}
                className="rounded border px-3 py-1"
              >
                Revoke Worker Zone
              </button>
            )}
          </div>
        ))}
        {revoke.error && <p role="alert">{revoke.error.message}</p>}
      </section>
      <AttendanceView apiUrl={apiUrl} token={token} siteId={siteId} sessionScope={sessionScope} />
    </div>
  );
}
