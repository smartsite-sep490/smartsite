import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  sanitizeSafetyFrameKey,
  sanitizeSafetyQueryId,
  sanitizeSafetyUuid,
} from '../../components/safety-episodes/safetyUrlParams';
import { uiLocale } from '../../i18n';
import { translate as tr } from '../../i18n';
import { IconAlertTriangle, IconClock, IconHardHat } from '../../components/icons';
import type { usePpeFrameInboxPreview } from './usePpeFrameInboxPreview';

const inboxHref = '/incidents?tab=ppe-frames';

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (Number.isNaN(diffMs)) return date.toLocaleString(uiLocale());
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return tr('common.just_now');
    if (diffMinutes < 60) return tr('common.valuem_ago', { value1: diffMinutes });
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return tr('common.valueh_ago', { value1: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return tr('common.valued_ago', { value1: diffDays });
    return date.toLocaleDateString(uiLocale(), { day: '2-digit', month: '2-digit' });
  } catch {
    return isoString;
  }
}

export function PpeInboxBellPreview({
  query,
  siteIds,
  onNavigate,
}: {
  query: ReturnType<typeof usePpeFrameInboxPreview>;
  siteIds: readonly string[];
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const sites = siteIds.map((id) => id.toLowerCase());
  const allowed = new Set(sites);
  const rows = query.isSuccess
    ? query.data.items.filter(({ siteId }) => allowed.has(siteId.toLowerCase()))
    : [];

  return (
    <section aria-label={t('episodes.frameTitle')} className="border-b border-slate-200/80">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
        <h3 className="font-semibold text-slate-800">{t('episodes.frameTitle')}</h3>
        <Link
          to={inboxHref}
          onClick={onNavigate}
          className="font-semibold text-teal-800 underline underline-offset-2 hover:text-teal-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 rounded"
        >
          {t('episodes.all')}
        </Link>
      </div>
      {query.isPending && (
        <p role="status" className="px-4 pb-3 text-sm text-slate-600">
          {t('episodes.loading')}
        </p>
      )}
      {query.isError && (
        <p role="alert" className="px-4 pb-3 text-sm text-rose-700">
          {t('episodes.unavailable')}
        </p>
      )}
      {query.isSuccess && rows.length === 0 && (
        <p role="status" className="px-4 pb-3 text-sm text-slate-600">
          {t('episodes.empty')}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {rows.map(
            ({
              frameKey,
              siteId,
              cameraId,
              siteName,
              cameraName,
              cases,
              findingCount,
              capturedAt,
              unread,
            }) => {
              const allZones = cases.flatMap((entry) => entry.zoneEntries);
              const denials = allZones.filter((zone) => zone.status === 'DENIED');
              const laterDenials = denials.filter((zone) => zone.laterFrame).length;
              const deniedCount = denials.length - laterDenials;
              const pendingZoneCount = allZones.filter((zone) => zone.status === 'PENDING').length;
              const safeSiteId = sanitizeSafetyQueryId(siteId);
              const safeCameraId = sanitizeSafetyUuid(cameraId)?.toLowerCase();
              const safeFrameKey = sanitizeSafetyFrameKey(frameKey);
              const itemParams = new URLSearchParams({ tab: 'ppe-frames' });
              if (safeSiteId) itemParams.set('siteId', safeSiteId);
              if (safeSiteId && safeCameraId) itemParams.set('cameraId', safeCameraId);
              if (safeSiteId && safeFrameKey) itemParams.set('frameKey', safeFrameKey);
              return (
                <li key={JSON.stringify([siteId, cameraId, frameKey])}>
                  <Link
                    to={`/incidents?${itemParams}`}
                    onClick={onNavigate}
                    data-testid="notification-bell-ppe-frame"
                    className={`group flex min-h-11 items-start gap-2.5 border-l-[3px] px-4 py-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-800 ${
                      unread
                        ? 'border-l-teal-700 bg-teal-50/20 hover:bg-teal-50/40'
                        : 'border-l-transparent bg-white hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`mt-2 h-2 w-2 shrink-0 rounded-full ${
                        unread ? 'bg-teal-700' : 'bg-transparent'
                      }`}
                      aria-label={unread ? t('episodes.unread') : undefined}
                      aria-hidden={!unread}
                    />

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`truncate text-sm leading-snug ${
                            unread ? 'font-semibold text-slate-950' : 'font-medium text-slate-800'
                          }`}
                        >
                          {cameraName}
                        </span>
                        <time
                          dateTime={capturedAt}
                          className="shrink-0 text-xs font-medium text-slate-600 tabular-nums"
                        >
                          {formatRelativeTime(capturedAt)}
                        </time>
                      </div>

                      <span className="block truncate text-xs text-slate-600">{siteName}</span>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-sm">
                        <span className="font-medium text-slate-900 tabular-nums">
                          {t('episodes.framePeople', { count: cases.length })}
                        </span>
                        {findingCount > 0 && (
                          <span className="inline-flex items-center gap-1 font-medium text-slate-950 tabular-nums">
                            <IconHardHat className="h-4 w-4 shrink-0 text-amber-700" />
                            <span>{t('episodes.findings', { count: findingCount })}</span>
                          </span>
                        )}
                        {deniedCount > 0 && (
                          <span className="inline-flex items-center gap-1 font-semibold text-rose-700 tabular-nums">
                            <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                            <span>{t('episodes.frameZoneDenials', { count: deniedCount })}</span>
                          </span>
                        )}
                        {laterDenials > 0 && (
                          <span className="inline-flex items-center gap-1 font-semibold text-rose-800 tabular-nums">
                            <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-700" />
                            <span>
                              {t('episodes.laterFrameZoneDenials', { count: laterDenials })}
                            </span>
                          </span>
                        )}
                        {pendingZoneCount > 0 && (
                          <span
                            data-testid="bell-frame-zone-pending"
                            className="inline-flex items-center gap-1 font-medium text-amber-800 tabular-nums"
                          >
                            <IconClock className="h-4 w-4 shrink-0 text-amber-700" />
                            <span>
                              {t('episodes.frameZonePending', { count: pendingZoneCount })}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            },
          )}
        </ul>
      )}
    </section>
  );
}
