import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getBackendHealth } from '@smartsite/api-client';
import { AppLayout, ActiveTab } from './components/layout/AppLayout';
import { LiveMonitoringView } from './components/live/LiveMonitoringView';
import { RestrictedZoneView } from './components/zones/RestrictedZoneView';
import { PpeMonitoringView } from './components/ppe/PpeMonitoringView';
import { DashboardView } from './components/dashboard/DashboardView';
import { LandingPage } from './components/landing/LandingPage';
import {
  IconAlertTriangle,
  IconRadio,
  IconUsers,
  IconKey,
  IconTrendingUp,
} from './components/icons';

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function App() {
  const [currentTab, setCurrentTab] = useState<ActiveTab>('live-monitoring');

  // Backend live health check
  useQuery({
    queryKey: ['backend', apiUrl, 'health'],
    queryFn: ({ signal }) => getBackendHealth(apiUrl, { signal }),
  });

  const handleSelectTab = (tab: ActiveTab) => {
    setCurrentTab(tab);
  };

  // If viewing public landing page
  if (currentTab === 'landing') {
    return <LandingPage onEnterApp={(targetTab = 'dashboard') => handleSelectTab(targetTab)} />;
  }

  return (
    <AppLayout currentTab={currentTab} onSelectTab={handleSelectTab}>
      {/* Tab: Live Monitoring */}
      {currentTab === 'live-monitoring' && <LiveMonitoringView onNavigate={(tab) => handleSelectTab(tab)} />}

      {/* Tab: Restricted Zones (MF06) */}
      {currentTab === 'zones' && <RestrictedZoneView />}

      {/* Tab: PPE Monitoring (MF05) */}
      {currentTab === 'ppe' && <PpeMonitoringView />}

      {/* Tab: Operational Dashboard */}
      {currentTab === 'dashboard' && <DashboardView onNavigate={(tab) => handleSelectTab(tab)} />}

      {/* Placeholder tabs for remaining modules */}
      {currentTab === 'workforce' && (
        <div className="bg-white p-8 rounded-xl border border-[#E2E8F0] shadow-xs max-w-4xl mx-auto text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-orange-100 text-[#F66B17] mx-auto flex items-center justify-center">
            <IconUsers className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-[#041D2E]">Workforce Management</h2>
          <p className="text-sm text-[#62748E] max-w-md mx-auto">
            Worker roster, site assignments, trade qualifications and active safety certifications.
          </p>
        </div>
      )}

      {currentTab === 'access' && (
        <div className="bg-white p-8 rounded-xl border border-[#E2E8F0] shadow-xs max-w-4xl mx-auto text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center">
            <IconKey className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-[#041D2E]">Site Access Control</h2>
          <p className="text-sm text-[#62748E] max-w-md mx-auto">
            Automated turnstile gates, biometric verification and dynamic QR credentials.
          </p>
        </div>
      )}

      {currentTab === 'incidents' && (
        <div className="bg-white p-8 rounded-xl border border-[#E2E8F0] shadow-xs max-w-4xl mx-auto text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-red-100 text-[#DF2225] mx-auto flex items-center justify-center">
            <IconAlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-[#041D2E]">Safety Incidents & MF08 Review</h2>
          <p className="text-sm text-[#62748E] max-w-md mx-auto">
            Safety Officer investigation workflows, evidence preservation and contractor corrective
            actions.
          </p>
        </div>
      )}

      {currentTab === 'iot' && (
        <div className="bg-white p-8 rounded-xl border border-[#E2E8F0] shadow-xs max-w-4xl mx-auto text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 mx-auto flex items-center justify-center">
            <IconRadio className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-[#041D2E]">IoT Environmental Sensors</h2>
          <p className="text-sm text-[#62748E] max-w-md mx-auto">
            Environmental air quality, noise thresholds, crane wind speed and perimeter beams.
          </p>
        </div>
      )}

      {currentTab === 'progress' && (
        <div className="bg-white p-8 rounded-xl border border-[#E2E8F0] shadow-xs max-w-4xl mx-auto text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-600 mx-auto flex items-center justify-center">
            <IconTrendingUp className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-[#041D2E]">Construction Progress Monitoring</h2>
          <p className="text-sm text-[#62748E] max-w-md mx-auto">
            4D BIM overlay, photogrammetry site scans and milestone progress tracking.
          </p>
        </div>
      )}
    </AppLayout>
  );
}

export default App;
