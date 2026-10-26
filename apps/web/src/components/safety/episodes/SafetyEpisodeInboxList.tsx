import { useTranslation } from 'react-i18next';
import {
  parseSafetyEpisodeReadCommand,
  type SafetyEpisodeInboxItem,
  type SafetyEpisodeReadCommand,
  type SafetyEpisodeSummary,
} from '@smartsite/contracts/safety-episodes';
import { SAFETY_NAMESPACE, uiLocale } from '../../../i18n';
import { buttonClass, cardClass, primaryClass } from '../safety-workflow';
import { RequestError, StatusBadge, TechnicalDetails } from '../SafetyWorkflowUi';
import './episode-catalog';

export interface SafetyEpisodeInboxSiteContextLabels {
  site?: string;
  cameras?: Readonly<Record<string, string>>;
}

export interface SafetyEpisodeInboxListProps {
  items: readonly SafetyEpisodeInboxItem[];
  total: number;
  unreadCount: number;
  selectedEpisodeId: string | null;
  contextLabelsBySiteId?: Readonly<Record<string, SafetyEpisodeInboxSiteContextLabels>>;
  onSelectEpisode: (episode: SafetyEpisodeSummary, inboxItemId: string) => void;
  onMarkRead?: (inboxItemId: string, command: SafetyEpisodeReadCommand) => void;
  isPendingReadId?: string | null;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

interface SiteEpisodeGroup {
  siteId: string;
  siteLabel: string;
  items: SafetyEpisodeInboxItem[];
  unreadCount: number;
}

function formatEpisodeTimestamp(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString(uiLocale());
}

function isInboxItemUnread(item: SafetyEpisodeInboxItem): boolean {
  return item.unread === true || item.seenRevision < item.episode.contentRevision;
}

function pickCanonicalInboxItem(
  existing: SafetyEpisodeInboxItem,
  incoming: SafetyEpisodeInboxItem,
): SafetyEpisodeInboxItem {
  if (incoming.episode.contentRevision > existing.episode.contentRevision) {
    return incoming;
  }
  if (incoming.episode.contentRevision < existing.episode.contentRevision) {
    return existing;
  }
  if (incoming.seenRevision > existing.seenRevision) {
    return {
      ...incoming,
      unread: incoming.unread || incoming.seenRevision < incoming.episode.contentRevision,
    };
  }
  if (incoming.seenRevision < existing.seenRevision) {
    return {
      ...existing,
      unread: existing.unread || existing.seenRevision < existing.episode.contentRevision,
    };
  }
  return {
    ...existing,
    unread:
      existing.unread ||
      incoming.unread ||
      existing.seenRevision < existing.episode.contentRevision,
  };
}

function dedupeInboxItems(items: readonly SafetyEpisodeInboxItem[]): SafetyEpisodeInboxItem[] {
  const byInboxId = new Map<string, SafetyEpisodeInboxItem>();
  for (const item of items) {
    const current = byInboxId.get(item.id);
    byInboxId.set(item.id, current ? pickCanonicalInboxItem(current, item) : item);
  }
  const byEpisodeId = new Map<string, SafetyEpisodeInboxItem>();
  for (const item of byInboxId.values()) {
    const current = byEpisodeId.get(item.episode.id);
    byEpisodeId.set(item.episode.id, current ? pickCanonicalInboxItem(current, item) : item);
  }
  return Array.from(byEpisodeId.values());
}

export function SafetyEpisodeInboxList({
  items,
  total,
  unreadCount,
  selectedEpisodeId,
  contextLabelsBySiteId,
  onSelectEpisode,
  onMarkRead,
  isPendingReadId = null,
  isLoading = false,
  error,
  onRetry,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: SafetyEpisodeInboxListProps) {
  const { t } = useTranslation(SAFETY_NAMESPACE);

  const visibleItems = dedupeInboxItems(items);
  const serverTotal = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  const safeUnreadCount = Number.isFinite(unreadCount) ? Math.max(0, Math.trunc(unreadCount)) : 0;
  const isPartial = visibleItems.length > 0 && (visibleItems.length !== serverTotal || hasMore);
  const isRefreshing = isLoading && visibleItems.length > 0;

  const siteGroupsMap = new Map<string, SiteEpisodeGroup>();
  for (const item of visibleItems) {
    const { siteId } = item.episode;
    let group = siteGroupsMap.get(siteId);
    if (!group) {
      const siteLabel =
        contextLabelsBySiteId?.[siteId]?.site?.trim() || t('episode.detail.siteFallback');
      group = { siteId, siteLabel, items: [], unreadCount: 0 };
      siteGroupsMap.set(siteId, group);
    }
    group.items.push(item);
    if (isInboxItemUnread(item)) {
      group.unreadCount += 1;
    }
  }
  const siteGroups = Array.from(siteGroupsMap.values());

  return (
    <section
      aria-label={t('episode.inbox.regionAria')}
      data-testid="safety-episode-inbox-list"
      className={`${cardClass} text-[var(--text-body)]`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h2
            data-testid="safety-episode-inbox-heading"
            className="break-words [overflow-wrap:anywhere] text-base font-bold"
          >
            {t('episode.inbox.heading')}
          </h2>
          <p
            data-testid="safety-episode-inbox-scope-note"
            className="break-words [overflow-wrap:anywhere] text-xs text-[var(--text-secondary)]"
          >
            {t('episode.inbox.scopeNote')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 font-mono tabular-nums">
          <div data-testid="safety-episode-inbox-unread-summary">
            <StatusBadge
              value={safeUnreadCount > 0 ? 'PENDING_REVIEW' : 'CLOSED'}
              text={t('episode.inbox.unreadSummaryBadge', { replace: { unread: safeUnreadCount } })}
            />
          </div>
          <div data-testid="safety-episode-inbox-total-summary">
            <StatusBadge
              value="CLOSED"
              text={t('episode.inbox.totalBadge', { replace: { total: serverTotal } })}
            />
          </div>
        </div>
      </header>

      {(isRefreshing || isPartial) && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
          {isPartial && (
            <span
              role="status"
              data-testid="safety-episode-inbox-partial-status"
              className="font-mono tabular-nums"
            >
              {t('episode.inbox.partialSummary', {
                replace: { shown: visibleItems.length, total: serverTotal },
              })}
            </span>
          )}
          {isRefreshing && (
            <span role="status" data-testid="safety-episode-inbox-refreshing">
              {t('episode.inbox.refreshing')}
            </span>
          )}
        </div>
      )}

      {Boolean(error) && (
        <div data-testid="safety-episode-inbox-error">
          <RequestError error={error} retry={onRetry} />
        </div>
      )}

      {isLoading && visibleItems.length === 0 ? (
        <p
          role="status"
          data-testid="safety-episode-inbox-loading"
          className="py-4 text-xs text-[var(--text-secondary)]"
        >
          {t('episode.inbox.loading')}
        </p>
      ) : visibleItems.length === 0 && !error ? (
        <p
          role="status"
          data-testid="safety-episode-inbox-empty"
          className="py-4 text-xs text-[var(--text-secondary)]"
        >
          {t('episode.inbox.empty')}
        </p>
      ) : (
        <div className="space-y-4">
          {siteGroups.map((group) => (
            <section
              key={group.siteId}
              aria-label={group.siteLabel}
              data-testid={`episode-inbox-site-group-${group.siteId}`}
              className="space-y-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-bone)] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
                <h3
                  data-testid={`episode-inbox-site-heading-${group.siteId}`}
                  className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-sm font-bold"
                >
                  {group.siteLabel}
                </h3>
                <span
                  data-testid={`episode-inbox-site-summary-${group.siteId}`}
                  className="shrink-0 font-mono tabular-nums text-xs font-semibold text-[var(--text-secondary)]"
                >
                  {t('episode.inbox.siteGroupSummary', {
                    replace: { shown: group.items.length, unread: group.unreadCount },
                  })}
                </span>
              </div>

              <ul className="space-y-2.5">
                {group.items.map((item) => {
                  const { episode } = item;
                  const isSelected = selectedEpisodeId === episode.id;
                  const isUnread = isInboxItemUnread(item);
                  const readCommand = parseSafetyEpisodeReadCommand({
                    seenRevision: episode.contentRevision,
                  });
                  const canMarkRead =
                    isUnread && typeof onMarkRead === 'function' && readCommand !== null;
                  const isPendingThisRead = isPendingReadId === item.id;
                  const cameraDisplay =
                    contextLabelsBySiteId?.[episode.siteId]?.cameras?.[episode.cameraId]?.trim() ||
                    t('episode.detail.cameraFallback');
                  const itemTitleId = `episode-inbox-title-${item.id}`;
                  const findingCount = Math.max(0, episode.findingCount);

                  return (
                    <li
                      key={item.id}
                      data-testid={`episode-inbox-item-${item.id}`}
                      className={`space-y-2.5 rounded-lg border p-3 bg-white ${
                        isSelected
                          ? 'border-[var(--action-primary)] ring-1 ring-[var(--action-primary)]'
                          : 'border-[var(--border)]'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p
                            id={itemTitleId}
                            data-testid={`episode-inbox-item-title-${item.id}`}
                            className="break-words [overflow-wrap:anywhere] text-sm font-bold"
                          >
                            {t('episode.detail.subjectTitle')}
                          </p>
                          <p className="break-words [overflow-wrap:anywhere] text-xs text-[var(--text-secondary)]">
                            {t(
                              episode.collectionState === 'SEALED'
                                ? 'episode.detail.sealedNote'
                                : 'episode.detail.collectingNote',
                            )}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <div data-testid={`episode-inbox-read-badge-${item.id}`}>
                            <StatusBadge
                              value={isUnread ? 'PENDING_REVIEW' : 'CLOSED'}
                              text={t(
                                isUnread ? 'episode.inbox.unreadBadge' : 'episode.inbox.readBadge',
                              )}
                            />
                          </div>
                          <div data-testid={`episode-inbox-collection-badge-${item.id}`}>
                            <StatusBadge
                              value={
                                episode.collectionState === 'SEALED' ? 'CLOSED' : 'IN_PROGRESS'
                              }
                              text={t(
                                episode.collectionState === 'SEALED'
                                  ? 'episode.detail.collectionSealed'
                                  : 'episode.detail.collectionCollecting',
                              )}
                            />
                          </div>
                        </div>
                      </div>

                      <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                        <div className="min-w-0">
                          <dt className="font-medium text-[var(--text-secondary)]">
                            {t('episode.detail.cameraLabel')}
                          </dt>
                          <dd
                            data-testid={`episode-inbox-camera-${item.id}`}
                            className="mt-0.5 font-semibold break-words [overflow-wrap:anywhere]"
                          >
                            {cameraDisplay}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="font-medium text-[var(--text-secondary)]">
                            {t('episode.detail.findingsHeading', {
                              replace: { count: findingCount },
                            })}
                          </dt>
                          <dd
                            data-testid={`episode-inbox-findings-${item.id}`}
                            className="mt-0.5 font-mono tabular-nums font-semibold"
                          >
                            {findingCount}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="font-medium text-[var(--text-secondary)]">
                            {t('episode.detail.firstObservedLabel')}
                          </dt>
                          <dd className="mt-0.5 font-mono tabular-nums font-semibold break-words [overflow-wrap:anywhere]">
                            {formatEpisodeTimestamp(episode.firstObservedAt)}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="font-medium text-[var(--text-secondary)]">
                            {t('episode.detail.lastObservedLabel')}
                          </dt>
                          <dd className="mt-0.5 font-mono tabular-nums font-semibold break-words [overflow-wrap:anywhere]">
                            {formatEpisodeTimestamp(episode.lastObservedAt)}
                          </dd>
                        </div>
                      </dl>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          data-testid={`episode-inbox-select-${item.id}`}
                          aria-describedby={itemTitleId}
                          aria-current={isSelected ? 'true' : undefined}
                          aria-pressed={isSelected}
                          onClick={() => onSelectEpisode(episode, item.id)}
                          className={`${isSelected ? primaryClass : buttonClass} min-h-8 px-3 py-1.5 text-xs focus-visible:outline-2`}
                        >
                          {t(
                            isSelected
                              ? 'episode.inbox.selectedEpisodeBtn'
                              : 'episode.inbox.selectEpisodeBtn',
                          )}
                        </button>

                        {canMarkRead && (
                          <button
                            type="button"
                            data-testid={`episode-inbox-mark-read-${item.id}`}
                            aria-describedby={itemTitleId}
                            disabled={isPendingThisRead}
                            aria-busy={isPendingThisRead ? 'true' : undefined}
                            onClick={() => onMarkRead(item.id, readCommand)}
                            className={`${buttonClass} min-h-8 px-3 py-1.5 text-xs focus-visible:outline-2`}
                          >
                            {isPendingThisRead
                              ? t('episode.inbox.markingReadBtn')
                              : t('episode.inbox.markReadBtn', {
                                  replace: { revision: episode.contentRevision },
                                })}
                          </button>
                        )}
                      </div>

                      <TechnicalDetails
                        key={`${item.id}:${episode.contentRevision}:${item.seenRevision}`}
                      >
                        <p className="font-mono">
                          {t('episode.inbox.techInboxLine', {
                            replace: {
                              inboxId: item.id,
                              episodeId: episode.id,
                              contentRevision: episode.contentRevision,
                              seenRevision: item.seenRevision,
                            },
                          })}
                        </p>
                        <p className="font-mono">
                          {t('episode.detail.techContextLine', {
                            replace: { siteId: episode.siteId, cameraId: episode.cameraId },
                          })}
                        </p>
                        <p className="font-mono">
                          {t('episode.detail.techSubjectLine', {
                            replace: {
                              kind: episode.subject.kind,
                              eventId: episode.subject.eventId,
                              index: episode.subject.personObservationIndex,
                            },
                          })}
                        </p>
                        <p className="font-mono">
                          {episode.configurationBundleId
                            ? t('episode.detail.techBundleActive', {
                                replace: { bundleId: episode.configurationBundleId },
                              })
                            : t('episode.detail.techBundleNull')}
                        </p>
                        <p className="font-mono">
                          {t('episode.inbox.techDeliveryLine', {
                            replace: {
                              firstDeliveredAt: item.firstDeliveredAt,
                              updatedAt: item.updatedAt,
                              findingCount,
                            },
                          })}
                        </p>
                      </TechnicalDetails>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {hasMore && typeof onLoadMore === 'function' && (
        <div className="border-t border-[var(--border)] pt-3">
          <button
            type="button"
            data-testid="safety-episode-inbox-load-more"
            disabled={isLoadingMore}
            aria-busy={isLoadingMore ? 'true' : undefined}
            onClick={onLoadMore}
            className={`${buttonClass} w-full min-h-9 text-xs focus-visible:outline-2`}
          >
            {t(isLoadingMore ? 'episode.inbox.loadingMoreBtn' : 'episode.inbox.loadMoreBtn')}
          </button>
        </div>
      )}
    </section>
  );
}
