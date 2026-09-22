import React, { useState } from 'react';
import {
  IconPlay,
  IconPause,
  IconVolume,
  IconMaximize,
  IconGrid,
} from '../icons';

interface CameraFeedProps {
  cameraId: string;
  zoneName: string;
  imageUrl: string;
  timestamp?: string;
  children?: React.ReactNode;
}

export function CameraFeed({
  cameraId,
  zoneName,
  imageUrl,
  timestamp = 'LIVE - 10:42:16',
  children,
}: CameraFeedProps) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);

  return (
    <div className="w-full bg-slate-50 border border-slate-200 p-1.5 rounded-[2rem] shadow-sm">
      <div className="relative bg-[#041D2E] rounded-[calc(2rem-0.375rem)] overflow-hidden shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] w-full aspect-video xl:h-[466px] flex flex-col justify-between select-none">
        {/* Camera Output */}
        <div className="absolute inset-0">
          <img
            src={imageUrl}
            alt={`Live feed from ${cameraId}`}
            className="w-full h-full object-cover opacity-90 mix-blend-lighten"
          />

          {/* Custom overlays from parent (e.g. bounding boxes) */}
          {children}
        </div>

        {/* Top Camera Metadata */}
        <div className="relative z-10 px-6 py-5 flex items-start justify-between text-white bg-gradient-to-b from-black/60 to-transparent">
          <div className="flex flex-col gap-1">
            <span className="font-bold text-sm tracking-wide text-white drop-shadow-md">
              {cameraId}
            </span>
            <span className="text-white/90 font-semibold text-[10px] tracking-[0.1em] uppercase drop-shadow-md">
              {zoneName}
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#DF2225] animate-pulse" />
            <span className="font-mono text-[10px] font-bold text-white tracking-wider">
              {timestamp}
            </span>
          </div>
        </div>

        {/* Bottom Camera Controls */}
        <div className="relative z-10 px-6 py-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-center justify-between text-white text-xs opacity-0 hover:opacity-100 transition-opacity duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="group p-2 rounded-full hover:bg-white/10 transition-colors"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <IconPause className="w-4 h-4 group-active:scale-90 transition-transform" />
              ) : (
                <IconPlay className="w-4 h-4 group-active:scale-90 transition-transform" />
              )}
            </button>
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="group p-2 rounded-full hover:bg-white/10 transition-colors"
              title="Sound"
            >
              <IconVolume className="w-4 h-4 group-active:scale-90 transition-transform" />
            </button>
          </div>

          <div className="flex items-center gap-4">
            <button className="group p-2 rounded-full hover:bg-white/10 transition-colors" title="Grid">
              <IconGrid className="w-4 h-4 group-active:scale-90 transition-transform" />
            </button>
            <button className="group p-2 rounded-full hover:bg-white/10 transition-colors" title="Fullscreen">
              <IconMaximize className="w-4 h-4 group-active:scale-90 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
