import React, { useEffect, useState } from 'react';
import { View, BackHandler } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AuthProvider, API_URL, useAuth, useCurrentUser } from './features/auth/auth-context';
import { LoginScreen } from './screens/auth/LoginScreen';
import { SplashScreen } from './screens/splash/SplashScreen';
import { ScreenHeader } from './components/common/ScreenHeader';
import { BottomTabBar, type WorkerTab, type ContractorTab } from './components/common/BottomTabBar';
import { Body, Button, Card, Choice, ErrorNotice, Hint, Page, palette } from './features/shared/ui';
import { allPages } from './features/shared/data';
import {
  WorkspaceProvider,
  useWorkspace,
  type MobileScope,
} from './features/workspace/workspace-context';
import { HomeScreen, ProfileScreen } from './features/workspace/home-profile';
import { ScheduleScreen, ShiftRequestsScreen } from './features/scheduling/scheduling-screens';
import { AttendanceScreen } from './features/attendance/attendance-screens';
import { WorkforceScreen } from './features/contractor/workforce-screen';
import { TeamsScreen } from './features/contractor/teams-screen';
import { AccessScreen } from './features/access/access-screen';
import { AssignedWorkScreen } from './features/assigned-work/assigned-work-screen';
import { QrScreen, NotificationsScreen } from './features/workspace/qr-notifications';
import { useTranslation, initSavedLanguage } from './i18n';
import { localizeMessage } from './i18n/messages';

export type UserRole = 'worker' | 'contractor';
export type MobileRoute =
  | 'home'
  | 'schedule'
  | 'attendance'
  | 'profile'
  | 'requests'
  | 'workforce'
  | 'teams'
  | 'access'
  | 'assigned'
  | 'qr'
  | 'notifications';

export type NavigationTarget = {
  route: MobileRoute;
  id?: string;
  kind?: string;
  workDate?: string;
};

function WorkspaceApp({ onScopeChange }: { onScopeChange: () => void }) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [navigation, navigate] = useState<NavigationTarget>({ route: 'home' });
  const back = () => navigate({ route: 'home' });

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navigation.route === 'home') return false;
      navigate({ route: 'home' });
      return true;
    });
    return () => sub.remove();
  }, [navigation.route]);

  const notices = useQuery({
    queryKey: [...queryKey, 'badge'],
    queryFn: () => client.listNotifications(token, { limit: 1, readStatus: 'UNREAD' }),
    refetchInterval: 30000,
  });

  const { route } = navigation;
  const contractor = scope.role === 'contractor';

  const pendingRequests = useQuery({
    queryKey: [...queryKey, 'contractor-pending-badge'],
    queryFn: () =>
      client.listShiftRequests(token, scope.siteId, {
        view: 'REVIEW',
        limit: 1,
      }),
    enabled: contractor,
    refetchInterval: 30000,
  });

  const main =
    route === 'home' ||
    route === 'schedule' ||
    route === 'profile' ||
    route === (contractor ? 'workforce' : 'attendance') ||
    (contractor && route === 'requests');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.bg }}>
      {/* Top Header */}
      <ScreenHeader
        mode={main ? 'root' : 'detail'}
        title={
          !main
            ? route === 'teams'
              ? t('teams.title')
              : route === 'access'
                ? t('access.title')
                : route === 'assigned'
                  ? t('assignedWork.title')
                  : route === 'qr'
                    ? t('qr.title')
                    : route === 'notifications'
                      ? t('notifications.title')
                      : undefined
            : undefined
        }
        siteName={scope.siteName}
        scopeLabel={contractor ? scope.contractorName : t('scope.workerRole')}
        avatarRole={scope.role}
        showAvatar={false}
        showSiteInfo={false}
        unreadCount={notices.data?.unreadCount ?? 0}
        onBack={!main ? back : undefined}
        onScopeChange={onScopeChange}
        onNotificationPress={() => navigate({ route: 'notifications' })}
        onAvatarPress={() => navigate({ route: 'profile' })}
      />

      <View style={{ flex: 1 }} key={`${route}:${navigation.id ?? ''}`}>
        {route === 'home' && <HomeScreen navigate={navigate} />}
        {route === 'profile' && (
          <ProfileScreen
            onScopeChange={onScopeChange}
            initialDocuments={navigation.kind === 'documents'}
          />
        )}
        {route === 'schedule' && <ScheduleScreen initialDate={navigation.workDate} />}
        {route === 'attendance' && (
          <AttendanceScreen initialDayId={navigation.id} onBack={main ? undefined : back} />
        )}
        {route === 'requests' && (
          <ShiftRequestsScreen
            initialId={navigation.id}
            initialKind={navigation.kind}
            onBack={main ? undefined : back}
          />
        )}
        {route === 'workforce' && contractor && <WorkforceScreen initialWorkerId={navigation.id} />}
        {route === 'teams' && contractor && <TeamsScreen onBack={back} />}
        {route === 'access' && <AccessScreen onBack={back} />}
        {route === 'assigned' && contractor && (
          <AssignedWorkScreen
            initialId={navigation.id}
            initialKind={navigation.kind}
            onBack={back}
          />
        )}
        {route === 'qr' && !contractor && <QrScreen onBack={back} />}
        {route === 'notifications' && <NotificationsScreen navigate={navigate} onBack={back} />}
      </View>

      {main && (
        <BottomTabBar
          role={scope.role}
          activeTab={route}
          pendingRequestsCount={contractor ? (pendingRequests.data?.total ?? 0) : 0}
          onSelectTab={(tab: WorkerTab | ContractorTab) => navigate({ route: tab })}
        />
      )}
    </SafeAreaView>
  );
}

function ScopePicker() {
  const { t } = useTranslation();
  const auth = useAuth(),
    profile = useCurrentUser();
  const [choice, setChoice] = useState('');
  const [choosing, setChoosing] = useState(false);

  const sites = useQuery({
    queryKey: ['mobile', 'sites', auth.epoch],
    queryFn: ({ signal }) =>
      allPages((page) => auth.client.listSites(auth.token, page, { signal }), signal),
    enabled: !!profile.data,
  });

  const isRep = profile.data?.roleAssignments.some((r) => r.role === 'CONTRACTOR_REPRESENTATIVE');

  const scopes = useQuery({
    queryKey: ['mobile', 'contractor-scopes', auth.epoch],
    queryFn: () => auth.client.contractorDashboardScopes(auth.token),
    enabled: !!isRep,
  });

  const logout = useMutation({ mutationFn: () => auth.session.logout() });

  if (profile.isError || sites.isError || (isRep && scopes.isError))
    return (
      <Page title={t('scope.failedToLoad')}>
        <ErrorNotice error={profile.error ?? sites.error ?? scopes.error} />
        <Button
          label={t('common.retry')}
          onPress={() => {
            void profile.refetch();
            void sites.refetch();
            if (isRep) void scopes.refetch();
          }}
        />
        <Button secondary label={t('common.logout')} onPress={() => logout.mutate()} />
      </Page>
    );

  if (profile.isPending || sites.isPending || (isRep && scopes.isPending))
    return <Page title={t('scope.loadingScopes')} />;

  const user = profile.data;
  if (!user) return null;

  const options: MobileScope[] = [
    ...user.roleAssignments
      .filter((r) => r.role === 'WORKER' && r.siteId)
      .flatMap((r) => {
        const site = sites.data?.find((s) => s.id === r.siteId);
        return site
          ? [
              {
                role: 'worker' as const,
                siteId: site.id,
                siteName: site.name,
                contractorId: '',
                contractorName: '',
              },
            ]
          : [];
      }),
    ...(scopes.data?.items ?? [])
      .filter((s) =>
        user.roleAssignments.some(
          (r) => r.role === 'CONTRACTOR_REPRESENTATIVE' && r.siteId === s.siteId,
        ),
      )
      .map((s) => ({
        role: 'contractor' as const,
        siteId: s.siteId,
        siteName: s.siteName,
        contractorId: s.contractorId,
        contractorName: s.contractorName,
      })),
  ];

  const key = (s: MobileScope) => `${s.role}:${s.siteId}:${s.contractorId}`;
  const selected =
    options.find((s) => key(s) === choice) ?? (options.length === 1 ? options[0] : undefined);

  if (selected && !choosing)
    return (
      <WorkspaceProvider
        key={`${auth.epoch}:${key(selected)}`}
        scope={selected}
        user={user}
        onScopeChange={() => setChoosing(true)}
        canSwitchScope={options.length > 1}
      >
        <WorkspaceApp onScopeChange={() => setChoosing(true)} />
      </WorkspaceProvider>
    );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Page title={t('scope.welcome', { name: user.displayName })}>
        <Card>
          <Body>{t('scope.chooseSiteAndRole')}</Body>
          {!options.length ? (
            <Hint>{t('scope.noActiveScope')}</Hint>
          ) : (
            <Choice
              label={t('scope.workScope')}
              value={choice}
              options={options.map((s) => ({
                value: key(s),
                label: `${s.siteName} · ${s.role === 'worker' ? t('scope.workerRole') : s.contractorName}`,
              }))}
              onChange={setChoice}
            />
          )}
          <Button
            label={t('common.continue')}
            disabled={!selected}
            onPress={() => setChoosing(false)}
          />
        </Card>
        <ErrorNotice error={logout.error} />
        <Button secondary label={t('common.logout')} onPress={() => logout.mutate()} />
      </Page>
    </SafeAreaView>
  );
}

function AuthenticatedApp() {
  const { t } = useTranslation();
  const { session, response, expired, notice } = useAuth();
  const [splash, setSplash] = useState(true);

  useEffect(() => {
    void initSavedLanguage();
  }, []);

  const restore = useQuery({
    queryKey: ['mobile-restore'],
    queryFn: () => session.restore(),
    enabled: !!API_URL,
    retry: false,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const login = useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      session.login(username, password),
  });

  if (splash) return <SplashScreen onFinish={() => setSplash(false)} />;
  if (!API_URL)
    return (
      <Page title={t('auth.notConfigured')}>
        <Hint>{t('auth.configHint')}</Hint>
      </Page>
    );

  if (response) return <ScopePicker />;
  if (restore.isPending) return <Page title={t('auth.restoringSession')} />;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      {restore.isError && (
        <Card>
          <ErrorNotice error={restore.error} />
          <Button
            secondary
            label={t('auth.restoreSession')}
            onPress={() => void restore.refetch()}
          />
        </Card>
      )}
      {expired && <Hint>{t('auth.sessionExpired')}</Hint>}
      {notice && <Hint>{localizeMessage(notice)}</Hint>}
      <LoginScreen
        pending={login.isPending}
        error={login.error}
        onLogin={(username, password) => login.mutate({ username, password })}
      />
    </SafeAreaView>
  );
}

export function SmartSiteMobileApp() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}
