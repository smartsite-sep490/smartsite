import type { SafetyAlertResponse } from './management-api.js';
import type { EventLocalEpisodeSubject } from './safety-episode-subject.js';

/** Read-only associations in one immutable event, not a cross-frame episode or Worker identity. */
export interface SafetyObservationFindingsResponse {
  subject: EventLocalEpisodeSubject | null;
  items: Pick<
    SafetyAlertResponse,
    'id' | 'alertType' | 'candidateSubtype' | 'zoneId' | 'status' | 'revision'
  >[];
  total: number;
}
