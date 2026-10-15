import { useTranslation } from 'react-i18next';
import { translate as tr } from '../../i18n';
import { localizeMessage } from '../../i18n/messages';
import { useQuery } from '@tanstack/react-query';
import type { WorkflowProps } from './safety-workflow';
import { RequestError } from './SafetyWorkflowUi';
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
  return (
    <section className="my-4 space-y-3 rounded-lg border border-[var(--border)] p-3">
      <h3 className="font-bold">{tr('safety_workspace.work_context')}</h3>
      {query.isPending && <p className="text-sm">{tr('safety_workspace.loading_context')}</p>}
      <RequestError error={query.error} retry={() => void query.refetch()} />
      {query.data && (
        <>
          <p className="text-sm">
            {tr('safety_workspace.zone_value1_camera_value2', {
              value1: query.data.zoneName ?? tr('labels.UNAVAILABLE'),
              value2: query.data.cameraName ?? tr('labels.UNAVAILABLE'),
            })}
          </p>
          {!query.data.workers.length && (
            <p className="text-sm">
              {tr(
                'safety_workspace.worker_unknown_safety_must_verify_the_responsible_contractor_before_handing_over',
              )}
            </p>
          )}
          {query.data.workers.map((w) => (
            <p key={w.id} className="text-sm">
              <strong>{w.displayName}</strong> ·{' '}
              {w.contractorName ?? tr('common.contractor_unavailable')} ·{' '}
              {w.teamName ?? tr('safety_workspace.team_unavailable_at_event_time')}
            </p>
          ))}
          {!!query.data.relatedTeams.length && (
            <div>
              <p className="text-xs font-semibold">
                {tr('safety_workspace.teams_with_recorded_grants_in_this_zone_at_event_time')}
              </p>
              {query.data.relatedTeams.map((t) => (
                <p key={t.id} className="text-xs">
                  {t.contractorName} · {t.name}
                </p>
              ))}
            </div>
          )}
          <p className="text-xs text-[var(--text-secondary)]">
            {localizeMessage(query.data.warning)}
          </p>
        </>
      )}
    </section>
  );
}
