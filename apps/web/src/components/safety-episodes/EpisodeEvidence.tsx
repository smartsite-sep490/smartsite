import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SafetyEpisode, SmartSiteManagementClient } from '@smartsite/api-client';
import { useTranslation } from 'react-i18next';
import { localizedLabel } from '../../i18n/labels';
import { SafetyAlertEvidencePanel } from '../alerts/SafetyAlertEvidencePanel';
import { Button } from '../ui';

export function EpisodeEvidence({
  episode,
  client,
  token,
  scope,
  apiUrl,
}: {
  episode: SafetyEpisode;
  client: SmartSiteManagementClient;
  token: string;
  scope: string;
  apiUrl: string;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const [findingId, setFindingId] = useState<string | null>(null);
  const finding = episode.findings.find((f) => f.alertId === findingId);
  const query = useQuery({
    queryKey: [
      'safety-episode-workspace',
      apiUrl,
      scope,
      'evidence-metadata',
      episode.siteId,
      episode.id,
      findingId,
    ],
    queryFn: ({ signal }) => client.getSafetyAlert(token, episode.siteId, findingId!, { signal }),
    enabled: !!finding,
    retry: false,
    gcTime: 0,
  });
  const response = query.data;
  const original =
    response?.id === findingId && response.siteId === episode.siteId
      ? response.detections.find((d) => d.eventId === episode.subject.eventId)
      : undefined;
  const allowed = new Set(
    finding?.evidenceRefs
      .filter(
        (ref) =>
          ref.eventId === episode.subject.eventId &&
          ref.personObservationIndex === episode.subject.personObservationIndex &&
          ref.available,
      )
      .map((ref) => ref.evidenceIndex),
  );
  const detection = original
    ? { ...original, evidence: original.evidence.filter((item) => allowed.has(item.index)) }
    : undefined;
  return (
    <section
      className="space-y-3.5 border-t border-slate-200/80 pt-4"
      aria-label={t('episodes.evidence')}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} className="text-sm font-semibold tracking-tight text-slate-950">
          {t('episodes.evidence')}
        </h3>
        <span className="text-xs font-medium text-slate-500 tabular-nums">
          {t('episodes.findings', { count: episode.findings.length })}
        </span>
      </div>
      <div role="group" aria-labelledby={headingId} className="grid gap-2 sm:grid-cols-2">
        {episode.findings.map((f) => {
          const isSelected = findingId === f.alertId;
          const label = t('ppeNotifications.' + f.candidateSubtype, {
            defaultValue: localizedLabel(f.candidateSubtype),
          });
          return (
            <Button
              key={f.alertId}
              size="md"
              variant={isSelected ? 'default' : 'outline'}
              onClick={() => setFindingId(f.alertId)}
              aria-pressed={isSelected}
              data-state={isSelected ? 'selected' : 'unselected'}
              title={label}
              leftIcon={
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full transition-colors ${
                    isSelected ? 'bg-[#F66B17] ring-2 ring-[#F66B17]/30' : 'bg-slate-300'
                  }`}
                />
              }
              className={`min-h-10 w-full justify-start text-left font-semibold leading-snug whitespace-normal ${
                isSelected
                  ? 'border border-[#071A2B] ring-2 ring-[#F66B17]/35'
                  : 'border-slate-200/90 text-slate-800 hover:border-slate-300 hover:bg-slate-50/80'
              }`}
            >
              <span className="block break-words [overflow-wrap:anywhere]">{label}</span>
            </Button>
          );
        })}
      </div>
      {!finding && (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-3.5 text-sm text-slate-600">
          {t('episodes.selectEvidence')}
        </p>
      )}
      {finding && query.isPending && (
        <p
          role="status"
          className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-3.5 text-sm font-medium text-slate-600"
        >
          {t('episodes.loading')}
        </p>
      )}
      {finding && query.isError && (
        <p
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5 text-sm font-medium text-slate-900"
        >
          {t('episodes.evidenceUnavailable')}
        </p>
      )}
      {finding &&
        query.isSuccess &&
        !query.isError &&
        (detection && detection.evidence.length ? (
          <div className="rounded-xl border border-slate-200/90 bg-slate-50/40 p-3">
            <SafetyAlertEvidencePanel
              key={`${findingId}:${episode.contentRevision}`}
              client={client}
              apiUrl={apiUrl}
              sessionScope={scope}
              token={token}
              siteId={episode.siteId}
              alertId={finding.alertId}
              detection={detection}
            />
          </div>
        ) : (
          <p
            role="status"
            className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-3.5 text-sm text-slate-600"
          >
            {t('episodes.evidenceUnavailable')}
          </p>
        ))}
    </section>
  );
}
