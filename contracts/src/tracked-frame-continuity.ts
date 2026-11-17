/** Technical producer claims only; parsing never qualifies continuity or Worker identity. */
export type ContinuityResetReason =
  | 'RECONNECT'
  | 'AMBIGUOUS_ASSOCIATION'
  | 'LOST_TRACK'
  | 'FRAME_DISCONTINUITY'
  | 'VIEW_CHANGE'
  | 'CONFIGURATION_CHANGE'
  | 'EXPIRED_INTERVAL'
  | 'PROFILE_CHANGE';

export interface TrackedFrameSubject {
  personObservationIndex: number;
  segmentId: string;
  link:
    | { kind: 'START'; reason: 'INITIAL' | ContinuityResetReason }
    | { kind: 'CONTINUE'; previousEventId: string; previousPersonObservationIndex: number };
}

export interface TrackedFrameContinuity {
  schemaVersion: '1.0.0';
  profileSha256: string;
  coverage:
    | { status: 'COMPLETE' }
    | {
        status: 'INCOMPLETE';
        reason: 'INFERENCE_ERROR' | 'AMBIGUOUS_PROCESSING' | 'FRAME_DROPPED';
      };
  subjects: TrackedFrameSubject[];
  retiredSegments: { segmentId: string; reason: ContinuityResetReason }[];
}
