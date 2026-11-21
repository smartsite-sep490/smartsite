import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  sanitizeSafetyFrameKey,
  sanitizeSafetyQueryId,
  sanitizeSafetyUuid,
} from '../../components/safety-episodes/safetyUrlParams';
import { uiLocale } from '../../i18n';
import { translate as tr } from '../../i18n';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import type { usePpeFrameInboxPreview } from './usePpeFrameInboxPreview';
import './notification-center-catalog';

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
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);
  const sites = siteIds.map((id) => id.toLowerCase());
  const allowed = new Set(sites);
  const rows = query.isSuccess
    ? query.data.items.filter(({ siteId }) => allowed.has(siteId.toLowerCase()))
    : [];

  return (
    <section
      aria-label={t('episodes.frameTitle')}
      className="space-y-2 border-b border-slate-100 px-4 py-3"
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <h3 className="font-bold">{t('episodes.frameTitle')}</h3>
        <Link to={inboxHref} onClick={onNavigate} className="font-semibold underline">
          {t('episodes.all')}
        </Link>
      </div>
      {query.isPending && (
        <p role="status" className="text-xs">
          {t('episodes.loading')}
        </p>
      )}
      {query.isError && (
        <p role="alert" className="text-xs">
          {t('episodes.unavailable')}
        </p>
      )}
      {query.isSuccess && rows.length === 0 && (
        <p role="status" className="text-xs">
          {t('episodes.empty')}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="space-y-1.5">
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
                    className="group relative flex items-start gap-3 rounded-xl border border-slate-200/80 bg-white p-2.5 text-xs transition-all hover:border-slate-300 hover:bg-slate-50/80 hover:shadow-2xs focus-visible:outline-2 focus-visible:outline-[#F66B17]"
                  >
                    {/* Unread dot */}
                    {unread && (
                      <span
                        className="absolute top-2.5 left-2 w-2 h-2 rounded-full bg-[#F66B17] shrink-0"
                        aria-label={t('episodes.unread')}
                      />
                    )}

                    {/* Card content */}
                    <div className={`min-w-0 flex-1 space-y-1 ${unread ? 'pl-3' : ''}`}>
                      {/* Camera name + relative time */}
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`truncate text-xs leading-tight ${unread ? 'font-bold text-[#071A2B]' : 'font-semibold text-slate-700'}`}
                        >
                          {cameraName}
                        </span>
                        <time
                          dateTime={capturedAt}
                          className="text-[10px] font-medium text-slate-400 shrink-0 tabular-nums"
                        >
                          {formatRelativeTime(capturedAt)}
                        </time>
                      </div>

                      {/* Badges row */}
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="inline-flex items-center gap-0.5 rounded bg-blue-50 border border-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800">
                          {t('episodes.framePeople', { count: cases.length })}
                        </span>
                        {findingCount > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 border border-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                            {t('episodes.findings', { count: findingCount })}
                          </span>
                        )}
                        {deniedCount > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-rose-50 border border-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800">
                            {t('episodes.frameZoneDenials', { count: deniedCount })}
                          </span>
                        )}
                        {laterDenials > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-rose-100 border border-rose-200 px-1.5 py-0.5 text-[10px] font-bold text-rose-900">
                            {t('episodes.laterFrameZoneDenials', { count: laterDenials })}
                          </span>
                        )}
                        {pendingZoneCount > 0 && (
                          <span
                            data-testid="bell-frame-zone-pending"
                            className="inline-flex items-center gap-0.5 rounded bg-amber-100 border border-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900"
                          >
                            {t('episodes.frameZonePending', { count: pendingZoneCount })}
                          </span>
                        )}
                        {unread && (
                          <span className="inline-flex items-center rounded bg-[#FFF2E8] border border-[#F66B17]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#F66B17]">
                            {tSafety('notificationCenter.ppeFrameCard.newAlert')}
                          </span>
                        )}
                      </div>

                      {/* Site context */}
                      <span className="block text-[10px] text-slate-500 truncate">
                        {siteName} · {cameraName}
                      </span>
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
