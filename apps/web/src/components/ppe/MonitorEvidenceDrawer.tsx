import { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { CameraResponse } from '@smartsite/contracts/management';
import { formatClockTime } from '../cameras/monitoringUtils';
import type { ScopedDecodedPreview } from '../cameras/scopedRealtimePreview';
import { IconCheck, IconChevronRight, IconHardHat, IconShield, IconX } from '../icons';

type PpePersonDetection = ScopedDecodedPreview['frame']['detections'][number];

function resolveScopedPpeItemState(
  detection: PpePersonDetection,
  item: 'HARD_HAT' | 'SAFETY_VEST',
): 'CONFIRMED_MISSING' | 'PENDING_MISSING' | 'PRESENT' | 'UNKNOWN' {
  const status = detection.ppeStatus?.[item];
  if (status === 'PRESENT') return 'PRESENT';
  if (status === 'MISSING') {
    return detection.confirmedMissingItems?.includes(item)
      ? 'CONFIRMED_MISSING'
      : 'PENDING_MISSING';
  }
  return 'UNKNOWN';
}
import { useFourSourceWallTranslate } from './four-source-wall-catalog';
import type { ScopedWallSnapshot } from './FourSourceWall';
import {
  isSafeDisplaySourceId,
  resolveMonitorTelemetryState,
  useMonitorReadabilityTranslate,
} from './monitor-readability';

export interface MonitorEvidenceDrawerProps {
  open: boolean;
  onClose: () => void;
  siteId: string;
  siteCode?: string;
  siteName?: string;
  camera: CameraResponse | undefined;
  sessionScope: string;
  aiPaused: boolean;
  enableFrameInboxLink: boolean;
  snapshot: ScopedWallSnapshot | undefined;
  isRawModeActive?: boolean;
}

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])';

export function MonitorEvidenceDrawer({
  open,
  onClose,
  siteId,
  siteCode,
  siteName,
  camera,
  sessionScope,
  aiPaused,
  enableFrameInboxLink,
  snapshot,
  isRawModeActive = false,
}: MonitorEvidenceDrawerProps) {
  const trMonitor = useMonitorReadabilityTranslate();
  const tWall = useFourSourceWallTranslate();
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !camera) return;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueMicrotask(() => {
      closeBtnRef.current?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === 'Tab') {
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
        const first = controls[0];
        const last = controls.at(-1);
        if (!first || !last) return;
        if (
          event.shiftKey &&
          (document.activeElement === first || !dialog.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || !dialog.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (returnFocus?.isConnected) {
        returnFocus.focus();
      }
    };
  }, [open, camera]);

  if (!open || !camera) return null;

  const matchingSnapshot =
    snapshot &&
    snapshot.scope.sessionScope === sessionScope &&
    snapshot.scope.siteId === siteId &&
    snapshot.scope.cameraId === camera.id
      ? snapshot
      : undefined;

  const errorStatus = matchingSnapshot?.errorStatus ?? null;
  const isRestricted = errorStatus === 401 || errorStatus === 403 || errorStatus === 404;
  const activePreview =
    !aiPaused && !isRawModeActive && !isRestricted ? (matchingSnapshot?.preview ?? null) : null;
  const detections: readonly PpePersonDetection[] = activePreview?.frame.detections ?? [];
  const status = aiPaused ? 'UNAVAILABLE' : (matchingSnapshot?.status ?? 'UNAVAILABLE');
  const telemetry = resolveMonitorTelemetryState({
    isAiPaused: aiPaused,
    hasActiveAiPreview: Boolean(activePreview),
    detectionsCount: detections.length,
    status,
    errorStatus,
    isRawTransport: !aiPaused && isRawModeActive,
  });

  const capturedIso = activePreview?.frame.capturedAt ?? matchingSnapshot?.capturedAt ?? null;
  const parsedTime = capturedIso ? new Date(capturedIso) : null;
  const formattedTime =
    parsedTime && !Number.isNaN(parsedTime.getTime()) ? formatClockTime(parsedTime) : null;

  const statusBadgeText = aiPaused
    ? tWall('ppe.badge.aiPaused')
    : isRawModeActive
      ? trMonitor('monitor.state.rawNoAi')
      : activePreview
        ? matchingSnapshot?.sourceKind === 'REPLAY'
          ? tWall('ppe.wall.sourceReplay')
          : tWall('ppe.wall.sourceLive')
        : status === 'CONNECTING'
          ? tWall('ppe.wall.sourceConnecting')
          : telemetry.failureKind === 'ACCESS_RESTRICTED' ||
              errorStatus === 401 ||
              errorStatus === 403
            ? trMonitor('monitor.state.accessRestricted')
            : telemetry.failureKind === 'CAMERA_UNAVAILABLE'
              ? trMonitor('monitor.state.cameraUnavailable')
              : trMonitor('monitor.state.aiUnavailable');

  const frameInboxParams = new URLSearchParams({
    tab: 'ppe-frames',
    siteId,
    cameraId: camera.id,
  });
  const episodesParams = new URLSearchParams({
    tab: 'episodes',
    siteId,
    cameraId: camera.id,
  });

  function renderPpeStatusText(detection: PpePersonDetection, item: 'HARD_HAT' | 'SAFETY_VEST') {
    const state = resolveScopedPpeItemState(detection, item);
    if (state === 'CONFIRMED_MISSING') return trMonitor('monitor.drawer.ppeMissingConfirmed');
    if (state === 'PENDING_MISSING') return trMonitor('monitor.drawer.ppeMissingChecking');
    if (state === 'PRESENT') return trMonitor('monitor.drawer.ppePresent');
    return trMonitor('monitor.drawer.ppeUnobservable');
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/45 backdrop-blur-[1px]"
      onClick={() => onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-testid="monitor-evidence-drawer"
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col justify-between overflow-y-auto border-l border-slate-200 bg-white p-4 sm:p-5 text-slate-900 shadow-2xl"
      >
        <div className="space-y-4 min-w-0">
          <header className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <IconShield className="h-4 w-4 shrink-0 text-slate-700" />
                {camera.code && camera.code !== camera.name && (
                  <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-800">
                    {camera.code}
                  </span>
                )}
                <h2
                  id={titleId}
                  className="text-base sm:text-lg font-bold text-slate-950 break-words [overflow-wrap:anywhere]"
                >
                  {camera.name || camera.code || trMonitor('monitor.drawer.title')}
                </h2>
              </div>
              {(siteCode || siteName) && (
                <p className="text-xs sm:text-sm font-medium text-slate-600 break-words [overflow-wrap:anywhere]">
                  {siteCode && siteName ? `${siteCode} · ${siteName}` : siteCode || siteName}
                </p>
              )}
              <p id={descId} className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                {trMonitor('monitor.drawer.subtitle')}
              </p>
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              data-testid="monitor-evidence-drawer-close"
              aria-label={trMonitor('monitor.drawer.closeAria')}
              onClick={onClose}
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 cursor-pointer shrink-0"
            >
              <IconX className="h-4 w-4" />
            </button>
          </header>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-semibold text-slate-700">
                {trMonitor('monitor.drawer.currentStatus')}
              </span>
              <span
                data-testid="monitor-drawer-source-state"
                className={`inline-flex items-center gap-1.5 text-sm font-semibold ${
                  activePreview
                    ? 'text-emerald-800'
                    : aiPaused || isRawModeActive
                      ? 'text-amber-800'
                      : 'text-rose-700'
                }`}
              >
                {statusBadgeText}
              </span>
            </div>
            {formattedTime && activePreview && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
                <span>{trMonitor('monitor.drawer.capturedAt')}</span>
                <span className="font-mono font-semibold tabular-nums text-slate-800">
                  {formattedTime}
                </span>
              </div>
            )}
          </div>

          <section className="space-y-2" aria-label={trMonitor('monitor.drawer.detectionsHeading')}>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              {trMonitor('monitor.drawer.detectionsHeading')}
            </h3>
            {!activePreview ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm text-slate-600 leading-relaxed">
                {trMonitor('monitor.drawer.noActiveFrame')}
              </p>
            ) : detections.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm text-slate-600">
                {trMonitor('monitor.drawer.noDetections')}
              </p>
            ) : (
              <ul className="divide-y divide-slate-200/80 rounded-xl border border-slate-200 bg-white overflow-hidden">
                {detections.map((detection, index) => (
                  <li
                    key={`${detection.eventId}-${detection.trackId ?? index}`}
                    className="p-3.5 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950">
                        <IconHardHat className="h-4 w-4 shrink-0 text-amber-700" />
                        <span>
                          {trMonitor('monitor.drawer.personObservation', { index: index + 1 })}
                        </span>
                      </span>
                    </div>
                    {detection.trackId !== null && detection.trackId !== undefined && (
                      <p className="text-xs text-slate-600 tabular-nums">
                        {trMonitor('monitor.drawer.trackDisclaimer', {
                          trackId: detection.trackId,
                        })}
                      </p>
                    )}
                    <div className="grid grid-cols-1 gap-1.5 pt-1 text-sm">
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                        <span className="font-medium text-slate-700">
                          {trMonitor('monitor.drawer.ppeHardHat')}
                        </span>
                        <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                          {resolveScopedPpeItemState(detection, 'HARD_HAT') === 'PRESENT' && (
                            <IconCheck className="h-4 w-4 text-emerald-600" />
                          )}
                          {renderPpeStatusText(detection, 'HARD_HAT')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                        <span className="font-medium text-slate-700">
                          {trMonitor('monitor.drawer.ppeSafetyVest')}
                        </span>
                        <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                          {resolveScopedPpeItemState(detection, 'SAFETY_VEST') === 'PRESENT' && (
                            <IconCheck className="h-4 w-4 text-emerald-600" />
                          )}
                          {renderPpeStatusText(detection, 'SAFETY_VEST')}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="space-y-2.5 pt-1">
            {enableFrameInboxLink && (
              <Link
                data-testid="monitor-drawer-frame-inbox-link"
                to={`/incidents?${frameInboxParams}`}
                className="flex min-h-10 w-full items-center justify-between gap-2 rounded-xl bg-[#0F172A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                <span>{trMonitor('monitor.drawer.openFrameInbox')}</span>
                <IconChevronRight className="h-4 w-4 shrink-0" />
              </Link>
            )}
            <Link
              data-testid="monitor-drawer-episodes-link"
              to={`/incidents?${episodesParams}`}
              className="flex min-h-10 w-full items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              <span>{trMonitor('monitor.drawer.openEpisodes')}</span>
              <IconChevronRight className="h-4 w-4 shrink-0" />
            </Link>
          </div>

          <details
            data-testid="monitor-drawer-technical-details"
            className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-xs text-slate-600"
          >
            <summary className="inline-flex min-h-8 cursor-pointer items-center font-semibold text-slate-800 hover:text-slate-950 select-none">
              {trMonitor('monitor.tech.summary')}
            </summary>
            <div className="mt-2 space-y-1 font-mono text-xs tabular-nums text-slate-600 break-all">
              <div>
                {tWall('mf06.detail.field.cameraId')} {camera.id}
              </div>
              {typeof camera.configurationVersion === 'number' && (
                <div>
                  {trMonitor('monitor.tech.configVersion', {
                    version: camera.configurationVersion,
                  })}
                </div>
              )}
              {isSafeDisplaySourceId(camera.externalId) && (
                <div>
                  {trMonitor('monitor.tech.sourceId')} {camera.externalId}
                </div>
              )}
              {activePreview?.frame.sessionId && (
                <div>
                  {trMonitor('monitor.drawer.sessionId')} {activePreview.frame.sessionId}
                </div>
              )}
              {activePreview?.frame.sequenceNumber && (
                <div>
                  {trMonitor('monitor.drawer.sequence')} {activePreview.frame.sequenceNumber}
                </div>
              )}
            </div>
          </details>
        </div>

        <footer className="mt-4 border-t border-slate-100 pt-3 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 cursor-pointer"
          >
            {trMonitor('monitor.drawer.closeBtn')}
          </button>
        </footer>
      </div>
    </div>
  );
}
