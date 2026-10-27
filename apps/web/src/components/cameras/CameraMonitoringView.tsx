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
    <div className="space-y-6 max-w-[1280px] mx-auto text-[#071A2B]">
      {/* Top Header & Sub-Navigation Bar */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#071A2B] text-[#F66B17] flex items-center justify-center shrink-0 shadow-2xs">
              <IconCamera className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-[#111111]">
                  {tr('common.camera_monitoring')}
                </h1>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#F7F6F3] text-[#6B6B6B] border border-[#EAEAEA]">
                  {tr('common.vision_workspace')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Sub-navbar Segmented Switcher */}
        <div className="inline-flex p-1 bg-slate-100/90 rounded-xl border border-slate-200/70 text-xs gap-1 self-start md:self-auto shrink-0 shadow-2xs">
          <button
            type="button"
            onClick={() => handleTabChange('ppe')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'ppe'
                ? 'bg-white text-[#071A2B] shadow-2xs border border-slate-200/60'
                : 'text-slate-500 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            <IconHardHat
              className={`w-4 h-4 ${activeTab === 'ppe' ? 'text-[#F66B17]' : 'text-slate-400'}`}
            />
            <span>{tr('common.ppe_monitoring')}</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('zones')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'zones'
                ? 'bg-white text-[#071A2B] shadow-2xs border border-slate-200/60'
                : 'text-slate-500 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            <IconShield
              className={`w-4 h-4 ${activeTab === 'zones' ? 'text-[#F66B17]' : 'text-slate-400'}`}
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
