import { localizedLabel } from '../../../i18n/labels';
import { uiLocale } from '../../../i18n';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { useAuth, useCurrentUser } from '../../../features/auth/auth-session';

export function ContractorParticipationDirectory({ apiUrl }: { apiUrl: string }) {
  useTranslation();

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
  const time = (value: string) => new Date(value).toLocaleString(uiLocale());
  if (!isAdmin) return null;
  return (
    <section
      aria-label={tr('common.contractor_site_directory')}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
    >
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{tr('common.contractor_site_directory')}</h2>
          <p className="text-sm text-slate-500">
            {tr(
              'contractor_participation_directory.browse_a_contractor_s_site_participation_intervals_across_all_sites',
            )}
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
          {tr('common.refresh_directory')}
        </button>
      </div>
      {directory.isPending ? (
        <p role="status">{tr('common.loading_contractors')}</p>
      ) : directory.isError ? (
        <div role="alert">
          {directory.error instanceof ApiError && directory.error.status === 403
            ? tr('contractor_participation_directory.contractor_directory_access_denied')
            : tr('common.contractor_directory_unavailable')}{' '}
          <button type="button" className={button} onClick={() => void directory.refetch()}>
            {tr('common.retry_directory')}
          </button>
        </div>
      ) : !directory.data.items.length ? (
        <p>{tr('common.no_contractors_available')}</p>
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
                    {contractor.isActive ? '' : tr('common.inactive_9558f5')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {directory.data.total > 20 && (
            <nav aria-label={tr('common.contractor_pages')} className="flex justify-between gap-3">
              <button
                type="button"
                className={button}
                disabled={!contractorPage || directory.isFetching}
                onClick={() => {
                  setContractorPage(contractorPage - 20);
                  setSelection({ contractorId: '', offset: 0 });
                }}
              >
                {tr('common.previous_contractors')}
              </button>
              <span>
                {tr('common.value_value_of_value', {
                  value1: contractorPage + 1,
                  value2: Math.min(contractorPage + 20, directory.data.total),
                  value3: directory.data.total,
                })}
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
                {tr('common.next_contractors')}
              </button>
            </nav>
          )}
        </>
      )}
      {!selection.contractorId ? (
        <p className="text-sm text-slate-500">
          {tr('contractor_participation_directory.select_a_contractor_to_view_its_sites')}
        </p>
      ) : participation.isPending ? (
        <p role="status">{tr('common.loading_site_participations')}</p>
      ) : participation.isError ? (
        <div role="alert">
          {participation.error instanceof ApiError && participation.error.status === 403
            ? tr('contractor_participation_directory.site_participation_access_denied')
            : tr('common.site_participations_unavailable')}{' '}
          <button type="button" className={button} onClick={() => void participation.refetch()}>
            {tr('common.retry_participations')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="font-semibold">
            {tr('common.sites_for_value', { value1: participation.data.contractor.name })}
          </h3>
          <p className="text-xs text-slate-500">
            {tr(
              'contractor_participation_directory.timezone_value_status_is_evaluated_by_the_backend_at_query_time_a_site_may_have_mu',
              { value1: Intl.DateTimeFormat().resolvedOptions().timeZone },
            )}
          </p>
          {!participation.data.items.length ? (
            <p>{tr('common.no_site_participations')}</p>
          ) : (
            <ul className="space-y-2">
              {participation.data.items.map((item) => (
                <li key={item.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap justify-between gap-2">
                    <p className="font-semibold">
                      {item.site.name}{' '}
                      <span className="text-xs text-slate-500">{item.site.code}</span>
                    </p>
                    <span className="text-sm">{localizedLabel(item.status)}</span>
                  </div>
                  <p className="mt-1 text-sm">
                    {time(item.validFrom)} –{' '}
                    {item.validUntil ? time(item.validUntil) : tr('common.no_end_date')}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {participation.data.total > 20 && (
            <nav
              aria-label={tr('common.participation_pages')}
              className="flex justify-between gap-3"
            >
              <button
                type="button"
                className={button}
                disabled={!selection.offset || participation.isFetching}
                onClick={() => setSelection({ ...selection, offset: selection.offset - 20 })}
              >
                {tr('common.previous_participations')}
              </button>
              <span>
                {tr('contractor_participation_directory.value_value_of_value_intervals', {
                  value1: selection.offset + 1,
                  value2: Math.min(selection.offset + 20, participation.data.total),
                  value3: participation.data.total,
                })}
              </span>
              <button
                type="button"
                className={button}
                disabled={
                  selection.offset + 20 >= participation.data.total || participation.isFetching
                }
                onClick={() => setSelection({ ...selection, offset: selection.offset + 20 })}
              >
                {tr('common.next_participations')}
              </button>
            </nav>
          )}
        </div>
      )}
    </section>
  );
}
