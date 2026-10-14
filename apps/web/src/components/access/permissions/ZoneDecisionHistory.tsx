import { localizedError } from '../../../i18n/messages';
import { localizedLabel } from '../../../i18n/labels';
import { uiLocale } from '../../../i18n';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { zoneDecisionLabel } from './accessControlUtils';

export function ZoneDecisionHistory({
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
  useTranslation();

  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const [offset, setOffset] = useState(0);
  const decisions = useQuery({
    queryKey: ['access-control', apiUrl, sessionScope, siteId, 'zone-history', offset],
    queryFn: () => client.listZoneEntryDecisions(token, siteId, { offset, limit: 20 }),
    refetchInterval: 15_000,
  });
  return (
    <section className="space-y-3 rounded-2xl border bg-white p-6">
      <h2 className="font-bold">{tr('zone_decision_history.zone_entry_decision_history')}</h2>
      {decisions.isPending && <p role="status">{tr('common.loading_entry_decisions')}</p>}
      {decisions.error && (
        <p role="alert">
          {localizedError(decisions.error.message)}{' '}
          <button onClick={() => void decisions.refetch()}>{tr('common.retry')}</button>
        </p>
      )}
      {!decisions.isPending && !decisions.error && !decisions.data?.items.length && (
        <p>{tr('zone_decision_history.no_entry_decisions_at_this_site')}</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>{tr('common.identity')}</th>
              <th>{tr('common.decision')}</th>
              <th>{tr('common.track')}</th>
              <th>{tr('common.reason')}</th>
              <th>{tr('common.observed_at')}</th>
            </tr>
          </thead>
          <tbody>
            {decisions.data?.items.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.workerId ??
                    (d.candidateWorkerId
                      ? tr('common.candidate_value', { value1: d.candidateWorkerId })
                      : tr('common.unknown'))}
                </td>
                <td>{zoneDecisionLabel(d.status)}</td>
                <td>#{d.trackId}</td>
                <td>{localizedLabel(d.reasonCode.replaceAll('_', ' '))}</td>
                <td>{new Date(d.evaluatedAt).toLocaleString(uiLocale())}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!decisions.data && decisions.data.total > 20 && (
        <div className="flex gap-3">
          <button disabled={!offset} onClick={() => setOffset((o) => Math.max(0, o - 20))}>
            {tr('common.previous')}
          </button>
          <button
            disabled={offset + 20 >= decisions.data.total}
            onClick={() => setOffset((o) => o + 20)}
          >
            {tr('common.next')}
          </button>
        </div>
      )}
    </section>
  );
}
