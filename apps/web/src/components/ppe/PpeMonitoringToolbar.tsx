import type { CameraResponse } from '@smartsite/contracts/management';
import { IconEye, IconGrid, IconMaximize, IconShield } from '../icons';
import { resolveCameraAndWorkArea } from '../cameras/monitoringUtils';
import { useLocale } from '../../i18n/ppe-locale';

const ACTION_BTN =
  'flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 transition-colors cursor-pointer shadow-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
const OVERLAY_BTN =
  'px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
const TAB_BASE =
  'px-3 py-1 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600';
const TAB_ON = 'bg-white text-slate-900 shadow-xs';
const TAB_OFF = 'text-slate-600 hover:text-slate-900';
const CHIP_BASE =
  'flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-colors shrink-0 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600';
const CHIP_ON = 'border-slate-900 bg-slate-900 text-white font-medium';
const CHIP_OFF = 'border-slate-200 bg-slate-50 hover:bg-white text-slate-700';
const REVIEW_BTN =
  'px-3 py-2 rounded-lg bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

export interface PpeMonitoringToolbarProps {
  viewMode: 'single' | 'wall';
  cameras: CameraResponse[];
  selectedCameraId: string;
  isAiWorkPaused: boolean;
  isBrowserFullscreen: boolean;
  isEvidenceOpen: boolean;
  canShowReviewAction: boolean;
  hasTestDetection: boolean;
  onSelectSingleView: () => void;
  onReturnToWall: () => void;
  onSelectCamera: (cameraId: string) => void;
  onToggleFullscreen: () => void;
  onOpenEvidenceDetails: () => void;
  onReviewAlert: () => void;
}

export function PpeMonitoringToolbar(props: PpeMonitoringToolbarProps) {
  const { t } = useLocale();
  const hasActiveWallCamera = props.cameras.some((camera) => camera.status === 'ACTIVE');
  const fsLabel = t(
    props.isBrowserFullscreen ? 'ppe.fullscreen.exitBtn' : 'ppe.fullscreen.enterBtn',
  );
  const viewModes = [
    ['single', 'toggle-view-single', t('ppe.viewMode.single'), IconEye, props.onSelectSingleView],
    ['wall', 'toggle-view-wall', t('ppe.viewMode.wall'), IconGrid, props.onReturnToWall],
  ] as const;

  return (
    <div
      data-testid="ppe-monitoring-toolbar"
      className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-slate-200/80 bg-white px-3.5 py-2 shadow-xs min-w-0 w-full max-w-full"
    >
      <div className="flex flex-wrap items-center gap-2.5 min-w-0 flex-1">
        <div
          className="flex items-center rounded-xl border border-slate-200/90 bg-[#F1F5F9] p-0.5 flex-shrink-0"
          role="group"
          aria-label={t('ppe.viewMode.groupAria')}
          data-tour-anchor="monitor-view-mode"
        >
          {viewModes.map(([id, testId, label, Icon, onClick]) => (
            <button
              key={id}
              type="button"
              data-testid={testId}
              onClick={onClick}
              aria-pressed={props.viewMode === id}
              className={`${TAB_BASE} ${props.viewMode === id ? TAB_ON : TAB_OFF}`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {props.cameras.length > 0 && props.viewMode === 'single' && (
          <div
            data-testid="camera-overview-strip"
            className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar min-w-0 py-0.5 sm:pl-2.5 sm:border-l sm:border-slate-200/80"
          >
            {props.cameras.map((cam) => {
              const isCurrent = cam.id === props.selectedCameraId;
              const camCtx = resolveCameraAndWorkArea(cam.name || cam.code);
              return (
                <button
                  key={`cam-chip-${cam.id}`}
                  type="button"
                  data-testid={`camera-chip-${cam.id}`}
                  aria-pressed={isCurrent}
                  onClick={() => props.onSelectCamera(cam.id)}
                  className={`${CHIP_BASE} ${isCurrent ? CHIP_ON : CHIP_OFF}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${isCurrent ? 'bg-emerald-400' : 'bg-slate-400'}`}
                    title={t(isCurrent ? 'ppe.overview.selectedTitle' : 'ppe.overview.selectTitle')}
                    aria-label={isCurrent ? t('ppe.overview.selectedAria') : undefined}
                  />
                  <span className="truncate max-w-[140px]">{camCtx.camera}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
        {props.viewMode === 'wall' && (
          <div className="flex flex-wrap items-center gap-2 sm:pr-2.5 sm:border-r sm:border-slate-200/80">
            {!props.isAiWorkPaused && (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200/70 bg-slate-50/80 px-2.5 py-1 flex-shrink-0 min-w-0">
                <span className="text-[11px] font-mono text-slate-600 tabular-nums truncate">
                  {t('ppe.cadence.wall')}
                </span>
                {hasActiveWallCamera && (
                  <span
                    className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0"
                    title={t('ppe.cadence.pollingWallTitle')}
                  />
                )}
              </div>
            )}
            <button
              type="button"
              data-testid="wall-fullscreen-btn"
              data-tour-anchor={!hasActiveWallCamera ? 'monitor-enlarge' : undefined}
              aria-pressed={props.isBrowserFullscreen}
              onClick={props.onToggleFullscreen}
              className={ACTION_BTN}
            >
              <IconMaximize className="w-3.5 h-3.5 text-slate-700 shrink-0" />
              <span>{fsLabel}</span>
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="open-evidence-details-btn"
            data-tour-anchor="monitor-evidence"
            aria-haspopup="dialog"
            aria-expanded={props.isEvidenceOpen}
            onClick={props.onOpenEvidenceDetails}
            className={ACTION_BTN}
          >
            <IconShield className="w-3.5 h-3.5 text-slate-700 shrink-0" />
            <span>{t('ppe.toolbar.evidenceDetailsBtn')}</span>
          </button>

          {props.canShowReviewAction && !props.isEvidenceOpen && (
            <button
              type="button"
              onClick={props.onReviewAlert}
              disabled={!props.hasTestDetection}
              className={REVIEW_BTN}
            >
              {t('ppe.action.reviewAlert')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export interface PpeSingleViewportHeaderProps {
  cameraLabel: string;
  workAreaLabel: string;
  siteSummary: string | null;
  cameraSummary: string | null;
  displayedSourceLabel: string;
  displayedSourceBadgeClass: string;
  displayedDotClass: string;
  displayedStatusText: string;
  isBrowserFullscreen: boolean;
  onReturnToWall: () => void;
  onToggleFullscreen: () => void;
  onOpenEvidenceDetails: () => void;
}

export function PpeSingleViewportHeader(props: PpeSingleViewportHeaderProps) {
  const { t } = useLocale();
  const fsLabel = t(
    props.isBrowserFullscreen ? 'ppe.fullscreen.exitBtn' : 'ppe.fullscreen.enterBtn',
  );
  const workAreaDetail = `${t('ppe.card.fieldWorkArea')}: ${props.workAreaLabel}`;

  return (
    <div
      data-testid="single-viewport-header"
      className="relative z-10 px-4 py-2.5 bg-slate-950/75 border-b border-white/10 flex flex-wrap items-center justify-between gap-2 text-white"
    >
      <div className="flex flex-wrap items-center gap-2 min-w-0 pr-2">
        <span
          title={`${props.cameraLabel} · ${props.workAreaLabel}`}
          className="font-bold text-sm tracking-wide text-white truncate"
        >
          {props.cameraLabel}
        </span>

        <details
          data-testid="single-viewport-details"
          className="text-xs text-white/80 pointer-events-auto"
        >
          <summary className="inline-flex items-center cursor-pointer font-semibold text-xs text-white/90 hover:text-white select-none px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 transition-colors">
            {t('ppe.common.details')}
          </summary>
          <div className="mt-1.5 rounded-lg bg-slate-900/95 border border-white/15 px-3 py-2 text-xs text-white/85 space-y-1 shadow-md">
            <p className="font-semibold">{workAreaDetail}</p>
            {props.siteSummary && (
              <p className="font-mono">{`${t('ppe.scope.siteLabel')}: ${props.siteSummary}`}</p>
            )}
            {props.cameraSummary && (
              <p className="font-mono">{`${t('mf06.detail.field.cameraId')} ${props.cameraSummary}`}</p>
            )}
          </div>
        </details>
      </div>

      <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
        <div className="flex items-center gap-1.5">
          <span
            data-testid="factual-source-label"
            className={`px-2.5 py-1 rounded-md text-xs font-bold tracking-wider uppercase border ${props.displayedSourceBadgeClass}`}
          >
            {t('ppe.viewport.sourceBadge', { source: props.displayedSourceLabel })}
          </span>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/60 flex-shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${props.displayedDotClass}`} />
            <span className="font-mono text-xs font-semibold text-white tracking-wider tabular-nums">
              {props.displayedStatusText}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:pl-2 sm:border-l sm:border-white/15">
          <button
            type="button"
            data-testid="single-viewport-back-to-grid-btn"
            onClick={props.onReturnToWall}
            className={OVERLAY_BTN}
          >
            <IconGrid className="w-3.5 h-3.5" />
            <span>{t('ppe.toolbar.backToGridBtn')}</span>
          </button>
          <button
            type="button"
            data-testid="toggle-fullscreen-btn"
            data-tour-anchor="monitor-enlarge"
            aria-pressed={props.isBrowserFullscreen}
            onClick={props.onToggleFullscreen}
            className={OVERLAY_BTN}
          >
            <IconMaximize className="w-3.5 h-3.5" />
            <span>{fsLabel}</span>
          </button>
        </div>

        <div className="flex items-center sm:pl-2 sm:border-l sm:border-white/15">
          <button
            type="button"
            data-testid="viewport-evidence-details-btn"
            onClick={props.onOpenEvidenceDetails}
            className={OVERLAY_BTN}
          >
            <IconShield className="w-3.5 h-3.5" />
            <span>{t('ppe.common.evidence')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
