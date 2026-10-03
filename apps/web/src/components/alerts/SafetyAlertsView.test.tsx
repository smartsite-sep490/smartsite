// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type {
  LoginResponse,
  SiteResponse,
  SafetyAlertResponse,
  SafetyAlertDetailResponse,
  Page,
  ObservationIdentityContextResponse,
  ObservationIdentityWorkerResponse,
} from '@smartsite/api-client';
import { SafetyAlertsView } from './SafetyAlertsView';

// Polyfill URL.createObjectURL and ResizeObserver for jsdom
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = vi.fn((blob: Blob) => `blob:mock-url-${blob.size}`);
  URL.revokeObjectURL = vi.fn();
}

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const mockAdminLoginResponse: LoginResponse = {
  accessToken: 'mock-admin-token',
  tokenType: 'Bearer',
  accessTokenExpiresAt: '2026-10-01T23:59:59Z',
  refreshTokenExpiresAt: '2026-10-02T23:59:59Z',
  user: {
    id: 'user-admin-1',
    username: 'admin',
    displayName: 'Quản trị viên Hệ thống',
    roleAssignments: [{ role: 'ADMIN', siteId: null }],
    isActive: true,
    mustChangePassword: false,
  },
};

const mockSafetyOfficerLoginResponse: LoginResponse = {
  accessToken: 'mock-so-token',
  tokenType: 'Bearer',
  accessTokenExpiresAt: '2026-10-01T23:59:59Z',
  refreshTokenExpiresAt: '2026-10-02T23:59:59Z',
  user: {
    id: 'user-so-1',
    username: 'safety.officer',
    displayName: 'Cán bộ An toàn Alpha',
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
    isActive: true,
    mustChangePassword: false,
  },
};

const mockSitesList: Page<SiteResponse> = {
  items: [
    {
      id: 'site-alpha',
      code: 'SITE-A',
      name: 'Công trường Alpha',
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 1,
};

const mockAlert: SafetyAlertResponse = {
  id: 'alert-1',
  siteId: 'site-alpha',
  zoneId: null,
  candidateWorkerId: null,
  alertType: 'PPE_VIOLATION',
  candidateSubtype: 'NO_HARD_HAT',
  status: 'PENDING_REVIEW',
  firstDetectedAt: '2026-09-30T10:00:00Z',
  lastDetectedAt: '2026-09-30T10:00:00Z',
  detectionCount: 1,
  revision: 1,
  createdAt: '2026-09-30T10:00:00Z',
  updatedAt: '2026-09-30T10:00:00Z',
};

const mockAlertDetail: SafetyAlertDetailResponse = {
  ...mockAlert,
  detectionsTotal: 1,
  detections: [
    {
      eventId: '00000000-0000-4000-8000-000000000001',
      cameraExternalId: 'CAM-01',
      capturedAt: '2026-09-30T10:00:00Z',
      processingStatus: 'PROCESSED',
      evidence: [],
    },
  ],
  reviewsTotal: 0,
  reviews: [],
};

const mockIdentityContext: ObservationIdentityContextResponse = {
  eventId: '00000000-0000-4000-8000-000000000001',
  payloadHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  eventConsistent: true,
  frames: [],
  subjects: [],
};

const mockIdentityWorkers: Page<ObservationIdentityWorkerResponse> = {
  items: [],
  total: 0,
};

describe('SafetyAlertsView Integration (Plan §15 A4 Parent View & Session Scope)', () => {
  let queryClient: QueryClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false, gcTime: 0 },
      },
    });

    // Enforce runtime isolation: Any unmocked network fetch call must reject immediately
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      throw new Error(`Unexpected unmocked network fetch call to: ${String(input)}`);
    });

    // Default logout mock to protect cleanup/unmount in every test
    vi.spyOn(SmartSiteManagementClient.prototype, 'logout').mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('Admin-only role computation: passes canReviewIdentity=false and NEVER calls identity APIs when user has only global Admin role', async () => {
    const user = userEvent.setup();

    vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockResolvedValue(
      mockAdminLoginResponse,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockResolvedValue({
      items: [mockAlert],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockResolvedValue(
      mockAlertDetail,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlertEvidence').mockResolvedValue(
      new Blob([], { type: 'image/jpeg' }),
    );

    const getIdentityContextSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getObservationIdentityContext')
      .mockResolvedValue(mockIdentityContext);
    const listWorkersSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listObservationIdentityWorkers')
      .mockResolvedValue(mockIdentityWorkers);
    const listDecisionsSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listObservationIdentityDecisions')
      .mockResolvedValue({ items: [], total: 0 });
    const decideSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'decideObservationIdentity');

    render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertsView apiUrl="http://127.0.0.1:3001" />
      </QueryClientProvider>,
    );

    // Form đăng nhập ban đầu
    expect(screen.getByRole('heading', { name: 'Safety alert queue' })).not.toBeNull();

    await user.type(screen.getByLabelText(/Username/i), 'admin');
    await user.type(screen.getByLabelText(/Password/i), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // Đăng nhập thành công, hàng đợi cảnh báo hiển thị
    await screen.findByRole('heading', { name: 'Safety alerts' });
    await screen.findByText(/Công trường Alpha/i);

    // Chờ chi tiết cảnh báo được tải
    await screen.findByText('00000000-0000-4000-8000-000000000001');

    // Admin đơn thuần: không có role SAFETY_OFFICER tại công trường này -> canReviewIdentity được tính là false
    // Do đó ObservationIdentityReviewPanel KHÔNG được mount
    expect(screen.queryByText('Xác minh người trong ảnh')).toBeNull();

    // Tuyệt đối không gọi bất kỳ API danh tính nào
    expect(getIdentityContextSpy).not.toHaveBeenCalled();
    expect(listWorkersSpy).not.toHaveBeenCalled();
    expect(listDecisionsSpy).not.toHaveBeenCalled();
    expect(decideSpy).not.toHaveBeenCalled();
  });

  it('Same user re-login gets fresh sessionScope and logout cancels sensitive queries and clears cache', async () => {
    const user = userEvent.setup();

    const loginSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'login')
      .mockResolvedValue(mockSafetyOfficerLoginResponse);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockResolvedValue({
      items: [mockAlert],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockResolvedValue(
      mockAlertDetail,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlertEvidence').mockResolvedValue(
      new Blob([], { type: 'image/jpeg' }),
    );
    const logoutSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'logout')
      .mockResolvedValue(undefined as never);

    // Mock identity methods to guarantee full runtime isolation
    vi.spyOn(
      SmartSiteManagementClient.prototype,
      'getObservationIdentityContext',
    ).mockResolvedValue(mockIdentityContext);
    vi.spyOn(
      SmartSiteManagementClient.prototype,
      'listObservationIdentityWorkers',
    ).mockResolvedValue(mockIdentityWorkers);
    vi.spyOn(
      SmartSiteManagementClient.prototype,
      'listObservationIdentityDecisions',
    ).mockResolvedValue({
      items: [],
      total: 0,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'decideObservationIdentity');

    const removeQueriesSpy = vi.spyOn(queryClient, 'removeQueries');
    const cancelQueriesSpy = vi.spyOn(queryClient, 'cancelQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertsView apiUrl="http://127.0.0.1:3001" />
      </QueryClientProvider>,
    );

    // 1. Đăng nhập phiên thứ nhất (Session 1)
    await user.type(screen.getByLabelText(/Username/i), 'safety.officer');
    await user.type(screen.getByLabelText(/Password/i), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByRole('heading', { name: 'Safety alerts' });
    const signOutBtn = await screen.findByRole('button', {
      name: /Sign out Cán bộ An toàn Alpha/i,
    });
    expect(signOutBtn).not.toBeNull();

    // Capture actual first sessionScope from the active query keys
    const allQueriesSession1 = queryClient.getQueryCache().getAll();
    const sitesQuery1 = allQueriesSession1.find((q) => q.queryKey[0] === 'sites');
    expect(sitesQuery1).toBeDefined();

    const firstScope = sitesQuery1!.queryKey[2] as string;
    expect(firstScope).toBeDefined();
    expect(firstScope.length).toBeGreaterThan(0);
    // Strict isolation assertion: sessionScope MUST be random UUID, never user token or user id
    expect(firstScope).not.toBe(mockSafetyOfficerLoginResponse.accessToken);
    expect(firstScope).not.toBe(mockSafetyOfficerLoginResponse.user.id);
    expect(firstScope).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // 2. Seed synthetic sensitive PII data under firstScope to verify eviction on logout
    const testApiUrl = 'http://127.0.0.1:3001';
    const siteId = 'site-alpha';
    const alertId = mockAlert.id;
    const eventId = mockAlertDetail.detections[0]!.eventId;

    queryClient.setQueryData(
      ['observation-identity-context', testApiUrl, firstScope, siteId, alertId, eventId],
      { secretWorkerPii: 'Sensitive-Subject-Identity-Context-1' },
    );
    queryClient.setQueryData(
      ['observation-identity-workers', testApiUrl, firstScope, siteId, alertId, eventId, 0, 20],
      { secretWorkerDirectory: ['Nguyễn Văn A', 'Trần Thị B'] },
    );
    queryClient.setQueryData(
      [
        'observation-identity-decisions',
        testApiUrl,
        firstScope,
        siteId,
        alertId,
        eventId,
        0,
        0,
        20,
      ],
      { secretAuditTrail: ['Manual-SO-Decision-Revision-1'] },
    );
    queryClient.setQueryData(
      ['safety-alert-evidence', testApiUrl, firstScope, siteId, alertId, 0],
      new Blob(['synthetic-sensitive-face-blob'], { type: 'image/jpeg' }),
    );

    // Verify seeded PII data is in cache before logout
    expect(
      queryClient.getQueryData([
        'observation-identity-context',
        testApiUrl,
        firstScope,
        siteId,
        alertId,
        eventId,
      ]),
    ).toBeDefined();
    expect(
      queryClient.getQueryData([
        'observation-identity-workers',
        testApiUrl,
        firstScope,
        siteId,
        alertId,
        eventId,
        0,
        20,
      ]),
    ).toBeDefined();

    // 3. Đăng xuất (Sign out)
    await user.click(signOutBtn);

    // Xác nhận đã gọi client.logout()
    expect(logoutSpy).toHaveBeenCalledTimes(1);

    // Xác nhận đã cancel các queries nhạy cảm (cả evidence và identity)
    expect(cancelQueriesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['safety-alert-evidence']),
      }),
    );
    expect(cancelQueriesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['observation-identity-context']),
      }),
    );
    expect(cancelQueriesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['observation-identity-workers']),
      }),
    );
    expect(cancelQueriesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['observation-identity-decisions']),
      }),
    );

    // Xác nhận spy removeQueries được gọi với các prefix identity
    expect(removeQueriesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['observation-identity-context']),
      }),
    );

    // Xác nhận thực tế: Tất cả query keys chứa firstScope và PII đã bị xóa sạch khỏi TanStack cache
    const remainingQueriesWithFirstScope = queryClient
      .getQueryCache()
      .getAll()
      .filter((q) => q.queryKey.includes(firstScope));
    expect(remainingQueriesWithFirstScope).toHaveLength(0);

    expect(
      queryClient.getQueryData([
        'observation-identity-context',
        testApiUrl,
        firstScope,
        siteId,
        alertId,
        eventId,
      ]),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData([
        'observation-identity-workers',
        testApiUrl,
        firstScope,
        siteId,
        alertId,
        eventId,
        0,
        20,
      ]),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData([
        'observation-identity-decisions',
        testApiUrl,
        firstScope,
        siteId,
        alertId,
        eventId,
        0,
        0,
        20,
      ]),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData([
        'safety-alert-evidence',
        testApiUrl,
        firstScope,
        siteId,
        alertId,
        0,
      ]),
    ).toBeUndefined();

    // 4. Đăng nhập phiên thứ hai cùng người dùng đó (Session 2)
    await screen.findByRole('heading', { name: 'Safety alert queue' });
    await user.type(screen.getByLabelText(/Username/i), 'safety.officer');
    await user.type(screen.getByLabelText(/Password/i), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByRole('heading', { name: 'Safety alerts' });
    expect(loginSpy).toHaveBeenCalledTimes(2);

    // Capture second sessionScope from active queries
    const allQueriesSession2 = queryClient.getQueryCache().getAll();
    const sitesQuery2 = allQueriesSession2.find((q) => q.queryKey[0] === 'sites');
    expect(sitesQuery2).toBeDefined();

    const secondScope = sitesQuery2!.queryKey[2] as string;
    expect(secondScope).toBeDefined();
    expect(secondScope.length).toBeGreaterThan(0);
    // Bắt buộc phải là một random UUID mới, khác hoàn toàn phiên 1, không phải token/user.id
    expect(secondScope).not.toBe(firstScope);
    expect(secondScope).not.toBe(mockSafetyOfficerLoginResponse.accessToken);
    expect(secondScope).not.toBe(mockSafetyOfficerLoginResponse.user.id);
    expect(secondScope).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('accepts initialType navigation prop and filters alert listing accordingly', async () => {
    const user = userEvent.setup();

    vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockResolvedValue(
      mockAdminLoginResponse,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    const listAlertsSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts')
      .mockResolvedValue({
        items: [mockAlert],
        total: 1,
      });
    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockResolvedValue(
      mockAlertDetail,
    );

    render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertsView apiUrl="http://127.0.0.1:3001" initialType="PPE_VIOLATION" />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText(/Username/i), 'admin');
    await user.type(screen.getByLabelText(/Password/i), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByRole('heading', { name: 'Safety alerts' });

    // Alert type select dropdown should be set to PPE_VIOLATION
    const typeSelect = screen.getByLabelText(/Alert type/i) as HTMLSelectElement;
    expect(typeSelect.value).toBe('PPE_VIOLATION');

    expect(listAlertsSpy).toHaveBeenCalledWith(
      mockAdminLoginResponse.accessToken,
      'site-alpha',
      expect.objectContaining({ type: 'PPE_VIOLATION' }),
    );
  });

  it('renders a clear error message when login fails due to a network connection error', async () => {
    const user = userEvent.setup();

    vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockRejectedValue(
      new (await import('@smartsite/api-client')).ApiError(
        'network',
        'Could not connect to the backend.',
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertsView apiUrl="http://127.0.0.1:3001" />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText(/Username/i), 'admin');
    await user.type(screen.getByLabelText(/Password/i), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert.textContent).toContain('Could not connect to the backend');
  });

  it('renders generic sign-in failed message on login HTTP 401 without disclosing account/password specifics or claiming session expired', async () => {
    const user = userEvent.setup();

    vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockRejectedValue(
      new (await import('@smartsite/api-client')).ApiError('http', 'Unauthorized', 401),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertsView apiUrl="http://127.0.0.1:3001" />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText(/Username/i), 'wronguser');
    await user.type(screen.getByLabelText(/Password/i), 'wrongpass');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert.textContent).toBe('Sign-in failed. Check your credentials and try again.');
    expect(errorAlert.textContent).not.toContain('session');
    expect(errorAlert.textContent).not.toContain('password');
    expect(errorAlert.textContent).not.toContain('user');
    // Login form remains mounted
    expect(screen.getByRole('heading', { name: 'Safety alert queue' })).toBeDefined();
  });

  it('preserves session-expired message when an authenticated query returns HTTP 401', async () => {
    const user = userEvent.setup();

    vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockResolvedValue(
      mockAdminLoginResponse,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockRejectedValue(
      new (await import('@smartsite/api-client')).ApiError('http', 'Unauthorized', 401),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertsView apiUrl="http://127.0.0.1:3001" />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText(/Username/i), 'admin');
    await user.type(screen.getByLabelText(/Password/i), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // Reaches authenticated dashboard
    await screen.findByRole('heading', { name: 'Safety alerts' });

    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert.textContent).toBe('Your session is no longer valid. Sign in again.');
    expect(errorAlert.textContent).not.toContain('Sign-in failed');
  });

  it('updates filter from initialType to ALL when prop is cleared without unmounting or losing session', async () => {
    const user = userEvent.setup();

    vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockResolvedValue(
      mockAdminLoginResponse,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockResolvedValue({
      items: [mockAlert],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockResolvedValue(
      mockAlertDetail,
    );

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertsView apiUrl="http://127.0.0.1:3001" initialType="PPE_VIOLATION" />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText(/Username/i), 'admin');
    await user.type(screen.getByLabelText(/Password/i), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByRole('heading', { name: 'Safety alerts' });

    const typeSelect = screen.getByLabelText(/Alert type/i) as HTMLSelectElement;
    expect(typeSelect.value).toBe('PPE_VIOLATION');

    // Re-render với initialType = undefined (mô phỏng App xóa context khi bấm sidebar incidents)
    rerender(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertsView apiUrl="http://127.0.0.1:3001" initialType={undefined} />
      </QueryClientProvider>,
    );

    expect(typeSelect.value).toBe('ALL');
    // Session đăng nhập vẫn còn nguyên vẹn, không bị mất
    expect(screen.queryByRole('heading', { name: 'Safety alert queue' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Safety alerts' })).not.toBeNull();
  });

  describe('SafetyAlertsView Shared Session Integration', () => {
    it('shared-session mounts without login and never calls client.login', async () => {
      const loginSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'login');
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);

      render(
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView
            apiUrl="http://127.0.0.1:3001"
            sharedSession={{
              accessToken: 'shared-admin-token',
              user: {
                id: 'admin-1',
                displayName: 'Admin Officer',
                roleAssignments: [{ role: 'ADMIN', siteId: null }],
              },
              sessionScope: 'scope-1',
            }}
          />
        </QueryClientProvider>,
      );

      expect(await screen.findByRole('heading', { name: 'Safety alerts' })).toBeDefined();
      expect(screen.queryByRole('heading', { name: 'Safety alert queue' })).toBeNull();
      expect(screen.queryByLabelText(/Username/i)).toBeNull();
      expect(loginSpy).not.toHaveBeenCalled();
    });

    it('unmount in shared session mode does not call client.logout', async () => {
      const logoutSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'logout');
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);

      const { unmount } = render(
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView
            apiUrl="http://127.0.0.1:3001"
            sharedSession={{
              accessToken: 'shared-admin-token',
              user: {
                id: 'admin-1',
                displayName: 'Admin Officer',
                roleAssignments: [{ role: 'ADMIN', siteId: null }],
              },
              sessionScope: 'scope-1',
            }}
          />
        </QueryClientProvider>,
      );

      await screen.findByRole('heading', { name: 'Safety alerts' });
      expect(queryClient.getQueryData(['sites', 'http://127.0.0.1:3001', 'scope-1'])).toBeDefined();
      unmount();
      expect(logoutSpy).not.toHaveBeenCalled();
      expect(
        queryClient.getQueryData(['sites', 'http://127.0.0.1:3001', 'scope-1']),
      ).toBeUndefined();
    });

    it('sharedSession === null renders session pending or expired without standalone login form fallback and fires no protected queries', async () => {
      const listSitesSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listSites');

      render(
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView apiUrl="http://127.0.0.1:3001" sharedSession={null} />
        </QueryClientProvider>,
      );

      expect(await screen.findByText(/Session pending or expired/i)).toBeDefined();
      expect(screen.queryByRole('heading', { name: 'Safety alert queue' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
      expect(listSitesSpy).not.toHaveBeenCalled();
    });

    it('explicit sign-out delegates to sharedSession.onSignOut and does not call client.logout', async () => {
      const user = userEvent.setup();
      const onSignOut = vi.fn();
      const logoutSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'logout');
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);

      render(
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView
            apiUrl="http://127.0.0.1:3001"
            sharedSession={{
              accessToken: 'shared-admin-token',
              user: {
                id: 'admin-1',
                displayName: 'Admin Officer',
                roleAssignments: [{ role: 'ADMIN', siteId: null }],
              },
              sessionScope: 'scope-1',
              onSignOut,
            }}
          />
        </QueryClientProvider>,
      );

      await screen.findByRole('heading', { name: 'Safety alerts' });
      const signOutBtn = screen.getByRole('button', { name: /Sign out Admin Officer/i });
      await user.click(signOutBtn);

      expect(onSignOut).toHaveBeenCalledTimes(1);
      expect(logoutSpy).not.toHaveBeenCalled();
    });

    it('same-account new token rotates scope and evicts previous scope queries', async () => {
      const listSitesSpy = vi
        .spyOn(SmartSiteManagementClient.prototype, 'listSites')
        .mockResolvedValue(mockSitesList);

      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView
            apiUrl="http://127.0.0.1:3001"
            sharedSession={{
              accessToken: 'shared-token-1',
              user: {
                id: 'admin-1',
                displayName: 'Admin Officer',
                roleAssignments: [{ role: 'ADMIN', siteId: null }],
              },
              sessionScope: 'scope-alpha',
            }}
          />
        </QueryClientProvider>,
      );

      await screen.findByRole('heading', { name: 'Safety alerts' });
      expect(
        queryClient.getQueryData(['sites', 'http://127.0.0.1:3001', 'scope-alpha']),
      ).toBeDefined();

      // Re-render with rotated token/scope for the same account
      rerender(
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView
            apiUrl="http://127.0.0.1:3001"
            sharedSession={{
              accessToken: 'shared-token-2',
              user: {
                id: 'admin-1',
                displayName: 'Admin Officer',
                roleAssignments: [{ role: 'ADMIN', siteId: null }],
              },
              sessionScope: 'scope-beta',
            }}
          />
        </QueryClientProvider>,
      );

      await screen.findByRole('heading', { name: 'Safety alerts' });
      // Old scope must be evicted from cache
      expect(
        queryClient.getQueryData(['sites', 'http://127.0.0.1:3001', 'scope-alpha']),
      ).toBeUndefined();
      expect(listSitesSpy).toHaveBeenCalledWith('shared-token-2', expect.any(Object));
    });

    it('delayed review success after token switch does not show stale review feedback or disable new session', async () => {
      let resolveReview: (
        val: Awaited<ReturnType<SmartSiteManagementClient['reviewSafetyAlert']>>,
      ) => void;
      const reviewPromise = new Promise<
        Awaited<ReturnType<SmartSiteManagementClient['reviewSafetyAlert']>>
      >((resolve) => {
        resolveReview = resolve;
      });

      vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockResolvedValue({
        items: [mockAlert],
        total: 1,
      });
      vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockResolvedValue(
        mockAlertDetail,
      );
      vi.spyOn(SmartSiteManagementClient.prototype, 'reviewSafetyAlert').mockImplementation(
        () => reviewPromise,
      );

      const user = userEvent.setup();
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView
            apiUrl="http://127.0.0.1:3001"
            sharedSession={{
              accessToken: 'shared-token-1',
              user: {
                id: 'admin-1',
                displayName: 'Admin Officer',
                roleAssignments: [{ role: 'ADMIN', siteId: null }],
              },
              sessionScope: 'scope-1',
            }}
          />
        </QueryClientProvider>,
      );

      await screen.findByRole('heading', { name: 'Safety alerts' });
      await screen.findByRole('heading', { name: 'Record review decision' });

      // Enter review reason and submit under scope-1
      const reasonInput = screen.getByRole('textbox', { name: /Decision reason/i });
      await user.type(reasonInput, 'Valid decision reason from first session');
      const confirmBtn = screen.getByRole('button', { name: 'Confirm violation' });
      await user.click(confirmBtn);

      // Rotate session / token to scope-2 for same user
      rerender(
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView
            apiUrl="http://127.0.0.1:3001"
            sharedSession={{
              accessToken: 'shared-token-2',
              user: {
                id: 'admin-1',
                displayName: 'Admin Officer',
                roleAssignments: [{ role: 'ADMIN', siteId: null }],
              },
              sessionScope: 'scope-2',
            }}
          />
        </QueryClientProvider>,
      );

      // Now resolve the delayed review from scope-1
      await act(async () => {
        resolveReview!({
          alert: { ...mockAlert, status: 'CONFIRMED' },
          review: {
            id: 'rev-1',
            alertId: mockAlert.id,
            siteId: mockAlert.siteId,
            actorUserId: 'admin-1',
            fromStatus: 'PENDING_REVIEW',
            toStatus: 'CONFIRMED',
            reason: 'Valid decision reason from first session',
            alertRevision: 1,
            createdAt: '2026-10-01T00:00:00Z',
          },
          replayed: false,
        });
      });

      // Under scope-2, "Review decision recorded." MUST NOT appear!
      expect(screen.queryByText(/Review decision recorded\./i)).toBeNull();
      // And the new session reason field is clean and actions are not disabled
      const newReasonInput = (await screen.findByRole('textbox', {
        name: /Decision reason/i,
      })) as HTMLTextAreaElement;
      expect(newReasonInput.value).toBe('');

      // Type valid reason in new session and ensure button is enabled (not disabled by old pending mutation)
      await user.type(newReasonInput, 'New valid review reason');
      const newConfirmBtn = screen.getByRole('button', {
        name: 'Confirm violation',
      }) as HTMLButtonElement;
      expect(newConfirmBtn.disabled).toBe(false);
    });

    it('restricted user (Worker/Rep) is denied without firing protected queries or signing out of app', async () => {
      const listSitesSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listSites');
      const onSignOut = vi.fn();

      render(
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView
            apiUrl="http://127.0.0.1:3001"
            sharedSession={{
              accessToken: 'worker-token',
              user: {
                id: 'worker-1',
                displayName: 'John Worker',
                roleAssignments: [{ role: 'WORKER', siteId: 'site-alpha' }],
              },
              sessionScope: 'scope-worker',
              onSignOut,
            }}
          />
        </QueryClientProvider>,
      );

      expect(await screen.findByText(/Access restricted/i)).toBeDefined();
      expect(
        screen.getByText(/A global Admin or Site-scoped Safety Officer role is required/i),
      ).toBeDefined();
      expect(screen.queryByRole('heading', { name: 'Safety alert queue' })).toBeNull();
      expect(listSitesSpy).not.toHaveBeenCalled();
      expect(onSignOut).not.toHaveBeenCalled();
    });
  });
});
