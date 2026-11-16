import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import { formatClockTime } from '../cameras/monitoringUtils';
import { useScopedCameraPreview } from '../cameras/useScopedCameraPreview';
import { useScopedCameraMedia } from '../cameras/useScopedCameraMedia';
import { useScopedRecordedVideo } from '../cameras/useScopedRecordedVideo';
import { ScopedRealtimePreviewCanvas } from '../cameras/ScopedRealtimePreviewCanvas';
import { RawCameraMediaCanvas } from '../cameras/RawCameraMediaCanvas';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { useFourSourceWallTranslate } from './four-source-wall-catalog';
import {
  resolveMonitorTelemetryState,
  useMonitorReadabilityTranslate,
} from './monitor-readability';

registerFeatureCatalog({
  en: {
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
}

/** Mounted with a camera/credential key: only the selected transport can request media. */
export function FocusedCameraMedia({
  camera,
  aiPaused,
  observationMode = 'ppe',
  siteCode,
  siteName,
  onExitFocus,
  ...scope
}: Props) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const tWall = useFourSourceWallTranslate();
  const trMonitor = useMonitorReadabilityTranslate();
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
  const denied = [401, 403, 404].includes(current.errorStatus ?? 0);

  const aiStatus =
    snapshot.status ??
    (snapshot.isLoading ? 'CONNECTING' : snapshot.preview ? 'LIVE' : 'UNAVAILABLE');
  const detectionsCount = snapshot.preview?.frame?.detections?.length ?? 0;
  const telemetry = resolveMonitorTelemetryState({
    isAiPaused: aiPaused,
    hasActiveAiPreview: mode === 'ai' && Boolean(snapshot.preview),
    detectionsCount,
    status: pending ? 'CONNECTING' : aiStatus,
    errorStatus: current.errorStatus ?? null,
    isRawTransport: mode !== 'ai' && present,
  });

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

  return (
    <section className="rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-xs">
      <header data-testid="focused-camera-metadata" className="space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {camera.code && camera.code !== camera.name && (
              <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-800">
                {camera.code}
              </span>
            )}
            <h2 className="min-w-0 text-base font-semibold leading-snug tracking-tight text-slate-950 break-words [overflow-wrap:anywhere]">
              {camera.name}
            </h2>
            {(siteCode || siteName) && (
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                {siteCode && siteName ? `${siteCode} · ${siteName}` : siteCode || siteName}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label={t('focus.views')}
              className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200/90 bg-slate-100/80 p-1"
            >
              {(['ai', 'live', 'recorded'] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  aria-pressed={mode === view}
                  className="rounded-lg border border-transparent px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-white hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 aria-pressed:border-slate-900 aria-pressed:bg-slate-900 aria-pressed:font-semibold aria-pressed:text-white aria-pressed:shadow-xs cursor-pointer"
                  onClick={() => setMode(view)}
                >
                  {t(`focus.${view}`)}
                </button>
              ))}
            </div>
            {onExitFocus && (
              <button
                type="button"
                data-testid="focused-exit-to-grid"
                onClick={onExitFocus}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 cursor-pointer"
              >
                {trMonitor('focus.backToGrid')}
              </button>
            )}
          </div>
        </div>

        <div
          data-testid="focused-telemetry-strip"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-1.5 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              data-testid="focused-source-state"
              className={`rounded-md border px-2 py-0.5 font-semibold ${
                aiPaused
                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : present
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                    : pending
                      ? 'border-slate-300 bg-white text-slate-700'
                      : 'border-rose-200 bg-rose-50 text-rose-900'
              }`}
            >
              {aiPaused
                ? tWall('ppe.badge.aiPaused')
                : mode !== 'ai' && present
                  ? trMonitor('monitor.state.rawNoAi')
                  : present
                    ? snapshot.sourceKind === 'REPLAY'
                      ? tWall('ppe.wall.sourceReplay')
                      : tWall('ppe.wall.sourceLive')
                    : pending
                      ? tWall('ppe.wall.sourceConnecting')
                      : telemetry.failureKind === 'ACCESS_RESTRICTED'
                        ? trMonitor('monitor.state.accessRestricted')
                        : telemetry.failureKind === 'CAMERA_UNAVAILABLE' || mode !== 'ai'
                          ? trMonitor('monitor.state.cameraUnavailable')
                          : trMonitor('monitor.state.aiUnavailable')}
            </span>

            <span
              data-testid="focused-people-state"
              className={`rounded-md border px-2 py-0.5 font-medium ${
                telemetry.peopleState.kind === 'ACTIVE_COUNT'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : telemetry.peopleState.kind === 'ZERO_CLEAR_FRAME'
                    ? 'border-slate-200 bg-white text-slate-700'
                    : 'border-amber-200 bg-amber-50/70 text-amber-900'
              }`}
            >
              {telemetry.peopleState.kind === 'ACTIVE_COUNT'
                ? tWall('ppe.wall.personDetectionsCount', { count: telemetry.peopleState.count })
                : telemetry.peopleState.kind === 'ZERO_CLEAR_FRAME'
                  ? tWall('ppe.wall.noPersonDetectionsDisclaimer')
                  : telemetry.peopleState.kind === 'PAUSED'
                    ? trMonitor('monitor.people.paused')
                    : telemetry.peopleState.kind === 'CONNECTING'
                      ? trMonitor('monitor.people.connecting')
                      : telemetry.peopleState.kind === 'RAW_SOURCE_NO_AI'
                        ? trMonitor('monitor.people.rawMode')
                        : trMonitor('monitor.people.unavailable')}
            </span>

            {formattedTime && (
              <span className="font-mono text-xs text-slate-600">{formattedTime}</span>
            )}
          </div>

          <details data-testid="focused-technical-details" className="text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700 hover:text-slate-950 select-none">
              {trMonitor('monitor.tech.summary')}
            </summary>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 font-mono text-[11px] text-slate-600">
              {camera.externalId && (
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
      </header>
      {mode !== 'ai' && <p className="px-3 pb-2 text-xs text-slate-600">{t('focus.rawHint')}</p>}
      <div className="relative aspect-video w-full max-h-[min(60vh,32rem)] bg-slate-950 text-white">
        {!aiPaused && mode === 'ai' && snapshot.preview && (
          <ScopedRealtimePreviewCanvas preview={snapshot.preview} mode={observationMode} />
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
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
          >
            <p>
              {aiPaused
                ? t('focus.paused')
                : pending
                  ? t('focus.loading')
                  : trMonitor(unavailableMessageKey)}
            </p>
            {!aiPaused && !pending && !denied && (
              <button
                type="button"
                className="rounded-lg border border-white/40 bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 cursor-pointer"
                onClick={current.retry}
              >
                {t('focus.retry')}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
