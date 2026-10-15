import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
import React, { ReactNode, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import {
  IconDashboard,
  IconUsers,
  IconKey,
  IconHardHat,
  IconAlertTriangle,
  IconRadio,
  IconTrendingUp,
  IconHome,
  IconBuilding,
  IconCalendar,
  IconSearch,
  IconChevronLeft,
  IconChevronRight,
  IconCamera,
  IconShield,
  IconLogOut,
} from '../icons';

import { useLogout, useCurrentUser } from '../../features/auth/auth-session';
import { NotificationBell } from '../../features/notifications/NotificationBell';

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export type ActiveTab =
  | 'dashboard'
  | 'workforce'
  | 'worker-onboarding'
  | 'site-setup'
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
  useTranslation();

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
  const displayName = currentUser?.username || tr('common.user');
  const roles: string[] = currentUser?.roleAssignments?.map((r) => r.role) || [];
  const userRole = roles.includes('ADMIN')
    ? tr('common.system_admin')
    : roles.includes('SITE_MANAGER')
      ? tr('common.site_manager')
      : roles.includes('CONTRACTOR_REPRESENTATIVE')
        ? tr('common.contractor_rep')
        : roles.includes('WORKER')
          ? tr('common.worker')
          : tr('common.authenticated_user');
  const userInitials = displayName.slice(0, 2).toUpperCase();

  const isAdmin = roles.includes('ADMIN');
  const isManager = roles.includes('SITE_MANAGER');
  const isContractorRep = !isAdmin && roles.includes('CONTRACTOR_REPRESENTATIVE');
  const isWorker = roles.includes('WORKER');
  const isWorkerOnly = isWorker && !isAdmin && !isManager && !isContractorRep;
  const isManagerOnly = isManager && !isAdmin && !isContractorRep;
  const canAccessWorkforce = (isWorker || isContractorRep) && !isAdmin;
  const canAccessScheduleSetup = (isManager || isContractorRep) && !isAdmin;

  const navGroups = isWorkerOnly
    ? [
        {
          get label() {
            return tr('common.workspace');
          },
          items: [
            {
              id: 'workforce',
              get label() {
                return tr('app_layout.my_schedule_requests');
              },
              icon: IconUsers,
            },
            {
              id: 'access',
              get label() {
                return tr('common.my_qr_pass');
              },
              icon: IconKey,
            },
          ],
        },
      ]
    : [
        {
          get label() {
            return tr('common.workspace');
          },
          items: [
            {
              id: 'dashboard',
              get label() {
                return tr('common.dashboard');
              },
              icon: IconDashboard,
            },
            ...(canAccessWorkforce
              ? [
                  {
                    id: 'workforce',
                    get label() {
                      return isContractorRep
                        ? tr('common.contractor_review')
                        : tr('common.workforce');
                    },
                    icon: IconUsers,
                  },
                ]
              : []),
            ...(canAccessScheduleSetup
              ? [
                  {
                    id: 'schedule-setup',
                    get label() {
                      return tr('common.schedule_setup');
                    },
                    icon: IconCalendar,
                  },
                ]
              : []),
            ...(isContractorRep
              ? [
                  {
                    id: 'worker-onboarding',
                    get label() {
                      return tr('common.worker_onboarding');
                    },
                    icon: IconUsers,
                  },
                ]
              : []),
            ...(isAdmin || isManager
              ? [
                  {
                    id: 'site-setup',
                    get label() {
                      return isAdmin ? tr('common.site_setup') : tr('common.contractors_zones');
                    },
                    icon: IconBuilding,
                  },
                ]
              : []),
            ...(!isManagerOnly
              ? [
                  {
                    id: 'access',
                    get label() {
                      return isContractorRep && !isAdmin
                        ? tr('common.attendance_access')
                        : tr('common.site_access');
                    },
                    icon: IconKey,
                  },
                ]
              : []),
          ],
        },
        {
          get label() {
            return tr('common.safety');
          },
          items: [
            {
              id: 'live-monitoring',
              get label() {
                return tr('common.live_monitoring');
              },
              icon: IconCamera,
            },
            {
              id: 'ppe',
              get label() {
                return tr('common.ppe_monitoring');
              },
              icon: IconHardHat,
            },
            {
              id: 'zones',
              get label() {
                return tr('common.restricted_zones');
              },
              icon: IconShield,
            },
            {
              id: 'incidents',
              get label() {
                return tr('common.safety_operations_06c3c3');
              },
              icon: IconAlertTriangle,
            },
          ],
        },
        {
          get label() {
            return tr('common.site_data');
          },
          items: [
            {
              id: 'iot',
              get label() {
                return tr('common.iot_monitoring');
              },
              icon: IconRadio,
            },
            {
              id: 'progress',
              get label() {
                return tr('common.progress');
              },
              icon: IconTrendingUp,
            },
          ],
        },
      ];

  return (
    <div className="min-h-screen bg-[var(--surface-canvas)] text-[var(--text-body)] font-sans flex">
      {/* Left Sidebar: Warm neutral shell */}
      <aside
        className={`${
          isCollapsed ? 'w-16 sm:w-20' : 'w-16 sm:w-20 lg:w-64'
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
              title={tr('common.smartsite_homepage')}
              aria-label={tr('common.smartsite_homepage')}
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
                    {tr('common.operations')}
                  </span>
                </div>
              )}
            </div>

            {/* Toggle Button for Sidebar to/nhỏ */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="hidden lg:flex w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 items-center justify-center text-slate-400 hover:text-white transition-all cursor-pointer shadow-xs active:scale-95"
              title={isCollapsed ? tr('common.mo_rong_sidebar') : tr('common.thu_nho_sidebar')}
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
          <div className="px-3 py-4 flex-1 overflow-y-auto custom-scrollbar">
            <nav className="space-y-6" aria-label={tr('common.main_navigation')}>
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
            title={isCollapsed ? tr('common.public_smartsite_homepage') : undefined}
            aria-label={tr('common.public_smartsite_homepage')}
            className={`w-full min-h-11 lg:min-h-0 flex items-center ${
              isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5'
            } rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 hover:border-white/20 transition-all cursor-pointer shadow-xs group`}
          >
            <IconHome className="w-4 h-4 text-[#FF7A1A] shrink-0 group-hover:scale-110 transition-transform filter drop-shadow-[0_0_6px_rgba(246,107,23,0.4)]" />
            {!isCollapsed && (
              <span className="hidden lg:inline whitespace-nowrap overflow-hidden font-medium">
                {tr('common.public_smartsite_homepage')}
              </span>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[var(--surface-canvas)]">
        {/* Top Header Bar */}
        <header className="h-16 bg-white border-b border-slate-200 px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-3 shrink-0 sticky top-0 z-20 shadow-xs">
          {/* Left: Brand/Context info */}
          <div className="hidden xl:flex min-w-0 items-center gap-4">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {tr('common.smartsite_operations_platform')}
            </span>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200/80 text-xs font-bold text-[#008C47] shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-[#008C47] animate-pulse" />
              <span>{tr('common.all_systems_online')}</span>
            </div>
          </div>

          {/* Right: Search, Notification, Profile */}
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            {/* Search Input */}
            <div className="relative w-56 hidden lg:block">
              <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder={tr('common.search_smartsite')}
                aria-label={tr('common.search_smartsite')}
                className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium text-slate-800 focus:outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/15 focus:bg-white transition-all placeholder:text-slate-400"
              />
            </div>

            <LanguageSwitcher />
            <NotificationBell
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
              <div className="text-left leading-tight hidden sm:block max-w-36 truncate">
                <p className="font-semibold text-xs text-[#041D2E]">{displayName}</p>
                <p className="text-[11px] text-[#62748E]">{userRole}</p>
              </div>
            </div>

            <button type="button" onClick={() => navigate('/account/password')} className="p-2 rounded-lg text-[#62748E] hover:bg-slate-100 focus-visible:outline-2" title={tr('auth.password.title')} aria-label={tr('auth.password.title')}>
              <IconKey className="w-4 h-4" />
            </button>
            {/* Logout Button */}
            <button
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="p-2 ml-1 rounded-lg hover:bg-red-50 text-[#62748E] hover:text-red-500 transition-all active:scale-90 relative cursor-pointer"
              title={tr('common.logout')}
              aria-label={tr('common.logout')}
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
