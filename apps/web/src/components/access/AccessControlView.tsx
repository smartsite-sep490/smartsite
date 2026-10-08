import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import {
  IconAlertTriangle,
  IconBuilding2,
  IconCamera,
  IconKey,
  IconRefresh,
  IconShield,
  IconUsers,
} from '../icons';
import { SecurityGateDeskView } from './SecurityGateDeskView';
import { WorkerEnrollmentView } from './WorkerEnrollmentView';
import { VisitorAccessView } from './VisitorAccessView';
import { WorkerGatePermissionsView } from './WorkerGatePermissionsView';
import { SiteAccessSetupView } from './SiteAccessSetupView';
import { ZoneDecisionHistory } from './ZoneDecisionHistory';
import { WorkerMobileQrView } from './WorkerMobileQrView';
import { AttendanceView } from './AttendanceView';
import { useAuth, useCurrentUser, useLogout } from '../../features/auth/auth-session';

type AccessSubTab =
  | 'zone-permissions'
  | 'gate-desk'
  | 'worker-enrollment'
  | 'gate-permissions'
  | 'visitor-passes'
  | 'worker-qr';

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
    id: 'worker-qr',
    code: 'MF02 QR',
    label: 'My QR Pass',
    subLabel: 'Worker QR Fallback',
    description: 'Dynamic QR pass for an authorized gate fallback session',
    icon: IconKey,
  },
  {
    id: 'zone-permissions',
    code: 'MF06',
    label: 'Zone Permissions',
    subLabel: 'Zone Grants & AI Audit',
    description:
      'Manage worker zone access grants and audit AI-assisted restricted zone entry decisions',
    icon: IconShield,
  },
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
    description: 'Guided capture workflow for multi-angle face enrollment and template encryption',
    icon: IconUsers,
  },
  {
    id: 'gate-permissions',
    code: 'RBAC',
    label: 'Gate Permissions',
    subLabel: 'Per-Gate Clearance Rules',
    description: 'Assign and revoke perimeter gate access permissions for enrolled site workers',
    icon: IconKey,
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

export interface AccessControlViewProps {
  apiUrl: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

export function AccessControlView({ apiUrl }: AccessControlViewProps) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const currentUserQuery = useCurrentUser(apiUrl);
  const logoutMutation = useLogout(apiUrl);
  const [requestedSiteId, setRequestedSiteId] = useState('');
  const [accessSubTab, setAccessSubTab] = useState<AccessSubTab>('zone-permissions');

  const removeSessionQueries = useCallback(
    (userId: string) => {
      queryClient.removeQueries({ queryKey: ['access-control', apiUrl, userId] });
      queryClient.removeQueries({ queryKey: ['gate-access-logs', apiUrl, userId] });
    },
    [apiUrl, queryClient],
  );

  // Site Access uses the authenticated app session. It must not create a second
  // login session or log the shared session out when this view unmounts.
  const currentUser = currentUserQuery.data;
  const token = accessToken ?? '';
  const sessionScope = currentUser?.id ?? '';
  const isGlobalAdmin = currentUser?.roleAssignments.some(
    (role) => role.role === 'ADMIN' && role.siteId === null,
  );

  const sites = useQuery({
    queryKey: ['access-control', apiUrl, sessionScope, 'sites'],
    queryFn: () => client.listSites(token, { limit: 100 }),
    enabled: !!token,
  });

  const siteId = sites.data?.items.some((site) => site.id === requestedSiteId)
    ? requestedSiteId
    : (sites.data?.items[0]?.id ?? '');

  const activeSiteName = sites.data?.items.find((site) => site.id === siteId)?.name ?? 'Site';
  const siteRoles =
    currentUser?.roleAssignments.filter((r) => r.siteId === siteId).map((r) => r.role) ?? [];
  const visibleTabs = ACCESS_TABS.filter((tab) =>
    tab.id === 'worker-qr'
      ? siteRoles.includes('WORKER')
      : tab.id === 'worker-enrollment'
        ? isGlobalAdmin ||
          siteRoles.includes('CONTRACTOR_REPRESENTATIVE') ||
          siteRoles.includes('WORKER')
        : tab.id === 'gate-permissions'
          ? isGlobalAdmin || siteRoles.includes('SITE_MANAGER')
          : tab.id === 'zone-permissions'
            ? isGlobalAdmin ||
              siteRoles.includes('SITE_MANAGER') ||
              siteRoles.includes('CONTRACTOR_REPRESENTATIVE')
            : isGlobalAdmin ||
              siteRoles.some((r) =>
                ['SITE_MANAGER', 'SECURITY_OFFICER', 'SAFETY_OFFICER'].includes(r),
              ),
  );
  const activeTab = visibleTabs.some((t) => t.id === accessSubTab)
    ? accessSubTab
    : siteRoles.includes('WORKER') && !isGlobalAdmin
      ? 'worker-qr'
      : siteRoles.includes('SITE_MANAGER')
        ? 'visitor-passes'
        : visibleTabs[0]?.id;

  const logout = () => {
    setRequestedSiteId('');
    setAccessSubTab('zone-permissions');
    if (sessionScope) removeSessionQueries(sessionScope);
    logoutMutation.mutate();
  };

  if (!accessToken || currentUserQuery.isPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="flex items-center gap-2 rounded-xl border border-[#EAEAEA] bg-white p-5 text-xs text-[#6B6B6B] shadow-xs">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#F66B17] border-t-transparent" />
          <span>Restoring your authenticated session…</span>
        </div>
      </div>
    );
  }

  if (currentUserQuery.isError) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div
          role="alert"
          className="flex max-w-md items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-5 text-xs font-semibold text-red-700"
        >
          <IconAlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMessage(currentUserQuery.error)}</span>
        </div>
      </div>
    );
  }

  if (
    !currentUser ||
    !currentUser.isActive ||
    (!isGlobalAdmin &&
      !currentUser.roleAssignments.some((r) =>
        [
          'SITE_MANAGER',
          'SECURITY_OFFICER',
          'SAFETY_OFFICER',
          'WORKER',
          'CONTRACTOR_REPRESENTATIVE',
        ].includes(r.role),
      )) ||
    currentUser.mustChangePassword
  ) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div
          role="alert"
          className="w-full max-w-md space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-6 text-center shadow-xs"
        >
          <IconShield className="mx-auto h-8 w-8 text-amber-600" />
          <h1 className="text-lg font-bold text-[#2F3437]">Site Access is restricted</h1>
          <p className="text-xs leading-relaxed text-amber-900">
            An active Site staff, Contractor Representative, Worker or Admin account with a
            permanent password is required.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1360px] space-y-5 pb-12 text-[#182232]">
      {/* Top Banner / Identity Header */}
      <header className="rounded-xl border border-[#EAEAEA] bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#F66B17] border border-orange-200/60">
                <span className="h-1.5 w-1.5 rounded-full bg-[#F66B17]" />
                Access & Identity System
              </span>
              <span className="hidden sm:inline-block rounded-full bg-[#F7F6F3] border border-[#EAEAEA] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">
                Security Portal
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[#111111]">
              Site Access & Biometric Identity Control
            </h1>
            <p className="text-xs text-[#6B6B6B] max-w-2xl leading-relaxed">
              Manage gate security desks, register multi-angle worker facial profiles, assign
              physical gate permissions, and verify visitor QR credentials.
            </p>
          </div>

          {/* User Profile Chip & Session Actions */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 rounded-lg border border-[#EAEAEA] bg-[#FBFBFA] px-3.5 py-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#111111] text-xs font-bold text-white">
                {currentUser.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div className="text-left">
                <span className="block text-xs font-bold text-[#2F3437] leading-tight">
                  {currentUser.displayName}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 uppercase">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                  {isGlobalAdmin ? 'Global Admin' : siteRoles.join(' · ')}
                </span>
              </div>
            </div>
            <button
              onClick={logout}
              type="button"
              disabled={logoutMutation.isPending}
              className="flex items-center gap-1.5 rounded-lg border border-[#EAEAEA] bg-white px-3.5 py-2 text-xs font-bold text-[#2F3437] transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700"
            >
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Modern Sub-Navigation Tabs */}
      <nav
        aria-label="Access control tabs"
        className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 ${
          visibleTabs.length >= 6
            ? 'lg:grid-cols-6'
            : visibleTabs.length === 5
              ? 'lg:grid-cols-5'
              : visibleTabs.length === 4
                ? 'lg:grid-cols-4'
                : 'lg:grid-cols-3'
        } gap-3`}
      >
        {visibleTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const TabIcon = tab.icon;
          return (
            <button
              type="button"
              key={tab.id}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => setAccessSubTab(tab.id)}
              className={`group relative flex flex-col justify-between rounded-xl border p-4 text-left transition-all duration-150 ${
                isActive
                  ? 'border-[#F66B17] bg-white ring-1 ring-[#F66B17]/20 shadow-xs'
                  : 'border-[#EAEAEA] bg-white hover:bg-[#FBFBFA] hover:border-[#D0D0CE]'
              }`}
            >
              {/* Top Row: Icon + Module Code Badge */}
              <div className="flex items-center justify-between w-full">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                    isActive ? 'bg-orange-50 text-[#F66B17]' : 'bg-[#F7F6F3] text-[#6B6B6B]'
                  }`}
                >
                  <TabIcon className="h-5 w-5" />
                </div>
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                    isActive
                      ? 'bg-orange-50 text-[#F66B17] border border-orange-200/80'
                      : 'bg-[#F7F6F3] text-[#6B6B6B] border border-[#EAEAEA]'
                  }`}
                >
                  {tab.code}
                </span>
              </div>

              {/* Bottom Content: Labels */}
              <div className="mt-3.5">
                <h3
                  className={`text-sm font-bold tracking-tight transition-colors ${
                    isActive ? 'text-[#111111]' : 'text-[#2F3437] group-hover:text-[#111111]'
                  }`}
                >
                  {tab.label}
                </h3>
                <p
                  className={`mt-0.5 text-xs line-clamp-1 transition-colors ${
                    isActive ? 'font-medium text-[#F66B17]' : 'text-[#6B6B6B]'
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
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#EAEAEA] bg-white p-3.5 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-[#F66B17] border border-orange-200/60">
            <IconBuilding2 className="h-4 w-4" />
          </div>
          <div>
            <label
              htmlFor="access-site-select"
              className="block text-[10px] font-bold uppercase tracking-wider text-[#6B6B6B]"
            >
              Active Managed Site:
            </label>
            <select
              id="access-site-select"
              value={siteId}
              onChange={(event) => setRequestedSiteId(event.target.value)}
              className="mt-0.5 rounded-lg border border-[#EAEAEA] bg-white px-2.5 py-1 text-xs font-bold text-[#2F3437] focus:border-[#F66B17] focus:ring-2 focus:ring-orange-100 focus:outline-none"
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
          <div className="hidden sm:flex items-center gap-2 rounded-lg bg-[#F7F6F3] border border-[#EAEAEA] px-3 py-1.5 text-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
            <span className="font-semibold text-[#6B6B6B]">
              Site: <span className="font-bold text-[#2F3437]">{activeSiteName}</span>
            </span>
          </div>

          <button
            type="button"
            onClick={() => void sites.refetch()}
            title="Reload sites list"
            className="flex items-center gap-1.5 rounded-lg border border-[#EAEAEA] bg-white px-3 py-1.5 text-xs font-semibold text-[#2F3437] hover:bg-[#FBFBFA] transition-colors"
          >
            <IconRefresh className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Refresh</span>
          </button>
        </div>
      </section>

      {/* Global State Notifications */}
      {sites.isPending && (
        <div className="flex items-center gap-2 rounded-xl border border-[#EAEAEA] bg-white p-4 text-xs text-[#6B6B6B]">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#F66B17] border-t-transparent" />
          <span>Loading construction sites…</span>
        </div>
      )}

      {sites.error && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700"
        >
          <span>{errorMessage(sites.error)}</span>
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
        <div className="rounded-xl border border-[#EAEAEA] bg-white p-8 text-center text-xs text-[#6B6B6B]">
          No construction sites currently configured on the system.
        </div>
      )}

      {/* Active Tab Viewport */}
      {siteId && (
        <div className="transition-all duration-150">
          {activeTab === 'zone-permissions' && (
            <div className="space-y-6">
              <SiteAccessSetupView
                key={`${sessionScope}:${siteId}`}
                apiUrl={apiUrl}
                token={token}
                siteId={siteId}
                sessionScope={sessionScope}
              />
              {isGlobalAdmin && (
                <ZoneDecisionHistory
                  apiUrl={apiUrl}
                  token={token}
                  siteId={siteId}
                  sessionScope={sessionScope}
                />
              )}
            </div>
          )}

          {activeTab === 'gate-desk' && (
            <SecurityGateDeskView
              canManualVerify={siteRoles.includes('SECURITY_OFFICER')}
              key={`${sessionScope}:${siteId}`}
              apiUrl={apiUrl}
              token={token}
              sessionScope={sessionScope}
              selectedSiteId={siteId}
              sites={sites.data?.items ?? []}
              onSelectSite={setRequestedSiteId}
            />
          )}

          {activeTab === 'worker-enrollment' && (
            <WorkerEnrollmentView
              canManageAccounts={!!isGlobalAdmin}
              key={`${sessionScope}:${siteId}`}
              apiUrl={apiUrl}
              token={token}
              sessionScope={sessionScope}
              siteId={siteId}
            />
          )}

          {activeTab === 'gate-permissions' && (
            <WorkerGatePermissionsView
              key={`${sessionScope}:${siteId}`}
              apiUrl={apiUrl}
              token={token}
              sessionScope={sessionScope}
              siteId={siteId}
            />
          )}

          {activeTab === 'worker-qr' && (
            <div className="space-y-6">
              <WorkerMobileQrView
                key={`${sessionScope}:${siteId}`}
                apiUrl={apiUrl}
                token={token}
                siteId={siteId}
                workerName={currentUser.displayName}
              />
              <AttendanceView
                apiUrl={apiUrl}
                token={token}
                siteId={siteId}
                sessionScope={sessionScope}
              />
            </div>
          )}
          {activeTab === 'visitor-passes' && (
            <VisitorAccessView
              canManualCheckout={siteRoles.includes('SECURITY_OFFICER')}
              key={`${sessionScope}:${siteId}`}
              token={token}
              sessionScope={sessionScope}
              canApprove={siteRoles.includes('SITE_MANAGER')}
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
