// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type {
  SafetyEpisodeInboxItem,
  SafetyEpisodeSummary,
} from '@smartsite/contracts/safety-episodes';
import i18n from '../../../i18n';
import { SafetyEpisodeInboxList } from './SafetyEpisodeInboxList';

function makeEpisodeSummary(overrides: Partial<SafetyEpisodeSummary> = {}): SafetyEpisodeSummary {
  return {
    id: '40000000-0000-4000-8000-000000000001',
    siteId: '10000000-0000-4000-8000-000000000001',
    cameraId: '20000000-0000-4000-8000-000000000001',
    subject: {
      kind: 'EVENT_LOCAL',
      eventId: '30000000-0000-4000-8000-000000000010',
      personObservationIndex: 2,
    },
    configurationBundleId: '60000000-0000-4000-8000-000000000001',
    firstObservedAt: '2026-10-26T01:10:00.000Z',
    lastObservedAt: '2026-10-26T01:12:30.000Z',
    contentRevision: 3,
    collectionState: 'COLLECTING',
    findingCount: 2,
    ...overrides,
  };
}

function makeInboxItem(overrides: Partial<SafetyEpisodeInboxItem> = {}): SafetyEpisodeInboxItem {
  return {
    id: '81000000-0000-4000-8000-000000000001',
    episode: makeEpisodeSummary(),
    seenRevision: 1,
    unread: true,
    firstDeliveredAt: '2026-10-26T01:10:05.000Z',
    updatedAt: '2026-10-26T01:12:35.000Z',
    ...overrides,
  };
}

describe('SafetyEpisodeInboxList (F02 site-grouped episode inbox list)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('groups deduplicated entries by site with compact counts, resolves context labels or fallbacks, selects episode rows, and hides raw UUIDs/indices in TechnicalDetails', () => {
    const onSelectEpisode = vi.fn();
    const siteA = '10000000-0000-4000-8000-000000000001';
    const siteB = '10000000-0000-4000-8000-000000000002';
    const camA1 = '20000000-0000-4000-8000-000000000001';
    const camB1 = '20000000-0000-4000-8000-000000000002';

    const itemA1 = makeInboxItem({
      id: '81000000-0000-4000-8000-000000000001',
      seenRevision: 1,
      unread: true,
      episode: makeEpisodeSummary({
        id: '40000000-0000-4000-8000-000000000001',
        siteId: siteA,
        cameraId: camA1,
        contentRevision: 3,
        collectionState: 'COLLECTING',
        findingCount: 2,
      }),
    });

    const itemA1NewerFromNextPage = makeInboxItem({
      id: '81000000-0000-4000-8000-000000000001',
      seenRevision: 1,
      unread: true,
      episode: makeEpisodeSummary({
        id: '40000000-0000-4000-8000-000000000001',
        siteId: siteA,
        cameraId: camA1,
        contentRevision: 4,
        collectionState: 'SEALED',
        findingCount: 3,
      }),
    });

    const itemB1 = makeInboxItem({
      id: '81000000-0000-4000-8000-000000000002',
      seenRevision: 2,
      unread: false,
      episode: makeEpisodeSummary({
        id: '40000000-0000-4000-8000-000000000002',
        siteId: siteB,
        cameraId: camB1,
        contentRevision: 2,
        collectionState: 'SEALED',
        findingCount: 1,
      }),
    });

    const { container } = render(
      <SafetyEpisodeInboxList
        items={[itemA1, itemA1NewerFromNextPage, itemB1]}
        total={2}
        unreadCount={1}
        selectedEpisodeId={itemB1.episode.id}
        contextLabelsBySiteId={{
          [siteA]: {
            site: 'North Tower Site',
            cameras: { [camA1]: 'Tower Crane Hoist Camera 01' },
          },
        }}
        onSelectEpisode={onSelectEpisode}
      />,
    );

    expect(container.textContent).not.toMatch(/\{\{|\}\}/);
    expect(screen.getByTestId('safety-episode-inbox-unread-summary').textContent).toBe('Unread: 1');
    expect(screen.getByTestId('safety-episode-inbox-total-summary').textContent).toBe('Total: 2');

    const groupA = screen.getByTestId(`episode-inbox-site-group-${siteA}`);
    expect(screen.getByTestId(`episode-inbox-site-heading-${siteA}`).textContent).toBe(
      'North Tower Site',
    );
    expect(screen.getByTestId(`episode-inbox-site-summary-${siteA}`).textContent).toBe(
      '1 episodes · 1 unread',
    );
    expect(screen.getByTestId(`episode-inbox-site-heading-${siteB}`).textContent).toBe(
      'Linked site',
    );
    expect(screen.getByTestId(`episode-inbox-site-summary-${siteB}`).textContent).toBe(
      '1 episodes · 0 unread',
    );

    expect(within(groupA).getAllByTestId(/episode-inbox-item-81000000/)).toHaveLength(1);
    expect(screen.getByTestId(`episode-inbox-camera-${itemA1.id}`).textContent).toBe(
      'Tower Crane Hoist Camera 01',
    );
    expect(screen.getByTestId(`episode-inbox-camera-${itemB1.id}`).textContent).toBe(
      'Linked camera',
    );
    expect(screen.getByTestId(`episode-inbox-findings-${itemA1.id}`).textContent).toBe('3');

    const selectBtnA = screen.getByTestId(`episode-inbox-select-${itemA1.id}`);
    const selectBtnB = screen.getByTestId(`episode-inbox-select-${itemB1.id}`);
    expect(selectBtnA.getAttribute('aria-current')).toBeNull();
    expect(selectBtnA.getAttribute('aria-pressed')).toBe('false');
    expect(selectBtnB.getAttribute('aria-current')).toBe('true');
    expect(selectBtnB.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(selectBtnA);
    expect(onSelectEpisode).toHaveBeenCalledWith(itemA1NewerFromNextPage.episode, itemA1.id);

    expect(screen.queryByRole('button', { name: /mark all/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /confirm all/i })).toBeNull();

    const rowA = screen.getByTestId(`episode-inbox-item-${itemA1.id}`);
    const detailsEl = rowA.querySelector('details');
    expect(detailsEl?.open).toBe(false);
    expect(detailsEl?.textContent).toContain(itemA1.id);
    expect(detailsEl?.textContent).toContain(siteA);
    expect(detailsEl?.textContent).toContain(camA1);
    expect(detailsEl?.textContent).toContain('observations[2]');
  });

  it('preserves highest contentRevision when a later page contains a stale duplicate, sends exact revision 5 on mark-read, and disables pending read', () => {
    const onMarkRead = vi.fn();
    const rev5Item = makeInboxItem({
      id: '81000000-0000-4000-8000-000000000010',
      seenRevision: 2,
      unread: true,
      episode: makeEpisodeSummary({
        id: '40000000-0000-4000-8000-000000000010',
        contentRevision: 5,
        findingCount: 4,
      }),
    });
    const staleRev3Duplicate = makeInboxItem({
      id: '81000000-0000-4000-8000-000000000010',
      seenRevision: 3,
      unread: false,
      episode: makeEpisodeSummary({
        id: '40000000-0000-4000-8000-000000000010',
        contentRevision: 3,
        findingCount: 1,
      }),
    });
    const readItem = makeInboxItem({
      id: '81000000-0000-4000-8000-000000000012',
      seenRevision: 6,
      unread: false,
      episode: makeEpisodeSummary({
        id: '40000000-0000-4000-8000-000000000012',
        contentRevision: 6,
      }),
    });

    const { rerender, container } = render(
      <SafetyEpisodeInboxList
        items={[rev5Item, staleRev3Duplicate, readItem]}
        total={2}
        unreadCount={1}
        selectedEpisodeId={null}
        onSelectEpisode={vi.fn()}
        onMarkRead={onMarkRead}
      />,
    );

    expect(container.textContent).not.toMatch(/\{\{|\}\}/);
    expect(screen.getByTestId(`episode-inbox-findings-${rev5Item.id}`).textContent).toBe('4');
    expect(screen.getByTestId(`episode-inbox-read-badge-${rev5Item.id}`).textContent).toContain(
      'Unread',
    );

    const markBtn = screen.getByTestId(
      `episode-inbox-mark-read-${rev5Item.id}`,
    ) as HTMLButtonElement;
    expect(markBtn.disabled).toBe(false);
    expect(markBtn.textContent).toBe('Mark read (rev #5)');
    fireEvent.click(markBtn);
    expect(onMarkRead).toHaveBeenCalledWith(rev5Item.id, { seenRevision: 5 });

    expect(screen.queryByTestId(`episode-inbox-mark-read-${readItem.id}`)).toBeNull();
    expect(screen.getByTestId(`episode-inbox-read-badge-${readItem.id}`).textContent).toContain(
      'Read',
    );

    rerender(
      <SafetyEpisodeInboxList
        items={[rev5Item, staleRev3Duplicate, readItem]}
        total={2}
        unreadCount={1}
        selectedEpisodeId={null}
        onSelectEpisode={vi.fn()}
        onMarkRead={onMarkRead}
        isPendingReadId={rev5Item.id}
      />,
    );

    const pendingBtn = screen.getByTestId(
      `episode-inbox-mark-read-${rev5Item.id}`,
    ) as HTMLButtonElement;
    expect(pendingBtn.disabled).toBe(true);
    expect(pendingBtn.getAttribute('aria-busy')).toBe('true');
    expect(pendingBtn.textContent).toBe('Marking read…');
  });

  it('shows latest server total truthfully even when total shrinks below loaded count, and handles loading/empty/error/load-more states', () => {
    const onRetry = vi.fn();
    const onLoadMore = vi.fn();
    const item1 = makeInboxItem({
      id: '81000000-0000-4000-8000-000000000021',
      episode: makeEpisodeSummary({ id: '40000000-0000-4000-8000-000000000021' }),
    });
    const item2 = makeInboxItem({
      id: '81000000-0000-4000-8000-000000000022',
      episode: makeEpisodeSummary({ id: '40000000-0000-4000-8000-000000000022' }),
    });

    const { rerender } = render(
      <SafetyEpisodeInboxList
        items={[]}
        total={0}
        unreadCount={0}
        selectedEpisodeId={null}
        isLoading={true}
        onSelectEpisode={vi.fn()}
      />,
    );
    expect(screen.getByTestId('safety-episode-inbox-loading').textContent).toBe(
      'Loading safety episode inbox…',
    );

    rerender(
      <SafetyEpisodeInboxList
        items={[]}
        total={0}
        unreadCount={0}
        selectedEpisodeId={null}
        isLoading={false}
        onSelectEpisode={vi.fn()}
      />,
    );
    expect(screen.getByTestId('safety-episode-inbox-empty').textContent).toBe(
      'No safety episodes in your inbox.',
    );

    rerender(
      <SafetyEpisodeInboxList
        items={[item1, item2]}
        total={1}
        unreadCount={1}
        selectedEpisodeId={item1.episode.id}
        isLoading={true}
        error={new Error('Temporary gateway failure')}
        onRetry={onRetry}
        hasMore={true}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
        onSelectEpisode={vi.fn()}
      />,
    );

    expect(screen.getByTestId('safety-episode-inbox-total-summary').textContent).toBe('Total: 1');
    expect(screen.getByTestId('safety-episode-inbox-partial-status').textContent).toBe(
      'Showing 2 of 1 episodes',
    );
    expect(screen.getByTestId('safety-episode-inbox-refreshing').textContent).toBe(
      'Refreshing safety episode inbox…',
    );

    const errorRegion = screen.getByTestId('safety-episode-inbox-error');
    expect(within(errorRegion).getByRole('alert')).toBeTruthy();
    fireEvent.click(within(errorRegion).getByRole('button'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    const loadMoreBtn = screen.getByTestId('safety-episode-inbox-load-more') as HTMLButtonElement;
    expect(loadMoreBtn.disabled).toBe(false);
    fireEvent.click(loadMoreBtn);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('renders Vietnamese localization, wraps long site and camera names without truncate, and discloses null configurationBundleId in TechnicalDetails', async () => {
    await i18n.changeLanguage('vi');
    const siteId = '10000000-0000-4000-8000-000000000009';
    const cameraId = '20000000-0000-4000-8000-000000000009';
    const item = makeInboxItem({
      episode: makeEpisodeSummary({
        siteId,
        cameraId,
        configurationBundleId: null,
        collectionState: 'SEALED',
      }),
    });

    const { container } = render(
      <SafetyEpisodeInboxList
        items={[item]}
        total={1}
        unreadCount={1}
        selectedEpisodeId={null}
        contextLabelsBySiteId={{
          [siteId]: {
            site: 'Công trường Tổ hợp Cao tầng Khu Đô thị Phía Đông Phân khu A',
            cameras: {
              [cameraId]: 'Camera Giám sát Cổng Chính Khu Vực Thi Công Kết Cấu Thép Số 01',
            },
          },
        }}
        onSelectEpisode={vi.fn()}
        onMarkRead={vi.fn()}
      />,
    );

    expect(container.textContent).not.toMatch(/\{\{|\}\}/);
    expect(screen.getByTestId('safety-episode-inbox-heading').textContent).toBe(
      'Hộp thư hồ sơ quan sát an toàn',
    );
    const siteHeading = screen.getByTestId(`episode-inbox-site-heading-${siteId}`);
    const cameraDd = screen.getByTestId(`episode-inbox-camera-${item.id}`);
    expect(siteHeading.textContent).toBe(
      'Công trường Tổ hợp Cao tầng Khu Đô thị Phía Đông Phân khu A',
    );
    expect(cameraDd.textContent).toBe(
      'Camera Giám sát Cổng Chính Khu Vực Thi Công Kết Cấu Thép Số 01',
    );
    expect(siteHeading.className).toContain('break-words');
    expect(siteHeading.className).not.toContain('truncate');
    expect(cameraDd.className).toContain('break-words');
    expect(cameraDd.className).not.toContain('truncate');

    const detailsEl = screen.getByTestId(`episode-inbox-item-${item.id}`).querySelector('details');
    expect(detailsEl?.textContent).toContain(
      'Gói cấu hình: Ngữ cảnh cũ chưa gắn gói cấu hình (null)',
    );
  });
});
