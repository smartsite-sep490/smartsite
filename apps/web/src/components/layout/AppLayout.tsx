import React, { ReactNode, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  IconBell,
  IconChevronLeft,
  IconChevronRight,
  IconCamera,
  IconShield,
  IconLogOut,
} from '../icons';

import { useLogout, useCurrentUser } from '../../features/auth/auth-session';

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export type ActiveTab =
  | 'dashboard'
  | 'workforce'
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
  const displayName = currentUser?.username || 'User';
  const roles: string[] = currentUser?.roleAssignments?.map((r) => r.role) || [];
  const userRole = roles.includes('ADMIN')
    ? 'System Admin'
    : roles.includes('SITE_MANAGER')
      ? 'Site Manager'
      : roles.includes('CONTRACTOR_REPRESENTATIVE')
        ? 'Contractor Rep'
        : roles.includes('WORKER')
          ? 'Worker'
          : 'Authenticated User';
  const userInitials = displayName.slice(0, 2).toUpperCase();

  const isAdmin = roles.includes('ADMIN');
  const isManager = roles.includes('SITE_MANAGER');
  const isContractorRep = roles.includes('CONTRACTOR_REPRESENTATIVE');
  const isWorker = roles.includes('WORKER');
  const isWorkerOnly = isWorker && !isAdmin && !isManager && !isContractorRep;
  const canAccessWorkforce = (isWorker || isContractorRep) && !isAdmin;
  const canAccessScheduleSetup = (isManager || isContractorRep) && !isAdmin;

  const navGroups = isWorkerOnly
    ? [
        {
          label: 'Workspace',
          items: [
            { id: 'workforce', label: 'My Schedule & Requests', icon: IconUsers },
            { id: 'access', label: 'QR của tôi', icon: IconKey },
          ],
        },
      ]
    : [
        {
          label: 'Workspace',
          items: [
            { id: 'dashboard', label: 'Dashboard', icon: IconDashboard },
            ...(canAccessWorkforce
              ? [
                  {
                    id: 'workforce',
                    label: isContractorRep ? 'Contractor Review' : 'Workforce',
                    icon: IconUsers,
                  },
                ]
              : []),
            ...(canAccessScheduleSetup
              ? [{ id: 'schedule-setup', label: 'Schedule Setup', icon: IconCalendar }]
              : []),
            ...(isAdmin ? [{ id: 'site-setup', label: 'Site Setup', icon: IconBuilding }] : []),
            { id: 'access', label: 'Site Access', icon: IconKey },
          ],
        },
        {
          label: 'Safety',
          items: [
            { id: 'live-monitoring', label: 'Live Monitoring', icon: IconCamera },
            { id: 'ppe', label: 'PPE Monitoring', icon: IconHardHat },
            { id: 'zones', label: 'Restricted Zones', icon: IconShield },
            { id: 'incidents', label: 'Safety Alerts', icon: IconAlertTriangle },
          ],
        },
        {
          label: 'Site Data',
          items: [
            { id: 'iot', label: 'IoT Monitoring', icon: IconRadio },
            { id: 'progress', label: 'Progress', icon: IconTrendingUp },
          ],
        },
      ];

  return (
    <div className="min-h-screen bg-[var(--surface-canvas)] text-[var(--text-body)] font-sans flex">
      {/* Left Sidebar: Warm neutral shell */}
      <aside
        className={`${
          isCollapsed ? 'w-20' : 'w-64'
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
              title="SmartSite Homepage"
              aria-label="SmartSite Homepage"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#FF7A1A] via-[#F66B17] to-[#D95200] p-[1px] shadow-[0_0_20px_rgba(246,107,23,0.35)] shrink-0 flex items-center justify-center transition-transform group-hover:scale-105">
                <div className="w-full h-full rounded-[11px] bg-gradient-to-br from-[#FF8833] to-[#E05500] flex items-center justify-center text-white">
                  <IconHardHat className="w-5 h-5 drop-shadow-sm" />
                </div>
              </div>
              {!isCollapsed && (
                <div className="flex flex-col whitespace-nowrap overflow-hidden transition-opacity duration-200">
                  <div className="text-lg font-black tracking-tight leading-none text-white">
                    Smart
                    <span className="text-[#FF7A1A] bg-gradient-to-r from-[#FF7A1A] to-[#FF9B42] bg-clip-text text-transparent">
                      Site
                    </span>
                  </div>
                  <span className="text-[9px] font-mono tracking-widest text-slate-400 uppercase mt-0.5 font-semibold">
                    Operations
                  </span>
                </div>
              )}
            </div>

            {/* Toggle Button for Sidebar to/nhỏ */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all cursor-pointer shadow-xs active:scale-95"
              title={isCollapsed ? 'Mở rộng sidebar' : 'Thu nhỏ sidebar'}
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
            <nav className="space-y-6" aria-label="Main navigation">
              {navGroups.map((group, groupIdx) => (
                <div key={groupIdx} className="space-y-1.5">
                  {!isCollapsed && (
                    <div className="px-3 mb-2 flex items-center gap-1.5">
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
                        className={`w-full flex items-center ${
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
            title={isCollapsed ? 'Public SmartSite Homepage' : undefined}
            aria-label="Public SmartSite Homepage"
            className={`w-full flex items-center ${
              isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5'
            } rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 hover:border-white/20 transition-all cursor-pointer shadow-xs group`}
          >
            <IconHome className="w-4 h-4 text-[#FF7A1A] shrink-0 group-hover:scale-110 transition-transform filter drop-shadow-[0_0_6px_rgba(246,107,23,0.4)]" />
            {!isCollapsed && (
              <span className="whitespace-nowrap overflow-hidden font-medium">
                Public SmartSite Homepage
              </span>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[var(--surface-canvas)]">
        {/* Top Header Bar */}
        <header className="h-16 bg-white border-b border-[#E2E8F0] px-6 sm:px-8 flex items-center justify-between shrink-0 sticky top-0 z-20 shadow-xs">
          {/* Left: Brand/Context info */}
          <div className="flex items-center gap-4">
            <span className="text-xs font-semibold text-[#62748E] uppercase tracking-wider">
              SmartSite Operations Platform
            </span>
          </div>

          {/* Right: Search, Notification, Profile */}
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            {/* Search Input */}
            <div className="relative w-56 hidden lg:block">
              <IconSearch className="w-4 h-4 text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search SmartSite"
                aria-label="Search SmartSite"
                className="w-full pl-9 pr-3 py-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-bone)] text-xs text-[var(--text-body)] focus:outline-none focus:border-[var(--accent)] focus:bg-white transition-all placeholder:text-[var(--text-secondary)]"
              />
            </div>

            {/* Notification Bell — no fake unread count */}
            <button
              className="p-2 rounded-md hover:bg-[var(--surface-bone)] text-[var(--text-secondary)] transition-colors cursor-pointer shrink-0"
              aria-label="Notifications"
            >
              <IconBell className="w-4 h-4" />
            </button>

            {/* User Profile */}
            <div className="flex items-center gap-2.5 pl-3 border-l border-[#E2E8F0]">
              <div className="w-8 h-8 rounded-full bg-[#041D2E] text-white flex items-center justify-center font-bold text-xs tracking-wider">
                {userInitials}
              </div>
              <div className="text-left leading-tight hidden sm:block">
                <p className="font-semibold text-xs text-[#041D2E]">{displayName}</p>
                <p className="text-[11px] text-[#62748E]">{userRole}</p>
              </div>
            </div>

            {/* Logout Button */}
            <button
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="p-2 ml-1 rounded-lg hover:bg-red-50 text-[#62748E] hover:text-red-500 transition-all active:scale-90 relative cursor-pointer"
              title="Logout"
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
