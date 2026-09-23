import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconX,
  IconAlertTriangle,
  IconClock,
  IconPlay,
  IconPause,
  IconVolume,
  IconMaximize,
  IconGrid,
} from '../icons';
import {
  getZoneVideoTestDetections,
  loadAiVideoTimeline,
  type AiVideoTimeline,
  type VideoTestDetection,
  type VideoTestTimeline,
} from '../cameras/videoTestFixture';
import {
  buildAiWebSocketUrl,
  getEffectiveDetections,
  getPrimaryZoneDetection,
  getZoneEventRowKey,
  mapContainerPointToVideoNormalized,
  mapVideoNormalizedToContainerNormalized,
  exportZoneBrowserDraft,
  formatClockTime,
  type NormalizedPoint,
  type Size2D,
} from '../cameras/monitoringUtils';

const DEFAULT_ZONE_POLYGON: NormalizedPoint[] = [
  [0.63, 0.2],
  [0.98, 0.2],
  [0.98, 0.9],
  [0.63, 0.9],
];

const ZONE_STORAGE_KEY = 'smartsite.restricted-zone.camera-04';

function getSavedZonePolygon(): NormalizedPoint[] {
  try {
    const saved = window.localStorage.getItem(ZONE_STORAGE_KEY);
    if (!saved) return DEFAULT_ZONE_POLYGON;
    const parsed = JSON.parse(saved) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length >= 3 &&
      parsed.every(
        (point) =>
          Array.isArray(point) &&
          point.length === 2 &&
          typeof point[0] === 'number' &&
          typeof point[1] === 'number',
      )
    ) {
      return parsed as NormalizedPoint[];
    }
  } catch {
    // Ignore malformed local test data and use the default zone.
  }
  return DEFAULT_ZONE_POLYGON;
}

interface ZoneReviewItem {
  id: string;
  rowKey: string;
  trackId: number;
  person: string;
  zone: string;
  camera: string;
  identity: string;
  authorization: string;
  result: string;
  time: string;
}

export function RestrictedZoneView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState<ZoneReviewItem | null>(null);
  const [videoTimeline, setVideoTimeline] = useState<VideoTestTimeline>({
    currentTime: 0,
    duration: 0,
  });
  const [aiTimeline, setAiTimeline] = useState<AiVideoTimeline | null>(null);
  const [liveZoneDetections, setLiveZoneDetections] = useState<VideoTestDetection[] | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [socketRuntimeError, setSocketRuntimeError] = useState<string | null>(null);
  const [zonePolygon, setZonePolygon] = useState<NormalizedPoint[]>(getSavedZonePolygon);
  const [isEditingZone, setIsEditingZone] = useState(false);
  const [saveStatusMessage, setSaveStatusMessage] = useState<string | null>(null);
  const [clockTime, setClockTime] = useState<string>(() => formatClockTime());
  const [activeFilterWorker, setActiveFilterWorker] = useState<number | null>(null);
  const [timeFilter, setTimeFilter] = useState<'all' | '24h'>('24h');
  const activeZonePoint = useRef<number | null>(null);

  const [containerSize, setContainerSize] = useState<Size2D>({ width: 829, height: 466 });
  const [videoNaturalSize, setVideoNaturalSize] = useState<Size2D>({ width: 1920, height: 1080 });

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

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setClockTime(formatClockTime());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Track container dimensions for accurate object-cover polygon mapping
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          setContainerSize({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
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
              zoneDetections?: Array<{
                trackId: number;
                confidence: number;
                boundingBox: VideoTestDetection['boundingBox'];
                active: boolean;
                label: string;
              }>;
            };

            if (payload.type === 'error') {
              setSocketRuntimeError(payload.message ?? 'Realtime AI socket error');
              return;
            }

            if (payload.type !== 'frame' || !payload.zoneDetections) return;

            setSocketRuntimeError(null);
            setLiveZoneDetections(
              payload.zoneDetections.map((detection) => ({
                active: detection.active,
                boundingBox: detection.boundingBox,
                confidence: detection.confidence,
                eventId: `REALTIME-ZONE-TRACK-${detection.trackId}`,
                label: `MF06 ${detection.label}`,
                ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'UNKNOWN' },
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
          setLiveZoneDetections(null);
        };

        socket.onclose = () => {
          if (unmounted) return;
          setSocketConnected(false);
          setLiveZoneDetections(null);
          // Auto-reconnect when still mounted
          reconnectTimeout = setTimeout(connect, 3000);
        };
      } catch (err) {
        if (unmounted) return;
        setSocketConnected(false);
        setSocketRuntimeError(err instanceof Error ? err.message : 'Failed to connect WebSocket');
        setLiveZoneDetections(null);
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
    () => getZoneVideoTestDetections(videoTimeline, aiTimeline),
    [videoTimeline, aiTimeline],
  );

  const { detections: zoneDetections, isLive } = getEffectiveDetections(
    liveZoneDetections,
    fallbackDetections,
  );

  // Bug 2: Prioritize first active intrusion track, then fallback to index 0
  const testDetection = useMemo(() => {
    return getPrimaryZoneDetection(zoneDetections);
  }, [zoneDetections]);

  const activeZoneDetections = useMemo(() => {
    return zoneDetections.filter((detection) => detection.active);
  }, [zoneDetections]);

  // Map zone polygon from video space to container space for SVG display under object-cover
  const displayPolygon = useMemo(() => {
    return zonePolygon.map((pt) =>
      mapVideoNormalizedToContainerNormalized(pt, containerSize, videoNaturalSize),
    );
  }, [zonePolygon, containerSize, videoNaturalSize]);

  // Bug 6: Coordinate mapping via actual video content area
  const updateZonePoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const pointIndex = activeZonePoint.current;
    if (pointIndex === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const containerX = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const containerY = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));

    const videoPoint = mapContainerPointToVideoNormalized(
      [containerX, containerY],
      { width: rect.width, height: rect.height },
      videoNaturalSize,
    );

    setZonePolygon((previous) =>
      previous.map((point, index) => (index === pointIndex ? videoPoint : point)),
    );
  };

  const saveZone = () => {
    window.localStorage.setItem(ZONE_STORAGE_KEY, JSON.stringify(zonePolygon));
    setIsEditingZone(false);
    setSaveStatusMessage('Saved to browser local storage (camera-04 draft).');
    setTimeout(() => setSaveStatusMessage(null), 4000);
  };

  const resetZone = () => {
    setZonePolygon(DEFAULT_ZONE_POLYGON);
    window.localStorage.removeItem(ZONE_STORAGE_KEY);
    setSaveStatusMessage('Reset to default region.');
    setTimeout(() => setSaveStatusMessage(null), 4000);
  };

  const exportZone = () => {
    const draft = exportZoneBrowserDraft(zonePolygon, 'CAM-04');
    const blobUrl = URL.createObjectURL(new Blob([draft.content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = draft.filename;
    link.click();
    URL.revokeObjectURL(blobUrl);
    setSaveStatusMessage(`Exported ${draft.filename} (${draft.label})`);
    setTimeout(() => setSaveStatusMessage(null), 5000);
  };

  useEffect(() => {
    let cancelled = false;
    void loadAiVideoTimeline('/assets/zone-ai.timeline.json')
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

  // Bug 5: Key zone = eventId + trackId
  const events: ZoneReviewItem[] = useMemo(() => {
    return (aiTimeline?.entries ?? [])
      .flatMap((entry) =>
        entry.event.observations
          .filter((observation) => observation.type === 'ZONE_ENTRY')
          .map((observation) => ({
            id: entry.event.eventId,
            rowKey: getZoneEventRowKey(entry.event.eventId, observation.trackId),
            trackId: observation.trackId,
            time: `${Math.floor(entry.videoTimeSeconds / 60)
              .toString()
              .padStart(2, '0')}:${Math.floor(entry.videoTimeSeconds % 60)
              .toString()
              .padStart(2, '0')}`,
            person: `Track #${observation.trackId}`,
            zone: `Region ${(observation.regionId ?? 'unknown').slice(0, 8)}`,
            camera: entry.event.cameraExternalId,
            identity: 'Unknown',
            authorization: 'Backend evaluation required',
            result: 'Technical entry',
          })),
      )
      .slice(-20)
      .reverse();
  }, [aiTimeline]);

  const displayedEvents = useMemo(() => {
    let result = events;
    if (activeFilterWorker !== null) {
      result = result.filter((e) => e.trackId === activeFilterWorker);
    }
    return result;
  }, [events, activeFilterWorker]);

  const openReviewFromDetection = () => {
    if (!testDetection) return;
    setSelectedIncident({
      id: testDetection.eventId,
      rowKey: `${testDetection.eventId}-${testDetection.trackId ?? 0}`,
      trackId: testDetection.trackId ?? 0,
      person: testDetection.trackId !== null ? `Track #${testDetection.trackId}` : 'Unknown Person',
      zone: 'Crane Operation Area',
      camera: 'CAM-04',
      identity: 'Unknown',
      authorization: 'Backend evaluation required',
      result: testDetection.active ? 'Zone Entry Observation' : 'Scanning Video',
      time: isLive ? clockTime : testDetection.timecode,
    });
  };

  return (
    <div className="space-y-6 max-w-[1202px] mx-auto text-[#182232] pb-10">
      {/* Main Section: Camera Video Viewport (829px) + Verification Card (355px) */}
      <div className="grid grid-cols-1 xl:grid-cols-[829px_355px] gap-4 items-start mt-4">
        {/* Left: Camera Video Feed */}
        <div
          ref={containerRef}
          className="relative bg-[#041D2E] rounded-xl overflow-hidden shadow-sm w-full aspect-video xl:h-[466px] flex flex-col justify-between select-none"
        >
          {/* Local MF06 test fixture driven by the video timeline. */}
          <div className="absolute inset-0">
            <video
              ref={videoRef}
              src="/assets/hazard_restricted_zone_test.mp4"
              poster="/assets/crane-camera-view.png"
              autoPlay
              muted={isMuted}
              loop
              playsInline
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                updateVideoTimeline(video);
                if (video.videoWidth > 0 && video.videoHeight > 0) {
                  setVideoNaturalSize({ width: video.videoWidth, height: video.videoHeight });
                }
              }}
              onTimeUpdate={(event) => updateVideoTimeline(event.currentTarget)}
              aria-label="Restricted-zone test video"
              className="w-full h-full object-cover"
            />

            {/* AI Status Badge */}
            <div
              className={`absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded text-[10px] font-black tracking-widest shadow-sm ${
                testDetection?.active
                  ? 'bg-[#DF2225]/90 text-white'
                  : 'bg-slate-900/75 text-white/80'
              }`}
            >
              {isLive
                ? 'MF06 AI REALTIME'
                : aiTimeline
                  ? 'MF06 AI PIPELINE'
                  : 'MF06 AI OUTPUT REQUIRED'}{' '}
              · {testDetection ? (testDetection.active ? 'ZONE ENTRY' : 'SCANNING') : 'NO TARGETS'}{' '}
              · {isLive ? clockTime : (testDetection?.timecode ?? '00:00')}
            </div>

            {/* Horizontal scanning line */}
            <div className="absolute top-[52%] left-0 right-0 h-[1px] bg-[#F66B17] opacity-60 shadow-[0_0_8px_#F66B17]" />

            {/* Manually adjustable restricted-zone polygon mapped through video content area */}
            <svg
              className="absolute inset-0 w-full h-full"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              onPointerMove={isEditingZone ? updateZonePoint : undefined}
              onPointerUp={() => {
                activeZonePoint.current = null;
              }}
              aria-label="Restricted zone editor"
            >
              <polygon
                points={displayPolygon.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="#DF2225"
                fillOpacity={testDetection?.active ? 0.16 : 0.08}
                stroke="#DF2225"
                strokeWidth="0.006"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
              <text
                x={(displayPolygon[0]?.[0] ?? 0.63) + 0.012}
                y={(displayPolygon[0]?.[1] ?? 0.2) + 0.035}
                fill="white"
                fontSize="0.025"
                fontWeight="800"
                letterSpacing="0.06em"
                style={{ textTransform: 'uppercase' }}
                pointerEvents="none"
              >
                NO ENTRY ZONE
              </text>
              {isEditingZone &&
                displayPolygon.map(([x, y], index) => (
                  <circle
                    key={`zone-point-${index}`}
                    cx={x}
                    cy={y}
                    r="0.018"
                    fill="#F66B17"
                    stroke="white"
                    strokeWidth="0.006"
                    onPointerDown={(event) => {
                      activeZonePoint.current = index;
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerUp={() => {
                      activeZonePoint.current = null;
                    }}
                    style={{ cursor: 'grab', pointerEvents: 'all' }}
                  />
                ))}
            </svg>

            <div className="absolute left-4 bottom-16 z-20 flex flex-col gap-1.5 items-start">
              <div className="flex items-center gap-2">
                {!isEditingZone ? (
                  <button
                    onClick={() => setIsEditingZone(true)}
                    className="rounded bg-slate-950/80 px-3 py-1.5 text-[10px] font-bold tracking-wide text-white backdrop-blur-sm hover:bg-slate-950"
                  >
                    EDIT ZONE
                  </button>
                ) : (
                  <>
                    <button
                      onClick={saveZone}
                      className="rounded bg-emerald-600 px-3 py-1.5 text-[10px] font-bold tracking-wide text-white shadow hover:bg-emerald-700"
                    >
                      SAVE ZONE (LOCAL)
                    </button>
                    <button
                      onClick={resetZone}
                      className="rounded bg-slate-950/80 px-3 py-1.5 text-[10px] font-bold tracking-wide text-white backdrop-blur-sm hover:bg-slate-950"
                    >
                      RESET
                    </button>
                    <button
                      onClick={exportZone}
                      className="rounded bg-[#F66B17] px-3 py-1.5 text-[10px] font-bold tracking-wide text-white shadow hover:bg-[#E05A0B]"
                    >
                      EXPORT DRAFT JSON
                    </button>
                  </>
                )}
              </div>
              {saveStatusMessage && (
                <div className="rounded bg-black/75 px-2.5 py-1 text-[10px] font-medium text-amber-200 backdrop-blur-sm border border-amber-500/30">
                  {saveStatusMessage}
                </div>
              )}
            </div>

            {/* Render one bounding box per active zone-entry track */}
            {activeZoneDetections.map((detection) =>
              detection.boundingBox ? (
                <div
                  key={`${detection.eventId}-${detection.trackId}`}
                  className="absolute border-[1.6px] border-[#DF2225] pointer-events-none transition-all duration-300"
                  style={{
                    left: `${detection.boundingBox.x1 * 100}%`,
                    top: `${detection.boundingBox.y1 * 100}%`,
                    width: `${(detection.boundingBox.x2 - detection.boundingBox.x1) * 100}%`,
                    height: `${(detection.boundingBox.y2 - detection.boundingBox.y1) * 100}%`,
                  }}
                >
                  <div className="absolute -top-[18px] left-[-1.6px] px-1.5 py-0.5 bg-[#DF2225] text-white text-[9px] font-extrabold uppercase tracking-wide whitespace-nowrap shadow-sm">
                    {detection.label} · TRACK #{detection.trackId}
                  </div>
                </div>
              ) : null,
            )}

            {/* Empty live frame indicator */}
            {isLive && zoneDetections.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded text-white/90 text-xs font-semibold">
                  Live Feed Connected · No Restricted Zone Intrusions
                </div>
              </div>
            )}
          </div>

          {/* Top Header Overlay */}
          <div className="relative z-10 px-5 py-4 flex items-start justify-between text-white">
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-sm tracking-wide text-white drop-shadow-md">
                CAM-04
              </span>
              <span className="text-white/90 font-semibold text-xs tracking-wider uppercase drop-shadow-md">
                CRANE OPERATION AREA
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

          {/* Bottom Camera Controls Bar Overlay */}
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

        {/* Right: Sidebar Verification Card (355px) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 flex flex-col justify-between h-[600px] xl:h-[466px] overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between pb-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                DETECTION DETAILS
              </span>
              <span className="font-mono text-[11px] font-semibold text-slate-500">
                {testDetection?.eventId ?? 'NO-DETECTION'}
              </span>
            </div>

            {/* 2-Column Metadata Grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Identity
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
                  {activeZoneDetections.length === 0
                    ? '—'
                    : activeZoneDetections
                        .map((detection) => `Track #${detection.trackId}`)
                        .join(', ')}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Camera
                </p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">CAM-04</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Zone
                </p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1 truncate">
                  Crane Operation Area
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

            {/* Verification Heading */}
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">
                VERIFICATION
              </p>

              {/* Verification items */}
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
                  <div className="flex flex-col gap-0.5">
                    <p className="font-semibold text-slate-900 text-xs">Identity</p>
                    <p className="text-[11px] text-slate-500">
                      {testDetection?.trackId !== null && testDetection?.trackId !== undefined
                        ? `Track #${testDetection.trackId}`
                        : 'Unknown'}
                    </p>
                  </div>
                  <IconClock className="w-5 h-5 text-slate-400" />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
                  <div className="flex flex-col gap-0.5">
                    <p className="font-semibold text-slate-900 text-xs">Site Assignment</p>
                    <p className="text-[11px] text-slate-500">Not evaluated</p>
                  </div>
                  <IconClock className="w-5 h-5 text-slate-400" />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
                  <div className="flex flex-col gap-0.5">
                    <p className="font-semibold text-slate-900 text-xs">Zone Permission</p>
                    <p className="text-[11px] text-slate-500">Backend evaluation required</p>
                  </div>
                  <IconClock className="w-5 h-5 text-slate-400" />
                </div>

                <div className="flex items-center justify-between px-2 pt-2 pb-1 text-xs text-slate-500">
                  <span>Permission validity</span>
                  <span className="font-bold text-slate-300">—</span>
                </div>
              </div>
            </div>

            {/* Result Alert Box */}
            <div className="pt-1">
              <div
                className={`border-l-[3px] pl-3 ${
                  testDetection?.active ? 'border-red-500' : 'border-slate-300'
                }`}
              >
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">
                  RESULT
                </p>
                <div
                  className={`flex items-center gap-1.5 text-xs font-bold mb-1 ${
                    testDetection?.active ? 'text-red-500' : 'text-slate-500'
                  }`}
                >
                  {testDetection?.active && <IconAlertTriangle className="w-3.5 h-3.5" />}
                  <span>
                    {testDetection?.active
                      ? 'ZONE ENTRY OBSERVATION'
                      : zoneDetections.length === 0
                        ? 'CLEAR - NO TARGETS'
                        : 'SCANNING VIDEO'}
                  </span>
                </div>
                <p className="text-xs text-slate-600">
                  {testDetection?.active
                    ? 'Technical zone-entry observation; Backend decides authorization and violation.'
                    : isLive
                      ? 'Streaming live inference from AI WebSocket.'
                      : 'Generate zone-ai.timeline.json, then play the matching video.'}
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="p-6 pt-0 space-y-2">
            <button
              onClick={openReviewFromDetection}
              disabled={!testDetection?.active}
              className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm shadow-sm transition-colors cursor-pointer ${
                testDetection?.active
                  ? 'bg-[#F66B17] hover:bg-[#E05A0B] text-white'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              Review Incident
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

      {/* Bottom Table Section: Recent Zone Events */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Recent Zone Events</h3>
            <p className="text-xs text-slate-500 mt-1">
              Latest camera detections and verification outcomes.
              {activeFilterWorker !== null && ` (Filtered by Track #${activeFilterWorker})`}
            </p>
          </div>
          <button
            onClick={() => setTimeFilter((prev) => (prev === '24h' ? 'all' : '24h'))}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              timeFilter === '24h'
                ? 'border-orange-200 bg-orange-50 text-[#F66B17]'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <IconClock className="w-3.5 h-3.5" />
            <span>{timeFilter === '24h' ? 'Last 24 hours (Active)' : 'All Time'}</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                <th className="py-3 px-3">Time</th>
                <th className="py-3 px-3">Person / Worker</th>
                <th className="py-3 px-3">Zone</th>
                <th className="py-3 px-3">Camera</th>
                <th className="py-3 px-3">Identity</th>
                <th className="py-3 px-3">Authorization</th>
                <th className="py-3 px-3">Result</th>
                <th className="py-3 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayedEvents.map((evt) => (
                <tr key={evt.rowKey} className="hover:bg-slate-50 transition-colors group">
                  <td className="py-3 px-3 font-mono text-slate-500 text-xs">{evt.time}</td>
                  <td className="py-3 px-3 font-semibold text-slate-900">{evt.person}</td>
                  <td className="py-3 px-3 text-slate-600">{evt.zone}</td>
                  <td className="py-3 px-3 font-mono text-slate-500 text-xs">{evt.camera}</td>
                  <td className="py-3 px-3 text-slate-600">{evt.identity}</td>
                  <td className="py-3 px-3 text-slate-600">{evt.authorization}</td>
                  <td className="py-3 px-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                        evt.result === 'Violation'
                          ? 'bg-red-50 text-red-600'
                          : evt.result === 'Access Valid'
                            ? 'bg-emerald-50 text-emerald-600'
                            : 'bg-amber-50 text-amber-600'
                      }`}
                    >
                      {evt.result}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <button
                      onClick={() => setSelectedIncident(evt)}
                      className="px-3 py-1 rounded text-xs font-semibold transition-colors bg-slate-100 text-slate-700 hover:bg-slate-200"
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
              {displayedEvents.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-400 text-xs">
                    No zone events match the selected criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Incident Review Modal with Bound Data */}
      {selectedIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold font-mono uppercase tracking-wider">
                  {selectedIncident.id}
                </span>
                <h3 className="font-bold text-slate-900">Review & Action</h3>
              </div>
              <button
                onClick={() => setSelectedIncident(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-sm text-slate-600">
              <p>
                You are reviewing a restricted zone intrusion at{' '}
                <strong className="text-slate-900">
                  {selectedIncident.zone} ({selectedIncident.camera})
                </strong>
                . AI detected worker{' '}
                <strong className="text-slate-900">{selectedIncident.person}</strong> with status:{' '}
                <strong className="text-slate-900">{selectedIncident.authorization}</strong>.
              </p>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                <p className="font-bold text-slate-700 text-xs uppercase tracking-wider">
                  Review Status: Local Preview
                </p>
                <p className="text-slate-600 text-xs">
                  Backend guard dispatch and authorization override APIs are pending integration.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                disabled
                title="Guard alert dispatch API pending integration"
                className="py-2 px-4 rounded-lg bg-[#DF2225]/60 text-white font-bold text-sm cursor-not-allowed shadow transition-colors"
              >
                Alert Guard (API Pending)
              </button>
              <button
                onClick={() => setSelectedIncident(null)}
                className="py-2 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition-colors"
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
