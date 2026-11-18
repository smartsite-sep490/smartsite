import {
  parseTrackedEpisodeMediaSource,
  type TrackedEpisodeMediaSource,
} from './tracked-episode-frames.js';
import type { Page, SafetyAlertStatus, SafetyAlertType } from './management-api.js';
import type { ObservationIdentityDecisionResponse } from './observation-identity-management.js';
import type { EventLocalEpisodeSubject } from './safety-episode-subject.js';
import type { CorrectiveActionStatus, IncidentStatus } from './safety-workflow-api.js';

/** Shared episode transport; source integration and operational rollout are separate gates. */
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
  recipientId?: string;
  readStatus?: 'ALL' | 'UNREAD';
}

export interface SafetyEpisodeInboxItem {
  id: string;
  episode: SafetyEpisodeInboxSummary;
  seenRevision: number;
  unread: boolean;
  firstDeliveredAt: string;
  updatedAt: string;
}
export type SafetyEpisodeInboxSummary = Omit<SafetyEpisodeSummary, 'subject'> & {
  subject: EventLocalEpisodeSubject | { kind: 'TRACKED'; segmentId: string; scopeSha256: string };
};
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

/** Frame presentation groups cases; acknowledgement remains per recipient revision. */
export interface SafetyFrameInboxPage {
  total: number;
  unreadCount: number;
  items: Array<{
    siteId: string;
    cameraId: string;
    frameKey: string;
    siteName: string;
    cameraName: string;
    capturedAt: string;
    unread: boolean;
    /** PPE findings only; Zone assessments are presented separately in cases[].zoneEntries. */
    findingCount: number;
    cases: Array<{
      recipientId: string;
      episodeId: string;
      /** PPE findings only, unlike the all-finding count in an episode detail. */
      findingCount: number;
      unread: boolean;
      contentRevision: number;
      source: (TrackedEpisodeMediaSource & { sha256: string }) | null;
      zoneEntries: Array<{
        requestId: string;
        zoneId: string;
        status: 'PENDING' | 'ALLOWED' | 'DENIED' | 'UNAVAILABLE';
        reasonCode: string | null;
        provenance: string | null;
        laterFrame?: boolean;
      }>;
    }>;
  }>;
}
export type SafetyFrameInboxOptions = Omit<SafetyEpisodeInboxOptions, 'recipientId'> & {
  frameKey?: string;
  cameraId?: string;
};

export function parseSafetyFrameInboxPage(value: unknown): SafetyFrameInboxPage | null {
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  const integer = (v: unknown, min = 0): v is number =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
  const id = (v: unknown): v is string =>
    typeof v === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
  const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
  try {
    if (
      !object(value) ||
      !integer(value.total) ||
      !integer(value.unreadCount) ||
      value.unreadCount > value.total ||
      !Array.isArray(value.items) ||
      value.items.length > value.total
    )
      return null;
    const frameKeys = new Set<string>();
    for (const frame of value.items) {
      if (
        !object(frame) ||
        !id(frame.siteId) ||
        !id(frame.cameraId) ||
        !text(frame.frameKey) ||
        !text(frame.siteName) ||
        !text(frame.cameraName) ||
        !text(frame.capturedAt) ||
        !Number.isFinite(Date.parse(frame.capturedAt)) ||
        typeof frame.unread !== 'boolean' ||
        !integer(frame.findingCount) ||
        !Array.isArray(frame.cases) ||
        !frame.cases.length
      )
        return null;
      const key = JSON.stringify([frame.siteId, frame.cameraId, frame.frameKey]);
      if (frameKeys.has(key)) return null;
      frameKeys.add(key);
      const recipients = new Set<string>(),
        episodes = new Set<string>();
      let findings = 0,
        unread = false;
      for (const entry of frame.cases) {
        if (
          !object(entry) ||
          !id(entry.recipientId) ||
          !id(entry.episodeId) ||
          recipients.has(entry.recipientId) ||
          episodes.has(entry.episodeId) ||
          !integer(entry.findingCount) ||
          !integer(entry.contentRevision, 1) ||
          typeof entry.unread !== 'boolean' ||
          !Array.isArray(entry.zoneEntries)
        )
          return null;
        recipients.add(entry.recipientId);
        episodes.add(entry.episodeId);
        findings += entry.findingCount;
        unread ||= entry.unread;
        if (entry.source !== null) {
          if (!object(entry.source)) return null;
          const { sha256, ...source } = entry.source;
          if (
            typeof sha256 !== 'string' ||
            !/^[a-f0-9]{64}$/.test(sha256) ||
            !parseTrackedEpisodeMediaSource(source)
          )
            return null;
        }
        const requests = new Set<string>();
        for (const zone of entry.zoneEntries) {
          if (
            !object(zone) ||
            !id(zone.requestId) ||
            !id(zone.zoneId) ||
            requests.has(zone.requestId) ||
            (zone.laterFrame !== undefined && typeof zone.laterFrame !== 'boolean') ||
            !['PENDING', 'ALLOWED', 'DENIED', 'UNAVAILABLE'].includes(String(zone.status)) ||
            (zone.reasonCode !== null && !text(zone.reasonCode)) ||
            (zone.provenance !== null &&
              !['UNAVAILABLE', 'SYNTHETIC_TEST', 'TRUSTED_SERVICE'].includes(
                String(zone.provenance),
              )) ||
            (zone.status === 'PENDING' && (zone.reasonCode !== null || zone.provenance !== null))
          )
            return null;
          requests.add(zone.requestId);
        }
      }
      if (
        !Number.isSafeInteger(findings) ||
        findings !== frame.findingCount ||
        unread !== frame.unread
      )
        return null;
    }
    if (value.items.filter((frame) => frame.unread).length > value.unreadCount) return null;
    return value as unknown as SafetyFrameInboxPage;
  } catch {
    return null;
  }
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
