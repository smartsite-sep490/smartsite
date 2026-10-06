import React, { useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  getBackendHealth,
  type SafetyAlertStatus,
  type SafetyAlertType,
} from '@smartsite/api-client';
import { AppLayout, type ActiveTab } from './components/layout/AppLayout';
import { LiveMonitoringView } from './components/live/LiveMonitoringView';
import { RestrictedZoneView } from './components/zones/RestrictedZoneView';
import { PpeMonitoringView } from './components/ppe/PpeMonitoringView';
import { DashboardView } from './components/dashboard/DashboardView';
import { LandingPage } from './components/landing/LandingPage';
import { SafetyAlertsView } from './components/alerts/SafetyAlertsView';
import { AccessControlView } from './components/access/AccessControlView';
import { IconRadio, IconTrendingUp } from './components/icons';
import { useAuth, useRestoreSession, useCurrentUser, SessionExpiredModal } from './features/auth/auth-session';
import { LoginScreen } from './features/auth/LoginScreen';
import { RegisterScreen } from './features/auth/RegisterScreen';
import { WorkforceView } from './components/workforce/WorkforceView';
import { SiteSetupView } from './components/workforce/SiteSetupView';
import { ScheduleSetupView } from './components/workforce/ScheduleSetupView';

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface AlertsNavigationContext {
  alertType?: SafetyAlertType;
  siteId?: string;
  alertId?: string;
  status?: SafetyAlertStatus;
}

interface ProtectedRoutesProps {
  defaultAuthTab: string;
  alertsContext?: AlertsNavigationContext;
  onNavigate: (tab: ActiveTab, context?: AlertsNavigationContext) => void;
}

function ProtectedRoutes({ defaultAuthTab, alertsContext, onNavigate }: ProtectedRoutesProps) {
  const { accessToken } = useAuth();

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  return (
    <AppLayout onSelectTab={onNavigate}>
      <Routes>
        <Route path="/" element={<Navigate to={`/${defaultAuthTab}`} replace />} />
        <Route
          path="/dashboard"
          element={
            defaultAuthTab === 'workforce' ? (
              <Navigate to="/workforce" replace />
            ) : (
              <DashboardView onNavigate={tab => onNavigate(tab)} />
            )
          }
        />
        <Route path="/workforce" element={<WorkforceView apiUrl={apiUrl} />} />
        <Route path="/site-setup" element={<SiteSetupView apiUrl={apiUrl} />} />
        <Route path="/schedule-setup" element={<ScheduleSetupView apiUrl={apiUrl} />} />
        <Route path="/access" element={<AccessControlView apiUrl={apiUrl} />} />
        <Route path="/live-monitoring" element={<LiveMonitoringView onNavigate={tab => onNavigate(tab)} />} />
        <Route path="/ppe" element={<PpeMonitoringView onNavigate={(tab, context) => onNavigate(tab, context)} />} />
        <Route
          path="/zones"
          element={<RestrictedZoneView apiUrl={apiUrl} onNavigate={(tab, context) => onNavigate(tab, context)} />}
        />
        <Route
          path="/incidents"
          element={
            <SafetyAlertsView
              key={JSON.stringify(alertsContext ?? {})}
              apiUrl={apiUrl}
              initialSiteId={alertsContext?.siteId}
              initialAlertId={alertsContext?.alertId}
              initialStatus={alertsContext?.status}
              initialType={alertsContext?.alertType}
            />
          }
        />
        <Route
          path="/iot"
          element={
            <div className="bg-white p-8 rounded-xl border border-[#E2E8F0] shadow-xs max-w-4xl mx-auto text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 mx-auto flex items-center justify-center">
                <IconRadio className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-[#041D2E]">IoT Environmental Sensors</h2>
              <p className="text-sm text-[#62748E] max-w-md mx-auto">
                Environmental air quality, noise thresholds, crane wind speed and perimeter beams.
              </p>
            </div>
          }
        />
        <Route
          path="/progress"
          element={
            <div className="bg-white p-8 rounded-xl border border-[#E2E8F0] shadow-xs max-w-4xl mx-auto text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-600 mx-auto flex items-center justify-center">
                <IconTrendingUp className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-[#041D2E]">Construction Progress Monitoring</h2>
              <p className="text-sm text-[#62748E] max-w-md mx-auto">
                4D BIM overlay, photogrammetry site scans and milestone progress tracking.
              </p>
            </div>
          }
        />
        <Route path="*" element={<Navigate to={`/${defaultAuthTab}`} replace />} />
      </Routes>
    </AppLayout>
  );
}

function PublicOnlyRoute({ children, defaultAuthTab }: { children: React.ReactNode; defaultAuthTab: string }) {
  const { accessToken } = useAuth();
  if (accessToken) {
    return <Navigate to={`/${defaultAuthTab}`} replace />;
  }
  return <>{children}</>;
}

export function App() {
  const navigate = useNavigate();
  const { accessToken, isSessionExpired, dismissSessionExpired } = useAuth();
  const { isLoading: isRestoringSession } = useRestoreSession(apiUrl);
  const currentUserQuery = useCurrentUser(apiUrl);
  const currentUser = currentUserQuery.data;

  const roles: string[] = currentUser?.roleAssignments?.map((r) => r.role) || [];
  const isWorkerOnly = roles.includes('WORKER') && !roles.includes('ADMIN') && !roles.includes('SITE_MANAGER');
  const defaultAuthTab = isWorkerOnly ? 'workforce' : 'dashboard';
  const [alertsContext, setAlertsContext] = useState<AlertsNavigationContext | undefined>();

  // Backend live health check
  useQuery({
    queryKey: ['backend', apiUrl, 'health'],
    queryFn: ({ signal }) => getBackendHealth(apiUrl, { signal }),
  });

  const handleNavigate = (tab: ActiveTab, context?: AlertsNavigationContext) => {
    if (tab === 'incidents') {
      setAlertsContext(context);
    }
    navigate(`/${tab}`);
  };

  if (isRestoringSession || (accessToken && !currentUser && !currentUserQuery.isError)) {
    return (
      <div
        role="status"
        aria-label="Loading account permissions"
        className="min-h-screen bg-[#041D2E] flex items-center justify-center"
      >
        <div className="w-8 h-8 rounded-full border-2 border-[#F66B17] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (accessToken && currentUserQuery.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div
          role="alert"
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 text-center"
        >
          <h1 className="text-lg font-bold text-slate-900">Could not load your account</h1>
          <p className="text-sm text-slate-600">
            Your permissions could not be loaded. Please try again.
          </p>
          <button
            type="button"
            disabled={currentUserQuery.isFetching}
            onClick={() => void currentUserQuery.refetch()}
            className="rounded-lg bg-[#071A2B] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <LandingPage
              onEnterApp={(tab) => {
                if (accessToken) {
                  navigate(tab ? `/${tab}` : `/${defaultAuthTab}`);
                } else {
                  navigate('/login');
                }
              }}
            />
          }
        />

        <Route
          path="/login"
          element={
            <PublicOnlyRoute defaultAuthTab={defaultAuthTab}>
              <LoginScreen
                // PublicOnlyRoute chooses the destination after the account profile loads.
                onLoginSuccess={() => navigate('/login', { replace: true })}
                onBack={() => navigate('/')}
                onNavigateToRegister={() => navigate('/register')}
              />
            </PublicOnlyRoute>
          }
        />

        <Route
          path="/register"
          element={
            <PublicOnlyRoute defaultAuthTab={defaultAuthTab}>
              <RegisterScreen
                onRegisterSuccess={() => navigate('/login')}
                onBackToLogin={() => navigate('/login')}
                onBackToSite={() => navigate('/')}
              />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/*"
          element={
            <ProtectedRoutes
              defaultAuthTab={defaultAuthTab}
              alertsContext={alertsContext}
              onNavigate={handleNavigate}
            />
          }
        />
      </Routes>

      <SessionExpiredModal
        open={isSessionExpired}
        onReLogin={() => {
          dismissSessionExpired();
          navigate('/login');
        }}
      />
    </>
  );
}

export default App;
