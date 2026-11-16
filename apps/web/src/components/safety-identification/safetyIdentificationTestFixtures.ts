import { expect } from 'vitest';
import type {
  AccountResponse,
  LoginResponse,
  ManagerOverviewResponse,
  SafetyEpisode,
  SafetyIdentificationHistoryEntry,
  SafetyIdentificationRequest,
  SiteResponse,
  SmartSiteManagementClient,
  WorkerResponse,
} from '@smartsite/api-client';
import { IDENTIFICATION_COPY } from './IdentificationCopy';
import { IDENTIFICATION_WORKSPACE_COPY } from './IdentificationWorkspaceCopy';

export const FORM_EN = IDENTIFICATION_COPY.en;
export const FORM_VI = IDENTIFICATION_COPY.vi;
export const WORKSPACE_EN = IDENTIFICATION_WORKSPACE_COPY.en;
export const WORKSPACE_VI = IDENTIFICATION_WORKSPACE_COPY.vi;

export type ListRequestsArgs = Parameters<
  SmartSiteManagementClient['listSafetyIdentificationRequests']
>;
export type GetRequestArgs = Parameters<
  SmartSiteManagementClient['getSafetyIdentificationRequest']
>;
export type ListHistoryArgs = Parameters<
  SmartSiteManagementClient['listSafetyIdentificationHistory']
>;
export type CreateRequestArgs = Parameters<
  SmartSiteManagementClient['createSafetyIdentificationRequest']
>;
export type ChangeRequestArgs = Parameters<
  SmartSiteManagementClient['changeSafetyIdentificationRequest']
>;

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Distinct realistic RFC-4122 v4 UUIDs across every domain entity (never reused across types).
export const SITE_A_ID = '110e8400-e29b-41d4-a716-446655440101';
export const SITE_B_ID = '220e8400-e29b-41d4-a716-446655440202';
export const EPISODE_1_ID = '330e8400-e29b-41d4-a716-446655440303';
export const EPISODE_2_ID = '440e8400-e29b-41d4-a716-446655440404';
export const SEGMENT_1_ID = '550e8400-e29b-41d4-a716-446655440505';
export const EVENT_2_ID = '660e8400-e29b-41d4-a716-446655440606';
export const CAMERA_1_ID = '770e8400-e29b-41d4-a716-446655440707';
export const REQUEST_1_ID = '880e8400-e29b-41d4-a716-446655440808';
export const REQUEST_2_ID = '990e8400-e29b-41d4-a716-446655440909';
export const REQUEST_3_ID = 'aa0e8400-e29b-41d4-a716-446655441010';
export const OFFICER_ID = 'bb0e8400-e29b-41d4-a716-446655441111';
export const MANAGER_A_ID = 'cc0e8400-e29b-41d4-a716-446655441212';
export const MANAGER_B_ID = 'dd0e8400-e29b-41d4-a716-446655441313';
export const CONTRACTOR_1_ID = 'ee0e8400-e29b-41d4-a716-446655441414';
export const WORKER_1_ID = 'ff0e8400-e29b-41d4-a716-446655441515';

export const ALL_FIXTURE_UUIDS = [
  SITE_A_ID,
  SITE_B_ID,
  EPISODE_1_ID,
  EPISODE_2_ID,
  SEGMENT_1_ID,
  EVENT_2_ID,
  CAMERA_1_ID,
  REQUEST_1_ID,
  REQUEST_2_ID,
  REQUEST_3_ID,
  OFFICER_ID,
  MANAGER_A_ID,
  MANAGER_B_ID,
  CONTRACTOR_1_ID,
  WORKER_1_ID,
] as const;

export const API_URL = 'http://api.smartsite.test';
export const OFFICER_TOKEN = 'tok-officer-secret-9f81c2a0';
export const MANAGER_A_TOKEN = 'tok-manager-a-secret-4b72d1e9';
export const MANAGER_B_TOKEN = 'tok-manager-b-secret-7c35e8f1';

export const SITES_FIXTURE: SiteResponse[] = [
  {
    id: SITE_A_ID,
    code: 'SITE-NORTH',
    name: 'North Tower Site',
    createdAt: '2026-10-01T08:00:00.000Z',
  },
  {
    id: SITE_B_ID,
    code: 'SITE-SOUTH',
    name: 'South Depot Site',
    createdAt: '2026-10-02T08:00:00.000Z',
  },
];

export const WORKERS_SITE_A: WorkerResponse[] = [
  {
    id: WORKER_1_ID,
    siteId: SITE_A_ID,
    contractorId: CONTRACTOR_1_ID,
    userId: null,
    externalId: 'WRK-1042',
    displayName: 'Le Van Hung',
    isActive: true,
    createdAt: '2026-10-05T07:30:00.000Z',
  },
];

export const MANAGER_OVERVIEW_SITE_A: ManagerOverviewResponse = {
  site: { id: SITE_A_ID, code: 'SITE-NORTH', name: 'North Tower Site' },
  contractorCount: 1,
  zoneCount: 3,
  teamCount: 2,
  workerCount: 1,
  contractors: {
    items: [
      {
        id: CONTRACTOR_1_ID,
        code: 'CTR-MEKONG',
        name: 'Mekong Structural Co.',
        teamCount: 2,
        workerCount: 12,
      },
    ],
    total: 1,
  },
};

export const EPISODE_1_DETAIL: SafetyEpisode = {
  id: EPISODE_1_ID,
  siteId: SITE_A_ID,
  cameraId: CAMERA_1_ID,
  subject: {
    kind: 'EVENT_LOCAL',
    eventId: EVENT_2_ID,
    personObservationIndex: 0,
  },
  configurationBundleId: null,
  firstObservedAt: '2026-11-10T08:15:00.000Z',
  lastObservedAt: '2026-11-10T08:17:00.000Z',
  contentRevision: 3,
  collectionState: 'SEALED',
  findingCount: 1,
  identityDecision: null,
  findings: [
    {
      alertId: 'a10e8400-e29b-41d4-a716-446655449901',
      alertType: 'PPE_VIOLATION',
      candidateSubtype: 'PPE_HARD_HAT_MISSING',
      status: 'CONFIRMED',
      alertRevision: 1,
      zoneId: null,
      evidenceRefs: [],
    },
  ],
  workflowLinks: [],
};

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolveFn!: (value: T) => void;
  let rejectFn!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

export function atIndex<T>(items: readonly T[], index: number, label = 'item'): T {
  const value = items[index];
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error(`Expected ${label} at index ${index}`);
  }
  return value;
}

function buildSession(
  accessToken: string,
  user: AccountResponse,
): Pick<LoginResponse, 'accessToken' | 'user'> {
  return { accessToken, user };
}

export function officerSession(
  siteIds: readonly string[] = [SITE_A_ID],
  accessToken = OFFICER_TOKEN,
): Pick<LoginResponse, 'accessToken' | 'user'> {
  return buildSession(accessToken, {
    id: OFFICER_ID,
    username: 'safety.officer.linh',
    displayName: 'Nguyen Thi Linh',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: siteIds.map((siteId) => ({ role: 'SAFETY_OFFICER' as const, siteId })),
  });
}

export function managerSession(
  managerId = MANAGER_A_ID,
  siteIds: readonly string[] = [SITE_A_ID],
  accessToken = MANAGER_A_TOKEN,
  displayName = 'Tran Minh Quan',
): Pick<LoginResponse, 'accessToken' | 'user'> {
  return buildSession(accessToken, {
    id: managerId,
    username: `manager.${managerId.slice(0, 4)}`,
    displayName,
    isActive: true,
    mustChangePassword: false,
    roleAssignments: siteIds.map((siteId) => ({ role: 'SITE_MANAGER' as const, siteId })),
  });
}

export function makeRequest(
  overrides: Partial<SafetyIdentificationRequest> = {},
): SafetyIdentificationRequest {
  return {
    id: REQUEST_1_ID,
    siteId: SITE_A_ID,
    episodeId: EPISODE_1_ID,
    subject: {
      kind: 'TRACKED',
      segmentId: SEGMENT_1_ID,
      scopeSha256: '4a9f0c1d2e3b4a5f6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b',
    },
    assignedTo: MANAGER_A_ID,
    requestedBy: OFFICER_ID,
    reason: 'Verify hard-hat violation subject walking along North Crane Bay',
    status: 'OPEN',
    version: 1,
    dueAt: null,
    evidenceRefs: [],
    evidenceAvailability: {
      status: 'UNAVAILABLE',
      reason: 'SUBJECT_DERIVATIVE_UNAVAILABLE',
    },
    result: null,
    createdAt: '2026-11-11T02:00:00.000Z',
    updatedAt: '2026-11-11T02:00:00.000Z',
    ...overrides,
  };
}

export function makeHistoryEntry(
  version: number,
  kind: SafetyIdentificationHistoryEntry['kind'],
  reason: string,
  assignedTo = MANAGER_A_ID,
  proposal: SafetyIdentificationHistoryEntry['proposal'] = null,
): SafetyIdentificationHistoryEntry {
  return {
    version,
    kind,
    actorId: kind === 'RESPOND' ? MANAGER_A_ID : OFFICER_ID,
    reason,
    assignedTo,
    proposal,
    recordedAt: `2026-11-11T04:${String(10 + version).padStart(2, '0')}:00.000Z`,
  };
}

export function makeUuidForIndex(index: number): string {
  const suffix = String(index).padStart(12, '0');
  return `950e8400-e29b-41d4-a716-${suffix}`;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
