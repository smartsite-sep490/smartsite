import type {
  SafetyEpisodeInboxItem,
  SafetyEpisodeReadResponse,
} from '@smartsite/contracts/safety-episodes';
import { useTranslation } from 'react-i18next';
import { uiLocale } from '../../i18n';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { IconAlertCircle, IconCheck, IconClock } from '../icons';
import { Badge, Button } from '../ui';
import { formatInboxTimestamp } from './safety-episode-inbox-state';

export interface SafetyEpisodeInboxRowProps {
  item: SafetyEpisodeInboxItem;
  instanceId: string;
  ack: SafetyEpisodeReadResponse | undefined;
  isRowPending: boolean;
  rowError: string | null;
  isTechOpen: boolean;
  onOpen(recipientId: string): void;
  onMarkRead(item: SafetyEpisodeInboxItem): void;
  onToggleTech(recipientKey: string): void;
}

export function SafetyEpisodeInboxRow({
  item,
  instanceId,
  ack,
  isRowPending,
  rowError,
  isTechOpen,
  onOpen,
  onMarkRead,
  onToggleTech,
}: SafetyEpisodeInboxRowProps) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const recipientKey = item.id.toLowerCase();
  const isAwaitingSummaryRefresh = Boolean(
    ack && ack.contentRevision > item.episode.contentRevision,
  );
  const techPanelId = `${instanceId}-row-tech-${item.id}`;
  const isTracked = item.episode.subject.kind === 'TRACKED';

  const technicalEntries = [
    { label: t('safetyInbox.recipientId'), value: item.id },
    { label: t('safetyInbox.episodeId'), value: item.episode.id },
    { label: t('safetyInbox.siteId'), value: item.episode.siteId },
    { label: t('safetyInbox.cameraId'), value: item.episode.cameraId },
    {
      label: t('safetyInbox.subjectKind'),
      value: item.episode.subject.kind,
    },
    ...(item.episode.subject.kind === 'TRACKED'
      ? [
          {
            label: t('safetyInbox.segmentId'),
            value: item.episode.subject.segmentId,
          },
          {
            label: t('safetyInbox.scopeSha256'),
            value: item.episode.subject.scopeSha256,
          },
        ]
      : [
          {
            label: t('safetyInbox.eventId'),
            value: item.episode.subject.eventId,
          },
          {
            label: t('safetyInbox.personIndex'),
            value: String(item.episode.subject.personObservationIndex),
          },
        ]),
    {
      label: t('safetyInbox.firstObservedAt'),
      value: item.episode.firstObservedAt,
    },
    {
      label: t('safetyInbox.firstDeliveredAt'),
      value: item.firstDeliveredAt,
    },
    { label: t('safetyInbox.updatedAt'), value: item.updatedAt },
  ];

  return (
    <li data-testid="safety-inbox-row" className="space-y-2.5 py-3 first:pt-1 last:pb-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant={item.unread ? 'warning' : 'neutral'}
              data-testid={`safety-inbox-row-status-${item.id}`}
            >
              {!item.unread && <IconCheck className="h-3 w-3" />}
              <span>{t(item.unread ? 'safetyInbox.statusUnread' : 'safetyInbox.statusRead')}</span>
            </Badge>

            <Badge variant="default" data-testid={`safety-inbox-row-revision-${item.id}`}>
              <span className="tabular-nums">
                {t('safetyInbox.revisionBadge', {
                  revision: item.episode.contentRevision,
                })}
              </span>
            </Badge>

            {item.seenRevision > 0 && (
              <Badge variant="neutral" data-testid={`safety-inbox-row-seen-${item.id}`}>
                <span className="tabular-nums">
                  {t('safetyInbox.seenRevisionBadge', {
                    revision: item.seenRevision,
                  })}
                </span>
              </Badge>
            )}

            <Badge variant={isTracked ? 'info' : 'neutral'}>
              {t(isTracked ? 'safetyInbox.kindTracked' : 'safetyInbox.kindEventLocal')}
            </Badge>

            <Badge variant={item.episode.collectionState === 'SEALED' ? 'neutral' : 'info'}>
              {t(
                item.episode.collectionState === 'SEALED'
                  ? 'safetyInbox.stateSealed'
                  : 'safetyInbox.stateCollecting',
              )}
            </Badge>
          </div>

          <p
            data-testid={`safety-inbox-row-subject-${item.id}`}
            className="text-xs font-medium text-slate-800"
          >
            {t('safetyInbox.subjectSummary', {
              count: item.episode.findingCount,
            })}
          </p>

          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
            <IconClock className="h-3.5 w-3.5 text-slate-500" />
            <span>{t('safetyInbox.lastObserved')}:</span>
            <time
              dateTime={item.episode.lastObservedAt}
              className="font-mono tabular-nums text-slate-800"
            >
              {formatInboxTimestamp(item.episode.lastObservedAt, uiLocale())}
            </time>
          </div>

          {isAwaitingSummaryRefresh && ack && (
            <p
              role="status"
              data-testid={`safety-inbox-awaiting-refresh-${item.id}`}
              className="text-xs font-medium text-amber-800"
            >
              {t('safetyInbox.awaitingRefresh', {
                revision: ack.contentRevision,
                seen: ack.seenRevision,
              })}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="default"
            data-testid={`safety-inbox-open-${item.id}`}
            onClick={() => onOpen(item.id)}
          >
            {t('safetyInbox.openEpisode')}
          </Button>

          <Button
            size="sm"
            variant="outline"
            disabled={!item.unread || isRowPending || isAwaitingSummaryRefresh}
            data-testid={`safety-inbox-mark-read-${item.id}`}
            onClick={() => onMarkRead(item)}
          >
            {isRowPending ? t('safetyInbox.markingRead') : t('safetyInbox.markRead')}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            data-testid={`safety-inbox-tech-toggle-${item.id}`}
            aria-expanded={isTechOpen}
            aria-controls={techPanelId}
            onClick={() => onToggleTech(recipientKey)}
          >
            {t(isTechOpen ? 'safetyInbox.hideTechnical' : 'safetyInbox.showTechnical')}
          </Button>
        </div>
      </div>

      {rowError && (
        <div
          role="alert"
          data-testid={`safety-inbox-read-error-${item.id}`}
          className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/80 p-2 text-xs text-rose-900"
        >
          <IconAlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-700" />
          <span>{rowError}</span>
        </div>
      )}

      {isTechOpen && (
        <dl
          id={techPanelId}
          data-testid={`safety-inbox-technical-${item.id}`}
          className="grid gap-2 rounded-lg border border-slate-200/80 bg-slate-50 p-2.5 text-xs text-slate-700 sm:grid-cols-2"
        >
          {technicalEntries.map((entry) => (
            <div key={entry.label} className="min-w-0">
              <dt className="font-semibold text-slate-600">{entry.label}</dt>
              <dd className="mt-0.5 break-all font-mono tabular-nums text-slate-900">
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}
