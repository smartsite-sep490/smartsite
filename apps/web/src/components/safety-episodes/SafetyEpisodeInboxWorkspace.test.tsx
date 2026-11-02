// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import type {
  SafetyEpisodeInboxItem,
  SafetyEpisodeInboxOptions,
  SafetyEpisodeInboxPage,
  SafetyEpisodeReadCommand,
  SafetyEpisodeReadResponse,
} from '@smartsite/contracts/safety-episodes';
import { changeUiLanguage } from '../../i18n/runtime';
import {
  SafetyEpisodeInboxWorkspace,
  type SafetyEpisodeInboxClient,
  type SafetyEpisodeInboxSiteOption,
  type SafetyEpisodeInboxWorkspaceProps,
} from './SafetyEpisodeInboxWorkspace';

const SITE_A_ID = '11111111-1111-4111-8111-111111111111';
const SITE_B_ID = '22222222-2222-4222-8222-222222222222';
const SITE_UNASSIGNED_ID = '33333333-3333-4333-8333-333333333333';

const CAMERA_A_ID = '44444444-4444-4444-8444-444444444444';
const CAMERA_B_ID = '55555555-5555-4555-8555-555555555555';

const SEGMENT_1_ID = '66666666-6666-4666-8666-666666666666';
const EVENT_1_ID = '77777777-7777-4777-8777-777777777777';
const SCOPE_SHA256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const RECIPIENT_A_1_ID = 'aaaa1111-1111-4111-8111-111111111101';
const RECIPIENT_B_1_ID = 'bbbb2222-2222-4222-8222-222222222201';
const RECIPIENT_UNASSIGNED_ID = 'cccc3333-3333-4333-8333-333333333301';

const EPISODE_A_1_ID = 'dddd1111-1111-4111-8111-111111111101';
const EPISODE_B_1_ID = 'eeee2222-2222-4222-8222-222222222201';
const EPISODE_UNASSIGNED_ID = 'ffff3333-3333-4333-8333-333333333301';

const AUTHORIZED_SITES: readonly SafetyEpisodeInboxSiteOption[] = [
  { id: SITE_A_ID, name: 'North Tower' },
  { id: SITE_B_ID, name: 'South Depot' },
];

const ITEM_A_1: SafetyEpisodeInboxItem = {
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

const ITEM_B_1: SafetyEpisodeInboxItem = {
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

const ITEM_UNASSIGNED: SafetyEpisodeInboxItem = {
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

function buildFillerInboxItem(index: number, siteId = SITE_A_ID): SafetyEpisodeInboxItem {
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

function renderWorkspace(
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

describe('SafetyEpisodeInboxWorkspace', () => {
  beforeEach(() => {
    window.localStorage.clear();
    changeUiLanguage('en');
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('distinguishes unavailable empty-sites scope, pending load, settled filtered empty, 502 retryable error, and 403 forbidden states', async () => {
    const listDeferred = createDeferred<SafetyEpisodeInboxPage>();
    const listMock = vi
      .fn<SafetyEpisodeInboxClient['listSafetyEpisodeInbox']>()
      .mockReturnValueOnce(listDeferred.promise);
    const readMock = vi.fn<SafetyEpisodeInboxClient['readSafetyEpisodeInbox']>();
    const client: SafetyEpisodeInboxClient = {
      listSafetyEpisodeInbox: listMock,
      readSafetyEpisodeInbox: readMock,
    };

    const queryClient = createTestQueryClient();
    const { rerender, props } = renderWorkspace(
      {
        client,
        sites: [],
      },
      queryClient,
    );

    // 1. Unavailable when sites=[] — no network requests and no fake '0 incidents'
    expect(screen.getByTestId('safety-inbox-unavailable').textContent).toContain(
      'unavailable because no authorized sites are assigned',
    );
    expect(screen.queryByTestId('safety-inbox-empty')).toBeNull();
    expect(listMock).not.toHaveBeenCalled();

    // 2. Pending state when authorized sites are provided
    rerender(
      <QueryClientProvider client={queryClient}>
        <SafetyEpisodeInboxWorkspace {...props} client={client} sites={AUTHORIZED_SITES} />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('safety-inbox-loading')).toBeTruthy();
    expect(screen.queryByTestId('safety-inbox-empty')).toBeNull();
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenLastCalledWith(
      props.token,
      { offset: 0, limit: 20, readStatus: 'ALL' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // 3. Settled empty state for ALL filter
    await act(async () => {
      listDeferred.resolve({
        items: [],
        total: 0,
        unreadCount: 0,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('safety-inbox-empty').textContent).toContain(
        'No matching safety episodes in the current filter.',
      );
    });
    expect(screen.getByTestId('safety-inbox-summary-counts').textContent).toContain(
      'Current filter — Server unread: 0 · Server total: 0 · Loaded rows: 0',
    );

    // 4. Switching to UNREAD filter triggers a 502 error, then Retry recovers to emptyUnread
    listMock
      .mockRejectedValueOnce(new ApiError('http', 'Upstream gateway failed', 502))
      .mockResolvedValueOnce({
        items: [],
        total: 0,
        unreadCount: 0,
      });

    fireEvent.click(screen.getByTestId('safety-inbox-read-filter-UNREAD'));

    await waitFor(() => {
      expect(screen.getByTestId('safety-inbox-error')).toBeTruthy();
    });
    expect(screen.queryByTestId('safety-inbox-empty')).toBeNull();

    fireEvent.click(screen.getByTestId('safety-inbox-retry'));

    await waitFor(() => {
      expect(screen.getByTestId('safety-inbox-empty').textContent).toContain(
        'No unread safety episodes in the current filter.',
      );
    });

    // 5. Selecting a specific site that returns 403 renders safety-inbox-forbidden
    listMock.mockRejectedValueOnce(new ApiError('http', 'Site access revoked', 403));
    fireEvent.click(screen.getByTestId(`safety-inbox-site-filter-${SITE_A_ID}`));

    await waitFor(() => {
      expect(screen.getByTestId('safety-inbox-forbidden').textContent).toContain(
        'do not have permission to view these safety episodes',
      );
    });
    expect(screen.queryByTestId('safety-inbox-error')).toBeNull();
  });

  it('groups loaded rows by authorized Site, excludes unauthorized Site rows, paginates 20 rows by raw offset with deduplication, and keeps Open separate from Mark-Read', async () => {
    const firstPageItems: SafetyEpisodeInboxItem[] = [
      ITEM_A_1,
      ITEM_B_1,
      ITEM_UNASSIGNED,
      ...Array.from({ length: 17 }, (_, idx) => buildFillerInboxItem(idx + 1, SITE_A_ID)),
    ];
    expect(firstPageItems).toHaveLength(20);

    const updatedItemA1: SafetyEpisodeInboxItem = {
      ...ITEM_A_1,
      episode: {
        ...ITEM_A_1.episode,
        contentRevision: 3,
        findingCount: 5,
        lastObservedAt: '2026-11-01T08:09:00.000Z',
      },
      updatedAt: '2026-11-01T08:09:05.000Z',
    };

    const secondPageItems: SafetyEpisodeInboxItem[] = [
      updatedItemA1,
      buildFillerInboxItem(30, SITE_B_ID),
    ];

    const listMock = vi
      .fn<SafetyEpisodeInboxClient['listSafetyEpisodeInbox']>()
      .mockResolvedValueOnce({
        items: firstPageItems,
        total: 22,
        unreadCount: 15,
      })
      .mockResolvedValueOnce({
        items: secondPageItems,
        total: 22,
        unreadCount: 16,
      });
    const readMock = vi.fn<SafetyEpisodeInboxClient['readSafetyEpisodeInbox']>();
    const onOpenEpisode = vi.fn<(item: SafetyEpisodeInboxItem) => void>();

    renderWorkspace({
      client: {
        listSafetyEpisodeInbox: listMock,
        readSafetyEpisodeInbox: readMock,
      },
      onOpenEpisode,
    });

    await waitFor(() => {
      expect(screen.getByTestId('safety-inbox-ready')).toBeTruthy();
    });

    // Server counts come from latest page; loaded count reflects 19 authorized rows (1 unassigned filtered out)
    expect(screen.getByTestId('safety-inbox-summary-counts').textContent).toContain(
      'Current filter — Server unread: 15 · Server total: 22 · Loaded rows: 19',
    );
    expect(screen.getByTestId('safety-inbox-partial-coverage').textContent).toContain(
      'Loaded 19 of 22 matching episode rows.',
    );

    // Multi-Site grouping for SITE_A (18 rows) and SITE_B (1 row); SITE_UNASSIGNED never rendered
    expect(screen.getByTestId(`safety-inbox-site-name-${SITE_A_ID}`).textContent).toContain(
      'North Tower',
    );
    expect(screen.getByTestId(`safety-inbox-site-count-${SITE_A_ID}`).textContent).toContain(
      'Loaded rows: 18',
    );
    expect(screen.getByTestId(`safety-inbox-site-name-${SITE_B_ID}`).textContent).toContain(
      'South Depot',
    );
    expect(screen.getByTestId(`safety-inbox-site-count-${SITE_B_ID}`).textContent).toContain(
      'Loaded rows: 1',
    );
    expect(screen.queryByTestId(`safety-inbox-site-group-${SITE_UNASSIGNED_ID}`)).toBeNull();
    expect(screen.queryByTestId(`safety-inbox-open-${ITEM_UNASSIGNED.id}`)).toBeNull();
    expect(screen.queryByTestId(`safety-inbox-mark-read-${ITEM_UNASSIGNED.id}`)).toBeNull();

    // Concise subject copy & collapsed technical IDs by default
    expect(screen.getByTestId(`safety-inbox-row-subject-${ITEM_A_1.id}`).textContent).toContain(
      '1 tracked person / 4 findings',
    );
    expect(screen.queryByTestId(`safety-inbox-technical-${ITEM_A_1.id}`)).toBeNull();

    fireEvent.click(screen.getByTestId(`safety-inbox-tech-toggle-${ITEM_A_1.id}`));
    const techList = screen.getByTestId(`safety-inbox-technical-${ITEM_A_1.id}`);
    expect(techList.textContent).toContain('Technical segment ID (not Worker ID)');
    expect(within(techList).getByText(SEGMENT_1_ID).className).toContain('break-all');
    expect(within(techList).getByText(SEGMENT_1_ID).className).toContain('font-mono');
    expect(within(techList).getByText(SCOPE_SHA256).className).toContain('break-all');
    expect(within(techList).getByText(SCOPE_SHA256).className).toContain('font-mono');

    // VI localization check
    await act(async () => {
      await changeUiLanguage('vi');
    });
    expect(screen.getByRole('heading', { name: 'Hồ sơ cần xem' })).toBeTruthy();
    expect(screen.getByTestId(`safety-inbox-row-subject-${ITEM_A_1.id}`).textContent).toContain(
      '1 người theo dõi / 4 phát hiện',
    );
    expect(techList.textContent).toContain('Mã phân đoạn kỹ thuật (không phải mã Công nhân)');
    expect(screen.getByTestId(`safety-inbox-open-${ITEM_A_1.id}`).textContent).toContain(
      'Mở hồ sơ',
    );
    expect(screen.getByTestId(`safety-inbox-mark-read-${ITEM_A_1.id}`).textContent).toContain(
      'Đánh dấu đã đọc',
    );
    await act(async () => {
      await changeUiLanguage('en');
    });

    // Opening an episode invokes onOpenEpisode with exact authorized item and NEVER calls readSafetyEpisodeInbox
    fireEvent.click(screen.getByTestId(`safety-inbox-open-${ITEM_A_1.id}`));
    expect(onOpenEpisode).toHaveBeenCalledTimes(1);
    expect(onOpenEpisode).toHaveBeenLastCalledWith(ITEM_A_1);
    expect(readMock).not.toHaveBeenCalled();

    // Load more advances offset by raw returned length (20, NOT filtered 19) and deduplicates ITEM_A_1
    fireEvent.click(screen.getByTestId('safety-inbox-load-more'));

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2);
    });
    expect(listMock).toHaveBeenLastCalledWith(
      'secret-jwt-token-inbox-alpha',
      { offset: 20, limit: 20, readStatus: 'ALL' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await waitFor(() => {
      expect(screen.getByTestId(`safety-inbox-row-revision-${ITEM_A_1.id}`).textContent).toContain(
        'Rev #3',
      );
    });

    // Deduplicated: SITE_A still has 18 rows (updated ITEM_A_1 in place), SITE_B now has 2 rows, latest server unreadCount=16
    expect(screen.getByTestId(`safety-inbox-site-count-${SITE_A_ID}`).textContent).toContain(
      'Loaded rows: 18',
    );
    expect(screen.getByTestId(`safety-inbox-site-count-${SITE_B_ID}`).textContent).toContain(
      'Loaded rows: 2',
    );
    expect(screen.getByTestId('safety-inbox-summary-counts').textContent).toContain(
      'Current filter — Server unread: 16 · Server total: 22 · Loaded rows: 20',
    );

    // Opening ITEM_A_1 after deduplicated update passes the latest revision 3 item
    fireEvent.click(screen.getByTestId(`safety-inbox-open-${ITEM_A_1.id}`));
    expect(onOpenEpisode).toHaveBeenCalledTimes(2);
    expect(onOpenEpisode).toHaveBeenLastCalledWith(updatedItemA1);
    expect(readMock).not.toHaveBeenCalled();
  });

  it('submits captured displayedRevision=2 on explicit Mark-Read, keeps row Unread when server returns current=3/seen=2/unread=true, and refetches authoritative counts', async () => {
    const readDeferred1 = createDeferred<SafetyEpisodeReadResponse>();
    const refetchAfterConcurrentRevDeferred = createDeferred<SafetyEpisodeInboxPage>();
    const refetchPageAfterConcurrentRevision: SafetyEpisodeInboxPage = {
      items: [
        {
          ...ITEM_A_1,
          episode: {
            ...ITEM_A_1.episode,
            contentRevision: 3,
            findingCount: 5,
          },
          seenRevision: 2,
          unread: true,
        },
        ITEM_B_1,
      ],
      total: 2,
      unreadCount: 1,
    };
    const refetchPageAfterFinalRead: SafetyEpisodeInboxPage = {
      items: [
        {
          ...ITEM_A_1,
          episode: {
            ...ITEM_A_1.episode,
            contentRevision: 3,
            findingCount: 5,
          },
          seenRevision: 3,
          unread: false,
        },
        ITEM_B_1,
      ],
      total: 2,
      unreadCount: 0,
    };

    const listMock = vi
      .fn<SafetyEpisodeInboxClient['listSafetyEpisodeInbox']>()
      .mockResolvedValueOnce({
        items: [ITEM_A_1, ITEM_B_1],
        total: 2,
        unreadCount: 1,
      })
      .mockReturnValueOnce(refetchAfterConcurrentRevDeferred.promise)
      .mockResolvedValueOnce(refetchPageAfterFinalRead);

    const readMock = vi
      .fn<SafetyEpisodeInboxClient['readSafetyEpisodeInbox']>()
      .mockReturnValueOnce(readDeferred1.promise)
      .mockResolvedValueOnce({
        id: ITEM_A_1.id,
        contentRevision: 3,
        seenRevision: 3,
        unread: false,
      });

    renderWorkspace({
      client: {
        listSafetyEpisodeInbox: listMock,
        readSafetyEpisodeInbox: readMock,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId(`safety-inbox-row-status-${ITEM_A_1.id}`).textContent).toContain(
        'Unread',
      );
    });
    expect(screen.getByTestId(`safety-inbox-row-revision-${ITEM_A_1.id}`).textContent).toContain(
      'Rev #2',
    );
    expect(
      (screen.getByTestId(`safety-inbox-mark-read-${ITEM_B_1.id}`) as HTMLButtonElement).disabled,
    ).toBe(true);

    const markReadButton = screen.getByTestId(
      `safety-inbox-mark-read-${ITEM_A_1.id}`,
    ) as HTMLButtonElement;
    fireEvent.click(markReadButton);
    // Attempt duplicate click while pending
    fireEvent.click(markReadButton);

    expect(readMock).toHaveBeenCalledTimes(1);
    expect(readMock).toHaveBeenLastCalledWith(
      'secret-jwt-token-inbox-alpha',
      ITEM_A_1.id,
      { seenRevision: 2 } satisfies SafetyEpisodeReadCommand,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(markReadButton.disabled).toBe(true);
    expect(markReadButton.textContent).toContain('Marking…');

    // Server reports a newer revision 3 appeared concurrently: seenRevision=2, contentRevision=3, unread=true
    await act(async () => {
      readDeferred1.resolve({
        id: ITEM_A_1.id,
        contentRevision: 3,
        seenRevision: 2,
        unread: true,
      });
    });

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2);
    });
    // Before list refetch resolves, row keeps original Rev #2 summary, remains Unread, shows awaiting-refresh hint, and disables Mark-Read
    expect(screen.getByTestId(`safety-inbox-row-revision-${ITEM_A_1.id}`).textContent).toContain(
      'Rev #2',
    );
    expect(screen.getByTestId(`safety-inbox-row-status-${ITEM_A_1.id}`).textContent).toContain(
      'Unread',
    );
    expect(
      screen.getByTestId(`safety-inbox-awaiting-refresh-${ITEM_A_1.id}`).textContent,
    ).toContain('Newer revision #3 detected (seen #2); awaiting summary refresh.');
    expect(
      (screen.getByTestId(`safety-inbox-mark-read-${ITEM_A_1.id}`) as HTMLButtonElement).disabled,
    ).toBe(true);

    // Authoritative list refetch resolves with revision 3 summary
    await act(async () => {
      refetchAfterConcurrentRevDeferred.resolve(refetchPageAfterConcurrentRevision);
    });

    await waitFor(() => {
      expect(screen.getByTestId(`safety-inbox-row-revision-${ITEM_A_1.id}`).textContent).toContain(
        'Rev #3',
      );
    });
    expect(screen.getByTestId(`safety-inbox-row-seen-${ITEM_A_1.id}`).textContent).toContain(
      'Seen rev #2',
    );
    expect(screen.queryByTestId(`safety-inbox-awaiting-refresh-${ITEM_A_1.id}`)).toBeNull();
    expect(screen.getByTestId(`safety-inbox-row-status-${ITEM_A_1.id}`).textContent).toContain(
      'Unread',
    );
    expect(screen.getByTestId('safety-inbox-summary-counts').textContent).toContain(
      'Current filter — Server unread: 1 · Server total: 2 · Loaded rows: 2',
    );

    // Clicking Mark-Read again now captures authoritative displayedRevision=3 and marks the row Read
    const markReadButtonRev3 = screen.getByTestId(
      `safety-inbox-mark-read-${ITEM_A_1.id}`,
    ) as HTMLButtonElement;
    expect(markReadButtonRev3.disabled).toBe(false);
    fireEvent.click(markReadButtonRev3);

    await waitFor(() => {
      expect(readMock).toHaveBeenCalledTimes(2);
    });
    expect(readMock).toHaveBeenLastCalledWith(
      'secret-jwt-token-inbox-alpha',
      ITEM_A_1.id,
      { seenRevision: 3 } satisfies SafetyEpisodeReadCommand,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await waitFor(() => {
      expect(screen.getByTestId(`safety-inbox-row-status-${ITEM_A_1.id}`).textContent).toContain(
        'Read',
      );
    });
    expect(
      (screen.getByTestId(`safety-inbox-mark-read-${ITEM_A_1.id}`) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId('safety-inbox-summary-counts').textContent).toContain(
      'Current filter — Server unread: 0 · Server total: 2 · Loaded rows: 2',
    );
  });

  it('retains loaded authorized rows and retries the exact same offset=20 on transient next-page failure, but hides stale rows on base-refetch failure', async () => {
    const firstPageItems: SafetyEpisodeInboxItem[] = [
      ITEM_A_1,
      ...Array.from({ length: 19 }, (_, idx) => buildFillerInboxItem(idx + 1, SITE_A_ID)),
    ];
    const secondPageItems: SafetyEpisodeInboxItem[] = [ITEM_B_1];

    const listMock = vi
      .fn<SafetyEpisodeInboxClient['listSafetyEpisodeInbox']>()
      .mockResolvedValueOnce({
        items: firstPageItems,
        total: 21,
        unreadCount: 20,
      })
      .mockRejectedValueOnce(new ApiError('http', 'Temporary page 2 timeout', 503))
      .mockResolvedValueOnce({
        items: secondPageItems,
        total: 21,
        unreadCount: 20,
      })
      .mockResolvedValueOnce({
        items: firstPageItems,
        total: 21,
        unreadCount: 20,
      })
      .mockRejectedValueOnce(new ApiError('http', 'Base refetch page 2 failure', 502));

    const { queryClient } = renderWorkspace({
      client: {
        listSafetyEpisodeInbox: listMock,
        readSafetyEpisodeInbox: vi.fn(),
      },
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('safety-inbox-row')).toHaveLength(20);
    });

    // Trigger next page load -> fails with 503
    fireEvent.click(screen.getByTestId('safety-inbox-load-more'));

    await waitFor(() => {
      expect(screen.getByTestId('safety-inbox-next-page-error').textContent).toContain(
        'Temporary page 2 timeout',
      );
    });
    // Existing 20 authorized rows remain visible
    expect(screen.getAllByTestId('safety-inbox-row')).toHaveLength(20);
    expect(listMock).toHaveBeenNthCalledWith(
      2,
      'secret-jwt-token-inbox-alpha',
      { offset: 20, limit: 20, readStatus: 'ALL' } satisfies SafetyEpisodeInboxOptions,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // Retry load more -> requests the exact same offset=20 and appends ITEM_B_1
    fireEvent.click(screen.getByTestId('safety-inbox-retry-load-more'));

    await waitFor(() => {
      expect(screen.getAllByTestId('safety-inbox-row')).toHaveLength(21);
    });
    expect(listMock).toHaveBeenNthCalledWith(
      3,
      'secret-jwt-token-inbox-alpha',
      { offset: 20, limit: 20, readStatus: 'ALL' } satisfies SafetyEpisodeInboxOptions,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.queryByTestId('safety-inbox-next-page-error')).toBeNull();

    // Base refetch where page 2 fails must hide stale rows and show base error
    await act(async () => {
      await queryClient.refetchQueries();
    });

    await waitFor(() => {
      expect(screen.getByTestId('safety-inbox-error')).toBeTruthy();
    });
    expect(screen.queryAllByTestId('safety-inbox-row')).toHaveLength(0);
  });

  it('hides previous rows, aborts in-flight requests, blocks late read responses on Site/scope/token changes, and never leaks raw token into query keys or DOM', async () => {
    const staleReadDeferred = createDeferred<SafetyEpisodeReadResponse>();
    let capturedReadSignal: AbortSignal | undefined;

    const listMock = vi
      .fn<SafetyEpisodeInboxClient['listSafetyEpisodeInbox']>()
      .mockResolvedValueOnce({
        items: [ITEM_A_1, ITEM_B_1],
        total: 2,
        unreadCount: 1,
      })
      .mockResolvedValueOnce({
        items: [ITEM_B_1],
        total: 1,
        unreadCount: 0,
      });

    const readMock = vi
      .fn<SafetyEpisodeInboxClient['readSafetyEpisodeInbox']>()
      .mockImplementationOnce((_token, _id, _input, requestOptions) => {
        capturedReadSignal = requestOptions?.signal;
        return staleReadDeferred.promise;
      });

    const client: SafetyEpisodeInboxClient = {
      listSafetyEpisodeInbox: listMock,
      readSafetyEpisodeInbox: readMock,
    };

    const queryClient = createTestQueryClient();
    const { rerender, props } = renderWorkspace({ client }, queryClient);

    await waitFor(() => {
      expect(screen.getByTestId(`safety-inbox-open-${ITEM_A_1.id}`)).toBeTruthy();
    });

    // Verify raw token is never in query keys or DOM text
    const cachedKeysJson = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((entry) => entry.queryKey),
    );
    expect(cachedKeysJson).not.toContain(props.token);
    expect(document.body.textContent ?? '').not.toContain(props.token);

    // Start mark-read on ITEM_A_1 (remains pending)
    fireEvent.click(screen.getByTestId(`safety-inbox-mark-read-${ITEM_A_1.id}`));
    expect(readMock).toHaveBeenCalledTimes(1);
    expect(capturedReadSignal?.aborted).toBe(false);

    // Revoke SITE_A from authorized sites and rotate token/scopeKey
    rerender(
      <QueryClientProvider client={queryClient}>
        <SafetyEpisodeInboxWorkspace
          {...props}
          client={client}
          token="rotated-jwt-token-inbox-beta"
          scopeKey="user-1::org-1::safety-inbox-revoked-a"
          sites={[{ id: SITE_B_ID, name: 'South Depot' }]}
        />
      </QueryClientProvider>,
    );

    // In-flight mark-read from previous scope is aborted and SITE_A row is immediately gone
    expect(capturedReadSignal?.aborted).toBe(true);
    expect(screen.queryByTestId(`safety-inbox-open-${ITEM_A_1.id}`)).toBeNull();
    expect(screen.queryByTestId(`safety-inbox-site-group-${SITE_A_ID}`)).toBeNull();

    await waitFor(() => {
      expect(screen.getByTestId(`safety-inbox-open-${ITEM_B_1.id}`)).toBeTruthy();
    });

    // Late resolution of the stale read response from the old scope cannot leak or trigger refetch
    const listCallsBeforeLateResolve = listMock.mock.calls.length;
    await act(async () => {
      staleReadDeferred.resolve({
        id: ITEM_A_1.id,
        contentRevision: 2,
        seenRevision: 2,
        unread: false,
      });
    });

    expect(listMock).toHaveBeenCalledTimes(listCallsBeforeLateResolve);
    expect(screen.queryByTestId(`safety-inbox-open-${ITEM_A_1.id}`)).toBeNull();
    expect(screen.getByTestId(`safety-inbox-site-count-${SITE_B_ID}`).textContent).toContain(
      'Loaded rows: 1',
    );
  });
  it('never promotes an unrefetched summary to a newer revision learned only from read acknowledgement', async () => {
    const refreshed = createDeferred<SafetyEpisodeInboxPage>();
    const onOpen = vi.fn();
    const list = vi
      .fn<SafetyEpisodeInboxClient['listSafetyEpisodeInbox']>()
      .mockResolvedValueOnce({ items: [ITEM_A_1], total: 1, unreadCount: 1 })
      .mockReturnValueOnce(refreshed.promise);
    const read = vi.fn<SafetyEpisodeInboxClient['readSafetyEpisodeInbox']>().mockResolvedValue({
      id: ITEM_A_1.id,
      contentRevision: 3,
      seenRevision: 2,
      unread: true,
    });
    renderWorkspace({
      client: { listSafetyEpisodeInbox: list, readSafetyEpisodeInbox: read },
      onOpenEpisode: onOpen,
    });
    await waitFor(() =>
      expect(screen.getByTestId(`safety-inbox-open-${ITEM_A_1.id}`)).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId(`safety-inbox-mark-read-${ITEM_A_1.id}`));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByTestId(`safety-inbox-open-${ITEM_A_1.id}`));
    // A read reply has no updated findingCount/subject metadata; it cannot manufacture a revision3 snapshot.
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ episode: expect.objectContaining({ contentRevision: 2 }) }),
    );
    expect(
      (screen.getByTestId(`safety-inbox-mark-read-${ITEM_A_1.id}`) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => {
      refreshed.resolve({
        items: [
          {
            ...ITEM_A_1,
            episode: { ...ITEM_A_1.episode, contentRevision: 3, findingCount: 5 },
            seenRevision: 2,
            unread: true,
          },
        ],
        total: 1,
        unreadCount: 1,
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId(`safety-inbox-row-revision-${ITEM_A_1.id}`).textContent).toContain(
        '3',
      ),
    );
  });
  it('aborts pending read after hard list denial and ignores its late acknowledgement', async () => {
    const pending = createDeferred<SafetyEpisodeReadResponse>();
    const captured: { signal?: AbortSignal } = {};
    const list = vi
      .fn<SafetyEpisodeInboxClient['listSafetyEpisodeInbox']>()
      .mockResolvedValueOnce({ items: [ITEM_A_1], total: 1, unreadCount: 1 })
      .mockRejectedValueOnce(new ApiError('http', 'Scoped metadata denied', 403))
      .mockResolvedValue({ items: [ITEM_A_1], total: 1, unreadCount: 1 });
    const read = vi.fn<SafetyEpisodeInboxClient['readSafetyEpisodeInbox']>(
      (_token, _id, _input, options) => {
        captured.signal = options?.signal;
        return pending.promise;
      },
    );
    const { queryClient } = renderWorkspace({
      client: { listSafetyEpisodeInbox: list, readSafetyEpisodeInbox: read },
    });
    await waitFor(() =>
      expect(screen.getByTestId(`safety-inbox-mark-read-${ITEM_A_1.id}`)).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId(`safety-inbox-mark-read-${ITEM_A_1.id}`));
    await act(async () => {
      await queryClient.refetchQueries();
    });
    await waitFor(() => expect(screen.getByTestId('safety-inbox-forbidden')).toBeTruthy());
    expect(captured.signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve({ id: ITEM_A_1.id, contentRevision: 2, seenRevision: 2, unread: false });
    });
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId(`safety-inbox-open-${ITEM_A_1.id}`)).toBeNull();
  });
  it('keeps newer authoritative seen revision instead of restoring stale acknowledgement unread state', async () => {
    const current = {
      ...ITEM_A_1,
      episode: { ...ITEM_A_1.episode, contentRevision: 3 },
      seenRevision: 3,
      unread: false,
    };
    const list = vi
      .fn<SafetyEpisodeInboxClient['listSafetyEpisodeInbox']>()
      .mockResolvedValueOnce({ items: [ITEM_A_1], total: 1, unreadCount: 1 })
      .mockResolvedValue({ items: [current], total: 1, unreadCount: 0 });
    const read = vi
      .fn<SafetyEpisodeInboxClient['readSafetyEpisodeInbox']>()
      .mockResolvedValue({ id: ITEM_A_1.id, contentRevision: 3, seenRevision: 2, unread: true });
    renderWorkspace({ client: { listSafetyEpisodeInbox: list, readSafetyEpisodeInbox: read } });
    await waitFor(() =>
      expect(screen.getByTestId(`safety-inbox-mark-read-${ITEM_A_1.id}`)).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId(`safety-inbox-mark-read-${ITEM_A_1.id}`));
    await waitFor(() =>
      expect(screen.getByTestId(`safety-inbox-row-revision-${ITEM_A_1.id}`).textContent).toContain(
        '3',
      ),
    );
    expect(screen.getByTestId(`safety-inbox-row-status-${ITEM_A_1.id}`).textContent).toBe('Read');
    expect(
      (screen.getByTestId(`safety-inbox-mark-read-${ITEM_A_1.id}`) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it('does not claim a settled empty inbox when only other-site rows loaded and another page remains', async () => {
    const hiddenRows = Array.from({ length: 20 }, (_, index) =>
      buildFillerInboxItem(80 + index, SITE_UNASSIGNED_ID),
    );
    const list = vi
      .fn<SafetyEpisodeInboxClient['listSafetyEpisodeInbox']>()
      .mockResolvedValueOnce({ items: hiddenRows, total: 21, unreadCount: 21 })
      .mockResolvedValueOnce({ items: [ITEM_A_1], total: 21, unreadCount: 21 });
    renderWorkspace({
      client: {
        listSafetyEpisodeInbox: list,
        readSafetyEpisodeInbox: vi.fn<SafetyEpisodeInboxClient['readSafetyEpisodeInbox']>(),
      },
    });
    await waitFor(() => expect(screen.getByTestId('safety-inbox-load-more')).toBeTruthy());
    expect(screen.queryByTestId('safety-inbox-empty')).toBeNull();
    expect(screen.getByTestId('safety-inbox-partial-empty')).toBeTruthy();
    fireEvent.click(screen.getByTestId('safety-inbox-load-more'));
    await waitFor(() =>
      expect(screen.getByTestId(`safety-inbox-open-${ITEM_A_1.id}`)).toBeTruthy(),
    );
    expect(list.mock.calls[1]?.[1]?.offset).toBe(20);
  });
});
