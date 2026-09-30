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
    <div className="space-y-6 max-w-[1202px] mx-auto text-[#2F3437]">
      {/* Top Header & Sub-Navigation Bar */}
      <div className="bg-white p-5 rounded-lg border border-[#EAEAEA] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-[#111111] text-white flex items-center justify-center shrink-0">
              <IconCamera className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-[#111111]">Camera Monitoring</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EDF3EC] text-[#346538] border border-[#346538]/20 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#346538]" />
                  Live AI Active
                </span>
              </div>
              <p className="text-xs text-[#6B6B6B] mt-0.5">
                Real-time computer vision stream analysis for safety compliance & perimeter security
              </p>
            </div>
          </div>
        </div>

        {/* Sub-navbar Segmented Switcher */}
        <div className="flex bg-[#F7F6F3] p-1 rounded-lg border border-[#EAEAEA] self-start md:self-auto shrink-0">
          <button
            type="button"
            onClick={() => handleTabChange('ppe')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'ppe'
                ? 'bg-white text-[#111111] border border-[#EAEAEA]'
                : 'text-[#6B6B6B] hover:text-[#2F3437]'
            }`}
          >
            <IconHardHat
              className={`w-4 h-4 ${activeTab === 'ppe' ? 'text-[#2F3437]' : 'text-[#6B6B6B]'}`}
            />
            <span>PPE Monitoring</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                activeTab === 'ppe'
                  ? 'bg-[#F7F6F3] text-[#2F3437] font-bold'
                  : 'bg-[#EAEAEA] text-[#6B6B6B]'
              }`}
            >
              MF04
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('zones')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'zones'
                ? 'bg-white text-[#111111] border border-[#EAEAEA]'
                : 'text-[#6B6B6B] hover:text-[#2F3437]'
            }`}
          >
            <IconShield
              className={`w-4 h-4 ${activeTab === 'zones' ? 'text-[#2F3437]' : 'text-[#6B6B6B]'}`}
            />
            <span>Restricted Zones</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                activeTab === 'zones'
                  ? 'bg-[#F7F6F3] text-[#2F3437] font-bold'
                  : 'bg-[#EAEAEA] text-[#6B6B6B]'
              }`}
            >
              MF05
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
