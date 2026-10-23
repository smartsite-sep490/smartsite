// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import {
  SmartSiteManagementClient,
  type UserNotificationResponse,
  type UserNotificationListResponse,
} from '@smartsite/api-client';
import { AuthContext } from '../auth/auth-session';
import { NotificationBell } from './NotificationBell';
import i18n from '../../i18n';

let queryClient: QueryClient;
afterEach(() => {
  cleanup();
  queryClient?.clear();
  vi.restoreAllMocks();
});
it('filters via Backend and scopes bulk actions to the selected Site', async () => {
  await i18n.changeLanguage('en');
  const sites = [
    { id: 'site-a', name: 'Site Alpha' },
    { id: 'site-b', name: 'Site Beta' },
  ];
  const item = (siteId: string): UserNotificationResponse => ({
    id: siteId,
    event: 'PPE_ALERT_CREATED',
    siteId,
    siteName: siteId,
    title: `Notice ${siteId}`,
    message: 'Synthetic',
    createdAt: '2026-10-23T00:00:00Z',
    readAt: null,
    target: { siteId, alertId: 'alert', tab: 'alerts' },
  });
  let finish: ((value: UserNotificationListResponse) => void) | undefined;
  const list = vi
    .spyOn(SmartSiteManagementClient.prototype, 'listNotifications')
    .mockImplementation(async (_token, options) => {
      if (options?.siteId === 'site-b')
        return await new Promise<UserNotificationListResponse>((resolve) => {
          finish = resolve;
        });
      return { items: [item('site-a')], total: 2, unreadCount: 1, sites };
    });
  const readAll = vi
    .spyOn(SmartSiteManagementClient.prototype, 'readAllNotifications')
    .mockResolvedValue({ updated: 1 });
  const deleteRead = vi
    .spyOn(SmartSiteManagementClient.prototype, 'deleteReadNotifications')
    .mockResolvedValue({ deleted: 1 });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{
          accessToken: 'synthetic',
          sessionScope: 'scope-a',
          setAccessToken: vi.fn(),
          isSessionExpired: false,
          triggerSessionExpired: vi.fn(),
          dismissSessionExpired: vi.fn(),
        }}
      >
        <MemoryRouter>
          <NotificationBell apiUrl="https://api.example.test" userId="officer" />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /Notifications.*1 unread/i }));
  const filter = await screen.findByRole('combobox', { name: 'Filter notifications by site' });
  fireEvent.change(filter, { target: { value: 'site-b' } });
  await waitFor(() =>
    expect(list).toHaveBeenCalledWith(
      'synthetic',
      expect.objectContaining({ siteId: 'site-b', offset: 0 }),
      expect.anything(),
    ),
  );
  expect(screen.queryByText('site-a')).toBeNull();
  expect(screen.getByRole('button', { name: /Mark all as read/i }).hasAttribute('disabled')).toBe(
    true,
  );
  finish!({ items: [item('site-b')], total: 2, unreadCount: 1, allSitesUnreadCount: 4, sites });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Mark all as read/i }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
  expect(screen.getByRole('button', { name: /Notifications.*4 unread/i })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Mark all as read/i }));
  await waitFor(() => expect(readAll).toHaveBeenCalledWith('synthetic', 'site-b'));
  fireEvent.click(screen.getByRole('button', { name: /Delete read/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  await waitFor(() => expect(deleteRead).toHaveBeenCalledWith('synthetic', 'site-b'));
});

it('retains an unavailable Site selection instead of expanding bulk actions to other Sites', async () => {
  await i18n.changeLanguage('en');
  const sites = [
    { id: 'site-a', name: 'Site Alpha' },
    { id: 'site-b', name: 'Site Beta' },
  ];
  const list = vi
    .spyOn(SmartSiteManagementClient.prototype, 'listNotifications')
    .mockImplementation(async (_token, options) => ({
      items: [],
      total: 0,
      unreadCount: 0,
      allSitesUnreadCount: 4,
      sites: options?.siteId ? [sites[0]!] : sites,
    }));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (scope: string) => (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{
          accessToken: `synthetic-${scope}`,
          sessionScope: scope,
          setAccessToken: vi.fn(),
          isSessionExpired: false,
          triggerSessionExpired: vi.fn(),
          dismissSessionExpired: vi.fn(),
        }}
      >
        <MemoryRouter>
          <NotificationBell apiUrl="https://api.example.test" userId="officer" />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
  const rendered = render(view('old'));
  fireEvent.click(await screen.findByRole('button', { name: /Notifications.*4 unread/i }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter notifications by site' }), {
    target: { value: 'site-b' },
  });
  await screen.findByRole('option', { name: 'Selected site has no available notifications' });
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('site-b');
  expect(screen.getByRole('button', { name: /Mark all as read/i }).hasAttribute('disabled')).toBe(
    true,
  );
  rendered.rerender(view('new'));
  await waitFor(() =>
    expect(list).toHaveBeenCalledWith(
      'synthetic-new',
      { readStatus: 'ALL', offset: 0, limit: 20 },
      expect.anything(),
    ),
  );
  await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(''));
  expect(
    queryClient
      .getQueryCache()
      .findAll({ queryKey: ['notifications', 'https://api.example.test', 'officer', 'old'] }),
  ).toHaveLength(0);
});
