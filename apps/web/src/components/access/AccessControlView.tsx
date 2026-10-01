import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient, type LoginResponse } from '@smartsite/api-client';
import {
  IconAlertTriangle,
  IconBuilding2,
  IconCamera,
  IconKey,
  IconRefresh,
  IconShield,
  IconUser,
  IconUsers,
} from '../icons';
import { SecurityGateDeskView } from './SecurityGateDeskView';
import { WorkerEnrollmentView } from './WorkerEnrollmentView';
import { VisitorAccessView } from './VisitorAccessView';
import { WorkerGatePermissionsView } from './WorkerGatePermissionsView';

export type AccessSubTab =
  | 'gate-desk' | 'worker-enrollment' | 'gate-permissions' | 'visitor-passes';

interface TabDefinition {
  id: AccessSubTab;
  code: string;
  label: string;
  subLabel: string;
  description: string;
  icon: typeof IconCamera;
}

const ACCESS_TABS: readonly TabDefinition[] = [
  {
    id: 'gate-desk',
    code: 'MF02',
    label: 'Security Gate Desk',
    subLabel: 'Face & Dynamic QR Scan',
    description: 'Physical gate security desk for real-time facial verification and check-in/out',
    icon: IconCamera,
  },
  {
    id: 'worker-enrollment',
    code: 'MF01',
    label: 'Worker Biometrics',
    subLabel: '3-Angle Face Enrollment',
    description: 'Guided capture workflow to register and encrypt 3D worker facial profiles',
    icon: IconUsers,
  },
  {
    id: 'gate-permissions',
    code: 'RBAC',
    label: 'Gate Permissions',
    subLabel: 'Per-Gate Clearance Rules',
    description: 'Assign and revoke gate access permissions for enrolled site workers',
    icon: IconShield,
  },
  {
    id: 'visitor-passes',
    code: 'MF04 QR',
    label: 'Visitor Passes',
    subLabel: 'Issue & Scan Dynamic QR',
    description: 'Issue and verify time-limited visitor credentials strictly through dynamic QR',
    icon: IconKey,
  },
] as const;

export function AccessControlView({ apiUrl }: { apiUrl: string }) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const queryClient = useQueryClient();
  const activeSession = useRef<{ token: string; userId: string } | null>(null);
  const lifecycleGeneration = useRef(0);
  const [session, setSession] = useState<LoginResponse | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [requestedSiteId, setRequestedSiteId] = useState('');
  const [accessSubTab, setAccessSubTab] = useState<AccessSubTab>('gate-desk');

  const removeSessionQueries = useCallback(
    (userId: string) => {
      queryClient.removeQueries({ queryKey: ['access-control', apiUrl, userId] });
    },
    [apiUrl, queryClient],
  );

  const login = useMutation({
    mutationFn: async () => {
      const generation = lifecycleGeneration.current;
      const result = await client.login(username, password);
      if (
        !result.user.roleAssignments.some(
          (role) => role.role === 'ADMIN' && role.siteId === null,
        ) ||
        result.user.mustChangePassword
      ) {
        await client.logout('WEB').catch(() => undefined);
        throw new Error('Use an active Admin account with its permanent password.');
      }
      if (generation !== lifecycleGeneration.current) {
        await client.logout('WEB').catch(() => undefined);
        throw new Error('The sign-in request was cancelled.');
      }
      activeSession.current = { token: result.accessToken, userId: result.user.id };
      setSession(result);
      setPassword('');
    },
  });

  useEffect(() => {
    lifecycleGeneration.current += 1;
    return () => {
      lifecycleGeneration.current += 1;
      const current = activeSession.current;
      activeSession.current = null;
      if (!current) return;
      removeSessionQueries(current.userId);
      void client.logout('WEB').catch(() => undefined);
    };
  }, [client, removeSessionQueries]);

  const token = session?.accessToken ?? '';
  const sessionScope = session?.user.id ?? '';

  const sites = useQuery({
    queryKey: ['access-control', apiUrl, sessionScope, 'sites'],
    queryFn: () => client.listSites(token, { limit: 100 }),
    enabled: !!token,
  });

  const siteId = sites.data?.items.some((site) => site.id === requestedSiteId)
    ? requestedSiteId
    : (sites.data?.items[0]?.id ?? '');

  const activeSiteName = sites.data?.items.find((site) => site.id === siteId)?.name ?? 'Site';

  const logout = () => {
    const current = activeSession.current;
    lifecycleGeneration.current += 1;
    activeSession.current = null;
    setSession(null);
    setRequestedSiteId('');
    setAccessSubTab('gate-desk');
    if (current) {
      removeSessionQueries(current.userId);
      void client.logout('WEB').catch(() => undefined);
    }
  };

  const submitLogin = (event: FormEvent) => {
    event.preventDefault();
    login.mutate();
  };

  if (!session)
    return (
      <div className="flex min-h-[70vh] items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200/90 bg-white p-8 shadow-xl space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-[#F66B17] shadow-inner ring-1 ring-orange-500/20">
              <IconShield className="h-7 w-7" />
            </div>
            <div className="pt-2">
              <span className="rounded-full bg-orange-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-orange-700 ring-1 ring-orange-500/20">
                Security & Identity Portal
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Site access & identity control
            </h1>
            <p className="text-xs text-slate-500 leading-relaxed">
              Sign in as Admin to manage face enrollment and worker gate permissions.
            </p>
          </div>

          <form onSubmit={submitLogin} className="space-y-4 pt-1">
            <div>
              <label htmlFor="login-username" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Username
              </label>
              <div className="relative mt-1.5">
                <IconUser className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="login-username"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Enter Admin username"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#F66B17] focus:bg-white focus:ring-2 focus:ring-[#F66B17]/15 focus:outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Password
              </label>
              <div className="relative mt-1.5">
                <IconKey className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="login-password"
                  required
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#F66B17] focus:bg-white focus:ring-2 focus:ring-[#F66B17]/15 focus:outline-none transition-all"
                />
              </div>
            </div>

            {login.error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700"
              >
                <IconAlertTriangle className="h-4 w-4 shrink-0" />
                <span>{login.error.message}</span>
              </div>
            )}

            <button
              disabled={login.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#F66B17] py-3 text-sm font-bold text-white shadow-md shadow-orange-500/15 transition-all hover:bg-[#e05b0d] hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {login.isPending ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Signing in…</span>
                </>
              ) : (
                <>
                  <IconShield className="h-4 w-4" />
                  <span>Open access control</span>
                </>
              )}
            </button>
          </form>

          <div className="pt-2 text-center border-t border-slate-100">
            <p className="text-[11px] text-slate-400">
              SmartSite Enterprise Safety & Access Control • Authenticated Session
            </p>
          </div>
        </div>
      </div>
    );

  return (
    <div className="mx-auto max-w-[1360px] space-y-5 pb-12 text-[#182232]">
      {/* Top Banner / Identity Header */}
      <header className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-gradient-to-r from-white via-slate-50/60 to-orange-50/30 p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100/90 px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider text-orange-800 ring-1 ring-orange-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-[#F66B17] animate-pulse" />
                Access & Identity System
              </span>
              <span className="hidden sm:inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                Security Portal
              </span>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
              Site Access & Biometric Identity Control
            </h1>
            <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
              Manage gate security desks, register 3D worker facial profiles, assign physical gate permissions, and verify visitor QR credentials.
            </p>
          </div>

          {/* User Profile Chip & Session Actions */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 rounded-xl border border-slate-200/90 bg-white/90 px-3.5 py-2 shadow-2xs">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-orange-600 to-amber-500 text-xs font-bold text-white shadow-xs">
                {session.user.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div className="text-left">
                <span className="block text-xs font-bold text-slate-800 leading-tight">
                  {session.user.displayName}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 uppercase">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Global Admin
                </span>
              </div>
            </div>
            <button
              onClick={logout}
              type="button"
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-600 transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-700 shadow-2xs"
            >
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Modern 4-Tab Card Navigation Grid */}
      <nav
        aria-label="Access control tabs"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
      >
        {ACCESS_TABS.map((tab) => {
          const isActive = accessSubTab === tab.id;
          const TabIcon = tab.icon;
          return (
            <button
              type="button"
              key={tab.id}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => setAccessSubTab(tab.id)}
              className={`group relative flex flex-col justify-between rounded-2xl border p-4 text-left transition-all duration-200 ${
                isActive
                  ? 'border-[#F66B17] bg-white ring-2 ring-[#F66B17]/20 shadow-md shadow-orange-500/10'
                  : 'border-slate-200/90 bg-white/70 hover:bg-white hover:border-slate-300 hover:shadow-2xs'
              }`}
            >
              {/* Top Row: Icon + Module Code Badge */}
              <div className="flex items-center justify-between w-full">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                    isActive
                      ? 'bg-[#F66B17] text-white shadow-xs'
                      : 'bg-slate-100 text-slate-500 group-hover:bg-orange-50 group-hover:text-[#F66B17]'
                  }`}
                >
                  <TabIcon className="h-5 w-5" />
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                    isActive
                      ? 'bg-orange-100 text-[#F66B17] ring-1 ring-orange-500/30'
                      : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200/80 group-hover:text-slate-700'
                  }`}
                >
                  {tab.code}
                </span>
              </div>

              {/* Bottom Content: Labels */}
              <div className="mt-3.5">
                <h3
                  className={`text-sm font-bold tracking-tight transition-colors ${
                    isActive ? 'text-slate-900' : 'text-slate-700 group-hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </h3>
                <p
                  className={`mt-0.5 text-xs line-clamp-1 transition-colors ${
                    isActive ? 'font-medium text-orange-800/80' : 'text-slate-500'
                  }`}
                >
                  {tab.subLabel}
                </p>
              </div>

              {/* Active Bottom Indicator Accent */}
              {isActive && (
                <div className="absolute inset-x-4 -bottom-px h-0.5 rounded-full bg-[#F66B17]" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Unified Global Site Selector Strip */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-[#F66B17]">
            <IconBuilding2 className="h-4 w-4" />
          </div>
          <div>
            <label
              htmlFor="access-site-select"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
            >
              Active Managed Site:
            </label>
            <select
              id="access-site-select"
              value={siteId}
              onChange={(event) => setRequestedSiteId(event.target.value)}
              className="mt-0.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-1 text-xs font-bold text-slate-800 focus:border-[#F66B17] focus:bg-white focus:ring-2 focus:ring-[#F66B17]/15 focus:outline-none"
            >
              {sites.data?.items.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Status Indicators & Refresh */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-200/80 px-3 py-1.5 text-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-slate-700">
              Site: <span className="font-bold text-slate-900">{activeSiteName}</span>
            </span>
          </div>

          <button
            type="button"
            onClick={() => void sites.refetch()}
            title="Reload sites list"
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 shadow-2xs"
          >
            <IconRefresh className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Refresh</span>
          </button>
        </div>
      </section>

      {/* Global State Notifications */}
      {sites.isPending && (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#F66B17] border-t-transparent" />
          <span>Loading construction sites…</span>
        </div>
      )}

      {sites.error && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700"
        >
          <span>{sites.error.message}</span>
          <button
            onClick={() => void sites.refetch()}
            className="flex items-center gap-1 font-bold underline hover:text-red-900"
          >
            <IconRefresh className="h-3.5 w-3.5" />
            <span>Try again</span>
          </button>
        </div>
      )}

      {!sites.isPending && !sites.error && !sites.data?.items.length && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
          No construction sites currently configured on the system.
        </div>
      )}

      {/* Active Tab Viewport */}
      {siteId && (
        <div className="transition-all duration-150">
          {accessSubTab === 'gate-desk' && (
            <SecurityGateDeskView
              key={`${sessionScope}:${siteId}`}
              apiUrl={apiUrl}
              token={token}
              sessionScope={sessionScope}
              selectedSiteId={siteId}
              sites={sites.data?.items ?? []}
              onSelectSite={setRequestedSiteId}
            />
          )}

          {accessSubTab === 'worker-enrollment' && (
            <WorkerEnrollmentView
              key={`${sessionScope}:${siteId}`}
              apiUrl={apiUrl}
              token={token}
              sessionScope={sessionScope}
              siteId={siteId}
            />
          )}

          {accessSubTab === 'gate-permissions' && (
            <WorkerGatePermissionsView
              key={`${sessionScope}:${siteId}`}
              apiUrl={apiUrl}
              token={token}
              sessionScope={sessionScope}
              siteId={siteId}
            />
          )}

          {accessSubTab === 'visitor-passes' && (
            <VisitorAccessView
              apiUrl={apiUrl}
              siteId={siteId}
              siteName={sites.data?.items.find((site) => site.id === siteId)?.name}
            />
          )}
        </div>
      )}
    </div>
  );
}
