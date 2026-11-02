// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import type {
  SafetyEpisodeInboxItem,
  SafetyEpisodeInboxPage,
  SafetyEpisodeReadResponse,
} from '@smartsite/contracts/safety-episodes';
import type {
  TrackedEpisodeDetail,
  TrackedEpisodeObservationPage,
  TrackedEpisodeOriginalObservation,
} from '@smartsite/contracts/tracked-episode-frames';
import { changeUiLanguage } from '../../i18n/runtime';
import {
  SafetyEpisodeTriageWorkspace,
  type SafetyEpisodeTriageClient,
  type SafetyEpisodeTriageSiteOption,
} from './SafetyEpisodeTriageWorkspace';

if (typeof URL.createObjectURL !== 'function') {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: () => 'blob:polyfill-initial',
  });
}

if (typeof URL.revokeObjectURL !== 'function') {
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
}

const SITE_A_ID = '11111111-1111-4111-8111-111111111111';
const SITE_B_ID = '22222222-2222-4222-8222-222222222222';
const CAMERA_A_ID = '33333333-3333-4333-8333-333333333331';
const CAMERA_B_ID = '33333333-3333-4333-8333-333333333332';
const EPISODE_A_ID = '44444444-4444-4444-8444-444444444441';
const EPISODE_B_ID = '44444444-4444-4444-8444-444444444442';
const RECIPIENT_A_ID = '55555555-5555-4555-8555-555555555551';
const RECIPIENT_B_ID = '55555555-5555-4555-8555-555555555552';
const EVENT_1_ID = '66666666-6666-4666-8666-666666666661';
const EVENT_2_ID = '66666666-6666-4666-8666-666666666662';
const EVENT_B_ID = '66666666-6666-4666-8666-666666666663';
const SEGMENT_A_ID = '77777777-7777-4777-8777-777777777771';
const SCOPE_SHA256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const FINDING_HELMET_ID = 'aaaa1111-1111-4111-8111-111111111111';
const FINDING_VEST_ID = 'bbbb2222-2222-4222-8222-222222222222';

const PAYLOAD_HASH_EVENT_1 = '1111111111111111111111111111111111111111111111111111111111111111';
const PAYLOAD_HASH_EVENT_2 = '2222222222222222222222222222222222222222222222222222222222222222';

const SHA_EVENT1_FRAME0 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA_EVENT2_FRAME0 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const PAGE_1_FENCE = '18446744073709551614';

const SITES_AB: readonly SafetyEpisodeTriageSiteOption[] = [
  { id: SITE_A_ID, name: 'North Tower' },
  { id: SITE_B_ID, name: 'South Gate' },
];

const ITEM_A_TRACKED: SafetyEpisodeInboxItem = {
  id: RECIPIENT_A_ID,
  episode: {
    id: EPISODE_A_ID,
    siteId: SITE_A_ID,
    cameraId: CAMERA_A_ID,
    subject: {
      kind: 'TRACKED',
      segmentId: SEGMENT_A_ID,
      scopeSha256: SCOPE_SHA256,
    },
    configurationBundleId: null,
    firstObservedAt: '2026-11-01T08:00:00.000Z',
    lastObservedAt: '2026-11-01T08:05:00.000Z',
    contentRevision: 3,
    collectionState: 'COLLECTING',
    findingCount: 2,
  },
  seenRevision: 0,
  unread: true,
  firstDeliveredAt: '2026-11-01T08:00:05.000Z',
  updatedAt: '2026-11-01T08:05:05.000Z',
};

const ITEM_B_EVENT_LOCAL: SafetyEpisodeInboxItem = {
  id: RECIPIENT_B_ID,
  episode: {
    id: EPISODE_B_ID,
    siteId: SITE_B_ID,
    cameraId: CAMERA_B_ID,
    subject: {
      kind: 'EVENT_LOCAL',
      eventId: EVENT_B_ID,
      personObservationIndex: 1,
    },
    configurationBundleId: null,
    firstObservedAt: '2026-11-01T07:30:00.000Z',
    lastObservedAt: '2026-11-01T07:32:00.000Z',
    contentRevision: 1,
    collectionState: 'SEALED',
    findingCount: 1,
  },
  seenRevision: 1,
  unread: false,
  firstDeliveredAt: '2026-11-01T07:30:05.000Z',
  updatedAt: '2026-11-01T07:35:00.000Z',
};

const OBS_1_HELMET: TrackedEpisodeOriginalObservation = {
  alertId: FINDING_HELMET_ID,
  eventId: EVENT_1_ID,
  personObservationIndex: 0,
  payloadHash: PAYLOAD_HASH_EVENT_1,
  sourceSequence: PAGE_1_FENCE,
  capturedAt: '2026-11-01T08:05:00.000Z',
  observationIndexes: [1, 3],
  frames: [{ evidenceIndex: 0, sha256: SHA_EVENT1_FRAME0 }],
};

const OBS_2_VEST: TrackedEpisodeOriginalObservation = {
  alertId: FINDING_VEST_ID,
  eventId: EVENT_2_ID,
  personObservationIndex: 0,
  payloadHash: PAYLOAD_HASH_EVENT_2,
  sourceSequence: '18446744073709551570',
  capturedAt: '2026-11-01T08:02:00.000Z',
  observationIndexes: [2],
  frames: [{ evidenceIndex: 0, sha256: SHA_EVENT2_FRAME0 }],
};

const TRACKED_EPISODE_A_DETAIL: TrackedEpisodeDetail = {
  episodeId: EPISODE_A_ID,
  siteId: SITE_A_ID,
  cameraId: CAMERA_A_ID,
  subject: {
    kind: 'TRACKED',
    segmentId: SEGMENT_A_ID,
    scopeSha256: SCOPE_SHA256,
  },
  firstObservedAt: '2026-11-01T08:00:00.000Z',
  lastObservedAt: '2026-11-01T08:05:00.000Z',
  contentRevision: 3,
  collectionState: 'COLLECTING',
  findings: [
    {
      alertId: FINDING_HELMET_ID,
      alertType: 'PPE_VIOLATION',
      candidateSubtype: 'MISSING_HELMET',
      status: 'PENDING_REVIEW',
      alertRevision: 1,
      zoneId: null,
      observationCount: 2,
    },
    {
      alertId: FINDING_VEST_ID,
      alertType: 'PPE_VIOLATION',
      candidateSubtype: 'MISSING_VEST',
      status: 'PENDING_REVIEW',
      alertRevision: 2,
      zoneId: null,
      observationCount: 1,
    },
  ],
};

const TRACKED_OBSERVATION_PAGE_A: TrackedEpisodeObservationPage = {
  episodeId: EPISODE_A_ID,
  contentRevision: 3,
  throughSequence: PAGE_1_FENCE,
  offset: 0,
  limit: 20,
  total: 2,
  hasMore: false,
  items: [OBS_1_HELMET, OBS_2_VEST],
};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
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

function createUnexpectedMediaFetchStub(): SafetyEpisodeTriageClient['readTrackedEpisodeMedia'] {
  return vi.fn<SafetyEpisodeTriageClient['readTrackedEpisodeMedia']>(async () => {
    throw new Error('Unexpected auto-fetch of readTrackedEpisodeMedia');
  });
}

function createUnexpectedIdentityFetchStub(): SafetyEpisodeTriageClient['getTrackedObservationIdentity'] {
  return vi.fn<SafetyEpisodeTriageClient['getTrackedObservationIdentity']>(async () => {
    throw new Error('Unexpected auto-fetch of getTrackedObservationIdentity');
  });
}

function makeMockClient(overrides?: Partial<SafetyEpisodeTriageClient>): SafetyEpisodeTriageClient {
  const listSafetyEpisodeInbox = vi.fn<SafetyEpisodeTriageClient['listSafetyEpisodeInbox']>(
    async (): Promise<SafetyEpisodeInboxPage> => ({
      items: [ITEM_A_TRACKED, ITEM_B_EVENT_LOCAL],
      total: 2,
      unreadCount: 1,
    }),
  );
  const readSafetyEpisodeInbox = vi.fn<SafetyEpisodeTriageClient['readSafetyEpisodeInbox']>(
    async (_token, id, input): Promise<SafetyEpisodeReadResponse> => ({
      id,
      contentRevision: 3,
      seenRevision: input.seenRevision,
      unread: false,
    }),
  );
  const getTrackedEpisode = vi.fn<SafetyEpisodeTriageClient['getTrackedEpisode']>(
    async (): Promise<TrackedEpisodeDetail> => TRACKED_EPISODE_A_DETAIL,
  );
  const listTrackedEpisodeObservations = vi.fn<
    SafetyEpisodeTriageClient['listTrackedEpisodeObservations']
  >(async (): Promise<TrackedEpisodeObservationPage> => TRACKED_OBSERVATION_PAGE_A);
  const readTrackedEpisodeMedia = createUnexpectedMediaFetchStub();
  const getTrackedObservationIdentity = createUnexpectedIdentityFetchStub();

  return {
    listSafetyEpisodeInbox,
    readSafetyEpisodeInbox,
    getTrackedEpisode,
    listTrackedEpisodeObservations,
    readTrackedEpisodeMedia,
    getTrackedObservationIdentity,
    ...overrides,
  };
}

describe('SafetyEpisodeTriageWorkspace', () => {
  beforeEach(() => {
    window.localStorage.clear();
    changeUiLanguage('vi');
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    changeUiLanguage('en');
    vi.restoreAllMocks();
  });

  it('opens a TRACKED row into TrackedEpisodeEvidenceWorkspace with exact siteId + episodeId without marking read, and Back unmounts detail while reusing inbox cache', async () => {
    const queryClient = makeQueryClient();
    const client = makeMockClient();
    const onOpenEventLocal = vi.fn();
    const secretToken = 'jwt-triage-secret-token-alpha';

    render(
      <QueryClientProvider client={queryClient}>
        <SafetyEpisodeTriageWorkspace
          client={client}
          token={secretToken}
          scopeKey="user:1:session:1"
          apiUrl="http://localhost:4000"
          sites={SITES_AB}
          onOpenEventLocal={onOpenEventLocal}
        />
      </QueryClientProvider>,
    );

    const openTrackedBtn = await screen.findByTestId(`safety-inbox-open-${RECIPIENT_A_ID}`);
    expect(client.listSafetyEpisodeInbox).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('tracked-episode-workspace')).toBeNull();

    openTrackedBtn.focus();
    fireEvent.click(openTrackedBtn);

    expect(await screen.findByTestId('tracked-episode-workspace')).toBeTruthy();
    expect(screen.getByTestId('safety-triage-site-label').textContent).toBe('North Tower');
    expect(screen.getByTestId('safety-triage-detail-heading').textContent).toBe('Hồ sơ theo dõi');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('safety-triage-detail-heading'));
    });

    const inboxPane = screen.getByTestId('safety-episode-triage-inbox-pane');
    expect(inboxPane.hidden).toBe(true);

    await waitFor(() => {
      expect(client.getTrackedEpisode).toHaveBeenCalledTimes(1);
      expect(client.listTrackedEpisodeObservations).toHaveBeenCalledTimes(1);
      expect(screen.getAllByTestId('tracked-history-item')).toHaveLength(2);
    });

    expect(client.getTrackedEpisode).toHaveBeenCalledWith(
      secretToken,
      SITE_A_ID,
      EPISODE_A_ID,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(client.listTrackedEpisodeObservations).toHaveBeenCalledWith(
      secretToken,
      SITE_A_ID,
      EPISODE_A_ID,
      { offset: 0, limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    expect(client.readSafetyEpisodeInbox).not.toHaveBeenCalled();
    expect(client.readTrackedEpisodeMedia).not.toHaveBeenCalled();
    expect(client.getTrackedObservationIdentity).not.toHaveBeenCalled();
    expect(onOpenEventLocal).not.toHaveBeenCalled();

    expect(screen.queryByTestId('safety-triage-selection-technical')).toBeNull();
    fireEvent.click(screen.getByTestId('safety-triage-tech-toggle'));
    const techPanel = screen.getByTestId('safety-triage-selection-technical');
    expect(techPanel.textContent).toContain(RECIPIENT_A_ID);
    expect(techPanel.textContent).toContain(EPISODE_A_ID);
    expect(techPanel.textContent).toContain(SEGMENT_A_ID);

    const allKeysSerialized = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey),
    );
    expect(allKeysSerialized).not.toContain(secretToken);
    expect(document.body.textContent ?? '').not.toContain(secretToken);

    fireEvent.click(screen.getByTestId('safety-triage-back-button'));

    await waitFor(() => expect(document.activeElement).toBe(openTrackedBtn));

    expect(screen.queryByTestId('tracked-episode-workspace')).toBeNull();
    expect(screen.queryByTestId('safety-episode-triage-detail-pane')).toBeNull();
    expect(inboxPane.hidden).toBe(false);
    expect(client.listSafetyEpisodeInbox).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the inbox pane if the original opener becomes unavailable', async () => {
    const queryClient = makeQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <SafetyEpisodeTriageWorkspace
          client={makeMockClient()}
          token="synthetic-triage-token"
          scopeKey="synthetic-focus-scope"
          apiUrl="http://localhost:4000"
          sites={SITES_AB}
          onOpenEventLocal={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const opener = await screen.findByTestId<HTMLButtonElement>(
      `safety-inbox-open-${RECIPIENT_A_ID}`,
    );
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('safety-triage-detail-heading')),
    );
    opener.disabled = true;
    fireEvent.click(screen.getByTestId('safety-triage-back-button'));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('safety-episode-triage-inbox-pane')),
    );
    queryClient.clear();
  });

  it('returns to the opened row when pointer activation leaves another inbox control focused', async () => {
    const queryClient = makeQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <SafetyEpisodeTriageWorkspace
          client={makeMockClient()}
          token="synthetic-pointer-token"
          scopeKey="synthetic-pointer-scope"
          apiUrl="http://localhost:4000"
          sites={SITES_AB}
          onOpenEventLocal={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const opener = await screen.findByTestId(`safety-inbox-open-${RECIPIENT_A_ID}`);
    screen.getByTestId('safety-inbox-site-filter-all').focus();
    fireEvent.click(opener);
    await screen.findByTestId('safety-triage-detail-heading');
    fireEvent.click(screen.getByTestId('safety-triage-back-button'));
    await waitFor(() => expect(document.activeElement).toBe(opener));
    queryClient.clear();
  });

  it('delegates an EVENT_LOCAL row to onOpenEventLocal with the exact item and makes zero TRACKED detail fetches', async () => {
    const queryClient = makeQueryClient();
    const client = makeMockClient();
    const onOpenEventLocal = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <SafetyEpisodeTriageWorkspace
          client={client}
          token="jwt-token-event-local"
          scopeKey="user:1:session:1"
          apiUrl="http://localhost:4000"
          sites={SITES_AB}
          onOpenEventLocal={onOpenEventLocal}
        />
      </QueryClientProvider>,
    );

    const openEventLocalBtn = await screen.findByTestId(`safety-inbox-open-${RECIPIENT_B_ID}`);
    fireEvent.click(openEventLocalBtn);

    expect(onOpenEventLocal).toHaveBeenCalledTimes(1);
    expect(onOpenEventLocal).toHaveBeenCalledWith(ITEM_B_EVENT_LOCAL);

    expect(screen.queryByTestId('tracked-episode-workspace')).toBeNull();
    expect(screen.queryByTestId('safety-episode-triage-detail-pane')).toBeNull();
    expect(client.getTrackedEpisode).not.toHaveBeenCalled();
    expect(client.listTrackedEpisodeObservations).not.toHaveBeenCalled();
    expect(client.readTrackedEpisodeMedia).not.toHaveBeenCalled();
    expect(client.getTrackedObservationIdentity).not.toHaveBeenCalled();
    expect(client.readSafetyEpisodeInbox).not.toHaveBeenCalled();
  });

  it('synchronously hides selected TRACKED detail, aborts pending detail fetches when Site or auth scope is revoked, and does not revive selection if Site returns', async () => {
    const queryClient = makeQueryClient();
    const pendingDetail = createDeferred<TrackedEpisodeDetail>();
    let capturedDetailSignal: AbortSignal | undefined;

    const client = makeMockClient({
      getTrackedEpisode: vi.fn<SafetyEpisodeTriageClient['getTrackedEpisode']>(
        async (_token, _siteId, _episodeId, options) => {
          capturedDetailSignal = options?.signal;
          return pendingDetail.promise;
        },
      ),
    });
    const onOpenEventLocal = vi.fn();

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <SafetyEpisodeTriageWorkspace
          client={client}
          token="jwt-token-initial"
          scopeKey="user:1:session:1"
          apiUrl="http://localhost:4000"
          sites={SITES_AB}
          onOpenEventLocal={onOpenEventLocal}
        />
      </QueryClientProvider>,
    );

    const openTrackedBtn = await screen.findByTestId(`safety-inbox-open-${RECIPIENT_A_ID}`);
    fireEvent.click(openTrackedBtn);

    expect(await screen.findByTestId('tracked-episode-workspace')).toBeTruthy();
    await waitFor(() => {
      expect(client.getTrackedEpisode).toHaveBeenCalledTimes(1);
    });

    // Revoke SITE_A_ID from sites while getTrackedEpisode is still pending
    rerender(
      <QueryClientProvider client={queryClient}>
        <SafetyEpisodeTriageWorkspace
          client={client}
          token="jwt-token-initial"
          scopeKey="user:1:session:1"
          apiUrl="http://localhost:4000"
          sites={[{ id: SITE_B_ID, name: 'South Gate' }]}
          onOpenEventLocal={onOpenEventLocal}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByTestId('tracked-episode-workspace')).toBeNull();
    expect(screen.queryByTestId('safety-episode-triage-detail-pane')).toBeNull();
    expect(capturedDetailSignal?.aborted).toBe(true);

    // Late resolution of revoked detail promise cannot restore the detail view
    await act(async () => {
      pendingDetail.resolve(TRACKED_EPISODE_A_DETAIL);
    });

    expect(screen.queryByTestId('tracked-episode-workspace')).toBeNull();

    // Re-authorizing SITE_A_ID in sites does not revive the old selection
    rerender(
      <QueryClientProvider client={queryClient}>
        <SafetyEpisodeTriageWorkspace
          client={client}
          token="jwt-token-initial"
          scopeKey="user:1:session:1"
          apiUrl="http://localhost:4000"
          sites={SITES_AB}
          onOpenEventLocal={onOpenEventLocal}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByTestId('tracked-episode-workspace')).toBeNull();
    expect(screen.queryByTestId('safety-episode-triage-detail-pane')).toBeNull();
    expect(screen.getByTestId('safety-episode-triage-inbox-pane').hidden).toBe(false);
  });

  it('shows unavailable state and makes 0 network calls when sites is empty', () => {
    const queryClient = makeQueryClient();
    const client = makeMockClient();
    const onOpenEventLocal = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <SafetyEpisodeTriageWorkspace
          client={client}
          token="jwt-token-empty-sites"
          scopeKey="user:1:session:1"
          apiUrl="http://localhost:4000"
          sites={[]}
          onOpenEventLocal={onOpenEventLocal}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('safety-inbox-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('safety-inbox-empty')).toBeNull();
    expect(screen.queryByTestId('tracked-episode-workspace')).toBeNull();
    expect(client.listSafetyEpisodeInbox).not.toHaveBeenCalled();
    expect(client.getTrackedEpisode).not.toHaveBeenCalled();
  });

  it('unmounts selected detail when a read started in the hidden inbox returns a hard denial', async () => {
    const pending = createDeferred<SafetyEpisodeReadResponse>();
    const client = makeMockClient({
      readSafetyEpisodeInbox: vi.fn<SafetyEpisodeTriageClient['readSafetyEpisodeInbox']>(
        () => pending.promise,
      ),
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <SafetyEpisodeTriageWorkspace
          client={client}
          token="synthetic-token"
          scopeKey="synthetic-scope"
          apiUrl="https://example.test"
          sites={SITES_AB}
          onOpenEventLocal={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await screen.findByTestId(`safety-inbox-open-${RECIPIENT_A_ID}`);
    fireEvent.click(screen.getByTestId(`safety-inbox-mark-read-${RECIPIENT_A_ID}`));
    fireEvent.click(screen.getByTestId(`safety-inbox-open-${RECIPIENT_A_ID}`));

    await waitFor(() =>
      expect(screen.getByTestId('safety-episode-triage-detail-pane')).toBeTruthy(),
    );

    await act(async () => {
      pending.reject(new ApiError('http', 'Site scope revoked', 403));
    });

    await waitFor(() =>
      expect(screen.queryByTestId('safety-episode-triage-detail-pane')).toBeNull(),
    );
    expect(screen.queryByTestId('tracked-episode-workspace')).toBeNull();
    expect(screen.getByTestId('safety-episode-triage-inbox-pane').hidden).toBe(false);
    expect(screen.getByTestId('safety-inbox-forbidden')).toBeTruthy();
  });
});
