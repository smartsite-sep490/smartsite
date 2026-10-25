import { userErrorMessage } from '../../i18n/messages';
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

  const btnOutline =
    'rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#041D2E] hover:bg-slate-50 focus:ring-2 focus:ring-[#F66B17]/30 disabled:opacity-40 transition-all active:scale-[0.98] cursor-pointer shadow-2xs';

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-black text-[#041D2E]">
          {tr('common.site_management_overview')}
        </h1>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-xl bg-[#041D2E] px-4 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-[#071A2B]/90 focus:ring-2 focus:ring-[#F66B17]/40 disabled:opacity-40 transition-all active:scale-[0.98] cursor-pointer"
          onClick={() => onNavigate('site-setup')}
        >
          {tr('manager_dashboard_view.manage_contractors_zones')}
        </button>
      </div>

      {/* Site selector / content */}
      {sites.isPending ? (
        <p role="status" className="text-sm text-slate-500">
          {tr('common.loading_managed_sites')}
        </p>
      ) : sites.isError ? (
        <div role="alert" className="text-sm text-red-600">
          {tr('common.managed_sites_unavailable')}{' '}
          <button
            type="button"
            onClick={() => void sites.refetch()}
            className="underline font-semibold"
          >
            {tr('common.retry')}
          </button>
        </div>
      ) : !managed.length ? (
        <p className="text-sm text-slate-500">
          {tr('manager_dashboard_view.no_site_manager_assignment_available')}
        </p>
      ) : (
        <>
          {/* Site selector bar */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-sm font-bold text-[#041D2E]">
              {tr('common.managed_site')}
              <select
                value={siteId}
                onChange={(e) => {
                  setSelection({ siteId: e.target.value, offset: 0 });
                  setContractorId(null);
                }}
                className="min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-[#041D2E] focus:ring-2 focus:ring-[#F66B17]/30 transition-colors"
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
              className={btnOutline}
              disabled={overview.isFetching}
              onClick={() => void overview.refetch()}
            >
              {tr('common.refresh')}
            </button>
          </div>

          {/* Overview content */}
          {overview.isPending ? (
            <p role="status" className="text-sm text-slate-500">
              {tr('common.loading_management_overview')}
            </p>
          ) : overview.isError ? (
            <div role="alert" className="text-sm text-red-600">
              {tr('common.management_overview_unavailable')} {userErrorMessage(overview.error)}{' '}
              <button
                type="button"
                onClick={() => void overview.refetch()}
                className="underline font-semibold"
              >
                {tr('common.retry')}
              </button>
            </div>
          ) : (
            data && (
              <>
                {/* KPI Cards */}
                <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {(
                    [
                      [tr('common.managed_contractors'), data.contractorCount, 'text-[#041D2E]'],
                      [tr('common.configured_zones'), data.zoneCount, 'text-[#041D2E]'],
                      [tr('common.active_teams_82c339'), data.teamCount, 'text-[#008C47]'],
                      [tr('common.active_workers_3adad5'), data.workerCount, 'text-[#F66B17]'],
                    ] as [string, number, string][]
                  ).map(([label, value, color]) => (
                    <div
                      key={label}
                      className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs hover:shadow-sm transition-shadow space-y-2"
                    >
                      <dt className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        {label}
                      </dt>
                      <dd className={`text-3xl font-black tracking-tight ${color}`}>{value}</dd>
                    </div>
                  ))}
                </dl>

                {/* Contractors table */}
                <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
                  <div className="flex items-center border-b border-slate-100 px-5 py-4">
                    <h2 className="text-base font-black text-[#041D2E]">
                      {tr('common.contractors_value', { value1: data.contractors.total })}
                    </h2>
                  </div>
                  {!data.contractors.items.length ? (
                    <p className="p-5 text-sm text-slate-500">
                      {tr('manager_dashboard_view.no_active_contractors_on_this_site')}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            {[
                              tr('common.contractor'),
                              tr('common.teams'),
                              tr('common.workers'),
                              tr('common.details'),
                            ].map((label) => (
                              <th
                                key={label}
                                className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider"
                              >
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.contractors.items.map((contractor) => (
                            <tr
                              key={contractor.id}
                              className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors"
                            >
                              <td className="p-4">
                                <p className="font-bold text-[#041D2E]">{contractor.name}</p>
                                <p className="mt-0.5 text-xs font-semibold text-[#F66B17]">
                                  {contractor.code}
                                </p>
                              </td>
                              <td className="p-4 font-semibold text-[#041D2E]">
                                {contractor.teamCount}
                              </td>
                              <td className="p-4 font-semibold text-[#041D2E]">
                                {contractor.workerCount}
                              </td>
                              <td className="p-4">
                                <button
                                  type="button"
                                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-[#041D2E] hover:bg-slate-50 hover:border-slate-300 focus:ring-2 focus:ring-[#F66B17]/30 transition-all active:scale-[0.98] cursor-pointer shadow-2xs"
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
                    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
                      <button
                        type="button"
                        className={btnOutline}
                        disabled={!selection.offset}
                        onClick={() =>
                          setSelection({ siteId, offset: Math.max(0, selection.offset - 20) })
                        }
                      >
                        {tr('common.previous')}
                      </button>
                      <span className="text-xs font-semibold text-slate-500">
                        {tr('common.value_value_of_value', {
                          value1: selection.offset + 1,
                          value2: Math.min(selection.offset + 20, data.contractors.total),
                          value3: data.contractors.total,
                        })}
                      </span>
                      <button
                        type="button"
                        className={btnOutline}
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
