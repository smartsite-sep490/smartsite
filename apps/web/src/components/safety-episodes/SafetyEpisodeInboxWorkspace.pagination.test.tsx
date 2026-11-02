// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import type {
  SafetyEpisodeInboxItem,
  SafetyEpisodeInboxOptions,
} from '@smartsite/contracts/safety-episodes';
import { changeUiLanguage } from '../../i18n/runtime';
import type { SafetyEpisodeInboxClient } from './SafetyEpisodeInboxWorkspace';
import {
  buildFillerInboxItem,
  ITEM_A_1,
  ITEM_B_1,
  ITEM_UNASSIGNED,
  renderWorkspace,
  SCOPE_SHA256,
  SEGMENT_1_ID,
  SITE_A_ID,
  SITE_B_ID,
  SITE_UNASSIGNED_ID,
} from './safety-episode-inbox.test-support';

describe('SafetyEpisodeInboxWorkspace — pagination and multi-Site grouping', () => {
  beforeEach(() => {
    window.localStorage.clear();
    changeUiLanguage('en');
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
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
