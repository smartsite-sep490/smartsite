// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import type {
  TrackedEpisodeDetail,
  TrackedEpisodeMediaSource,
  TrackedEpisodeObservationPage,
  TrackedObservationIdentity,
  TrackedObservationIdentityCard,
} from '@smartsite/contracts/tracked-episode-frames';
import i18n from '../../i18n';
import { isObservationIdentityCardEnabled } from './safetyUrlParams';
import {
  TrackedEpisodeEvidenceWorkspace,
  type TrackedEpisodeEvidenceClient,
} from './TrackedEpisodeEvidenceWorkspace';
import {
  TrackedObservationIdentityPanel,
  type TrackedObservationIdentityClient,
  type TrackedObservationIdentityPanelProps,
} from './TrackedObservationIdentityPanel';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const SITE_B = '11111111-1111-4111-8111-111111111112';
const EPISODE_ID = '22222222-2222-4222-8222-222222222222';
const CAMERA_ID = '33333333-3333-4333-8333-333333333333';
const STREAM_SESSION_ID = '44444444-4444-4444-8444-444444444444';
const ALERT_ID = 'aaaa1111-1111-4111-8111-111111111111';
const EVENT_1_ID = '55555555-5555-4555-8555-555555555555';
const EVENT_2_ID = '66666666-6666-4666-8666-666666666666';
const WORKER_ID_1 = '77777777-7777-4777-8777-777777777777';
const ACTOR_USER_ID = '88888888-8888-4888-8888-888888888888';
const DECISION_ID_1 = '99999999-9999-4999-8999-999999999991';
const DECISION_ID_2 = '99999999-9999-4999-8999-999999999992';

const PAYLOAD_HASH_1 = '1111111111111111111111111111111111111111111111111111111111111111';
const PAYLOAD_HASH_2 = '2222222222222222222222222222222222222222222222222222222222222222';
const EVIDENCE_SHA256 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const SOURCE_EVENT_1: TrackedEpisodeMediaSource = {
  alertId: ALERT_ID,
  eventId: EVENT_1_ID,
  personObservationIndex: 0,
  evidenceIndex: 0,
};

const SOURCE_EVENT_2: TrackedEpisodeMediaSource = {
  alertId: ALERT_ID,
  eventId: EVENT_2_ID,
  personObservationIndex: 0,
  evidenceIndex: 1,
};

function buildBaseIdentity(
  siteId: string,
  source: TrackedEpisodeMediaSource,
  payloadHash: string,
  mode: 'NONE' | 'CLEAR' | 'RESOLVE',
  revisionOverride?: number,
): TrackedObservationIdentity {
  const subjectRef: TrackedObservationIdentity['subjectRef'] = {
    eventId: source.eventId,
    personObservationIndex: source.personObservationIndex,
    payloadHash,
    cameraId: CAMERA_ID,
    cameraExternalId: 'cam-gate-north-01',
    streamSessionId: STREAM_SESSION_ID,
    capturedAt: '2026-11-19T10:15:30.000Z',
    trackId: 77,
    personBoundingBox: {
      x1: 0.12,
      y1: 0.2,
      x2: 0.48,
      y2: 0.91,
      coordinateSpace: 'NORMALIZED_0_1',
    },
  };

  if (mode === 'NONE') {
    return {
      episodeId: EPISODE_ID,
      siteId,
      source,
      subjectRef,
      revision: 0,
      latestDecision: null,
    };
  }

  if (mode === 'CLEAR') {
    const rev = revisionOverride ?? 2;
    return {
      episodeId: EPISODE_ID,
      siteId,
      source,
      subjectRef,
      revision: rev,
      latestDecision: {
        id: DECISION_ID_1,
        revision: rev,
        action: 'CLEAR',
        workerId: null,
        actorUserId: ACTOR_USER_ID,
        reason: 'Cleared mistaken manual assignment',
        scope: 'EXACT_OBSERVATION',
        verificationMethod: 'MANUAL',
        recordedAt: '2026-11-19T10:20:00.000Z',
        subjectRef,
        evidenceIndex: null,
        evidenceSha256: null,
      },
    };
  }

  const rev = revisionOverride ?? 3;
  return {
    episodeId: EPISODE_ID,
    siteId,
    source,
    subjectRef,
    revision: rev,
    latestDecision: {
      id: DECISION_ID_2,
      revision: rev,
      action: 'RESOLVE',
      workerId: WORKER_ID_1,
      actorUserId: ACTOR_USER_ID,
      reason: 'Supervisor confirmed from gate log',
      scope: 'EXACT_OBSERVATION',
      verificationMethod: 'MANUAL',
      recordedAt: '2026-11-19T10:25:00.000Z',
      subjectRef,
      evidenceIndex: source.evidenceIndex,
      evidenceSha256: EVIDENCE_SHA256,
    },
  };
}

function buildIdentityCard(
  siteId: string,
  source: TrackedEpisodeMediaSource,
  payloadHash: string,
  mode: 'NONE' | 'CLEAR' | 'RESOLVE_ACTIVE' | 'RESOLVE_INACTIVE' | 'RESOLVE_DIRECTORY_NULL',
  revisionOverride?: number,
): TrackedObservationIdentityCard {
  if (mode === 'NONE' || mode === 'CLEAR') {
    return {
      ...buildBaseIdentity(siteId, source, payloadHash, mode, revisionOverride),
      worker: null,
    };
  }

  const base = buildBaseIdentity(siteId, source, payloadHash, 'RESOLVE', revisionOverride);
  if (mode === 'RESOLVE_DIRECTORY_NULL') {
    return { ...base, worker: null };
  }

  return {
    ...base,
    worker: {
      id: WORKER_ID_1,
      siteId,
      externalId: 'W-042',
      displayName: 'Worker Forty Two',
      isActive: mode === 'RESOLVE_ACTIVE',
    },
  };
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

describe('TrackedObservationIdentityCard integration & rollout boundaries', () => {
  beforeEach(() => {
    window.localStorage.clear();
    void i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('keeps the new /identity-card method disabled by default until explicitly enabled, preserving legacy /identity', async () => {
    expect(isObservationIdentityCardEnabled()).toBe(false);
    expect(isObservationIdentityCardEnabled(true)).toBe(true);
    expect(isObservationIdentityCardEnabled(false)).toBe(false);

    const queryClient = createTestQueryClient();
    const getTrackedObservationIdentity = vi.fn(
      async (
        _token: string,
        siteId: string,
        _ep: string,
        source: TrackedEpisodeMediaSource,
        hash: string,
      ) => buildBaseIdentity(siteId, source, hash, 'NONE'),
    );
    const getTrackedObservationIdentityCard = vi.fn(
      async (
        _token: string,
        siteId: string,
        _ep: string,
        source: TrackedEpisodeMediaSource,
        hash: string,
      ) => buildIdentityCard(siteId, source, hash, 'RESOLVE_ACTIVE'),
    );

    const client: TrackedObservationIdentityClient = {
      getTrackedObservationIdentity,
      getTrackedObservationIdentityCard,
    };

    render(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel
          client={client}
          token="jwt-token-default"
          scopeKey="scope-default"
          apiUrl="http://127.0.0.1:4000"
          siteId={SITE_A}
          episodeId={EPISODE_ID}
          source={SOURCE_EVENT_1}
          expectedPayloadHash={PAYLOAD_HASH_1}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-none')).toBeTruthy();
    });

    expect(getTrackedObservationIdentity).toHaveBeenCalledTimes(1);
    expect(getTrackedObservationIdentityCard).not.toHaveBeenCalled();
  });

  it('renders null, CLEAR, RESOLVE+active worker, RESOLVE+inactive worker (separating historical decision from inactive status), and RESOLVE+null worker without reusing nearby frame identities', async () => {
    const queryClient = createTestQueryClient();
    let mode: 'NONE' | 'CLEAR' | 'RESOLVE_ACTIVE' | 'RESOLVE_INACTIVE' | 'RESOLVE_DIRECTORY_NULL' =
      'NONE';

    const getTrackedObservationIdentity = vi.fn();
    const getTrackedObservationIdentityCard = vi.fn(
      async (
        _token: string,
        siteId: string,
        _ep: string,
        source: TrackedEpisodeMediaSource,
        hash: string,
      ) => buildIdentityCard(siteId, source, hash, mode),
    );

    const client: TrackedObservationIdentityClient = {
      getTrackedObservationIdentity,
      getTrackedObservationIdentityCard,
    };

    const buildProps = (
      overrides: Partial<TrackedObservationIdentityPanelProps> = {},
    ): TrackedObservationIdentityPanelProps => ({
      client,
      token: 'jwt-officer-1',
      scopeKey: 'scope-card-1',
      apiUrl: 'http://127.0.0.1:4000',
      siteId: SITE_A,
      episodeId: EPISODE_ID,
      source: SOURCE_EVENT_1,
      expectedPayloadHash: PAYLOAD_HASH_1,
      enableIdentityCard: true,
      ...overrides,
    });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel {...buildProps()} />
      </QueryClientProvider>,
    );

    // 1. Null decision -> unresolved state, no confirmed name
    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-none')).toBeTruthy();
    });
    expect(getTrackedObservationIdentityCard).toHaveBeenCalledTimes(1);
    expect(getTrackedObservationIdentity).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tracked-identity-worker-card')).toBeNull();

    // 2. CLEAR decision -> cleared state, no confirmed name
    mode = 'CLEAR';
    rerender(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel {...buildProps({ scopeKey: 'scope-card-2' })} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-cleared')).toBeTruthy();
    });
    expect(screen.queryByTestId('tracked-identity-worker-card')).toBeNull();

    // 3. RESOLVE + active worker -> displays displayName + externalId + manual verification label, never automatic face recognition
    mode = 'RESOLVE_ACTIVE';
    rerender(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel {...buildProps({ scopeKey: 'scope-card-3' })} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-worker-card')).toBeTruthy();
    });
    expect(screen.getByTestId('tracked-identity-worker-name').textContent).toBe('Worker Forty Two');
    expect(screen.getByTestId('tracked-identity-worker-external-id').textContent).toContain(
      'W-042',
    );
    expect(screen.getByTestId('tracked-identity-worker-active')).toBeTruthy();
    expect(screen.queryByTestId('tracked-identity-worker-inactive')).toBeNull();
    expect(screen.getByTestId('tracked-identity-resolved').textContent).toMatch(/Manual/i);
    expect(screen.getByTestId('tracked-identity-resolved').textContent).not.toMatch(
      /automatic face|face recognition|contractor|team/i,
    );

    // Switching to nearby frame (SOURCE_EVENT_2) immediately clears the worker name without reusing nearby frame identity
    rerender(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel
          {...buildProps({
            scopeKey: 'scope-card-3',
            source: SOURCE_EVENT_2,
            expectedPayloadHash: PAYLOAD_HASH_2,
          })}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('tracked-identity-worker-card')).toBeNull();
    expect(screen.queryByText('Worker Forty Two')).toBeNull();
    expect(screen.getByTestId('tracked-identity-idle')).toBeTruthy();

    // 4. RESOLVE + inactive worker -> separates historical manual decision from current inactive directory status (EN & VI)
    mode = 'RESOLVE_INACTIVE';
    rerender(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel {...buildProps({ scopeKey: 'scope-card-4' })} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-worker-inactive')).toBeTruthy();
    });
    expect(screen.getByTestId('tracked-identity-worker-name').textContent).toBe('Worker Forty Two');
    expect(screen.getByTestId('tracked-identity-worker-external-id').textContent).toContain(
      'W-042',
    );
    expect(screen.getByTestId('tracked-identity-worker-inactive').textContent).toMatch(/inactive/i);
    expect(screen.getByTestId('tracked-identity-resolved').textContent).toContain('Rev #3');

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(screen.getByTestId('tracked-identity-worker-inactive').textContent).toMatch(
      /ngừng hoạt động/i,
    );
    await act(async () => {
      await i18n.changeLanguage('en');
    });

    // 5. RESOLVE + worker: null -> preserves historical manual decision and states current directory metadata is unavailable
    mode = 'RESOLVE_DIRECTORY_NULL';
    rerender(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel {...buildProps({ scopeKey: 'scope-card-5' })} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-directory-unavailable')).toBeTruthy();
    });
    expect(screen.getByTestId('tracked-identity-resolved')).toBeTruthy();
    expect(screen.queryByTestId('tracked-identity-worker-card')).toBeNull();
    const dirUnavailableText =
      screen.getByTestId('tracked-identity-directory-unavailable').textContent ?? '';
    expect(dirUnavailableText).toMatch(/directory/i);
    expect(dirUnavailableText).not.toMatch(/unknown worker|unidentified worker/i);
  });

  it('handles 409 by requiring source/identity refresh, never falls back to another Site cached directory on 403, and never treats 404 on an older demo as no identity', async () => {
    const queryClient = createTestQueryClient();
    let scenario: 'SITE_A_OK' | 'SITE_B_403' | 'CONFLICT_409' | 'OLDER_DEMO_404' | 'REFRESHED_OK' =
      'SITE_A_OK';
    const onRefreshSource = vi.fn(async () => undefined);

    const client: TrackedObservationIdentityClient = {
      getTrackedObservationIdentity: vi.fn(),
      getTrackedObservationIdentityCard: vi.fn(
        async (_token, siteId, _ep, source, expectedPayloadHash) => {
          if (scenario === 'SITE_A_OK') {
            return buildIdentityCard(siteId, source, expectedPayloadHash, 'RESOLVE_ACTIVE');
          }
          if (scenario === 'SITE_B_403') {
            throw new ApiError('http', 'Site scope denied', 403);
          }
          if (scenario === 'CONFLICT_409') {
            throw new ApiError('http', 'Identity changed; refresh the original observation', 409);
          }
          if (scenario === 'OLDER_DEMO_404') {
            throw new ApiError('http', 'Cannot GET /identity-card', 404);
          }
          return buildIdentityCard(siteId, source, expectedPayloadHash, 'RESOLVE_ACTIVE', 4);
        },
      ),
    };

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel
          client={client}
          token="jwt-officer"
          scopeKey="scope-site-a"
          apiUrl="http://127.0.0.1:4000"
          siteId={SITE_A}
          episodeId={EPISODE_ID}
          source={SOURCE_EVENT_1}
          expectedPayloadHash={PAYLOAD_HASH_1}
          enableIdentityCard
          onRefreshSource={onRefreshSource}
        />
      </QueryClientProvider>,
    );

    // 1. Site A succeeds and displays Worker Forty Two
    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-worker-name').textContent).toBe(
        'Worker Forty Two',
      );
    });

    // 2. Switch to Site B which returns 403 -> must NOT fall back to Site A's cached worker directory
    scenario = 'SITE_B_403';
    rerender(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel
          client={client}
          token="jwt-officer"
          scopeKey="scope-site-b"
          apiUrl="http://127.0.0.1:4000"
          siteId={SITE_B}
          episodeId={EPISODE_ID}
          source={SOURCE_EVENT_1}
          expectedPayloadHash={PAYLOAD_HASH_1}
          enableIdentityCard
          onRefreshSource={onRefreshSource}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-forbidden')).toBeTruthy();
    });
    expect(screen.queryByText('Worker Forty Two')).toBeNull();
    expect(screen.queryByTestId('tracked-identity-none')).toBeNull();

    // 3. 404 on an older running Backend demo -> MUST NOT treat 404 as 'no identity'
    scenario = 'OLDER_DEMO_404';
    rerender(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel
          client={client}
          token="jwt-officer"
          scopeKey="scope-404"
          apiUrl="http://127.0.0.1:4000"
          siteId={SITE_A}
          episodeId={EPISODE_ID}
          source={SOURCE_EVENT_1}
          expectedPayloadHash={PAYLOAD_HASH_1}
          enableIdentityCard
          onRefreshSource={onRefreshSource}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-forbidden')).toBeTruthy();
    });
    expect(screen.queryByTestId('tracked-identity-none')).toBeNull();
    expect(screen.getByTestId('tracked-identity-forbidden').textContent).not.toMatch(
      /No manual link recorded|no identity|unknown worker/i,
    );

    // 4. 409 Conflict -> prompts refreshing source/identity revision and invokes onRefreshSource + refetch
    scenario = 'CONFLICT_409';
    rerender(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel
          client={client}
          token="jwt-officer"
          scopeKey="scope-409"
          apiUrl="http://127.0.0.1:4000"
          siteId={SITE_A}
          episodeId={EPISODE_ID}
          source={SOURCE_EVENT_1}
          expectedPayloadHash={PAYLOAD_HASH_1}
          enableIdentityCard
          onRefreshSource={onRefreshSource}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-conflict')).toBeTruthy();
    });

    scenario = 'REFRESHED_OK';
    fireEvent.click(screen.getByTestId('tracked-identity-refresh-source-button'));
    await waitFor(() => {
      expect(onRefreshSource).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('tracked-identity-worker-name').textContent).toBe(
        'Worker Forty Two',
      );
    });
    expect(screen.getByTestId('tracked-identity-resolved').textContent).toContain('Rev #4');
  });

  it('wires enableIdentityCard and 409 source refresh end-to-end inside TrackedEpisodeEvidenceWorkspace without auto-fetching on media load', async () => {
    let urlSeq = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-card-${++urlSeq}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const queryClient = createTestQueryClient();
    const detail: TrackedEpisodeDetail = {
      episodeId: EPISODE_ID,
      siteId: SITE_A,
      cameraId: CAMERA_ID,
      subject: { kind: 'TRACKED', segmentId: 'seg-01', scopeSha256: 'b'.repeat(64) },
      firstObservedAt: '2026-11-19T10:15:30.000Z',
      lastObservedAt: '2026-11-19T10:15:35.000Z',
      contentRevision: 2,
      collectionState: 'COLLECTING',
      findings: [
        {
          alertId: ALERT_ID,
          alertType: 'PPE_VIOLATION',
          candidateSubtype: 'MISSING_HELMET',
          status: 'PENDING_REVIEW',
          alertRevision: 1,
          zoneId: null,
          observationCount: 1,
        },
      ],
    };

    const page: TrackedEpisodeObservationPage = {
      episodeId: EPISODE_ID,
      contentRevision: 2,
      throughSequence: '100',
      offset: 0,
      limit: 20,
      total: 1,
      hasMore: false,
      items: [
        {
          alertId: ALERT_ID,
          eventId: EVENT_1_ID,
          personObservationIndex: 0,
          payloadHash: PAYLOAD_HASH_1,
          sourceSequence: '100',
          capturedAt: '2026-11-19T10:15:30.000Z',
          observationIndexes: [0],
          frames: [{ evidenceIndex: 0, sha256: EVIDENCE_SHA256 }],
        },
      ],
    };

    let cardCallCount = 0;
    const getTrackedEpisode = vi.fn(async () => detail);
    const listTrackedEpisodeObservations = vi.fn(async () => page);
    const getTrackedObservationIdentity = vi.fn(async () => {
      throw new Error('Must not call legacy /identity when enableIdentityCard is true');
    });
    const getTrackedObservationIdentityCard = vi.fn(
      async (
        _token: string,
        siteId: string,
        _ep: string,
        source: TrackedEpisodeMediaSource,
        hash: string,
      ) => {
        cardCallCount += 1;
        if (cardCallCount === 1) {
          throw new ApiError('http', 'Identity changed; refresh the original observation', 409);
        }
        return buildIdentityCard(siteId, source, hash, 'RESOLVE_ACTIVE', 5);
      },
    );

    const client: TrackedEpisodeEvidenceClient = {
      getTrackedEpisode,
      listTrackedEpisodeObservations,
      readTrackedEpisodeMedia: vi.fn(async (_t, _s, _e, _src, representation, expectedSha) => ({
        blob: new Blob([new Uint8Array(256)], { type: 'image/jpeg' }),
        representation,
        sha256: expectedSha,
        frameSha256: expectedSha,
      })),
      getTrackedObservationIdentity,
      getTrackedObservationIdentityCard,
    };

    render(
      <QueryClientProvider client={queryClient}>
        <TrackedEpisodeEvidenceWorkspace
          client={client}
          token="jwt-workspace-card"
          sessionScope="officer-card-scope"
          apiUrl="http://127.0.0.1:4000"
          siteId={SITE_A}
          episodeId={EPISODE_ID}
          enableIdentityCard
        />
      </QueryClientProvider>,
    );

    const row = await screen.findByTestId('tracked-history-item');
    fireEvent.click(within(row).getByRole('button', { name: 'Full FRAME #0' }));

    const img = await screen.findByTestId('tracked-viewer-image');
    fireEvent.load(img);

    expect(screen.getByTestId('tracked-identity-idle')).toBeTruthy();
    expect(getTrackedObservationIdentityCard).not.toHaveBeenCalled();

    // First click hits 409 -> prompts source refresh
    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-conflict')).toBeTruthy();
    });

    const prevDetailCalls = getTrackedEpisode.mock.calls.length;
    const prevObsCalls = listTrackedEpisodeObservations.mock.calls.length;

    // Clicking Refresh observation & retry refetches workspace detail + observations and reloads the card
    fireEvent.click(screen.getByTestId('tracked-identity-refresh-source-button'));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-worker-name').textContent).toBe(
        'Worker Forty Two',
      );
    });
    expect(getTrackedEpisode.mock.calls.length).toBeGreaterThan(prevDetailCalls);
    expect(listTrackedEpisodeObservations.mock.calls.length).toBeGreaterThan(prevObsCalls);
    expect(getTrackedObservationIdentity).not.toHaveBeenCalled();
  });
});
