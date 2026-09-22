import React, { useEffect, useRef, useState } from 'react';
import {
  IconCheck,
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
  getPpeVideoTestDetections,
  loadAiVideoTimeline,
  type AiVideoTimeline,
  type VideoTestTimeline,
} from '../cameras/videoTestFixture';

export function PpeMonitoringView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pausedViolationRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);
  const [videoTimeline, setVideoTimeline] = useState<VideoTestTimeline>({
    currentTime: 0,
    duration: 0,
  });
  const [aiTimeline, setAiTimeline] = useState<AiVideoTimeline | null>(null);
  const [violationSnapshot, setViolationSnapshot] = useState<{
    eventId: string;
    imageUrl: string;
    timecode: string;
  } | null>(null);
  const ppeDetections = getPpeVideoTestDetections(videoTimeline, aiTimeline);
  const testDetection = ppeDetections.find((detection) => detection.active) ?? ppeDetections[0]!;
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

  useEffect(() => {
    if (!testDetection.active) {
      pausedViolationRef.current = null;
      return;
    }
    if (pausedViolationRef.current) return;

    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

    pausedViolationRef.current = testDetection.eventId;
    video.pause();
    setIsPlaying(false);

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setViolationSnapshot({
      eventId: testDetection.eventId,
      imageUrl: canvas.toDataURL('image/jpeg', 0.9),
      timecode: testDetection.timecode,
    });
  }, [testDetection.active, testDetection.eventId, testDetection.timecode, videoTimeline.currentTime]);

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

  const ppeEvents = (aiTimeline?.entries ?? [])
    .flatMap((entry) =>
      entry.event.observations
        .filter((observation) => observation.type === 'PPE' && observation.status === 'MISSING')
        .map((observation) => {
          const person = entry.event.observations.find(
            (candidate) =>
              candidate.type === 'PERSON' && candidate.trackId === observation.trackId,
          );
          return {
            id: entry.event.eventId,
            time: `${Math.floor(entry.videoTimeSeconds / 60)
              .toString()
              .padStart(2, '0')}:${Math.floor(entry.videoTimeSeconds % 60)
              .toString()
              .padStart(2, '0')}`,
            worker: `Track #${observation.trackId}`,
            camera: entry.event.cameraExternalId,
            workArea: 'Local test region',
            issue: `Missing ${observation.ppeItem === 'HARD_HAT' ? 'Hard Hat' : 'Safety Vest'}`,
            confidence: person?.confidence ? `${Math.round(person.confidence * 100)}%` : '—',
            status: 'Technical observation',
          };
        }),
    )
    .slice(-20)
    .reverse();

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

            <div
              className={`absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded text-[10px] font-black tracking-widest shadow-sm ${
                testDetection.active
                  ? 'bg-[#DF2225]/90 text-white'
                  : 'bg-slate-900/75 text-white/80'
              }`}
            >
              {aiTimeline ? 'MF05 AI PIPELINE' : 'MF05 AI OUTPUT REQUIRED'} ·{' '}
              {testDetection.active ? 'MISSING PPE' : 'SCANNING'} ·{' '}
              {testDetection.timecode}
            </div>

            {/* Horizontal scanning line */}
            <div className="absolute top-[40%] left-0 right-0 h-[1px] bg-[#F66B17] opacity-60 shadow-[0_0_8px_#F66B17]" />

            {/* Render every tracked worker and keep each box tied to its track id. */}
            {ppeDetections.map((detection) =>
              detection.boundingBox ? (
                <div
                  key={`${detection.eventId}-${detection.trackId}`}
                  className={`absolute pointer-events-none border-[1.6px] transition-all duration-300 ${
                    detection.active ? 'border-[#F66B17]' : 'border-emerald-400'
                  }`}
                  data-testid="mf05-test-detection"
                  style={{
                    top: `${detection.boundingBox.y1 * 100}%`,
                    width: `${(detection.boundingBox.x2 - detection.boundingBox.x1) * 100}%`,
                    height: `${(detection.boundingBox.y2 - detection.boundingBox.y1) * 100}%`,
                    left: `${detection.boundingBox.x1 * 100}%`,
                  }}
                >
                  <div className={`absolute -top-[18px] left-[-1.6px] whitespace-nowrap px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white shadow-sm ${detection.active ? 'bg-[#F66B17]' : 'bg-emerald-600'}`}>
                    {detection.label} · TRACK #{detection.trackId}
                  </div>
                </div>
              ) : null,
            )}
          </div>

          {/* Top Camera Metadata */}
          <div className="relative z-10 px-5 py-4 flex items-start justify-between text-white">
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-sm tracking-wide text-white drop-shadow-md">CAM-07</span>
              <span className="text-white/90 font-semibold text-xs tracking-wider uppercase drop-shadow-md">
                WORK AREA B
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded bg-black/60 backdrop-blur-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-[#DF2225] animate-ping" />
              <span className="font-mono text-[10px] font-bold text-white tracking-wider">
                LIVE - 10:42:16
              </span>
            </div>
          </div>

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
              <button className="p-1.5 rounded hover:bg-white/15 text-white transition-colors" title="Grid">
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
                {testDetection.eventId}
              </span>
            </div>

            {/* 2-Column Details Grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Worker</p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">Unknown</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Worker ID</p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">
                  {ppeDetections.map((detection) => `Track #${detection.trackId}`).join(', ') || '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Camera</p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">CAM-07</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Work Area</p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">Work Area B</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Detected</p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">10:42:16</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Recognition Confidence</p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">
                  {testDetection.confidence === null
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
                {ppeDetections.map((detection) => {
                  const helmet = detection.ppeStatus.HARD_HAT;
                  const vest = detection.ppeStatus.SAFETY_VEST;
                  return (
                    <div key={`ppe-check-${detection.trackId}`} className="rounded-lg bg-slate-50 p-3">
                      <p className="mb-2 text-[11px] font-bold text-slate-700">Track #{detection.trackId}</p>
                      <div className="flex items-center justify-between text-xs">
                        <span>Helmet · {helmet === 'MISSING' ? 'Missing' : helmet === 'PRESENT' ? 'Detected' : 'Not assessed'}</span>
                        {helmet === 'MISSING' ? <IconX className="w-4 h-4 text-red-500" /> : helmet === 'PRESENT' ? <IconCheck className="w-4 h-4 text-emerald-500" /> : <IconClock className="w-4 h-4 text-slate-400" />}
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs">
                        <span>Safety Vest · {vest === 'MISSING' ? 'Missing' : vest === 'PRESENT' ? 'Detected' : 'Not assessed'}</span>
                        {vest === 'MISSING' ? <IconX className="w-4 h-4 text-red-500" /> : vest === 'PRESENT' ? <IconCheck className="w-4 h-4 text-emerald-500" /> : <IconClock className="w-4 h-4 text-slate-400" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Result Box */}
            <div className="pt-2">
              <div
                className={`border-l-[3px] pl-3 ${
                  testDetection.active ? 'border-red-500' : 'border-slate-300'
                }`}
              >
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">
                  RESULT
                </p>
                <div
                  className={`flex items-center gap-1.5 text-xs font-bold mb-1 ${
                    testDetection.active ? 'text-red-500' : 'text-slate-500'
                  }`}
                >
                  {testDetection.active && <IconAlertTriangle className="w-3.5 h-3.5" />}
                  <span>{testDetection.active ? 'MISSING PPE OBSERVATION' : 'SCANNING VIDEO'}</span>
                </div>
                <p className="text-xs text-slate-600">
                  {testDetection.active
                    ? 'Technical observation from the local YOLO + MF05 pipeline.'
                    : 'Generate ppe-ai.timeline.json, then play the matching video.'}
                </p>
              </div>
            </div>

            {violationSnapshot && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3" data-testid="mf05-evidence-capture">
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
              onClick={() => setSelectedAlert('EVT-2048')}
              className="w-full py-2.5 px-4 rounded-lg bg-[#F66B17] hover:bg-[#E05A0B] text-white font-semibold text-sm shadow-sm transition-colors cursor-pointer"
            >
              Review Alert
            </button>
            <button className="w-full py-2.5 px-4 rounded-lg bg-white border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors cursor-pointer">
              View Worker
            </button>
          </div>
        </div>
      </div>

      {/* Recent PPE Events Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Recent PPE Events</h3>
            <p className="text-xs text-slate-500 mt-1">
              Latest camera detections and verification outcomes.
            </p>
          </div>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors">
            <IconClock className="w-3.5 h-3.5 text-slate-400" />
            <span>Last 24 hours</span>
          </button>
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
              {ppeEvents.map((evt) => (
                <tr key={evt.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="py-3 px-3 font-mono text-slate-500 text-xs">
                    {evt.time}
                  </td>
                  <td className="py-3 px-3 font-semibold text-slate-900">
                    {evt.worker}
                  </td>
                  <td className="py-3 px-3 font-mono text-slate-500 text-xs">
                    {evt.camera}
                  </td>
                  <td className="py-3 px-3 text-slate-600">
                    {evt.workArea}
                  </td>
                  <td className="py-3 px-3 font-medium text-slate-900">
                    {evt.issue}
                  </td>
                  <td className="py-3 px-3 font-semibold text-slate-900">
                    {evt.confidence}
                  </td>
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
                      onClick={() => setSelectedAlert(evt.id)}
                      className={`px-3 py-1 rounded text-xs font-semibold transition-colors opacity-0 group-hover:opacity-100 ${
                        evt.status === 'Open' || evt.status === 'Needs Review'
                          ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {evt.status === 'Logged' ? 'View' : 'Review'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Review Modal */}
      {selectedAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] font-bold font-mono uppercase tracking-wider">
                  {selectedAlert}
                </span>
                <h3 className="font-bold text-slate-900">Violation Review</h3>
              </div>
              <button
                onClick={() => setSelectedAlert(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-sm text-slate-600">
              <p>
                AI detected a missing safety item for worker{' '}
                <strong className="text-slate-900">Nguyen Van A (WK-1024)</strong> in <strong className="text-slate-900">Work Area B</strong>. Missing item: <strong className="text-slate-900">Gloves</strong> (97% confidence).
              </p>
              <div className="p-3 bg-amber-50 rounded-lg space-y-1">
                <p className="font-bold text-amber-900 text-xs uppercase tracking-wider">Safety Protocol</p>
                <p className="text-amber-800 text-xs">
                  Handling rebar or mechanical parts requires EN 388 protective gloves at all times.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => {
                  alert('Notification dispatched to Site Supervisor to provide gloves.');
                  setSelectedAlert(null);
                }}
                className="py-2 px-4 rounded-lg bg-[#F66B17] hover:bg-orange-700 text-white font-bold text-sm shadow transition-colors"
              >
                Notify Supervisor
              </button>
              <button
                onClick={() => {
                  alert('Alert dismissed as false positive.');
                  setSelectedAlert(null);
                }}
                className="py-2 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
