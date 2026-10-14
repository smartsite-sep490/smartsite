import { translate as tr } from '../../i18n';
import { useLocale } from '../../i18n/ppe-locale';
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import type { SharedSession } from '../../types/shared-session';
import { IconCamera, IconHardHat, IconShield } from '../icons';
import { PpeMonitoringView } from '../ppe/PpeMonitoringView';
import { RestrictedZoneView } from '../zones/RestrictedZoneView';

export type CameraSubTab = 'ppe' | 'zones';

export interface CameraMonitoringViewProps {
  activeSubTab?: CameraSubTab;
  onSubTabChange?: (tab: CameraSubTab) => void;
  apiUrl?: string;
  sharedSession?: SharedSession | null;
}

export function CameraMonitoringView({
  activeSubTab: controlledTab,
  onSubTabChange,
  apiUrl,
  sharedSession,
}: CameraMonitoringViewProps) {
  useTranslation();
  useLocale();

  const [internalTab, setInternalTab] = useState<CameraSubTab>('ppe');
  const activeTab = controlledTab ?? internalTab;

  const handleTabChange = (tab: CameraSubTab) => {
    if (controlledTab === undefined) {
      setInternalTab(tab);
    }
    onSubTabChange?.(tab);
  };

  const childSessionProps = {
    ...(apiUrl !== undefined ? { apiUrl } : {}),
    ...(sharedSession !== undefined ? { sharedSession } : {}),
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
                <h1 className="text-xl font-bold text-[#111111]">
                  {tr('common.camera_monitoring')}
                </h1>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#F7F6F3] text-[#6B6B6B] border border-[#EAEAEA]">
                  {tr('common.vision_workspace')}
                </span>
              </div>
              <p className="text-xs text-[#6B6B6B] mt-0.5">
                {tr(
                  'camera_monitoring_view.real_time_computer_vision_stream_analysis_for_safety_compliance_perimeter_security',
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Sub-navbar Segmented Switcher */}
        <div role="group" aria-label="Camera monitoring view" className="flex flex-wrap max-w-full bg-[#F7F6F3] p-1 rounded-lg border border-[#EAEAEA] self-start md:self-auto">
          <button
            type="button"
            aria-pressed={activeTab === 'ppe'}
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
            <span>{tr('common.ppe_monitoring')}</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                activeTab === 'ppe'
                  ? 'bg-[#F7F6F3] text-[#2F3437] font-bold'
                  : 'bg-[#EAEAEA] text-[#6B6B6B]'
              }`}
            >
              MF05
            </span>
          </button>

          <button
            type="button"
            aria-pressed={activeTab === 'zones'}
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
            <span>{tr('common.restricted_zones')}</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                activeTab === 'zones'
                  ? 'bg-[#F7F6F3] text-[#2F3437] font-bold'
                  : 'bg-[#EAEAEA] text-[#6B6B6B]'
              }`}
            >
              MF06
            </span>
          </button>
        </div>
      </div>

      {/* Render Active Camera Sub-View */}
      {activeTab === 'ppe' ? (
        <PpeMonitoringView {...childSessionProps} />
      ) : (
        <RestrictedZoneView {...childSessionProps} />
      )}
    </div>
  );
}

export default CameraMonitoringView;
