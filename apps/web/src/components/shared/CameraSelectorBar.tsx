import React, { useState, useRef, useEffect, useId } from 'react';
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
  const menuId = useId();

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
    <div className="w-full bg-white border border-[#EAEAEA] rounded-lg p-2 flex items-center justify-between mb-6">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 pl-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#6B6B6B]">
          <IconBuilding2 className="w-4 h-4" />
          <span>{siteName}</span>
        </div>
        <span className="text-[#EAEAEA]">/</span>

        {/* Camera Dropdown Container */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="Select camera"
            aria-expanded={isOpen}
            aria-controls={menuId}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-[#F7F6F3] transition-colors cursor-pointer"
          >
            <IconCamera className="w-4 h-4 text-[#2F3437]" />
            <span className="text-xs font-bold text-[#111111]">
              {activeCamera?.name || activeCamera?.id}
            </span>
            <IconChevronDown className="w-3 h-3 text-[#6B6B6B]" />
          </button>

          {/* Dropdown Menu */}
          {isOpen && (
            <div
              id={menuId}
              className="absolute top-full left-0 mt-1 w-[320px] bg-white border border-[#EAEAEA] rounded-lg shadow-sm z-50 overflow-hidden"
            >
              <div className="p-2 border-b border-[#EAEAEA] bg-[#FBFBFA]">
                <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest px-2">
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
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-[#FBFBFA] transition-colors border-b border-[#EAEAEA]/40 last:border-0 ${
                      activeCameraId === camera.id ? 'bg-[#FBFBFA]' : ''
                    }`}
                  >
                    <div className="mt-0.5">
                      <div
                        className={`w-2 h-2 rounded-full ${camera.status === 'online' ? 'bg-[#346538]' : 'bg-[#A3A09C]'}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-bold truncate ${activeCameraId === camera.id ? 'text-[#111111]' : 'text-[#2F3437]'}`}
                      >
                        {camera.name}{' '}
                        <span className="text-[#6B6B6B] font-mono font-medium text-xs ml-1">
                          ({camera.id})
                        </span>
                      </p>
                      <p className="text-xs text-[#6B6B6B] truncate mt-0.5">{camera.location}</p>
                      <div className="flex items-center gap-1 mt-1.5">
                        {camera.capabilities.map((cap) => (
                          <span
                            key={cap}
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-[#F7F6F3] text-[#6B6B6B] border border-[#EAEAEA]"
                          >
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

        <span className="text-[#EAEAEA]">/</span>
        <div className="flex items-center gap-1.5 text-xs font-bold text-[#2F3437] bg-[#F7F6F3] px-2.5 py-1 rounded-md">
          {contextName}
        </div>
      </div>

      <div className="pr-2 flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <div
            className={`w-1.5 h-1.5 rounded-full ${activeCamera?.status === 'online' ? 'bg-[#346538]' : 'bg-[#A3A09C]'}`}
          />
          <span className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest">
            {activeCamera?.status === 'online' ? 'Live Stream' : 'Offline'}
          </span>
        </div>
      </div>
    </div>
  );
}
