import { workspaceTabs, defaultWorkspace } from './features/auth/workspace-access';
import { translate as tr, uiLanguage } from './i18n';
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  getBackendHealth,
  ApiError,
  type SafetyAlertStatus,
  type SafetyAlertType,
} from '@smartsite/api-client';
import { AppLayout, type ActiveTab } from './components/layout/AppLayout';
import {
  useAuth,
  useRestoreSession,
  useCurrentUser,
  useLogout,
  SessionExpiredModal,
} from './features/auth/auth-session';
import type { SharedSession } from './types/shared-session';
import { LoginScreen } from './features/auth/LoginScreen';
import { AuthErrorNotice } from './features/auth/AuthErrorNotice';

// Code-split page components with React.lazy to avoid eagerly loading all views into the entry bundle.
// Static shell: LoginScreen, AppLayout, auth session hooks, and SessionExpiredModal remain static.
const LandingPage = React.lazy(() =>
  import('./components/landing/LandingPage').then((m) => ({ default: m.LandingPage })),
);
const RegisterScreen = React.lazy(() =>
  import('./features/auth/RegisterScreen').then((m) => ({ default: m.RegisterScreen })),
);
const ChangePasswordScreen = React.lazy(() =>
  import('./features/auth/ChangePasswordScreen').then((m) => ({ default: m.ChangePasswordScreen })),
);
const DashboardView = React.lazy(() =>
  import('./components/dashboard/DashboardView').then((m) => ({ default: m.DashboardView })),
);
const WorkforceView = React.lazy(() =>
  import('./components/workforce/components/WorkforceView').then((m) => ({
    default: m.WorkforceView,
  })),
);
const SiteSetupView = React.lazy(() =>
  import('./components/workforce/components/SiteSetupView').then((m) => ({
    default: m.SiteSetupView,
  })),
);
const ScheduleSetupView = React.lazy(() =>
  import('./components/workforce/components/ScheduleSetupView').then((m) => ({
    default: m.ScheduleSetupView,
  })),
);
const WorkerOnboardingView = React.lazy(() =>
  import('./components/workforce/components/WorkerOnboardingView').then((m) => ({
    default: m.WorkerOnboardingView,
  })),
);
const AccessControlView = React.lazy(() =>
  import('./components/access/AccessControlView').then((m) => ({ default: m.AccessControlView })),
);
const VisitorRegistrationView = React.lazy(() =>
  import('./components/access/visitor/VisitorRegistrationView').then((m) => ({
    default: m.VisitorRegistrationView,
  })),
);
const LiveMonitoringView = React.lazy(() =>
  import('./components/live/LiveMonitoringView').then((m) => ({ default: m.LiveMonitoringView })),
);
const PpeMonitoringView = React.lazy(() =>
  import('./components/ppe/PpeMonitoringView').then((m) => ({ default: m.PpeMonitoringView })),
);
const CameraSetupView = React.lazy(() =>
  import('./components/cameras/CameraSetupView').then((m) => ({ default: m.CameraSetupView })),
);
const RestrictedZoneView = React.lazy(() =>
  import('./components/zones/RestrictedZoneView').then((m) => ({ default: m.RestrictedZoneView })),
);
const SafetyAlertsView = React.lazy(() =>
  import('./components/alerts/SafetyAlertsView').then((m) => ({ default: m.SafetyAlertsView })),
);

const ContractorDashboardView = React.lazy(() =>
  import('./components/contractor/ContractorDashboardView').then((m) => ({
    default: m.ContractorDashboardView,
  })),
);
const AssignedWorkView = React.lazy(() =>
  import('./components/contractor/AssignedWorkView').then((m) => ({ default: m.AssignedWorkView })),
);
const WorkerDashboardView = React.lazy(() =>
  import('./components/dashboard/WorkerDashboardView').then((m) => ({
    default: m.WorkerDashboardView,
  })),
);

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

/**
 * Accessible status loading indicator for Suspense boundaries.
 */
function PageLoadingFallback({ label }: { label?: string }) {
  const resolvedLabel = label ?? tr('common.loading');
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-96 w-full items-center justify-center p-6 text-center"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-[#0F172A] border-t-transparent animate-spin" />
        <span className="text-xs font-medium text-slate-500">{resolvedLabel}</span>
      </div>
    </div>
  );
}

function routeErrorCopy(fallbackTitle?: string) {
  if (uiLanguage() === 'vi') {
    return {
      title: fallbackTitle || tr('common.request_failed'),
      description: tr('errors.unexpected'),
      reloadLabel: tr('common.refresh'),
    };
  }
  return {
    title: fallbackTitle || 'Unable to load page',
    description:
      'This screen could not be loaded. Reload this page, or use navigation to choose another view.',
    reloadLabel: 'Reload Page',
  };
}

/**
 * Safe Error Boundary for dynamic chunk and route load failures.
 * Provides a page reload action without dumping raw errors or authentication tokens.
 */
interface RouteErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
}

class RouteErrorBoundary extends React.Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  constructor(props: RouteErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch() {
    // Chunk load error caught safely without leaking tokens or sensitive state
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const copy = routeErrorCopy(this.props.fallbackTitle);
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="mx-auto max-w-lg my-8 rounded-2xl border border-slate-200/80 bg-white p-7 text-center shadow-sm"
        >
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 mx-auto flex items-center justify-center mb-3">
            <span className="text-base font-bold">!</span>
          </div>
          <h2 className="text-lg font-bold text-slate-900">{copy.title}</h2>
          <p className="mt-2 text-xs text-slate-500 leading-relaxed max-w-md mx-auto">
            {copy.description}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
            >
              {copy.reloadLabel}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function profileRecoveryMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return tr('safety_alert_evidence_utils.your_session_is_no_longer_valid_sign_in_again');
    }
    if (error.status === 403) {
      return tr('app.profile_recovery.forbidden');
    }
    if (error.code === 'network') {
      return tr('app.profile_recovery.network');
    }
    if (error.code === 'timeout') return tr('app.profile_recovery.timeout');
    if (error.status === 503) return tr('app.profile_recovery.unavailable');
    if (error.code === 'invalid-response') return tr('app.profile_recovery.invalid_response');
  }
  return tr('app.profile_recovery.default');
}

function ProtectedRoutes({ defaultAuthTab, alertsContext, onNavigate }: ProtectedRoutesProps) {
  useTranslation();
  const navigate = useNavigate();

  const location = useLocation();
  const incidentLink = new URLSearchParams(location.search);
  const { accessToken, sessionScope: providerScope } = useAuth();
  const {
    data: currentUser,
    isPending: isUserPending,
    isFetching: isUserFetching,
    isError: isUserError,
    error: userError,
    refetch: refetchUser,
  } = useCurrentUser(apiUrl);
  const logoutMutation = useLogout(apiUrl);

  const handleSignOut = React.useCallback(() => {
    logoutMutation.mutate();
  }, [logoutMutation]);

  const sharedSession = React.useMemo<SharedSession | null>(() => {
    if (!accessToken || !currentUser || !providerScope || isUserError) return null;
    return {
      accessToken,
      user: {
        id: currentUser.id,
        displayName: currentUser.displayName,
        roleAssignments: currentUser.roleAssignments,
        username: currentUser.username,
        mustChangePassword: currentUser.mustChangePassword,
      },
      sessionScope: providerScope,
      onSignOut: handleSignOut,
    };
  }, [accessToken, currentUser, providerScope, handleSignOut, isUserError]);

  // Auth gate remains outside AppLayout and Suspense; unauthenticated sessions fail closed
  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  // A failed background refetch keeps cached profile data in TanStack Query.
  // Do not use that stale profile to reopen operational pages before recovery.
  if (isUserError) {
    const profileDenied =
      userError instanceof ApiError && (userError.status === 401 || userError.status === 403);
    return (
      <AppLayout onSelectTab={onNavigate}>
        <div
          role="alert"
          className="mx-auto max-w-lg rounded-2xl border border-slate-200/80 bg-white p-7 text-center shadow-sm"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-[#9F2F2D]">
            {tr('common.error')}
          </p>
          <h2 className="mt-2 text-xl font-bold text-slate-900">
            {tr('workforce_view.could_not_load_user_profile')}
          </h2>
          <p className="mt-2 text-sm text-slate-500">{profileRecoveryMessage(userError)}</p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              disabled={profileDenied || isUserFetching}
              onClick={() => {
                if (!profileDenied && !isUserFetching) void refetchUser();
              }}
              className="rounded-xl bg-[#0F172A] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUserFetching ? tr('app.profile_recovery.retrying') : tr('common.retry')}
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
            >
              {tr('common.sign_out')}
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (isUserPending || !currentUser) {
    return (
      <AppLayout onSelectTab={onNavigate}>
        <div
          role="status"
          aria-label={tr('common.loading_your_account_8fa5b7')}
          aria-live="polite"
          className="flex h-96 flex-col items-center justify-center gap-3"
        >
          <div className="w-8 h-8 rounded-full border-2 border-[#0F172A] border-t-transparent animate-spin" />
          <span className="text-xs font-medium text-slate-500">
            {tr('common.loading_your_account_8fa5b7')}
          </span>
        </div>
      </AppLayout>
    );
  }

  const allowedTabs = workspaceTabs(currentUser.roleAssignments ?? []);
  if (allowedTabs.length === 0) {
    return (
      <main className="p-8" role="status">
        {tr('auth.noAssignedRoles')}
        <button type="button" className="ml-4 underline" onClick={handleSignOut}>
          {tr('shell.signOut')}
        </button>
      </main>
    );
  }
  if (
    location.pathname !== '/account/password' &&
    !allowedTabs.includes(location.pathname.replace(/^\//, '').replace(/\/$/, ''))
  ) {
    return <Navigate to={`/${defaultWorkspace(currentUser.roleAssignments ?? [])}`} replace />;
  }

  return (
    <AppLayout onSelectTab={onNavigate}>
      <RouteErrorBoundary key={location.pathname}>
        <React.Suspense fallback={<PageLoadingFallback />}>
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
            <Route
              path="/contractor-teams"
              element={<ContractorDashboardView apiUrl={apiUrl} onNavigate={onNavigate} />}
            />
            <Route
              path="/assigned-work"
              element={<AssignedWorkView apiUrl={apiUrl} token={accessToken!} user={currentUser} />}
            />
            <Route
              path="/worker-summary"
              element={<WorkerDashboardView apiUrl={apiUrl} onNavigate={onNavigate} />}
            />
            <Route path="/workforce" element={<WorkforceView apiUrl={apiUrl} />} />
            <Route path="/worker-onboarding" element={<WorkerOnboardingView apiUrl={apiUrl} />} />
            <Route path="/site-setup" element={<SiteSetupView apiUrl={apiUrl} />} />
            <Route path="/schedule-setup" element={<ScheduleSetupView apiUrl={apiUrl} />} />
            <Route path="/access" element={<AccessControlView apiUrl={apiUrl} />} />
            <Route
              path="/live-monitoring"
              element={
                <LiveMonitoringView
                  onNavigate={(tab) => onNavigate(tab)}
                  canOpenCameraSetup={allowedTabs.includes('camera-setup')}
                />
              }
            />
            <Route
              path="/camera-setup"
              element={<CameraSetupView apiUrl={apiUrl} sharedSession={sharedSession} />}
            />
            <Route
              path="/ppe"
              element={
                <PpeMonitoringView
                  key={location.search}
                  apiUrl={apiUrl}
                  sharedSession={sharedSession}
                  initialSelection={{
                    siteId: new URLSearchParams(location.search).get('siteId') ?? undefined,
                    cameraId: new URLSearchParams(location.search).get('cameraId') ?? undefined,
                  }}
                  onOpenSetup={(context) => {
                    const params = new URLSearchParams({ siteId: context.siteId });
                    if (context.cameraId) params.set('cameraId', context.cameraId);
                    navigate(`/camera-setup?${params}`);
                  }}
                  onNavigate={(tab, context) => onNavigate(tab, context)}
                />
              }
            />
            <Route
              path="/zones"
              element={
                <RestrictedZoneView
                  apiUrl={apiUrl}
                  sharedSession={sharedSession}
                  onOpenSetup={() => navigate('/camera-setup')}
                  onNavigate={(tab, context) => onNavigate(tab, context)}
                />
              }
            />
            <Route
              path="/incidents"
              element={
                <SafetyAlertsView
                  key={`${currentUser.id}:${JSON.stringify(alertsContext ?? {})}`}
                  apiUrl={apiUrl}
                  sharedSession={sharedSession}
                  authenticatedSession={{ accessToken, user: currentUser }}
                  onSignOut={handleSignOut}
                  initialSiteId={incidentLink.get('siteId') ?? alertsContext?.siteId}
                  initialIncidentId={incidentLink.get('incidentId') ?? undefined}
                  initialChecklistId={incidentLink.get('checklistId') ?? undefined}
                  initialActionId={incidentLink.get('actionId') ?? undefined}
                  initialAlertId={alertsContext?.alertId}
                  initialStatus={alertsContext?.status}
                  initialType={alertsContext?.alertType}
                />
              }
            />
            <Route path="*" element={<Navigate to={`/${defaultAuthTab}`} replace />} />
          </Routes>
        </React.Suspense>
      </RouteErrorBoundary>
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
  const profile = useCurrentUser(apiUrl);
  if (accessToken && profile.isPending) {
    return <PageLoadingFallback />;
  }
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
  const { data: currentUser } = useCurrentUser(apiUrl);

  const defaultAuthTab = defaultWorkspace(currentUser?.roleAssignments ?? []);
  const [alertsContext, setAlertsContext] = useState<AlertsNavigationContext | undefined>();

  // Backend live health check (locale-invariant queryKey)
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

  if (isRestoringSession) {
    return (
      <div
        role="status"
        aria-label={tr('common.loading_account_permissions')}
        aria-live="polite"
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

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <RouteErrorBoundary>
              <React.Suspense fallback={<PageLoadingFallback />}>
                <LandingPage
                  onEnterApp={(tab) => {
                    if (accessToken) {
                      navigate(tab ? `/${tab}` : `/${defaultAuthTab}`);
                    } else {
                      navigate('/login');
                    }
                  }}
                />
              </React.Suspense>
            </RouteErrorBoundary>
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
          element={
            <RouteErrorBoundary>
              <React.Suspense fallback={<PageLoadingFallback />}>
                <VisitorRegistrationView apiUrl={apiUrl} onBack={() => navigate('/login')} />
              </React.Suspense>
            </RouteErrorBoundary>
          }
        />

        <Route
          path="/register"
          element={
            <PublicOnlyRoute defaultAuthTab={defaultAuthTab}>
              <RouteErrorBoundary>
                <React.Suspense fallback={<PageLoadingFallback />}>
                  <RegisterScreen
                    onBackToLogin={() => navigate('/login')}
                    onBackToSite={() => navigate('/')}
                  />
                </React.Suspense>
              </RouteErrorBoundary>
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
