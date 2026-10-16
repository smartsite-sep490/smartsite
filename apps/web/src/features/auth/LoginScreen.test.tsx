// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider, useRestoreSession } from './auth-session';
import { LoginScreen } from './LoginScreen';

vi.mock('@gsap/react', () => ({ useGSAP: () => {} }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it('keeps entered credentials and the network error visible when sign-in fails', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'refresh').mockRejectedValue(
    new ApiError('http', 'Unauthorized', 401),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockRejectedValue(
    new ApiError('network', 'Internal host'),
  );
  function Screen() {
    const restore = useRestoreSession('http://localhost:3000');
    return restore.isLoading ? (
      <p>Restoring</p>
    ) : (
      <LoginScreen onBack={vi.fn()} onNavigateToRegister={vi.fn()} />
    );
  }
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <AuthProvider>
        <Screen />
      </AuthProvider>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Username'), 'worker');
  await user.type(screen.getByLabelText('Password', { exact: true }), 'SyntheticPassword1!');
  await user.click(screen.getByRole('button', { name: 'Sign In' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Could not connect');
  expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('worker');
  expect((screen.getByLabelText('Password', { exact: true }) as HTMLInputElement).value).toBe(
    'SyntheticPassword1!',
  );
  cache.clear();
});
