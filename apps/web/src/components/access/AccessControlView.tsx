import { SmartNativeSelect } from '../ui/SmartNativeSelect';
import { loadAllPages } from '../workforce/load-all-pages';
import { userErrorMessage } from '../../i18n/messages';
import { translate as tr } from '../../i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  IconAlertTriangle,
  IconBuilding2,
  IconCamera,
  IconKey,
  IconRefresh,
  IconShield,
  IconUsers,
} from '../icons';
import { GateObservationView } from './GateObservationView';
import { SecurityGateDeskView } from './gate/SecurityGateDeskView';
import { VisitorAccessView } from './visitor/VisitorAccessView';
import { SiteAccessSetupView } from './permissions/SiteAccessSetupView';
import { WorkerMobileQrView } from './gate/WorkerMobileQrView';
import { AttendanceView } from './attendance/AttendanceView';
import { useManagementClient, useAuth, useCurrentUser } from '../../features/auth/auth-session';
import { isSecurityWorkspaceOnly } from '../../features/auth/workspace-access';
import { useTranslation } from 'react-i18next';

type AccessSubTab =
  | 'attendance'
  | 'zone-permissions'
  | 'gate-desk'
  | 'visitor-passes'
  | 'visitor-gate'
  | 'gate-observation'
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
    id: 'attendance',
    code: 'Timesheet',
    label: 'Attendance',
    subLabel: 'Hours & approvals',
    description: 'Daily work hours, overtime, leave and attendance corrections',
    icon: IconUsers,
  },
  {
    id: 'worker-qr',
    code: 'QR',
    label: 'My QR Pass',
    subLabel: 'Worker QR Fallback',
    description: 'Dynamic QR pass for an authorized gate fallback session',
    icon: IconKey,
  },
  {
    id: 'zone-permissions',
    code: 'Audit',
    label: 'Zone Permissions',
    subLabel: 'Zone Grants & AI Audit',
    description:
      'Manage worker zone access grants and audit AI-assisted restricted zone entry decisions',
    icon: IconShield,
  },
  {
    id: 'gate-desk',
    code: 'Gate',
    label: 'Security Gate Desk',
    subLabel: 'Face & Dynamic QR Scan',
    description:
      'Physical gate security desk for real-time facial verification and check-in/out of workers',
    icon: IconCamera,
  },
  {
    id: 'gate-observation',
    code: 'Logs',
    label: 'Worker Gate Logs',
    subLabel: 'Read-only gate history',
    description: 'Observe worker verification events at site gates',
    icon: IconCamera,
  },
  {
    id: 'visitor-gate',
    code: 'Gate Desk',
    label: 'Visitor Check-in',
    subLabel: 'Scan QR at gate',
    description: 'Security officer verifies arriving visitors',
    icon: IconKey,
  },
  {
    id: 'visitor-passes',
    code: 'Visitors',
    label: 'Visitor Passes',
    subLabel: 'Requests & Approvals',
    description:
      'Issue, approve and verify time-limited visitor credentials strictly through dynamic QR',
    icon: IconKey,
  },
] as const;

export interface AccessControlViewProps {
  apiUrl: string;
}

function errorMessage(error: unknown): string {
  return userErrorMessage(error);
}

export function AccessControlView({ apiUrl }: AccessControlViewProps) {
  const { t } = useTranslation();
  const client = useManagementClient(apiUrl);
  const { accessToken } = useAuth();
  const currentUserQuery = useCurrentUser(apiUrl);
  const [requestedSiteId, setRequestedSiteId] = useState(
    () => new URLSearchParams(window.location.search).get('siteId') ?? '',
  );
  const [accessSubTab, setAccessSubTab] = useState<AccessSubTab>(() =>
    new URLSearchParams(window.location.search).get('tab') === 'attendance'
      ? 'attendance'
      : 'zone-permissions',
  );

  // Site Access uses the authenticated app session. It must not create a second
  // login session or log the shared session out when this view unmounts.
  const currentUser = currentUserQuery.data;
  const securityOnly = isSecurityWorkspaceOnly(currentUser?.roleAssignments ?? []);
  const token = accessToken ?? '';
  const sessionScope = currentUser?.id ?? '';

  const sites = useQuery({
    queryKey: ['access-control', apiUrl, sessionScope, 'sites'],
    queryFn: ({ signal }) =>
      loadAllPages((options) => client.listSites(token, options, { signal }), signal),
    enabled: !!token,
  });

  const scopedSites =
    sites.data?.items.filter((site) =>
      currentUser?.roleAssignments.some(
        (r) =>
          r.siteId === site.id &&
          ['SITE_MANAGER', 'SECURITY_OFFICER', 'CONTRACTOR_REPRESENTATIVE', 'WORKER'].includes(
            r.role,
          ),
      ),
    ) ?? [];
  const siteId = scopedSites.some((site) => site.id === requestedSiteId)
    ? requestedSiteId
    : (scopedSites[0]?.id ?? '');

  const activeSiteName = scopedSites.find((site) => site.id === siteId)?.name ?? tr('common.site');
  const siteRoles =
    currentUser?.roleAssignments.filter((r) => r.siteId === siteId).map((r) => r.role) ?? [];
  const visibleTabs = ACCESS_TABS.filter((tab) => {
    if (tab.id === 'attendance')
      return siteRoles.some((r) =>
        ['SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE', 'WORKER'].includes(r),
      );
    if (tab.id === 'worker-qr') {
      return siteRoles.includes('WORKER');
    }
    if (tab.id === 'zone-permissions') {
      return false;
    }
    if (tab.id === 'gate-desk') {
      return siteRoles.includes('SECURITY_OFFICER');
    }
    if (tab.id === 'gate-observation') return siteRoles.includes('SITE_MANAGER');
    if (tab.id === 'visitor-gate') return siteRoles.includes('SECURITY_OFFICER');
    if (tab.id === 'visitor-passes') return siteRoles.includes('SITE_MANAGER');
    return false;
  }).map((tab) => ({
    ...tab,
    code: t(`access.tabs.${tab.id}.code`),
    label: securityOnly
      ? t(tab.id === 'gate-desk' ? 'security.workers' : 'security.visitors')
      : t(`access.tabs.${tab.id}.label`),
    subLabel: securityOnly
      ? t(tab.id === 'gate-desk' ? 'security.workerSubtitle' : 'security.visitorSubtitle')
      : t(`access.tabs.${tab.id}.subLabel`),
    description: t(`access.tabs.${tab.id}.description`),
  }));
  const activeTab = visibleTabs.some((t) => t.id === accessSubTab)
    ? accessSubTab
    : siteRoles.includes('WORKER')
      ? 'worker-qr'
      : siteRoles.includes('SECURITY_OFFICER')
        ? 'gate-desk'
        : visibleTabs[0]?.id;
  const attendanceWorkspace =
    !securityOnly &&
    siteRoles.some((role) => ['SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE'].includes(role));

  if (!accessToken || currentUserQuery.isPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="flex items-center gap-2 rounded-xl border border-[#EAEAEA] bg-white p-5 text-xs text-[#6B6B6B] shadow-xs">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#F66B17] border-t-transparent" />
          <span>{t('access.sessionRestoring')}</span>
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
    !currentUser.roleAssignments.some((r) =>
      [
        'SITE_MANAGER',
        'SECURITY_OFFICER',
        'SAFETY_OFFICER',
        'WORKER',
        'CONTRACTOR_REPRESENTATIVE',
      ].includes(r.role),
    ) ||
    currentUser.mustChangePassword
  ) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div
          role="alert"
          className="w-full max-w-md space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-6 text-center shadow-xs"
        >
          <IconShield className="mx-auto h-8 w-8 text-amber-600" />
          <h1 className="text-lg font-bold text-[#2F3437]">{t('access.restricted')}</h1>
          <p className="text-xs leading-relaxed text-amber-900">{t('access.restrictedDesc')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1360px] space-y-5 pb-12 text-[#182232]">
      {/* Modern Sub-Navigation Tabs */}
      {!(attendanceWorkspace && visibleTabs.length === 1) && (
        <nav
          aria-label={tr('common.access_control_tabs')}
          className={
            securityOnly
              ? 'grid grid-cols-1 gap-3 sm:grid-cols-2'
              : `grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 ${
                  visibleTabs.length >= 6
                    ? 'lg:grid-cols-6'
                    : visibleTabs.length === 5
                      ? 'lg:grid-cols-5'
                      : visibleTabs.length === 4
                        ? 'lg:grid-cols-4'
                        : 'lg:grid-cols-3'
                } gap-3`
          }
        >
          {visibleTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const TabIcon = tab.icon;
            return (
              <button
                type="button"
                key={tab.id}
                data-testid={`access-tab-${tab.id}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setAccessSubTab(tab.id)}
                className={`group relative flex flex-col justify-between rounded-xl p-4 text-left transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F66B17] ${
                  isActive
                    ? 'border border-[#F66B17] bg-white ring-1 ring-[#F66B17]/20 shadow-xs'
                    : 'border border-[#EAEAEA] bg-white hover:bg-[#FBFBFA] hover:border-[#D0D0CE]'
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
                  {!securityOnly && (
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                        isActive
                          ? 'bg-orange-50 text-[#F66B17] border border-orange-200/80'
                          : 'bg-[#F7F6F3] text-[#6B6B6B] border border-[#EAEAEA]'
                      }`}
                    >
                      {tab.code}
                    </span>
                  )}
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
      )}

      {/* Unified Global Site Selector Strip (hidden on gate-desk since SecurityGateDeskView owns site/gate selector) */}
      {activeTab !== 'gate-desk' && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#EAEAEA] bg-white p-3.5 shadow-xs">
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-[#F66B17] border border-orange-200/60">
              <IconBuilding2 className="h-4 w-4" />
            </div>
            <div className="min-w-0 max-w-full">
              <label
                htmlFor="access-site-select"
                className="block text-[10px] font-bold uppercase tracking-wider text-[#6B6B6B]"
              >
                {tr('common.active_managed_site')}
              </label>
              <SmartNativeSelect
                id="access-site-select"
                value={siteId}
                onChange={(event) => setRequestedSiteId(event.target.value)}
                className="mt-0.5 min-w-0 max-w-full rounded-lg border border-[#EAEAEA] bg-white px-2.5 py-1 text-xs font-bold text-[#2F3437] focus:border-[#F66B17] focus:ring-2 focus:ring-orange-100 focus:outline-none"
              >
                {scopedSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </SmartNativeSelect>
            </div>
          </div>

          {/* Status Indicators & Refresh */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 rounded-lg bg-[#F7F6F3] border border-[#EAEAEA] px-3 py-1.5 text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-600" />
              <span className="font-semibold text-[#6B6B6B]">
                {tr('common.site')}
                <span className="font-bold text-[#2F3437]">{activeSiteName}</span>
              </span>
            </div>

            <button
              type="button"
              onClick={() => void sites.refetch()}
              title={tr('common.reload_sites_list')}
              className="flex items-center gap-1.5 rounded-lg border border-[#EAEAEA] bg-white px-3 py-1.5 text-xs font-semibold text-[#2F3437] hover:bg-[#FBFBFA] transition-colors"
            >
              <IconRefresh className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{tr('accounts.refresh')}</span>
            </button>
          </div>
        </section>
      )}

      {/* Global State Notifications */}
      {sites.isPending && (
        <div className="flex items-center gap-2 rounded-xl border border-[#EAEAEA] bg-white p-4 text-xs text-[#6B6B6B]">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#F66B17] border-t-transparent" />
          <span>{tr('common.loading_construction_sites')}</span>
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
            <span>{tr('accounts.retry')}</span>
          </button>
        </div>
      )}

      {!sites.isPending && !sites.error && !scopedSites.length && (
        <div className="rounded-xl border border-[#EAEAEA] bg-white p-8 text-center text-xs text-[#6B6B6B]">
          {tr('access_control_view.no_construction_sites_currently_configured_on_the_system')}
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
            </div>
          )}

          {activeTab === 'gate-desk' && (
            <SecurityGateDeskView
              isSecurityOfficer={siteRoles.includes('SECURITY_OFFICER')}
              key={`${sessionScope}:${siteId}`}
              apiUrl={apiUrl}
              token={token}
              sessionScope={sessionScope}
              selectedSiteId={siteId}
              sites={scopedSites ?? []}
              onSelectSite={setRequestedSiteId}
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
            </div>
          )}
          {activeTab === 'attendance' && (
            <AttendanceView
              key={`${sessionScope}:${siteId}:attendance`}
              apiUrl={apiUrl}
              token={token}
              siteId={siteId}
              sessionScope={sessionScope}
              canExport={siteRoles.some((role) =>
                ['SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE'].includes(role),
              )}
              showRequests={
                !siteRoles.includes('SITE_MANAGER') ||
                siteRoles.includes('CONTRACTOR_REPRESENTATIVE')
              }
              isWorker={
                siteRoles.includes('WORKER') &&
                !siteRoles.some((r) => ['SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE'].includes(r))
              }
            />
          )}
          {activeTab === 'gate-observation' && (
            <GateObservationView
              apiUrl={apiUrl}
              token={token}
              siteId={siteId}
              sessionScope={sessionScope}
            />
          )}
          {(activeTab === 'visitor-passes' || activeTab === 'visitor-gate') && (
            <VisitorAccessView
              canManualCheckout={
                activeTab === 'visitor-gate' && siteRoles.includes('SECURITY_OFFICER')
              }
              key={`${sessionScope}:${siteId}:${activeTab}`}
              token={token}
              sessionScope={sessionScope}
              canApprove={activeTab === 'visitor-passes' && siteRoles.includes('SITE_MANAGER')}
              apiUrl={apiUrl}
              siteId={siteId}
              siteName={scopedSites.find((site) => site.id === siteId)?.name}
              mode={
                activeTab === 'visitor-gate'
                  ? 'gate'
                  : siteRoles.includes('SITE_MANAGER')
                    ? 'approvals'
                    : 'observer'
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
