import React, { useState } from 'react';
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

export function RestrictedZoneView() {
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);

  const events = [
    {
      id: 'EVT-2048',
      time: '10:42',
      person: 'Nguyen Van A',
      zone: 'Crane Operation Area',
      camera: 'CAM-04',
      identity: 'Identified',
      authorization: 'Unauthorized',
      result: 'Violation',
      statusType: 'error',
    },
    {
      id: 'EVT-2042',
      time: '10:37',
      person: 'Tran Van B',
      zone: 'Electrical Room',
      camera: 'CAM-08',
      identity: 'Identified',
      authorization: 'Authorized',
      result: 'Access Valid',
      statusType: 'success',
    },
    {
      id: 'EVT-2035',
      time: '10:29',
      person: 'Unknown Person',
      zone: 'Material Storage',
      camera: 'CAM-09',
      identity: 'Unidentified',
      authorization: 'Unknown',
      result: 'Needs Review',
      statusType: 'warning',
    },
    {
      id: 'EVT-2020',
      time: '10:14',
      person: 'Le Van C',
      zone: 'Crane Operation Area',
      camera: 'CAM-04',
      identity: 'Identified',
      authorization: 'Authorized',
      result: 'Access Valid',
      statusType: 'success',
    },
  ];

  return (
    <div className="space-y-6 max-w-[1202px] mx-auto text-[#182232] pb-10">
      {/* Main Section: Camera Video Viewport (829px) + Verification Card (355px) */}
      <div className="grid grid-cols-1 xl:grid-cols-[829px_355px] gap-4 items-start mt-4">
        {/* Left: Camera Video Feed */}
        <div className="relative bg-[#041D2E] rounded-xl overflow-hidden shadow-sm w-full aspect-video xl:h-[466px] flex flex-col justify-between select-none">
          {/* Real Construction Site Photograph */}
          <div className="absolute inset-0">
            <img
              src="/assets/crane-camera-view.png"
              alt="Live crane camera view"
              className="w-full h-full object-cover"
            />

            {/* Horizontal scanning line */}
            <div className="absolute top-[52%] left-0 right-0 h-[1px] bg-[#F66B17] opacity-60 shadow-[0_0_8px_#F66B17]" />

            {/* NO ENTRY ZONE polygon overlay box */}
            <div
              className="absolute border-[1.6px] border-[#DF2225] bg-[#DF2225]/10 pointer-events-none transition-all duration-300"
              style={{
                left: '21.0%',
                top: '40.0%',
                width: '57.0%',
                height: '46.0%',
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
                left: '42.0%',
                top: '55.0%',
                width: '10.0%',
                height: '25.0%',
              }}
            >
              {/* Floating Label directly above person bounding box */}
              <div className="absolute -top-[18px] left-[-1.6px] px-1.5 py-0.5 bg-[#DF2225] text-white text-[9px] font-extrabold uppercase tracking-wide whitespace-nowrap shadow-sm">
                PERSON #1024 - 97%
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
                onClick={() => setIsPlaying(!isPlaying)}
                className="p-1.5 rounded hover:bg-white/15 text-white transition-colors"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <IconPause className="w-4 h-4" /> : <IconPlay className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setIsMuted(!isMuted)}
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
              <button className="p-1.5 rounded hover:bg-white/15 text-white transition-colors" title="Fullscreen">
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
                EVT-2048
              </span>
            </div>

            {/* 2-Column Metadata Grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Identity</p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">Nguyen Van A</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Worker ID</p>
                <p className="font-semibold text-slate-900 text-[13px] mt-1">WK-1024</p>
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
                <p className="font-semibold text-slate-900 text-[13px] mt-1">97%</p>
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
                    <p className="text-[11px] text-slate-500">Nguyen Van A</p>
                  </div>
                  <IconCheck className="w-5 h-5 text-emerald-500" />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
                  <div className="flex flex-col gap-0.5">
                    <p className="font-semibold text-slate-900 text-xs">Site Assignment</p>
                    <p className="text-[11px] text-slate-500">Active</p>
                  </div>
                  <IconCheck className="w-5 h-5 text-emerald-500" />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
                  <div className="flex flex-col gap-0.5">
                    <p className="font-semibold text-slate-900 text-xs">Zone Permission</p>
                    <p className="text-[11px] text-slate-500">Not Authorized</p>
                  </div>
                  <IconX className="w-5 h-5 text-red-500" />
                </div>

                <div className="flex items-center justify-between px-2 pt-2 pb-1 text-xs text-slate-500">
                  <span>Permission validity</span>
                  <span className="font-bold text-slate-300">—</span>
                </div>
              </div>
            </div>

            {/* Result Alert Box */}
            <div className="pt-1">
              <div className="border-l-[3px] border-red-500 pl-3">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">
                  RESULT
                </p>
                <div className="flex items-center gap-1.5 text-xs font-bold text-red-500 mb-1">
                  <IconAlertTriangle className="w-3.5 h-3.5" />
                  <span>RESTRICTED ZONE VIOLATION</span>
                </div>
                <p className="text-xs text-slate-600">
                  No valid permission for this zone at detection time.
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
