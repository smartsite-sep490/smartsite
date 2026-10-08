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
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const [offset, setOffset] = useState(0);
  const decisions = useQuery({
    queryKey: ['access-control', apiUrl, sessionScope, siteId, 'zone-history', offset],
    queryFn: () => client.listZoneEntryDecisions(token, siteId, { offset, limit: 20 }),
    refetchInterval: 15_000,
  });
  return (
    <section className="space-y-3 rounded-2xl border bg-white p-6">
      <h2 className="font-bold">Zone entry decision history</h2>
      {decisions.isPending && <p role="status">Loading entry decisions…</p>}
      {decisions.error && (
        <p role="alert">
          {decisions.error.message} <button onClick={() => void decisions.refetch()}>Retry</button>
        </p>
      )}
      {!decisions.isPending && !decisions.error && !decisions.data?.items.length && (
        <p>No entry decisions at this Site.</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>Identity</th>
              <th>Decision</th>
              <th>Track</th>
              <th>Reason</th>
              <th>Observed at</th>
            </tr>
          </thead>
          <tbody>
            {decisions.data?.items.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.workerId ??
                    (d.candidateWorkerId ? `Candidate: ${d.candidateWorkerId}` : 'Unknown')}
                </td>
                <td>{zoneDecisionLabel(d.status)}</td>
                <td>#{d.trackId}</td>
                <td>{d.reasonCode.replaceAll('_', ' ')}</td>
                <td>{new Date(d.evaluatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!decisions.data && decisions.data.total > 20 && (
        <div className="flex gap-3">
          <button disabled={!offset} onClick={() => setOffset((o) => Math.max(0, o - 20))}>
            Previous
          </button>
          <button
            disabled={offset + 20 >= decisions.data.total}
            onClick={() => setOffset((o) => o + 20)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
