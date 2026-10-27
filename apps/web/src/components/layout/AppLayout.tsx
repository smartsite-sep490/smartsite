import { workspaceTabs } from '../../features/auth/workspace-access';
import React, { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCurrentUser, useLogout } from '../../features/auth/auth-session';
import { NotificationBell } from '../../features/notifications/NotificationBell';
import { translate as tr, useLocale } from '../../i18n';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import '../cameras/camera-setup-catalog';
import { getWorkforceTabs } from '../workforce/utils/workforce-tabs';
import {
  IconAlertTriangle,
  IconBuilding,
  IconCalendar,
  IconCamera,
  IconChevronLeft,
  IconChevronRight,
  IconDashboard,
  IconHardHat,
  IconHome,
  IconKey,
  IconLogOut,
  IconShield,
  IconUsers,
} from '../icons';

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export type ActiveTab =
  | 'dashboard'
  | 'contractor-teams'
  | 'assigned-work'
  | 'worker-documents'
  | 'workforce'
  | 'worker-onboarding'
  | 'site-setup'
  | 'schedule-setup'
  | 'access'
  | 'live-monitoring'
  | 'ppe'
  | 'camera-setup'
  | 'zones'
  | 'incidents'
  | 'accounts'
  | 'iot'
  | 'progress'
  | 'landing';

interface AppLayoutProps {
  currentTab?: ActiveTab;
  onSelectTab?: (tab: ActiveTab) => void;
  children: ReactNode;
}

export function AppLayout({ currentTab: propCurrentTab, onSelectTab, children }: AppLayoutProps) {
  useTranslation();
  const { t } = useLocale();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const logoutMutation = useLogout(apiUrl);

  // Determine current active item from URL pathname (e.g. "/workforce" -> "workforce")
  const currentPath = location.pathname.substring(1) || 'dashboard';
  const activeTab = propCurrentTab || (currentPath as ActiveTab);

  const handleNav = (tabId: string) => {
    if (onSelectTab) {
      onSelectTab(tabId as ActiveTab);
    }
    navigate(`/${tabId}`);
  };

  // useCurrentUser calls /auth/me using the live accessToken; works after hard refresh.
  // Fail closed when profile query errors even if TanStack Query retains cached data.
  const { data: profile, isError: profileUnavailable } = useCurrentUser(apiUrl);
  const currentUser = profileUnavailable ? undefined : profile;
  const displayName = currentUser?.username || t('layout.accountFallback');
  const roles: string[] = currentUser?.roleAssignments?.map((r) => r.role) || [];
  const userRole = roles.includes('ADMIN')
    ? t('role.ADMIN')
    : roles.includes('SITE_MANAGER')
      ? t('role.SITE_MANAGER')
      : roles.includes('SAFETY_OFFICER')
        ? t('role.SAFETY_OFFICER')
        : roles.includes('CONTRACTOR_REPRESENTATIVE')
          ? t('role.CONTRACTOR_REPRESENTATIVE')
          : roles.includes('WORKER')
            ? t('role.WORKER')
            : roles.includes('SECURITY_OFFICER')
              ? tr('accounts.role.SECURITY_OFFICER')
              : currentUser
                ? t('role.authenticatedUser')
                : t('role.unverified');
  const userInitials = displayName.slice(0, 2).toUpperCase();

  const allowedTabs = workspaceTabs(currentUser?.roleAssignments ?? []);
  const workerOnly = roles.length === 1 && roles[0] === 'WORKER';
  const attendanceWorkspace =
    !roles.includes('ADMIN') &&
    roles.some((role) => ['SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE'].includes(role));
  const navGroups = [
    {
      label: tr('shell.workspace'),
      items: [
        { id: 'dashboard', label: tr('shell.dashboard'), icon: IconDashboard },
        { id: 'contractor-teams', label: tr('shell.contractorTeams'), icon: IconUsers },
        { id: 'assigned-work', label: tr('shell.assignedWork'), icon: IconUsers },
        { id: 'worker-onboarding', label: tr('shell.workerOnboarding'), icon: IconUsers },
        { id: 'worker-documents', label: tr('documents.title'), icon: IconUsers },
        {
          id: 'workforce',
          label: tr(workerOnly ? 'shell.mySchedule' : 'shell.workforce'),
          icon: IconUsers,
        },
        { id: 'accounts', label: tr('accounts.title'), icon: IconUsers },
        { id: 'site-setup', label: tr('shell.siteSetup'), icon: IconBuilding },
        { id: 'schedule-setup', label: tr('shell.schedule'), icon: IconCalendar },
        {
          id: 'access',
          label: tr(
            workerOnly
              ? 'shell.myQr'
              : attendanceWorkspace
                ? 'access.tabs.attendance.label'
                : 'shell.access',
          ),
          icon: attendanceWorkspace && !workerOnly ? IconCalendar : IconKey,
        },
      ].filter((item) => allowedTabs.includes(item.id)),
    },
    {
      label: tr('shell.safety'),
      items: [
        { id: 'live-monitoring', label: tr('shell.live'), icon: IconCamera },
        { id: 'camera-setup', label: tr('cameraSetup.title', { ns: 'safety' }), icon: IconCamera },
        { id: 'ppe', label: tr('shell.ppe'), icon: IconHardHat },
        { id: 'zones', label: tr('shell.zones'), icon: IconShield },
        { id: 'incidents', label: tr('shell.incidents'), icon: IconAlertTriangle },
      ].filter((item) => allowedTabs.includes(item.id)),
    },
  ].filter((group) => group.items.length > 0);

  const currentItem = navGroups
    .flatMap((group) => group.items)
    .find((item) => item.id === activeTab);
  const searchParams = new URLSearchParams(location.search);
  const selectedSiteId =
    searchParams.get('siteId') ?? currentUser?.roleAssignments.find((r) => r.siteId)?.siteId;
  const workforceRoles = (currentUser?.roleAssignments ?? [])
    .filter((r) => r.siteId === selectedSiteId || (r.role === 'ADMIN' && r.siteId === null))
    .map((r) => r.role);
  const workforceTabs = getWorkforceTabs(workforceRoles);
  const requestedWorkforceTab = searchParams.get('tab');
  const workforceTab =
    requestedWorkforceTab === 'review' && workforceTabs.showReview
      ? 'review'
      : requestedWorkforceTab === 'schedule' && workforceTabs.showSchedule
        ? 'schedule'
        : workforceTabs.defaultTab;
  const pageLabel =
    currentPath === 'account/password'
      ? tr('auth.password.title')
      : activeTab === 'dashboard' && roles.includes('SITE_MANAGER')
        ? tr('common.site_management_overview')
        : (currentItem?.label ?? '');
  const functionLabel =
    activeTab === 'workforce' && (workforceTabs.showReview || workforceTabs.showSchedule)
      ? tr(workforceTab === 'review' ? 'shell.contractorReview' : 'app_layout.my_schedule_requests')
      : '';

  return (
    <div className="min-h-screen bg-[var(--surface-canvas)] text-[var(--text-body)] font-sans flex">
      <a
        href="#smartsite-main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('smartsite-main-content')?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-white focus:px-4 focus:py-3 focus:text-slate-900 focus:shadow-sm"
      >
        {t('layout.skipToMain')}
      </a>
      {/* Left Sidebar: Refined utilitarian charcoal shell */}
      <aside
        className={`${
          isCollapsed ? 'w-16 lg:w-20' : 'w-16 lg:w-64'
        } bg-[#0C1017] text-white flex flex-col justify-between shrink-0 select-none border-r border-[#1E2633] transition-all duration-300 ease-in-out sticky top-0 h-dvh z-30`}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Brand & Collapse/Expand Toggle Header */}
          <div
            className={`p-3 lg:p-4 shrink-0 border-b border-[#1E2633] flex items-center ${
              isCollapsed ? 'flex-col gap-3 justify-center' : 'justify-center lg:justify-between'
            }`}
          >
            {/* Brand Logo Button */}
            <button
              type="button"
              onClick={() => navigate('/')}
              title={tr('common.smartsite_homepage')}
              aria-label={tr('common.smartsite_homepage')}
              className="flex items-center gap-3 cursor-pointer group text-left border-none bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F66B17] rounded-md"
            >
              <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0 shadow-[0_0_20px_rgba(246,107,23,0.25)] transition-transform group-hover:scale-105 border border-white/10 bg-white p-0.5 flex items-center justify-center">
                <img
                  src="/smartsite-app-icon-white.png"
                  alt="SmartSite"
                  className="w-full h-full object-contain"
                />
              </div>
              {!isCollapsed && (
                <div className="hidden lg:flex flex-col whitespace-nowrap overflow-hidden transition-opacity duration-200">
                  <div className="text-base font-bold tracking-tight leading-none text-white">
                    Smart<span className="text-[#F66B17]">Site</span>
                  </div>
                  <span className="text-[9px] font-mono tracking-widest text-[#8C9BAE] uppercase mt-0.5 font-semibold">
                    {tr('common.operations')}
                  </span>
                </div>
              )}
            </button>

            {/* Toggle Button for Sidebar collapse/expand (desktop only, rail is fixed w-16 on mobile) */}
            <button
              type="button"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="hidden lg:flex w-6 h-6 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 items-center justify-center text-[#8C9BAE] hover:text-white transition-all cursor-pointer active:scale-95 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
              title={isCollapsed ? tr('common.expand_sidebar') : tr('common.collapse_sidebar')}
              aria-label={isCollapsed ? tr('common.expand_sidebar') : tr('common.collapse_sidebar')}
            >
              {isCollapsed ? (
                <IconChevronRight className="w-3.5 h-3.5" />
              ) : (
                <IconChevronLeft className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {/* Navigation Section */}
          <div className="px-2 lg:px-3 py-4 min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
            <nav className="space-y-6" aria-label={tr('common.main_navigation')}>
              {(currentUser ? navGroups : []).map((group, groupIdx) => (
                <div key={groupIdx} className="space-y-1">
                  {!isCollapsed && (
                    <div className="hidden lg:flex px-3 mb-2 items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-[#F66B17]" />
                      <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-[#8C9BAE]">
                        {group.label}
                      </p>
                    </div>
                  )}
                  {group.items.map((item) => {
                    const isActive = activeTab === item.id;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleNav(item.id)}
                        title={item.label}
                        aria-label={item.label}
                        aria-current={isActive ? 'page' : undefined}
                        className={`w-full min-h-11 lg:min-h-0 flex items-center ${
                          isCollapsed
                            ? 'justify-center px-0 py-2.5 rounded-xl min-h-11'
                            : 'justify-center lg:justify-between px-0 lg:px-3.5 py-2.5 rounded-xl min-h-11'
                        } text-xs font-medium transition-colors cursor-pointer relative group ${
                          isActive
                            ? 'bg-white/10 text-white font-semibold'
                            : 'text-[#8C9BAE] hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <div
                          className={`flex items-center ${
                            isCollapsed
                              ? 'justify-center'
                              : 'justify-center lg:justify-start gap-0 lg:gap-3'
                          }`}
                        >
                          <Icon
                            className={`w-4 h-4 shrink-0 transition-colors ${
                              isActive ? 'text-[#F66B17]' : 'text-[#8C9BAE] group-hover:text-white'
                            }`}
                          />
                          <span
                            className={`whitespace-nowrap overflow-hidden ${
                              isCollapsed ? 'hidden' : 'hidden lg:inline'
                            }`}
                          >
                            {item.label}
                          </span>
                        </div>
                        {isActive && !isCollapsed && (
                          <>
                            <span className="hidden lg:block w-1 h-3.5 rounded-full bg-[#F66B17]" />
                            <span className="lg:hidden absolute left-1 w-1 h-4 rounded-full bg-[#F66B17]" />
                          </>
                        )}
                        {isActive && isCollapsed && (
                          <span className="absolute left-1 w-1 h-4 rounded-full bg-[#F66B17]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
          </div>
        </div>

        {/* Bottom Homepage Link */}
        <div className="shrink-0 p-2 lg:p-3 border-t border-[#1E2633]">
          <button
            type="button"
            onClick={() => navigate('/')}
            title={isCollapsed ? tr('common.public_smartsite_homepage') : undefined}
            aria-label={tr('common.public_smartsite_homepage')}
            className={`w-full flex items-center ${
              isCollapsed
                ? 'justify-center p-2.5'
                : 'justify-center lg:justify-start gap-0 lg:gap-3 px-2 lg:px-3 py-2.5'
            } rounded-lg text-xs font-medium text-[#8C9BAE] hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors cursor-pointer group focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40`}
          >
            <IconHome className="w-4 h-4 text-[#F66B17] shrink-0" />
            {!isCollapsed && (
              <span className="hidden lg:inline whitespace-nowrap overflow-hidden font-medium">
                {tr('common.public_smartsite_homepage')}
              </span>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#F8FAFC]">
        {/* Top Header Bar */}
        <header className="min-h-16 py-2 bg-white border-b border-slate-200/80 px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-3 shrink-0 sticky top-0 z-20">
          {/* Left: Brand/Context info */}
          {activeTab === 'schedule-setup' ||
          (activeTab === 'site-setup' &&
            roles.includes('SITE_MANAGER') &&
            !roles.includes('ADMIN')) ||
          (activeTab === 'workforce' && workforceTabs.showReview && workforceTab === 'review') ? (
            <div className="flex items-center gap-3 min-w-0">
              <div
                aria-hidden="true"
                className="w-10 h-10 rounded-xl bg-[#071A2B] text-white flex items-center justify-center shadow-xs shrink-0"
              >
                {activeTab === 'site-setup' ? (
                  <IconBuilding className="w-5 h-5 text-[#F66B17]" />
                ) : activeTab === 'workforce' ? (
                  <IconShield className="w-5 h-5 text-[#F66B17]" />
                ) : (
                  <IconCalendar className="w-5 h-5 text-[#F66B17]" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500 truncate">
                    {activeTab === 'site-setup'
                      ? tr('integrated_ui.site_operations')
                      : activeTab === 'workforce'
                        ? `${tr('common.workforce_operations')} · ${tr('common.shift_approvals')}`
                        : tr('common.workforce_management')}
                  </span>
                </div>
                <h1 className="text-xl font-bold tracking-tight text-[#071A2B] truncate">
                  {activeTab === 'site-setup'
                    ? tr('siteOps.titleManage')
                    : activeTab === 'workforce'
                      ? tr('common.contractor_review')
                      : tr('common.schedule_setup')}
                </h1>
              </div>
            </div>
          ) : (
            <div className="min-w-0 flex flex-col gap-0.5">
              <span className="truncate text-[10px] font-bold uppercase tracking-wider text-[#62748E]">
                {pageLabel}
              </span>
              {functionLabel && (
                <span className="truncate text-sm font-bold text-[#071A2B]">{functionLabel}</span>
              )}
            </div>
          )}

          {/* Right: Language Switcher, Notification, User Profile & Logout */}
          <div className="flex items-center gap-3 shrink-0">
            <LanguageSwitcher />
            <NotificationBell
              assignedWork={
                allowedTabs.includes('assigned-work') && !allowedTabs.includes('incidents')
              }
              key={currentUser?.id ?? 'signed-out'}
              apiUrl={apiUrl}
              userId={currentUser?.id ?? ''}
              enabled={!!currentUser && !currentUser.mustChangePassword}
            />

            {/* User Profile */}
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[#0F172A] text-white flex items-center justify-center font-bold text-xs tracking-wider shadow-xs">
                {userInitials}
              </div>
              <div className="text-left leading-tight hidden sm:block max-w-36 truncate">
                <p className="font-semibold text-xs text-slate-900">{displayName}</p>
                <p className="text-[11px] text-slate-500">{userRole}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => navigate('/account/password')}
              className="p-2 rounded-lg text-[#62748E] hover:bg-slate-100 focus-visible:outline-2"
              title={tr('auth.password.title')}
              aria-label={tr('auth.password.title')}
            >
              <IconKey className="w-4 h-4" />
            </button>
            {/* Logout Button */}
            <button
              type="button"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="flex h-11 w-11 items-center justify-center ml-1 rounded-xl hover:bg-red-50 text-slate-500 hover:text-red-500 transition-all active:scale-90 relative cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400"
              title={tr('common.logout')}
              aria-label={tr('common.logout')}
            >
              <IconLogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Viewport Content */}
        <main
          id="smartsite-main-content"
          tabIndex={-1}
          className="flex-1 min-w-0 p-3 sm:p-6 lg:p-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export default AppLayout;
