import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { useAuth, useCurrentUser } from '../../../features/auth/auth-session';

export function ContractorParticipationDirectory({ apiUrl }: { apiUrl: string }) {
  const { accessToken } = useAuth();
  const { data: user } = useCurrentUser(apiUrl);
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const [contractorPage, setContractorPage] = useState(0);
  const [selection, setSelection] = useState({ contractorId: '', offset: 0 });
  const isAdmin = user?.roleAssignments.some((r) => r.role === 'ADMIN' && r.siteId === null);
  const directory = useQuery({
    queryKey: ['global-contractors', apiUrl, user?.id, contractorPage],
    queryFn: () =>
      client.listGlobalContractors(accessToken!, { offset: contractorPage, limit: 20 }),
    enabled: Boolean(accessToken && isAdmin),
  });
  const participation = useQuery({
    queryKey: [
      'contractor-participations',
      apiUrl,
      user?.id,
      selection.contractorId,
      selection.offset,
    ],
    queryFn: () =>
      client.listContractorParticipations(accessToken!, selection.contractorId, {
        offset: selection.offset,
        limit: 20,
      }),
    enabled: Boolean(accessToken && isAdmin && selection.contractorId),
  });
  const button =
    'rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-orange-300 disabled:opacity-40';
  const time = (value: string) => new Date(value).toLocaleString();
  if (!isAdmin) return null;
  return (
    <section
      aria-label="Contractor Site directory"
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
    >
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Contractor Site directory</h2>
          <p className="text-sm text-slate-500">
            Browse a contractor’s Site participation intervals across all Sites.
          </p>
        </div>
        <button
          type="button"
          className={button}
          disabled={directory.isFetching || participation.isFetching}
          onClick={() => {
            void directory.refetch();
            if (selection.contractorId) void participation.refetch();
          }}
        >
          Refresh directory
        </button>
      </div>
      {directory.isPending ? (
        <p role="status">Loading contractors…</p>
      ) : directory.isError ? (
        <div role="alert">
          {directory.error instanceof ApiError && directory.error.status === 403
            ? 'Contractor directory access denied.'
            : 'Contractor directory unavailable.'}{' '}
          <button type="button" className={button} onClick={() => void directory.refetch()}>
            Retry directory
          </button>
        </div>
      ) : !directory.data.items.length ? (
        <p>No contractors available.</p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-2">
            {directory.data.items.map((contractor) => (
              <li key={contractor.id}>
                <button
                  type="button"
                  className={button}
                  aria-pressed={selection.contractorId === contractor.id}
                  onClick={() => setSelection({ contractorId: contractor.id, offset: 0 })}
                >
                  {contractor.name}{' '}
                  <span className="text-xs text-slate-500">
                    {contractor.code}
                    {contractor.isActive ? '' : ' · Inactive'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {directory.data.total > 20 && (
            <nav aria-label="Contractor pages" className="flex justify-between gap-3">
              <button
                type="button"
                className={button}
                disabled={!contractorPage || directory.isFetching}
                onClick={() => {
                  setContractorPage(contractorPage - 20);
                  setSelection({ contractorId: '', offset: 0 });
                }}
              >
                Previous contractors
              </button>
              <span>
                {contractorPage + 1}–{Math.min(contractorPage + 20, directory.data.total)} of{' '}
                {directory.data.total}
              </span>
              <button
                type="button"
                className={button}
                disabled={contractorPage + 20 >= directory.data.total || directory.isFetching}
                onClick={() => {
                  setContractorPage(contractorPage + 20);
                  setSelection({ contractorId: '', offset: 0 });
                }}
              >
                Next contractors
              </button>
            </nav>
          )}
        </>
      )}
      {!selection.contractorId ? (
        <p className="text-sm text-slate-500">Select a contractor to view its Sites.</p>
      ) : participation.isPending ? (
        <p role="status">Loading Site participations…</p>
      ) : participation.isError ? (
        <div role="alert">
          {participation.error instanceof ApiError && participation.error.status === 403
            ? 'Site participation access denied.'
            : 'Site participations unavailable.'}{' '}
          <button type="button" className={button} onClick={() => void participation.refetch()}>
            Retry participations
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="font-semibold">Sites for {participation.data.contractor.name}</h3>
          <p className="text-xs text-slate-500">
            Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Status is evaluated by the
            Backend at query time. A Site may have multiple intervals.
          </p>
          {!participation.data.items.length ? (
            <p>No Site participations.</p>
          ) : (
            <ul className="space-y-2">
              {participation.data.items.map((item) => (
                <li key={item.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap justify-between gap-2">
                    <p className="font-semibold">
                      {item.site.name}{' '}
                      <span className="text-xs text-slate-500">{item.site.code}</span>
                    </p>
                    <span className="text-sm">{item.status}</span>
                  </div>
                  <p className="mt-1 text-sm">
                    {time(item.validFrom)} –{' '}
                    {item.validUntil ? time(item.validUntil) : 'No end date'}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {participation.data.total > 20 && (
            <nav aria-label="Participation pages" className="flex justify-between gap-3">
              <button
                type="button"
                className={button}
                disabled={!selection.offset || participation.isFetching}
                onClick={() => setSelection({ ...selection, offset: selection.offset - 20 })}
              >
                Previous participations
              </button>
              <span>
                {selection.offset + 1}–{Math.min(selection.offset + 20, participation.data.total)}{' '}
                of {participation.data.total} intervals
              </span>
              <button
                type="button"
                className={button}
                disabled={
                  selection.offset + 20 >= participation.data.total || participation.isFetching
                }
                onClick={() => setSelection({ ...selection, offset: selection.offset + 20 })}
              >
                Next participations
              </button>
            </nav>
          )}
        </div>
      )}
    </section>
  );
}
