// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type TrackedEpisodeMediaResult } from '@smartsite/api-client';
import type {
  TrackedEpisodeDetail,
  TrackedEpisodeMediaRepresentation,
  TrackedEpisodeObservationOptions,
  TrackedEpisodeObservationPage,
  TrackedEpisodeOriginalObservation,
} from '@smartsite/contracts/tracked-episode-frames';
import { changeUiLanguage } from '../../i18n/runtime';
import {
  TrackedEpisodeEvidenceWorkspace,
  type TrackedEpisodeEvidenceClient,
  type TrackedEpisodeEvidenceWorkspaceProps,
} from './TrackedEpisodeEvidenceWorkspace';

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

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const EPISODE_ID = '22222222-2222-4222-8222-222222222222';
const CAMERA_ID = '33333333-3333-4333-8333-333333333333';
const SEGMENT_ID = '99999999-9999-4999-8999-999999999999';
const SCOPE_SHA256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const FINDING_HELMET_ID = 'aaaa1111-1111-4111-8111-111111111111';
const FINDING_VEST_ID = 'bbbb2222-2222-4222-8222-222222222222';

const EVENT_1_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_2_ID = '55555555-5555-4555-8555-555555555555';

const PAYLOAD_HASH_EVENT_1 = '1111111111111111111111111111111111111111111111111111111111111111';
const PAYLOAD_HASH_EVENT_2 = '2222222222222222222222222222222222222222222222222222222222222222';

const SHA_EVENT1_FRAME0 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA_EVENT1_FRAME1 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SHA_EVENT2_FRAME3 = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const SHA_SUBJECT_CROP = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';

const PAGE_1_FENCE = '18446744073709551614';

const SHARED_EVENT_1_FRAMES: TrackedEpisodeOriginalObservation['frames'] = [
  { evidenceIndex: 0, sha256: SHA_EVENT1_FRAME0 },
  { evidenceIndex: 1, sha256: SHA_EVENT1_FRAME1 },
];

const OBS_1_HELMET_EVENT_1: TrackedEpisodeOriginalObservation = {
  alertId: FINDING_HELMET_ID,
  eventId: EVENT_1_ID,
  personObservationIndex: 0,
  payloadHash: PAYLOAD_HASH_EVENT_1,
  sourceSequence: PAGE_1_FENCE,
  capturedAt: '2026-11-01T10:15:30.000Z',
  observationIndexes: [1, 3],
  frames: SHARED_EVENT_1_FRAMES,
};

const OBS_2_VEST_SAME_EVENT_1: TrackedEpisodeOriginalObservation = {
  alertId: FINDING_VEST_ID,
  eventId: EVENT_1_ID,
  personObservationIndex: 0,
  payloadHash: PAYLOAD_HASH_EVENT_1,
  sourceSequence: PAGE_1_FENCE,
  capturedAt: '2026-11-01T10:15:30.000Z',
  observationIndexes: [2],
  frames: SHARED_EVENT_1_FRAMES,
};

const OBS_3_VEST_EVENT_2: TrackedEpisodeOriginalObservation = {
  alertId: FINDING_VEST_ID,
  eventId: EVENT_2_ID,
  personObservationIndex: 2,
  payloadHash: PAYLOAD_HASH_EVENT_2,
  sourceSequence: '18446744073709551570',
  capturedAt: '2026-11-01T10:14:00.000Z',
  observationIndexes: [1, 4],
  frames: [{ evidenceIndex: 3, sha256: SHA_EVENT2_FRAME3 }],
};

function buildFillerObservation(index: number): TrackedEpisodeOriginalObservation {
  const hex = index.toString(16).padStart(2, '0');
  const seq = (18446744073709551614n - BigInt(index)).toString();
  const second = String(index % 60).padStart(2, '0');
  return {
    alertId: index % 2 === 0 ? FINDING_HELMET_ID : FINDING_VEST_ID,
    eventId: `66666666-6666-4666-8666-6666666666${hex}`,
    personObservationIndex: 0,
    payloadHash: hex.repeat(32),
    sourceSequence: seq,
    capturedAt: `2026-11-01T10:14:${second}.000Z`,
    observationIndexes: [1],
    frames: [{ evidenceIndex: 0, sha256: `${hex}aa`.repeat(16) }],
  };
}

const FIRST_PAGE_TWENTY_ITEMS: TrackedEpisodeOriginalObservation[] = [
  OBS_1_HELMET_EVENT_1,
  OBS_2_VEST_SAME_EVENT_1,
  ...Array.from({ length: 18 }, (_, i) => buildFillerObservation(i + 2)),
];

const SECOND_PAGE_TWENTY_ITEMS: TrackedEpisodeOriginalObservation[] = [
  OBS_1_HELMET_EVENT_1,
  ...Array.from({ length: 19 }, (_, i) => buildFillerObservation(i + 20)),
];

function buildDetail(overrides: Partial<TrackedEpisodeDetail> = {}): TrackedEpisodeDetail {
  return {
    episodeId: EPISODE_ID,
    siteId: SITE_ID,
    cameraId: CAMERA_ID,
    subject: {
      kind: 'TRACKED',
      segmentId: SEGMENT_ID,
      scopeSha256: SCOPE_SHA256,
    },
    firstObservedAt: '2026-11-01T10:14:00.000Z',
    lastObservedAt: '2026-11-01T10:15:30.000Z',
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
        observationCount: 10,
      },
      {
        alertId: FINDING_VEST_ID,
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'MISSING_VEST',
        status: 'PENDING_REVIEW',
        alertRevision: 2,
        zoneId: null,
        observationCount: 11,
      },
    ],
    ...overrides,
  };
}

function buildObservationPage(
  overrides: Partial<TrackedEpisodeObservationPage> = {},
): TrackedEpisodeObservationPage {
  return {
    episodeId: EPISODE_ID,
    contentRevision: 3,
    throughSequence: PAGE_1_FENCE,
    offset: 0,
    limit: 20,
    total: 21,
    hasMore: true,
    items: FIRST_PAGE_TWENTY_ITEMS,
    ...overrides,
  };
}

function createJpegBlob(byteLength = 512): Blob {
  return new Blob([new Uint8Array(byteLength)], { type: 'image/jpeg' });
}

function buildMediaResult(
  representation: TrackedEpisodeMediaRepresentation,
  expectedFrameSha256: string,
  byteLength = 512,
): TrackedEpisodeMediaResult {
  return {
    blob: createJpegBlob(byteLength),
    representation,
    sha256: representation === 'FRAME' ? expectedFrameSha256 : SHA_SUBJECT_CROP,
    frameSha256: expectedFrameSha256,
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

describe('TrackedEpisodeEvidenceWorkspace', () => {
  let urlSequence = 0;
  let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    changeUiLanguage('en');
    urlSequence = 0;
    createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:tracked-workspace-${++urlSequence}`);
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('loads detail then 20-row paged history with exact uint64 throughSequence and raw item offset, filters by finding, and verifies specific observation/evidenceIndex SHA-256 for FRAME vs SUBJECT', async () => {
    const queryClient = createTestQueryClient();
    const getTrackedEpisode = vi.fn<TrackedEpisodeEvidenceClient['getTrackedEpisode']>(async () =>
      buildDetail(),
    );
    const listTrackedEpisodeObservations = vi.fn<
      TrackedEpisodeEvidenceClient['listTrackedEpisodeObservations']
    >(async (_token, _siteId, _episodeId, options?: TrackedEpisodeObservationOptions) => {
      if (options?.alertId === FINDING_VEST_ID) {
        return buildObservationPage({
          offset: 0,
          limit: 20,
          total: 2,
          hasMore: false,
          items: [OBS_2_VEST_SAME_EVENT_1, OBS_3_VEST_EVENT_2],
        });
      }
      if (options?.offset === 40) {
        return buildObservationPage({
          offset: 40,
          limit: 20,
          total: 41,
          hasMore: false,
          throughSequence: PAGE_1_FENCE,
          items: [OBS_3_VEST_EVENT_2],
        });
      }
      if (options?.offset === 20) {
        return buildObservationPage({
          offset: 20,
          limit: 20,
          total: 41,
          hasMore: true,
          throughSequence: PAGE_1_FENCE,
          items: SECOND_PAGE_TWENTY_ITEMS,
        });
      }
      return buildObservationPage({
        offset: 0,
        limit: 20,
        total: 41,
        hasMore: true,
        items: FIRST_PAGE_TWENTY_ITEMS,
      });
    });
    const readTrackedEpisodeMedia = vi.fn<TrackedEpisodeEvidenceClient['readTrackedEpisodeMedia']>(
      async (_token, _siteId, _episodeId, _source, representation, expectedFrameSha256) =>
        buildMediaResult(representation, expectedFrameSha256, 640),
    );

    const client: TrackedEpisodeEvidenceClient = {
      getTrackedEpisode,
      listTrackedEpisodeObservations,
      readTrackedEpisodeMedia,
    };

    render(
      <QueryClientProvider client={queryClient}>
        <TrackedEpisodeEvidenceWorkspace
          client={client}
          token="jwt-token-initial"
          sessionScope="actor-1:safety-officer"
          apiUrl="http://127.0.0.1:4000"
          siteId={SITE_ID}
          episodeId={EPISODE_ID}
        />
      </QueryClientProvider>,
    );

    // Wait for page 1 (20 rows) of history to render
    await waitFor(() => {
      expect(screen.getAllByTestId('tracked-history-item')).toHaveLength(20);
    });

    expect(getTrackedEpisode).toHaveBeenCalledTimes(1);
    expect(listTrackedEpisodeObservations).toHaveBeenCalledTimes(1);
    expect(listTrackedEpisodeObservations.mock.calls[0]?.[3]).toEqual({
      offset: 0,
      limit: 20,
    });

    // Rows 0 and 1 share EVENT_1_ID and personObservationIndex 0 across two findings;
    // composite alertId:eventId:personObservationIndex deduplication preserves both.
    expect(screen.getByTestId('tracked-history-count').textContent).toBe(
      'Loaded rows: 20 · Latest server total: 41',
    );
    expect(readTrackedEpisodeMedia).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    // Load page 2 and verify exact uint64 throughSequence from page 1 + raw returned item count (20)
    fireEvent.click(screen.getByTestId('tracked-history-load-more'));

    await waitFor(() => {
      expect(screen.getAllByTestId('tracked-history-item')).toHaveLength(39);
    });

    expect(listTrackedEpisodeObservations).toHaveBeenCalledTimes(2);
    expect(listTrackedEpisodeObservations.mock.calls[1]?.[3]).toEqual({
      offset: 20,
      limit: 20,
      throughSequence: '18446744073709551614',
    });
    expect(screen.getByTestId('tracked-history-count').textContent).toBe(
      'Loaded rows: 39 · Latest server total: 41',
    );

    // Load page 3 and verify next offset is 40 (raw returned rows 20 + 20, not deduplicated 39)
    fireEvent.click(screen.getByTestId('tracked-history-load-more'));

    await waitFor(() => {
      expect(screen.getAllByTestId('tracked-history-item')).toHaveLength(40);
    });

    expect(listTrackedEpisodeObservations).toHaveBeenCalledTimes(3);
    expect(listTrackedEpisodeObservations.mock.calls[2]?.[3]).toEqual({
      offset: 40,
      limit: 20,
      throughSequence: '18446744073709551614',
    });
    expect(screen.getByTestId('tracked-history-count').textContent).toBe(
      'Loaded rows: 40 · Latest server total: 41',
    );

    // Filter to the second finding (MISSING_VEST)
    fireEvent.click(screen.getByTestId(`tracked-workspace-filter-${FINDING_VEST_ID}`));

    await waitFor(() => {
      expect(screen.getAllByTestId('tracked-history-item')).toHaveLength(2);
    });
    expect(listTrackedEpisodeObservations).toHaveBeenCalledTimes(4);
    expect(listTrackedEpisodeObservations.mock.calls[3]?.[3]).toEqual({
      offset: 0,
      limit: 20,
      alertId: FINDING_VEST_ID,
    });

    // Click Mechanical PERSON crop #3 on the second filtered row (OBS_3_VEST_EVENT_2)
    // and verify expectedFrameSha256 is SHA_EVENT2_FRAME3 (never the first episode descriptor SHA_EVENT1_FRAME0).
    const filteredRows = screen.getAllByTestId('tracked-history-item');
    const secondFilteredRow = filteredRows[1]!;
    fireEvent.click(
      within(secondFilteredRow).getByRole('button', { name: 'Mechanical PERSON crop #3' }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('tracked-viewer-image')).toBeTruthy();
    });

    expect(readTrackedEpisodeMedia).toHaveBeenCalledTimes(1);
    expect(readTrackedEpisodeMedia.mock.calls[0]?.[3]).toEqual({
      alertId: FINDING_VEST_ID,
      eventId: EVENT_2_ID,
      personObservationIndex: 2,
      evidenceIndex: 3,
    });
    expect(readTrackedEpisodeMedia.mock.calls[0]?.[4]).toBe('SUBJECT');
    expect(readTrackedEpisodeMedia.mock.calls[0]?.[5]).toBe(SHA_EVENT2_FRAME3);
    expect(screen.getByTestId('tracked-viewer-badge').textContent).toContain(
      'Mechanical PERSON crop',
    );
    expect(screen.getByTestId('tracked-viewer-image').getAttribute('src')).toBe(
      'blob:tracked-workspace-1',
    );

    // Close the modal viewer first so background controls are no longer inert/aria-hidden
    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:tracked-workspace-1');

    // Now click Full FRAME #1 on the first filtered row (OBS_2_VEST_SAME_EVENT_1)
    const firstFilteredRow = screen.getAllByTestId('tracked-history-item')[0]!;
    fireEvent.click(within(firstFilteredRow).getByRole('button', { name: 'Full FRAME #1' }));

    await waitFor(() => {
      expect(screen.getByTestId('tracked-viewer-image').getAttribute('src')).toBe(
        'blob:tracked-workspace-2',
      );
    });

    expect(readTrackedEpisodeMedia).toHaveBeenCalledTimes(2);
    expect(readTrackedEpisodeMedia.mock.calls[1]?.[3]).toEqual({
      alertId: FINDING_VEST_ID,
      eventId: EVENT_1_ID,
      personObservationIndex: 0,
      evidenceIndex: 1,
    });
    expect(readTrackedEpisodeMedia.mock.calls[1]?.[4]).toBe('FRAME');
    expect(readTrackedEpisodeMedia.mock.calls[1]?.[5]).toBe(SHA_EVENT1_FRAME1);
    expect(screen.getByTestId('tracked-viewer-badge').textContent).toContain('Full FRAME');
  });

  it('retains authorized rows and open viewer on transient next-page error, retries the exact same offset after closing viewer, and hides stale rows/viewer on base refetch error', async () => {
    const queryClient = createTestQueryClient();
    let rejectDeferredNextPage: ((error: Error) => void) | null = null;
    let shouldDeferNextPage = true;
    let shouldFailBaseRefetch = false;

    const client: TrackedEpisodeEvidenceClient = {
      getTrackedEpisode: vi.fn(async () => buildDetail()),
      listTrackedEpisodeObservations: vi.fn((_token, _siteId, _episodeId, options) => {
        if (shouldFailBaseRefetch && (options?.offset ?? 0) === 0) {
          return Promise.reject(new ApiError('network', 'Base history refetch failed', 502));
        }
        if (options?.offset === 20) {
          if (shouldDeferNextPage) {
            return new Promise<TrackedEpisodeObservationPage>((_resolve, reject) => {
              rejectDeferredNextPage = reject;
            });
          }
          return Promise.resolve(
            buildObservationPage({
              offset: 20,
              limit: 20,
              total: 21,
              hasMore: false,
              throughSequence: PAGE_1_FENCE,
              items: [OBS_3_VEST_EVENT_2],
            }),
          );
        }
        return Promise.resolve(
          buildObservationPage({
            offset: 0,
            limit: 20,
            total: 21,
            hasMore: true,
            throughSequence: PAGE_1_FENCE,
            items: FIRST_PAGE_TWENTY_ITEMS,
          }),
        );
      }),
      readTrackedEpisodeMedia: vi.fn(
        async (_token, _siteId, _episodeId, _source, representation, expectedFrameSha256) =>
          buildMediaResult(representation, expectedFrameSha256),
      ),
    };

    render(
      <QueryClientProvider client={queryClient}>
        <TrackedEpisodeEvidenceWorkspace
          client={client}
          token="jwt-token-alpha"
          sessionScope="actor-1:safety-officer"
          apiUrl="http://127.0.0.1:4000"
          siteId={SITE_ID}
          episodeId={EPISODE_ID}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId('tracked-history-item')).toHaveLength(20);
    });

    // 1. Start next-page load while background is enabled, then open viewer before next-page rejects
    fireEvent.click(screen.getByTestId('tracked-history-load-more'));
    const firstRow = screen.getAllByTestId('tracked-history-item')[0]!;
    fireEvent.click(within(firstRow).getByRole('button', { name: 'Full FRAME #0' }));

    await waitFor(() => {
      expect(screen.getByTestId('tracked-viewer-image').getAttribute('src')).toBe(
        'blob:tracked-workspace-1',
      );
    });

    // 2. Reject the deferred next-page request -> retains all 20 authorized rows and keeps viewer open
    await act(async () => {
      rejectDeferredNextPage?.(new ApiError('network', 'Next page upstream timeout', 503));
    });

    await waitFor(() => {
      expect(screen.getByTestId('tracked-history-load-more-error')).toBeTruthy();
    });

    expect(screen.getAllByTestId('tracked-history-item')).toHaveLength(20);
    expect(screen.getByTestId('tracked-history-load-more-error').textContent).toContain(
      'Next page upstream timeout',
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByTestId('tracked-viewer-image').getAttribute('src')).toBe(
      'blob:tracked-workspace-1',
    );

    // 3. Close viewer first so background controls are active, then click Retry loading more
    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:tracked-workspace-1');

    shouldDeferNextPage = false;
    fireEvent.click(
      within(screen.getByTestId('tracked-history-load-more-error')).getByRole('button', {
        name: /retry loading more/i,
      }),
    );

    await waitFor(() => {
      expect(screen.getAllByTestId('tracked-history-item')).toHaveLength(21);
    });
    expect(screen.queryByTestId('tracked-history-load-more-error')).toBeNull();
    expect(client.listTrackedEpisodeObservations).toHaveBeenLastCalledWith(
      'jwt-token-alpha',
      SITE_ID,
      EPISODE_ID,
      { offset: 20, limit: 20, throughSequence: PAGE_1_FENCE },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // 4. Reopen viewer and trigger a BASE refetch failure -> must hide stale rows and close/revoke viewer
    const updatedFirstRow = screen.getAllByTestId('tracked-history-item')[0]!;
    fireEvent.click(within(updatedFirstRow).getByRole('button', { name: 'Full FRAME #0' }));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-viewer-image').getAttribute('src')).toBe(
        'blob:tracked-workspace-2',
      );
    });

    shouldFailBaseRefetch = true;
    await act(async () => {
      await queryClient.refetchQueries({
        predicate: (query) => query.queryKey.includes('history'),
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('tracked-history-error')).toBeTruthy();
    });
    expect(screen.queryAllByTestId('tracked-history-item')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:tracked-workspace-2');
  });

  it('synchronously hides old rows and viewer image on credential, sessionScope, or finding filter switch, blocks late old responses, and never places token in query keys or DOM', async () => {
    const queryClient = createTestQueryClient();
    const secretTokenA = 'super-secret-jwt-token-alpha-999';
    const secretTokenB = 'super-secret-jwt-token-beta-888';

    let resolveTokenBDetail: ((detail: TrackedEpisodeDetail) => void) | null = null;
    let resolveVestFilterHistory: ((page: TrackedEpisodeObservationPage) => void) | null = null;
    let resolveLateTokenAMedia: ((media: TrackedEpisodeMediaResult) => void) | null = null;
    let tokenAMediaSignal: AbortSignal | undefined;

    const client: TrackedEpisodeEvidenceClient = {
      getTrackedEpisode: vi.fn((token) => {
        if (token === secretTokenB) {
          return new Promise<TrackedEpisodeDetail>((resolve) => {
            resolveTokenBDetail = resolve;
          });
        }
        return Promise.resolve(buildDetail());
      }),
      listTrackedEpisodeObservations: vi.fn((token, _siteId, _episodeId, options) => {
        if (token === secretTokenA && options?.alertId === FINDING_VEST_ID) {
          return new Promise<TrackedEpisodeObservationPage>((resolve) => {
            resolveVestFilterHistory = resolve;
          });
        }
        return Promise.resolve(
          buildObservationPage({
            offset: 0,
            limit: 20,
            total: 2,
            hasMore: false,
            items: [OBS_1_HELMET_EVENT_1, OBS_2_VEST_SAME_EVENT_1],
          }),
        );
      }),
      readTrackedEpisodeMedia: vi.fn(
        (token, _siteId, _episodeId, _source, representation, expectedFrameSha256, options) => {
          if (token === secretTokenA && representation === 'SUBJECT') {
            tokenAMediaSignal = options?.signal;
            return new Promise<TrackedEpisodeMediaResult>((resolve) => {
              resolveLateTokenAMedia = resolve;
            });
          }
          return Promise.resolve(buildMediaResult(representation, expectedFrameSha256, 512));
        },
      ),
    };

    const buildProps = (
      overrides: Partial<TrackedEpisodeEvidenceWorkspaceProps> = {},
    ): TrackedEpisodeEvidenceWorkspaceProps => ({
      client,
      token: secretTokenA,
      sessionScope: 'actor-alpha:safety',
      apiUrl: 'http://127.0.0.1:4000',
      siteId: SITE_ID,
      episodeId: EPISODE_ID,
      ...overrides,
    });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <TrackedEpisodeEvidenceWorkspace {...buildProps()} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId('tracked-history-item')).toHaveLength(2);
    });

    // Expand episode technical details and open FRAME #0 viewer
    fireEvent.click(screen.getByRole('button', { name: /show episode technical metadata/i }));
    expect(screen.getByTestId('tracked-workspace-technical')).toBeTruthy();

    const firstRow = screen.getAllByTestId('tracked-history-item')[0]!;
    fireEvent.click(within(firstRow).getByRole('button', { name: 'Full FRAME #0' }));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-viewer-image').getAttribute('src')).toBe(
        'blob:tracked-workspace-1',
      );
    });

    // Verify query keys and DOM never contain the raw token string
    const cachedQueries = queryClient.getQueryCache().getAll();
    expect(cachedQueries.length).toBeGreaterThan(0);
    for (const query of cachedQueries) {
      expect(JSON.stringify(query.queryKey)).not.toContain(secretTokenA);
    }
    expect(document.body.textContent ?? '').not.toContain(secretTokenA);

    // Close viewer before clicking background finding filter button
    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:tracked-workspace-1');

    // Switch finding filter to MISSING_VEST while its history request is pending:
    // immediately hides old All-findings rows
    fireEvent.click(screen.getByTestId(`tracked-workspace-filter-${FINDING_VEST_ID}`));
    expect(screen.queryAllByTestId('tracked-history-item')).toHaveLength(0);
    expect(screen.getByTestId('tracked-history-loading')).toBeTruthy();

    await act(async () => {
      resolveVestFilterHistory?.(
        buildObservationPage({
          offset: 0,
          limit: 20,
          total: 1,
          hasMore: false,
          items: [OBS_3_VEST_EVENT_2],
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('tracked-history-item')).toHaveLength(1);
    });

    // Start a pending SUBJECT media request under token A, then switch credentials to token B / actor-beta
    const vestRow = screen.getAllByTestId('tracked-history-item')[0]!;
    fireEvent.click(within(vestRow).getByRole('button', { name: 'Mechanical PERSON crop #3' }));
    expect(screen.getByTestId('tracked-viewer-loading')).toBeTruthy();

    rerender(
      <QueryClientProvider client={queryClient}>
        <TrackedEpisodeEvidenceWorkspace
          {...buildProps({ token: secretTokenB, sessionScope: 'actor-beta:safety' })}
        />
      </QueryClientProvider>,
    );

    // Synchronously hides previous rows, technical panel, and viewer modal before token B detail resolves
    expect(screen.queryAllByTestId('tracked-history-item')).toHaveLength(0);
    expect(screen.queryByTestId('tracked-workspace-technical')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('tracked-workspace-detail-loading')).toBeTruthy();
    expect(tokenAMediaSignal?.aborted).toBe(true);

    // Resolving the late token A media promise cannot reopen the viewer or allocate a new object URL
    const createCallsBeforeLateResolve = createObjectURLSpy.mock.calls.length;
    await act(async () => {
      resolveLateTokenAMedia?.(buildMediaResult('SUBJECT', SHA_EVENT2_FRAME3));
      await Promise.resolve();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(createObjectURLSpy).toHaveBeenCalledTimes(createCallsBeforeLateResolve);

    // Resolve token B detail and confirm query keys still never contain either token
    await act(async () => {
      resolveTokenBDetail?.(buildDetail());
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('tracked-history-item')).toHaveLength(2);
    });
    for (const query of queryClient.getQueryCache().getAll()) {
      const serialized = JSON.stringify(query.queryKey);
      expect(serialized).not.toContain(secretTokenA);
      expect(serialized).not.toContain(secretTokenB);
    }
  });

  it('aborts in-flight readTrackedEpisodeMedia when closing the viewer and prevents a late media response from reopening the modal', async () => {
    const queryClient = createTestQueryClient();
    let capturedMediaSignal: AbortSignal | undefined;
    let resolvePendingMedia: ((result: TrackedEpisodeMediaResult) => void) | null = null;

    const client: TrackedEpisodeEvidenceClient = {
      getTrackedEpisode: vi.fn(async () => buildDetail()),
      listTrackedEpisodeObservations: vi.fn(async () =>
        buildObservationPage({
          offset: 0,
          limit: 20,
          total: 1,
          hasMore: false,
          items: [OBS_1_HELMET_EVENT_1],
        }),
      ),
      readTrackedEpisodeMedia: vi.fn(
        (_token, _siteId, _episodeId, _source, _rep, _sha, options) => {
          capturedMediaSignal = options?.signal;
          return new Promise<TrackedEpisodeMediaResult>((resolve) => {
            resolvePendingMedia = resolve;
          });
        },
      ),
    };

    render(
      <QueryClientProvider client={queryClient}>
        <TrackedEpisodeEvidenceWorkspace
          client={client}
          token="jwt-token-close-test"
          sessionScope="actor-1:safety"
          apiUrl="http://127.0.0.1:4000"
          siteId={SITE_ID}
          episodeId={EPISODE_ID}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId('tracked-history-item')).toHaveLength(1);
    });

    const row = screen.getAllByTestId('tracked-history-item')[0]!;
    fireEvent.click(within(row).getByRole('button', { name: 'Full FRAME #0' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(screen.getByTestId('tracked-viewer-loading')).toBeTruthy();
    });
    expect(capturedMediaSignal).toBeDefined();
    expect(capturedMediaSignal?.aborted).toBe(false);

    // Close the viewer while media request is still in-flight
    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(capturedMediaSignal?.aborted).toBe(true);

    // Late resolution must not reopen the dialog or allocate an object URL
    await act(async () => {
      resolvePendingMedia?.(buildMediaResult('FRAME', SHA_EVENT1_FRAME0));
      await Promise.resolve();
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });

  it('renders truthful loading, 403 forbidden, empty, and error states across detail, history, and media without inferring all-clear or Worker identity', async () => {
    const queryClient = createTestQueryClient();
    let detailMode: 'forbidden' | 'error' | 'ok' = 'forbidden';
    let historyMode: 'ok' | 'forbidden' = 'ok';
    let mediaMode: 'forbidden' | 'error' | 'ok' = 'forbidden';

    const client: TrackedEpisodeEvidenceClient = {
      getTrackedEpisode: vi.fn(async () => {
        if (detailMode === 'forbidden') {
          throw new ApiError('http', 'Site access denied', 403);
        }
        if (detailMode === 'error') {
          throw new ApiError('network', 'Detail gateway error', 502);
        }
        return buildDetail({ collectionState: 'SEALED' });
      }),
      listTrackedEpisodeObservations: vi.fn(async (_token, _siteId, _episodeId, options) => {
        if (historyMode === 'forbidden') {
          throw new ApiError('http', 'History access denied', 403);
        }
        if (options?.alertId === FINDING_VEST_ID) {
          return buildObservationPage({
            offset: 0,
            limit: 20,
            total: 0,
            hasMore: false,
            items: [],
          });
        }
        return buildObservationPage({
          offset: 0,
          limit: 20,
          total: 1,
          hasMore: false,
          items: [OBS_1_HELMET_EVENT_1],
        });
      }),
      readTrackedEpisodeMedia: vi.fn(
        async (_token, _siteId, _episodeId, _source, representation, expectedFrameSha256) => {
          if (mediaMode === 'forbidden') {
            throw new ApiError('http', 'Media access denied', 403);
          }
          if (mediaMode === 'error') {
            throw new ApiError('network', 'Media storage failed', 500);
          }
          return buildMediaResult(representation, expectedFrameSha256);
        },
      ),
    };

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <TrackedEpisodeEvidenceWorkspace
          client={client}
          token="jwt-token-states"
          sessionScope="actor-1:safety"
          apiUrl="http://127.0.0.1:4000"
          siteId={SITE_ID}
          episodeId={EPISODE_ID}
        />
      </QueryClientProvider>,
    );

    // 1. Detail 403 FORBIDDEN state
    await waitFor(() => {
      expect(screen.getByTestId('tracked-workspace-detail-forbidden')).toBeTruthy();
    });
    expect(screen.queryByTestId('tracked-observation-history')).toBeNull();

    // 2. Detail 502 ERROR state + explicit retry to OK
    detailMode = 'error';
    rerender(
      <QueryClientProvider client={queryClient}>
        <TrackedEpisodeEvidenceWorkspace
          client={client}
          token="jwt-token-states-2"
          sessionScope="actor-2:safety"
          apiUrl="http://127.0.0.1:4000"
          siteId={SITE_ID}
          episodeId={EPISODE_ID}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('tracked-workspace-detail-error')).toBeTruthy();
    });

    detailMode = 'ok';
    fireEvent.click(screen.getByRole('button', { name: /retry episode/i }));

    await waitFor(() => {
      expect(screen.getAllByTestId('tracked-history-item')).toHaveLength(1);
    });
    expect(screen.getByTestId('tracked-workspace-state-badge').textContent).toBe('Sealed');

    // 3. Media 403 FORBIDDEN state inside viewer modal, then close viewer
    const row = screen.getAllByTestId('tracked-history-item')[0]!;
    fireEvent.click(within(row).getByRole('button', { name: 'Full FRAME #0' }));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-viewer-forbidden')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // 4. Media 500 ERROR state + explicit retry inside viewer modal, then close viewer
    mediaMode = 'error';
    fireEvent.click(within(row).getByRole('button', { name: 'Mechanical PERSON crop #0' }));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-viewer-error')).toBeTruthy();
    });

    mediaMode = 'ok';
    fireEvent.click(
      within(screen.getByTestId('tracked-viewer-error')).getByRole('button', { name: /retry/i }),
    );
    await waitFor(() => {
      expect(screen.getByTestId('tracked-viewer-image')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // 5. Switch to finding filter with 0 saved observations -> shows truthful non-all-clear empty state
    fireEvent.click(screen.getByTestId(`tracked-workspace-filter-${FINDING_VEST_ID}`));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-history-empty')).toBeTruthy();
    });
    const emptyText = screen.getByTestId('tracked-history-empty').textContent ?? '';
    expect(emptyText).toContain('No matching saved original observations');
    expect(emptyText).not.toMatch(/all clear|compliant|no violations/i);

    // 6. Switch back to finding filter when history returns 403 FORBIDDEN -> renders tracked-history-forbidden
    historyMode = 'forbidden';
    fireEvent.click(screen.getByTestId(`tracked-workspace-filter-${FINDING_HELMET_ID}`));
    await waitFor(() => {
      expect(screen.getByTestId('tracked-history-forbidden')).toBeTruthy();
    });
    expect(screen.queryAllByTestId('tracked-history-item')).toHaveLength(0);

    await act(async () => {
      changeUiLanguage('vi');
    });
    expect(screen.getByTestId('tracked-workspace-state-badge').textContent).toBe('Đã niêm phong');
  });
});
