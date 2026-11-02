// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import type {
  TrackedEpisodeMediaSource,
  TrackedObservationIdentity,
} from '@smartsite/contracts/tracked-episode-frames';
import { changeUiLanguage } from '../../i18n/runtime';
import {
  TrackedObservationIdentityPanel,
  type TrackedObservationIdentityClient,
  type TrackedObservationIdentityPanelProps,
} from './TrackedObservationIdentityPanel';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
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
  personObservationIndex: 1,
  evidenceIndex: 2,
};

function buildIdentityResponse(
  source: TrackedEpisodeMediaSource,
  payloadHash: string,
  mode: 'NONE' | 'CLEAR' | 'RESOLVE',
): TrackedObservationIdentity {
  const subjectRef: TrackedObservationIdentity['subjectRef'] = {
    eventId: source.eventId,
    personObservationIndex: source.personObservationIndex,
    payloadHash,
    cameraId: CAMERA_ID,
    cameraExternalId: 'cam-gate-north-01',
    streamSessionId: STREAM_SESSION_ID,
    capturedAt: '2026-11-01T10:15:30.000Z',
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
      siteId: SITE_ID,
      source,
      subjectRef,
      revision: 0,
      latestDecision: null,
    };
  }

  if (mode === 'CLEAR') {
    return {
      episodeId: EPISODE_ID,
      siteId: SITE_ID,
      source,
      subjectRef,
      revision: 2,
      latestDecision: {
        id: DECISION_ID_1,
        revision: 2,
        action: 'CLEAR',
        workerId: null,
        actorUserId: ACTOR_USER_ID,
        reason: 'Previous manual entry was for adjacent bay',
        scope: 'EXACT_OBSERVATION',
        verificationMethod: 'MANUAL',
        recordedAt: '2026-11-01T10:20:00.000Z',
        subjectRef,
        evidenceIndex: null,
        evidenceSha256: null,
      },
    };
  }

  return {
    episodeId: EPISODE_ID,
    siteId: SITE_ID,
    source,
    subjectRef,
    revision: 3,
    latestDecision: {
      id: DECISION_ID_2,
      revision: 3,
      action: 'RESOLVE',
      workerId: WORKER_ID_1,
      actorUserId: ACTOR_USER_ID,
      reason: 'Confirmed by site supervisor sign-in sheet',
      scope: 'EXACT_OBSERVATION',
      verificationMethod: 'MANUAL',
      recordedAt: '2026-11-01T10:25:00.000Z',
      subjectRef,
      evidenceIndex: source.evidenceIndex,
      evidenceSha256: EVIDENCE_SHA256,
    },
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolveFn = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      if (!resolveFn) {
        throw new Error('Deferred resolver not initialized');
      }
      resolveFn(value);
    },
  };
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

describe('TrackedObservationIdentityPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
    changeUiLanguage('en');
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('makes no network request before click and renders distinct null, CLEAR, and RESOLVE states with EN/VI labels and wrapped technical disclosure', async () => {
    const queryClient = createTestQueryClient();
    let mode: 'NONE' | 'CLEAR' | 'RESOLVE' = 'NONE';

    const getTrackedObservationIdentity = vi.fn<
      TrackedObservationIdentityClient['getTrackedObservationIdentity']
    >(async (_token, _siteId, _episodeId, source, expectedPayloadHash) =>
      buildIdentityResponse(source, expectedPayloadHash, mode),
    );

    const client: TrackedObservationIdentityClient = { getTrackedObservationIdentity };

    const buildProps = (
      overrides: Partial<TrackedObservationIdentityPanelProps> = {},
    ): TrackedObservationIdentityPanelProps => ({
      client,
      token: 'jwt-token-identity-1',
      scopeKey: 'scope-1',
      apiUrl: 'http://127.0.0.1:4000',
      siteId: SITE_ID,
      episodeId: EPISODE_ID,
      source: SOURCE_EVENT_1,
      expectedPayloadHash: PAYLOAD_HASH_1,
      ...overrides,
    });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel {...buildProps()} />
      </QueryClientProvider>,
    );

    // 1. Idle state: zero network requests before user click
    expect(getTrackedObservationIdentity).not.toHaveBeenCalled();
    expect(screen.getByTestId('tracked-identity-idle')).toBeTruthy();
    expect(screen.getByTestId('tracked-identity-disclaimer').textContent).toBe(
      'Manual link for this observation only; it does not grant access.',
    );

    // 2. Click Read -> null latestDecision state
    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));

    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-none')).toBeTruthy();
    });

    expect(getTrackedObservationIdentity).toHaveBeenCalledTimes(1);
    expect(getTrackedObservationIdentity).toHaveBeenLastCalledWith(
      'jwt-token-identity-1',
      SITE_ID,
      EPISODE_ID,
      SOURCE_EVENT_1,
      PAYLOAD_HASH_1,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByTestId('tracked-identity-none').textContent).toBe(
      'No manual link recorded for this observation',
    );
    expect(screen.getByTestId('tracked-identity-none').textContent).not.toMatch(/unauthorized/i);

    await act(async () => {
      changeUiLanguage('vi');
    });
    expect(screen.getByTestId('tracked-identity-disclaimer').textContent).toBe(
      'Liên kết thủ công chỉ áp dụng cho quan sát này; không cấp quyền ra vào.',
    );
    expect(screen.getByTestId('tracked-identity-none').textContent).toBe(
      'Chưa có liên kết thủ công cho quan sát này',
    );

    await act(async () => {
      changeUiLanguage('en');
    });

    // 3. Switch to CLEAR mode on a new scopeKey -> resets to idle without auto-fetching, then click Read
    mode = 'CLEAR';
    rerender(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel {...buildProps({ scopeKey: 'scope-2' })} />
      </QueryClientProvider>,
    );

    expect(getTrackedObservationIdentity).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));

    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-cleared')).toBeTruthy();
    });
    expect(screen.queryByTestId('tracked-identity-worker')).toBeNull();
    expect(screen.getByTestId('tracked-identity-cleared').textContent).toContain(
      'Previous manual link was cleared for this exact observation (not a verified Worker)',
    );
    expect(screen.getByTestId('tracked-identity-reason').textContent).toContain(
      'Previous manual entry was for adjacent bay',
    );

    // 4. Switch to RESOLVE mode on scope-3 -> click Read and inspect wrapped technical details
    mode = 'RESOLVE';
    rerender(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel {...buildProps({ scopeKey: 'scope-3' })} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));

    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-resolved')).toBeTruthy();
    });

    const workerText = screen.getByTestId('tracked-identity-worker').textContent ?? '';
    expect(workerText).toContain(WORKER_ID_1);
    expect(workerText).toContain('Rev #3');
    expect(screen.getByTestId('tracked-identity-reason').textContent).toContain(
      'Confirmed by site supervisor sign-in sheet',
    );

    // Expand technical details and verify wrapped monospace fields + full non-inference boundary notice
    fireEvent.click(screen.getByTestId('tracked-identity-tech-toggle'));
    const techList = screen.getByTestId('tracked-identity-technical');
    expect(techList.textContent).toContain('never a verified Face match');
    expect(techList.textContent).toContain(PAYLOAD_HASH_1);
    expect(techList.textContent).toContain('77');
    expect(techList.textContent).toContain(ACTOR_USER_ID);
    expect(techList.textContent).toContain('EXACT_OBSERVATION');
    expect(techList.textContent).toContain('MANUAL');
    expect(techList.textContent).toContain(EVIDENCE_SHA256);

    for (const dd of techList.querySelectorAll('dd')) {
      expect(dd.className).toContain('break-all');
      expect(dd.className).toContain('font-mono');
    }
  });

  it('shows narrower 403 permission/unavailable message without logout or unknown-worker claim, and allows explicit retry on 500 error', async () => {
    const queryClient = createTestQueryClient();
    let behavior: 'forbidden' | 'error' | 'ok' = 'forbidden';

    const client: TrackedObservationIdentityClient = {
      getTrackedObservationIdentity: vi.fn(
        async (_token, _siteId, _episodeId, source, expectedPayloadHash) => {
          if (behavior === 'forbidden') {
            throw new ApiError('http', 'Identity read role denied', 403);
          }
          if (behavior === 'error') {
            throw new ApiError('network', 'Upstream identity store timeout', 502);
          }
          return buildIdentityResponse(source, expectedPayloadHash, 'NONE');
        },
      ),
    };

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel
          client={client}
          token="jwt-admin-only"
          scopeKey="scope-admin"
          apiUrl="http://127.0.0.1:4000"
          siteId={SITE_ID}
          episodeId={EPISODE_ID}
          source={SOURCE_EVENT_1}
          expectedPayloadHash={PAYLOAD_HASH_1}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));

    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-forbidden')).toBeTruthy();
    });
    const forbiddenAlert = screen.getByTestId('tracked-identity-forbidden');
    expect(forbiddenAlert.getAttribute('role')).toBe('alert');
    expect(forbiddenAlert.textContent).toContain(
      'Manual identity record is unavailable or your role does not have permission',
    );
    expect(forbiddenAlert.textContent).not.toMatch(/unknown worker|unidentified worker/i);

    // Switch to 502 error on a fresh scope and verify explicit retry
    behavior = 'error';
    rerender(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel
          client={client}
          token="jwt-safety-officer"
          scopeKey="scope-safety"
          apiUrl="http://127.0.0.1:4000"
          siteId={SITE_ID}
          episodeId={EPISODE_ID}
          source={SOURCE_EVENT_1}
          expectedPayloadHash={PAYLOAD_HASH_1}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));

    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-error')).toBeTruthy();
    });

    behavior = 'ok';
    fireEvent.click(screen.getByTestId('tracked-identity-retry-button'));

    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-none')).toBeTruthy();
    });
  });

  it('hides previous Worker ID immediately when switching to a later observation on the same technical segment, cancels pending requests on collapse or token change, and never leaks token in query keys or DOM', async () => {
    const queryClient = createTestQueryClient();
    const secretTokenA = 'secret-jwt-identity-alpha-111';
    const secretTokenB = 'secret-jwt-identity-beta-222';

    const pendingCalls: Array<{
      signal: AbortSignal | undefined;
      deferred: Deferred<TrackedObservationIdentity>;
    }> = [];
    let shouldPend = false;

    const client: TrackedObservationIdentityClient = {
      getTrackedObservationIdentity: vi.fn(
        (_token, _siteId, _episodeId, source, expectedPayloadHash, options) => {
          if (shouldPend) {
            const deferred = createDeferred<TrackedObservationIdentity>();
            pendingCalls.push({ signal: options?.signal, deferred });
            return deferred.promise;
          }
          return Promise.resolve(buildIdentityResponse(source, expectedPayloadHash, 'RESOLVE'));
        },
      ),
    };

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel
          client={client}
          token={secretTokenA}
          scopeKey="scope-alpha"
          apiUrl="http://127.0.0.1:4000"
          siteId={SITE_ID}
          episodeId={EPISODE_ID}
          source={SOURCE_EVENT_1}
          expectedPayloadHash={PAYLOAD_HASH_1}
        />
      </QueryClientProvider>,
    );

    // 1. Read manual identity on EVENT_1 -> shows WORKER_ID_1
    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-identity-worker').textContent).toContain(WORKER_ID_1);
    });

    // Verify token is never in query keys or DOM
    for (const query of queryClient.getQueryCache().getAll()) {
      expect(JSON.stringify(query.queryKey)).not.toContain(secretTokenA);
    }
    expect(document.body.textContent ?? '').not.toContain(secretTokenA);

    // 2. Switch to a later observation (SOURCE_EVENT_2, PAYLOAD_HASH_2) on the same episode/segment:
    // immediately hides WORKER_ID_1 and resets to idle without auto-fetching
    shouldPend = true;
    rerender(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel
          client={client}
          token={secretTokenA}
          scopeKey="scope-alpha"
          apiUrl="http://127.0.0.1:4000"
          siteId={SITE_ID}
          episodeId={EPISODE_ID}
          source={SOURCE_EVENT_2}
          expectedPayloadHash={PAYLOAD_HASH_2}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByTestId('tracked-identity-worker')).toBeNull();
    expect(screen.getByTestId('tracked-identity-idle')).toBeTruthy();
    expect(client.getTrackedObservationIdentity).toHaveBeenCalledTimes(1);

    // 3. Click Read on SOURCE_EVENT_2 while pending, then click Collapse -> aborts request and blocks late response
    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));
    expect(screen.getByTestId('tracked-identity-loading')).toBeTruthy();
    const firstPending = pendingCalls[0];
    expect(firstPending).toBeDefined();
    expect(firstPending?.signal?.aborted).toBe(false);

    fireEvent.click(screen.getByTestId('tracked-identity-collapse-button'));
    expect(screen.getByTestId('tracked-identity-idle')).toBeTruthy();
    expect(firstPending?.signal?.aborted).toBe(true);

    await act(async () => {
      firstPending?.deferred.resolve(
        buildIdentityResponse(SOURCE_EVENT_2, PAYLOAD_HASH_2, 'RESOLVE'),
      );
      await Promise.resolve();
    });
    expect(screen.queryByTestId('tracked-identity-worker')).toBeNull();
    expect(screen.getByTestId('tracked-identity-idle')).toBeTruthy();

    // 4. Start another pending read, then switch token/scopeKey -> aborts and blocks late response
    fireEvent.click(screen.getByTestId('tracked-identity-read-button'));
    expect(screen.getByTestId('tracked-identity-loading')).toBeTruthy();
    const secondPending = pendingCalls[1];
    expect(secondPending).toBeDefined();
    expect(secondPending?.signal?.aborted).toBe(false);

    rerender(
      <QueryClientProvider client={queryClient}>
        <TrackedObservationIdentityPanel
          client={client}
          token={secretTokenB}
          scopeKey="scope-beta"
          apiUrl="http://127.0.0.1:4000"
          siteId={SITE_ID}
          episodeId={EPISODE_ID}
          source={SOURCE_EVENT_2}
          expectedPayloadHash={PAYLOAD_HASH_2}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('tracked-identity-idle')).toBeTruthy();
    expect(secondPending?.signal?.aborted).toBe(true);

    await act(async () => {
      secondPending?.deferred.resolve(
        buildIdentityResponse(SOURCE_EVENT_2, PAYLOAD_HASH_2, 'RESOLVE'),
      );
      await Promise.resolve();
    });
    expect(screen.queryByTestId('tracked-identity-worker')).toBeNull();
  });
});
