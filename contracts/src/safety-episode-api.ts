import type { Page, SafetyAlertStatus, SafetyAlertType } from './management-api.js';
import type { ObservationIdentityDecisionResponse } from './observation-identity-management.js';
import type { EventLocalEpisodeSubject } from './safety-episode-subject.js';
import type { CorrectiveActionStatus, IncidentStatus } from './safety-workflow-api.js';

/** Transport preparation only; no episode endpoints or delivery cutover are active yet. */
export interface SafetyEpisodeSummary {
  id: string;
  siteId: string;
  cameraId: string;
  subject: EventLocalEpisodeSubject;
  configurationBundleId: string | null;
  firstObservedAt: string;
  lastObservedAt: string;
  contentRevision: number;
  collectionState: 'COLLECTING' | 'SEALED';
  findingCount: number;
}

export interface SafetyEpisodeEvidenceRef {
  eventId: string;
  personObservationIndex: number;
  evidenceIndex: number;
  sha256: string;
  available: boolean;
}

export interface SafetyEpisodeFinding {
  alertId: string;
  alertType: SafetyAlertType;
  candidateSubtype: string;
  status: SafetyAlertStatus;
  alertRevision: number;
  zoneId: string | null;
  evidenceRefs: SafetyEpisodeEvidenceRef[];
}

export interface SafetyEpisode extends SafetyEpisodeSummary {
  /** Exact-observation human decision, including CLEAR; technical candidates are not identity. */
  identityDecision: ObservationIdentityDecisionResponse | null;
  findings: SafetyEpisodeFinding[];
  workflowLinks: {
    incidentId: string;
    status: IncidentStatus;
    actions: { actionId: string; status: CorrectiveActionStatus }[];
  }[];
}

export interface SafetyEpisodeListOptions {
  offset?: number;
  limit?: number;
  cameraId?: string;
  zoneId?: string;
}
export type SafetyEpisodePage = Page<SafetyEpisodeSummary>;

export interface SafetyEpisodeInboxOptions {
  offset?: number;
  limit?: number;
  siteId?: string;
  readStatus?: 'ALL' | 'UNREAD';
}

export interface SafetyEpisodeInboxItem {
  id: string;
  episode: SafetyEpisodeSummary;
  seenRevision: number;
  unread: boolean;
  firstDeliveredAt: string;
  updatedAt: string;
}
export interface SafetyEpisodeInboxPage extends Page<SafetyEpisodeInboxItem> {
  unreadCount: number;
}
export interface SafetyEpisodeReadCommand {
  seenRevision: number;
}
export interface SafetyEpisodeReadResponse {
  id: string;
  contentRevision: number;
  seenRevision: number;
  unread: boolean;
}

/** Backend still checks current revision and recipient ownership in its transaction. */
export function parseSafetyEpisodeReadCommand(value: unknown): SafetyEpisodeReadCommand | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 1 || keys[0] !== 'seenRevision') return null;
    const field = Object.getOwnPropertyDescriptor(value, 'seenRevision');
    if (!field || !field.enumerable || !('value' in field)) return null;
    const revision: unknown = field.value;
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1)
      return null;
    return { seenRevision: revision };
  } catch {
    return null;
  }
}
