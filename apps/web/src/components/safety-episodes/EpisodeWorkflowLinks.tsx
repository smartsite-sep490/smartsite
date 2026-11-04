import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { SafetyEpisode } from '@smartsite/api-client';
import { localizedLabel } from '../../i18n/labels';

/** Navigation only; the existing workflow rechecks authority and every state transition. */
export function EpisodeWorkflowLinks({ episode }: { episode: SafetyEpisode }) {
  const { t } = useTranslation();
  if (!episode.workflowLinks.length) return null;
  return (
    <section
      className="space-y-3 border-t border-slate-200 pt-4"
      aria-label={t('episodes.workflow')}
    >
      <h3 className="font-semibold">{t('episodes.workflow')}</h3>
      <ul className="space-y-3">
        {episode.workflowLinks.map((incident) => (
          <li key={incident.incidentId} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link
                className="text-sm font-semibold underline underline-offset-4 focus-visible:outline-2"
                to={`/incidents?${new URLSearchParams({ siteId: episode.siteId, incidentId: incident.incidentId })}`}
              >
                {t('episodes.openIncident')}
              </Link>
              <span className="text-sm text-slate-600">{localizedLabel(incident.status)}</span>
            </div>
            {incident.actions.length > 0 && (
              <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                {incident.actions.map((action) => (
                  <li
                    key={action.actionId}
                    className="flex flex-wrap items-center justify-between gap-3"
                  >
                    <Link
                      className="text-sm underline underline-offset-4 focus-visible:outline-2"
                      to={`/incidents?${new URLSearchParams({ siteId: episode.siteId, incidentId: incident.incidentId, actionId: action.actionId })}`}
                    >
                      {t('episodes.openAction')}
                    </Link>
                    <span className="text-sm text-slate-600">{localizedLabel(action.status)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
