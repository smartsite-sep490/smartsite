import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { useAuth, useCurrentUser } from '../../features/auth/auth-session';
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
  const { accessToken } = useAuth();
  const { data: user } = useCurrentUser(apiUrl);
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
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
          <h1 className="text-2xl font-bold text-[#071A2B]">Site Management Overview</h1>
          <p className="mt-1 text-sm text-slate-500">
            Contractors, Zones and workforce in your managed Site.
          </p>
        </div>
        <button type="button" className={button} onClick={() => onNavigate('site-setup')}>
          Manage Contractors & Zones
        </button>
      </div>
      {sites.isPending ? (
        <p role="status">Loading managed Sites…</p>
      ) : sites.isError ? (
        <div role="alert">
          Managed Sites unavailable.{' '}
          <button type="button" onClick={() => void sites.refetch()}>
            Retry
          </button>
        </div>
      ) : !managed.length ? (
        <p>No Site Manager assignment available.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-semibold">
              Managed Site{' '}
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
              Refresh
            </button>
          </div>
          {overview.isPending ? (
            <p role="status">Loading management overview…</p>
          ) : overview.isError ? (
            <div role="alert">
              Management overview unavailable. {overview.error.message}{' '}
              <button type="button" onClick={() => void overview.refetch()}>
                Retry
              </button>
            </div>
          ) : (
            data && (
              <>
                <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ['Managed contractors', data.contractorCount],
                    ['Configured Zones', data.zoneCount],
                    ['Active teams', data.teamCount],
                    ['Active workers', data.workerCount],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5">
                      <dt className="text-sm text-slate-500">{label}</dt>
                      <dd className="mt-2 text-3xl font-bold text-[#071A2B]">{value}</dd>
                    </div>
                  ))}
                </dl>
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <h2 className="border-b border-slate-100 p-5 text-lg font-bold">
                    Contractors ({data.contractors.total})
                  </h2>
                  {!data.contractors.items.length ? (
                    <p className="p-5">No active contractors on this Site.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            {['Contractor', 'Teams', 'Workers', 'Details'].map((label) => (
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
                                  aria-label={`View details for ${contractor.name}`}
                                  onClick={() => setContractorId(contractor.id)}
                                >
                                  View Details
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
                        Previous
                      </button>
                      <span>
                        {selection.offset + 1}–
                        {Math.min(selection.offset + 20, data.contractors.total)} of{' '}
                        {data.contractors.total}
                      </span>
                      <button
                        type="button"
                        className={button}
                        disabled={selection.offset + 20 >= data.contractors.total}
                        onClick={() => setSelection({ siteId, offset: selection.offset + 20 })}
                      >
                        Next
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
