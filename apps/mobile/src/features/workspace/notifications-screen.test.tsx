import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { useWorkspace } from './workspace-context';
import { NotificationsScreen } from './qr-notifications';

vi.mock('./workspace-context', () => ({ useWorkspace: () => workspace }));
let workspace: ReturnType<typeof useWorkspace>;
let root: ReactTestRenderer;
let cache: QueryClient;

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache?.clear();
  vi.restoreAllMocks();
});

describe('NotificationsScreen', () => {
  it('renders modern notification items with unread indicators and compact actions', async () => {
    const client = new SmartSiteManagementClient('https://api.example.test');
    vi.spyOn(client, 'listNotifications').mockResolvedValue({
      items: [
        {
          id: 'n-1',
          siteId: 'site-1',
          siteName: 'Công trường Landmark',
          event: 'SCHEDULE_CHANGED',
          title: 'Lịch làm đã thay đổi',
          message: 'Ca làm việc của bạn đã được cập nhật.',
          readAt: null,
          createdAt: new Date().toISOString(),
          target: { siteId: 'site-1', workDate: '2026-11-20', tab: 'schedule' as const },
        },
        {
          id: 'n-2',
          siteId: 'site-1',
          siteName: 'Công trường Landmark',
          event: 'TIME_APPROVED',
          title: 'Đã duyệt yêu cầu điều chỉnh giờ',
          message: 'Yêu cầu của bạn đã được quản lý phê duyệt.',
          readAt: '2026-10-27T08:00:00Z',
          createdAt: '2026-10-27T07:30:00Z',
          target: { siteId: 'site-1', dayId: 'day-1', tab: 'attendance' as const },
        },
      ],
      total: 2,
      unreadCount: 1,
    });

    const markReadSpy = vi
      .spyOn(client, 'readNotification')
      .mockResolvedValue({ id: 'n-1', readAt: new Date().toISOString() });
    const deleteSpy = vi.spyOn(client, 'deleteNotification').mockResolvedValue({ id: 'n-1' });

    workspace = {
      client,
      token: 'token',
      workerId: 'worker-1',
      queryKey: ['mobile', 'notifications-test'],
      user: {
        id: 'u-1',
        username: 'test-worker',
        displayName: 'Nguyễn Văn Worker',
        isActive: true,
        mustChangePassword: false,
        roleAssignments: [{ role: 'WORKER', siteId: 'site-1' }],
      },
      scope: {
        role: 'worker',
        siteId: 'site-1',
        siteName: 'Công trường Landmark',
        contractorId: '',
        contractorName: '',
      },
    };

    cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    await act(async () => {
      root = create(
        <QueryClientProvider client={cache}>
          <NotificationsScreen navigate={() => {}} onBack={() => {}} />
        </QueryClientProvider>,
      );
    });

    // Wait for query to resolve
    for (
      let attempt = 0;
      !JSON.stringify(root.toJSON()).includes('Công trường Landmark') && attempt < 50;
      attempt++
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }

    const json = JSON.stringify(root.toJSON());
    expect(json).toContain('Công trường Landmark');
    expect(json).toContain('Lịch làm đã thay đổi');

    // Find and press the mark read button for unread notification n-1
    const buttons = root.root.findAll((n) => String(n.type) === 'Pressable');
    const markReadBtn = buttons.find(
      (b) =>
        b.props.accessibilityLabel === 'Đã đọc' ||
        b.props.accessibilityLabel === 'Read' ||
        b.props.accessibilityLabel === 'Đánh dấu đã đọc' ||
        b.props.accessibilityLabel === 'Mark as read',
    );
    expect(markReadBtn).toBeDefined();

    await act(async () => {
      markReadBtn!.props.onPress();
    });

    expect(markReadSpy).toHaveBeenCalledWith('token', 'n-1');

    const deleteBtn = buttons.find(
      (b) =>
        b.props.accessibilityLabel === 'Xóa' ||
        b.props.accessibilityLabel === 'Delete' ||
        b.props.accessibilityLabel === 'Xóa thông báo' ||
        b.props.accessibilityLabel === 'Delete notification',
    );
    expect(deleteBtn).toBeDefined();

    await act(async () => {
      deleteBtn!.props.onPress();
    });

    expect(deleteSpy).toHaveBeenCalledWith('token', 'n-1');
  });

  it('supports swiping right on a notification card to delete it', async () => {
    const client = new SmartSiteManagementClient('https://api.example.test');
    vi.spyOn(client, 'listNotifications').mockResolvedValue({
      items: [
        {
          id: 'n-swipe-1',
          siteId: 'site-1',
          siteName: 'Công trường Landmark',
          event: 'SCHEDULE_CHANGED',
          title: 'Lịch làm đã thay đổi',
          message: 'Ca làm việc của bạn đã được cập nhật.',
          readAt: null,
          createdAt: new Date().toISOString(),
          target: { siteId: 'site-1', workDate: '2026-11-20', tab: 'schedule' as const },
        },
      ],
      total: 1,
      unreadCount: 1,
    });

    const deleteSpy = vi
      .spyOn(client, 'deleteNotification')
      .mockResolvedValue({ id: 'n-swipe-1' });

    workspace = {
      client,
      token: 'token',
      workerId: 'worker-1',
      queryKey: ['mobile', 'notifications-swipe-test'],
      user: {
        id: 'u-1',
        username: 'test-worker',
        displayName: 'Nguyễn Văn Worker',
        isActive: true,
        mustChangePassword: false,
        roleAssignments: [{ role: 'WORKER', siteId: 'site-1' }],
      },
      scope: {
        role: 'worker',
        siteId: 'site-1',
        siteName: 'Công trường Landmark',
        contractorId: '',
        contractorName: '',
      },
    };

    cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    await act(async () => {
      root = create(
        <QueryClientProvider client={cache}>
          <NotificationsScreen navigate={() => {}} onBack={() => {}} />
        </QueryClientProvider>,
      );
    });

    for (
      let attempt = 0;
      !JSON.stringify(root.toJSON()).includes('Công trường Landmark') && attempt < 50;
      attempt++
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }

    const animatedViews = root.root.findAll(
      (n) => n.props.onMoveShouldSetPanResponder && n.props.onPanResponderRelease,
    );
    expect(animatedViews.length).toBeGreaterThan(0);

    const gestureHandler = animatedViews[0]!;

    // Verify it claims rightward drag (dx > 10 and |dx| > |dy|)
    const shouldClaim = gestureHandler.props.onMoveShouldSetPanResponder(
      {},
      { dx: 45, dy: 5 },
    );
    expect(shouldClaim).toBe(true);

    // Verify it ignores vertical scrolling (|dy| > |dx|)
    const shouldIgnoreVertical = gestureHandler.props.onMoveShouldSetPanResponder(
      {},
      { dx: 5, dy: 45 },
    );
    expect(shouldIgnoreVertical).toBe(false);

    // Verify it ignores leftward dragging (dx <= 0)
    const shouldIgnoreLeft = gestureHandler.props.onMoveShouldSetPanResponder(
      {},
      { dx: -20, dy: 0 },
    );
    expect(shouldIgnoreLeft).toBe(false);

    // Trigger swipe release past threshold (> 90px)
    await act(async () => {
      gestureHandler.props.onPanResponderRelease({}, { dx: 110, dy: 0 });
    });

    expect(deleteSpy).toHaveBeenCalledWith('token', 'n-swipe-1');
  });
});
