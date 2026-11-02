import { useTranslation } from 'react-i18next';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { IconAlertCircle, IconBuilding, IconLoader, IconRefresh } from '../icons';
import { Badge, Button, Card } from '../ui';
import { SafetyEpisodeInboxRow } from './SafetyEpisodeInboxRow';
import { useSafetyEpisodeInbox, type UseSafetyEpisodeInboxParams } from './useSafetyEpisodeInbox';

export type SafetyEpisodeInboxListProps = UseSafetyEpisodeInboxParams;

export function SafetyEpisodeInboxList(props: SafetyEpisodeInboxListProps) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const {
    isHardForbidden,
    isInitialOrRetryLoading,
    isRetryableBaseError,
    isTransientNextPageError,
    isFetching,
    isFetchingNextPage,
    authorizedItems,
    groupedBySite,
    rawReturnedCount,
    serverTotal,
    serverUnreadCount,
    hasMore,
    nextPageErrorMessage,
    pendingReadById,
    readErrorById,
    acknowledgedReads,
    openTechById,
    handleOpenAuthorizedEpisode,
    handleMarkRead,
    handleLoadMore,
    handleRetryBase,
    toggleTechDetails,
  } = useSafetyEpisodeInbox(props);

  if (isHardForbidden) {
    return (
      <div
        role="alert"
        data-testid="safety-inbox-forbidden"
        className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950"
      >
        <IconAlertCircle className="h-4 w-4 shrink-0 text-amber-700" />
        <span>{t('safetyInbox.forbidden')}</span>
      </div>
    );
  }

  if (isInitialOrRetryLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="safety-inbox-loading"
        className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700"
      >
        <IconLoader className="h-4 w-4 animate-spin text-slate-600" />
        <span>{t('safetyInbox.loading')}</span>
      </div>
    );
  }

  if (isRetryableBaseError) {
    return (
      <div
        role="alert"
        data-testid="safety-inbox-error"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-900"
      >
        <div className="flex items-center gap-2">
          <IconAlertCircle className="h-4 w-4 shrink-0 text-rose-700" />
          <span>{t('safetyInbox.error')}</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          data-testid="safety-inbox-retry"
          disabled={isFetching}
          onClick={handleRetryBase}
          leftIcon={<IconRefresh className="h-3.5 w-3.5" />}
        >
          {t('safetyInbox.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="safety-inbox-ready">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700">
        <span data-testid="safety-inbox-summary-counts" className="font-medium tabular-nums">
          {t('safetyInbox.summaryCounts', {
            unread: serverUnreadCount,
            total: serverTotal,
            loaded: authorizedItems.length,
          })}
        </span>
        {rawReturnedCount < serverTotal && rawReturnedCount > 0 && (
          <span
            data-testid="safety-inbox-partial-coverage"
            className="font-mono text-xs text-slate-600"
          >
            {t('safetyInbox.partialCoverage', {
              loaded: authorizedItems.length,
              total: serverTotal,
            })}
          </span>
        )}
      </div>

      {authorizedItems.length === 0 ? (
        hasMore ? (
          <div
            role="status"
            data-testid="safety-inbox-partial-empty"
            className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600"
          >
            {t('safetyInbox.partialEmpty')}
          </div>
        ) : (
          <div
            role="status"
            data-testid="safety-inbox-empty"
            className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600"
          >
            {t(
              rawReturnedCount > 0
                ? 'safetyInbox.emptyFilteredSites'
                : props.readStatus === 'UNREAD'
                  ? 'safetyInbox.emptyUnread'
                  : 'safetyInbox.emptyAll',
            )}
          </div>
        )
      ) : (
        <div className="space-y-4" data-testid="safety-inbox-site-groups">
          {props.allowedSites.map((site) => {
            const siteRows = groupedBySite.get(site.key);
            if (!siteRows || siteRows.length === 0) {
              return null;
            }
            return (
              <Card
                key={site.key}
                data-testid={`safety-inbox-site-group-${site.id}`}
                className="space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <IconBuilding className="h-4 w-4 text-slate-600" />
                    <h3
                      data-testid={`safety-inbox-site-name-${site.id}`}
                      className="text-sm font-bold text-slate-900"
                    >
                      {site.name}
                    </h3>
                  </div>
                  <Badge variant="neutral" data-testid={`safety-inbox-site-count-${site.id}`}>
                    <span className="tabular-nums">
                      {t('safetyInbox.siteGroupLoaded', { count: siteRows.length })}
                    </span>
                  </Badge>
                </div>

                <ul
                  className="divide-y divide-slate-100"
                  data-testid={`safety-inbox-site-list-${site.id}`}
                >
                  {siteRows.map((item) => {
                    const recipientKey = item.id.toLowerCase();
                    return (
                      <SafetyEpisodeInboxRow
                        key={item.id}
                        item={item}
                        instanceId={props.instanceId}
                        ack={acknowledgedReads[recipientKey]}
                        isRowPending={Boolean(pendingReadById[recipientKey])}
                        rowError={readErrorById[recipientKey] ?? null}
                        isTechOpen={Boolean(openTechById[recipientKey])}
                        onOpen={handleOpenAuthorizedEpisode}
                        onMarkRead={(target) => void handleMarkRead(target)}
                        onToggleTech={toggleTechDetails}
                      />
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      {nextPageErrorMessage && (
        <div
          role="alert"
          data-testid="safety-inbox-next-page-error"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/70 p-3 text-xs text-rose-900"
        >
          <div className="flex items-center gap-2">
            <IconAlertCircle className="h-4 w-4 shrink-0 text-rose-700" />
            <span>{nextPageErrorMessage}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            data-testid="safety-inbox-retry-load-more"
            disabled={isFetching || isFetchingNextPage}
            onClick={handleLoadMore}
            leftIcon={<IconRefresh className="h-3.5 w-3.5" />}
          >
            {t('safetyInbox.retryLoadMore')}
          </Button>
        </div>
      )}

      {hasMore && !isTransientNextPageError && (
        <div className="flex justify-center pt-1">
          <Button
            size="sm"
            variant="outline"
            data-testid="safety-inbox-load-more"
            disabled={isFetching || isFetchingNextPage}
            onClick={handleLoadMore}
          >
            {isFetchingNextPage ? t('safetyInbox.loadingMore') : t('safetyInbox.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
