import { userErrorMessage } from '../../i18n/messages';
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
  const permissionDate = (value: string) =>
    new Date(value).toLocaleDateString(uiLocale(), {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
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
        {!date ? (
          <p role="alert" className="text-sm text-slate-500">
            {tr('manager_contractor_details.select_a_work_date')}
          </p>
        ) : detail.isPending ? (
          <p role="status" className="text-sm text-slate-500">
            {tr('common.loading_contractor_details')}
          </p>
        ) : detail.isError ? (
          <div role="alert" className="text-sm text-red-600">
            {tr('common.contractor_details_unavailable')} {userErrorMessage(detail.error)}{' '}
            <button
              type="button"
              onClick={() => void detail.refetch()}
              className="underline font-semibold"
            >
              {tr('common.retry')}
            </button>
          </div>
        ) : (
          data && (
            <>
              {/* KPI Cards */}
              <dl className="grid grid-cols-3 gap-3">
                {(
                  [
                    [tr('common.active_teams_82c339'), data.teamCount, 'text-[#008C47]'],
                    [tr('common.active_workers_3adad5'), data.workerCount, 'text-[#041D2E]'],
                    [tr('common.scheduled_workers'), data.scheduledWorkerCount, 'text-[#F66B17]'],
                  ] as [string, number, string][]
                ).map(([label, count, color]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-2xs space-y-1"
                  >
                    <dt className="text-[10px] font-bold text-slate-500 uppercase tracking-wider leading-tight">
                      {label}
                    </dt>
                    <dd className={`text-2xl font-black tracking-tight ${color}`}>{count}</dd>
                  </div>
                ))}
              </dl>

              {/* Teams */}
              <section className="space-y-2">
                <h3 className="text-sm font-black text-[#041D2E]">
                  {tr('common.teams_value', { value1: data.teams.length })}
                </h3>
                {data.teams.length ? (
                  <ul className="space-y-2">
                    {data.teams.map((team) => (
                      <li
                        key={team.id}
                        className="rounded-xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden"
                      >
                        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
                          <span className="font-bold text-[#041D2E] text-sm">{team.name}</span>
                          <span className="text-xs font-bold text-[#008C47] bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                            {tr('common.value_workers', { value1: team.workerCount })}
                          </span>
                        </div>
                        <div className="px-4 py-3">
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                            {tr('manager_contractor_details.team_zones_on_value', {
                              value1: data.date,
                            })}
                          </p>
                          {team.zoneAssignments === undefined ? (
                            <p role="status" className="text-xs text-slate-500">
                              {tr(
                                'manager_contractor_details.team_zone_data_unavailable_refresh_after_the_backend_update',
                              )}
                            </p>
                          ) : team.zoneAssignments.length ? (
                            <ul className="space-y-1.5">
                              {team.zoneAssignments.map((zone) => (
                                <li
                                  key={zone.id}
                                  className="flex items-center justify-between gap-2 text-xs"
                                >
                                  <span className="font-semibold text-[#041D2E]">{zone.name}</span>
                                  <span className="text-slate-400 shrink-0">
                                    {permissionDate(zone.validFrom)} –{' '}
                                    {permissionDate(zone.validUntil)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-slate-500">
                              {tr(
                                'manager_contractor_details.no_team_zone_assignments_on_this_date',
                              )}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">{tr('common.no_active_teams')}</p>
                )}
              </section>

              {/* Contractor Zones */}
              <section className="space-y-2">
                <h3 className="text-sm font-black text-[#041D2E]">
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
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-white px-4 py-3 shadow-2xs"
                      >
                        <p className="font-bold text-[#041D2E] text-sm">{zone.name}</p>
                        <p className="text-xs text-slate-400 shrink-0">
                          {permissionDate(zone.validFrom)} – {permissionDate(zone.validUntil)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">
                    {tr('manager_contractor_details.no_zone_assignments_effective_on_this_date')}
                  </p>
                )}
              </section>

              {/* Scheduled Teams */}
              <section className="space-y-2">
                <h3 className="text-sm font-black text-[#041D2E]">
                  {tr('manager_contractor_details.teams_scheduled_on_value_value', {
                    value1: data.date,
                    value2: data.scheduledTeams.length,
                  })}
                </h3>
                {data.scheduledTeams.length ? (
                  <ul className="space-y-2">
                    {data.scheduledTeams.map((team) => (
                      <li
                        key={team.id}
                        className="rounded-xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden"
                      >
                        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
                          <span className="font-bold text-[#041D2E] text-sm">{team.name}</span>
                          <span className="text-xs font-bold text-[#F66B17] bg-orange-50 border border-orange-200 px-2.5 py-0.5 rounded-full">
                            {team.workerCount} {tr('common.scheduled_workers').toLowerCase()}
                          </span>
                        </div>
                        <ul className="px-4 py-3 space-y-1">
                          {team.shifts.map((shift) => (
                            <li
                              key={shift.id}
                              className="flex items-center justify-between text-xs gap-2"
                            >
                              <span className="font-semibold text-[#041D2E]">{shift.name}</span>
                              <span className="text-slate-400 shrink-0">
                                {time(shift.startsAt)} – {time(shift.endsAt)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">
                    {tr('manager_contractor_details.no_teams_scheduled_on_this_date')}
                  </p>
                )}
                {data.scheduledWorkersWithoutTeam > 0 && (
                  <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
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
