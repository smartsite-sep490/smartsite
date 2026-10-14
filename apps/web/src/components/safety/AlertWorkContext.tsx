import { useQuery } from '@tanstack/react-query';
import type { WorkflowProps } from './safety-workflow';
import { RequestError } from './SafetyWorkflowUi';
export function AlertWorkContext(p: WorkflowProps & { alertId: string; revision: number }) {
  const query = useQuery({
    queryKey: [
      'safety-workflow',
      p.apiUrl,
      p.scope,
      p.siteId,
      'alert-context',
      p.alertId,
      p.revision,
    ],
    queryFn: ({ signal }) => p.client.getAlertWorkContext(p.token, p.siteId, p.alertId, { signal }),
    enabled: !!p.alertId,
    retry: false,
  });
  return (
    <section className="my-4 space-y-3 rounded-lg border border-[var(--border)] p-3">
      <h3 className="font-bold">Work context</h3>
      {query.isPending && <p className="text-sm">Loading context…</p>}
      <RequestError error={query.error} retry={() => void query.refetch()} />
      {query.data && (
        <>
          <p className="text-sm">
            Zone: {query.data.zoneName ?? 'Unavailable'} · Camera:{' '}
            {query.data.cameraName ?? 'Unavailable'}
          </p>
          {!query.data.workers.length && (
            <p className="text-sm">
              Worker unknown. Safety must verify the responsible contractor before handing over.
            </p>
          )}
          {query.data.workers.map((w) => (
            <p key={w.id} className="text-sm">
              <strong>{w.displayName}</strong> · {w.contractorName ?? 'Contractor unavailable'} ·{' '}
              {w.teamName ?? 'Team unavailable at event time'}
            </p>
          ))}
          {!!query.data.relatedTeams.length && (
            <div>
              <p className="text-xs font-semibold">
                Teams with recorded grants in this Zone at event time
              </p>
              {query.data.relatedTeams.map((t) => (
                <p key={t.id} className="text-xs">
                  {t.contractorName} · {t.name}
                </p>
              ))}
            </div>
          )}
          <p className="text-xs text-[var(--text-secondary)]">{query.data.warning}</p>
        </>
      )}
    </section>
  );
}
