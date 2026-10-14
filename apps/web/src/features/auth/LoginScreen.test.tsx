// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient, type LoginResponse } from '@smartsite/api-client';
import i18n from '../../i18n';
import { AuthProvider, useAuth } from './auth-session';
import { LoginScreen } from './LoginScreen';
import { RegisterScreen } from './RegisterScreen';

const observedAuthState = {
  accessToken: null as string | null,
  sessionScope: '',
};

function AuthStateObserver() {
  const { accessToken, sessionScope } = useAuth();
  observedAuthState.accessToken = accessToken;
  observedAuthState.sessionScope = sessionScope;
  return null;
}

function createLoginResponse(
  accessToken: string,
  id = 'user-001',
  username = 'validuser',
): LoginResponse {
  return {
    accessToken,
    tokenType: 'Bearer',
    accessTokenExpiresAt: '2026-10-14T21:00:00.000Z',
    refreshTokenExpiresAt: '2026-10-21T21:00:00.000Z',
    user: {
      id,
      username,
      displayName: username,
      roleAssignments: [{ role: 'ADMIN', siteId: null }],
      isActive: true,
      mustChangePassword: false,
    },
  };
}

async function resetLanguageAndStorage() {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  localStorage.clear();
  sessionStorage.clear();
}

describe('LoginScreen - Stable Responsive Redesign & Shared Runtime i18n', () => {
  let queryClient: QueryClient;
  const mockOnBack = vi.fn();
  const mockOnNavigateToRegister = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetLanguageAndStorage();
    observedAuthState.accessToken = null;
    observedAuthState.sessionScope = '';
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  afterEach(async () => {
    cleanup();
    queryClient.clear();
    await resetLanguageAndStorage();
    observedAuthState.accessToken = null;
    observedAuthState.sessionScope = '';
    vi.restoreAllMocks();
  });

  const renderComponent = (notice?: string) =>
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthStateObserver />
          <LoginScreen
            notice={notice}
            onBack={mockOnBack}
            onNavigateToRegister={mockOnNavigateToRegister}
          />
        </AuthProvider>
      </QueryClientProvider>,
    );

  it('1. Renders calm, stable form with accessible inputs and labels', () => {
    renderComponent();

    expect(screen.getByRole('heading', { name: /sign in/i })).not.toBeNull();
    expect(screen.getByLabelText(/^username$/i)).not.toBeNull();
    expect(screen.getByLabelText(/^password$/i)).not.toBeNull();
    expect(screen.getByRole('button', { name: /sign in/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /back to homepage/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /get an account/i })).not.toBeNull();
  });

  it('2. Toggles password visibility without resetting input value', () => {
    renderComponent();

    const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    fireEvent.change(passwordInput, { target: { value: 'SecretPass!1' } });
    expect(passwordInput.type).toBe('password');

    const toggleButton = screen.getByRole('button', { name: /show password/i });
    fireEvent.click(toggleButton);

    expect(passwordInput.type).toBe('text');
    expect(passwordInput.value).toBe('SecretPass!1');
    expect(screen.getByRole('button', { name: /hide password/i })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /hide password/i }));
    expect(passwordInput.type).toBe('password');
    expect(passwordInput.value).toBe('SecretPass!1');
  });

  it('3. Disables form controls and shows loading indicator while pending', async () => {
    let resolveLogin: (value: LoginResponse) => void = () => {};
    const loginPromise = new Promise<LoginResponse>((resolve) => {
      resolveLogin = resolve;
    });

    vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockReturnValue(loginPromise);

    renderComponent();

    const usernameInput = screen.getByLabelText(/^username$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    fireEvent.change(usernameInput, { target: { value: 'admin' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/signing in\.\.\./i)).not.toBeNull();
      expect(usernameInput.hasAttribute('disabled')).toBe(true);
      expect(passwordInput.hasAttribute('disabled')).toBe(true);
    });

    resolveLogin(createLoginResponse('valid-token'));
    await waitFor(() => {
      expect(observedAuthState.accessToken).toBe('valid-token');
    });
  });

  it('4. Displays appropriate error feedback on 401 unauthorized failure', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockRejectedValue({
      status: 401,
      message: 'Unauthorized',
    });

    renderComponent();

    fireEvent.change(screen.getByLabelText(/^username$/i), { target: { value: 'baduser' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'wrongpass' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert.textContent).toContain('Invalid credentials.');
  });

  it('5. Displays connection failed on network error and allows retry into provider session state', async () => {
    const loginSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'login')
      .mockRejectedValueOnce({
        type: 'network',
        message: 'Network Error',
      })
      .mockResolvedValueOnce(createLoginResponse('recovered-token', 'u1', 'admin'));

    renderComponent();

    const usernameInput = screen.getByLabelText(/^username$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const submitBtn = screen.getByRole('button', { name: /sign in/i });

    fireEvent.change(usernameInput, { target: { value: 'admin' } });
    fireEvent.change(passwordInput, { target: { value: 'pass123' } });
    fireEvent.click(submitBtn);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Connection failed.');
    expect(observedAuthState.accessToken).toBeNull();

    // User retries
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(observedAuthState.accessToken).toBe('recovered-token');
    });
    expect(observedAuthState.sessionScope).not.toBe('');
    expect(queryClient.getQueryData(['auth', 'session', 'http://localhost:3000'])).toBe(true);
    expect(loginSpy).toHaveBeenCalledTimes(2);
  });

  it('6. Triggers onBack and onNavigateToRegister callbacks correctly', () => {
    renderComponent();

    fireEvent.click(screen.getByRole('button', { name: /back to homepage/i }));
    expect(mockOnBack).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /get an account/i }));
    expect(mockOnNavigateToRegister).toHaveBeenCalledTimes(1);
  });

  it('7. Displays rate limit warning on 429 too many attempts', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockRejectedValue({
      status: 429,
      message: 'Too Many Requests',
    });

    renderComponent();

    fireEvent.change(screen.getByLabelText(/^username$/i), { target: { value: 'frequentuser' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'mypassword' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert.textContent).toContain('Too many attempts.');
  });

  it('8. Updates provider session state on successful credentials submission', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockResolvedValue(
      createLoginResponse('auth-jwt-token-success', 'user-001', 'validuser'),
    );

    renderComponent();

    fireEvent.change(screen.getByLabelText(/^username$/i), { target: { value: 'validuser' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'correctpassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(observedAuthState.accessToken).toBe('auth-jwt-token-success');
    });
    expect(observedAuthState.sessionScope).not.toBe('');
    expect(queryClient.getQueryData(['auth', 'session', 'http://localhost:3000'])).toBe(true);
  });

  it('9. Password toggle button is disabled when pending and supports focus-visible styling', async () => {
    let resolveLogin: (value: LoginResponse) => void = () => {};
    const loginPromise = new Promise<LoginResponse>((resolve) => {
      resolveLogin = resolve;
    });

    vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockReturnValue(loginPromise);

    renderComponent();

    const toggleButton = screen.getByRole('button', { name: /show password/i });
    expect(toggleButton.className).toContain('focus-visible:ring-1');

    fireEvent.change(screen.getByLabelText(/^username$/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(toggleButton.hasAttribute('disabled')).toBe(true);
    });

    resolveLogin(createLoginResponse('valid-token'));
    await waitFor(() => {
      expect(observedAuthState.accessToken).toBe('valid-token');
    });
  });

  it.each([
    [new ApiError('network', 'synthetic-private-canary'), 'Connection failed.'],
    [new ApiError('timeout', 'synthetic-private-canary'), 'Sign in timed out. Please try again.'],
    [
      new ApiError('http', 'synthetic-private-canary', 503),
      'Sign-in service is unavailable. Please try again.',
    ],
    [
      new ApiError('invalid-response', 'synthetic-private-canary'),
      'Sign-in service returned an invalid response. Please try again.',
    ],
  ])(
    'shows an actionable safe message for %s and allows a successful manual retry',
    async (failure, expected) => {
      const login = vi
        .spyOn(SmartSiteManagementClient.prototype, 'login')
        .mockRejectedValueOnce(failure)
        .mockResolvedValue(
          createLoginResponse('synthetic-retry-token', 'synthetic-user', 'synthetic'),
        );
      renderComponent();
      fireEvent.change(screen.getByLabelText(/^username$/i), { target: { value: 'synthetic' } });
      fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Synthetic1!' } });
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(expected);
      expect(alert.textContent).not.toContain('synthetic-private-canary');
      expect(observedAuthState.accessToken).toBeNull();
      expect(login).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
      await waitFor(() => expect(observedAuthState.accessToken).toBe('synthetic-retry-token'));
      expect(login).toHaveBeenCalledTimes(2);
    },
  );

  it('11. Re-translates 401 error and preserves username, password, and password visibility across shared runtime EN/VI language switches', async () => {
    const loginSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'login')
      .mockRejectedValue(new ApiError('http', 'Unauthorized', 401));

    renderComponent('Password changed. Please sign in with your new password.');

    const usernameInput = screen.getByLabelText(/^username$/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;

    fireEvent.change(usernameInput, { target: { value: 'field.operator' } });
    fireEvent.change(passwordInput, { target: { value: 'DraftPass#2026' } });
    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(passwordInput.type).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const enAlert = await screen.findByRole('alert');
    expect(enAlert.textContent).toBe('Invalid credentials.');
    expect(loginSpy).toHaveBeenCalledTimes(1);

    // Switch to Vietnamese via the rendered LanguageSwitcher
    fireEvent.click(screen.getByRole('button', { name: 'Choose language' }));
    fireEvent.click(screen.getByRole('button', { name: /Tiếng Việt/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Đăng nhập' })).not.toBeNull();
    });
    expect(screen.getByRole('alert').textContent).toBe('Thông tin đăng nhập không hợp lệ.');
    expect(screen.getByRole('status').textContent).toBe(
      'Đã đổi mật khẩu. Vui lòng đăng nhập bằng mật khẩu mới.',
    );
    expect(screen.getByRole('button', { name: 'Quay lại trang chủ' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Ẩn mật khẩu' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Đăng ký tài khoản' })).not.toBeNull();

    // Draft credentials and visibility state remain untouched
    expect((screen.getByLabelText('Tên đăng nhập') as HTMLInputElement).value).toBe(
      'field.operator',
    );
    const viPasswordInput = screen.getByLabelText('Mật khẩu') as HTMLInputElement;
    expect(viPasswordInput.value).toBe('DraftPass#2026');
    expect(viPasswordInput.type).toBe('text');
    expect(loginSpy).toHaveBeenCalledTimes(1);

    // Switch back to English via LanguageSwitcher
    fireEvent.click(screen.getByRole('button', { name: 'Chọn ngôn ngữ' }));
    fireEvent.click(screen.getByRole('button', { name: /English/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Invalid credentials.');
    });
    expect(screen.getByRole('status').textContent).toBe(
      'Password changed. Please sign in with your new password.',
    );
    expect((screen.getByLabelText(/^username$/i) as HTMLInputElement).value).toBe(
      'field.operator',
    );
    expect((screen.getByLabelText(/^password$/i) as HTMLInputElement).value).toBe(
      'DraftPass#2026',
    );
  });

  it('12. Translates VI-authored passwordChanged notice in EN and preserves unknown notice strings raw', () => {
    const view = render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <LoginScreen
            notice="Đã đổi mật khẩu. Vui lòng đăng nhập bằng mật khẩu mới."
            onBack={mockOnBack}
            onNavigateToRegister={mockOnNavigateToRegister}
          />
        </AuthProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('status').textContent).toBe(
      'Password changed. Please sign in with your new password.',
    );

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <LoginScreen
            notice="Custom unmapped operator notice."
            onBack={mockOnBack}
            onNavigateToRegister={mockOnNavigateToRegister}
          />
        </AuthProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('status').textContent).toBe('Custom unmapped operator notice.');
  });
});

describe('RegisterScreen - Account Provisioning Guidance & Shared Runtime i18n', () => {
  const mockOnBackToLogin = vi.fn();
  const mockOnBackToSite = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetLanguageAndStorage();
  });

  afterEach(async () => {
    cleanup();
    await resetLanguageAndStorage();
  });

  it('renders admin-provisioned account guidance in EN and VI via shared runtime and triggers navigation callbacks', async () => {
    render(
      <RegisterScreen onBackToLogin={mockOnBackToLogin} onBackToSite={mockOnBackToSite} />,
    );

    expect(screen.getByText('Account access')).not.toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Get access to SmartSite' }),
    ).not.toBeNull();
    expect(
      screen.getByText(
        'Ask your SmartSite administrator to create your account and assign the roles you need.',
      ),
    ).not.toBeNull();
    expect(
      screen.getByText('Already have your account details? Sign in to continue.'),
    ).not.toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();

    // Switch to Vietnamese via the rendered LanguageSwitcher
    fireEvent.click(screen.getByRole('button', { name: 'Choose language' }));
    fireEvent.click(screen.getByRole('button', { name: /Tiếng Việt/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Nhận quyền truy cập SmartSite' }),
      ).not.toBeNull();
    });
    expect(screen.getByText('Quyền truy cập tài khoản')).not.toBeNull();
    expect(
      screen.getByText(
        'Hãy liên hệ quản trị viên SmartSite để được tạo tài khoản và phân quyền vai trò phù hợp.',
      ),
    ).not.toBeNull();
    expect(
      screen.getByText('Đã có thông tin tài khoản? Đăng nhập để tiếp tục.'),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Quay lại trang chủ' }));
    expect(mockOnBackToSite).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(mockOnBackToLogin).toHaveBeenCalledTimes(1);
  });
});
