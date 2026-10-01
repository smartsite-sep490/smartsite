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
  const isManager = roles.includes('SITE_MANAGER') || isAdmin;
  const isWorkerOnly = roles.includes('WORKER') && !roles.includes('ADMIN') && !roles.includes('SITE_MANAGER');

  const navGroups = isWorkerOnly
    ? [
        {
          label: 'Workspace',
          items: [
            { id: 'workforce', label: 'My Schedule & Requests', icon: IconUsers },
          ],
        },
      ]
    : [
        {
          label: 'Workspace',
          items: [
            { id: 'dashboard', label: 'Dashboard', icon: IconDashboard },
            { id: 'workforce', label: 'Workforce', icon: IconUsers },
            ...(isManager ? [{ id: 'schedule-setup', label: 'Schedule Setup', icon: IconCalendar }] : []),
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
    <div className="min-h-screen bg-[#F9FAFC] text-[#182232] font-sans flex">
      {/* Left Sidebar: Collapsible directly on the sidebar */}
      <aside
        className={`${
          isCollapsed ? 'w-20' : 'w-64'
        } bg-[#041D2E] text-white flex flex-col justify-between shrink-0 select-none border-r border-[#031724] transition-all duration-300 ease-in-out sticky top-0 h-screen z-30`}
      >
        <div>
          {/* Brand & Collapse/Expand Toggle Header */}
          <div
            className={`p-4 border-b border-white/10 flex items-center ${
              isCollapsed ? 'flex-col gap-3 justify-center' : 'justify-between'
            }`}
          >
            {/* Brand Logo */}
            <div
              className="flex items-center gap-3 cursor-pointer"
              onClick={() => navigate('/')}
              title="SmartSite Homepage"
            >
              <div className="w-9 h-9 rounded-lg bg-[#F66B17] flex items-center justify-center text-white shadow-sm shrink-0">
                <IconHardHat className="w-5 h-5" />
              </div>
              {!isCollapsed && (
                <div className="text-xl font-bold tracking-tight whitespace-nowrap overflow-hidden transition-opacity duration-200">
                  <span className="text-white">Smart</span>
                  <span className="text-[#F66B17]">Site</span>
                </div>
              )}
            </div>

            {/* Toggle Button for Sidebar to/nhỏ */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title={isCollapsed ? 'Mở rộng sidebar' : 'Thu nhỏ sidebar'}
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isCollapsed ? (
                <IconChevronRight className="w-4 h-4" />
              ) : (
                <IconChevronLeft className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Navigation Section */}
          <div className="px-3 py-3 flex-1 overflow-y-auto custom-scrollbar">
            <nav className="space-y-6">
              {navGroups.map((group, groupIdx) => (
                <div key={groupIdx} className="space-y-1">
                  {!isCollapsed && (
                    <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-widest text-white/40">
                      {group.label}
                    </p>
                  )}
                  {group.items.map((item) => {
                    const isActive = activeTab === item.id;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleNav(item.id)}
                        title={isCollapsed ? item.label : undefined}
                        className={`w-full flex items-center ${
                          isCollapsed
                            ? 'justify-center px-0 py-2.5'
                            : 'justify-between px-3.5 py-2.5'
                        } rounded-lg text-xs font-medium transition-all cursor-pointer relative ${
                          isActive
                            ? 'bg-white/10 text-white font-semibold shadow-inner'
                            : 'text-white/70 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <div className={`flex items-center ${isCollapsed ? '' : 'gap-3'}`}>
                          <Icon
                            className={`w-4 h-4 shrink-0 ${
                              isActive ? 'text-[#F66B17]' : 'text-white/60'
                            }`}
                          />
                          {!isCollapsed && (
                            <span className="whitespace-nowrap overflow-hidden">{item.label}</span>
                          )}
                        </div>
                        {isActive && !isCollapsed && (
                          <span className="w-1.5 h-4 rounded-full bg-[#F66B17]" />
                        )}
                        {isActive && isCollapsed && (
                          <span className="absolute left-1 w-1 h-5 rounded-full bg-[#F66B17]" />
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
        <div className="p-3 border-t border-white/10">
          <button
            onClick={() => navigate('/')}
            title={isCollapsed ? 'Public SmartSite Homepage' : undefined}
            className={`w-full flex items-center ${
              isCollapsed ? 'justify-center p-2' : 'gap-2.5 px-3 py-2'
            } rounded-lg text-xs font-medium text-white/70 hover:text-white hover:bg-white/5 transition-colors cursor-pointer`}
          >
            <IconHome className="w-4 h-4 text-[#F66B17] shrink-0" />
            {!isCollapsed && (
              <span className="whitespace-nowrap overflow-hidden">Public SmartSite Homepage</span>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#F9FAFC]">
        {/* Top Header Bar */}
        <header className="h-16 bg-white border-b border-[#E2E8F0] px-6 sm:px-8 flex items-center justify-between shrink-0 sticky top-0 z-20 shadow-xs">
          {/* Left: Brand/Context info */}
          <div className="flex items-center gap-4">
            <span className="text-xs font-semibold text-[#62748E] uppercase tracking-wider">
              SmartSite Operations Platform
            </span>
          </div>

          {/* Right: Search, Notification, Status, Profile */}
          <div className="flex items-center gap-4">
            {/* Search Input */}
            <div className="relative w-56 hidden md:block">
              <IconSearch className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search SmartSite"
                className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F1F5F9] text-xs text-[#182232] focus:outline-none focus:border-[#F66B17] focus:bg-white transition-all placeholder:text-[#94A3B8]"
              />
            </div>

            {/* Notification Bell */}
            <button className="p-2 rounded-lg hover:bg-slate-100 text-[#62748E] transition-colors relative cursor-pointer">
              <IconBell className="w-4 h-4" />
              <span className="w-2 h-2 rounded-full bg-[#F66B17] absolute top-1.5 right-1.5" />
            </button>

            {/* Status Pill */}
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#DCF7E1] text-xs font-semibold text-[#008C47]">
              <span className="w-2 h-2 rounded-full bg-[#008C47] animate-ping" />
              <span>All Systems Online</span>
            </div>

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
        <main className="flex-1 p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}

export default AppLayout;
