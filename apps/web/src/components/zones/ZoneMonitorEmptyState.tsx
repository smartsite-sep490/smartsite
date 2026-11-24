import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import './zone-monitor-catalog';
import type { ZoneMonitorStageState } from './zone-monitor-model';

export interface ZoneMonitorEmptyStateProps {
  state: ZoneMonitorStageState;
  canAccessCameraSetup: boolean;
  cameraSetupHref: string;
  inRouter: boolean;
  isFullscreen: boolean;
  onRetrySites: () => void;
  onRetryCameras: () => void;
  onSelectSite: (siteId: string) => void;
  onSelectCamera: (cameraId: string) => void;
}

export function ZoneMonitorEmptyState({
  state,
  canAccessCameraSetup,
  cameraSetupHref,
  inRouter,
  isFullscreen,
  onRetrySites,
  onRetryCameras,
  onSelectSite,
  onSelectCamera,
}: ZoneMonitorEmptyStateProps) {
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);

  const neutralCard = isFullscreen
    ? 'rounded-xl border border-white/15 bg-slate-900 p-4 sm:p-5 text-sm text-slate-200'
    : 'rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5 text-sm text-slate-700';
  const neutralTitle = isFullscreen ? 'font-semibold text-white' : 'font-semibold text-slate-900';
  const neutralMuted = isFullscreen
    ? 'text-xs sm:text-sm text-slate-300'
    : 'text-xs sm:text-sm text-slate-600';
  const amberCard = isFullscreen
    ? 'rounded-xl border border-amber-400/35 bg-amber-500/15 p-4 sm:p-5 text-sm text-amber-100'
    : 'rounded-xl border border-amber-200 bg-amber-50 p-4 sm:p-5 text-sm text-amber-950';
  const amberMuted = isFullscreen
    ? 'text-xs sm:text-sm text-amber-200/90'
    : 'text-xs sm:text-sm text-amber-900/85';
  const roseCard = isFullscreen
    ? 'rounded-xl border border-rose-400/35 bg-rose-500/15 p-4 sm:p-5 text-sm text-rose-100'
    : 'rounded-xl border border-rose-200 bg-rose-50 p-4 sm:p-5 text-sm text-rose-950';
  const roseMuted = isFullscreen
    ? 'text-xs sm:text-sm text-rose-200/90'
    : 'text-xs sm:text-sm text-rose-900/85';

  const setupActionClass = isFullscreen
    ? 'inline-flex min-h-10 max-w-full items-center justify-center rounded-lg border border-white/25 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-950 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'
    : 'inline-flex min-h-10 max-w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

  const renderSetupCta = () => {
    if (!canAccessCameraSetup) return null;
    if (inRouter) {
      return (
        <Link
          to={cameraSetupHref}
          data-testid="zones-empty-open-camera-setup"
          className={setupActionClass}
        >
          {tSafety('zoneMonitor.empty.openCameraSetup')}
        </Link>
      );
    }
    return (
      <a
        href={cameraSetupHref}
        data-testid="zones-empty-open-camera-setup"
        className={setupActionClass}
      >
        {tSafety('zoneMonitor.empty.openCameraSetup')}
      </a>
    );
  };

  switch (state.kind) {
    case 'LOADING':
      return (
        <div role="status" data-testid="zones-stage-loading" className={neutralCard}>
          <p className="flex items-center gap-2 font-medium">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full bg-slate-400 animate-pulse"
            />
            <span>{tSafety('zoneMonitor.empty.loading')}</span>
          </p>
        </div>
      );

    case 'DENIED':
      return (
        <div role="alert" data-testid="zones-stage-denied" className={`space-y-1.5 ${amberCard}`}>
          <p className="font-semibold">{tSafety('zoneMonitor.empty.deniedTitle')}</p>
          <p className={amberMuted}>{tSafety('zoneMonitor.empty.deniedHint')}</p>
        </div>
      );

    case 'LOAD_ERROR':
      return (
        <div
          role="alert"
          data-testid="zones-stage-error"
          className={`flex flex-wrap items-center justify-between gap-3 ${roseCard}`}
        >
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">
              {tSafety(
                state.source === 'sites'
                  ? 'zoneMonitor.empty.sitesErrorTitle'
                  : 'zoneMonitor.empty.camerasErrorTitle',
              )}
            </p>
            <p className={roseMuted}>{tSafety('zoneMonitor.empty.errorHint')}</p>
          </div>
          <button
            type="button"
            data-testid="zones-stage-retry"
            onClick={state.source === 'sites' ? onRetrySites : onRetryCameras}
            className={
              isFullscreen
                ? 'inline-flex min-h-10 items-center justify-center rounded-lg border border-rose-300/40 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-rose-950 hover:bg-rose-50 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'
                : 'inline-flex min-h-10 items-center justify-center rounded-lg border border-rose-300 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-rose-950 hover:bg-rose-100 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900'
            }
          >
            {tSafety('zoneMonitor.empty.retry')}
          </button>
        </div>
      );

    case 'LINKED_SITE_UNAVAILABLE':
      return (
        <div
          role="status"
          data-testid="zones-stage-linked-site-unavailable"
          className={`flex flex-wrap items-center justify-between gap-3 ${amberCard}`}
        >
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">{tSafety('zoneMonitor.empty.linkedSiteTitle')}</p>
            <p className={amberMuted}>{tSafety('zoneMonitor.empty.linkedSiteHint')}</p>
          </div>
          {state.fallbackSiteId && (
            <button
              type="button"
              data-testid="zones-stage-switch-site"
              onClick={() => onSelectSite(state.fallbackSiteId!)}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-amber-300 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-amber-950 hover:bg-amber-100 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-900"
            >
              {tSafety('zoneMonitor.empty.switchAvailableSite')}
            </button>
          )}
        </div>
      );

    case 'NO_SITES':
      return (
        <div
          role="status"
          data-testid="zones-stage-no-sites"
          className={`space-y-1.5 ${neutralCard}`}
        >
          <p className={neutralTitle}>{tSafety('zoneMonitor.empty.noSitesTitle')}</p>
          <p className={neutralMuted}>{tSafety('zoneMonitor.empty.noSitesHint')}</p>
        </div>
      );

    case 'LINKED_CAMERA_UNAVAILABLE':
      return (
        <div
          role="status"
          data-testid="zones-stage-linked-camera-unavailable"
          className={`space-y-2.5 ${amberCard}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">{tSafety('zoneMonitor.empty.linkedCameraTitle')}</p>
              <p className={amberMuted}>{tSafety('zoneMonitor.empty.linkedCameraHint')}</p>
            </div>
            {state.fallbackCameraId && (
              <button
                type="button"
                data-testid="zones-stage-switch-camera"
                onClick={() => onSelectCamera(state.fallbackCameraId!)}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-amber-300 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-amber-950 hover:bg-amber-100 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-900"
              >
                {tSafety('zoneMonitor.empty.showAvailableCamera')}
              </button>
            )}
          </div>
          {!state.fallbackCameraId && (
            <>
              {state.inactiveZoneCameraCount > 0 && (
                <p className={amberMuted}>
                  {tSafety('zoneMonitor.empty.allInactiveDetail', {
                    count: state.inactiveZoneCameraCount,
                  })}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-0.5">
                <p className={amberMuted}>
                  {tSafety(
                    canAccessCameraSetup
                      ? 'zoneMonitor.empty.managerHint'
                      : 'zoneMonitor.empty.officerHint',
                  )}
                </p>
                {renderSetupCta()}
              </div>
            </>
          )}
        </div>
      );

    case 'ALL_CAMERAS_INACTIVE':
      return (
        <div
          role="status"
          data-testid="zones-stage-all-inactive"
          className={`space-y-2 ${neutralCard}`}
        >
          <p className={neutralTitle}>{tSafety('zoneMonitor.empty.allInactiveTitle')}</p>
          <p className="text-xs sm:text-sm">
            {tSafety('zoneMonitor.empty.allInactiveDetail', {
              count: state.inactiveZoneCameraCount,
            })}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-0.5">
            <p className={neutralMuted}>
              {tSafety(
                canAccessCameraSetup
                  ? 'zoneMonitor.empty.managerHint'
                  : 'zoneMonitor.empty.officerHint',
              )}
            </p>
            {renderSetupCta()}
          </div>
        </div>
      );

    case 'NO_ZONE_CAMERAS':
      return (
        <div
          role="status"
          data-testid="zones-stage-no-zone-cameras"
          className={`space-y-2 ${neutralCard}`}
        >
          <p className={neutralTitle}>{tSafety('zoneMonitor.empty.noZoneCamerasTitle')}</p>
          {state.gateCameraCount > 0 && (
            <p className="text-xs sm:text-sm">
              {tSafety('zoneMonitor.empty.noZoneCamerasGateNote', {
                count: state.gateCameraCount,
              })}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-0.5">
            <p className={neutralMuted}>
              {tSafety(
                canAccessCameraSetup
                  ? 'zoneMonitor.empty.managerHint'
                  : 'zoneMonitor.empty.officerHint',
              )}
            </p>
            {renderSetupCta()}
          </div>
        </div>
      );
  }
}
