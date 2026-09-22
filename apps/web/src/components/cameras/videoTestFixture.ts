export interface VideoTestTimeline {
  currentTime: number;
  duration: number;
}

export interface NormalizedBoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface AiTimelineObservation {
  type: 'PERSON' | 'PPE' | 'ZONE_ENTRY';
  trackId: number;
  confidence?: number;
  boundingBox?: NormalizedBoundingBox;
  ppeItem?: 'HARD_HAT' | 'SAFETY_VEST';
  regionId?: string;
  status?: 'PRESENT' | 'MISSING';
}

export interface AiTimelineEntry {
  videoTimeSeconds: number;
  event: {
    eventId: string;
    cameraExternalId: string;
    observations: AiTimelineObservation[];
  };
}

export interface AiVideoTimeline {
  schemaVersion: '1.0.0';
  cameraExternalId: string;
  entries: AiTimelineEntry[];
}

export interface VideoTestDetection {
  active: boolean;
  boundingBox: NormalizedBoundingBox | null;
  confidence: number | null;
  eventId: string;
  label: string;
  timecode: string;
  trackId: number | null;
}

export async function loadAiVideoTimeline(path: string): Promise<AiVideoTimeline> {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`AI timeline unavailable (${response.status})`);
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload) || payload.schemaVersion !== '1.0.0' || !Array.isArray(payload.entries)) {
    throw new Error('AI timeline has an invalid format');
  }

  return payload as unknown as AiVideoTimeline;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatTimecode(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = String(safeSeconds % 60).padStart(2, '0');
  return `${String(minutes).padStart(2, '0')}:${remainder}`;
}

function latestRelevantEntry(
  timeline: AiVideoTimeline | null,
  currentTime: number,
  matches: (observation: AiTimelineObservation) => boolean,
): { entry: AiTimelineEntry; observation: AiTimelineObservation } | null {
  if (!timeline || !Number.isFinite(currentTime)) return null;

  const candidates = timeline.entries
    .filter((entry) => Math.abs(entry.videoTimeSeconds - currentTime) <= 0.75)
    .flatMap((entry) =>
      entry.event.observations.filter(matches).map((observation) => ({ entry, observation })),
    );

  return candidates.sort(
    (first, second) =>
      Math.abs(first.entry.videoTimeSeconds - currentTime) -
      Math.abs(second.entry.videoTimeSeconds - currentTime),
  )[0] ?? null;
}

function detectionFor(
  videoTimeline: VideoTestTimeline,
  timeline: AiVideoTimeline | null,
  type: 'MF05' | 'MF06',
): VideoTestDetection {
  const match =
    type === 'MF05'
      ? latestRelevantEntry(
          timeline,
          videoTimeline.currentTime,
          (observation) => observation.type === 'PPE' && observation.status === 'MISSING',
        )
      : latestRelevantEntry(
          timeline,
          videoTimeline.currentTime,
          (observation) => observation.type === 'ZONE_ENTRY',
        );

  if (!match) {
    return {
      active: false,
      boundingBox: null,
      confidence: null,
      eventId: timeline ? `${type}-NO-EVENT` : `${type}-WAITING-FOR-AI-RUN`,
      label: timeline ? `${type} NO EVENT` : `${type} WAITING FOR AI RUN`,
      timecode: formatTimecode(videoTimeline.currentTime),
      trackId: null,
    };
  }

  const person = match.entry.event.observations.find(
    (observation) => observation.type === 'PERSON' && observation.trackId === match.observation.trackId,
  );
  const detail =
    type === 'MF05'
      ? `MISSING ${match.observation.ppeItem === 'HARD_HAT' ? 'HARD HAT' : 'SAFETY VEST'}`
      : 'ZONE ENTRY';

  return {
    active: true,
    boundingBox: person?.boundingBox ?? null,
    confidence: match.observation.confidence ?? person?.confidence ?? null,
    eventId: match.entry.event.eventId,
    label: `${type} ${detail}`,
    timecode: formatTimecode(match.entry.videoTimeSeconds),
    trackId: match.observation.trackId,
  };
}

export function getPpeVideoTestDetection(
  videoTimeline: VideoTestTimeline,
  timeline: AiVideoTimeline | null,
): VideoTestDetection {
  return detectionFor(videoTimeline, timeline, 'MF05');
}

export function getZoneVideoTestDetection(
  videoTimeline: VideoTestTimeline,
  timeline: AiVideoTimeline | null,
): VideoTestDetection {
  return detectionFor(videoTimeline, timeline, 'MF06');
}
