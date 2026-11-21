import { useContext, useEffect, useState } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import { formatClockTime } from '../cameras/monitoringUtils';
import { useScopedCameraPreview } from '../cameras/useScopedCameraPreview';
import { useScopedCameraMedia } from '../cameras/useScopedCameraMedia';
import { useScopedRecordedVideo } from '../cameras/useScopedRecordedVideo';
import { ScopedRealtimePreviewCanvas } from '../cameras/ScopedRealtimePreviewCanvas';
import { RawCameraMediaCanvas } from '../cameras/RawCameraMediaCanvas';
import { IconShield } from '../icons';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { CameraObservationZones } from './CameraObservationZones';
import { useFourSourceWallTranslate } from './four-source-wall-catalog';
import type { ScopedWallSnapshot } from './FourSourceWall';
import {
  isSafeDisplaySourceId,
  resolveMonitorTelemetryState,
  useMonitorReadabilityTranslate,
} from './monitor-readability';
import { useCameraObservationZones } from './useCameraObservationZones';

registerFeatureCatalog({
  en: {
    'focus.context.camera': 'Camera',
    'focus.context.site': 'Site',
    'focus.ai': 'AI snapshot',
    'focus.live': 'Live source video',
    'focus.recorded': 'Recorded source video',
    'focus.views': 'Camera view',
    'focus.loading': 'Connecting…',
    'focus.unavailable': 'This source is unavailable.',
    'focus.retry': 'Retry',
    'focus.rawHint':
      'Source video has no AI overlays. Use AI snapshot to inspect an analyzed frame.',
    'focus.paused': 'Camera media is disabled while AI work is paused.',
  },
  vi: {
    'focus.context.camera': 'Camera',
    'focus.context.site': 'Công trường',
    'focus.ai': 'Ảnh phân tích AI',
    'focus.live': 'Video trực tiếp',
    'focus.recorded': 'Video đã ghi',
    'focus.views': 'Chế độ camera',
    'focus.loading': 'Đang kết nối…',
    'focus.unavailable': 'Nguồn này chưa khả dụng.',
    'focus.retry': 'Thử lại',
    'focus.rawHint':
      'Video nguồn không vẽ kết quả AI. Chọn ảnh phân tích để xem đúng frame đã nhận diện.',
    'focus.paused': 'Đang tạm dừng tác vụ AI; xem camera đã tắt.',
  },
});

interface Props {
  apiUrl: string;
  client: SmartSiteManagementClient;
  token: string;
  sessionScope: string;
  siteId: string;
  siteCode?: string;
  siteName?: string;
  camera: CameraResponse;
  aiPaused: boolean;
  observationMode?: 'ppe' | 'zone';
  onExitFocus?: () => void;
  onOpenEvidence?: () => void;
  onTransportChoice?: () => void;
  onAiSnapshotUpdate?: (snapshot: ScopedWallSnapshot, isRawMode: boolean) => void;
}

function FocusedCameraZoneContext({
  apiUrl,
  client,
  token,
  sessionScope,
  siteId,
  siteCode,
  siteName,
  camera,
  onErrorStatusChange,
}: {
  apiUrl: string;
  client: SmartSiteManagementClient;
  token: string;
  sessionScope: string;
  siteId: string;
  siteCode?: string;
  siteName?: string;
  camera: CameraResponse;
  onErrorStatusChange: (errorStatus: number | null) => void;
}) {
  const zonesState = useCameraObservationZones({
    apiUrl,
    client,
    token,
    sessionScope,
    credentialId: 1,
    siteId,
    cameraId: camera.id,
    configurationVersion: camera.configurationVersion,
  });

  useEffect(() => {
    onErrorStatusChange(zonesState.errorStatus);
  }, [zonesState.errorStatus, onErrorStatusChange]);

  return (
    <div data-testid="focused-zone-context" className="min-w-0 max-w-full">
      <CameraObservationZones
        siteCode={siteCode}
        siteName={siteName}
        cameraId={camera.id}
        cameraCode={camera.code ?? ''}
        cameraName={camera.name ?? ''}
        isSelected={false}
        zonesState={zonesState}
        showCameraAndSiteRows={false}
        maxInlineZones={2}
      />
    </div>
  );
}

/** Mounted with a camera/credential key: only the selected transport can request media. */
export function FocusedCameraMedia({
  camera,
  aiPaused,
  observationMode = 'ppe',
  siteCode,
  siteName,
  onExitFocus,
  onOpenEvidence,
  onTransportChoice,
  onAiSnapshotUpdate,
  ...scope
}: Props) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const tWall = useFourSourceWallTranslate();
  const trMonitor = useMonitorReadabilityTranslate();
  const queryClient = useContext(QueryClientContext);
  const canLoadZones = Boolean(
    queryClient && typeof scope.client?.getCameraObservationZones === 'function',
  );
  const [zonesErrorStatus, setZonesErrorStatus] = useState<number | null>(null);
  const [mode, setMode] = useState<'ai' | 'live' | 'recorded'>('ai');
  const options = { ...scope, cameraId: camera.id, cameraExternalId: camera.externalId };
  const snapshot = useScopedCameraPreview({ ...options, enabled: !aiPaused && mode === 'ai' });
  // These are requested transports, not asserted camera capabilities. Backend validates support.
  const raw = useScopedCameraMedia({
    ...options,
    enabled: !aiPaused && mode === 'live',
    isLive: mode === 'live',
  });
  const recorded = useScopedRecordedVideo({
    ...options,
    enabled: !aiPaused && mode === 'recorded',
    isRecorded: mode === 'recorded',
  });
  const current = mode === 'ai' ? snapshot : mode === 'live' ? raw : recorded;
  const pending =
    mode === 'ai'
      ? snapshot.isLoading
      : mode === 'live'
        ? raw.status === 'CONNECTING'
        : recorded.isLoading;
  const present =
    !aiPaused &&
    (mode === 'ai' ? !!snapshot.preview : mode === 'live' ? !!raw.image : !!recorded.videoUrl);
  const effectiveErrorStatus =
    current.errorStatus === 401 || zonesErrorStatus === 401 ? 401 : (current.errorStatus ?? null);
  const denied = [401, 403, 404].includes(effectiveErrorStatus ?? 0);

  const aiStatus =
    snapshot.status ??
    (snapshot.isLoading ? 'CONNECTING' : snapshot.preview ? 'LIVE' : 'UNAVAILABLE');
  const detectionsCount = snapshot.preview?.frame?.detections?.length ?? 0;
  const isRawMode = !aiPaused && mode !== 'ai';
  const telemetry = resolveMonitorTelemetryState({
    isAiPaused: aiPaused,
    hasActiveAiPreview: mode === 'ai' && Boolean(snapshot.preview),
    detectionsCount,
    status: pending ? 'CONNECTING' : aiStatus,
    errorStatus: effectiveErrorStatus,
    isRawTransport: isRawMode,
    hasActiveRawMedia: present,
  });

  useEffect(() => {
    if (!onAiSnapshotUpdate) return;
    onAiSnapshotUpdate(
      {
        scope: {
          apiUrl: scope.apiUrl,
          credentialId: 1,
          sessionScope: scope.sessionScope,
          siteId: scope.siteId,
          cameraId: camera.id,
          client: scope.client,
          token: scope.token,
        },
        preview: !aiPaused && mode === 'ai' ? (snapshot.preview ?? null) : null,
        status: aiPaused ? 'UNAVAILABLE' : pending ? 'CONNECTING' : aiStatus,
        sourceKind: !aiPaused && mode === 'ai' ? (snapshot.sourceKind ?? null) : null,
        capturedAt:
          !aiPaused && mode === 'ai'
            ? (snapshot.capturedAt ?? snapshot.preview?.frame?.capturedAt ?? null)
            : null,
        errorStatus: effectiveErrorStatus,
        receivedAt: Date.now(),
      },
      isRawMode,
    );
  }, [
    scope.apiUrl,
    scope.sessionScope,
    scope.siteId,
    scope.client,
    scope.token,
    camera.id,
    aiPaused,
    mode,
    isRawMode,
    pending,
    aiStatus,
    snapshot.preview,
    snapshot.sourceKind,
    snapshot.capturedAt,
    effectiveErrorStatus,
    onAiSnapshotUpdate,
  ]);

  const capturedIso =
    mode === 'ai'
      ? (snapshot.capturedAt ?? snapshot.preview?.frame?.capturedAt ?? null)
      : mode === 'live'
        ? (raw.frame?.capturedAt ?? null)
        : null;
  const parsedCaptured = capturedIso ? new Date(capturedIso) : null;
  const formattedTime =
    parsedCaptured && !Number.isNaN(parsedCaptured.getTime())
      ? formatClockTime(parsedCaptured)
      : null;

  const unavailableMessageKey = denied
    ? 'focus.unavailableDenied'
    : mode === 'ai'
      ? 'focus.unavailableAi'
      : 'focus.unavailableSource';

  const cameraActionName = camera.name
    ? camera.code && camera.code !== camera.name
      ? `${camera.name} (${camera.code})`
      : camera.name
    : camera.code;

  const isLiveBadge = !aiPaused && !isRawMode && present && snapshot.sourceKind !== 'REPLAY';
  const isReplayBadge = !aiPaused && !isRawMode && present && snapshot.sourceKind === 'REPLAY';

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-[#0B0F17] text-white shadow-2xs">
      <header
        data-testid="focused-camera-metadata"
        className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-slate-950/95 px-3.5 sm:px-4 py-2"
      >
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2.5">
          <h2
            title={cameraActionName}
            className="min-w-0 max-w-full text-base sm:text-lg font-semibold tracking-tight text-white break-words [overflow-wrap:anywhere]"
          >
            {camera.name || camera.code}
          </h2>
          <span
            data-testid="focused-source-state"
            className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wide whitespace-normal break-words [overflow-wrap:anywhere] ${
              aiPaused || isRawMode
                ? 'border-amber-400/40 bg-amber-500/15 text-amber-200'
                : isLiveBadge
                  ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                  : isReplayBadge
                    ? 'border-amber-400/40 bg-amber-500/15 text-amber-200'
                    : pending
                      ? 'border-slate-600 bg-slate-800 text-slate-200'
                      : 'border-rose-400/40 bg-rose-500/15 text-rose-200'
            }`}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                isLiveBadge
                  ? 'bg-emerald-400'
                  : isReplayBadge || aiPaused || isRawMode
                    ? 'bg-amber-400'
                    : pending
                      ? 'bg-slate-400'
                      : 'bg-rose-400'
              }`}
            />
            <span>
              {aiPaused
                ? trMonitor('monitor.state.aiPaused')
                : isRawMode && present
                  ? trMonitor('monitor.state.rawNoAi')
                  : present
                    ? snapshot.sourceKind === 'REPLAY'
                      ? tWall('ppe.wall.sourceReplay')
                      : tWall('ppe.wall.sourceLive')
                    : pending
                      ? tWall('ppe.wall.sourceConnecting')
                      : telemetry.failureKind === 'ACCESS_RESTRICTED'
                        ? trMonitor('monitor.state.accessRestricted')
                        : telemetry.failureKind === 'CAMERA_UNAVAILABLE' || isRawMode
                          ? trMonitor('monitor.state.cameraUnavailable')
                          : trMonitor('monitor.state.aiUnavailable')}
            </span>
          </span>
          {formattedTime && (
            <span className="font-mono text-xs sm:text-sm font-medium tabular-nums text-slate-300">
              {formattedTime}
            </span>
          )}
        </div>

        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label={t('focus.views')}
            className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 rounded-lg border border-white/15 bg-slate-900 p-0.5"
          >
            {(['ai', 'live', 'recorded'] as const).map((view) => (
              <button
                key={view}
                type="button"
                aria-pressed={mode === view}
                className="inline-flex min-h-9 min-w-0 max-w-full items-center rounded-md border border-transparent px-3 py-1.5 text-sm font-medium text-slate-300 whitespace-normal sm:whitespace-nowrap text-left break-words [overflow-wrap:anywhere] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white aria-pressed:border-white aria-pressed:bg-white aria-pressed:font-semibold aria-pressed:text-slate-950 cursor-pointer"
                onClick={() => {
                  onTransportChoice?.();
                  setMode(view);
                }}
              >
                {t(`focus.${view}`)}
              </button>
            ))}
          </div>
          {onOpenEvidence && (
            <button
              type="button"
              data-testid="focused-evidence-btn"
              aria-label={`${tWall('ppe.common.evidence')}: ${cameraActionName}`}
              aria-haspopup="dialog"
              onClick={onOpenEvidence}
              className="inline-flex min-h-9 min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-semibold text-white whitespace-normal sm:whitespace-nowrap text-left break-words [overflow-wrap:anywhere] hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer"
            >
              <IconShield className="h-4 w-4 shrink-0" />
              <span>{tWall('ppe.common.evidence')}</span>
            </button>
          )}
          {onExitFocus && (
            <button
              type="button"
              data-testid="focused-exit-to-grid"
              onClick={onExitFocus}
              className="inline-flex min-h-9 min-w-0 max-w-full items-center rounded-lg border border-white/20 bg-transparent px-3 py-1.5 text-sm font-medium text-slate-200 whitespace-normal sm:whitespace-nowrap text-left break-words [overflow-wrap:anywhere] hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer"
            >
              {trMonitor('focus.backToGrid')}
            </button>
          )}
        </div>
      </header>

      <div
        data-testid="focused-camera-stage"
        className={
          present
            ? 'relative aspect-video w-full lg:aspect-auto lg:h-[clamp(15rem,calc(100dvh-29.5rem),33rem)] [[data-monitor-fullscreen=true]_&]:lg:h-[clamp(22rem,calc(100dvh-10rem),52rem)] bg-[#070A10] text-white overflow-hidden'
            : 'relative flex min-h-[13rem] w-full items-center justify-center lg:h-[clamp(15rem,calc(100dvh-29.5rem),33rem)] [[data-monitor-fullscreen=true]_&]:lg:h-[clamp(22rem,calc(100dvh-10rem),52rem)] bg-[#070A10] text-white'
        }
      >
        {!aiPaused && mode === 'ai' && snapshot.preview && (
          <ScopedRealtimePreviewCanvas
            preview={snapshot.preview}
            mode={observationMode}
            hideFrameDetailsOverlay
          />
        )}
        {!aiPaused && mode === 'live' && (
          <RawCameraMediaCanvas image={raw.image} frame={raw.frame} />
        )}
        {!aiPaused && mode === 'recorded' && recorded.videoUrl && (
          <video
            key={recorded.videoUrl}
            src={recorded.videoUrl}
            controls
            playsInline
            className="h-full w-full object-contain"
          />
        )}
        {!present && (
          <div
            role="status"
            className="flex w-full min-w-0 flex-col items-center justify-center gap-3 px-4 py-5 sm:p-6 text-center"
          >
            <p className="min-w-0 max-w-md text-sm font-medium text-slate-200 leading-relaxed break-words [overflow-wrap:anywhere]">
              {aiPaused
                ? t('focus.paused')
                : pending
                  ? t('focus.loading')
                  : trMonitor(unavailableMessageKey)}
            </p>
            {!aiPaused && !pending && !denied && (
              <button
                type="button"
                className="inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border border-white/30 bg-white px-4 py-2 text-sm font-semibold text-slate-950 whitespace-normal break-words [overflow-wrap:anywhere] hover:bg-slate-100 cursor-pointer"
                onClick={current.retry}
              >
                {t('focus.retry')}
              </button>
            )}
          </div>
        )}
      </div>

      <div
        data-testid="focused-telemetry-strip"
        className="flex min-w-0 flex-wrap items-start sm:items-center justify-between gap-x-4 gap-y-2.5 border-t border-white/10 bg-slate-950/95 px-3.5 sm:px-4 py-2.5 text-xs sm:text-sm text-slate-300"
      >
        <div className="flex min-w-0 max-w-full flex-1 basis-full sm:basis-auto flex-col gap-1.5">
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1">
            <span
              data-testid="focused-people-state"
              className={`min-w-0 max-w-full font-medium leading-relaxed tabular-nums whitespace-normal break-words [overflow-wrap:anywhere] ${
                telemetry.peopleState.kind === 'ACTIVE_COUNT'
                  ? 'font-semibold text-emerald-300'
                  : telemetry.peopleState.kind === 'ZERO_CLEAR_FRAME'
                    ? 'text-slate-300'
                    : 'text-amber-300'
              }`}
            >
              {telemetry.peopleState.kind === 'ACTIVE_COUNT'
                ? tWall('ppe.wall.personDetectionsCount', { count: telemetry.peopleState.count })
                : telemetry.peopleState.kind === 'ZERO_CLEAR_FRAME'
                  ? tWall('ppe.wall.noPersonDetectionsDisclaimer')
                  : telemetry.peopleState.kind === 'PAUSED'
                    ? trMonitor('monitor.people.paused')
                    : telemetry.peopleState.kind === 'RAW_SOURCE_NO_AI'
                      ? trMonitor('monitor.people.rawMode')
                      : telemetry.peopleState.kind === 'CONNECTING'
                        ? trMonitor('monitor.people.connecting')
                        : trMonitor('monitor.people.unavailable')}
            </span>
            {mode !== 'ai' && (
              <span
                data-testid="focused-raw-source-notice"
                className="min-w-0 max-w-full text-xs leading-relaxed text-slate-300 whitespace-normal break-words [overflow-wrap:anywhere]"
              >
                {t('focus.rawHint')}
              </span>
            )}
          </div>
          {canLoadZones && (
            <FocusedCameraZoneContext
              apiUrl={scope.apiUrl}
              client={scope.client}
              token={scope.token}
              sessionScope={scope.sessionScope}
              siteId={scope.siteId}
              siteCode={siteCode}
              siteName={siteName}
              camera={camera}
              onErrorStatusChange={setZonesErrorStatus}
            />
          )}
        </div>

        <details
          data-testid="focused-technical-details"
          className="min-w-0 max-w-full text-xs text-slate-300 open:basis-full"
        >
          <summary className="inline-flex min-h-8 min-w-0 max-w-full cursor-pointer items-center rounded-lg border border-white/15 bg-white/5 px-3 py-1 font-medium text-slate-200 hover:bg-white/15 hover:text-white select-none whitespace-normal text-left break-words [overflow-wrap:anywhere]">
            {trMonitor('monitor.tech.summary')}
          </summary>

          <dl className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-white/10 pt-2.5 text-xs text-slate-300">
            <dt className="font-semibold text-slate-300">{t('focus.context.camera')}</dt>
            <dd className="min-w-0 break-words [overflow-wrap:anywhere]">
              {camera.code && camera.code !== camera.name
                ? `${camera.code} · ${camera.name}`
                : camera.name || camera.code}
            </dd>
            {(siteCode || siteName) && (
              <>
                <dt className="font-semibold text-slate-300">{t('focus.context.site')}</dt>
                <dd className="min-w-0 break-words [overflow-wrap:anywhere]">
                  {siteCode && siteName ? `${siteCode} · ${siteName}` : siteCode || siteName}
                </dd>
              </>
            )}
          </dl>
          <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums text-slate-300 break-all">
            {isSafeDisplaySourceId(camera.externalId) && (
              <span>
                {trMonitor('monitor.tech.sourceId')} {camera.externalId}
              </span>
            )}
            <span>
              {tWall('mf06.detail.field.cameraId')} {camera.id}
            </span>
            {typeof camera.configurationVersion === 'number' && (
              <span>
                {trMonitor('monitor.tech.configVersion', {
                  version: camera.configurationVersion,
                })}
              </span>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
