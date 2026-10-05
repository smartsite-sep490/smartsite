import React, { ReactNode, useState } from 'react';
import {
  IconDashboard,
  IconUsers,
  IconKey,
  IconHardHat,
  IconAlertTriangle,
  IconRadio,
  IconTrendingUp,
  IconHome,
  IconBuilding2,
  IconSearch,
  IconBell,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCamera,
  IconShield,
} from '../icons';

export type ActiveTab =
  | 'dashboard'
  | 'workforce'
  | 'access'
  | 'live-monitoring'
  | 'ppe'
  | 'zones'
  | 'incidents'
  | 'iot'
  | 'progress'
  | 'landing';

interface AppLayoutProps {
  currentTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  children: ReactNode;
}

export function AppLayout({ currentTab, onSelectTab, children }: AppLayoutProps) {
  // Sidebar state: expanded (to) vs collapsed (nhỏ)
  const [isCollapsed, setIsCollapsed] = useState(false);

  const navGroups = [
    {
      label: 'Workspace',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: IconDashboard },
        { id: 'workforce', label: 'Workforce', icon: IconUsers },
        { id: 'access', label: 'Site Access', icon: IconKey },
      ],
    },
    {
      label: 'Safety',
      items: [
        { id: 'live-monitoring', label: 'Live Monitoring', icon: IconCamera },
        { id: 'ppe', label: 'PPE Monitoring', icon: IconHardHat },
        { id: 'zones', label: 'Restricted Zones', icon: IconShield },
        { id: 'incidents', label: 'Safety Operations', icon: IconAlertTriangle },
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
          isCollapsed ? 'w-20' : 'w-16 sm:w-20 lg:w-64'
        } bg-[var(--surface-sidebar)] text-white flex flex-col justify-between shrink-0 select-none border-r border-[var(--border-sidebar)] transition-all duration-300 ease-in-out sticky top-0 h-screen z-30`}
      >
        <div>
          {/* Brand & Collapse/Expand Toggle Header */}
          <div
            className={`p-3 lg:p-4 border-b border-white/10 flex items-center ${
              isCollapsed ? 'flex-col gap-3 justify-center' : 'justify-center lg:justify-between'
            }`}
          >
            {/* Brand Logo */}
            <button
              type="button"
              className="flex items-center gap-3 cursor-pointer text-left bg-transparent border-0 p-0 focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2 rounded-md"
              onClick={() => onSelectTab('landing')}
              title="SmartSite Homepage"
              aria-label="SmartSite Homepage"
            >
              <div className="w-9 h-9 rounded-md bg-[var(--accent)] flex items-center justify-center text-white shrink-0">
                <IconHardHat className="w-5 h-5" />
              </div>
              <div
                className={`text-xl font-bold tracking-tight whitespace-nowrap overflow-hidden transition-opacity duration-200 ${
                  isCollapsed ? 'hidden' : 'hidden lg:block'
                }`}
              >
                <span className="text-white">Smart</span>
                <span className="text-[var(--accent)]">Site</span>
              </div>
            </button>

            {/* Toggle Button for Sidebar to/nhỏ */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer hidden lg:block"
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
          <div className="px-2 lg:px-3 py-3 flex-1 overflow-y-auto custom-scrollbar">
            <nav className="space-y-6" aria-label="Main navigation">
              {navGroups.map((group, groupIdx) => (
                <div key={groupIdx} className="space-y-1">
                  <p
                    className={`px-3 mb-2 text-[10px] font-bold uppercase tracking-widest text-white/40 ${
                      isCollapsed ? 'hidden' : 'hidden lg:block'
                    }`}
                  >
                    {group.label}
                  </p>
                  {group.items.map((item) => {
                    const isActive = currentTab === item.id;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => onSelectTab(item.id as ActiveTab)}
                        title={item.label}
                        aria-label={item.label}
                        aria-current={isActive ? 'page' : undefined}
                        className={`w-full flex items-center ${
                          isCollapsed
                            ? 'justify-center px-0 py-2.5'
                            : 'justify-center lg:justify-between px-0 lg:px-3.5 py-2.5'
                        } rounded-md text-xs font-medium transition-all cursor-pointer relative ${
                          isActive
                            ? 'bg-white/10 text-white font-semibold'
                            : 'text-white/70 hover:bg-white/5 hover:text-white'
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
                            className={`w-4 h-4 shrink-0 ${
                              isActive ? 'text-white' : 'text-white/60'
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
                        {isActive && (
                          <span
                            className={`${
                              isCollapsed
                                ? 'absolute left-1 w-1 h-5'
                                : 'absolute left-1 w-1 h-5 lg:static lg:w-1.5 lg:h-4'
                            } rounded-full bg-white/80`}
                          />
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
            onClick={() => onSelectTab('landing')}
            aria-label="Public SmartSite Homepage"
            title="Public SmartSite Homepage"
            className={`w-full flex items-center ${
              isCollapsed
                ? 'justify-center p-2'
                : 'justify-center lg:justify-start lg:gap-2.5 p-2 lg:px-3 lg:py-2'
            } rounded-md text-xs font-medium text-white/70 hover:text-white hover:bg-white/5 transition-colors cursor-pointer`}
          >
            <IconHome className="w-4 h-4 shrink-0" />
            <span
              className={`whitespace-nowrap overflow-hidden ${
                isCollapsed ? 'hidden' : 'hidden lg:inline'
              }`}
            >
              Public SmartSite Homepage
            </span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[var(--surface-canvas)]">
        {/* Top Header Bar */}
        <header className="h-16 bg-white border-b border-[var(--border)] px-4 sm:px-6 lg:px-8 flex items-center justify-between shrink-0 sticky top-0 z-20 min-w-0">
          {/* Left: Location Selector */}
          <div className="flex items-center gap-2 sm:gap-4 shrink-0 min-w-0">
            <button
              className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-canvas)] text-xs font-semibold text-[var(--text-body)] hover:bg-[var(--surface-bone)] transition-colors cursor-pointer shrink-0"
              aria-label="Select site location"
            >
              <IconBuilding2 className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
              <span className="truncate max-w-[100px] sm:max-w-none">Tower A</span>
              <IconChevronDown className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
            </button>
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
            <div className="flex items-center gap-2 sm:gap-2.5 pl-2 sm:pl-3 border-l border-[var(--border)] shrink-0">
              <div className="w-8 h-8 rounded-full bg-[var(--surface-sidebar)] text-white flex items-center justify-center font-bold text-xs tracking-wider shrink-0">
                SC
              </div>
              <div className="text-left leading-tight hidden md:block">
                <p className="font-semibold text-xs text-[var(--text-body)]">SmartSite</p>
                <p className="text-[11px] text-[var(--text-secondary)]">Demo workspace</p>
              </div>
            </div>
          </div>
        </header>

        {/* Viewport Content */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

export default AppLayout;
