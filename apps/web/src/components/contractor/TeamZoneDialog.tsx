import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { Dialog, SmartDatePicker } from '../ui';
export function TeamZoneDialog({
  apiUrl,
  token,
  userId,
  siteId,
  contractorId,
  teamId,
  teamName,
  onClose,
}: {
  apiUrl: string;
  token: string;
  userId: string;
  siteId: string;
  contractorId: string;
  teamId: string;
  teamName: string;
  onClose: () => void;
}) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]),
    cache = useQueryClient();
  const key = ['team-zones', apiUrl, userId, siteId, contractorId, teamId];
  const data = useQuery({
    queryKey: key,
    queryFn: () => client.teamZoneSetup(token, siteId, contractorId, teamId),
  });
  const [permissionChoice, setPermissionId] = useState(''),
    [startChoice, setStart] = useState(''),
    [endChoice, setEnd] = useState('');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const day = (instant: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(instant));
    return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}-${parts.find((p) => p.type === 'day')!.value}`;
  };
  const display = (instant: string) =>
    new Date(instant).toLocaleDateString('en-GB', { timeZone: timezone });
  const current = data.data?.permissions.find((p) => !p.revokedAt);
  const permissionId = permissionChoice || current?.contractorZonePermissionId || '';
  const start = startChoice || (current ? day(current.validFrom) : '');
  const end =
    endChoice || (current ? day(new Date(+new Date(current.validUntil) - 1).toISOString()) : '');
  const selected = data.data?.availableZones.find((p) => p.permissionId === permissionId);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const grant = useMutation({
    mutationFn: () => {
      const fingerprint = JSON.stringify([current?.id, permissionId, start, end, timezone]);
      if (request.current?.fingerprint !== fingerprint)
        request.current = { fingerprint, id: crypto.randomUUID() };
      const input = {
        requestId: request.current.id,
        contractorZonePermissionId: permissionId,
        startDate: start,
        endDate: end,
        timezone,
      };
      return current
        ? client.updateTeamZone(token, siteId, contractorId, teamId, current.id, input)
        : client.grantTeamZone(token, siteId, contractorId, teamId, input);
    },
    onSuccess: () => {
      request.current = null;
      void cache.invalidateQueries({ queryKey: key });
      void cache.invalidateQueries({ queryKey: ['contractor-teams'] });
      void cache.invalidateQueries({ queryKey: ['contractor-teams-active-all'] });
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${current ? 'Edit' : 'Assign'} Zone · ${teamName}`}
      maxWidth="xl"
    >
      <div className="max-h-[65vh] overflow-y-auto space-y-4">
        <p className="text-sm text-slate-500">
          Choose a Zone granted to your contractor. Dates are inclusive; permission remains within
          the contractor grant. Timezone: {timezone}. Members still need approved Site/Zone access.
        </p>
        {data.isPending ? (
          <p role="status">Loading team Zones…</p>
        ) : data.isError ? (
          <div role="alert">
            Team Zones unavailable. {data.error.message}{' '}
            <button type="button" onClick={() => void data.refetch()}>
              Retry
            </button>
          </div>
        ) : (
          <>
            {!data.data.availableZones.length ? (
              <p>No available Zones. Ask your Site Manager to assign a Zone to your contractor.</p>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  grant.mutate();
                }}
              >
                <label className="grid gap-2 text-sm font-semibold">
                  Granted Zone
                  <select
                    required
                    value={permissionId}
                    onChange={(e) => {
                      const p = data.data.availableZones.find(
                        (p) => p.permissionId === e.target.value,
                      );
                      setPermissionId(e.target.value);
                      setStart(p ? day(p.validFrom) : '');
                      setEnd(p ? day(new Date(+new Date(p.validUntil) - 1).toISOString()) : '');
                    }}
                    className="rounded-xl border border-slate-200 p-2"
                  >
                    <option value="">Select Zone</option>
                    {data.data.availableZones.map((p) => (
                      <option key={p.permissionId} value={p.permissionId}>
                        {p.name} · {display(p.validFrom)} –{' '}
                        {display(new Date(+new Date(p.validUntil) - 1).toISOString())}
                      </option>
                    ))}
                  </select>
                </label>
                <SmartDatePicker
                  label="Start date"
                  value={start}
                  onChange={setStart}
                  disablePast={false}
                  min={selected ? day(selected.validFrom) : undefined}
                  max={
                    selected
                      ? day(new Date(+new Date(selected.validUntil) - 1).toISOString())
                      : undefined
                  }
                  fieldRequired
                />
                <SmartDatePicker
                  label="End date"
                  value={end}
                  onChange={setEnd}
                  disablePast={false}
                  min={start}
                  max={
                    selected
                      ? day(new Date(+new Date(selected.validUntil) - 1).toISOString())
                      : undefined
                  }
                  fieldRequired
                />
                <button
                  type="submit"
                  disabled={grant.isPending || !permissionId || !start || !end || end < start}
                  className="rounded-xl bg-[#071A2B] px-4 py-2 text-white disabled:opacity-40"
                >
                  {grant.isPending ? 'Saving…' : current ? 'Save Zone Changes' : 'Assign Team Zone'}
                </button>
              </form>
            )}
            {grant.isError && <p role="alert">{grant.error.message}</p>}
            {grant.isSuccess && <p role="status">Team Zone saved.</p>}
            <h3 className="font-bold">Assigned team Zones</h3>
            {!data.data.permissions.length && <p>This team has no Zone assignments.</p>}
            {data.data.permissions.map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
                <p className="font-semibold">{p.name}</p>
                <p className="text-sm">
                  {display(p.validFrom)} –{' '}
                  {display(new Date(+new Date(p.validUntil) - 1).toISOString())} ·{' '}
                  {p.revokedAt
                    ? 'Revoked'
                    : p.effective
                      ? 'Active'
                      : 'Inactive / outside effective period'}
                </p>
              </div>
            ))}
          </>
        )}
      </div>
    </Dialog>
  );
}
