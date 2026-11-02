// @vitest-environment jsdom
import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import type {
  SafetyEpisodeInboxPage,
  SafetyEpisodeReadCommand,
  SafetyEpisodeReadResponse,
} from '@smartsite/contracts/safety-episodes';
import { changeUiLanguage } from '../../i18n/runtime';
import {
  SafetyEpisodeInboxWorkspace,
  type SafetyEpisodeInboxClient,
} from './SafetyEpisodeInboxWorkspace';
import {
  AUTHORIZED_SITES,
  createDeferred,
  createTestQueryClient,
  ITEM_A_1,
  ITEM_B_1,
  renderWorkspace,
  SITE_A_ID,
} from './safety-episode-inbox.test-support';

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

  it('does not describe EVENT_LOCAL people as tracked across frames in either language', async () => {
    const client: SafetyEpisodeInboxClient = {
      listSafetyEpisodeInbox: vi
        .fn()
        .mockResolvedValue({ items: [ITEM_A_1, ITEM_B_1], total: 2, unreadCount: 1 }),
      readSafetyEpisodeInbox: vi.fn(),
    };
    renderWorkspace({ client });
    const local = await screen.findByTestId(`safety-inbox-row-subject-${ITEM_B_1.id}`);
    expect(local.textContent).toContain('1 person in this event');
    expect(local.textContent).not.toContain('tracked person');
    expect(screen.getByTestId(`safety-inbox-row-subject-${ITEM_A_1.id}`).textContent).toContain(
      '1 tracked person',
    );
    await act(async () => {
      await changeUiLanguage('vi');
    });
    expect(local.textContent).toContain('1 người trong sự kiện');
    expect(local.textContent).not.toContain('người theo dõi');
    expect(screen.getByTestId(`safety-inbox-row-subject-${ITEM_A_1.id}`).textContent).toContain(
      '1 người theo dõi',
    );
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
});
