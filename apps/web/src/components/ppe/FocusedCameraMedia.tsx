import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import { useScopedCameraPreview } from '../cameras/useScopedCameraPreview';
import { useScopedCameraMedia } from '../cameras/useScopedCameraMedia';
import { useScopedRecordedVideo } from '../cameras/useScopedRecordedVideo';
import { ScopedRealtimePreviewCanvas } from '../cameras/ScopedRealtimePreviewCanvas';
import { RawCameraMediaCanvas } from '../cameras/RawCameraMediaCanvas';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';

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
  camera: CameraResponse;
  aiPaused: boolean;
  observationMode?: 'ppe' | 'zone';
}

/** Mounted with a camera/credential key: only the selected transport can request media. */
export function FocusedCameraMedia({ camera, aiPaused, observationMode = 'ppe', ...scope }: Props) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
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
  return (
    <section className="rounded-2xl border overflow-hidden bg-white">
      <header className="space-y-3 p-4">
        <div className="min-w-0">
          <h2 className="min-w-0 text-base font-semibold leading-snug tracking-tight text-slate-950 break-words [overflow-wrap:anywhere]">
            {camera.name}
          </h2>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <span aria-hidden="true" className="text-xs font-medium text-slate-500">
            {t('focus.views')}
          </span>
          <div
            role="group"
            aria-label={t('focus.views')}
            className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200/90 bg-slate-100/80 p-1"
          >
            {(['ai', 'live', 'recorded'] as const).map((view) => (
              <button
                key={view}
                type="button"
                aria-pressed={mode === view}
                className="rounded-lg border border-transparent px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-white hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 aria-pressed:border-slate-900 aria-pressed:bg-slate-900 aria-pressed:font-semibold aria-pressed:text-white aria-pressed:shadow-xs"
                onClick={() => setMode(view)}
              >
                {t(`focus.${view}`)}
              </button>
            ))}
          </div>
        </div>
      </header>
      {mode !== 'ai' && <p className="px-4 pb-3 text-sm text-slate-600">{t('focus.rawHint')}</p>}
      <div className="relative aspect-video bg-slate-950 text-white">
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
            <p>{t(aiPaused ? 'focus.paused' : pending ? 'focus.loading' : 'focus.unavailable')}</p>
            {!aiPaused && !pending && !denied && (
              <button className="rounded-lg border px-4 py-2" onClick={current.retry}>
                {t('focus.retry')}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
