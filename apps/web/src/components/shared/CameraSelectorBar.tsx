import React, { useState, useRef, useEffect } from 'react';
import { IconBuilding2, IconChevronDown, IconCamera } from '../icons';

export interface CameraModel {
  id: string;
  name: string;
  location: string;
  status: 'online' | 'offline';
  capabilities: string[];
}

interface CameraSelectorBarProps {
  siteName: string;
  contextName: string;
  cameras: CameraModel[];
  activeCameraId: string;
  onSelectCamera: (id: string) => void;
}

export function CameraSelectorBar({
  siteName,
  contextName,
  cameras,
  activeCameraId,
  onSelectCamera,
}: CameraSelectorBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeCamera = cameras.find((c) => c.id === activeCameraId) || cameras[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="w-full bg-white border border-slate-200 rounded-xl shadow-sm p-2 flex items-center justify-between mb-6">

      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 pl-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          <IconBuilding2 className="w-4 h-4" />
          <span>{siteName}</span>
        </div>
        <span className="text-slate-300">/</span>

        {/* Camera Dropdown Container */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <IconCamera className="w-4 h-4 text-[#F66B17]" />
            <span className="text-xs font-bold text-slate-900">{activeCamera?.name || activeCamera?.id}</span>
            <IconChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {/* Dropdown Menu */}
          {isOpen && (
            <div className="absolute top-full left-0 mt-1 w-[320px] bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
              <div className="p-2 border-b border-slate-100 bg-slate-50">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2">
                  Available Cameras
                </p>
              </div>
              <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                {cameras.map((camera) => (
                  <button
                    key={camera.id}
                    onClick={() => {
                      onSelectCamera(camera.id);
                      setIsOpen(false);
                    }}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0 ${
                      activeCameraId === camera.id ? 'bg-[#F9FAFC]' : ''
                    }`}
                  >
                    <div className="mt-0.5">
                      <div className={`w-2 h-2 rounded-full ${camera.status === 'online' ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]' : 'bg-slate-300'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-bold truncate ${activeCameraId === camera.id ? 'text-[#F66B17]' : 'text-slate-900'}`}>
                        {camera.name} <span className="text-slate-400 font-mono font-medium text-xs ml-1">({camera.id})</span>
                      </p>
                      <p className="text-xs text-slate-500 truncate mt-0.5">
                        {camera.location}
                      </p>
                      <div className="flex items-center gap-1 mt-1.5">
                        {camera.capabilities.map(cap => (
                          <span key={cap} className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-slate-100 text-slate-600 border border-slate-200">
                            {cap}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <span className="text-slate-300">/</span>
        <div className="flex items-center gap-1.5 text-xs font-bold text-[#041D2E] bg-slate-100 px-2.5 py-1 rounded-md">
          {contextName}
        </div>
      </div>

      <div className="pr-2 flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            {activeCamera?.status === 'online' ? 'Live Stream' : 'Offline'}
          </span>
        </div>
      </div>
    </div>
  );
}
