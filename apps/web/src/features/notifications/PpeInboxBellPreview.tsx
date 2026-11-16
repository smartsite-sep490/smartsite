import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  sanitizeSafetyFrameKey,
  sanitizeSafetyQueryId,
  sanitizeSafetyUuid,
} from '../../components/safety-episodes/safetyUrlParams';
import { uiLocale } from '../../i18n';
import type { usePpeFrameInboxPreview } from './usePpeFrameInboxPreview';

const inboxHref = '/incidents?tab=ppe-frames';

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
        <ul className="space-y-1">
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
                    className="flex flex-wrap items-center justify-between gap-1 rounded-md bg-slate-50 px-2 py-1.5 text-xs hover:bg-slate-100 focus-visible:outline-2"
                  >
                    <span>
                      {t('episodes.framePeople', { count: cases.length })}
                      {findingCount > 0 && ` · ${t('episodes.findings', { count: findingCount })}`}
                      {deniedCount > 0 &&
                        ` · ${t('episodes.frameZoneDenials', { count: deniedCount })}`}
                      {laterDenials > 0 && (
                        <span className="block text-rose-800">
                          {t('episodes.laterFrameZoneDenials', { count: laterDenials })}
                        </span>
                      )}
                      {pendingZoneCount > 0 && (
                        <span
                          data-testid="bell-frame-zone-pending"
                          className="block font-medium text-amber-800"
                        >
                          {t('episodes.frameZonePending', { count: pendingZoneCount })}
                        </span>
                      )}
                      <span className="block text-slate-600">
                        {siteName} · {cameraName}
                      </span>
                    </span>
                    <span className="text-slate-600">
                      {new Date(capturedAt).toLocaleString(uiLocale())} ·{' '}
                      {t(unread ? 'episodes.unread' : 'episodes.read')}
                    </span>
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
