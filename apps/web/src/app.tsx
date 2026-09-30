import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getBackendHealth } from '@smartsite/api-client';
import { AppLayout, ActiveTab } from './components/layout/AppLayout';
import { LiveMonitoringView } from './components/live/LiveMonitoringView';
import { RestrictedZoneView } from './components/zones/RestrictedZoneView';
import { PpeMonitoringView } from './components/ppe/PpeMonitoringView';
import { DashboardView } from './components/dashboard/DashboardView';
import { LandingPage } from './components/landing/LandingPage';
import { SafetyAlertsView } from './components/alerts/SafetyAlertsView';
import { AccessControlView } from './components/access/AccessControlView';
import { IconRadio, IconUsers, IconTrendingUp } from './components/icons';
import { useAuth, useRestoreSession } from './features/auth/auth-session';
import { LoginScreen } from './features/auth/LoginScreen';
import { RegisterScreen } from './features/auth/RegisterScreen';

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function App() {
  const [currentTab, setCurrentTab] = useState<ActiveTab | 'login' | 'register'>('landing');
  const { accessToken } = useAuth();
  const { isLoading: isRestoringSession } = useRestoreSession(apiUrl);

  // Backend live health check
  useQuery({
    queryKey: ['backend', apiUrl, 'health'],
    queryFn: ({ signal }) => getBackendHealth(apiUrl, { signal }),
  });

  const handleSelectTab = (tab: ActiveTab | 'login' | 'register') => {
    setCurrentTab(tab);
  };

  if (isRestoringSession) {
    return (
      <div className="min-h-screen bg-[#041D2E] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-[#F66B17] border-t-transparent animate-spin" />
      </div>
    );
  }

  // If viewing public landing page
  if (!accessToken) {
    if (currentTab === 'landing') {
      return <LandingPage onEnterApp={() => handleSelectTab('login')} />;
    }
    if (currentTab === 'register') {
      return (
        <RegisterScreen 
          onRegisterSuccess={() => handleSelectTab('login')} 
          onBackToLogin={() => handleSelectTab('login')} 
          onBackToSite={() => handleSelectTab('landing')} 
        />
      );
    }
    return (
      <LoginScreen 
        onLoginSuccess={() => handleSelectTab('dashboard')} 
        onBack={() => handleSelectTab('landing')} 
        onNavigateToRegister={() => handleSelectTab('register')}
      />
    );
  }

  // Treat 'landing', 'login', or 'register' as 'dashboard' if already authenticated
  const effectiveTab = (currentTab === 'landing' || currentTab === 'login' || currentTab === 'register') ? 'dashboard' : currentTab;

  return (
    <AppLayout currentTab={effectiveTab} onSelectTab={handleSelectTab}>
      {/* Tab: Live Monitoring */}
      {effectiveTab === 'live-monitoring' && (
        <LiveMonitoringView onNavigate={(tab) => handleSelectTab(tab)} />
      )}

      {/* Tab: Restricted Zones (MF05) */}
      {effectiveTab === 'zones' && <RestrictedZoneView apiUrl={apiUrl} />}

      {/* Tab: PPE Monitoring (MF04) */}
      {effectiveTab === 'ppe' && <PpeMonitoringView />}

      {/* Tab: Operational Dashboard */}
      {effectiveTab === 'dashboard' && <DashboardView onNavigate={(tab) => handleSelectTab(tab)} />}

      {/* Placeholder tabs for remaining modules */}
      {effectiveTab === 'workforce' && (
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

      {effectiveTab === 'access' && <AccessControlView apiUrl={apiUrl} />}

      {effectiveTab === 'incidents' && <SafetyAlertsView apiUrl={apiUrl} />}

      {effectiveTab === 'iot' && (
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

      {effectiveTab === 'progress' && (
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
