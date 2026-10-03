import React from 'react';
import { IconHardHat, IconShield, IconClock } from '../icons';

interface DashboardViewProps {
  onNavigate: (tab: 'ppe' | 'zones') => void;
}

export function DashboardView({ onNavigate }: DashboardViewProps) {
  const stats = [
    {
      label: 'Workers On Site',
      value: '—',
      change: 'Unavailable — no workforce API connected',
      color: 'text-[#2F3437]',
    },
    {
      label: 'Active Contractors',
      value: '—',
      change: 'Unavailable — no contractor API connected',
      color: 'text-[#2F3437]',
    },
    {
      label: 'Safety Compliance',
      value: '—',
      change: 'Requires safety data pipeline',
      color: 'text-[#2F3437]',
    },
    {
      label: 'Open Alerts',
      value: '—',
      change: 'See Safety Alerts for live data',
      color: 'text-[#2F3437]',
    },
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
          <h1 className="text-2xl font-bold text-[#111111]">Site Operational Overview</h1>
          <p className="text-sm text-[#6B6B6B]">Dashboard layout — data sources not connected.</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-[#6B6B6B] bg-white border border-[#EAEAEA] px-3 py-1.5 rounded-md">
          <IconClock className="w-3.5 h-3.5" />
          <span>Demonstration · Tower A</span>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {stats.map((s, idx) => (
          <div key={idx} className="bg-white p-5 rounded-lg border border-[#EAEAEA] space-y-1">
            <p className="text-xs font-bold text-[#6B6B6B] uppercase tracking-wider">{s.label}</p>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-[#6B6B6B] pt-1">{s.change}</p>
          </div>
        ))}
      </div>

      {/* Charts & Status Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Site Activity Bar Chart */}
        <div className="lg:col-span-8 bg-white p-6 rounded-lg border border-[#EAEAEA] space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-bold text-base text-[#111111]">Site Activity</h3>
              <p className="text-xs text-[#6B6B6B]">
                Sample chart layout — not connected to real data
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 bg-[#F7F6F3] rounded-md text-[#6B6B6B]">
              Sample
            </span>
          </div>

          {/* Bar Chart Visualization */}
          <div className="h-48 flex items-end justify-between gap-3 pt-4 px-2 border-b border-[#EAEAEA]">
            {hourlyActivity.map((item, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-2 group">
                <div
                  style={{ height: `${item.val}%` }}
                  className="w-full max-w-[32px] rounded-t-md bg-[#2F3437] group-hover:bg-[#111111] transition-all relative"
                >
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-7 left-1/2 -translate-x-1/2 bg-[#111111] text-white text-[10px] py-0.5 px-1.5 rounded pointer-events-none whitespace-nowrap z-10 font-mono">
                    {item.val * 3}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-[#6B6B6B]">{item.hour}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Live Systems Status Card */}
        <div className="lg:col-span-4 bg-white p-6 rounded-lg border border-[#EAEAEA] space-y-5">
          <h3 className="font-bold text-base text-[#111111]">System Status</h3>
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-3 rounded-md bg-[#FBFBFA] border border-[#EAEAEA]">
              <span className="font-medium text-[#2F3437]">Access Control</span>
              <span className="font-semibold text-[#6B6B6B]">No health API</span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-md bg-[#FBFBFA] border border-[#EAEAEA]">
              <span className="font-medium text-[#2F3437]">Safety AI</span>
              <span className="font-semibold text-[#6B6B6B]">See Camera Monitoring</span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-md bg-[#FBFBFA] border border-[#EAEAEA]">
              <span className="font-medium text-[#2F3437]">IoT Sensors</span>
              <span className="font-semibold text-[#6B6B6B]">No health API</span>
            </div>
          </div>

          <div className="pt-2 border-t border-[#EAEAEA] space-y-2">
            <button
              onClick={() => onNavigate('ppe')}
              className="w-full py-2.5 px-3 rounded-md bg-[#111111] hover:bg-[#333333] text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <IconHardHat className="w-4 h-4" />
              <span>Jump to PPE Monitoring</span>
            </button>
            <button
              onClick={() => onNavigate('zones')}
              className="w-full py-2.5 px-3 rounded-md border border-[#EAEAEA] text-[#2F3437] hover:bg-[#F7F6F3] font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <IconShield className="w-4 h-4 text-[#6B6B6B]" />
              <span>Jump to Restricted Zones</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
