import React, { useState } from 'react';
import { IconPlay, IconPause, IconVolume, IconMaximize, IconGrid } from '../icons';

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
    <div className="w-full bg-white border border-[#EAEAEA] rounded-lg p-1">
      <div className="relative bg-[#041D2E] rounded-md overflow-hidden w-full aspect-video xl:h-[466px] flex flex-col justify-between select-none">
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
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-black/40 border border-white/10">
            <span className="w-1.5 h-1.5 rounded-full bg-[#9F2F2D]" />
            <span className="font-mono text-[10px] font-bold text-white tracking-wider">
              {timestamp}
            </span>
          </div>
        </div>

        {/* Bottom Camera Controls */}
        <div className="relative z-10 px-6 py-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-center justify-between text-white text-xs opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              className="group p-2 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
              title={isPlaying ? 'Pause' : 'Play'}
              aria-label={isPlaying ? 'Pause playback' : 'Resume playback'}
            >
              {isPlaying ? (
                <IconPause className="w-4 h-4 group-active:scale-90 transition-transform" />
              ) : (
                <IconPlay className="w-4 h-4 group-active:scale-90 transition-transform" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsMuted(!isMuted)}
              className="group p-2 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
              title="Sound"
              aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
            >
              <IconVolume className="w-4 h-4 group-active:scale-90 transition-transform" />
            </button>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              disabled
              className="p-2 rounded-md text-white/40 cursor-not-allowed"
              title="Multi-camera grid view is currently unavailable"
              aria-label="Grid view unavailable"
            >
              <IconGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled
              className="p-2 rounded-md text-white/40 cursor-not-allowed"
              title="Fullscreen view is currently unavailable"
              aria-label="Fullscreen view unavailable"
            >
              <IconMaximize className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
