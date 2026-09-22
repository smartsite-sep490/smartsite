import React, { useState } from 'react';
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
    <div className="space-y-6 max-w-[1202px] mx-auto text-[#182232]">
      {/* Top Header & Sub-Navigation Bar */}
      <div className="bg-white p-5 rounded-xl border border-[#E2E8F0] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#041D2E] text-[#F66B17] flex items-center justify-center shrink-0">
              <IconCamera className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-[#041D2E]">Camera Monitoring</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#DCF7E1] text-[#008C47] border border-[#008C47]/20 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#008C47] animate-pulse" />
                  Live AI Active
                </span>
              </div>
              <p className="text-xs text-[#62748E] mt-0.5">
                Real-time computer vision stream analysis for safety compliance & perimeter security
              </p>
            </div>
          </div>
        </div>

        {/* Sub-navbar Segmented Switcher */}
        <div className="flex bg-[#F1F5F9] p-1 rounded-xl border border-[#E2E8F0] self-start md:self-auto shrink-0">
          <button
            type="button"
            onClick={() => handleTabChange('ppe')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'ppe'
                ? 'bg-white text-[#041D2E] shadow-xs border border-slate-200/80'
                : 'text-[#62748E] hover:text-[#041D2E]'
            }`}
          >
            <IconHardHat
              className={`w-4 h-4 ${activeTab === 'ppe' ? 'text-[#F66B17]' : 'text-[#62748E]'}`}
            />
            <span>PPE Monitoring</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                activeTab === 'ppe'
                  ? 'bg-[#F66B17]/10 text-[#F66B17] font-bold'
                  : 'bg-slate-200 text-slate-600'
              }`}
            >
              MF05
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('zones')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'zones'
                ? 'bg-white text-[#041D2E] shadow-xs border border-slate-200/80'
                : 'text-[#62748E] hover:text-[#041D2E]'
            }`}
          >
            <IconShield
              className={`w-4 h-4 ${activeTab === 'zones' ? 'text-[#F66B17]' : 'text-[#62748E]'}`}
            />
            <span>Restricted Zones</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                activeTab === 'zones'
                  ? 'bg-[#F66B17]/10 text-[#F66B17] font-bold'
                  : 'bg-slate-200 text-slate-600'
              }`}
            >
              MF06
            </span>
          </button>
        </div>
      </div>

      {/* Render Active Camera Sub-View */}
      {activeTab === 'ppe' ? <PpeMonitoringView /> : <RestrictedZoneView />}
    </div>
  );
}

export default CameraMonitoringView;
