import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { useAuth, useCurrentUser } from '../../features/auth/auth-session';
import { Dialog, SmartDatePicker } from '../ui';

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function ManagerContractorDetails({
  apiUrl,
  siteId,
  contractorId,
  onClose,
}: {
  apiUrl: string;
  siteId: string;
  contractorId: string;
  onClose: () => void;
}) {
  const { accessToken } = useAuth();
  const { data: user } = useCurrentUser(apiUrl);
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const [date, setDate] = useState(today);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const detail = useQuery({
    queryKey: ['manager-detail', apiUrl, user?.id, siteId, contractorId, date, timezone],
    queryFn: () =>
      client.managerContractorDetail(accessToken!, siteId, contractorId, { date, timezone }),
    enabled: Boolean(accessToken && user && date),
  });
  const time = (value: string) => new Date(value).toLocaleString(undefined, { timeZone: timezone });
  const data = detail.data;
  return (
    <Dialog
      open
      onClose={onClose}
      title={data?.name ?? 'Contractor details'}
      description={data?.code}
      maxWidth="xl"
    >
      <div className="max-h-[65vh] overflow-y-auto space-y-5 pr-1">
        <SmartDatePicker
          label="Work date"
          value={date}
          onChange={setDate}
          disablePast={false}
          fieldRequired
        />
        <p className="text-xs text-slate-500">
          Timezone: {timezone}. Teams below reflect current membership. Work on this date is based
          on assigned schedules.
        </p>
        {!date ? (
          <p role="alert">Select a work date.</p>
        ) : detail.isPending ? (
          <p role="status">Loading contractor details…</p>
        ) : detail.isError ? (
          <div role="alert">
            Contractor details unavailable. {detail.error.message}{' '}
            <button type="button" onClick={() => void detail.refetch()} className="underline">
              Retry
            </button>
          </div>
        ) : (
          data && (
            <>
              <dl className="grid grid-cols-3 gap-3 text-sm">
                {[
                  ['Active teams', data.teamCount],
                  ['Active workers', data.workerCount],
                  ['Scheduled workers', data.scheduledWorkerCount],
                ].map(([label, count]) => (
                  <div key={label} className="rounded-xl border border-slate-200 p-3">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="mt-1 text-2xl font-bold text-[#071A2B]">{count}</dd>
                  </div>
                ))}
              </dl>
              <section className="space-y-2">
                <h3 className="font-bold">Teams ({data.teams.length})</h3>
                {data.teams.length ? (
                  <ul className="space-y-2">
                    {data.teams.map((team) => (
                      <li key={team.id} className="rounded-xl bg-slate-50 p-3">
                        <div className="flex justify-between gap-3">
                          <span className="font-semibold">{team.name}</span>
                          <span>{team.workerCount} workers</span>
                        </div>
                        <p className="mt-2 text-xs font-semibold">Team Zones on {data.date}</p>
                        {team.zoneAssignments === undefined ? (
                          <p role="status" className="text-sm">
                            Team Zone data unavailable. Refresh after the Backend update.
                          </p>
                        ) : team.zoneAssignments.length ? (
                          <ul className="mt-1 space-y-2 text-sm">
                            {team.zoneAssignments.map((zone) => (
                              <li key={zone.id}>
                                <p>
                                  {zone.name}{' '}
                                  <span className="break-all text-xs text-slate-500">
                                    ({zone.code})
                                  </span>
                                </p>
                                <p className="text-xs text-slate-500">
                                  {time(zone.validFrom)} – {time(zone.validUntil)}
                                </p>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-slate-500">
                            No team Zone assignments on this date.
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No active teams.</p>
                )}
              </section>
              <section className="space-y-2">
                <h3 className="font-bold">
                  Contractor Zones on {data.date} ({new Set(data.zones.map((z) => z.id)).size})
                </h3>
                {data.zones.length ? (
                  <ul className="space-y-2">
                    {data.zones.map((zone) => (
                      <li
                        key={`${zone.id}-${zone.validFrom}`}
                        className="rounded-xl border border-slate-200 p-3"
                      >
                        <p className="font-semibold">{zone.name}</p>
                        <p className="break-all text-xs text-slate-500">{zone.code}</p>
                        <p className="mt-1 text-xs">
                          {time(zone.validFrom)} – {time(zone.validUntil)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No Zone assignments effective on this date.</p>
                )}
              </section>
              <section className="space-y-2">
                <h3 className="font-bold">
                  Teams scheduled on {data.date} ({data.scheduledTeams.length})
                </h3>
                {data.scheduledTeams.length ? (
                  <ul className="space-y-3">
                    {data.scheduledTeams.map((team) => (
                      <li key={team.id} className="rounded-xl border border-slate-200 p-3">
                        <p className="font-semibold">
                          {team.name} · {team.workerCount} scheduled workers
                        </p>
                        <ul className="mt-2 text-sm space-y-1">
                          {team.shifts.map((shift) => (
                            <li key={shift.id}>
                              {shift.name}: {time(shift.startsAt)} – {time(shift.endsAt)}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No teams scheduled on this date.</p>
                )}
                {data.scheduledWorkersWithoutTeam > 0 && (
                  <p className="text-sm text-amber-700">
                    {data.scheduledWorkersWithoutTeam} scheduled workers have no active team.
                  </p>
                )}
              </section>
            </>
          )
        )}
      </div>
    </Dialog>
  );
}
