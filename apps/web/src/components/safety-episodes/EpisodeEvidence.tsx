import { useState } from 'react';
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
    <section className="space-y-3" aria-label={t('episodes.evidence')}>
      <h3 className="font-semibold">{t('episodes.evidence')}</h3>
      <div className="flex flex-wrap gap-2">
        {episode.findings.map((f) => (
          <Button
            key={f.alertId}
            size="sm"
            variant="outline"
            onClick={() => setFindingId(f.alertId)}
            aria-pressed={findingId === f.alertId}
          >
            {t('ppeNotifications.' + f.candidateSubtype, {
              defaultValue: localizedLabel(f.candidateSubtype),
            })}
          </Button>
        ))}
      </div>
      {!finding && <p className="text-sm text-slate-600">{t('episodes.selectEvidence')}</p>}
      {finding && query.isPending && <p role="status">{t('episodes.loading')}</p>}
      {finding && query.isError && <p role="alert">{t('episodes.evidenceUnavailable')}</p>}
      {finding &&
        query.isSuccess &&
        !query.isError &&
        (detection && detection.evidence.length ? (
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
        ) : (
          <p role="status">{t('episodes.evidenceUnavailable')}</p>
        ))}
    </section>
  );
}
