import React, { useState } from 'react';
import {
  IconChevronDown,
  IconSliders,
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
  const [activeFilter, setActiveFilter] = useState<'unauthorized' | 'authorized' | 'unidentified' | 'no-entry'>('unauthorized');
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
    <div className="space-y-4 max-w-[1202px] mx-auto text-[#182232]">
      {/* 12:1403 Header Title & Live Badge */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-bold tracking-widest text-[#F66B17] uppercase mb-1">
            Safety AI / MF06
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight text-[#041D2E]">
            Restricted Zone Monitoring
          </h1>
          <p className="text-sm text-[#62748E] mt-1">
            Monitor controlled areas and verify access authorization in real time.
          </p>
        </div>
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#DCF7E1] text-[#008C47] text-xs font-bold tracking-wider">
          <span className="w-2 h-2 rounded-full bg-[#008C47] animate-ping" />
          <span>LIVE MONITORING</span>
        </div>
      </div>

      {/* 12:1414 Filter Dropdown Row */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F9FAFC] text-xs font-medium text-[#182232] hover:bg-slate-100 transition-colors">
          <span>Site: Tower A</span>
          <IconChevronDown className="w-3.5 h-3.5 text-[#62748E]" />
        </button>
        <button className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F9FAFC] text-xs font-medium text-[#182232] hover:bg-slate-100 transition-colors">
          <span>Restricted Zone: All</span>
          <IconChevronDown className="w-3.5 h-3.5 text-[#62748E]" />
        </button>
        <button className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F9FAFC] text-xs font-medium text-[#182232] hover:bg-slate-100 transition-colors">
          <span>Camera: All</span>
          <IconChevronDown className="w-3.5 h-3.5 text-[#62748E]" />
        </button>
        <button className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F9FAFC] text-xs font-medium text-[#182232] hover:bg-slate-100 transition-colors">
          <span>Authorization: All</span>
          <IconChevronDown className="w-3.5 h-3.5 text-[#62748E]" />
        </button>
        <button className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F9FAFC] text-xs font-medium text-[#182232] hover:bg-slate-100 transition-colors">
          <span>Alert Status: Open</span>
          <IconChevronDown className="w-3.5 h-3.5 text-[#62748E]" />
        </button>
        <button className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F9FAFC] text-xs font-medium text-[#182232] hover:bg-slate-100 transition-colors">
          <span>Date / Time</span>
          <IconChevronDown className="w-3.5 h-3.5 text-[#62748E]" />
        </button>
        <button className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F9FAFC] text-xs font-medium text-[#182232] hover:bg-slate-100 transition-colors">
          <IconSliders className="w-3.5 h-3.5 text-[#62748E]" />
          <span>More</span>
        </button>
      </div>

      {/* 12:1451 Active Zone Policy Banner */}
      <div className="px-4 py-2.5 rounded-xl bg-[#FDEAE0] border border-[#FDBA74]/60 flex flex-wrap items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-[#62748E] uppercase tracking-wider text-[11px]">
            ACTIVE ZONE POLICY
          </span>
          <span className="text-[#041D2E] font-bold">
            TYPE A · AUTHORIZED PERSONNEL ONLY
          </span>
        </div>
        <p className="text-[#62748E] text-[11px]">
          Policy determines whether authorization is evaluated.
        </p>
      </div>

      {/* 12:1460 Filter Pills */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActiveFilter('unauthorized')}
          className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
            activeFilter === 'unauthorized'
              ? 'bg-[#041D2E] text-white shadow-sm'
              : 'bg-[#F9FAFC] border border-[#E2E8F0] text-[#182232] hover:bg-slate-100'
          }`}
        >
          Unauthorized
        </button>
        <button
          onClick={() => setActiveFilter('authorized')}
          className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
            activeFilter === 'authorized'
              ? 'bg-[#041D2E] text-white shadow-sm'
              : 'bg-[#F9FAFC] border border-[#E2E8F0] text-[#182232] hover:bg-slate-100'
          }`}
        >
          Authorized
        </button>
        <button
          onClick={() => setActiveFilter('unidentified')}
          className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
            activeFilter === 'unidentified'
              ? 'bg-[#041D2E] text-white shadow-sm'
              : 'bg-[#F9FAFC] border border-[#E2E8F0] text-[#182232] hover:bg-slate-100'
          }`}
        >
          Unidentified
        </button>
        <button
          onClick={() => setActiveFilter('no-entry')}
          className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
            activeFilter === 'no-entry'
              ? 'bg-[#041D2E] text-white shadow-sm'
              : 'bg-[#F9FAFC] border border-[#E2E8F0] text-[#182232] hover:bg-slate-100'
          }`}
        >
          No Entry Zone
        </button>
      </div>

      {/* 12:1469 Main Section: Camera Video Viewport (829px) + Verification Card (355px) */}
      <div className="grid grid-cols-1 xl:grid-cols-[829px_355px] gap-4 items-stretch">
        {/* Left: 12:1471 Camera Video Feed */}
        <div className="relative bg-[#041D2E] rounded-xl overflow-hidden border border-[#E2E8F0] shadow-sm h-[734px] flex flex-col justify-between select-none">
          {/* Real Construction Site Photograph from Figma Node 12:1472 */}
          <div className="absolute inset-0">
            <img
              src="/assets/crane-camera-view.png"
              alt="Live crane camera view"
              className="w-full h-full object-cover"
            />

            {/* 12:1483 NO ENTRY ZONE polygon overlay box */}
            <div
              className="absolute border-[1.6px] border-[#DF2225] bg-[#DF2225]/10 rounded-sm pointer-events-none transition-all duration-300"
              style={{
                left: '21.0%',
                top: '37.0%',
                width: '57.0%',
                height: '46.0%',
              }}
            >
              {/* 12:1484 Label inside top-left */}
              <div className="absolute top-4 left-4 px-2.5 py-0.5 rounded bg-[#DF2225] text-white text-[11px] font-extrabold uppercase tracking-wide shadow">
                NO ENTRY ZONE
              </div>
            </div>

            {/* 12:1486 PERSON #1024 · 97% bounding box */}
            <div
              className="absolute border-[1.6px] border-[#DF2225] rounded-sm pointer-events-none transition-all duration-300"
              style={{
                left: '17.0%',
                top: '36.0%',
                width: '15.0%',
                height: '35.0%',
              }}
            >
              {/* 12:1487 Floating Label directly above person bounding box */}
              <div className="absolute -top-6 left-0 px-2 py-0.5 rounded bg-[#DF2225] text-white text-[10px] font-extrabold uppercase tracking-wide whitespace-nowrap shadow">
                PERSON #1024 · 97%
              </div>
            </div>
          </div>

          {/* 12:1474 Top Header Overlay */}
          <div className="relative z-10 px-5 py-3.5 bg-gradient-to-b from-[#041D2E]/85 via-[#041D2E]/40 to-transparent flex items-center justify-between text-white">
            <div className="flex items-center gap-3">
              <span className="font-bold text-sm tracking-wide text-white">CAM-04</span>
              <span className="text-white/70 font-semibold text-xs tracking-wider uppercase">
                CRANE OPERATION AREA
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#041D2E]/80 backdrop-blur-sm border border-white/10">
              <span className="w-2 h-2 rounded-full bg-[#DF2225] animate-ping" />
              <span className="font-mono text-xs font-semibold text-white tracking-wider">
                LIVE · 10:42:16
              </span>
            </div>
          </div>

          {/* Bottom Camera Controls Bar Overlay */}
          <div className="relative z-10 px-5 py-3 bg-gradient-to-t from-[#041D2E]/90 via-[#041D2E]/50 to-transparent flex items-center justify-between text-white text-xs">
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
              <span className="px-2 py-0.5 rounded bg-white/10 text-[10px] font-bold tracking-widest uppercase">
                1080P · 30 FPS
              </span>
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

        {/* Right: 12:1490 Sidebar Verification Card (355px) */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-6 shadow-sm flex flex-col justify-between h-[734px] overflow-y-auto">
          <div className="space-y-4">
            {/* Header: Detection details / EVT-2048 */}
            <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
              <span className="text-xs font-semibold text-[#62748E] uppercase tracking-wider">
                Detection details
              </span>
              <span className="font-mono text-xs font-semibold text-[#62748E]">
                EVT-2048
              </span>
            </div>

            {/* 2-Column Metadata Grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
              <div>
                <p className="text-[11px] text-[#62748E]">Identity</p>
                <p className="font-semibold text-[#041D2E] text-sm mt-0.5">Nguyen Van A</p>
              </div>
              <div>
                <p className="text-[11px] text-[#62748E]">Worker ID</p>
                <p className="font-semibold text-[#041D2E] text-sm mt-0.5">WK-1024</p>
              </div>
              <div>
                <p className="text-[11px] text-[#62748E]">Camera</p>
                <p className="font-semibold text-[#041D2E] mt-0.5">CAM-04</p>
              </div>
              <div>
                <p className="text-[11px] text-[#62748E]">Zone</p>
                <p className="font-semibold text-[#041D2E] truncate mt-0.5">Crane Operation Area</p>
              </div>
              <div>
                <p className="text-[11px] text-[#62748E]">Detected</p>
                <p className="font-semibold text-[#041D2E] mt-0.5">10:42:16</p>
              </div>
              <div>
                <p className="text-[11px] text-[#62748E]">Recognition Confidence</p>
                <p className="font-semibold text-[#041D2E] mt-0.5">97%</p>
              </div>
            </div>

            {/* 12:1529 Verification Heading */}
            <div className="pt-2 border-t border-[#F1F5F9]">
              <p className="text-xs font-semibold text-[#62748E] uppercase tracking-wider mb-2.5">
                Verification
              </p>

              {/* Verification items */}
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#F9FAFC] border border-[#E2E8F0]">
                  <div>
                    <p className="font-semibold text-[#041D2E]">Identity</p>
                    <p className="text-[11px] text-[#62748E]">Nguyen Van A</p>
                  </div>
                  <div className="w-5 h-5 rounded-full bg-[#DCF7E1] text-[#008C47] flex items-center justify-center font-bold">
                    <IconCheck className="w-3.5 h-3.5" />
                  </div>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#F9FAFC] border border-[#E2E8F0]">
                  <div>
                    <p className="font-semibold text-[#041D2E]">Site Assignment</p>
                    <p className="text-[11px] text-[#62748E]">Active</p>
                  </div>
                  <div className="w-5 h-5 rounded-full bg-[#DCF7E1] text-[#008C47] flex items-center justify-center font-bold">
                    <IconCheck className="w-3.5 h-3.5" />
                  </div>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#F9FAFC] border border-[#E2E8F0]">
                  <div>
                    <p className="font-semibold text-[#041D2E]">Zone Permission</p>
                    <p className="text-[11px] text-[#DF2225] font-semibold">No Entry Zone</p>
                  </div>
                  <div className="w-5 h-5 rounded-full bg-[#FEE2E2] text-[#DF2225] flex items-center justify-center font-bold">
                    <IconX className="w-3.5 h-3.5" />
                  </div>
                </div>

                <div className="flex items-center justify-between px-1 pt-1 text-xs text-[#62748E]">
                  <span>Permission validity</span>
                  <span className="font-bold text-[#041D2E]">-</span>
                </div>
              </div>
            </div>

            {/* 12:1566 Result Alert Box */}
            <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#62748E]">
                RESULT
              </p>
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#DF2225]">
                <IconAlertTriangle className="w-4 h-4 shrink-0" />
                <span>NO ENTRY ZONE ALERT</span>
              </div>
              <p className="text-xs text-[#62748E] leading-relaxed">
                No valid permission for this zone at detection time.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2 pt-3 border-t border-[#F1F5F9]">
            <button
              onClick={() => setSelectedIncident('EVT-2048')}
              className="w-full py-2 px-4 rounded-lg bg-[#F66B17] hover:bg-[#E05A0B] text-white font-medium text-xs shadow-sm transition-colors cursor-pointer"
            >
              Review Incident
            </button>
            <button className="w-full py-2 px-4 rounded-lg bg-[#F9FAFC] border border-[#E2E8F0] text-[#182232] font-medium text-xs hover:bg-slate-100 transition-colors cursor-pointer">
              View Worker
            </button>
          </div>
        </div>
      </div>

      {/* 12:1583 Bottom Table Section: Recent Zone Events */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-[#041D2E]">Recent Zone Events</h3>
            <p className="text-xs text-[#62748E]">
              Latest camera detections and verification outcomes.
            </p>
          </div>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F9FAFC] text-xs font-medium text-[#182232] hover:bg-slate-100 transition-colors">
            <IconClock className="w-3.5 h-3.5 text-[#62748E]" />
            <span>Last 24 hours</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-[#62748E] font-bold uppercase tracking-wider text-[11px]">
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
            <tbody className="divide-y divide-[#F1F5F9]">
              {events.map((evt) => (
                <tr key={evt.id} className="hover:bg-[#F9FAFC] transition-colors">
                  <td className="py-3.5 px-3 font-mono text-[#62748E] font-medium">
                    {evt.time}
                  </td>
                  <td className="py-3.5 px-3 font-semibold text-[#041D2E]">
                    {evt.person}
                  </td>
                  <td className="py-3.5 px-3 text-[#62748E]">
                    {evt.zone}
                  </td>
                  <td className="py-3.5 px-3 font-mono text-[#62748E]">
                    {evt.camera}
                  </td>
                  <td className="py-3.5 px-3 text-[#62748E]">
                    {evt.identity}
                  </td>
                  <td className="py-3.5 px-3 text-[#62748E]">
                    {evt.authorization}
                  </td>
                  <td className="py-3.5 px-3">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                        evt.result === 'Violation'
                          ? 'bg-[#FEF2F2] text-[#DF2225] border border-[#FECACA]'
                          : evt.result === 'Access Valid'
                          ? 'bg-[#DCF7E1] text-[#008C47] border border-[#A7F3D0]'
                          : 'bg-[#FEF3C7] text-[#E37800] border border-[#FDE68A]'
                      }`}
                    >
                      {evt.result}
                    </span>
                  </td>
                  <td className="py-3.5 px-3 text-right">
                    <button
                      onClick={() => setSelectedIncident(evt.id)}
                      className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                        evt.result === 'Violation' || evt.result === 'Needs Review'
                          ? 'border-[#E2E8F0] bg-[#F9FAFC] text-[#182232] hover:bg-slate-100'
                          : 'border-transparent text-[#62748E] hover:text-[#041D2E]'
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 border border-[#CBD5E1]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-xs font-bold font-mono">
                  {selectedIncident}
                </span>
                <h3 className="font-bold text-slate-900">Incident Review & Action</h3>
              </div>
              <button
                onClick={() => setSelectedIncident(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-600">
                You are reviewing a high-priority restricted zone intrusion at{' '}
                <strong>Crane Operation Area (CAM-04)</strong>. AI detected worker{' '}
                <strong>Nguyen Van A (WK-1024)</strong> without active authorization.
              </p>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
                <p className="font-bold text-amber-900">Safety Protocol Action Required</p>
                <p className="text-amber-800">
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
                className="py-2.5 px-4 rounded-lg bg-[#DF2225] hover:bg-red-700 text-white font-bold text-xs shadow transition-colors"
              >
                Confirm Intrusion & Alert Guard
              </button>
              <button
                onClick={() => {
                  alert('Dismissed: Marked as permitted maintenance exception.');
                  setSelectedIncident(null);
                }}
                className="py-2.5 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors"
              >
                Dismiss / Exception
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
