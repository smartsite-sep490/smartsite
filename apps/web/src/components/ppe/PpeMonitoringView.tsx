import { localizedLabel, localizedDetectionLabel } from '../../i18n/labels';
import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { useRealtimePreview } from '../cameras/useRealtimePreview';
import { RealtimePreviewCanvas } from '../cameras/RealtimePreviewCanvas';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconCheck,
  IconX,
  IconAlertTriangle,
  IconPlay,
  IconPause,
  IconVolume,
  IconMaximize,
  IconGrid,
} from '../icons';
import {
  getPpeVideoTestDetections,
  loadAiVideoTimeline,
  type AiVideoTimeline,
  type VideoTestTimeline,
} from '../cameras/videoTestFixture';
import {
  buildAiWebSocketUrl,
  getEffectiveDetections,
  getPpeItemDisplayState,
  getPpeResultState,
  isConfirmedPpeDetection,
  getPpeEventRowKey,
  formatClockTime,
  resolveCameraAndWorkArea,
  filterPpeEvents,
} from '../cameras/monitoringUtils';

interface PpeReviewItem {
  id: string;
  rowKey: string;
  trackId: number;
  ppeItem?: 'HARD_HAT' | 'SAFETY_VEST';
  worker: string;
  camera: string;
  regionId?: string;
  unknownTrack?: boolean;
  workArea: string;
  issue: string;
  confidence: string;
  status: string;
  time: string;
}

export interface PpeMonitoringViewProps {
  onNavigate?: (
    tab: 'incidents',
    context?: {
      alertType?: 'PPE_VIOLATION';
      siteId?: string;
      alertId?: string;
    },
  ) => void;
}

export function PpeMonitoringView({ onNavigate }: PpeMonitoringViewProps = {}) {
  const { t } = useTranslation();

  const videoRef = useRef<HTMLVideoElement>(null);
  const pausedViolationRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [selectedReview, setSelectedReview] = useState<PpeReviewItem | null>(null);
  const [videoTimeline, setVideoTimeline] = useState<VideoTestTimeline>({
    currentTime: 0,
    duration: 0,
  });
  const [aiTimeline, setAiTimeline] = useState<AiVideoTimeline | null>(null);
  const [clockTime, setClockTime] = useState<string>(() => formatClockTime());
  const [activeFilterWorker, setActiveFilterWorker] = useState<number | null>(null);
  const [ppeFilter, setPpeFilter] = useState<'ALL' | 'HARD_HAT' | 'SAFETY_VEST'>('ALL');
  const [violationSnapshot, setViolationSnapshot] = useState<{
    eventId: string;
    imageUrl: string;
    timecode: string;
  } | null>(null);

  const rawUrl = import.meta.env.VITE_AI_WS_URL;
  const token =
    import.meta.env.VITE_AI_BACKEND_SERVICE_TOKEN ??
    import.meta.env.VITE_AI_WS_TOKEN ??
    import.meta.env.VITE_AI_SERVICE_TOKEN ??
    '';

  const wsConfig = useMemo(() => {
    return buildAiWebSocketUrl(rawUrl, token);
  }, [rawUrl, token]);

  const {
    preview,
    connected: socketConnected,
    error: socketRuntimeError,
  } = useRealtimePreview(wsConfig.url);
  const liveDetections = preview?.frame.detections ?? null;
  const socketError = wsConfig.error ?? socketRuntimeError;

  // Update real-time clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setClockTime(formatClockTime());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Load timeline fixture for fallback / demo replay
  useEffect(() => {
    let cancelled = false;
    void loadAiVideoTimeline('/assets/ppe-ai.timeline.json')
      .then((timeline) => {
        if (!cancelled) setAiTimeline(timeline);
      })
      .catch(() => {
        if (!cancelled) setAiTimeline(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fallbackDetections = useMemo(
    () => getPpeVideoTestDetections(videoTimeline, aiTimeline),
    [videoTimeline, aiTimeline],
  );

  const { detections: ppeDetections, isLive } = getEffectiveDetections(
    liveDetections,
    fallbackDetections,
  );

  const testDetection = useMemo(() => {
    if (ppeDetections.length === 0) return null;
    return (
      ppeDetections.find((detection) => isConfirmedPpeDetection(detection)) ??
      ppeDetections[0] ??
      null
    );
  }, [ppeDetections]);
  const ppeResultState = getPpeResultState(ppeDetections);

  // Derive cameraExternalId and human-readable work area directly from active detection or timeline
  const activeCameraContext = useMemo(() => {
    return resolveCameraAndWorkArea(
      preview?.frame.cameraExternalId ||
        testDetection?.cameraExternalId ||
        aiTimeline?.cameraExternalId,
      testDetection?.regionId,
      t('monitoring_utils.chua_co_ma_camera'),
    );
  }, [
    preview?.frame.cameraExternalId,
    testDetection?.cameraExternalId,
    testDetection?.regionId,
    aiTimeline?.cameraExternalId,
    t,
  ]);

  // Snapshot PPE: only auto-pause when playing timeline fixture; do not pause local video on websocket frames
  useEffect(() => {
    if (isLive) {
      pausedViolationRef.current = null;
      return;
    }

    if (!testDetection || !isConfirmedPpeDetection(testDetection)) {
      pausedViolationRef.current = null;
      return;
    }

    if (pausedViolationRef.current === testDetection.eventId) return;

    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

    pausedViolationRef.current = testDetection.eventId;
    video.pause();

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const snapshot = {
      eventId: testDetection.eventId,
      imageUrl: canvas.toDataURL('image/jpeg', 0.9),
      timecode: testDetection.timecode,
    };

    const frameId = window.requestAnimationFrame(() => {
      setViolationSnapshot(snapshot);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isLive, testDetection]);

  const updateVideoTimeline = (video: HTMLVideoElement) => {
    setVideoTimeline({ currentTime: video.currentTime, duration: video.duration });
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  };

  const toggleMuted = () => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const ppeEvents: PpeReviewItem[] = useMemo(() => {
    return (aiTimeline?.entries ?? [])
      .flatMap((entry) =>
        entry.event.observations
          .filter((observation) => observation.type === 'PPE' && observation.status === 'MISSING')
          .map((observation) => {
            const person = entry.event.observations.find(
              (candidate) =>
                candidate.type === 'PERSON' && candidate.trackId === observation.trackId,
            );
            const context = resolveCameraAndWorkArea(
              entry.event.cameraExternalId,
              observation.regionId,
              t('monitoring_utils.chua_co_ma_camera'),
            );
            return {
              id: entry.event.eventId,
              rowKey: getPpeEventRowKey(
                entry.event.eventId,
                observation.trackId,
                observation.ppeItem,
              ),
              trackId: observation.trackId,
              ppeItem: observation.ppeItem,
              time: `${Math.floor(entry.videoTimeSeconds / 60)
                .toString()
                .padStart(2, '0')}:${Math.floor(entry.videoTimeSeconds % 60)
                .toString()
                .padStart(2, '0')}`,
              worker: t('messages.2c6bb8488230', { value1: observation.trackId }),
              camera: context.camera,
              regionId: observation.regionId,
              workArea: context.workArea,
              issue: t('messages.6bbb6eca45dd', {
                value1:
                  observation.ppeItem === 'HARD_HAT'
                    ? t('common.hard_hat_b1ff71')
                    : t('common.safety_vest'),
              }),
              confidence: person?.confidence ? `${Math.round(person.confidence * 100)}%` : '—',
              status: t('common.technical_observation'),
            };
          }),
      )
      .slice(-20)
      .reverse();
  }, [aiTimeline, t]);

  // Truly filters the loaded PPE events list
  const displayedEvents = useMemo(() => {
    return filterPpeEvents(ppeEvents, {
      workerTrackId: activeFilterWorker,
      itemType: ppeFilter,
    });
  }, [ppeEvents, activeFilterWorker, ppeFilter]);

  const openReviewFromDetection = () => {
    if (!testDetection) return;
    const context = resolveCameraAndWorkArea(
      testDetection.cameraExternalId || aiTimeline?.cameraExternalId,
      testDetection.regionId,
      tr('monitoring_utils.chua_co_ma_camera'),
    );
    setSelectedReview({
      id: testDetection.eventId,
      rowKey: `${testDetection.eventId}-${testDetection.trackId ?? 0}`,
      trackId: testDetection.trackId ?? 0,
      worker:
        testDetection.trackId !== null
          ? tr('messages.2c6bb8488230', { value1: testDetection.trackId })
          : tr('common.unknown_worker_c1ef7f'),
      camera: context.camera,
      regionId: testDetection.regionId,
      unknownTrack: testDetection.trackId === null,
      workArea: context.workArea,
      issue: testDetection.label,
      confidence:
        testDetection.confidence !== null ? `${Math.round(testDetection.confidence * 100)}%` : '—',
      status: isConfirmedPpeDetection(testDetection) ? 'Observation Active' : 'Scanning',
      time: isLive ? clockTime : testDetection.timecode,
    });
  };

  return (
    <div className="space-y-6 max-w-[1202px] mx-auto text-[#182232] pb-10">
      {/* Main Interactive Viewport: Camera Video Feed (829px) + Right Card (355px) */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(280px,355px)] gap-4 items-start mt-4">
        {/* Left: Camera Feed */}
        <div className="relative bg-[#041D2E] rounded-xl overflow-hidden shadow-sm w-full aspect-video xl:h-[466px] flex flex-col justify-between select-none">
          {/* Local MF04 test fixture driven by the video timeline. */}
          <div className="absolute inset-0">
            <video
              ref={videoRef}
              src="/assets/morteza_ppe_test_video.mp4"
              poster="/assets/ppe-camera-view.png"
              autoPlay
              muted={isMuted}
              loop
              playsInline
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onLoadedMetadata={(event) => updateVideoTimeline(event.currentTarget)}
              onTimeUpdate={(event) => updateVideoTimeline(event.currentTarget)}
              aria-label={tr('common.ppe_test_video')}
              className={`w-full h-full object-cover ${preview ? 'hidden' : ''}`}
            />

            {preview && <RealtimePreviewCanvas preview={preview} mode="ppe" />}

            {/* AI Status Badge */}
            <div
              className={`absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded text-[10px] font-black tracking-widest shadow-sm ${
                ppeResultState === 'CONFIRMED_MISSING'
                  ? 'bg-[#DF2225]/90 text-white'
                  : ppeResultState === 'PENDING_CONFIRMATION' || ppeResultState === 'UNKNOWN'
                    ? 'bg-amber-900/85 text-amber-100'
                    : 'bg-slate-900/75 text-white/80'
              }`}
            >
              {isLive
                ? tr('common.mf04_ai_realtime')
                : aiTimeline
                  ? tr('common.mf04_ai_pipeline')
                  : tr('ppe_monitoring_view.mf04_ai_output_required')}{' '}
              ·{' '}
              {ppeResultState === 'CONFIRMED_MISSING'
                ? tr('common.missing_ppe')
                : ppeResultState === 'PENDING_CONFIRMATION'
                  ? tr('common.verifying_ppe')
                  : ppeResultState === 'COMPLIANT'
                    ? tr('common.ppe_compliant')
                    : ppeResultState === 'UNKNOWN'
                      ? tr('common.ppe_unknown')
                      : tr('common.no_targets')}{' '}
              · {isLive ? clockTime : (testDetection?.timecode ?? '00:00')}
            </div>

            {/* Horizontal scanning line */}
            <div className="absolute top-[40%] left-0 right-0 h-[1px] bg-[#F66B17] opacity-60 shadow-[0_0_8px_#F66B17]" />

            {/* Render every tracked worker in the current frame */}
            {!isLive &&
              ppeDetections.map((detection) =>
                detection.boundingBox ? (
                  <div
                    key={`${detection.eventId}-${detection.trackId}`}
                    className={`absolute pointer-events-none border-[1.6px] transition-all duration-300 ${
                      isConfirmedPpeDetection(detection) ? 'border-[#F66B17]' : 'border-emerald-400'
                    }`}
                    data-testid="ppe-test-detection"
                    style={{
                      top: `${detection.boundingBox.y1 * 100}%`,
                      width: `${(detection.boundingBox.x2 - detection.boundingBox.x1) * 100}%`,
                      height: `${(detection.boundingBox.y2 - detection.boundingBox.y1) * 100}%`,
                      left: `${detection.boundingBox.x1 * 100}%`,
                    }}
                  >
                    <div
                      className={`absolute -top-[18px] left-[-1.6px] whitespace-nowrap px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white shadow-sm ${
                        isConfirmedPpeDetection(detection) ? 'bg-[#F66B17]' : 'bg-emerald-600'
                      }`}
                    >
                      {tr('ppe_monitoring_view.value_track_value', {
                        value1: localizedDetectionLabel(detection.label),
                        value2: detection.trackId,
                      })}
                    </div>
                  </div>
                ) : null,
              )}

            {/* Empty live frame indicator */}
            {isLive && ppeDetections.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded text-white/90 text-xs font-semibold">
                  {tr('ppe_monitoring_view.live_feed_connected_no_workers_detected_in_frame')}
                </div>
              </div>
            )}
          </div>

          {/* Top Camera Metadata */}
          <div className="relative z-10 px-5 py-4 flex items-start justify-between text-white">
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-sm tracking-wide text-white drop-shadow-md">
                {activeCameraContext.camera}
              </span>
              <span className="text-white/90 font-semibold text-xs tracking-wider uppercase drop-shadow-md">
                {activeCameraContext.workArea}
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded bg-black/60 backdrop-blur-sm">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isLive && socketConnected
                    ? 'bg-[#DF2225] animate-ping'
                    : socketError
                      ? 'bg-amber-400'
                      : 'bg-slate-400'
                }`}
              />
              <span className="font-mono text-[10px] font-bold text-white tracking-wider">
                {isLive && socketConnected
                  ? tr('common.live_value', { value1: clockTime })
                  : socketError
                    ? tr('common.offline_socket_error')
                    : tr('common.timeline_value', { value1: testDetection?.timecode ?? '00:00' })}
              </span>
            </div>
          </div>

          {/* Socket error message banner if present */}
          {socketError && (
            <div className="relative z-10 px-5 py-1.5 bg-amber-900/80 text-amber-200 text-xs flex items-center gap-2 backdrop-blur-sm">
              <IconAlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
              <span className="truncate">
                {tr('common.ai_websocket_value', { value1: socketError })}
              </span>
            </div>
          )}

          {/* Bottom Camera Controls */}
          <div className="relative z-10 px-5 py-3 bg-gradient-to-t from-black/60 to-transparent flex items-center justify-between text-white text-xs opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={togglePlayback}
                disabled={isLive}
                className="p-1.5 rounded hover:bg-white/15 text-white transition-colors cursor-pointer disabled:cursor-not-allowed"
                aria-label={isPlaying ? tr('common.pause_playback') : tr('common.resume_playback')}
                title={
                  isLive
                    ? tr('ppe_monitoring_view.playback_controls_apply_to_timeline_replay_only')
                    : isPlaying
                      ? tr('common.pause')
                      : tr('common.play')
                }
              >
                {isPlaying ? <IconPause className="w-4 h-4" /> : <IconPlay className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={toggleMuted}
                disabled={isLive}
                className="p-1.5 rounded hover:bg-white/15 text-white transition-colors cursor-pointer disabled:cursor-not-allowed"
                aria-label={isMuted ? tr('common.unmute_audio') : tr('common.mute_audio')}
                title={
                  isLive
                    ? tr('ppe_monitoring_view.realtime_preview_has_no_audio')
                    : tr('common.sound')
                }
              >
                <IconVolume className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled
                className="p-1.5 rounded text-white/40 cursor-not-allowed"
                title={tr('ppe_monitoring_view.multi_camera_grid_view_is_currently_unavailable')}
                aria-label={tr('common.grid_view_unavailable')}
              >
                <IconGrid className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => void videoRef.current?.requestFullscreen()}
                className="p-1.5 rounded hover:bg-white/15 text-white transition-colors cursor-pointer"
                title={tr('common.fullscreen')}
                aria-label={tr('common.enter_fullscreen')}
              >
                <IconMaximize className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right: AI Detection & PPE Check Card (355px) */}
        <div className="bg-white rounded-lg border border-[#EAEAEA] flex flex-col justify-between h-[600px] xl:h-[466px] overflow-y-auto min-w-0">
          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 min-w-0">
              <span className="text-xs font-bold text-[#6B6B6B] uppercase tracking-widest">
                {tr('common.ai_detection')}
              </span>
              <span className="max-w-full break-all font-mono text-[11px] font-semibold text-[#6B6B6B]">
                {testDetection?.eventId ?? tr('common.no_detection')}
              </span>
            </div>

            {/* 2-Column Details Grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-wider">
                  {tr('common.identity')}
                </p>
                <p className="font-semibold text-[#2F3437] text-[13px] mt-1">
                  {testDetection?.trackId !== null && testDetection?.trackId !== undefined
                    ? tr('ppe_monitoring_view.unknown_not_identified')
                    : tr('common.no_person_detected')}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-wider">
                  {tr('common.track_id')}
                </p>
                <p className="font-semibold text-[#2F3437] text-[13px] mt-1">
                  {ppeDetections
                    .map((detection) => tr('messages.2c6bb8488230', { value1: detection.trackId }))
                    .join(', ') || '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-wider">
                  {tr('common.camera')}
                </p>
                <p className="font-semibold text-[#2F3437] text-[13px] mt-1">
                  {activeCameraContext.camera}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-wider">
                  {tr('common.work_area')}
                </p>
                <p className="font-semibold text-[#2F3437] text-[13px] mt-1">
                  {activeCameraContext.workArea}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-wider">
                  {tr('common.detected')}
                </p>
                <p className="font-semibold text-[#2F3437] text-[13px] mt-1">
                  {isLive ? clockTime : (testDetection?.timecode ?? '00:00')}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-wider">
                  {tr('common.detection_confidence')}
                </p>
                <p className="font-semibold text-[#2F3437] text-[13px] mt-1">
                  {testDetection?.confidence === null || testDetection?.confidence === undefined
                    ? '—'
                    : `${Math.round(testDetection.confidence * 100)}%`}
                </p>
              </div>
            </div>

            <div className="h-px bg-[#F7F6F3] w-full" />

            {/* PPE Check List */}
            <div>
              <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-4">
                {tr('common.ppe_check')}
              </p>
              <div className="space-y-2">
                {ppeDetections.length === 0 ? (
                  <p className="text-xs text-[#6B6B6B] italic">
                    {tr('ppe_monitoring_view.no_tracked_individuals_in_current_frame')}
                  </p>
                ) : (
                  ppeDetections.map((detection) => {
                    const helmet = getPpeItemDisplayState(detection, 'HARD_HAT');
                    const vest = getPpeItemDisplayState(detection, 'SAFETY_VEST');
                    return (
                      <div
                        key={`ppe-check-${detection.trackId}`}
                        className="rounded-lg bg-[#FBFBFA] p-3"
                      >
                        <p className="mb-2 text-[11px] font-bold text-[#2F3437]">
                          {tr('common.track_value_2c6bb8', { value1: detection.trackId })}
                        </p>
                        <div className="flex items-center justify-between text-xs">
                          <span>
                            {tr('common.helmet_value', {
                              value1:
                                helmet === 'CONFIRMED_MISSING'
                                  ? tr('common.missing_confirmed')
                                  : helmet === 'PENDING_MISSING'
                                    ? tr('common.missing_checking')
                                    : helmet === 'PRESENT'
                                      ? tr('common.detected')
                                      : tr('common.not_assessed'),
                            })}
                          </span>
                          {helmet === 'CONFIRMED_MISSING' ? (
                            <IconX className="w-4 h-4 text-red-500" />
                          ) : helmet === 'PENDING_MISSING' ? (
                            <IconX className="w-4 h-4 text-amber-500" />
                          ) : helmet === 'PRESENT' ? (
                            <IconCheck className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <span className="text-[10px] text-[#A3A09C]">—</span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs">
                          <span>
                            {tr('ppe_monitoring_view.safety_vest_value', {
                              value1:
                                vest === 'CONFIRMED_MISSING'
                                  ? tr('common.missing_confirmed')
                                  : vest === 'PENDING_MISSING'
                                    ? tr('common.missing_checking')
                                    : vest === 'PRESENT'
                                      ? tr('common.detected')
                                      : tr('common.not_assessed'),
                            })}
                          </span>
                          {vest === 'CONFIRMED_MISSING' ? (
                            <IconX className="w-4 h-4 text-red-500" />
                          ) : vest === 'PENDING_MISSING' ? (
                            <IconX className="w-4 h-4 text-amber-500" />
                          ) : vest === 'PRESENT' ? (
                            <IconCheck className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <span className="text-[10px] text-[#A3A09C]">—</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Result Box */}
            <div className="pt-2">
              <div
                className={`border-l-[3px] pl-3 ${
                  ppeResultState === 'CONFIRMED_MISSING'
                    ? 'border-red-500'
                    : ppeResultState === 'PENDING_CONFIRMATION' || ppeResultState === 'UNKNOWN'
                      ? 'border-amber-500'
                      : ppeResultState === 'COMPLIANT'
                        ? 'border-emerald-500'
                        : 'border-[#EAEAEA]'
                }`}
              >
                <p className="text-[9px] font-bold uppercase tracking-widest text-[#6B6B6B] mb-1">
                  {tr('common.result')}
                </p>
                <div
                  className={`flex items-center gap-1.5 text-xs font-bold mb-1 ${
                    ppeResultState === 'CONFIRMED_MISSING'
                      ? 'text-red-500'
                      : ppeResultState === 'PENDING_CONFIRMATION' || ppeResultState === 'UNKNOWN'
                        ? 'text-amber-600'
                        : ppeResultState === 'COMPLIANT'
                          ? 'text-emerald-600'
                          : 'text-[#6B6B6B]'
                  }`}
                >
                  {(ppeResultState === 'CONFIRMED_MISSING' ||
                    ppeResultState === 'PENDING_CONFIRMATION' ||
                    ppeResultState === 'UNKNOWN') && <IconAlertTriangle className="w-3.5 h-3.5" />}
                  <span>
                    {ppeResultState === 'CONFIRMED_MISSING'
                      ? tr('common.missing_ppe_observation')
                      : ppeResultState === 'PENDING_CONFIRMATION'
                        ? tr('common.ppe_check_pending')
                        : ppeResultState === 'COMPLIANT'
                          ? tr('ppe_monitoring_view.all_required_ppe_present')
                          : ppeResultState === 'UNKNOWN'
                            ? tr('common.ppe_status_unknown')
                            : ppeDetections.length === 0
                              ? tr('ppe_monitoring_view.clear_no_targets')
                              : tr('common.ppe_status_unknown')}
                  </span>
                </div>
                <p className="text-xs text-[#6B6B6B]">
                  {ppeResultState === 'CONFIRMED_MISSING'
                    ? tr('ppe_monitoring_view.technical_observation_from_the_yolo_mf04_pipeline')
                    : ppeResultState === 'PENDING_CONFIRMATION'
                      ? tr(
                          'ppe_monitoring_view.missing_evidence_is_waiting_for_multi_frame_confirmation',
                        )
                      : ppeResultState === 'UNKNOWN'
                        ? tr(
                            'ppe_monitoring_view.the_current_frame_does_not_contain_enough_evidence_to_decide_ppe_compliance',
                          )
                        : isLive
                          ? tr('ppe_monitoring_view.streaming_live_inference_from_ai_websocket')
                          : tr(
                              'ppe_monitoring_view.generate_ppe_ai_timeline_json_then_play_the_matching_video',
                            )}
                </p>
              </div>
            </div>

            {!isLive && violationSnapshot && (
              <div
                className="rounded-lg border border-red-200 bg-red-50 p-3"
                data-testid="ppe-evidence-capture"
              >
                <p className="text-[10px] font-bold uppercase tracking-widest text-red-700">
                  {tr('ppe_monitoring_view.evidence_captured_value', {
                    value1: violationSnapshot.timecode,
                  })}
                </p>
                <img
                  src={violationSnapshot.imageUrl}
                  alt={tr('ppe_monitoring_view.captured_frame_for_value', {
                    value1: violationSnapshot.eventId,
                  })}
                  className="mt-2 w-full rounded border border-red-200"
                />
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="p-6 pt-0 space-y-2">
            <button
              onClick={openReviewFromDetection}
              disabled={!testDetection || !isConfirmedPpeDetection(testDetection)}
              className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm shadow-sm transition-colors cursor-pointer ${
                testDetection && isConfirmedPpeDetection(testDetection)
                  ? 'bg-[#F66B17] hover:bg-[#E05A0B] text-white'
                  : 'bg-[#F7F6F3] text-[#A3A09C] cursor-not-allowed'
              }`}
            >
              {tr('common.review_alert')}
            </button>
            <button
              onClick={() => {
                if (testDetection?.trackId !== null && testDetection?.trackId !== undefined) {
                  setActiveFilterWorker((prev) =>
                    prev === testDetection.trackId ? null : testDetection.trackId,
                  );
                }
              }}
              className="w-full py-2.5 px-4 rounded-lg bg-white border border-[#EAEAEA] text-[#2F3437] font-semibold text-sm hover:bg-[#FBFBFA] transition-colors cursor-pointer"
            >
              {activeFilterWorker !== null
                ? tr('ppe_monitoring_view.clear_worker_filter_value', {
                    value1: activeFilterWorker,
                  })
                : testDetection?.trackId !== null && testDetection?.trackId !== undefined
                  ? tr('ppe_monitoring_view.filter_by_worker_track_value', {
                      value1: testDetection.trackId,
                    })
                  : tr('ppe_monitoring_view.view_worker_no_target')}
            </button>
          </div>
        </div>
      </div>

      {/* Live AI Observations status or Replay Observations Table */}
      {isLive ? (
        <div className="bg-white rounded-xl shadow-sm border border-[#EAEAEA] p-6 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#DF2225] animate-ping" />
                <h3 className="text-sm font-bold text-[#2F3437] uppercase tracking-wider">
                  {tr('ppe_monitoring_view.live_ai_observations_active')}
                </h3>
              </div>
              <p className="text-xs text-[#6B6B6B] max-w-2xl leading-relaxed">
                {tr(
                  'ppe_monitoring_view.technical_ppe_detections_are_rendered_directly_on_the_live_camera_feed_above_sampl',
                )}
              </p>
            </div>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('incidents', { alertType: 'PPE_VIOLATION' })}
                className="self-start sm:self-auto px-3.5 py-2 rounded-lg border border-[#F66B17]/40 bg-orange-50 text-[#F66B17] hover:bg-orange-100 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shadow-xs"
              >
                {tr('ppe_monitoring_view.view_in_safety_alerts')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-[#EAEAEA] p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-[#2F3437]">
                {tr('common.ppe_replay_observations')}
              </h3>
              <p className="text-xs text-[#6B6B6B] mt-1">
                {tr(
                  'ppe_monitoring_view.observations_from_the_sample_video_timeline_live_safety_alerts_are_available_in_sa',
                  {
                    value1:
                      activeFilterWorker !== null &&
                      tr('messages.becfe40eedac', { value1: activeFilterWorker }),
                  },
                )}
              </p>
            </div>
            {/* Functional event filter controls and Safety Alerts navigation */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate('incidents', { alertType: 'PPE_VIOLATION' })}
                  className="px-2.5 py-1.5 rounded-lg border border-[#F66B17]/40 bg-orange-50 text-[#F66B17] hover:bg-orange-100 text-xs font-semibold transition-colors cursor-pointer"
                >
                  {tr('ppe_monitoring_view.view_in_safety_alerts')}
                </button>
              )}
              <button
                onClick={() => setPpeFilter('ALL')}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                  ppeFilter === 'ALL'
                    ? 'border-orange-300 bg-orange-50 text-[#F66B17]'
                    : 'border-[#EAEAEA] bg-white text-[#6B6B6B] hover:bg-[#FBFBFA]'
                }`}
              >
                {tr('common.all_events_value', { value1: ppeEvents.length })}
              </button>
              <button
                onClick={() => setPpeFilter('HARD_HAT')}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                  ppeFilter === 'HARD_HAT'
                    ? 'border-orange-300 bg-orange-50 text-[#F66B17]'
                    : 'border-[#EAEAEA] bg-white text-[#6B6B6B] hover:bg-[#FBFBFA]'
                }`}
              >
                {tr('common.missing_helmet_value', {
                  value1: ppeEvents.filter((e) => e.ppeItem === 'HARD_HAT').length,
                })}
              </button>
              <button
                onClick={() => setPpeFilter('SAFETY_VEST')}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                  ppeFilter === 'SAFETY_VEST'
                    ? 'border-orange-300 bg-orange-50 text-[#F66B17]'
                    : 'border-[#EAEAEA] bg-white text-[#6B6B6B] hover:bg-[#FBFBFA]'
                }`}
              >
                {tr('common.missing_vest_value', {
                  value1: ppeEvents.filter((e) => e.ppeItem === 'SAFETY_VEST').length,
                })}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#EAEAEA] text-[#6B6B6B] font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-3">{tr('common.time')}</th>
                  <th className="py-3 px-3">{tr('common.worker')}</th>
                  <th className="py-3 px-3">{tr('common.camera')}</th>
                  <th className="py-3 px-3">{tr('common.work_area')}</th>
                  <th className="py-3 px-3">{tr('common.issue')}</th>
                  <th className="py-3 px-3">{tr('common.confidence')}</th>
                  <th className="py-3 px-3">{tr('common.status')}</th>
                  <th className="py-3 px-3 text-right">{tr('common.action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAEAEA]">
                {displayedEvents.map((evt) => (
                  <tr key={evt.rowKey} className="hover:bg-[#FBFBFA] transition-colors group">
                    <td className="py-3 px-3 font-mono text-[#6B6B6B] text-xs">{evt.time}</td>
                    <td className="py-3 px-3 font-semibold text-[#2F3437]">{evt.worker}</td>
                    <td className="py-3 px-3 font-mono text-[#6B6B6B] text-xs font-semibold">
                      {evt.camera}
                    </td>
                    <td className="py-3 px-3 text-[#6B6B6B]">{evt.workArea}</td>
                    <td className="py-3 px-3 font-medium text-[#2F3437]">
                      {localizedLabel(evt.issue)}
                    </td>
                    <td className="py-3 px-3 font-semibold text-[#2F3437]">{evt.confidence}</td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                          evt.status === 'Open'
                            ? 'bg-red-50 text-red-600'
                            : evt.status === 'Logged'
                              ? 'bg-emerald-50 text-emerald-600'
                              : 'bg-amber-50 text-amber-600'
                        }`}
                      >
                        {localizedLabel(evt.status)}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => setSelectedReview(evt)}
                        className="px-3 py-1 rounded text-xs font-semibold transition-colors bg-[#F7F6F3] text-[#2F3437] hover:bg-[#EAEAEA] cursor-pointer"
                      >
                        {tr('common.review')}
                      </button>
                    </td>
                  </tr>
                ))}
                {displayedEvents.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-[#6B6B6B] text-xs">
                      {tr('ppe_monitoring_view.no_ppe_events_match_the_selected_criteria')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Review Modal with Bound Data from Selected Row or Detection */}
      {selectedReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] font-bold font-mono uppercase tracking-wider">
                  {selectedReview.id}
                </span>
                <h3 className="font-bold text-[#2F3437]">{tr('common.violation_review')}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReview(null)}
                aria-label={tr('common.close_review_dialog')}
                className="text-[#6B6B6B] hover:text-[#2F3437] cursor-pointer"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-sm text-[#6B6B6B]">
              <p>
                {tr('ppe_monitoring_view.ai_detected_an_observation_for')}{' '}
                <strong className="text-[#2F3437]">
                  {selectedReview.unknownTrack
                    ? tr('common.unknown_worker_c1ef7f')
                    : tr('messages.2c6bb8488230', { value1: selectedReview.trackId })}
                </strong>{' '}
                {tr('common.in_582967')}{' '}
                <strong className="text-[#2F3437]">
                  {
                    resolveCameraAndWorkArea(selectedReview.camera, selectedReview.regionId)
                      .workArea
                  }
                </strong>{' '}
                ({selectedReview.camera}
                {tr('common.observation_b1add8')}{' '}
                <strong className="text-[#2F3437]">
                  {selectedReview.ppeItem
                    ? tr('monitoring_utils.missing_item', {
                        item: localizedLabel(selectedReview.ppeItem),
                      })
                    : localizedDetectionLabel(selectedReview.issue)}
                </strong>{' '}
                {tr('common.confidence_793412')} {selectedReview.confidence}).
              </p>
              <div className="p-3 bg-[#FBFBFA] border border-[#EAEAEA] rounded-lg space-y-1">
                <p className="font-bold text-[#2F3437] text-xs uppercase tracking-wider">
                  {tr('common.technical_evidence_preview')}
                </p>
                <p className="text-[#6B6B6B] text-xs leading-relaxed">
                  {tr(
                    'ppe_monitoring_view.ai_detections_are_preliminary_observations_to_review_durable_records_inspect_sessi',
                  )}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              {onNavigate ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedReview(null);
                    onNavigate('incidents', { alertType: 'PPE_VIOLATION' });
                  }}
                  className="py-2 px-4 rounded-lg bg-[#F66B17] hover:bg-[#D94E07] text-white font-bold text-sm shadow transition-colors cursor-pointer text-center"
                >
                  {tr('ppe_monitoring_view.review_in_safety_alerts')}
                </button>
              ) : (
                <button
                  disabled
                  title={tr('ppe_monitoring_view.safety_alerts_navigation_not_configured')}
                  className="py-2 px-4 rounded-lg bg-[#F66B17]/60 text-white font-bold text-sm cursor-not-allowed shadow transition-colors text-center"
                >
                  {tr('common.review_in_alerts')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedReview(null)}
                className="py-2 px-4 rounded-lg bg-[#F7F6F3] hover:bg-[#EAEAEA] text-[#2F3437] font-bold text-sm transition-colors cursor-pointer text-center"
              >
                {tr('common.dismiss_preview')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
