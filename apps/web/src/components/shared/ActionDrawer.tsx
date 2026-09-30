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

  if (isOpen && !shouldRender) {
    setShouldRender(true);
  }

  useEffect(() => {
    if (!isOpen && shouldRender) {
      const timer = setTimeout(() => setShouldRender(false), 500); // match transition duration
      return () => clearTimeout(timer);
    }
  }, [isOpen, shouldRender]);

  if (!shouldRender) return null;

  const badgeColors = {
    error: 'bg-[#FDEBEC] text-[#9F2F2D]',
    warning: 'bg-[#FBF3DB] text-[#956400]',
    info: 'bg-[#F7F6F3] text-[#6B6B6B]',
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden pointer-events-none flex justify-end">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/30 pointer-events-auto transition-opacity duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div
        className={`relative w-full max-w-md h-full bg-[#FBFBFA] border-l border-[#EAEAEA] pointer-events-auto transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Inner Core */}
        <div className="bg-white h-full border border-[#EAEAEA] rounded-lg m-1.5 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-6 py-5 border-b border-[#EAEAEA] flex items-center justify-between bg-white z-10">
            <div className="flex items-center gap-2">
              {badge && (
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase tracking-wider ${badgeColors[badgeType]}`}
                >
                  {badge}
                </span>
              )}
              <h3 className="font-bold text-[#111111] tracking-tight">{title}</h3>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-[#A3A09C] hover:text-[#2F3437] hover:bg-[#F7F6F3] transition-colors active:scale-95"
            >
              <IconX className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">{children}</div>
        </div>
      </div>
    </div>
  );
}
