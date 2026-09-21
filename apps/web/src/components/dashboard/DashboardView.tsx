import React from 'react';
import {
  IconHardHat,
  IconShield,
  IconClock,
} from '../icons';

interface DashboardViewProps {
  onNavigate: (tab: 'ppe' | 'zones') => void;
}

export function DashboardView({ onNavigate }: DashboardViewProps) {
  const stats = [
    { label: 'Workers On Site', value: '328', change: '+12% from yesterday', color: 'text-[#041D2E]' },
    { label: 'Active Contractors', value: '14', change: 'All compliant with onboarding', color: 'text-[#041D2E]' },
    { label: 'Safety Compliance', value: '96.8%', change: '+1.4% this week', color: 'text-[#008C47]' },
    { label: 'Open Alerts', value: '7', change: '3 urgent PPE, 4 zone checks', color: 'text-[#DF2225]' },
  ];

  const hourlyActivity = [
    { hour: '06h', val: 35 },
    { hour: '07h', val: 85 },
    { hour: '08h', val: 95 },
    { hour: '09h', val: 75 },
    { hour: '10h', val: 90 },
    { hour: '11h', val: 80 },
    { hour: '12h', val: 45 },
    { hour: '13h', val: 70 },
    { hour: '14h', val: 88 },
    { hour: '15h', val: 92 },
    { hour: '16h', val: 65 },
    { hour: '17h', val: 30 },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-[#041D2E]">Site Operational Overview</h1>
          <p className="text-sm text-[#62748E]">Real-time site presence, safety compliance and AI cameras.</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-[#62748E] bg-white border border-[#E2E8F0] px-3 py-1.5 rounded-lg shadow-xs">
          <IconClock className="w-3.5 h-3.5 text-[#62748E]" />
          <span>Live updates · Tower A</span>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {stats.map((s, idx) => (
          <div key={idx} className="bg-white p-5 rounded-xl border border-[#E2E8F0] shadow-xs space-y-1">
            <p className="text-xs font-bold text-[#62748E] uppercase tracking-wider">{s.label}</p>
            <p className={`text-3xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-[#62748E] pt-1">{s.change}</p>
          </div>
        ))}
      </div>

      {/* Charts & Status Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Site Activity Bar Chart */}
        <div className="lg:col-span-8 bg-white p-6 rounded-xl border border-[#E2E8F0] shadow-xs space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-bold text-base text-[#041D2E]">Site Activity</h3>
              <p className="text-xs text-[#62748E]">Worker entries and active zone presence today</p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 rounded-md text-slate-700">Today</span>
          </div>

          {/* Bar Chart Visualization */}
          <div className="h-48 flex items-end justify-between gap-3 pt-4 px-2 border-b border-slate-100">
            {hourlyActivity.map((item, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-2 group">
                <div
                  style={{ height: `${item.val}%` }}
                  className="w-full max-w-[32px] rounded-t-md bg-[#F66B17] group-hover:bg-[#E05A0B] transition-all relative"
                >
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-7 left-1/2 -translate-x-1/2 bg-[#041D2E] text-white text-[10px] py-0.5 px-1.5 rounded pointer-events-none whitespace-nowrap z-10 font-mono">
                    {item.val * 3}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">{item.hour}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Live Systems Status Card */}
        <div className="lg:col-span-4 bg-white p-6 rounded-xl border border-[#E2E8F0] shadow-xs space-y-5">
          <h3 className="font-bold text-base text-[#041D2E]">Live Systems</h3>
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-3 rounded-lg bg-[#F9FAFC] border border-[#E2E8F0]">
              <span className="font-medium text-[#182232]">Access Control</span>
              <span className="font-bold text-[#008C47] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#008C47]" />
                Online
              </span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-[#F9FAFC] border border-[#E2E8F0]">
              <span className="font-medium text-[#182232]">Safety AI</span>
              <span className="font-bold text-[#008C47] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#008C47]" />
                12 cameras active
              </span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-[#F9FAFC] border border-[#E2E8F0]">
              <span className="font-medium text-[#182232]">IoT Sensors</span>
              <span className="font-bold text-[#008C47] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#008C47]" />
                48 online
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-2">
            <button
              onClick={() => onNavigate('ppe')}
              className="w-full py-2.5 px-3 rounded-lg bg-[#F66B17] hover:bg-[#E05A0B] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
            >
              <IconHardHat className="w-4 h-4" />
              <span>Jump to PPE Monitoring (MF05)</span>
            </button>
            <button
              onClick={() => onNavigate('zones')}
              className="w-full py-2.5 px-3 rounded-lg border border-[#E2E8F0] text-[#182232] hover:bg-slate-100 font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <IconShield className="w-4 h-4 text-[#62748E]" />
              <span>Jump to Restricted Zones (MF06)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
