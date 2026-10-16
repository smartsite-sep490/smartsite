import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
import React from 'react';
import { IconHardHat, IconShield, IconClock } from '../icons';
import { useCurrentUser } from '../../features/auth/auth-session';
import { ContractorDashboardView } from '../contractor/ContractorDashboardView';
import { ManagerDashboardView } from './ManagerDashboardView';
import { WorkerDashboardView } from './WorkerDashboardView';

import type { ActiveTab } from '../layout/AppLayout';
import type { SafetyAlertStatus, SafetyAlertType } from '@smartsite/api-client';

export interface DashboardNavigateContext {
  alertType?: SafetyAlertType;
  siteId?: string;
  alertId?: string;
  status?: SafetyAlertStatus;
}

const DEFAULT_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface DashboardViewProps {
  onNavigate: (tab: ActiveTab, context?: DashboardNavigateContext) => void;
  apiUrl?: string;
}

export function DashboardView({ onNavigate, apiUrl: apiUrlProp }: DashboardViewProps) {
  useTranslation();

  const resolvedApiUrl = apiUrlProp || DEFAULT_API_URL;
  const { data: currentUser } = useCurrentUser(resolvedApiUrl);
  const roles: string[] = currentUser?.roleAssignments?.map((r) => r.role) || [];
  const isAdmin = roles.includes('ADMIN');
  const isContractorRep = !isAdmin && roles.includes('CONTRACTOR_REPRESENTATIVE');

  if (isContractorRep) {
    return <ContractorDashboardView apiUrl={resolvedApiUrl} onNavigate={onNavigate} />;
  }
  if (!isAdmin && roles.includes('SITE_MANAGER')) {
    return <ManagerDashboardView apiUrl={resolvedApiUrl} onNavigate={onNavigate} />;
  }
  if (!isAdmin && roles.includes('WORKER')) {
    return <WorkerDashboardView apiUrl={resolvedApiUrl} onNavigate={onNavigate} />;
  }

  const stats = [
    {
      get label() {
        return tr('common.workers_on_site');
      },
      value: '328',
      get change() {
        return tr('dashboard_view.workers_change');
      },
      color: 'text-[#041D2E]',
      badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    {
      get label() {
        return tr('common.active_contractors');
      },
      value: '14',
      get change() {
        return tr('dashboard_view.contractors_change');
      },
      color: 'text-[#041D2E]',
      badgeBg: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    {
      get label() {
        return tr('common.safety_compliance');
      },
      value: '96.8%',
      get change() {
        return tr('dashboard_view.compliance_change');
      },
      color: 'text-[#008C47]',
      badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    {
      get label() {
        return tr('common.open_alerts');
      },
      value: '7',
      get change() {
        return tr('dashboard_view.alerts_change');
      },
      color: 'text-[#DF2225]',
      badgeBg: 'bg-amber-50 text-amber-700 border-amber-200',
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
    <div
      className={
        roles.includes('SAFETY_OFFICER')
          ? 'space-y-6 max-w-7xl mx-auto'
          : 'space-y-6 max-w-7xl mx-auto text-[#071A2B] animate-in fade-in duration-200'
      }
    >
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-2xl font-black text-[#041D2E]">
            {tr('common.site_operational_overview')}
          </h1>
          <p className="text-sm text-slate-500 font-medium">
            {tr('dashboard_view.overview_description')}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 px-3.5 py-2 rounded-xl shadow-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <IconClock className="w-3.5 h-3.5 text-slate-400" />
          <span>{tr('dashboard_view.live_updates_tower_a')}</span>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div
        className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 ${roles.includes('SAFETY_OFFICER') ? 'gap-5' : 'gap-4'}`}
      >
        {stats.map((s, idx) => (
          <div
            key={idx}
            className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-sm transition-shadow space-y-2 relative overflow-hidden"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{s.label}</p>
            </div>
            <p className={`text-3xl font-black tracking-tight ${s.color}`}>{s.value}</p>
            <div className="pt-1">
              <span
                className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md border ${s.badgeBg}`}
              >
                {s.change}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Charts & Status Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Site Activity Bar Chart */}
        <div className="lg:col-span-8 bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-black text-base text-[#041D2E]">{tr('common.site_activity')}</h3>
              <p className="text-xs text-slate-500 font-medium">
                {tr('dashboard_view.site_activity_desc')}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 bg-orange-50 border border-orange-200 rounded-lg text-[#F66B17]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#F66B17] animate-pulse" />
              {tr('dashboard_view.live_today')}
            </span>
          </div>

          {/* Bar Chart Visualization */}
          <div className="h-48 flex items-end justify-between gap-3 pt-4 px-2 border-b border-slate-100 overflow-x-auto">
            {hourlyActivity.map((item, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-2 group">
                <div
                  style={{ height: `${item.val}%` }}
                  className="w-full max-w-[32px] rounded-t-lg bg-[#F66B17] group-hover:bg-[#E05A0B] transition-all relative shadow-xs"
                >
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-8 left-1/2 -translate-x-1/2 bg-[#041D2E] text-white text-[10px] font-bold py-1 px-2 rounded shadow-md pointer-events-none whitespace-nowrap z-10 font-mono">
                    {item.val * 3}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400 group-hover:text-slate-700 font-semibold">
                  {item.hour}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Live Systems Status Card */}
        <div className="lg:col-span-4 bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-black text-base text-[#041D2E]">
              {tr('dashboard_view.live_systems')}
            </h3>
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-50/80 border border-slate-200/70">
              <span className="font-bold text-[#182232]">{tr('common.access_control')}</span>
              <span className="font-bold text-[#008C47] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#008C47] animate-pulse" />
                {tr('dashboard_view.online')}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-50/80 border border-slate-200/70">
              <span className="font-bold text-[#182232]">{tr('common.safety_ai')}</span>
              <span className="font-bold text-[#008C47] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#008C47]" />
                {tr('dashboard_view.cameras_active')}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-50/80 border border-slate-200/70">
              <span className="font-bold text-[#182232]">{tr('common.iot_sensors')}</span>
              <span className="font-bold text-[#008C47] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#008C47]" />
                {tr('dashboard_view.iot_online')}
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-2.5">
            <button
              onClick={() => onNavigate('ppe')}
              className="w-full py-2.5 px-3 rounded-xl bg-[#F66B17] hover:bg-[#E05A0B] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs hover:shadow-sm transition-all cursor-pointer active:scale-[0.98]"
            >
              <IconHardHat className="w-4 h-4" />
              <span>{tr('dashboard_view.jump_to_ppe_monitoring')}</span>
            </button>
            <button
              onClick={() => onNavigate('zones')}
              className="w-full py-2.5 px-3 rounded-xl border border-slate-200 bg-white text-[#182232] hover:bg-slate-50 font-bold text-xs flex items-center justify-center gap-2 shadow-2xs hover:shadow-xs transition-all cursor-pointer active:scale-[0.98]"
            >
              <IconShield className="w-4 h-4 text-slate-500" />
              <span>{tr('dashboard_view.jump_to_restricted_zones')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
