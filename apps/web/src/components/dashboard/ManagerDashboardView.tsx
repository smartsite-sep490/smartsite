import { localizedError } from '../../i18n/messages';
import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useManagementClient, useAuth, useCurrentUser } from '../../features/auth/auth-session';
import { loadAllPages } from '../workforce/load-all-pages';
import { ManagerContractorDetails } from './ManagerContractorDetails';
import type { ActiveTab } from '../layout/AppLayout';

export function ManagerDashboardView({
  apiUrl,
  onNavigate,
}: {
  apiUrl: string;
  onNavigate: (tab: ActiveTab) => void;
}) {
  useTranslation();

  const { accessToken } = useAuth();
  const { data: user } = useCurrentUser(apiUrl);
  const client = useManagementClient(apiUrl);
  const [selection, setSelection] = useState({ siteId: '', offset: 0 });
  const [contractorId, setContractorId] = useState<string | null>(null);
  const sites = useQuery({
    queryKey: ['manager-sites', apiUrl, user?.id],
    queryFn: ({ signal }) =>
      loadAllPages((options) => client.listSites(accessToken!, options), signal),
    enabled: Boolean(accessToken && user),
  });
  const managed = (sites.data?.items ?? []).filter((site) =>
    user?.roleAssignments.some((role) => role.role === 'SITE_MANAGER' && role.siteId === site.id),
  );
  const siteId = managed.find((site) => site.id === selection.siteId)?.id ?? managed[0]?.id ?? '';
  const overview = useQuery({
    queryKey: ['manager-overview', apiUrl, user?.id, siteId, selection.offset],
    queryFn: () =>
      client.managerOverview(accessToken!, siteId, { offset: selection.offset, limit: 20 }),
    enabled: Boolean(accessToken && siteId),
  });
  const data = overview.data;
  const button =
    'rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold focus:ring-2 focus:ring-orange-300 disabled:opacity-40';
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#071A2B]">
            {tr('common.site_management_overview')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {tr('manager_dashboard_view.contractors_zones_and_workforce_in_your_managed_site')}
          </p>
        </div>
        <button type="button" className={button} onClick={() => onNavigate('site-setup')}>
          {tr('manager_dashboard_view.manage_contractors_zones')}
        </button>
      </div>
      {sites.isPending ? (
        <p role="status">{tr('common.loading_managed_sites')}</p>
      ) : sites.isError ? (
        <div role="alert">
          {tr('common.managed_sites_unavailable')}{' '}
          <button type="button" onClick={() => void sites.refetch()}>
            {tr('common.retry')}
          </button>
        </div>
      ) : !managed.length ? (
        <p>{tr('manager_dashboard_view.no_site_manager_assignment_available')}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-semibold">
              {tr('common.managed_site')}{' '}
              <select
                value={siteId}
                onChange={(e) => {
                  setSelection({ siteId: e.target.value, offset: 0 });
                  setContractorId(null);
                }}
                className="ml-2 rounded-xl border border-slate-200 p-2"
              >
                {managed.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={button}
              disabled={overview.isFetching}
              onClick={() => void overview.refetch()}
            >
              {tr('common.refresh')}
            </button>
          </div>
          {overview.isPending ? (
            <p role="status">{tr('common.loading_management_overview')}</p>
          ) : overview.isError ? (
            <div role="alert">
              {tr('common.management_overview_unavailable')}{' '}
              {localizedError(overview.error.message)}{' '}
              <button type="button" onClick={() => void overview.refetch()}>
                {tr('common.retry')}
              </button>
            </div>
          ) : (
            data && (
              <>
                <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    [tr('common.managed_contractors'), data.contractorCount],
                    [tr('common.configured_zones'), data.zoneCount],
                    [tr('common.active_teams_82c339'), data.teamCount],
                    [tr('common.active_workers_3adad5'), data.workerCount],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5">
                      <dt className="text-sm text-slate-500">{label}</dt>
                      <dd className="mt-2 text-3xl font-bold text-[#071A2B]">{value}</dd>
                    </div>
                  ))}
                </dl>
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <h2 className="border-b border-slate-100 p-5 text-lg font-bold">
                    {tr('common.contractors_value', { value1: data.contractors.total })}
                  </h2>
                  {!data.contractors.items.length ? (
                    <p className="p-5">
                      {tr('manager_dashboard_view.no_active_contractors_on_this_site')}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            {[
                              tr('common.contractor'),
                              tr('common.teams'),
                              tr('common.workers'),
                              tr('common.details'),
                            ].map((label) => (
                              <th key={label} className="p-4">
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.contractors.items.map((contractor) => (
                            <tr key={contractor.id} className="border-t border-slate-100">
                              <td className="p-4">
                                <p className="font-semibold">{contractor.name}</p>
                                <p className="mt-1 break-all text-xs text-slate-500">
                                  {contractor.code}
                                </p>
                              </td>
                              <td className="p-4">{contractor.teamCount}</td>
                              <td className="p-4">{contractor.workerCount}</td>
                              <td className="p-4">
                                <button
                                  type="button"
                                  className={button}
                                  aria-label={tr('manager_dashboard_view.view_details_for_value', {
                                    value1: contractor.name,
                                  })}
                                  onClick={() => setContractorId(contractor.id)}
                                >
                                  {tr('common.view_details_90789c')}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {data.contractors.total > 20 && (
                    <div className="flex justify-between border-t border-slate-100 p-4">
                      <button
                        type="button"
                        className={button}
                        disabled={!selection.offset}
                        onClick={() =>
                          setSelection({ siteId, offset: Math.max(0, selection.offset - 20) })
                        }
                      >
                        {tr('common.previous')}
                      </button>
                      <span>
                        {tr('common.value_value_of_value', {
                          value1: selection.offset + 1,
                          value2: Math.min(selection.offset + 20, data.contractors.total),
                          value3: data.contractors.total,
                        })}
                      </span>
                      <button
                        type="button"
                        className={button}
                        disabled={selection.offset + 20 >= data.contractors.total}
                        onClick={() => setSelection({ siteId, offset: selection.offset + 20 })}
                      >
                        {tr('common.next')}
                      </button>
                    </div>
                  )}
                </section>
              </>
            )
          )}
          {contractorId && (
            <ManagerContractorDetails
              key={`${siteId}-${contractorId}`}
              apiUrl={apiUrl}
              siteId={siteId}
              contractorId={contractorId}
              onClose={() => setContractorId(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
