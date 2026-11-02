import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import type { SafetyEpisodeInboxItem } from '@smartsite/contracts/safety-episodes';
import {
  SafetyEpisodeInboxWorkspace,
  type SafetyEpisodeInboxClient,
  type SafetyEpisodeInboxSiteOption,
  type SafetyEpisodeInboxWorkspaceProps,
} from './SafetyEpisodeInboxWorkspace';

export const SITE_A_ID = '11111111-1111-4111-8111-111111111111';
export const SITE_B_ID = '22222222-2222-4222-8222-222222222222';
export const SITE_UNASSIGNED_ID = '33333333-3333-4333-8333-333333333333';

export const CAMERA_A_ID = '44444444-4444-4444-8444-444444444444';
export const CAMERA_B_ID = '55555555-5555-4555-8555-555555555555';

export const SEGMENT_1_ID = '66666666-6666-4666-8666-666666666666';
export const EVENT_1_ID = '77777777-7777-4777-8777-777777777777';
export const SCOPE_SHA256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export const RECIPIENT_A_1_ID = 'aaaa1111-1111-4111-8111-111111111101';
export const RECIPIENT_B_1_ID = 'bbbb2222-2222-4222-8222-222222222201';
export const RECIPIENT_UNASSIGNED_ID = 'cccc3333-3333-4333-8333-333333333301';

export const EPISODE_A_1_ID = 'dddd1111-1111-4111-8111-111111111101';
export const EPISODE_B_1_ID = 'eeee2222-2222-4222-8222-222222222201';
export const EPISODE_UNASSIGNED_ID = 'ffff3333-3333-4333-8333-333333333301';

export const AUTHORIZED_SITES: readonly SafetyEpisodeInboxSiteOption[] = [
  { id: SITE_A_ID, name: 'North Tower' },
  { id: SITE_B_ID, name: 'South Depot' },
];

export const ITEM_A_1: SafetyEpisodeInboxItem = {
  id: RECIPIENT_A_1_ID,
  episode: {
    id: EPISODE_A_1_ID,
    siteId: SITE_A_ID,
    cameraId: CAMERA_A_ID,
    subject: {
      kind: 'TRACKED',
      segmentId: SEGMENT_1_ID,
      scopeSha256: SCOPE_SHA256,
    },
    configurationBundleId: null,
    firstObservedAt: '2026-11-01T08:00:00.000Z',
    lastObservedAt: '2026-11-01T08:05:00.000Z',
    contentRevision: 2,
    collectionState: 'COLLECTING',
    findingCount: 4,
  },
  seenRevision: 0,
  unread: true,
  firstDeliveredAt: '2026-11-01T08:00:05.000Z',
  updatedAt: '2026-11-01T08:05:05.000Z',
};

export const ITEM_B_1: SafetyEpisodeInboxItem = {
  id: RECIPIENT_B_1_ID,
  episode: {
    id: EPISODE_B_1_ID,
    siteId: SITE_B_ID,
    cameraId: CAMERA_B_ID,
    subject: {
      kind: 'EVENT_LOCAL',
      eventId: EVENT_1_ID,
      personObservationIndex: 1,
    },
    configurationBundleId: null,
    firstObservedAt: '2026-11-01T07:30:00.000Z',
    lastObservedAt: '2026-11-01T07:32:00.000Z',
    contentRevision: 1,
    collectionState: 'SEALED',
    findingCount: 2,
  },
  seenRevision: 1,
  unread: false,
  firstDeliveredAt: '2026-11-01T07:30:05.000Z',
  updatedAt: '2026-11-01T07:35:00.000Z',
};

export const ITEM_UNASSIGNED: SafetyEpisodeInboxItem = {
  id: RECIPIENT_UNASSIGNED_ID,
  episode: {
    id: EPISODE_UNASSIGNED_ID,
    siteId: SITE_UNASSIGNED_ID,
    cameraId: CAMERA_A_ID,
    subject: {
      kind: 'TRACKED',
      segmentId: SEGMENT_1_ID,
      scopeSha256: SCOPE_SHA256,
    },
    configurationBundleId: null,
    firstObservedAt: '2026-11-01T06:00:00.000Z',
    lastObservedAt: '2026-11-01T06:05:00.000Z',
    contentRevision: 1,
    collectionState: 'COLLECTING',
    findingCount: 1,
  },
  seenRevision: 0,
  unread: true,
  firstDeliveredAt: '2026-11-01T06:00:05.000Z',
  updatedAt: '2026-11-01T06:05:05.000Z',
};

export function buildFillerInboxItem(index: number, siteId = SITE_A_ID): SafetyEpisodeInboxItem {
  const hex = index.toString(16).padStart(2, '0');
  const minute = String(index % 60).padStart(2, '0');
  return {
    id: `99990000-0000-4000-8000-0000000000${hex}`,
    episode: {
      id: `88880000-0000-4000-8000-0000000000${hex}`,
      siteId,
      cameraId: CAMERA_A_ID,
      subject: {
        kind: 'TRACKED',
        segmentId: `77770000-0000-4000-8000-0000000000${hex}`,
        scopeSha256: SCOPE_SHA256,
      },
      configurationBundleId: null,
      firstObservedAt: `2026-11-01T05:${minute}:00.000Z`,
      lastObservedAt: `2026-11-01T05:${minute}:30.000Z`,
      contentRevision: 1,
      collectionState: 'COLLECTING',
      findingCount: 1,
    },
    seenRevision: 0,
    unread: true,
    firstDeliveredAt: `2026-11-01T05:${minute}:05.000Z`,
    updatedAt: `2026-11-01T05:${minute}:35.000Z`,
  };
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | null = null;
  let rejectFn: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return {
    promise,
    resolve(value: T) {
      if (!resolveFn) {
        throw new Error('Deferred resolver not initialized');
      }
      resolveFn(value);
    },
    reject(reason?: unknown) {
      if (!rejectFn) {
        throw new Error('Deferred rejecter not initialized');
      }
      rejectFn(reason);
    },
  };
}

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

export function renderWorkspace(
  overrides: Partial<SafetyEpisodeInboxWorkspaceProps> = {},
  queryClient = createTestQueryClient(),
) {
  const defaultClient: SafetyEpisodeInboxClient = {
    listSafetyEpisodeInbox: vi.fn<SafetyEpisodeInboxClient['listSafetyEpisodeInbox']>(),
    readSafetyEpisodeInbox: vi.fn<SafetyEpisodeInboxClient['readSafetyEpisodeInbox']>(),
  };

  const props: SafetyEpisodeInboxWorkspaceProps = {
    client: defaultClient,
    token: 'secret-jwt-token-inbox-alpha',
    scopeKey: 'user-1::org-1::safety-inbox',
    apiUrl: 'https://api.smartsite.local',
    sites: AUTHORIZED_SITES,
    onOpenEpisode: vi.fn(),
    ...overrides,
  };

  const view = render(
    <QueryClientProvider client={queryClient}>
      <SafetyEpisodeInboxWorkspace {...props} />
    </QueryClientProvider>,
  );

  return {
    ...view,
    queryClient,
    props,
  };
}
