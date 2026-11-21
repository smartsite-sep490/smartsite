import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import '../../i18n';
import { IconCamera, IconHardHat, IconShield } from '../icons';
import { PpeMonitoringView } from '../ppe/PpeMonitoringView';
import { RestrictedZoneView } from '../zones/RestrictedZoneView';

export type CameraSubTab = 'ppe' | 'zones';

interface CameraMonitoringViewProps {
  activeSubTab?: CameraSubTab;
  onSubTabChange?: (tab: CameraSubTab) => void;
}

export function CameraMonitoringView({
  activeSubTab: controlledTab,
  onSubTabChange,
}: CameraMonitoringViewProps) {
  useTranslation();

  const [internalTab, setInternalTab] = useState<CameraSubTab>('ppe');
  const activeTab = controlledTab ?? internalTab;

  const handleTabChange = (tab: CameraSubTab) => {
    if (onSubTabChange) {
      onSubTabChange(tab);
    } else {
      setInternalTab(tab);
    }
  };

  return (
    <div className="space-y-5 max-w-[1280px] mx-auto text-slate-900">
      {/* Top Header & Sub-Navigation Bar */}
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0F172A] text-white flex items-center justify-center shrink-0">
              <IconCamera className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-bold text-slate-950">
                  {tr('common.camera_monitoring')}
                </h1>
                <span className="text-xs font-medium text-slate-500">
                  {tr('common.vision_workspace')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Sub-navbar Segmented Switcher */}
        <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200 text-sm gap-1 self-start md:self-auto shrink-0">
          <button
            type="button"
            onClick={() => handleTabChange('ppe')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
              activeTab === 'ppe'
                ? 'bg-white text-[#0F172A] border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <IconHardHat
              className={`w-4 h-4 ${activeTab === 'ppe' ? 'text-teal-700' : 'text-slate-500'}`}
            />
            <span>{tr('common.ppe_monitoring')}</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('zones')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
              activeTab === 'zones'
                ? 'bg-white text-[#0F172A] border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <IconShield
              className={`w-4 h-4 ${activeTab === 'zones' ? 'text-teal-700' : 'text-slate-500'}`}
            />
            <span>{tr('common.restricted_zones')}</span>
          </button>
        </div>
      </div>

      {/* Render Active Camera Sub-View */}
      {activeTab === 'ppe' ? <PpeMonitoringView /> : <RestrictedZoneView />}
    </div>
  );
}

export default CameraMonitoringView;
