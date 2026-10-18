import { translate as tr } from './i18n';
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
import {
  useAuth,
  useRestoreSession,
  useCurrentUser,
  useLogout,
  SessionExpiredModal,
} from './features/auth/auth-session';
import { LoginScreen } from './features/auth/LoginScreen';
import { RegisterScreen } from './features/auth/RegisterScreen';
import { ChangePasswordScreen } from './features/auth/ChangePasswordScreen';
import { WorkforceView } from './components/workforce/components/WorkforceView';
import { SiteSetupView } from './components/workforce/components/SiteSetupView';
import { ScheduleSetupView } from './components/workforce/components/ScheduleSetupView';
import { useTranslation } from 'react-i18next';
import { AccountsView } from './features/accounts/AccountsView';
import { AssignedWorkView } from './components/contractor/AssignedWorkView';
import { ContractorDashboardView } from './components/contractor/ContractorDashboardView';
import { WorkerDashboardView } from './components/dashboard/WorkerDashboardView';
import { WorkerOnboardingView } from './components/workforce/components/WorkerOnboardingView';
import { WorkerDocumentsView } from './components/workforce/components/WorkerDocumentsView';
import { workspaceTabs, defaultWorkspace } from './features/auth/workspace-access';

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
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  const currentUser = useCurrentUser(apiUrl);
  const profile = currentUser;
  const logout = useLogout(apiUrl);
  const location = useLocation();
  const navigate = useNavigate();
  const incidentLink = new URLSearchParams(location.search);

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  if (currentUser.isPending) {
    return (
      <main className="min-h-screen flex items-center justify-center" role="status">
        {t('auth.loadingAccount')}
      </main>
    );
  }
  if (currentUser.isError) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p role="alert">{t('auth.loadAccountError')}</p>
        <button type="button" onClick={() => currentUser.refetch()}>
          {t('accounts.retry')}
        </button>
      </main>
    );
  }
  const allowedTabs = workspaceTabs(currentUser.data?.roleAssignments ?? []);
  const fallback = defaultWorkspace(currentUser.data?.roleAssignments ?? []);
  if (allowedTabs.length === 0) {
    return (
      <main className="p-8" role="status">
        {t('auth.noAssignedRoles')}
        <button type="button" className="ml-4 underline" onClick={() => logout.mutate()}>
          {t('shell.signOut')}
        </button>
      </main>
    );
  }
  if (
    location.pathname !== '/account/password' &&
    !allowedTabs.includes(location.pathname.slice(1))
  ) {
    return <Navigate to={`/${fallback}`} replace />;
  }

  return (
    <AppLayout onSelectTab={onNavigate}>
      <Routes>
        <Route
          path="/account/password"
          element={
            <ChangePasswordScreen
              apiUrl={apiUrl}
              onCancel={() => navigate(`/${fallback}`)}
              onComplete={() =>
                navigate('/login', { state: { passwordChanged: true }, replace: true })
              }
            />
          }
        />
        <Route path="/" element={<Navigate to={`/${defaultAuthTab}`} replace />} />
        <Route
          path="/dashboard"
          element={
            defaultAuthTab === 'incidents' ? (
              <Navigate to="/incidents" replace />
            ) : defaultAuthTab === 'workforce' ? (
              <Navigate to="/workforce" replace />
            ) : (
              <DashboardView onNavigate={(tab) => onNavigate(tab)} />
            )
          }
        />
        <Route path="/workforce" element={<WorkforceView apiUrl={apiUrl} />} />
        <Route path="/site-setup" element={<SiteSetupView apiUrl={apiUrl} />} />
        <Route path="/accounts" element={<AccountsView apiUrl={apiUrl} />} />
        <Route
          path="/assigned-work"
          element={
            <AssignedWorkView apiUrl={apiUrl} token={accessToken} user={currentUser.data!} />
          }
        />
        <Route
          path="/contractor-teams"
          element={<ContractorDashboardView apiUrl={apiUrl} onNavigate={onNavigate} />}
        />
        <Route
          path="/worker-summary"
          element={<WorkerDashboardView apiUrl={apiUrl} onNavigate={onNavigate} />}
        />
        <Route path="/worker-onboarding" element={<WorkerOnboardingView apiUrl={apiUrl} />} />
        <Route path="/worker-documents" element={<WorkerDocumentsView apiUrl={apiUrl} />} />
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
              authenticatedSession={{ accessToken, user: currentUser.data! }}
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
                initialIncidentId={incidentLink.get('incidentId') ?? undefined}
                initialActionId={incidentLink.get('actionId') ?? undefined}
                initialDocumentWorkerId={
                  incidentLink.get('tab') === 'documents'
                    ? (incidentLink.get('workerId') ?? undefined)
                    : undefined
                }
                initialAlertId={alertsContext?.alertId}
                initialStatus={alertsContext?.status}
                initialType={alertsContext?.alertType}
              />
            ) : profile.isError ? (
              <div role="alert">
                {t('auth.loadAccountError')}{' '}
                <button onClick={() => void profile.refetch()}>{t('accounts.retry')}</button>
              </div>
            ) : (
              <p role="status">{t('auth.loadingAccount')}</p>
            )
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
  const { accessToken } = useAuth();
  if (accessToken) {
    return <Navigate to={`/${defaultAuthTab}`} replace />;
  }
  return <>{children}</>;
}

export function App() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { accessToken, isSessionExpired, dismissSessionExpired } = useAuth();
  const { isLoading: isRestoringSession } = useRestoreSession(apiUrl);
  const currentUserQuery = useCurrentUser(apiUrl);
  const currentUser = currentUserQuery.data;

  const defaultAuthTab = defaultWorkspace(currentUser?.roleAssignments ?? []);
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

  if (accessToken && currentUserQuery.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div
          role="alert"
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 text-center"
        >
          <h1 className="text-lg font-bold text-slate-900">{t('auth.loadAccountError')}</h1>
          <p className="text-sm text-slate-600">{t('auth.loadAccountErrorDesc')}</p>
          <button
            type="button"
            disabled={currentUserQuery.isFetching}
            onClick={() => void currentUserQuery.refetch()}
            className="rounded-lg bg-[#071A2B] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            {t('accounts.retry')}
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
