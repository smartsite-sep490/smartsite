import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  TrackedEpisodeMediaRepresentation,
  TrackedEpisodeMediaSource,
  TrackedEpisodeOriginalObservation,
} from '@smartsite/contracts/tracked-episode-frames';
import { uiLocale } from '../../i18n';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { IconAlertCircle, IconClock, IconEye, IconLoader, IconRefresh, IconUser } from '../icons';
import { Badge, Button, Card } from '../ui';
import './tracked-observation-history-catalog';

export type TrackedObservationHistoryStatus = 'LOADING' | 'READY' | 'ERROR' | 'FORBIDDEN';

export interface TrackedObservationHistoryProps {
  scopeKey: string;
  items: readonly TrackedEpisodeOriginalObservation[];
  total: number;
  hasMore: boolean;
  status: TrackedObservationHistoryStatus;
  isLoadingMore: boolean;
  loadMoreError: string | null;
  onLoadMore(): void;
  onRetry(): void;
  onOpenSource(
    source: TrackedEpisodeMediaSource,
    representation: TrackedEpisodeMediaRepresentation,
  ): void;
}

interface SelectedMediaRequest {
  key: string;
  source: TrackedEpisodeMediaSource;
  representation: TrackedEpisodeMediaRepresentation;
}

const shortId = (value: string) => (value.length > 8 ? value.slice(0, 8) : value);
const formatCapturedAt = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString(uiLocale()) : value;
};
const rowKeyOf = (item: TrackedEpisodeOriginalObservation, index: number) =>
  `${item.alertId}:${item.eventId}:${item.personObservationIndex}:${item.sourceSequence}:${index}`;
const selectionKeyOf = (
  source: TrackedEpisodeMediaSource,
  representation: TrackedEpisodeMediaRepresentation,
) =>
  `${source.alertId}:${source.eventId}:${source.personObservationIndex}:${source.evidenceIndex}:${representation}`;

export function TrackedObservationHistory(props: TrackedObservationHistoryProps) {
  return <TrackedObservationHistoryContent key={props.scopeKey} {...props} />;
}

function TrackedObservationHistoryContent({
  items,
  total,
  hasMore,
  status,
  isLoadingMore,
  loadMoreError,
  onLoadMore,
  onRetry,
  onOpenSource,
}: TrackedObservationHistoryProps) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const [expandedRowKeys, setExpandedRowKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedRequest, setSelectedRequest] = useState<SelectedMediaRequest | null>(null);

  const toggleRow = (rowKey: string) => {
    setExpandedRowKeys((current) => {
      const next = new Set(current);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const handleOpenSource = (
    source: TrackedEpisodeMediaSource,
    representation: TrackedEpisodeMediaRepresentation,
  ) => {
    setSelectedRequest({ key: selectionKeyOf(source, representation), source, representation });
    onOpenSource(source, representation);
  };

  const loadedCount = items.length;

  return (
    <section
      aria-label={t('trackedHistory.title')}
      data-testid="tracked-observation-history"
      className="space-y-4"
    >
      <div className="space-y-1">
        <h3 className="text-base font-bold text-slate-900">{t('trackedHistory.title')}</h3>
        <p className="text-xs leading-relaxed text-slate-600">{t('trackedHistory.subtitle')}</p>
        <p className="text-xs font-medium text-slate-700">{t('trackedHistory.cropDisclaimer')}</p>
      </div>

      {status === 'LOADING' && (
        <Card
          role="status"
          aria-live="polite"
          data-testid="tracked-history-loading"
          className="flex items-center gap-2.5 text-sm text-slate-700"
        >
          <IconLoader className="h-4 w-4 animate-spin text-slate-600" />
          <span>{t('trackedHistory.loading')}</span>
        </Card>
      )}

      {status === 'ERROR' && (
        <Card
          role="alert"
          data-testid="tracked-history-error"
          className="flex flex-wrap items-center justify-between gap-3 border-rose-200 bg-rose-50/60 text-sm text-rose-900"
        >
          <div className="flex items-center gap-2">
            <IconAlertCircle className="h-4 w-4 shrink-0 text-rose-700" />
            <span>{t('trackedHistory.error')}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRetry()}
            leftIcon={<IconRefresh className="h-3.5 w-3.5" />}
          >
            {t('trackedHistory.retry')}
          </Button>
        </Card>
      )}

      {status === 'FORBIDDEN' && (
        <Card
          role="alert"
          data-testid="tracked-history-forbidden"
          className="flex items-center gap-2.5 border-amber-200 bg-amber-50/70 text-sm text-amber-950"
        >
          <IconAlertCircle className="h-4 w-4 shrink-0 text-amber-700" />
          <span>{t('trackedHistory.forbidden')}</span>
        </Card>
      )}

      {status === 'READY' && loadedCount === 0 && (
        <Card
          role="status"
          aria-live="polite"
          data-testid="tracked-history-empty"
          className="text-sm text-slate-600"
        >
          {t('trackedHistory.empty')}
        </Card>
      )}

      {status === 'READY' && loadedCount > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              role="status"
              aria-live="polite"
              data-testid="tracked-history-count"
              className="text-xs font-semibold tabular-nums text-slate-600"
            >
              {t('trackedHistory.count', { loaded: loadedCount, total })}
            </p>
            {selectedRequest && (
              <p
                role="status"
                aria-live="polite"
                data-testid="tracked-history-selected-source"
                className="text-xs font-medium tabular-nums text-slate-700"
              >
                {t('trackedHistory.selectedSourceNotice', {
                  evidenceIndex: selectedRequest.source.evidenceIndex,
                  representation: selectedRequest.representation,
                  personIndex: selectedRequest.source.personObservationIndex,
                })}
              </p>
            )}
          </div>

          <ol className="space-y-3" data-testid="tracked-history-list">
            {items.map((item, rowIndex) => {
              const rowKey = rowKeyOf(item, rowIndex);
              const isExpanded = expandedRowKeys.has(rowKey);
              const technicalId = `tracked-history-tech-${rowIndex}`;
              const ppeIndexes =
                item.observationIndexes.length > 0
                  ? item.observationIndexes.join(', ')
                  : t('trackedHistory.none');
              const technicalEntries = [
                {
                  key: 'ppe',
                  label: t('trackedHistory.ppeObservationCount', {
                    count: item.observationIndexes.length,
                  }),
                  value: ppeIndexes,
                },
                {
                  key: 'person',
                  label: t('trackedHistory.personObservationIndex'),
                  value: String(item.personObservationIndex),
                },
                {
                  key: 'seq',
                  label: t('trackedHistory.sourceSequence'),
                  value: item.sourceSequence,
                },
                { key: 'alert', label: t('trackedHistory.alertId'), value: item.alertId },
                { key: 'event', label: t('trackedHistory.eventId'), value: item.eventId },
                { key: 'hash', label: t('trackedHistory.payloadHash'), value: item.payloadHash },
                ...item.frames.map((frame) => ({
                  key: `frame-${frame.evidenceIndex}-${frame.sha256}`,
                  label: t('trackedHistory.frameSha256', { index: frame.evidenceIndex }),
                  value: frame.sha256,
                })),
              ];

              return (
                <li
                  key={rowKey}
                  data-testid="tracked-history-item"
                  className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                        <IconClock className="h-3.5 w-3.5 text-slate-500" />
                        <time
                          dateTime={item.capturedAt}
                          className="font-mono text-xs tabular-nums text-slate-900"
                        >
                          {formatCapturedAt(item.capturedAt)}
                        </time>
                      </span>
                      <Badge variant="default">
                        <IconUser className="h-3 w-3" />
                        <span className="tabular-nums">
                          {t('trackedHistory.personSlot', { index: item.personObservationIndex })}
                        </span>
                      </Badge>
                      <Badge variant="neutral">
                        <span className="font-mono">
                          {t('trackedHistory.eventShort', { shortId: shortId(item.eventId) })}
                        </span>
                      </Badge>
                      <Badge variant="info">
                        <span className="font-mono">
                          {t('trackedHistory.findingShort', { shortId: shortId(item.alertId) })}
                        </span>
                      </Badge>
                      <Badge variant="neutral">
                        <span className="tabular-nums">
                          {t('trackedHistory.descriptorsCount', { count: item.frames.length })}
                        </span>
                      </Badge>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-expanded={isExpanded}
                      aria-controls={technicalId}
                      onClick={() => toggleRow(rowKey)}
                    >
                      {t(
                        isExpanded
                          ? 'trackedHistory.hideTechnical'
                          : 'trackedHistory.showTechnical',
                      )}
                    </Button>
                  </div>

                  {item.frames.length === 0 ? (
                    <p className="mt-3 text-xs text-slate-500">
                      {t('trackedHistory.noDescriptors')}
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                      {item.frames.map((frame) => {
                        const source: TrackedEpisodeMediaSource = {
                          alertId: item.alertId,
                          eventId: item.eventId,
                          personObservationIndex: item.personObservationIndex,
                          evidenceIndex: frame.evidenceIndex,
                        };
                        const isFrame = selectedRequest?.key === selectionKeyOf(source, 'FRAME');
                        const isSubject =
                          selectedRequest?.key === selectionKeyOf(source, 'SUBJECT');

                        return (
                          <div
                            key={`${item.alertId}:${item.eventId}:${item.personObservationIndex}:${frame.evidenceIndex}`}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/70 bg-slate-50/70 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <span className="block text-xs font-semibold tabular-nums text-slate-800">
                                {t('trackedHistory.descriptorBadge', {
                                  index: frame.evidenceIndex,
                                })}
                              </span>
                              <span className="block text-[11px] text-slate-500">
                                {t('trackedHistory.descriptorHint')}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                size="sm"
                                variant={isFrame ? 'default' : 'outline'}
                                aria-pressed={isFrame}
                                leftIcon={<IconEye className="h-3.5 w-3.5" />}
                                onClick={() => handleOpenSource(source, 'FRAME')}
                              >
                                {t('trackedHistory.openFullFrame', { index: frame.evidenceIndex })}
                              </Button>
                              <Button
                                size="sm"
                                variant={isSubject ? 'default' : 'secondary'}
                                aria-pressed={isSubject}
                                leftIcon={<IconUser className="h-3.5 w-3.5" />}
                                onClick={() => handleOpenSource(source, 'SUBJECT')}
                              >
                                {t('trackedHistory.openPersonCrop', { index: frame.evidenceIndex })}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {isExpanded && (
                    <dl
                      id={technicalId}
                      data-testid="tracked-history-technical"
                      className="mt-3 grid gap-2 rounded-xl border border-slate-200/80 bg-slate-50 p-3 text-xs text-slate-700 sm:grid-cols-2"
                    >
                      {technicalEntries.map((entry) => (
                        <div key={entry.key} className="min-w-0">
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
            })}
          </ol>

          {loadMoreError !== null && (
            <div
              role="alert"
              data-testid="tracked-history-load-more-error"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"
            >
              <div className="flex min-w-0 items-center gap-2">
                <IconAlertCircle className="h-4 w-4 shrink-0 text-amber-700" />
                <span className="break-words">
                  {t('trackedHistory.loadMoreError')}{' '}
                  {loadMoreError.trim() ? `(${loadMoreError})` : ''}
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={isLoadingMore}
                onClick={() => {
                  if (!isLoadingMore) onRetry();
                }}
                leftIcon={<IconRefresh className="h-3.5 w-3.5" />}
              >
                {t('trackedHistory.retryLoadMore')}
              </Button>
            </div>
          )}

          {(hasMore || isLoadingMore) && (
            <div>
              <Button
                variant="outline"
                data-testid="tracked-history-load-more"
                disabled={isLoadingMore}
                isLoading={isLoadingMore}
                onClick={() => {
                  if (!isLoadingMore) onLoadMore();
                }}
              >
                {t(isLoadingMore ? 'trackedHistory.loadingMore' : 'trackedHistory.loadMore')}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
