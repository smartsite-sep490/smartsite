// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import {
  SmartSiteManagementClient,
  ApiError,
  type UserNotificationResponse,
} from '@smartsite/api-client';
import { AuthContext } from '../auth/auth-session';
import { NotificationBell } from './NotificationBell';

const notification: UserNotificationResponse = {
  id: 'notification-1',
  event: 'SWAP_REQUESTED',
  siteId: 'site-2',
  siteName: 'Synthetic site',
  title: 'Coworker shift swap request',
  message: 'A coworker wants to swap shifts.',
  workDate: '2030-01-01',
  fromShiftName: 'Morning',
  toShiftName: 'Evening',
  createdAt: '2030-01-01T00:00:00Z',
  readAt: null,
  target: {
    siteId: 'site-2',
    requestType: 'SWAP',
    requestId: 'older-request',
    tab: 'schedule',
    view: 'coworker',
  },
};
const page = { items: [notification], total: 1, unreadCount: 1 };
let queryClient: QueryClient;
function Location() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}
function mount(userId = 'worker-1') {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{
          accessToken: 'synthetic-token',
          setAccessToken: vi.fn(),
          isSessionExpired: false,
          triggerSessionExpired: vi.fn(),
          dismissSessionExpired: vi.fn(),
        }}
      >
        <MemoryRouter>
          <NotificationBell apiUrl="https://api.example.test" userId={userId} />
          <Location />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
  vi.spyOn(SmartSiteManagementClient.prototype, 'listNotifications').mockResolvedValue(page);
  vi.spyOn(SmartSiteManagementClient.prototype, 'readNotification').mockResolvedValue({
    id: notification.id,
    readAt: '2030-01-01T01:00:00Z',
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'readAllNotifications').mockResolvedValue({
    updated: 1,
  });
  if (!globalThis.ResizeObserver)
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
});
afterEach(() => {
  cleanup();
  queryClient?.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
});

describe('durable Web notification bell', () => {
  it('shows unread count, opening does not read, and clicking marks read before navigating to the exact site/request', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    expect(await screen.findByText(notification.title)).toBeTruthy();
    expect(SmartSiteManagementClient.prototype.readNotification).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(notification.title));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toContain('requestId=older-request'),
    );
    expect(screen.getByTestId('location').textContent).toContain('siteId=site-2');
    expect(SmartSiteManagementClient.prototype.readNotification).toHaveBeenCalledWith(
      'synthetic-token',
      notification.id,
    );
  });

  it('filters unread and marks all read through the server', async () => {
    const list = vi.mocked(SmartSiteManagementClient.prototype.listNotifications);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unread' }));
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(
        'synthetic-token',
        { readStatus: 'UNREAD', offset: 0, limit: 20 },
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Mark all as read' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    list.mockResolvedValue({ items: [], total: 0, unreadCount: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    expect(await screen.findByText('You have no unread notifications.')).toBeTruthy();
    expect(SmartSiteManagementClient.prototype.readAllNotifications).toHaveBeenCalledWith(
      'synthetic-token',
    );
  });

  it('appends older notifications when loading more and closes with Escape', async () => {
    vi.mocked(SmartSiteManagementClient.prototype.listNotifications).mockImplementation(
      async (_token, options) =>
        options?.offset
          ? {
              items: [{ ...notification, id: 'older-notice', title: 'An older notification' }],
              total: 21,
              unreadCount: 2,
            }
          : { ...page, total: 21, unreadCount: 2 },
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('An older notification')).toBeTruthy();
    expect(screen.getByText(notification.title)).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows unavailable and retry instead of a fake zero unread count', async () => {
    const list = vi
      .mocked(SmartSiteManagementClient.prototype.listNotifications)
      .mockRejectedValue(new ApiError('network', 'Unavailable'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Notifications are currently unavailable.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Notifications, 0 unread' })).toBeNull();
    list.mockResolvedValue(page);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(notification.title)).toBeTruthy();
  });

  it('keeps the panel open with an error when marking read fails', async () => {
    vi.mocked(SmartSiteManagementClient.prototype.readNotification).mockRejectedValue(
      new ApiError('network', 'Unavailable'),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    fireEvent.click(await screen.findByText(notification.title));
    expect(await screen.findByText('Could not update this notification. Try again.')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toBe('/');
  });

  it('polls every 15 seconds only while visible and refetches on focus/reconnect', async () => {
    vi.useFakeTimers();
    const list = vi.mocked(SmartSiteManagementClient.prototype.listNotifications);
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(list).toHaveBeenCalledTimes(2);
    focusManager.setFocused(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => {
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(list).toHaveBeenCalledTimes(3);
    await act(async () => {
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(list).toHaveBeenCalledTimes(4);
  });

  it('removes the account notification cache when unmounted', async () => {
    const mounted = mount();
    await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    expect(
      queryClient.getQueriesData({
        queryKey: ['notifications', 'https://api.example.test', 'worker-1'],
      }).length,
    ).toBe(1);
    mounted.unmount();
    expect(queryClient.getQueriesData({ queryKey: ['notifications'] }).length).toBe(0);
  });
});
