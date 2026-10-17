import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../i18n/ppe-locale';
import type { ActiveTab } from '../layout/AppLayout';
import { IconHardHat, IconShield, IconAlertTriangle } from '../icons';
import '../cameras/camera-setup-catalog';

export interface LiveMonitoringViewProps {
  onNavigate: (tab: ActiveTab) => void;
  canOpenCameraSetup?: boolean;
}

export function LiveMonitoringView({
  onNavigate,
  canOpenCameraSetup = false,
}: LiveMonitoringViewProps) {
  const { t: tSafety } = useTranslation('safety');
  const { t } = useLocale();
  const isAiWorkPaused =
    import.meta.env.VITE_AI_WORK_PAUSED === 'true' || import.meta.env.VITE_AI_WORK_PAUSED === true;

  return (
    <div className="space-y-6 max-w-[1202px] mx-auto text-[#182232] pb-10">
      {/* Header & Truthful Navigation/Configuration Scope Notice */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#2F3437] tracking-tight">
            {t('liveOverview.title')}
          </h1>
          <p className="text-sm text-[#6B6B6B] mt-2 max-w-3xl leading-relaxed">
            {t('liveOverview.subtitle')}
          </p>
        </div>
        {canOpenCameraSetup && (
          <button
            type="button"
            onClick={() => onNavigate('camera-setup')}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {tSafety('cameraSetup.title')}
          </button>
        )}
      </div>

      {/* Truthful AI Paused Banner (when VITE_AI_WORK_PAUSED=true) */}
      {isAiWorkPaused && (
        <div
          role="status"
          data-testid="live-overview-ai-paused-banner"
          className="rounded-lg border border-amber-200 bg-amber-50/70 p-4 text-amber-900 shadow-xs"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-200/80 text-amber-800">
              <IconAlertTriangle className="h-4 w-4" />
            </span>
            <div className="space-y-1">
              <h2 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                {t('liveOverview.pausedBanner.title')}
              </h2>
              <p className="text-xs text-amber-800 leading-relaxed">
                {t('liveOverview.pausedBanner.description')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Three Direct Subsystem Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
        {/* Card 1: PPE Monitoring */}
        <div className="flex flex-col justify-between rounded-lg border border-[#EAEAEA] bg-white p-5 shadow-xs hover:border-[#2F3437]/20 transition-colors">
          <div className="space-y-3">
            <div className="rounded-md bg-amber-50 p-2.5 text-[#D97706] w-fit">
              <IconHardHat className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#111111]">{t('liveOverview.ppe.title')}</h2>
              <p className="mt-1.5 text-xs leading-5 text-[#6B6B6B]">
                {t('liveOverview.ppe.description')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('ppe')}
            className="mt-5 w-full rounded-md border border-[#EAEAEA] bg-[#F7F6F3] px-3 py-2 text-xs font-bold text-[#2F3437] hover:bg-[#EAEAEA] hover:text-[#111111] transition-colors cursor-pointer"
          >
            {t('liveOverview.ppe.action')}
          </button>
        </div>

        {/* Card 2: Restricted Zones */}
        <div className="flex flex-col justify-between rounded-lg border border-[#EAEAEA] bg-white p-5 shadow-xs hover:border-[#2F3437]/20 transition-colors">
          <div className="space-y-3">
            <div className="rounded-md bg-red-50 p-2.5 text-[#DF2225] w-fit">
              <IconShield className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#111111]">
                {t('liveOverview.zones.title')}
              </h2>
              <p className="mt-1.5 text-xs leading-5 text-[#6B6B6B]">
                {t('liveOverview.zones.description')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('zones')}
            className="mt-5 w-full rounded-md border border-[#EAEAEA] bg-[#F7F6F3] px-3 py-2 text-xs font-bold text-[#2F3437] hover:bg-[#EAEAEA] hover:text-[#111111] transition-colors cursor-pointer"
          >
            {t('liveOverview.zones.action')}
          </button>
        </div>

        {/* Card 3: Safety Alerts */}
        <div className="flex flex-col justify-between rounded-lg border border-[#EAEAEA] bg-white p-5 shadow-xs hover:border-[#2F3437]/20 transition-colors">
          <div className="space-y-3">
            <div className="rounded-md bg-stone-100 p-2.5 text-[#111111] w-fit">
              <IconAlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#111111]">
                {t('liveOverview.incidents.title')}
              </h2>
              <p className="mt-1.5 text-xs leading-5 text-[#6B6B6B]">
                {t('liveOverview.incidents.description')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('incidents')}
            className="mt-5 w-full rounded-md border border-[#EAEAEA] bg-[#F7F6F3] px-3 py-2 text-xs font-bold text-[#2F3437] hover:bg-[#EAEAEA] hover:text-[#111111] transition-colors cursor-pointer"
          >
            {t('liveOverview.incidents.action')}
          </button>
        </div>
      </div>
    </div>
  );
}
