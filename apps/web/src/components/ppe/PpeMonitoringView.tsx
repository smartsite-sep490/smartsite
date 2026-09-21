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

export function PpeMonitoringView() {
  const [activeFilter, setActiveFilter] = useState<'violation' | 'compliant' | 'needs-review'>('violation');
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);

  const ppeEvents = [
    {
      id: 'EVT-2048',
      time: '10:42',
      worker: 'Nguyen Van A',
      camera: 'CAM-07',
      workArea: 'Work Area B',
      issue: 'Missing Gloves',
      confidence: '97%',
      status: 'Open',
      statusType: 'error',
    },
    {
      id: 'EVT-2042',
      time: '10:36',
      worker: 'Tran Van B',
      camera: 'CAM-02',
      workArea: 'Tower B',
      issue: 'Missing Helmet',
      confidence: '95%',
      status: 'Under Review',
      statusType: 'warning',
    },
    {
      id: 'EVT-2035',
      time: '10:21',
      worker: 'Unknown',
      camera: 'CAM-05',
      workArea: 'Tower A',
      issue: 'Uncertain PPE',
      confidence: '72%',
      status: 'Needs Review',
      statusType: 'warning',
    },
    {
      id: 'EVT-2029',
      time: '09:58',
      worker: 'Le Van C',
      camera: 'CAM-03',
      workArea: 'Tower A',
      issue: 'Compliant',
      confidence: '98%',
      status: 'Logged',
      statusType: 'success',
    },
  ];

  return (
    <div className="space-y-4 max-w-[1202px] mx-auto text-[#182232]">
      {/* Title & Live Badge */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-bold tracking-widest text-[#F66B17] uppercase mb-1">
            Safety AI / MF05
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight text-[#041D2E]">
            PPE Monitoring
          </h1>
          <p className="text-sm text-[#62748E] mt-1">
            Monitor PPE compliance and review AI-detected safety events.
          </p>
        </div>
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#DCF7E1] text-[#008C47] text-xs font-bold tracking-wider">
          <span className="w-2 h-2 rounded-full bg-[#008C47] animate-ping" />
          <span>LIVE MONITORING</span>
        </div>
      </div>

      {/* Filter Dropdown Row */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F9FAFC] text-xs font-medium text-[#182232] hover:bg-slate-100 transition-colors">
          <span>Site: Tower A</span>
          <IconChevronDown className="w-3.5 h-3.5 text-[#62748E]" />
        </button>
        <button className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F9FAFC] text-xs font-medium text-[#182232] hover:bg-slate-100 transition-colors">
          <span>Work Area: All</span>
          <IconChevronDown className="w-3.5 h-3.5 text-[#62748E]" />
        </button>
        <button className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F9FAFC] text-xs font-medium text-[#182232] hover:bg-slate-100 transition-colors">
          <span>Camera: All</span>
          <IconChevronDown className="w-3.5 h-3.5 text-[#62748E]" />
        </button>
        <button className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F9FAFC] text-xs font-medium text-[#182232] hover:bg-slate-100 transition-colors">
          <span>PPE Type: All</span>
          <IconChevronDown className="w-3.5 h-3.5 text-[#62748E]" />
        </button>
        <button className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F9FAFC] text-xs font-medium text-[#182232] hover:bg-slate-100 transition-colors">
          <span>Status: Open</span>
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

      {/* Filter Pills */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActiveFilter('violation')}
          className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
            activeFilter === 'violation'
              ? 'bg-[#041D2E] text-white shadow-sm'
              : 'bg-[#F9FAFC] border border-[#E2E8F0] text-[#182232] hover:bg-slate-100'
          }`}
        >
          Violation
        </button>
        <button
          onClick={() => setActiveFilter('compliant')}
          className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
            activeFilter === 'compliant'
              ? 'bg-[#041D2E] text-white shadow-sm'
              : 'bg-[#F9FAFC] border border-[#E2E8F0] text-[#182232] hover:bg-slate-100'
          }`}
        >
          Compliant
        </button>
        <button
          onClick={() => setActiveFilter('needs-review')}
          className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
            activeFilter === 'needs-review'
              ? 'bg-[#041D2E] text-white shadow-sm'
              : 'bg-[#F9FAFC] border border-[#E2E8F0] text-[#182232] hover:bg-slate-100'
          }`}
        >
          Needs Review
        </button>
      </div>

      {/* Main Interactive Viewport: Camera Video Feed (829px) + Right Card (355px) */}
      <div className="grid grid-cols-1 xl:grid-cols-[829px_355px] gap-4 items-stretch">
        {/* Left: Camera Feed */}
        <div className="relative bg-[#041D2E] rounded-xl overflow-hidden border border-[#E2E8F0] shadow-sm h-[706px] flex flex-col justify-between select-none">
          {/* Real Construction Site Photograph from Figma Node 2:8597 */}
          <div className="absolute inset-0">
            <img
              src="/assets/ppe-camera-view.png"
              alt="Live PPE construction camera"
              className="w-full h-full object-cover"
            />

            {/* Bounding box for worker with missing PPE */}
            <div
              className="absolute border-[1.6px] border-[#F66B17] rounded-sm pointer-events-none transition-all duration-300"
              style={{
                left: '38.1%',
                top: '26.2%',
                width: '19.1%',
                height: '57.5%',
              }}
            >
              {/* Floating label */}
              <div className="absolute -top-6 left-0 px-2 py-0.5 rounded bg-[#F66B17] text-white text-[10px] font-extrabold uppercase tracking-wide whitespace-nowrap shadow">
                WORKER #1024 · 97% · PPE VIOLATION
              </div>
            </div>
          </div>

          {/* Top Camera Metadata */}
          <div className="relative z-10 px-5 py-3.5 bg-gradient-to-b from-[#041D2E]/85 via-[#041D2E]/40 to-transparent flex items-center justify-between text-white">
            <div className="flex items-center gap-3">
              <span className="font-bold text-sm tracking-wide text-white">CAM-07</span>
              <span className="text-white/70 font-semibold text-xs tracking-wider uppercase">
                WORK AREA B
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#041D2E]/80 backdrop-blur-sm border border-white/10">
              <span className="w-2 h-2 rounded-full bg-[#DF2225] animate-ping" />
              <span className="font-mono text-xs font-semibold text-white tracking-wider">
                LIVE · 10:42:16
              </span>
            </div>
          </div>

          {/* Bottom Camera Controls */}
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

        {/* Right: AI Detection & PPE Check Card (355px) */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-6 shadow-sm flex flex-col justify-between h-[706px] overflow-y-auto">
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
              <span className="text-xs font-semibold text-[#62748E] uppercase tracking-wider">
                AI Detection
              </span>
              <span className="font-mono text-xs font-semibold text-[#62748E]">
                EVT-2048
              </span>
            </div>

            {/* 2-Column Details Grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
              <div>
                <p className="text-[11px] text-[#62748E]">Worker</p>
                <p className="font-semibold text-[#041D2E] text-sm mt-0.5">Nguyen Van A</p>
              </div>
              <div>
                <p className="text-[11px] text-[#62748E]">Worker ID</p>
                <p className="font-semibold text-[#041D2E] text-sm mt-0.5">WK-1024</p>
              </div>
              <div>
                <p className="text-[11px] text-[#62748E]">Camera</p>
                <p className="font-semibold text-[#041D2E] mt-0.5">CAM-07</p>
              </div>
              <div>
                <p className="text-[11px] text-[#62748E]">Work Area</p>
                <p className="font-semibold text-[#041D2E] mt-0.5">Work Area B</p>
              </div>
              <div>
                <p className="text-[11px] text-[#62748E]">Detected</p>
                <p className="font-semibold text-[#041D2E] mt-0.5">10:42:16</p>
              </div>
              <div>
                <p className="text-[11px] text-[#62748E]">AI Confidence</p>
                <p className="font-semibold text-[#041D2E] mt-0.5">97%</p>
              </div>
            </div>

            {/* PPE Check List */}
            <div className="pt-2 border-t border-[#F1F5F9]">
              <p className="text-xs font-semibold text-[#62748E] uppercase tracking-wider mb-2.5">
                PPE Check
              </p>
              <div className="space-y-2 text-xs">
                {/* Helmet */}
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#F9FAFC] border border-[#E2E8F0]">
                  <div>
                    <p className="font-semibold text-[#041D2E]">Helmet</p>
                    <p className="text-[11px] text-[#62748E]">Detected</p>
                  </div>
                  <div className="w-5 h-5 rounded-full bg-[#DCF7E1] text-[#008C47] flex items-center justify-center font-bold">
                    <IconCheck className="w-3.5 h-3.5" />
                  </div>
                </div>

                {/* Safety Vest */}
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#F9FAFC] border border-[#E2E8F0]">
                  <div>
                    <p className="font-semibold text-[#041D2E]">Safety Vest</p>
                    <p className="text-[11px] text-[#62748E]">Detected</p>
                  </div>
                  <div className="w-5 h-5 rounded-full bg-[#DCF7E1] text-[#008C47] flex items-center justify-center font-bold">
                    <IconCheck className="w-3.5 h-3.5" />
                  </div>
                </div>

                {/* Gloves - Missing */}
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#F9FAFC] border border-[#E2E8F0]">
                  <div>
                    <p className="font-semibold text-[#041D2E]">Gloves</p>
                    <p className="text-[11px] text-[#DF2225] font-semibold">Missing</p>
                  </div>
                  <div className="w-5 h-5 rounded-full bg-[#FEE2E2] text-[#DF2225] flex items-center justify-center font-bold">
                    <IconX className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            </div>

            {/* Result Box */}
            <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#62748E]">
                Result
              </p>
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#DF2225]">
                <IconAlertTriangle className="w-4 h-4 shrink-0" />
                <span>PPE VIOLATION</span>
              </div>
              <p className="text-xs text-[#62748E] leading-relaxed">
                Missing required PPE: Gloves. Safety alert created for Safety Officer review.
              </p>
            </div>
          </div>

          {/* Action Button */}
          <div className="pt-3 border-t border-[#F1F5F9]">
            <button
              onClick={() => setSelectedAlert('EVT-2048')}
              className="w-full py-2 px-4 rounded-lg bg-[#F66B17] hover:bg-[#E05A0B] text-white font-medium text-xs shadow-sm transition-colors cursor-pointer"
            >
              Review Alert
            </button>
          </div>
        </div>
      </div>

      {/* Recent PPE Events Table */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-[#041D2E]">Recent PPE Events</h3>
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
                <th className="py-3 px-3">Worker</th>
                <th className="py-3 px-3">Camera</th>
                <th className="py-3 px-3">Work Area</th>
                <th className="py-3 px-3">Issue</th>
                <th className="py-3 px-3">Confidence</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {ppeEvents.map((evt) => (
                <tr key={evt.id} className="hover:bg-[#F9FAFC] transition-colors">
                  <td className="py-3.5 px-3 font-mono text-[#62748E] font-medium">
                    {evt.time}
                  </td>
                  <td className="py-3.5 px-3 font-semibold text-[#041D2E]">
                    {evt.worker}
                  </td>
                  <td className="py-3.5 px-3 font-mono text-[#62748E]">
                    {evt.camera}
                  </td>
                  <td className="py-3.5 px-3 text-[#62748E]">
                    {evt.workArea}
                  </td>
                  <td className="py-3.5 px-3 font-medium text-[#041D2E]">
                    {evt.issue}
                  </td>
                  <td className="py-3.5 px-3 font-semibold text-[#041D2E]">
                    {evt.confidence}
                  </td>
                  <td className="py-3.5 px-3">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                        evt.status === 'Open'
                          ? 'bg-[#FEF2F2] text-[#DF2225] border border-[#FECACA]'
                          : evt.status === 'Logged'
                          ? 'bg-[#DCF7E1] text-[#008C47] border border-[#A7F3D0]'
                          : 'bg-[#FEF3C7] text-[#E37800] border border-[#FDE68A]'
                      }`}
                    >
                      {evt.status}
                    </span>
                  </td>
                  <td className="py-3.5 px-3 text-right">
                    <button
                      onClick={() => setSelectedAlert(evt.id)}
                      className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                        evt.status === 'Open' || evt.status === 'Needs Review'
                          ? 'border-[#E2E8F0] bg-[#F9FAFC] text-[#182232] hover:bg-slate-100'
                          : 'border-transparent text-[#62748E] hover:text-[#041D2E]'
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 border border-[#CBD5E1]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-700 text-xs font-bold font-mono">
                  {selectedAlert}
                </span>
                <h3 className="font-bold text-slate-900">PPE Violation Review</h3>
              </div>
              <button
                onClick={() => setSelectedAlert(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-600">
                AI detected a missing safety item for worker{' '}
                <strong>Nguyen Van A (WK-1024)</strong> in <strong>Work Area B</strong>. Missing item: <strong>Gloves</strong> (97% confidence).
              </p>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
                <p className="font-bold text-amber-900">Safety Requirement: Mandatory Hand Protection</p>
                <p className="text-amber-800">
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
                className="py-2.5 px-4 rounded-lg bg-[#F66B17] hover:bg-orange-700 text-white font-bold text-xs shadow transition-colors"
              >
                Notify Supervisor
              </button>
              <button
                onClick={() => {
                  alert('Alert dismissed as false positive.');
                  setSelectedAlert(null);
                }}
                className="py-2.5 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors"
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
