import React, { ReactNode, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  IconDashboard,
  IconUsers,
  IconKey,
  IconHardHat,
  IconAlertTriangle,
  IconHome,
  IconBuilding,
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconCamera,
  IconShield,
  IconLogOut,
} from '../icons';

import { useLogout, useCurrentUser } from '../../features/auth/auth-session';
import { NotificationBell } from '../../features/notifications/NotificationBell';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { workspaceTabs } from '../../features/auth/workspace-access';
import { getWorkforceTabs } from '../workforce/utils/workforce-tabs';

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export type ActiveTab =
  | 'dashboard'
  | 'assigned-work'
  | 'contractor-teams'
  | 'worker-onboarding'
  | 'worker-documents'
  | 'workforce'
  | 'site-setup'
  | 'accounts'
  | 'schedule-setup'
  | 'access'
  | 'live-monitoring'
  | 'ppe'
  | 'zones'
  | 'incidents'
  | 'iot'
  | 'progress'
  | 'landing';

interface AppLayoutProps {
  currentTab?: ActiveTab;
  onSelectTab?: (tab: ActiveTab) => void;
  children: ReactNode;
}

export function AppLayout({ currentTab: propCurrentTab, onSelectTab, children }: AppLayoutProps) {
  const { t } = useTranslation();
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
  const { data: currentUser } = useCurrentUser(apiUrl);
  const displayName = currentUser?.username || t('shell.user');
  const roles: string[] = currentUser?.roleAssignments?.map((r) => r.role) || [];
  const userRole = roles.includes('ADMIN')
    ? t('shell.systemAdmin')
    : roles.includes('SITE_MANAGER')
      ? t('shell.siteManager')
      : roles.includes('CONTRACTOR_REPRESENTATIVE')
        ? t('shell.contractorRep')
        : roles.includes('WORKER')
          ? t('shell.worker')
          : roles.includes('SECURITY_OFFICER')
            ? t('accounts.role.SECURITY_OFFICER')
            : roles.includes('SAFETY_OFFICER')
              ? t('accounts.role.SAFETY_OFFICER')
              : t('shell.authenticated');
  const userInitials = displayName.slice(0, 2).toUpperCase();

  // Keep main's Safety presentation without changing the other role workspaces.
  // Navigation and business capabilities still use the scoped role policy below.
  const mainSafetyUi =
    roles.includes('SAFETY_OFFICER') &&
    [
      'dashboard',
      'live-monitoring',
      'ppe',
      'zones',
      'incidents',
      'worker-documents',
      'account/password',
    ].includes(activeTab);
  const allowedTabs = workspaceTabs(currentUser?.roleAssignments ?? []);
  const workerOnly = roles.length === 1 && roles[0] === 'WORKER';
  const attendanceWorkspace = !roles.includes('ADMIN') &&
    roles.some((role) => ['SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE'].includes(role));
  const navGroups = [
    {
      label: t('shell.workspace'),
      items: [
        { id: 'dashboard', label: t('shell.dashboard'), icon: IconDashboard },
        { id: 'contractor-teams', label: t('shell.contractorTeams'), icon: IconUsers },
        { id: 'assigned-work', label: t('shell.assignedWork'), icon: IconUsers },
        { id: 'worker-onboarding', label: t('shell.workerOnboarding'), icon: IconUsers },
        { id: 'worker-documents', label: t('documents.title'), icon: IconUsers },
        {
          id: 'workforce',
          label: t(workerOnly ? 'shell.mySchedule' : 'shell.workforce'),
          icon: IconUsers,
        },
        { id: 'accounts', label: t('accounts.title'), icon: IconUsers },
        { id: 'site-setup', label: t('shell.siteSetup'), icon: IconBuilding },
        { id: 'schedule-setup', label: t('shell.schedule'), icon: IconCalendar },
        {
          id: 'access',
          label: t(
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
      label: t('shell.safety'),
      items: [
        { id: 'live-monitoring', label: t('shell.live'), icon: IconCamera },
        { id: 'ppe', label: t('shell.ppe'), icon: IconHardHat },
        { id: 'zones', label: t('shell.zones'), icon: IconShield },
        { id: 'incidents', label: t('shell.incidents'), icon: IconAlertTriangle },
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
      ? t('auth.password.title')
      : activeTab === 'dashboard' && roles.includes('SITE_MANAGER')
        ? t('common.site_management_overview')
        : (currentItem?.label ?? '');
  const functionLabel =
    activeTab === 'workforce' && (workforceTabs.showReview || workforceTabs.showSchedule)
      ? t(workforceTab === 'review' ? 'shell.contractorReview' : 'app_layout.my_schedule_requests')
      : '';

  return (
    <div className="min-h-screen bg-[var(--surface-canvas)] text-[var(--text-body)] font-sans flex">
      {/* Left Sidebar: Warm neutral shell */}
      <aside
        className={`${
          mainSafetyUi
            ? isCollapsed
              ? 'w-16 sm:w-20'
              : 'w-16 sm:w-20 lg:w-64'
            : isCollapsed
              ? 'w-20'
              : 'w-20 lg:w-64'
        } bg-gradient-to-b from-[#071320] via-[#04121D] to-[#020B13] text-white flex flex-col justify-between shrink-0 select-none border-r border-white/10 transition-all duration-300 ease-in-out sticky top-0 h-screen z-30 shadow-2xl`}
      >
        <div>
          {/* Brand & Collapse/Expand Toggle Header */}
          <div
            className={`p-3 lg:p-4 border-b border-white/10 flex items-center ${
              isCollapsed ? 'flex-col gap-3 justify-center' : 'justify-center lg:justify-between'
            }`}
          >
            {/* Brand Logo */}
            <div
              className="flex items-center gap-3 cursor-pointer group"
              onClick={() => navigate('/')}
              title={t('shell.home')}
              aria-label={t('shell.home')}
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
                  <div className="text-lg font-black tracking-tight leading-none text-white">
                    Smart
                    <span className="text-[#FF7A1A] bg-gradient-to-r from-[#FF7A1A] to-[#FF9B42] bg-clip-text text-transparent">
                      Site
                    </span>
                  </div>
                  <span className="text-[9px] font-mono tracking-widest text-slate-400 uppercase mt-0.5 font-semibold">
                    {t('shell.operations')}
                  </span>
                </div>
              )}
            </div>

            {/* Toggle Button for Sidebar to/nhỏ */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="hidden lg:flex w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 items-center justify-center text-slate-400 hover:text-white transition-all cursor-pointer shadow-xs active:scale-95"
              title={t(isCollapsed ? 'shell.expand' : 'shell.collapse')}
              aria-label={isCollapsed ? t('shell.expand') : t('shell.collapse')}
            >
              {isCollapsed ? (
                <IconChevronRight className="w-3.5 h-3.5" />
              ) : (
                <IconChevronLeft className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {/* Navigation Section */}
          <div className="px-3 py-4 flex-1 overflow-y-auto custom-scrollbar">
            <nav className="space-y-6" aria-label={t('shell.navigation')}>
              {navGroups.map((group, groupIdx) => (
                <div key={groupIdx} className="space-y-1.5">
                  {!isCollapsed && (
                    <div className="hidden lg:flex px-3 mb-2 items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-[#FF7A1A]/70" />
                      <p className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-slate-400/80">
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
                        title={isCollapsed ? item.label : undefined}
                        aria-label={item.label}
                        aria-current={isActive ? 'page' : undefined}
                        className={`w-full min-h-11 lg:min-h-0 flex items-center ${
                          isCollapsed
                            ? 'justify-center px-0 py-2.5'
                            : 'justify-between px-3.5 py-2.5'
                        } rounded-xl text-xs font-medium transition-all duration-200 cursor-pointer relative group border ${
                          isActive
                            ? 'bg-gradient-to-r from-[#FF7A1A]/20 via-[#FF7A1A]/10 to-transparent text-white font-semibold border-[#FF7A1A]/35 shadow-[0_0_20px_rgba(246,107,23,0.12)]'
                            : 'text-slate-300/80 hover:text-white hover:bg-white/[0.06] border-transparent hover:border-white/5 hover:translate-x-0.5'
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
                            className={`w-4 h-4 shrink-0 transition-transform duration-200 group-hover:scale-110 ${
                              isActive
                                ? 'text-[#FF7A1A] filter drop-shadow-[0_0_8px_rgba(246,107,23,0.6)]'
                                : 'text-slate-400 group-hover:text-slate-200'
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
                          <span className="w-1.5 h-4 rounded-full bg-gradient-to-b from-[#FF8833] to-[#F66B17] shadow-[0_0_8px_rgba(246,107,23,0.8)]" />
                        )}
                        {isActive && isCollapsed && (
                          <span className="absolute left-1 w-1 h-5 rounded-full bg-gradient-to-b from-[#FF8833] to-[#F66B17] shadow-[0_0_8px_rgba(246,107,23,0.8)]" />
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
        <div className="p-2 lg:p-3 border-t border-white/10">
          <button
            onClick={() => navigate('/')}
            title={isCollapsed ? t('shell.publicHome') : undefined}
            aria-label={t('shell.publicHome')}
            className={`w-full min-h-11 lg:min-h-0 flex items-center ${
              isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5'
            } rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 hover:border-white/20 transition-all cursor-pointer shadow-xs group`}
          >
            <IconHome className="w-4 h-4 text-[#FF7A1A] shrink-0 group-hover:scale-110 transition-transform filter drop-shadow-[0_0_6px_rgba(246,107,23,0.4)]" />
            {!isCollapsed && (
              <span className="hidden lg:inline whitespace-nowrap overflow-hidden font-medium">
                {t('shell.publicHome')}
              </span>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[var(--surface-canvas)]">
        {/* Top Header Bar */}
        <header
          className={
            mainSafetyUi
              ? 'h-16 bg-white border-b border-slate-200 px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-3 shrink-0 sticky top-0 z-20 shadow-xs'
              : 'h-16 bg-white border-b border-[#E2E8F0] px-6 sm:px-8 flex items-center justify-between gap-3 shrink-0 sticky top-0 z-20 shadow-xs'
          }
        >
          {/* Left: Brand/Context info */}
          {activeTab === 'schedule-setup' ||
          (activeTab === 'site-setup' && roles.includes('SITE_MANAGER') && !roles.includes('ADMIN')) ||
          (activeTab === 'workforce' && workforceTabs.showReview && workforceTab === 'review') ? (
            <div className="flex items-center gap-3 min-w-0">
              <div
                aria-hidden="true"
                className="w-10 h-10 rounded-xl bg-[#071A2B] text-white flex items-center justify-center shadow-xs shrink-0"
              >
                {activeTab === 'site-setup' ? <IconBuilding className="w-5 h-5 text-[#F66B17]" /> : activeTab === 'workforce' ? <IconShield className="w-5 h-5 text-[#F66B17]" /> : <IconCalendar className="w-5 h-5 text-[#F66B17]" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500 truncate">
                    {activeTab === 'site-setup' ? t('integrated_ui.site_operations') : activeTab === 'workforce' ? `${t('common.workforce_operations')} · ${t('common.shift_approvals')}` : t('common.workforce_management')}
                  </span>
                </div>
                <h1 className="text-xl font-bold tracking-tight text-[#071A2B] truncate">
                  {activeTab === 'site-setup' ? t('siteOps.titleManage') : activeTab === 'workforce' ? t('common.contractor_review') : t('common.schedule_setup')}
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

          {/* Right: Search, Notification, Profile */}
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            {!mainSafetyUi && <LanguageSwitcher />}
            {mainSafetyUi && <LanguageSwitcher />}
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
            <div className="flex items-center gap-2.5 pl-3 border-l border-[#E2E8F0]">
              <div className="w-8 h-8 rounded-full bg-[#041D2E] text-white flex items-center justify-center font-bold text-xs tracking-wider">
                {userInitials}
              </div>
              <div
                className={`text-left leading-tight hidden sm:block${mainSafetyUi ? ' max-w-36 truncate' : ''}`}
              >
                <p className="font-semibold text-xs text-[#041D2E]">{displayName}</p>
                <p className="text-[11px] text-[#62748E]">{userRole}</p>
              </div>
            </div>

            {mainSafetyUi && (
              <button
                type="button"
                onClick={() => navigate('/account/password')}
                className="p-2 rounded-lg text-[#62748E] hover:bg-slate-100 focus-visible:outline-2"
                title={t('auth.password.title')}
                aria-label={t('auth.password.title')}
              >
                <IconKey className="w-4 h-4" />
              </button>
            )}
            {/* Logout Button */}
            <button
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="p-2 ml-1 rounded-lg hover:bg-red-50 text-[#62748E] hover:text-red-500 transition-all active:scale-90 relative cursor-pointer"
              title={t('shell.logout')}
              aria-label={t('shell.logout')}
            >
              <IconLogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Viewport Content */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

export default AppLayout;
