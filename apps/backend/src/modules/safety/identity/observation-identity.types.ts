export interface ObservationPersonBoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  coordinateSpace: 'NORMALIZED_0_1';
}

export interface ObservationSubjectRef {
  eventId: string;
  personObservationIndex: number;
  payloadHash: string;
  cameraId: string;
  cameraExternalId: string;
  streamSessionId: string;
  capturedAt: string;
  trackId: number;
  personBoundingBox: ObservationPersonBoundingBox;
}

export type ObservationSubjectUnavailableReason =
  | 'INVALID_SUBJECT_INDEX'
  | 'OBSERVATIONS_UNAVAILABLE'
  | 'SUBJECT_NOT_FOUND'
  | 'NOT_PERSON'
  | 'INVALID_TRACK_ID'
  | 'AMBIGUOUS_PERSON_TRACK'
  | 'PERSON_BOX_UNAVAILABLE';

export type ObservationSubjectSelection =
  | {
      eligible: true;
      personObservationIndex: number;
      trackId: number;
      personBoundingBox: ObservationPersonBoundingBox;
    }
  | {
      eligible: false;
      personObservationIndex: number;
      trackId?: number;
      unavailableReason: ObservationSubjectUnavailableReason;
    };
