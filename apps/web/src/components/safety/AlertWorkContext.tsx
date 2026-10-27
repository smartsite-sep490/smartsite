import { useTranslation } from 'react-i18next';
import { translate as tr } from '../../i18n';
import { localizeMessage } from '../../i18n/messages';
import { useQuery } from '@tanstack/react-query';
import { type WorkflowProps, date } from './safety-workflow';
import { RequestError, StatusBadge, TechnicalDetails } from './SafetyWorkflowUi';

export function AlertWorkContext(p: WorkflowProps & { alertId: string; revision: number }) {
  useTranslation();

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

  const zoneLabel = query.data?.zoneName ?? tr('labels.UNAVAILABLE');
  const cameraLabel = query.data?.cameraName ?? tr('labels.UNAVAILABLE');

  return (
    <section className="my-4 min-w-0 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-white)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="font-bold text-[var(--text-heading)]">
            {tr('safety_workspace.work_context')}
          </h3>
          {query.isSuccess && query.data && <StatusBadge value={query.data.identity} />}
        </div>
        {query.isSuccess && query.data && (
          <span className="text-xs text-[var(--text-secondary)]">
            {tr('safety_workspace.captured_value1', { value1: date(query.data.capturedAt) })}
          </span>
        )}
      </div>

      {query.isPending && (
        <p className="text-sm text-[var(--text-secondary)]">
          {tr('safety_workspace.loading_context')}
        </p>
      )}
      <RequestError error={query.error} retry={() => void query.refetch()} />

      {query.isSuccess && query.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <dl className="min-w-0 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-canvas)] p-3 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="shrink-0 text-xs font-semibold text-[var(--text-secondary)]">
                  {tr('common.zone')}
                </dt>
                <dd className="min-w-0 break-words [overflow-wrap:anywhere] text-right font-medium text-[var(--text-heading)]">
                  {zoneLabel}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2 border-t border-[var(--border)] pt-2">
                <dt className="shrink-0 text-xs font-semibold text-[var(--text-secondary)]">
                  {tr('common.camera')}
                </dt>
                <dd className="min-w-0 break-words [overflow-wrap:anywhere] text-right font-medium text-[var(--text-heading)]">
                  {cameraLabel}
                </dd>
              </div>
            </dl>

            <div className="min-w-0 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-canvas)] p-3">
              <p className="text-xs font-semibold text-[var(--text-secondary)]">
                {tr('common.workers')}
              </p>

              {!query.data.workers.length && (
                <div className="rounded-md bg-[var(--semantic-amber-bg)] p-2.5 text-[var(--semantic-amber-text)]">
                  <p className="break-words text-sm font-medium">
                    {tr(
                      'safety_workspace.worker_unknown_safety_must_verify_the_responsible_contractor_before_handing_over',
                    )}
                  </p>
                </div>
              )}

              {query.data.workers.map((w) => (
                <div
                  key={w.id}
                  className="min-w-0 border-t border-[var(--border)] pt-2 first:border-t-0 first:pt-0"
                >
                  <strong className="block break-words [overflow-wrap:anywhere] text-sm text-[var(--text-heading)]">
                    {w.displayName}
                  </strong>
                  <span className="block break-words [overflow-wrap:anywhere] text-xs text-[var(--text-secondary)]">
                    {w.contractorName ?? tr('common.contractor_unavailable')} ·{' '}
                    {w.teamName ?? tr('safety_workspace.team_unavailable_at_event_time')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="min-w-0 space-y-2 rounded-lg bg-[var(--surface-bone)] p-3">
            {!!query.data.relatedTeams.length && (
              <div className="min-w-0 space-y-1.5">
                <p className="text-xs font-semibold text-[var(--text-heading)]">
                  {tr('safety_workspace.teams_with_recorded_grants_in_this_zone_at_event_time')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {query.data.relatedTeams.map((t) => (
                    <p
                      key={t.id}
                      className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] rounded border border-[var(--border)] bg-[var(--surface-white)] px-2 py-1 text-xs text-[var(--text-body)]"
                    >
                      {t.contractorName} · {t.name}
                    </p>
                  ))}
                </div>
              </div>
            )}
            <p className="break-words [overflow-wrap:anywhere] text-xs text-[var(--text-secondary)]">
              {localizeMessage(query.data.warning)}
            </p>
            <TechnicalDetails>
              <dl className="grid gap-1 font-mono">
                <div className="flex flex-wrap gap-2">
                  <dt className="shrink-0 font-semibold">{tr('common.site')}</dt>
                  <dd className="min-w-0 break-all">{p.siteId || tr('labels.UNAVAILABLE')}</dd>
                </div>
              </dl>
            </TechnicalDetails>
          </div>
        </>
      )}
    </section>
  );
}
