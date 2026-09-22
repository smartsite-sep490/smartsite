import React, { useEffect, useState } from 'react';
import { IconX } from '../icons';

interface ActionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  badge?: string;
  badgeType?: 'error' | 'warning' | 'info';
  children: React.ReactNode;
}

export function ActionDrawer({
  isOpen,
  onClose,
  title,
  badge,
  badgeType = 'info',
  children,
}: ActionDrawerProps) {
  // We use a slight delay for the mount/unmount logic to allow CSS transitions to play
  const [shouldRender, setShouldRender] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
    } else {
      const timer = setTimeout(() => setShouldRender(false), 500); // match transition duration
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!shouldRender) return null;

  const badgeColors = {
    error: 'bg-red-100 text-red-700',
    warning: 'bg-orange-100 text-orange-700',
    info: 'bg-slate-100 text-slate-700',
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden pointer-events-none flex justify-end">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/30 backdrop-blur-sm pointer-events-auto transition-opacity duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div
        className={`relative w-full max-w-md h-full bg-slate-50 border-l border-slate-200 pointer-events-auto p-1.5 shadow-2xl transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Inner Core (Double-bezel style) */}
        <div className="bg-white h-full rounded-[calc(2rem-0.375rem)] shadow-[inset_0_1px_1px_rgba(255,255,255,1)] border border-slate-100 flex flex-col overflow-hidden">
          
          {/* Header */}
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-white/80 backdrop-blur-md z-10">
            <div className="flex items-center gap-2">
              {badge && (
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase tracking-wider ${badgeColors[badgeType]}`}>
                  {badge}
                </span>
              )}
              <h3 className="font-bold text-slate-900 tracking-tight">{title}</h3>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors active:scale-95"
            >
              <IconX className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            {children}
          </div>
          
        </div>
      </div>
    </div>
  );
}
