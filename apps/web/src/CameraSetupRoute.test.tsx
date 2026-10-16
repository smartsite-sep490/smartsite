// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { changeUiLanguage } from './i18n/runtime';
import { App } from './app';

const state = vi.hoisted(() => ({ token: 'token' as string | null, role: 'ADMIN' }));
vi.mock('@smartsite/api-client', async () => ({
  ...(await vi.importActual('@smartsite/api-client')),
  getBackendHealth: vi.fn().mockResolvedValue({ status: 'ok', service: 'smartsite-backend' }),
}));
vi.mock('./features/notifications/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('./components/landing/LandingPage', () => ({ LandingPage: () => <h1>Landing</h1> }));
vi.mock('./features/auth/LoginScreen', () => ({ LoginScreen: () => <h1>Sign in</h1> }));
vi.mock('./features/auth/auth-session', () => ({
  useAuth: () => ({ accessToken: state.token, sessionScope: 'scope' }),
  useRestoreSession: () => ({ isLoading: false }),
  useCurrentUser: () => ({
    data: {
      id: 'actor',
      username: 'actor',
      displayName: 'Actor',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: state.role, siteId: null }],
    },
    isPending: false,
    isError: false,
  }),
  useLogout: () => ({ mutate: vi.fn() }),
  SessionExpiredModal: () => null,
}));
vi.mock('./components/cameras/CameraSetupView', () => ({
  CameraSetupView: ({ sharedSession }: { sharedSession: { user: { id: string } } }) => (
    <h1>Setup for {sharedSession.user.id}</h1>
  ),
}));
vi.mock('./components/ppe/PpeMonitoringView', () => ({
  PpeMonitoringView: ({
    onOpenSetup,
  }: {
    onOpenSetup: (value: { siteId: string; cameraId: string }) => void;
  }) => (
    <button onClick={() => onOpenSetup({ siteId: 'site 1', cameraId: 'cam/1' })}>
      Configure this camera
    </button>
  ),
}));

function Location() {
  return (
    <output data-testid="location">
      {useLocation().pathname}
      {useLocation().search}
    </output>
  );
}
function mount(path: string) {
  changeUiLanguage('en');
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <App />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  state.token = 'token';
  state.role = 'ADMIN';
});
it('opens a direct setup route with the Main verified session and a separate menu entry', async () => {
  mount('/camera-setup');
  expect(await screen.findByRole('heading', { name: 'Setup for actor' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Camera setup/i })).toBeTruthy();
});
it('navigates from monitoring to setup with encoded Site/camera IDs', async () => {
  mount('/ppe');
  fireEvent.click(await screen.findByRole('button', { name: 'Configure this camera' }));
  await screen.findByRole('heading', { name: 'Setup for actor' });
  expect(screen.getByTestId('location').textContent).toBe(
    '/camera-setup?siteId=site+1&cameraId=cam%2F1',
  );
});
it('keeps the setup route behind the existing authentication gate', async () => {
  state.token = null;
  mount('/camera-setup');
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
  expect(screen.queryByText('Setup for actor')).toBeNull();
});
