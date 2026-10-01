// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
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
});
