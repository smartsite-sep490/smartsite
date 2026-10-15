import { localizedError } from '../../i18n/messages';
import { uiLocale } from '../../i18n';
import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useManagementClient, useAuth, useCurrentUser } from '../../features/auth/auth-session';
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
  useTranslation();

  const { accessToken } = useAuth();
  const { data: user } = useCurrentUser(apiUrl);
  const client = useManagementClient(apiUrl);
  const [date, setDate] = useState(today);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const detail = useQuery({
    queryKey: ['manager-detail', apiUrl, user?.id, siteId, contractorId, date, timezone],
    queryFn: () =>
      client.managerContractorDetail(accessToken!, siteId, contractorId, { date, timezone }),
    enabled: Boolean(accessToken && user && date),
  });
  const time = (value: string) =>
    new Date(value).toLocaleString(uiLocale(), { timeZone: timezone });
  const data = detail.data;
  return (
    <Dialog
      open
      onClose={onClose}
      title={data?.name ?? tr('common.contractor_details')}
      description={data?.code}
      maxWidth="xl"
    >
      <div className="max-h-[65vh] overflow-y-auto space-y-5 pr-1">
        <SmartDatePicker
          label={tr('common.work_date')}
          value={date}
          onChange={setDate}
          disablePast={false}
          fieldRequired
        />
        <p className="text-xs text-slate-500">
          {tr(
            'manager_contractor_details.timezone_value_teams_below_reflect_current_membership_work_on_this_date_is_based_o',
            { value1: timezone },
          )}
        </p>
        {!date ? (
          <p role="alert">{tr('manager_contractor_details.select_a_work_date')}</p>
        ) : detail.isPending ? (
          <p role="status">{tr('common.loading_contractor_details')}</p>
        ) : detail.isError ? (
          <div role="alert">
            {tr('common.contractor_details_unavailable')} {localizedError(detail.error.message)}{' '}
            <button type="button" onClick={() => void detail.refetch()} className="underline">
              {tr('common.retry')}
            </button>
          </div>
        ) : (
          data && (
            <>
              <dl className="grid grid-cols-3 gap-3 text-sm">
                {[
                  [tr('common.active_teams_82c339'), data.teamCount],
                  [tr('common.active_workers_3adad5'), data.workerCount],
                  [tr('common.scheduled_workers'), data.scheduledWorkerCount],
                ].map(([label, count]) => (
                  <div key={label} className="rounded-xl border border-slate-200 p-3">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="mt-1 text-2xl font-bold text-[#071A2B]">{count}</dd>
                  </div>
                ))}
              </dl>
              <section className="space-y-2">
                <h3 className="font-bold">
                  {tr('common.teams_value', { value1: data.teams.length })}
                </h3>
                {data.teams.length ? (
                  <ul className="space-y-2">
                    {data.teams.map((team) => (
                      <li key={team.id} className="rounded-xl bg-slate-50 p-3">
                        <div className="flex justify-between gap-3">
                          <span className="font-semibold">{team.name}</span>
                          <span>{tr('common.value_workers', { value1: team.workerCount })}</span>
                        </div>
                        <p className="mt-2 text-xs font-semibold">
                          {tr('manager_contractor_details.team_zones_on_value', {
                            value1: data.date,
                          })}
                        </p>
                        {team.zoneAssignments === undefined ? (
                          <p role="status" className="text-sm">
                            {tr(
                              'manager_contractor_details.team_zone_data_unavailable_refresh_after_the_backend_update',
                            )}
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
                            {tr('manager_contractor_details.no_team_zone_assignments_on_this_date')}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{tr('common.no_active_teams')}</p>
                )}
              </section>
              <section className="space-y-2">
                <h3 className="font-bold">
                  {tr('manager_contractor_details.contractor_zones_on_value_value', {
                    value1: data.date,
                    value2: new Set(data.zones.map((z) => z.id)).size,
                  })}
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
                  <p>
                    {tr('manager_contractor_details.no_zone_assignments_effective_on_this_date')}
                  </p>
                )}
              </section>
              <section className="space-y-2">
                <h3 className="font-bold">
                  {tr('manager_contractor_details.teams_scheduled_on_value_value', {
                    value1: data.date,
                    value2: data.scheduledTeams.length,
                  })}
                </h3>
                {data.scheduledTeams.length ? (
                  <ul className="space-y-3">
                    {data.scheduledTeams.map((team) => (
                      <li key={team.id} className="rounded-xl border border-slate-200 p-3">
                        <p className="font-semibold">
                          {tr('manager_contractor_details.value_value_scheduled_workers', {
                            value1: team.name,
                            value2: team.workerCount,
                          })}
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
                  <p>{tr('manager_contractor_details.no_teams_scheduled_on_this_date')}</p>
                )}
                {data.scheduledWorkersWithoutTeam > 0 && (
                  <p className="text-sm text-amber-700">
                    {tr('manager_contractor_details.value_scheduled_workers_have_no_active_team', {
                      value1: data.scheduledWorkersWithoutTeam,
                    })}
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
