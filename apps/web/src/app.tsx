import { translate as tr } from './i18n';
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
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
import { VisitorRegistrationView } from './components/access/visitor/VisitorRegistrationView';
import { IconRadio, IconTrendingUp } from './components/icons';
import {
  useAuth,
  useRestoreSession,
  useCurrentUser,
  useLogout,
  SessionExpiredModal,
} from './features/auth/auth-session';
import { LoginScreen } from './features/auth/LoginScreen';
import { AuthErrorNotice } from './features/auth/AuthErrorNotice';
import { ChangePasswordScreen } from './features/auth/ChangePasswordScreen';
import { RegisterScreen } from './features/auth/RegisterScreen';
import { WorkforceView } from './components/workforce/components/WorkforceView';
import { SiteSetupView } from './components/workforce/components/SiteSetupView';
import { ScheduleSetupView } from './components/workforce/components/ScheduleSetupView';
import { WorkerOnboardingView } from './components/workforce/components/WorkerOnboardingView';

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
  useTranslation();
  const navigate = useNavigate();

  const { accessToken } = useAuth();
  const currentUser = useCurrentUser(apiUrl);
  const profile = currentUser;
  const logout = useLogout(apiUrl);
  const location = useLocation();
  const incidentLink = new URLSearchParams(location.search);

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  if (currentUser.isPending) {
    return (
      <main className="min-h-screen flex items-center justify-center" role="status">
        {tr('common.loading_your_account')}
      </main>
    );
  }
  if (currentUser.isError) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p role="alert">{tr('app.could_not_load_your_account')}</p>
        <button type="button" onClick={() => currentUser.refetch()}>
          {tr('common.try_again')}
        </button>
      </main>
    );
  }

  const roles = currentUser.data?.roleAssignments.map((r) => r.role) ?? [];
  const isManagerOnly =
    roles.includes('SITE_MANAGER') &&
    !roles.includes('ADMIN') &&
    !roles.includes('CONTRACTOR_REPRESENTATIVE');
  if (isManagerOnly && ['/access', '/workforce'].includes(location.pathname.replace(/\/$/, '')))
    return <Navigate to="/site-setup" replace />;

  return (
    <AppLayout onSelectTab={onNavigate}>
      <Routes>
        <Route path="/" element={<Navigate to={`/${defaultAuthTab}`} replace />} />
        <Route
          path="/dashboard"
          element={
            defaultAuthTab === 'incidents' ? (
              <Navigate to="/incidents" replace />
            ) : defaultAuthTab === 'workforce' ? (
              <Navigate to="/workforce" replace />
            ) : (
              <DashboardView
                apiUrl={apiUrl}
                onNavigate={(tab, context) => onNavigate(tab, context)}
              />
            )
          }
        />
        <Route
          path="/account/password"
          element={
            <ChangePasswordScreen
              apiUrl={apiUrl}
              onCancel={() => navigate(`/${defaultAuthTab}`)}
              onComplete={() =>
                navigate('/login', { state: { passwordChanged: true }, replace: true })
              }
            />
          }
        />
        <Route path="/workforce" element={<WorkforceView apiUrl={apiUrl} />} />
        <Route path="/worker-onboarding" element={<WorkerOnboardingView apiUrl={apiUrl} />} />
        <Route path="/site-setup" element={<SiteSetupView apiUrl={apiUrl} />} />
        <Route path="/schedule-setup" element={<ScheduleSetupView apiUrl={apiUrl} />} />
        <Route path="/access" element={<AccessControlView apiUrl={apiUrl} />} />
        <Route
          path="/live-monitoring"
          element={<LiveMonitoringView onNavigate={(tab) => onNavigate(tab)} />}
        />
        <Route
          path="/ppe"
          element={<PpeMonitoringView onNavigate={(tab, context) => onNavigate(tab, context)} />}
        />
        <Route
          path="/zones"
          element={
            <RestrictedZoneView
              authenticatedSession={profile.data ? { accessToken, user: profile.data } : undefined}
              onSignOut={() => logout.mutate()}
              apiUrl={apiUrl}
              onNavigate={(tab, context) => onNavigate(tab, context)}
            />
          }
        />
        <Route
          path="/incidents"
          element={
            profile.data ? (
              <SafetyAlertsView
                key={profile.data.id + JSON.stringify(alertsContext ?? {})}
                authenticatedSession={{ accessToken, user: profile.data }}
                onSignOut={() => logout.mutate()}
                apiUrl={apiUrl}
                initialSiteId={incidentLink.get('siteId') ?? alertsContext?.siteId}
                initialChecklistId={incidentLink.get('checklistId') ?? undefined}
                initialIncidentId={incidentLink.get('incidentId') ?? undefined}
                initialActionId={incidentLink.get('actionId') ?? undefined}
                initialAlertId={alertsContext?.alertId}
                initialStatus={alertsContext?.status}
                initialType={alertsContext?.alertType}
              />
            ) : profile.isError ? (
              <div role="alert">
                {tr('app.could_not_load_your_account')}{' '}
                <button onClick={() => void profile.refetch()}>{tr('common.retry')}</button>
              </div>
            ) : (
              <p role="status">{tr('common.loading_your_account_8fa5b7')}</p>
            )
          }
        />
        <Route
          path="/iot"
          element={
            <div className="bg-white p-8 rounded-xl border border-[#E2E8F0] shadow-xs max-w-4xl mx-auto text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 mx-auto flex items-center justify-center">
                <IconRadio className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-[#041D2E]">
                {tr('common.iot_environmental_sensors')}
              </h2>
              <p className="text-sm text-[#62748E] max-w-md mx-auto">
                {tr(
                  'app.environmental_air_quality_noise_thresholds_crane_wind_speed_and_perimeter_beams',
                )}
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
              <h2 className="text-xl font-bold text-[#041D2E]">
                {tr('common.construction_progress_monitoring')}
              </h2>
              <p className="text-sm text-[#62748E] max-w-md mx-auto">
                {tr('app.4d_bim_overlay_photogrammetry_site_scans_and_milestone_progress_tracking')}
              </p>
            </div>
          }
        />
        <Route path="*" element={<Navigate to={`/${defaultAuthTab}`} replace />} />
      </Routes>
    </AppLayout>
  );
}

function PublicOnlyRoute({
  children,
  defaultAuthTab,
}: {
  children: React.ReactNode;
  defaultAuthTab: string;
}) {
  useTranslation();

  const { accessToken } = useAuth();
  if (accessToken) {
    return <Navigate to={`/${defaultAuthTab}`} replace />;
  }
  return <>{children}</>;
}

export function App() {
  useTranslation();

  const navigate = useNavigate();
  const location = useLocation();
  const {
    accessToken,
    isSessionExpired,
    dismissSessionExpired,
    logoutUnconfirmed,
    passwordChanged,
  } = useAuth();
  const restoringSession = useRestoreSession(apiUrl);
  const isRestoringSession = restoringSession.isLoading;
  const currentUserQuery = useCurrentUser(apiUrl);
  const currentUser = currentUserQuery.data;

  const roles: string[] = currentUser?.roleAssignments?.map((r) => r.role) || [];
  const isWorkerOnly =
    roles.includes('WORKER') && !roles.includes('ADMIN') && !roles.includes('SITE_MANAGER');
  const safetyDefault =
    roles.includes('SAFETY_OFFICER') &&
    !roles.some((r) => ['ADMIN', 'SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE'].includes(r));
  const defaultAuthTab = safetyDefault ? 'incidents' : isWorkerOnly ? 'workforce' : 'dashboard';
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
        aria-label={tr('common.loading_account_permissions')}
        className="min-h-screen bg-[#041D2E] flex items-center justify-center"
      >
        <div className="w-8 h-8 rounded-full border-2 border-[#F66B17] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (restoringSession.isError && !accessToken) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <section className="max-w-md space-y-4 rounded-xl border bg-white p-6">
          <h1 className="font-bold">{tr('auth.session.restore')}</h1>
          <AuthErrorNotice error={restoringSession.error} />
          <button
            type="button"
            disabled={restoringSession.isFetching}
            onClick={() => void restoringSession.refetch()}
            className="rounded-lg bg-[#071A2B] text-white px-4 py-2"
          >
            {tr('common.retry')}
          </button>
        </section>
      </main>
    );
  }

  if (accessToken && currentUserQuery.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div
          role="alert"
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 text-center"
        >
          <h1 className="text-lg font-bold text-slate-900">
            {tr('app.could_not_load_your_account_03c0b0')}
          </h1>
          <p className="text-sm text-slate-600">
            {tr('app.your_permissions_could_not_be_loaded_please_try_again')}
          </p>
          <button
            type="button"
            disabled={currentUserQuery.isFetching}
            onClick={() => void currentUserQuery.refetch()}
            className="rounded-lg bg-[#071A2B] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            {tr('common.retry')}
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
                notice={
                  logoutUnconfirmed
                    ? tr('auth.session.logoutWarning')
                    : passwordChanged || location.state?.passwordChanged
                      ? tr('auth.password.success')
                      : undefined
                }
                onBack={() => navigate('/')}
                onNavigateToRegister={() => navigate('/register')}
              />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/visits/register"
          element={<VisitorRegistrationView apiUrl={apiUrl} onBack={() => navigate('/login')} />}
        />

        <Route
          path="/register"
          element={
            <PublicOnlyRoute defaultAuthTab={defaultAuthTab}>
              <RegisterScreen
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
