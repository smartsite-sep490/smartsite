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
  type VideoTestDetection,
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
  workArea: string;
  issue: string;
  confidence: string;
  status: string;
  time: string;
}

export function PpeMonitoringView() {
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
  const [liveDetections, setLiveDetections] = useState<VideoTestDetection[] | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [socketRuntimeError, setSocketRuntimeError] = useState<string | null>(null);
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

  // AI Realtime WebSocket connection with auth token
  useEffect(() => {
    if (!wsConfig.url) {
      return;
    }

    let unmounted = false;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let currentSocket: WebSocket | null = null;

    const connect = () => {
      if (unmounted) return;
      try {
        const socket = new WebSocket(wsConfig.url!);
        currentSocket = socket;

        socket.onopen = () => {
          if (unmounted) return;
          setSocketConnected(true);
          setSocketRuntimeError(null);
        };

        socket.onmessage = (message) => {
          if (unmounted) return;
          try {
            const payload = JSON.parse(message.data) as {
              type?: string;
              message?: string;
              cameraExternalId?: string;
              detections?: Array<{
                trackId: number;
                confidence: number;
                boundingBox: VideoTestDetection['boundingBox'];
                ppeStatus: VideoTestDetection['ppeStatus'];
                alertState?: VideoTestDetection['alertState'];
                confirmedMissingItems?: VideoTestDetection['confirmedMissingItems'];
                active: boolean;
                label: string;
                regionId?: string;
              }>;
            };

            if (payload.type === 'error') {
              setSocketRuntimeError(payload.message ?? 'Realtime AI socket error');
              return;
            }

            if (payload.type !== 'frame' || !payload.detections) return;

            setSocketRuntimeError(null);
            setLiveDetections(
              payload.detections.map((detection) => ({
                active: detection.active,
                alertState: detection.alertState,
                boundingBox: detection.boundingBox,
                cameraExternalId: payload.cameraExternalId,
                confidence: detection.confidence,
                confirmedMissingItems: detection.confirmedMissingItems,
                eventId: `REALTIME-TRACK-${detection.trackId}`,
                label: `MF05 ${detection.label}`,
                ppeStatus: detection.ppeStatus,
                regionId: detection.regionId,
                timecode: 'LIVE',
                trackId: detection.trackId,
              })),
            );
          } catch {
            // Keep last frame on malformed message
          }
        };

        socket.onerror = () => {
          if (unmounted) return;
          setSocketConnected(false);
          setSocketRuntimeError('WebSocket connection error');
          setLiveDetections(null);
        };

        socket.onclose = () => {
          if (unmounted) return;
          setSocketConnected(false);
          setLiveDetections(null);
          // Auto-reconnect when still mounted
          reconnectTimeout = setTimeout(connect, 3000);
        };
      } catch (err) {
        if (unmounted) return;
        setSocketConnected(false);
        setSocketRuntimeError(err instanceof Error ? err.message : 'Failed to connect WebSocket');
        setLiveDetections(null);
      }
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (currentSocket) {
        currentSocket.onopen = null;
        currentSocket.onmessage = null;
        currentSocket.onerror = null;
        currentSocket.onclose = null;
        currentSocket.close();
      }
    };
  }, [wsConfig.url]);

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
  const ppeResultState = useMemo(() => getPpeResultState(ppeDetections), [ppeDetections]);

  // Derive cameraExternalId and human-readable work area directly from active detection or timeline
  const activeCameraContext = useMemo(() => {
    return resolveCameraAndWorkArea(
      testDetection?.cameraExternalId || aiTimeline?.cameraExternalId,
      testDetection?.regionId,
      'Chưa có mã camera',
    );
  }, [testDetection?.cameraExternalId, testDetection?.regionId, aiTimeline?.cameraExternalId]);

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
              'Chưa có mã camera',
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
              worker: `Track #${observation.trackId}`,
              camera: context.camera,
              workArea: context.workArea,
              issue: `Missing ${observation.ppeItem === 'HARD_HAT' ? 'Hard Hat' : 'Safety Vest'}`,
              confidence: person?.confidence ? `${Math.round(person.confidence * 100)}%` : '—',
              status: 'Technical observation',
            };
          }),
      )
      .slice(-20)
      .reverse();
  }, [aiTimeline]);

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
      'Chưa có mã camera',
    );
    setSelectedReview({
      id: testDetection.eventId,
      rowKey: `${testDetection.eventId}-${testDetection.trackId ?? 0}`,
      trackId: testDetection.trackId ?? 0,
      worker: testDetection.trackId !== null ? `Track #${testDetection.trackId}` : 'Unknown Worker',
      camera: context.camera,
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
      <div className="grid grid-cols-1 xl:grid-cols-[829px_355px] gap-4 items-start mt-4">
        {/* Left: Camera Feed */}
        <div className="relative bg-[#041D2E] rounded-xl overflow-hidden shadow-sm w-full aspect-video xl:h-[466px] flex flex-col justify-between select-none">
          {/* Local MF05 test fixture driven by the video timeline. */}
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
              aria-label="PPE test video"
              className="w-full h-full object-cover"
            />

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
                ? 'MF05 AI REALTIME'
                : aiTimeline
                  ? 'MF05 AI PIPELINE'
                  : 'MF05 AI OUTPUT REQUIRED'}{' '}
              ·{' '}
              {ppeResultState === 'CONFIRMED_MISSING'
                ? 'MISSING PPE'
                : ppeResultState === 'PENDING_CONFIRMATION'
                  ? 'VERIFYING PPE'
                  : ppeResultState === 'COMPLIANT'
                    ? 'PPE COMPLIANT'
                    : ppeResultState === 'UNKNOWN'
                      ? 'PPE UNKNOWN'
                      : 'NO TARGETS'}{' '}
              · {isLive ? clockTime : (testDetection?.timecode ?? '00:00')}
            </div>

            {/* Horizontal scanning line */}
            <div className="absolute top-[40%] left-0 right-0 h-[1px] bg-[#F66B17] opacity-60 shadow-[0_0_8px_#F66B17]" />

            {/* Render every tracked worker in the current frame */}
            {ppeDetections.map((detection) =>
              detection.boundingBox ? (
                <div
                  key={`${detection.eventId}-${detection.trackId}`}
                  className={`absolute pointer-events-none border-[1.6px] transition-all duration-300 ${
                    isConfirmedPpeDetection(detection) ? 'border-[#F66B17]' : 'border-emerald-400'
                  }`}
                  data-testid="mf05-test-detection"
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
                    {detection.label} · TRACK #{detection.trackId}
                  </div>
                </div>
              ) : null,
            )}

            {/* Empty live frame indicator */}
            {isLive && ppeDetections.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded text-white/90 text-xs font-semibold">
                  Live Feed Connected · No Workers Detected In Frame
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
                  ? `LIVE - ${clockTime}`
                  : socketError
                    ? 'OFFLINE (SOCKET ERROR)'
                    : `TIMELINE - ${testDetection?.timecode ?? '00:00'}`}
              </span>
            </div>
          </div>

          {/* Socket error message banner if present */}
          {socketError && (
            <div className="relative z-10 px-5 py-1.5 bg-amber-900/80 text-amber-200 text-xs flex items-center gap-2 backdrop-blur-sm">
              <IconAlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
              <span className="truncate">AI WebSocket: {socketError}</span>
            </div>
          )}

          {/* Bottom Camera Controls */}
          <div className="relative z-10 px-5 py-3 bg-gradient-to-t from-black/60 to-transparent flex items-center justify-between text-white text-xs opacity-0 hover:opacity-100 transition-opacity">
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlayback}
                className="p-1.5 rounded hover:bg-white/15 text-white transition-colors"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <IconPause className="w-4 h-4" /> : <IconPlay className="w-4 h-4" />}
              </button>
              <button
                onClick={toggleMuted}
                className="p-1.5 rounded hover:bg-white/15 text-white transition-colors"
                title="Sound"
              >
                <IconVolume className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                className="p-1.5 rounded hover:bg-white/15 text-white transition-colors"
                title="Grid"
              >
                <IconGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => void videoRef.current?.requestFullscreen()}
                className="p-1.5 rounded hover:bg-white/15 text-white transition-colors"
                title="Fullscreen"
              >
                <IconMaximize className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right: AI Detection & PPE Check Card (355px) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 flex flex-col justify-between h-[600px] xl:h-[466px] overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between pb-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                AI DETECTION
              </span>
              <span className="font-mono text-[11px] font-semibold text-slate-500">
                {testDetection?.eventId ?? 'NO-DETECTION'}
              </span>
            </div>

            {/* 2-Column Details Grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Worker
                </p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">
                  {testDetection?.trackId !== null && testDetection?.trackId !== undefined
                    ? `Worker (Track #${testDetection.trackId})`
                    : 'Unassigned'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Worker ID
                </p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">
                  {ppeDetections.map((detection) => `Track #${detection.trackId}`).join(', ') ||
                    '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Camera
                </p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">
                  {activeCameraContext.camera}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Work Area
                </p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">
                  {activeCameraContext.workArea}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Detected
                </p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">
                  {isLive ? clockTime : (testDetection?.timecode ?? '00:00')}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Recognition Confidence
                </p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">
                  {testDetection?.confidence === null || testDetection?.confidence === undefined
                    ? '—'
                    : `${Math.round(testDetection.confidence * 100)}%`}
                </p>
              </div>
            </div>

            <div className="h-px bg-slate-100 w-full" />

            {/* PPE Check List */}
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">
                PPE CHECK
              </p>
              <div className="space-y-2">
                {ppeDetections.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">
                    No tracked individuals in current frame
                  </p>
                ) : (
                  ppeDetections.map((detection) => {
                    const helmet = getPpeItemDisplayState(detection, 'HARD_HAT');
                    const vest = getPpeItemDisplayState(detection, 'SAFETY_VEST');
                    return (
                      <div
                        key={`ppe-check-${detection.trackId}`}
                        className="rounded-lg bg-slate-50 p-3"
                      >
                        <p className="mb-2 text-[11px] font-bold text-slate-700">
                          Track #{detection.trackId}
                        </p>
                        <div className="flex items-center justify-between text-xs">
                          <span>
                            Helmet ·{' '}
                            {helmet === 'CONFIRMED_MISSING'
                              ? 'Missing · confirmed'
                              : helmet === 'PENDING_MISSING'
                                ? 'Missing · checking'
                                : helmet === 'PRESENT'
                                  ? 'Detected'
                                  : 'Not assessed'}
                          </span>
                          {helmet === 'CONFIRMED_MISSING' ? (
                            <IconX className="w-4 h-4 text-red-500" />
                          ) : helmet === 'PENDING_MISSING' ? (
                            <IconX className="w-4 h-4 text-amber-500" />
                          ) : helmet === 'PRESENT' ? (
                            <IconCheck className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <span className="text-[10px] text-slate-400">—</span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs">
                          <span>
                            Safety Vest ·{' '}
                            {vest === 'CONFIRMED_MISSING'
                              ? 'Missing · confirmed'
                              : vest === 'PENDING_MISSING'
                                ? 'Missing · checking'
                                : vest === 'PRESENT'
                                  ? 'Detected'
                                  : 'Not assessed'}
                          </span>
                          {vest === 'CONFIRMED_MISSING' ? (
                            <IconX className="w-4 h-4 text-red-500" />
                          ) : vest === 'PENDING_MISSING' ? (
                            <IconX className="w-4 h-4 text-amber-500" />
                          ) : vest === 'PRESENT' ? (
                            <IconCheck className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <span className="text-[10px] text-slate-400">—</span>
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
                        : 'border-slate-300'
                }`}
              >
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">
                  RESULT
                </p>
                <div
                  className={`flex items-center gap-1.5 text-xs font-bold mb-1 ${
                    ppeResultState === 'CONFIRMED_MISSING'
                      ? 'text-red-500'
                      : ppeResultState === 'PENDING_CONFIRMATION' || ppeResultState === 'UNKNOWN'
                        ? 'text-amber-600'
                        : ppeResultState === 'COMPLIANT'
                          ? 'text-emerald-600'
                          : 'text-slate-500'
                  }`}
                >
                  {(ppeResultState === 'CONFIRMED_MISSING' ||
                    ppeResultState === 'PENDING_CONFIRMATION' ||
                    ppeResultState === 'UNKNOWN') && <IconAlertTriangle className="w-3.5 h-3.5" />}
                  <span>
                    {ppeResultState === 'CONFIRMED_MISSING'
                      ? 'MISSING PPE OBSERVATION'
                      : ppeResultState === 'PENDING_CONFIRMATION'
                        ? 'PPE CHECK PENDING'
                        : ppeResultState === 'COMPLIANT'
                          ? 'ALL REQUIRED PPE PRESENT'
                          : ppeResultState === 'UNKNOWN'
                            ? 'PPE STATUS UNKNOWN'
                            : ppeDetections.length === 0
                              ? 'CLEAR - NO TARGETS'
                              : 'PPE STATUS UNKNOWN'}
                  </span>
                </div>
                <p className="text-xs text-slate-600">
                  {ppeResultState === 'CONFIRMED_MISSING'
                    ? 'Technical observation from the YOLO + MF05 pipeline.'
                    : ppeResultState === 'PENDING_CONFIRMATION'
                      ? 'Missing evidence is waiting for multi-frame confirmation.'
                      : ppeResultState === 'UNKNOWN'
                        ? 'The current frame does not contain enough evidence to decide PPE compliance.'
                        : isLive
                          ? 'Streaming live inference from AI WebSocket.'
                          : 'Generate ppe-ai.timeline.json, then play the matching video.'}
                </p>
              </div>
            </div>

            {violationSnapshot && (
              <div
                className="rounded-lg border border-red-200 bg-red-50 p-3"
                data-testid="mf05-evidence-capture"
              >
                <p className="text-[10px] font-bold uppercase tracking-widest text-red-700">
                  Evidence captured · {violationSnapshot.timecode}
                </p>
                <img
                  src={violationSnapshot.imageUrl}
                  alt={`Captured frame for ${violationSnapshot.eventId}`}
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
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              Review Alert
            </button>
            <button
              onClick={() => {
                if (testDetection?.trackId !== null && testDetection?.trackId !== undefined) {
                  setActiveFilterWorker((prev) =>
                    prev === testDetection.trackId ? null : testDetection.trackId,
                  );
                }
              }}
              className="w-full py-2.5 px-4 rounded-lg bg-white border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors cursor-pointer"
            >
              {activeFilterWorker !== null
                ? `Clear Worker Filter (#${activeFilterWorker})`
                : testDetection?.trackId !== null && testDetection?.trackId !== undefined
                  ? `Filter By Worker Track #${testDetection.trackId}`
                  : 'View Worker (No Target)'}
            </button>
          </div>
        </div>
      </div>

      {/* Recent PPE Events Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Recent PPE Events</h3>
            <p className="text-xs text-slate-500 mt-1">
              Latest camera detections and verification outcomes.
              {activeFilterWorker !== null && ` (Filtered by Track #${activeFilterWorker})`}
            </p>
          </div>
          {/* Functional event filter controls (no misleading "Last 24 hours" label) */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setPpeFilter('ALL')}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                ppeFilter === 'ALL'
                  ? 'border-orange-300 bg-orange-50 text-[#F66B17]'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              All Events ({ppeEvents.length})
            </button>
            <button
              onClick={() => setPpeFilter('HARD_HAT')}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                ppeFilter === 'HARD_HAT'
                  ? 'border-orange-300 bg-orange-50 text-[#F66B17]'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              Missing Helmet ({ppeEvents.filter((e) => e.ppeItem === 'HARD_HAT').length})
            </button>
            <button
              onClick={() => setPpeFilter('SAFETY_VEST')}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                ppeFilter === 'SAFETY_VEST'
                  ? 'border-orange-300 bg-orange-50 text-[#F66B17]'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              Missing Vest ({ppeEvents.filter((e) => e.ppeItem === 'SAFETY_VEST').length})
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                <th className="py-3 px-3">Time</th>
                <th className="py-3 px-3">Worker</th>
                <th className="py-3 px-3">Camera</th>
                <th className="py-3 px-3">Work Area</th>
                <th className="py-3 px-3">Issue</th>
                <th className="py-3 px-3">Confidence</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayedEvents.map((evt) => (
                <tr key={evt.rowKey} className="hover:bg-slate-50 transition-colors group">
                  <td className="py-3 px-3 font-mono text-slate-500 text-xs">{evt.time}</td>
                  <td className="py-3 px-3 font-semibold text-slate-900">{evt.worker}</td>
                  <td className="py-3 px-3 font-mono text-slate-500 text-xs font-semibold">
                    {evt.camera}
                  </td>
                  <td className="py-3 px-3 text-slate-600">{evt.workArea}</td>
                  <td className="py-3 px-3 font-medium text-slate-900">{evt.issue}</td>
                  <td className="py-3 px-3 font-semibold text-slate-900">{evt.confidence}</td>
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
                      {evt.status}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <button
                      onClick={() => setSelectedReview(evt)}
                      className="px-3 py-1 rounded text-xs font-semibold transition-colors bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer"
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
              {displayedEvents.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-400 text-xs">
                    No PPE events match the selected criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Review Modal with Bound Data from Selected Row or Detection */}
      {selectedReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] font-bold font-mono uppercase tracking-wider">
                  {selectedReview.id}
                </span>
                <h3 className="font-bold text-slate-900">Violation Review</h3>
              </div>
              <button
                onClick={() => setSelectedReview(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-sm text-slate-600">
              <p>
                AI detected an observation for{' '}
                <strong className="text-slate-900">{selectedReview.worker}</strong> in{' '}
                <strong className="text-slate-900">{selectedReview.workArea}</strong> (
                {selectedReview.camera}). Observation:{' '}
                <strong className="text-slate-900">{selectedReview.issue}</strong> (Confidence:{' '}
                {selectedReview.confidence}).
              </p>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                <p className="font-bold text-slate-700 text-xs uppercase tracking-wider">
                  Review Status: Local Preview
                </p>
                <p className="text-slate-600 text-xs">
                  Backend review and dispatch API endpoints are not yet integrated. Actions below
                  are recorded in preview state only.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                disabled
                title="Review dispatch API endpoint pending integration"
                className="py-2 px-4 rounded-lg bg-[#F66B17]/60 text-white font-bold text-sm cursor-not-allowed shadow transition-colors"
              >
                Dispatch (API Pending)
              </button>
              <button
                onClick={() => setSelectedReview(null)}
                className="py-2 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition-colors cursor-pointer"
              >
                Dismiss Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
