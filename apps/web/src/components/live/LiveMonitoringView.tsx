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
    <div className="space-y-6 max-w-[1480px] mx-auto text-slate-900 pb-10">
      {/* Header & Truthful Navigation/Configuration Scope Notice */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            {t('liveOverview.title')}
          </h1>
          <p className="text-sm text-slate-600 mt-1.5 max-w-3xl leading-relaxed">
            {t('liveOverview.subtitle')}
          </p>
        </div>
        {canOpenCameraSetup && (
          <button
            type="button"
            onClick={() => onNavigate('camera-setup')}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-800 shadow-2xs hover:border-slate-400 hover:bg-slate-50 transition-colors cursor-pointer shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
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
          className="rounded-2xl border border-amber-300/90 bg-amber-50/90 p-4 text-amber-900 shadow-xs"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-amber-200/80 text-amber-800">
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: PPE Monitoring */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs hover:border-slate-300 hover:shadow-sm transition-all">
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200/80 bg-amber-50 p-3 text-amber-700 w-fit">
              <IconHardHat className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900">
                {t('liveOverview.ppe.title')}
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                {t('liveOverview.ppe.description')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('ppe')}
            className="mt-6 w-full rounded-xl border border-slate-900 bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-2xs hover:bg-slate-800 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {t('liveOverview.ppe.action')}
          </button>
        </div>

        {/* Card 2: Restricted Zones */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs hover:border-slate-300 hover:shadow-sm transition-all">
          <div className="space-y-4">
            <div className="rounded-xl border border-rose-200/80 bg-rose-50 p-3 text-rose-700 w-fit">
              <IconShield className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900">
                {t('liveOverview.zones.title')}
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                {t('liveOverview.zones.description')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('zones')}
            className="mt-6 w-full rounded-xl border border-slate-900 bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-2xs hover:bg-slate-800 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {t('liveOverview.zones.action')}
          </button>
        </div>

        {/* Card 3: Safety Alerts */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs hover:border-slate-300 hover:shadow-sm transition-all">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-100 p-3 text-slate-800 w-fit">
              <IconAlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900">
                {t('liveOverview.incidents.title')}
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                {t('liveOverview.incidents.description')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('incidents')}
            className="mt-6 w-full rounded-xl border border-slate-900 bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-2xs hover:bg-slate-800 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {t('liveOverview.incidents.action')}
          </button>
        </div>
      </div>
    </div>
  );
}
