// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import * as api from '@smartsite/api-client';
import { AuthContext } from './features/auth/auth-session';
import { App } from './app';

vi.mock('./components/access/AccessControlView', () => ({
  AccessControlView: function AccessPreview() {
    const location = useLocation();
    // The real workspace initializes selected day and Site when mounted.
    const [selected] = useState(() => new URLSearchParams(location.search).get('dayId'));
    return <p>Selected attendance: {selected ?? 'none'}</p>;
  },
}));
vi.mock('./features/notifications/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('./components/landing/LandingPage', () => ({ LandingPage: () => null }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

it('opens the exact notification day when already viewing attendance in the same Site', async () => {
  const user = {
    id: 'rep',
    username: 'rep',
    displayName: 'Representative',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'CONTRACTOR_REPRESENTATIVE' as const, siteId: 'site' }],
  };
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  cache.setQueryData(['auth', 'session'], { accessToken: 'test-token', user });
  vi.spyOn(api, 'getBackendHealth').mockResolvedValue({
    status: 'ok',
    service: 'smartsite-backend',
  });
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'me').mockResolvedValue(user);
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [{ id: 'site', code: 'A', name: 'Synthetic Site', createdAt: '2026-11-25T00:00:00Z' }],
    total: 1,
  });
  function Notice() {
    const navigate = useNavigate();
    return (
      <button onClick={() => navigate('/access?siteId=site&tab=attendance&dayId=previous-day')}>
        Open absence notification
      </button>
    );
  }
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={['/access?siteId=site&tab=attendance&dayId=current-day']}>
        <AuthContext.Provider
          value={{
            accessToken: 'test-token',
            setAccessToken: vi.fn(),
            isSessionExpired: false,
            triggerSessionExpired: vi.fn(),
            dismissSessionExpired: vi.fn(),
          }}
        >
          <Notice />
          <App />
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Selected attendance: current-day')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open absence notification' }));
  expect(await screen.findByText('Selected attendance: previous-day')).toBeTruthy();
  cache.clear();
});
