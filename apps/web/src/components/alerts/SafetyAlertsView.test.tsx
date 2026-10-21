// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
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
import { formatCandidateSubtype } from './safetyAlertEvidenceUtils';

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

  for (const refresh of ['reorder', 'remove'] as const) {
    it(`keeps a typed review attached to its original alert during background list ${refresh}`, async () => {
      const user = userEvent.setup();
      const second = { ...mockAlert, id: 'alert-2', candidateSubtype: 'NO_SAFETY_VEST' };
      let refreshed = false;
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockImplementation(
        async () => ({
          items: refreshed
            ? refresh === 'remove'
              ? [second]
              : [second, mockAlert]
            : [mockAlert, second],
          total: refreshed && refresh === 'remove' ? 1 : 2,
        }),
      );
      vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockImplementation(
        async (_token, _site, id) => ({
          ...mockAlertDetail,
          ...(id === second.id ? second : mockAlert),
        }),
      );
      const review = vi
        .spyOn(SmartSiteManagementClient.prototype, 'reviewSafetyAlert')
        .mockRejectedValue(new ApiError('network', 'Synthetic transient failure'));
      render(
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView
            apiUrl="http://127.0.0.1:3001"
            sharedSession={{
              accessToken: 'shared-token-1',
              user: mockSafetyOfficerLoginResponse.user,
              sessionScope: 'scope-1',
            }}
          />
        </QueryClientProvider>,
      );
      const reason = 'Review belongs to the original helmet observation.';
      await user.type(await screen.findByRole('textbox', { name: /Decision reason/i }), reason);
      refreshed = true;
      await act(async () => {
        await queryClient.refetchQueries({ queryKey: ['safety-alerts'], type: 'active' });
      });
      await user.click(screen.getByRole('button', { name: 'Confirm violation' }));
      await waitFor(() =>
        expect(review).toHaveBeenCalledWith(
          'shared-token-1',
          'site-alpha',
          'alert-1',
          expect.objectContaining({ reason }),
        ),
      );
      expect(review.mock.calls.some((call) => call[2] === second.id)).toBe(false);
    });
  }

  it('reuses the review command after a lost response and changes it when the reason changes', async () => {
    const user = userEvent.setup();
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockResolvedValue({
      items: [mockAlert],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockResolvedValue(
      mockAlertDetail,
    );
    const review = vi
      .spyOn(SmartSiteManagementClient.prototype, 'reviewSafetyAlert')
      .mockRejectedValue(new ApiError('network', 'Synthetic lost response'));
    render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertsView
          apiUrl="http://127.0.0.1:3001"
          sharedSession={{
            accessToken: 'shared-token-1',
            user: mockSafetyOfficerLoginResponse.user,
            sessionScope: 'scope-1',
          }}
        />
      </QueryClientProvider>,
    );
    const reason = await screen.findByRole('textbox', { name: /Decision reason/i });
    await user.type(reason, 'Synthetic exact review retry.');
    for (let attempt = 1; attempt <= 2; attempt++) {
      const button = screen.getByRole('button', { name: 'Confirm violation' });
      await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
      await user.click(button);
      await waitFor(() => expect(review).toHaveBeenCalledTimes(attempt));
    }
    expect(review.mock.calls[1]![3].commandId).toBe(review.mock.calls[0]![3].commandId);
    await user.type(reason, ' Additional evidence.');
    const button = screen.getByRole('button', { name: 'Confirm violation' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await user.click(button);
    await waitFor(() => expect(review).toHaveBeenCalledTimes(3));
    expect(review.mock.calls[2]![3].commandId).not.toBe(review.mock.calls[0]![3].commandId);
  });

  it.each(['CONFIRMED', 'DISMISSED'] as const)(
    'announces a pending review and retains confirmation after the editor closes for %s',
    async (status) => {
      type ReviewResult = Awaited<ReturnType<SmartSiteManagementClient['reviewSafetyAlert']>>;
      let resolveReview!: (result: ReviewResult) => void;
      const pending = new Promise<ReviewResult>((resolve) => {
        resolveReview = resolve;
      });
      let saved = false;
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockImplementation(
        async () => ({
          items: saved ? [] : [mockAlert],
          total: saved ? 0 : 1,
        }),
      );
      const detailSpy = vi
        .spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert')
        .mockImplementation(async () => ({
          ...mockAlertDetail,
          status: saved ? status : 'PENDING_REVIEW',
        }));
      vi.spyOn(SmartSiteManagementClient.prototype, 'reviewSafetyAlert').mockReturnValue(pending);
      render(
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView
            apiUrl="http://127.0.0.1:3001"
            sharedSession={{
              accessToken: 'shared-token-1',
              user: mockSafetyOfficerLoginResponse.user,
              sessionScope: 'scope-1',
            }}
          />
        </QueryClientProvider>,
      );
      const user = userEvent.setup();
      await user.type(
        await screen.findByRole('textbox', { name: /Decision reason/i }),
        'Reviewed the exact evidence.',
      );
      await user.click(
        screen.getByRole('button', {
          name: status === 'CONFIRMED' ? 'Confirm violation' : 'Dismiss alert',
        }),
      );
      expect(
        (await screen.findByText('Recording review decision…')).closest('[role="status"]'),
      ).not.toBeNull();
      saved = true;
      await act(async () =>
        resolveReview({
          alert: { ...mockAlert, status },
          review: {
            id: 'review-1',
            alertId: mockAlert.id,
            siteId: mockAlert.siteId,
            actorUserId: 'user-so-1',
            fromStatus: 'PENDING_REVIEW',
            toStatus: status,
            reason: 'Reviewed the exact evidence.',
            alertRevision: 2,
            createdAt: '2026-10-01T00:00:00Z',
          },
          replayed: false,
        }),
      );
      await waitFor(() => expect(detailSpy).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.queryByRole('heading', { name: 'Record review decision' })).toBeNull(),
      );
      expect(
        screen.getByText('Review decision recorded.').closest('[role="status"]'),
      ).not.toBeNull();
      expect(screen.queryByText('Recording review decision…')).toBeNull();
    },
  );

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
    await screen.findByRole('heading', { name: 'Safety operations' });
    await screen.findByText(/Công trường Alpha/i);
    await user.click(screen.getByRole('button', { name: 'Alerts' }));

    // Chờ chi tiết cảnh báo được tải
    await screen.findByText('00000000-0000-4000-8000-000000000001');

    // Admin đơn thuần: không có role SAFETY_OFFICER tại công trường này -> canReviewIdentity được tính là false
    // Do đó ObservationIdentityReviewPanel KHÔNG được mount
    expect(screen.queryByText('Xác minh người trong ảnh')).toBeNull();
    expect(screen.queryByRole('textbox', { name: /Decision reason/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm violation' })).toBeNull();

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

    await screen.findByRole('heading', { name: 'Safety operations' });
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

    await screen.findByRole('heading', { name: 'Safety operations' });
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

    await screen.findByRole('heading', { name: 'Safety operations' });

    // Alert type select dropdown should be set to PPE_VIOLATION
    const typeSelect = screen.getByLabelText(/Alert type/i) as HTMLSelectElement;
    expect(typeSelect.value).toBe('PPE_VIOLATION');

    expect(listAlertsSpy).toHaveBeenCalledWith(
      mockAdminLoginResponse.accessToken,
      'site-alpha',
      expect.objectContaining({ type: 'PPE_VIOLATION' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
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

    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert.textContent).toBe('Your session is no longer valid. Sign in again.');
    expect(errorAlert.textContent).not.toContain('Sign-in failed');
    // Authenticated 401 now clears the standalone session and returns to sign-in.
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Safety alerts' })).toBeNull();
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

    await screen.findByRole('heading', { name: 'Safety operations' });

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
    expect(screen.getByRole('heading', { name: 'Safety operations' })).not.toBeNull();
  });
  it('Changing alert pages clears the selected previous-page alert detail', async () => {
    const user = userEvent.setup();
    vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockResolvedValue(
      mockAdminLoginResponse,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    const first = { ...mockAlert, id: 'first', candidateSubtype: 'FIRST_ALERT' };
    const second = { ...mockAlert, id: 'second', candidateSubtype: 'SECOND_ALERT' };
    const pageOne = Array.from({ length: 20 }, (_, i) =>
      i === 0 ? first : { ...mockAlert, id: 'other-' + i, candidateSubtype: 'OTHER_ALERT_' + i },
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockImplementation(
      async (_token, _site, page) => ({ items: page?.offset ? [second] : pageOne, total: 21 }),
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockImplementation(
      async (_token, _site, id) => ({
        ...mockAlertDetail,
        ...(id === 'first' ? first : second),
        detections: [],
        detectionsTotal: 0,
      }),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertsView apiUrl="http://127.0.0.1:3001" />
      </QueryClientProvider>,
    );
    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'Fake123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Alerts' }));
    await user.click(await screen.findByRole('button', { name: /First Alert/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('button', { name: /Second Alert/ });
    expect(await screen.findByText(/Alert second · Revision 1/)).not.toBeNull();
    expect(screen.queryByText(/Alert first · Revision 1/)).toBeNull();
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

      expect(await screen.findByRole('heading', { name: 'Safety operations' })).toBeDefined();
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

      await screen.findByRole('heading', { name: 'Safety operations' });
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

      await screen.findByRole('heading', { name: 'Safety operations' });
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

      await screen.findByRole('heading', { name: 'Safety operations' });
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

      await screen.findByRole('heading', { name: 'Safety operations' });
      // Old scope must be evicted from cache
      expect(
        queryClient.getQueryData(['sites', 'http://127.0.0.1:3001', 'scope-alpha']),
      ).toBeUndefined();
      expect(listSitesSpy).toHaveBeenCalledWith('shared-token-2', expect.any(Object), {
        signal: expect.any(AbortSignal),
      });
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
                id: 'reviewer-1',
                displayName: 'Safety Officer',
                roleAssignments: [
                  { role: 'SAFETY_OFFICER', siteId: 'site-alpha' },
                  { role: 'SAFETY_OFFICER', siteId: 'site-beta' },
                ],
              },
              sessionScope: 'scope-1',
            }}
          />
        </QueryClientProvider>,
      );

      await screen.findByRole('heading', { name: 'Safety operations' });
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
                id: 'reviewer-1',
                displayName: 'Safety Officer',
                roleAssignments: [
                  { role: 'SAFETY_OFFICER', siteId: 'site-alpha' },
                  { role: 'SAFETY_OFFICER', siteId: 'site-beta' },
                ],
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
            actorUserId: 'reviewer-1',
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

    it.each([
      ['Site', 'success'],
      ['Alert', 'success'],
      ['Site', 'conflict'],
      ['Alert', 'conflict'],
      ['Current', 'success'],
      ['Current', 'conflict'],
    ] as const)(
      'same-session stale review %s navigation / %s preserves the new draft and query context',
      async (navigation, outcome) => {
        type ReviewResult = Awaited<ReturnType<SmartSiteManagementClient['reviewSafetyAlert']>>;
        let resolveReview!: (value: ReviewResult) => void;
        let rejectReview!: (error: Error) => void;
        const pendingReview = new Promise<ReviewResult>((resolve, reject) => {
          resolveReview = resolve;
          rejectReview = reject;
        });
        const secondAlert: SafetyAlertResponse = {
          ...mockAlert,
          id: 'alert-2',
          siteId: navigation === 'Site' ? 'site-beta' : mockAlert.siteId,
          candidateSubtype: 'NO_SAFETY_VEST',
        };
        const secondDetail: SafetyAlertDetailResponse = {
          ...mockAlertDetail,
          ...secondAlert,
          detections: [],
          detectionsTotal: 0,
        };
        vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
          items: [
            ...mockSitesList.items,
            {
              id: 'site-beta',
              code: 'SITE-B',
              name: 'Site Beta',
              createdAt: mockSitesList.items[0]!.createdAt,
            },
          ],
          total: 2,
        });
        const listSpy = vi
          .spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts')
          .mockImplementation(async (_token, siteId) => ({
            items:
              navigation === 'Alert'
                ? [mockAlert, secondAlert]
                : siteId === 'site-beta'
                  ? [secondAlert]
                  : [mockAlert],
            total: navigation === 'Alert' ? 2 : 1,
          }));
        const detailSpy = vi
          .spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert')
          .mockImplementation(async (_token, _siteId, alertId) =>
            alertId === secondAlert.id ? secondDetail : mockAlertDetail,
          );
        const reviewSpy = vi
          .spyOn(SmartSiteManagementClient.prototype, 'reviewSafetyAlert')
          .mockImplementation(() => pendingReview);
        const user = userEvent.setup();
        render(
          <QueryClientProvider client={queryClient}>
            <SafetyAlertsView
              apiUrl="http://127.0.0.1:3001"
              sharedSession={{
                accessToken: 'shared-token-1',
                user: {
                  id: 'reviewer-1',
                  displayName: 'Safety Officer',
                  roleAssignments: [
                    { role: 'SAFETY_OFFICER', siteId: 'site-alpha' },
                    { role: 'SAFETY_OFFICER', siteId: 'site-beta' },
                  ],
                },
                sessionScope: 'scope-1',
              }}
            />
          </QueryClientProvider>,
        );
        await screen.findByRole('heading', { name: 'Record review decision' });
        await user.type(
          screen.getByRole('textbox', { name: /Decision reason/i }),
          'First alert review reason',
        );
        await user.click(screen.getByRole('button', { name: 'Confirm violation' }));
        await waitFor(() => expect(reviewSpy).toHaveBeenCalledTimes(1));
        expect(reviewSpy).toHaveBeenCalledWith(
          'shared-token-1',
          mockAlert.siteId,
          mockAlert.id,
          expect.objectContaining({ reason: 'First alert review reason' }),
        );

        if (navigation === 'Site') {
          await user.selectOptions(screen.getByRole('combobox', { name: 'Site' }), 'site-beta');
        } else if (navigation === 'Alert') {
          await user.click(screen.getByRole('button', { name: /No Safety Vest/i }));
        }
        if (navigation !== 'Current') {
          await waitFor(() =>
            expect(detailSpy).toHaveBeenCalledWith(
              'shared-token-1',
              secondAlert.siteId,
              secondAlert.id,
              expect.any(Object),
            ),
          );
          const reason = await screen.findByRole('textbox', { name: /Decision reason/i });
          await user.type(reason, 'Keep this second alert draft');
        }
        listSpy.mockClear();
        detailSpy.mockClear();

        let resolveRefreshedDetail!: (value: SafetyAlertDetailResponse) => void;
        if (navigation === 'Current' && outcome === 'conflict') {
          const refreshingDetail = new Promise<SafetyAlertDetailResponse>((resolve) => {
            resolveRefreshedDetail = resolve;
          });
          detailSpy.mockImplementationOnce(() => refreshingDetail);
        }

        await act(async () => {
          if (outcome === 'conflict') {
            rejectReview(new ApiError('http', 'Review conflict', 409));
          } else {
            resolveReview({
              alert: { ...mockAlert, status: 'CONFIRMED' },
              review: {
                id: 'rev-1',
                alertId: mockAlert.id,
                siteId: mockAlert.siteId,
                actorUserId: 'reviewer-1',
                fromStatus: 'PENDING_REVIEW',
                toStatus: 'CONFIRMED',
                reason: 'First alert review reason',
                alertRevision: 1,
                createdAt: '2026-10-01T00:00:00Z',
              },
              replayed: false,
            });
          }
        });

        if (navigation === 'Current') {
          if (outcome === 'conflict') {
            await waitFor(() => expect(detailSpy).toHaveBeenCalledTimes(1));
            // TanStack awaits onError's invalidations: the old revision cannot be
            // resubmitted while this controlled refresh is still pending.
            expect(
              (screen.getByRole('button', { name: 'Confirm violation' }) as HTMLButtonElement)
                .disabled,
            ).toBe(true);
            await act(async () => {
              resolveRefreshedDetail({ ...mockAlertDetail, revision: 2 });
            });
          }
          expect(detailSpy).toHaveBeenCalledWith(
            'shared-token-1',
            mockAlert.siteId,
            mockAlert.id,
            expect.any(Object),
          );
          expect(listSpy).toHaveBeenCalledWith(
            'shared-token-1',
            mockAlert.siteId,
            expect.any(Object),
            expect.any(Object),
          );
          expect(
            (screen.getByRole('textbox', { name: /Decision reason/i }) as HTMLTextAreaElement)
              .value,
          ).toBe(outcome === 'success' ? '' : 'First alert review reason');
          if (outcome === 'success') {
            expect(screen.getByText(/Review decision recorded\./i)).toBeDefined();
          } else {
            expect(
              await screen.findByText(/This alert changed while you were reviewing it/i),
            ).toBeDefined();
          }
          return;
        }
        expect(
          (screen.getByRole('textbox', { name: /Decision reason/i }) as HTMLTextAreaElement).value,
        ).toBe('Keep this second alert draft');
        expect(screen.queryByText(/Review decision recorded\./i)).toBeNull();
        expect(
          (screen.getByRole('button', { name: 'Confirm violation' }) as HTMLButtonElement).disabled,
        ).toBe(false);
        expect(
          detailSpy.mock.calls.some(
            ([, siteId, alertId]) => siteId === secondAlert.siteId && alertId === secondAlert.id,
          ),
        ).toBe(false);
        if (navigation === 'Site') {
          expect(listSpy.mock.calls.some(([, siteId]) => siteId === secondAlert.siteId)).toBe(
            false,
          );
        }
      },
    );

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

    it('displays contextual notice for ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE explaining unknown identity does not establish unauthorized entry', async () => {
      const unavailableZoneAlert: SafetyAlertResponse = {
        ...mockAlert,
        id: 'alert-zone-unavail-1',
        alertType: 'RESTRICTED_ZONE_INTRUSION',
        candidateSubtype: 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE',
      };
      const unavailableZoneAlertDetail: SafetyAlertDetailResponse = {
        ...mockAlertDetail,
        id: 'alert-zone-unavail-1',
        alertType: 'RESTRICTED_ZONE_INTRUSION',
        candidateSubtype: 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE',
      };

      vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockResolvedValue({
        items: [unavailableZoneAlert],
        total: 1,
      });
      vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockResolvedValue(
        unavailableZoneAlertDetail,
      );

      render(
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView
            apiUrl="http://localhost:3000"
            sharedSession={{
              accessToken: 'mock-so-token',
              user: {
                id: 'user-so-1',
                displayName: 'Cán bộ An toàn Alpha',
                roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
              },
              sessionScope: 'scope-so-1',
              onSignOut: vi.fn(),
            }}
          />
        </QueryClientProvider>,
      );

      expect(
        await screen.findByText(
          /Cannot verify authorization; unknown identity does not establish unauthorized entry, retrospective manual review does not grant live access\./i,
        ),
      ).toBeDefined();
    });

    it('confirming selected PENDING_REVIEW alert preserves detail and review history when alert leaves filtered list', async () => {
      let resolveReview!: (value: unknown) => void;
      const pendingReview = new Promise((resolve) => {
        resolveReview = resolve;
      });

      const confirmedAlertDetail: SafetyAlertDetailResponse = {
        ...mockAlertDetail,
        status: 'CONFIRMED',
        revision: 2,
        reviewsTotal: 1,
        reviews: [
          {
            id: 'rev-101',
            alertId: mockAlert.id,
            siteId: mockAlert.siteId,
            actorUserId: 'reviewer-1',
            fromStatus: 'PENDING_REVIEW',
            toStatus: 'CONFIRMED',
            reason: 'Confirmed violation observed on CAM-01',
            alertRevision: 1,
            createdAt: '2026-10-01T01:00:00Z',
          },
        ],
      };

      vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);

      let listCallCount = 0;
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockImplementation(
        async () => {
          listCallCount++;
          if (listCallCount === 1) {
            return { items: [mockAlert], total: 1 };
          }
          return { items: [], total: 0 };
        },
      );

      vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockImplementation(
        async () => {
          if (listCallCount > 1) {
            return confirmedAlertDetail;
          }
          return mockAlertDetail;
        },
      );

      vi.spyOn(SmartSiteManagementClient.prototype, 'reviewSafetyAlert').mockImplementation(
        () => pendingReview as never,
      );

      const user = userEvent.setup();
      render(
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView
            apiUrl="http://127.0.0.1:3001"
            initialStatus="PENDING_REVIEW"
            sharedSession={{
              accessToken: 'shared-token-1',
              user: {
                id: 'reviewer-1',
                displayName: 'Safety Officer',
                roleAssignments: [
                  { role: 'SAFETY_OFFICER', siteId: 'site-alpha' },
                  { role: 'SAFETY_OFFICER', siteId: 'site-beta' },
                ],
              },
              sessionScope: 'scope-1',
            }}
          />
        </QueryClientProvider>,
      );

      await screen.findByRole('heading', { name: 'Record review decision' });
      expect(screen.getByText('Alert queue')).toBeDefined();

      await user.type(
        screen.getByRole('textbox', { name: /Decision reason/i }),
        'Confirmed violation observed on CAM-01',
      );
      await user.click(screen.getByRole('button', { name: 'Confirm violation' }));

      await act(async () => {
        resolveReview({
          alert: { ...mockAlert, status: 'CONFIRMED', revision: 2 },
          review: confirmedAlertDetail.reviews[0],
          replayed: false,
        });
      });

      await screen.findByText(/No alerts match the selected Site and filters\./i);

      expect(screen.queryByText('Select an alert to inspect its sources.')).toBeNull();
      await screen.findByText('Confirmed violation observed on CAM-01');
      expect(screen.getByText(/Review history \(1\)/i)).toBeDefined();
    });

    it('switching Alert during pending review prevents stale retention of the reviewed alert', async () => {
      let resolveReview!: (value: unknown) => void;
      const pendingReview = new Promise((resolve) => {
        resolveReview = resolve;
      });

      const secondAlert: SafetyAlertResponse = {
        ...mockAlert,
        id: 'alert-2',
        candidateSubtype: 'NO_SAFETY_VEST',
      };
      const secondDetail: SafetyAlertDetailResponse = {
        ...mockAlertDetail,
        id: 'alert-2',
        candidateSubtype: 'NO_SAFETY_VEST',
      };

      vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockResolvedValue({
        items: [mockAlert, secondAlert],
        total: 2,
      });
      vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockImplementation(
        async (...args) => {
          const alertId = args[2];
          return alertId === 'alert-2' ? secondDetail : mockAlertDetail;
        },
      );
      vi.spyOn(SmartSiteManagementClient.prototype, 'reviewSafetyAlert').mockImplementation(
        () => pendingReview as never,
      );

      const user = userEvent.setup();
      render(
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView
            apiUrl="http://127.0.0.1:3001"
            sharedSession={{
              accessToken: 'shared-token-1',
              user: {
                id: 'reviewer-1',
                displayName: 'Safety Officer',
                roleAssignments: [
                  { role: 'SAFETY_OFFICER', siteId: 'site-alpha' },
                  { role: 'SAFETY_OFFICER', siteId: 'site-beta' },
                ],
              },
              sessionScope: 'scope-1',
            }}
          />
        </QueryClientProvider>,
      );

      await screen.findByRole('heading', { name: 'Record review decision' });
      await user.type(
        screen.getByRole('textbox', { name: /Decision reason/i }),
        'Reason for alert 1',
      );
      await user.click(screen.getByRole('button', { name: 'Confirm violation' }));

      // While review of alert-1 is pending, switch to alert-2
      await user.click(screen.getByRole('button', { name: /No Safety Vest/i }));

      // Now resolve the review for alert-1
      await act(async () => {
        resolveReview({
          alert: { ...mockAlert, status: 'CONFIRMED', revision: 2 },
          review: {
            id: 'rev-1',
            alertId: mockAlert.id,
            siteId: mockAlert.siteId,
            actorUserId: 'reviewer-1',
            fromStatus: 'PENDING_REVIEW',
            toStatus: 'CONFIRMED',
            reason: 'Reason for alert 1',
            alertRevision: 1,
            createdAt: '2026-10-01T00:00:00Z',
          },
          replayed: false,
        });
      });

      // Assert that alert-2 remains selected, no stale review success feedback for alert-1 is shown
      expect(screen.queryByText(/Review decision recorded\./i)).toBeNull();
    });
  });

  describe('formatCandidateSubtype', () => {
    it('formats candidate subtypes cleanly for expanded PPE and zone entries', () => {
      expect(formatCandidateSubtype('PPE_HARD_HAT_MISSING')).toBe('Missing Hard Hat');
      expect(formatCandidateSubtype('PPE_SAFETY_VEST_MISSING')).toBe('Missing Safety Vest');
      expect(formatCandidateSubtype('PPE_GLOVES_MISSING')).toBe('Missing Gloves');
      expect(formatCandidateSubtype('PPE_BOOTS_MISSING')).toBe('Missing Boots');
      expect(formatCandidateSubtype('PPE_GOGGLES_MISSING')).toBe('Missing Goggles');
      expect(formatCandidateSubtype('RESTRICTED_ZONE_INTRUSION')).toBe('Restricted Zone Intrusion');
      expect(formatCandidateSubtype('ZONE_ENTRY_VIOLATION')).toBe('Zone Entry Violation');
      expect(formatCandidateSubtype('ZONE_ENTRY_UNAUTHORIZED')).toBe('Unauthorized Zone Entry');
      expect(formatCandidateSubtype('ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE')).toBe(
        'Authorization Unavailable',
      );
    });
  });
  describe('SafetyAlertsView Notification Deep-Link Integration', () => {
    it('shows an unavailable target instead of falling back to another Site for an unknown or denied alert link', async () => {
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
        items: [
          ...mockSitesList.items,
          {
            id: 'site-beta',
            code: 'SITE-B',
            name: 'Contractor-only Site',
            createdAt: '2026-09-30T00:00:00Z',
          },
        ],
        total: 2,
      });
      const alerts = vi
        .spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts')
        .mockResolvedValue({ items: [mockAlert], total: 1 });
      const detail = vi
        .spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert')
        .mockResolvedValue(mockAlertDetail);
      const session: LoginResponse = {
        ...mockSafetyOfficerLoginResponse,
        user: {
          ...mockSafetyOfficerLoginResponse.user,
          roleAssignments: [
            ...mockSafetyOfficerLoginResponse.user.roleAssignments,
            { role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-beta' },
          ],
        },
      };

      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView
            apiUrl="http://127.0.0.1:3001"
            authenticatedSession={session}
            initialSiteId="site-unauthorized"
            initialAlertId="alert-unauthorized"
          />
        </QueryClientProvider>,
      );

      expect((await screen.findByRole('alert')).textContent).toContain('no longer have access');
      expect(alerts).not.toHaveBeenCalled();
      expect(detail).not.toHaveBeenCalled();
      expect((screen.getByLabelText('Site') as HTMLSelectElement).value).toBe('');

      // Also verify denied Site where the user only holds CONTRACTOR_REPRESENTATIVE
      rerender(
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView
            apiUrl="http://127.0.0.1:3001"
            authenticatedSession={session}
            initialSiteId="site-beta"
            initialAlertId="alert-on-contractor-site"
          />
        </QueryClientProvider>,
      );

      expect((await screen.findByRole('alert')).textContent).toContain('no longer have access');
      expect(alerts).not.toHaveBeenCalled();
      expect(detail).not.toHaveBeenCalled();
      expect((screen.getByLabelText('Site') as HTMLSelectElement).value).toBe('');
    });

    it('loads authorized notification target detail even when the target alert is not on page 1', async () => {
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockResolvedValue({
        items: [mockAlert],
        total: 25,
      });
      const detail = vi
        .spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert')
        .mockImplementation(async (_token, siteId, id) => ({
          ...mockAlertDetail,
          siteId,
          id,
          candidateSubtype: 'PPE_GOGGLES_MISSING',
          detections: [],
          detectionsTotal: 0,
        }));

      render(
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView
            apiUrl="http://127.0.0.1:3001"
            authenticatedSession={mockSafetyOfficerLoginResponse}
            initialSiteId="site-alpha"
            initialAlertId="alert-off-page-1"
          />
        </QueryClientProvider>,
      );

      expect(await screen.findByText(/Alert alert-off-page-1 · Revision 1/)).not.toBeNull();
      expect(
        screen.getByRole('complementary', { name: 'Alert detail' }).className.split(/\s+/),
      ).not.toContain('hidden');
      expect(detail).toHaveBeenCalledWith(
        mockSafetyOfficerLoginResponse.accessToken,
        'site-alpha',
        'alert-off-page-1',
        expect.any(Object),
      );
      expect(detail.mock.calls.some((call) => call[2] === mockAlert.id)).toBe(false);
    });

    it('updates target and clears incompatible review draft, command, and offset when initialSiteId and initialAlertId change while mounted', async () => {
      const user = userEvent.setup();
      const session: LoginResponse = {
        ...mockSafetyOfficerLoginResponse,
        user: {
          ...mockSafetyOfficerLoginResponse.user,
          roleAssignments: [
            { role: 'SAFETY_OFFICER', siteId: 'site-alpha' },
            { role: 'SAFETY_OFFICER', siteId: 'site-beta' },
          ],
        },
      };
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
        items: [
          ...mockSitesList.items,
          {
            id: 'site-beta',
            code: 'SITE-B',
            name: 'Site Beta',
            createdAt: '2026-09-30T00:00:00Z',
          },
        ],
        total: 2,
      });
      const pageOne = Array.from({ length: 20 }, (_, index) => ({
        ...mockAlert,
        id: index === 0 ? 'alert-1' : `other-${index}`,
      }));
      const listAlerts = vi
        .spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts')
        .mockImplementation(async (_token, siteId, page) => ({
          items:
            siteId === 'site-alpha'
              ? page?.offset
                ? [{ ...mockAlert, id: 'alpha-page-2' }]
                : pageOne
              : [{ ...mockAlert, id: 'beta-first', siteId: 'site-beta' }],
          total: siteId === 'site-alpha' ? 21 : 1,
        }));
      const detail = vi
        .spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert')
        .mockImplementation(async (_token, siteId, id) => ({
          ...mockAlertDetail,
          siteId,
          id,
          detections: [],
          detectionsTotal: 0,
        }));
      const review = vi
        .spyOn(SmartSiteManagementClient.prototype, 'reviewSafetyAlert')
        .mockRejectedValue(new ApiError('network', 'Synthetic transient network error'));

      const tree = (siteId?: string, alertId?: string) => (
        <QueryClientProvider client={queryClient}>
          <SafetyAlertsView
            apiUrl="http://127.0.0.1:3001"
            authenticatedSession={session}
            initialSiteId={siteId}
            initialAlertId={alertId}
          />
        </QueryClientProvider>
      );

      const view = render(tree('site-alpha', 'target-a'));
      await screen.findByText(/Alert target-a · Revision 1/);

      // Move to page 2 on site-alpha, then type a draft and trigger a review command on alpha-page-2
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByText(/Alert alpha-page-2 · Revision 1/);
      const reasonText = 'Shared review reason text across targets.';
      await user.type(await screen.findByRole('textbox', { name: /Decision reason/i }), reasonText);
      await user.click(screen.getByRole('button', { name: 'Confirm violation' }));
      await waitFor(() => expect(review).toHaveBeenCalledTimes(1));
      const firstCommandId = review.mock.calls[0]![3].commandId;

      // Navigate via notification deep-link to (site-beta, target-b) while mounted
      view.rerender(tree('site-beta', 'target-b'));

      expect(await screen.findByText(/Alert target-b · Revision 1/)).not.toBeNull();
      expect(screen.queryByText(/Alert alpha-page-2 · Revision 1/)).toBeNull();
      expect(detail.mock.calls.at(-1)?.slice(1, 3)).toEqual(['site-beta', 'target-b']);
      expect(
        listAlerts.mock.calls.some(
          ([, siteId, params]) => siteId === 'site-beta' && params?.offset === 0,
        ),
      ).toBe(true);

      const newReasonInput = (await screen.findByRole('textbox', {
        name: /Decision reason/i,
      })) as HTMLTextAreaElement;
      expect(newReasonInput.value).toBe('');

      await user.type(newReasonInput, reasonText);
      await user.click(screen.getByRole('button', { name: 'Confirm violation' }));
      await waitFor(() => expect(review).toHaveBeenCalledTimes(2));
      expect(review.mock.calls[1]![1]).toBe('site-beta');
      expect(review.mock.calls[1]![2]).toBe('target-b');
      expect(review.mock.calls[1]![3].commandId).not.toBe(firstCommandId);
    });
  });

});
