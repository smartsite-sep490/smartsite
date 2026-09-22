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
  getZoneVideoTestDetection,
  loadAiVideoTimeline,
  type AiVideoTimeline,
  type VideoTestTimeline,
} from '../cameras/videoTestFixture';

export function RestrictedZoneView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);
  const [videoTimeline, setVideoTimeline] = useState<VideoTestTimeline>({
    currentTime: 0,
    duration: 0,
  });
  const [aiTimeline, setAiTimeline] = useState<AiVideoTimeline | null>(null);
  const testDetection = getZoneVideoTestDetection(videoTimeline, aiTimeline);

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

  const events = (aiTimeline?.entries ?? [])
    .flatMap((entry) =>
      entry.event.observations
        .filter((observation) => observation.type === 'ZONE_ENTRY')
        .map((observation) => ({
          id: entry.event.eventId,
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

  return (
    <div className="space-y-6 max-w-[1202px] mx-auto text-[#182232] pb-10">
      {/* Main Section: Camera Video Viewport (829px) + Verification Card (355px) */}
      <div className="grid grid-cols-1 xl:grid-cols-[829px_355px] gap-4 items-start mt-4">
        {/* Left: Camera Video Feed */}
        <div className="relative bg-[#041D2E] rounded-xl overflow-hidden shadow-sm w-full aspect-video xl:h-[466px] flex flex-col justify-between select-none">
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
              onLoadedMetadata={(event) => updateVideoTimeline(event.currentTarget)}
              onTimeUpdate={(event) => updateVideoTimeline(event.currentTarget)}
              aria-label="Restricted-zone test video"
              className="w-full h-full object-cover"
            />

            <div
              className={`absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded text-[10px] font-black tracking-widest shadow-sm ${
                testDetection.active
                  ? 'bg-[#DF2225]/90 text-white'
                  : 'bg-slate-900/75 text-white/80'
              }`}
            >
              {aiTimeline ? 'MF06 AI PIPELINE' : 'MF06 AI OUTPUT REQUIRED'} ·{' '}
              {testDetection.active ? 'ZONE ENTRY' : 'SCANNING'} ·{' '}
              {testDetection.timecode}
            </div>

            {/* Horizontal scanning line */}
            <div className="absolute top-[52%] left-0 right-0 h-[1px] bg-[#F66B17] opacity-60 shadow-[0_0_8px_#F66B17]" />

            {/* NO ENTRY ZONE polygon overlay box */}
            <div
              className="absolute border-[1.6px] border-[#DF2225] bg-[#DF2225]/10 pointer-events-none transition-all duration-300"
              style={{
                left: '63.0%',
                top: '20.0%',
                width: '35.0%',
                height: '70.0%',
                opacity: testDetection.active ? 1 : 0.45,
              }}
            >
              <div className="absolute top-4 left-4 px-2 py-0.5 bg-[#DF2225]/90 backdrop-blur-sm text-white text-[10px] font-extrabold uppercase tracking-widest shadow-sm">
                NO ENTRY ZONE
              </div>
            </div>

            {/* PERSON #1024 bounding box */}
            <div
              className="absolute border-[1.6px] border-[#DF2225] pointer-events-none transition-all duration-300"
              style={{
                left: `${(testDetection.boundingBox?.x1 ?? 0.42) * 100}%`,
                top: `${(testDetection.boundingBox?.y1 ?? 0.55) * 100}%`,
                width: `${
                  ((testDetection.boundingBox?.x2 ?? 0.52) -
                    (testDetection.boundingBox?.x1 ?? 0.42)) *
                  100
                }%`,
                height: `${
                  ((testDetection.boundingBox?.y2 ?? 0.8) -
                    (testDetection.boundingBox?.y1 ?? 0.55)) *
                  100
                }%`,
                opacity: testDetection.active && testDetection.boundingBox ? 1 : 0,
              }}
            >
              {/* Floating Label directly above person bounding box */}
              <div className="absolute -top-[18px] left-[-1.6px] px-1.5 py-0.5 bg-[#DF2225] text-white text-[9px] font-extrabold uppercase tracking-wide whitespace-nowrap shadow-sm">
                {testDetection.label}
              </div>
            </div>
          </div>

          {/* Top Header Overlay */}
          <div className="relative z-10 px-5 py-4 flex items-start justify-between text-white">
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-sm tracking-wide text-white drop-shadow-md">CAM-04</span>
              <span className="text-white/90 font-semibold text-xs tracking-wider uppercase drop-shadow-md">
                CRANE OPERATION AREA
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded bg-black/60 backdrop-blur-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-[#DF2225] animate-ping" />
              <span className="font-mono text-[10px] font-bold text-white tracking-wider">
                LIVE - 10:42:16
              </span>
            </div>
          </div>

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

        {/* Right: Sidebar Verification Card (355px) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 flex flex-col justify-between h-[600px] xl:h-[466px] overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between pb-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                DETECTION DETAILS
              </span>
              <span className="font-mono text-[11px] font-semibold text-slate-500">
                {testDetection.eventId}
              </span>
            </div>

            {/* 2-Column Metadata Grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Identity</p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">Unknown</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Worker ID</p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">
                  {testDetection.trackId === null ? '—' : `Track #${testDetection.trackId}`}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Camera</p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">CAM-04</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Zone</p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1 truncate">Crane Operation Area</p>
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
                    <p className="text-[11px] text-slate-500">Unknown</p>
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
                  <span>{testDetection.active ? 'ZONE ENTRY OBSERVATION' : 'SCANNING VIDEO'}</span>
                </div>
                <p className="text-xs text-slate-600">
                  {testDetection.active
                    ? 'Technical zone-entry observation; Backend decides authorization and violation.'
                    : 'Generate zone-ai.timeline.json, then play the matching video.'}
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="p-6 pt-0 space-y-2">
            <button
              onClick={() => setSelectedIncident('EVT-2048')}
              className="w-full py-2.5 px-4 rounded-lg bg-[#F66B17] hover:bg-[#E05A0B] text-white font-semibold text-sm shadow-sm transition-colors cursor-pointer"
            >
              Review Incident
            </button>
            <button className="w-full py-2.5 px-4 rounded-lg bg-white border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors cursor-pointer">
              View Worker
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
              {events.map((evt) => (
                <tr key={evt.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="py-3 px-3 font-mono text-slate-500 text-xs">
                    {evt.time}
                  </td>
                  <td className="py-3 px-3 font-semibold text-slate-900">
                    {evt.person}
                  </td>
                  <td className="py-3 px-3 text-slate-600">
                    {evt.zone}
                  </td>
                  <td className="py-3 px-3 font-mono text-slate-500 text-xs">
                    {evt.camera}
                  </td>
                  <td className="py-3 px-3 text-slate-600">
                    {evt.identity}
                  </td>
                  <td className="py-3 px-3 text-slate-600">
                    {evt.authorization}
                  </td>
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
                      onClick={() => setSelectedIncident(evt.id)}
                      className={`px-3 py-1 rounded text-xs font-semibold transition-colors opacity-0 group-hover:opacity-100 ${
                        evt.result === 'Violation' || evt.result === 'Needs Review'
                          ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {evt.result === 'Access Valid' ? 'View' : 'Review'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Incident Review Modal if clicked */}
      {selectedIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold font-mono uppercase tracking-wider">
                  {selectedIncident}
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
                You are reviewing a high-priority restricted zone intrusion at{' '}
                <strong className="text-slate-900">Crane Operation Area (CAM-04)</strong>. AI detected worker{' '}
                <strong className="text-slate-900">Nguyen Van A (WK-1024)</strong> without active authorization.
              </p>

              <div className="p-3 bg-amber-50 rounded-lg space-y-1">
                <p className="font-bold text-amber-900 text-xs uppercase tracking-wider">Safety Protocol</p>
                <p className="text-amber-800 text-xs">
                  Site rules require immediate notification of the Crane Operator and security guard dispatch.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => {
                  alert('Intrusion Confirmed: Alert broadcast to Crane Operator and dispatch log updated.');
                  setSelectedIncident(null);
                }}
                className="py-2 px-4 rounded-lg bg-[#DF2225] hover:bg-red-700 text-white font-bold text-sm shadow transition-colors"
              >
                Alert Guard
              </button>
              <button
                onClick={() => {
                  alert('Dismissed: Marked as permitted maintenance exception.');
                  setSelectedIncident(null);
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
