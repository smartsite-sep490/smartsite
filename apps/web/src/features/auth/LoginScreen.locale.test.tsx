// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient, ApiError } from '@smartsite/api-client';
import { LocaleProvider } from '../../i18n/locale';
import { LoginScreen } from './LoginScreen';
import i18n, { translate as tr } from '../../i18n';
import { AuthProvider } from './auth-session';

beforeEach(async () => {
  await i18n.changeLanguage('vi');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

function mountLogin() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <LoginScreen onBack={vi.fn()} onNavigateToRegister={vi.fn()} />
        </AuthProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

describe('localized login preserves the authentication command', () => {
  it('switches language without losing credentials and submits the unchanged input', async () => {
    const login = vi
      .spyOn(SmartSiteManagementClient.prototype, 'login')
      .mockRejectedValue(new ApiError('http', 'Synthetic unauthorized', 401));
    const user = userEvent.setup();
    mountLogin();
    const username = screen.getByLabelText(/^Tên đăng nhập$/i) as HTMLInputElement;
    const password = screen.getByLabelText(/^Mật khẩu$/i) as HTMLInputElement;
    await user.type(username, 'synthetic-demo-user');
    await user.type(password, 'synthetic-test-password');
    await user.click(screen.getByRole('button', { name: 'Chọn ngôn ngữ' }));
    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeDefined();
    expect(username.value).toBe('synthetic-demo-user');
    expect(password.value).toBe('synthetic-test-password');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(login.mock.calls[0]?.[0]).toBe('synthetic-demo-user');
    expect(login.mock.calls[0]?.[1]).toBe('synthetic-test-password');
  });

  it('translates a retained failed-login state without issuing another request', async () => {
    const login = vi
      .spyOn(SmartSiteManagementClient.prototype, 'login')
      .mockRejectedValue(new ApiError('http', 'Synthetic unauthorized', 401));
    const user = userEvent.setup();
    mountLogin();
    await user.type(screen.getByLabelText(/^Tên đăng nhập$/i), 'invalid-test-user');
    await user.type(screen.getByLabelText(/^Mật khẩu$/i), 'invalid-test-password');
    await user.click(screen.getByRole('button', { name: /^Đăng nhập$/i }));
    expect((await screen.findByRole('alert')).textContent).toContain(tr('auth.error.credentials'));
    await user.click(screen.getByRole('button', { name: 'Chọn ngôn ngữ' }));
    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('alert').textContent).toContain(tr('auth.error.credentials'));
    expect(login).toHaveBeenCalledTimes(1);
  });
});
