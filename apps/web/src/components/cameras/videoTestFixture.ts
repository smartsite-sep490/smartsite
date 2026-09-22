export interface VideoTestTimeline {
  currentTime: number;
  duration: number;
}

export interface VideoTestDetection {
  active: boolean;
  confidence: number | null;
  eventId: string;
  label: string;
  timecode: string;
}

function progressOf({ currentTime, duration }: VideoTestTimeline): number {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }

  return Math.min(Math.max(currentTime / duration, 0), 1);
}

function formatTimecode(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = String(safeSeconds % 60).padStart(2, '0');
  return `${String(minutes).padStart(2, '0')}:${remainder}`;
}

function detectionFor(timeline: VideoTestTimeline, kind: 'MF05' | 'MF06'): VideoTestDetection {
  const progress = progressOf(timeline);
  // Local UI fixture: the violation is visible through the middle 64% of the clip.
  // This gives QA a deterministic way to pause/play and verify state changes without
  // pretending that the browser is running the Python detector.
  const active = timeline.duration <= 0 || (progress >= 0.18 && progress <= 0.82);

  return {
    active,
    confidence: active ? 97 : null,
    eventId: active ? `${kind}-LOCAL-0001` : `${kind}-SCANNING`,
    label: active ? `${kind} VIOLATION · 97%` : `${kind} SCANNING`,
    timecode: formatTimecode(timeline.currentTime),
  };
}

export function getPpeVideoTestDetection(timeline: VideoTestTimeline): VideoTestDetection {
  return detectionFor(timeline, 'MF05');
}

export function getZoneVideoTestDetection(timeline: VideoTestTimeline): VideoTestDetection {
  return detectionFor(timeline, 'MF06');
}
