// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { AuthContext } from './auth-session';
import { ChangePasswordScreen } from './ChangePasswordScreen';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  cache.setQueryData(['private', 'visitor-queue'], ['old-user-data']);
  const setAccessToken = vi.fn();
  const onComplete = vi.fn();
  render(
    <QueryClientProvider client={cache}>
      <AuthContext.Provider
        value={{
          accessToken: 'temporary-token',
          setAccessToken,
          isSessionExpired: false,
          triggerSessionExpired: vi.fn(),
          dismissSessionExpired: vi.fn(),
        }}
      >
        <ChangePasswordScreen apiUrl="https://api.example.test" onComplete={onComplete} />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { cache, setAccessToken, onComplete, user: userEvent.setup() };
}

async function fill(user: ReturnType<typeof userEvent.setup>, confirmation = 'NewDemo2026!') {
  await user.type(screen.getByLabelText('Current temporary password'), 'TempDemo2026!');
  await user.type(screen.getByLabelText('New password', { exact: true }), 'NewDemo2026!');
  await user.type(screen.getByLabelText('Confirm new password'), confirmation);
}

it('uses the real password endpoint, clears private caches and returns to sign-in after session revocation', async () => {
  const request = vi
    .spyOn(SmartSiteManagementClient.prototype, 'changePassword')
    .mockResolvedValue();
  const { user, cache, setAccessToken, onComplete } = setup();
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Save new password' }));
  await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledWith('temporary-token', 'TempDemo2026!', 'NewDemo2026!');
  expect(setAccessToken).toHaveBeenCalledWith(null);
  expect(cache.getQueryData(['private', 'visitor-queue'])).toBeUndefined();
  expect(cache.getQueryData(['auth', 'session'])).toBeNull();
  cache.clear();
});

it('rejects mismatched confirmation before submitting credentials', async () => {
  const request = vi.spyOn(SmartSiteManagementClient.prototype, 'changePassword');
  const { user, cache } = setup();
  await fill(user, 'OtherDemo2026!');
  await user.click(screen.getByRole('button', { name: 'Save new password' }));
  expect(screen.getByRole('alert').textContent).toContain('do not match');
  expect(request).not.toHaveBeenCalled();
  cache.clear();
});

it('keeps the account blocked when the backend rejects the current password', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'changePassword').mockRejectedValue(
    new ApiError('http', 'Unauthorized', 401),
  );
  const { user, cache, setAccessToken, onComplete } = setup();
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Save new password' }));
  expect((await screen.findByRole('alert')).textContent).toContain('current password is incorrect');
  expect(onComplete).not.toHaveBeenCalled();
  expect(setAccessToken).not.toHaveBeenCalled();
  expect(cache.getQueryData(['private', 'visitor-queue'])).toEqual(['old-user-data']);
  cache.clear();
});

it('shows password policy errors from the backend and allows correction', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'changePassword').mockRejectedValue(
    new ApiError('http', 'Password must include an uppercase letter', 400),
  );
  const { user, cache, onComplete } = setup();
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Save new password' }));
  expect((await screen.findByRole('alert')).textContent).toContain('uppercase letter');
  expect(screen.getByRole('button', { name: 'Save new password' }).hasAttribute('disabled')).toBe(
    false,
  );
  expect(onComplete).not.toHaveBeenCalled();
  cache.clear();
});
