// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  SmartSiteManagementClient,
  type CameraResponse,
  type SafetyIdentificationRequest,
} from '@smartsite/api-client';
import i18n from '../../i18n';
import { ManagerSafetyTaskPanel } from './ManagerSafetyTaskPanel';

interface MockSessionState {
  accessToken: string | null;
  user: {
    id: string;
    isActive?: boolean;
    mustChangePassword?: boolean;
    roleAssignments: {
      role: 'SITE_MANAGER' | 'SAFETY_OFFICER' | 'WORKER';
      siteId: string | null;
    }[];
  } | null;
}

const sessionState: MockSessionState = {
  accessToken: 'manager-token-1',
  user: {
    id: 'manager-1',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [
      { role: 'SITE_MANAGER', siteId: 'site-a' },
      { role: 'SITE_MANAGER', siteId: 'site-b' },
    ],
  },
};

vi.mock('../../features/auth/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/auth/auth-session')>()),
  useAuth: () => ({ accessToken: sessionState.accessToken }),
  useCurrentUser: () => ({ data: sessionState.user }),
}));

function makeOpenRequest(
  overrides: Partial<SafetyIdentificationRequest> = {},
): SafetyIdentificationRequest {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    siteId: 'site-a',
    episodeId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    subject: {
      kind: 'TRACKED',
      segmentId: 'seg-1',
      scopeSha256: 'a'.repeat(64),
    },
    assignedTo: 'manager-1',
    requestedBy: 'officer-1',
    reason: 'Confirm helmet finding near North Crane',
    status: 'OPEN',
    version: 1,
    dueAt: '2026-11-18T09:00:00Z',
    evidenceRefs: ['ev-1'],
    evidenceAvailability: { status: 'AVAILABLE', reason: null },
    result: null,
    createdAt: '2026-11-17T01:00:00Z',
    updatedAt: '2026-11-17T01:00:00Z',
    ...overrides,
  };
}

function makeCamera(overrides: Partial<CameraResponse> = {}): CameraResponse {
  return {
    type: 'ZONE' as const,
    gateId: null,
    id: 'cam-1',
    siteId: 'site-a',
    externalId: 'rtsp-cam-01',
    code: 'CAM-01',
    name: 'North Gate Camera',
    status: 'ACTIVE',
    configurationVersion: 2,
    createdAt: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="router-location">{`${location.pathname}${location.search}`}</output>;
}

function renderPanelWithRouter(props: {
  siteId: string;
  siteName?: string;
  enableIdentification?: boolean;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route
            path="/dashboard"
            element={
              <ManagerSafetyTaskPanel
                apiUrl="https://api.example.test"
                siteId={props.siteId}
                siteName={props.siteName}
                enableIdentification={props.enableIdentification}
              />
            }
          />
          <Route path="/incidents" element={<LocationProbe />} />
          <Route path="/camera-setup" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  sessionState.accessToken = 'manager-token-1';
  sessionState.user = {
    id: 'manager-1',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [
      { role: 'SITE_MANAGER', siteId: 'site-a' },
      { role: 'SITE_MANAGER', siteId: 'site-b' },
    ],
  };
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

describe('ManagerSafetyTaskPanel', () => {
  it('shows server OPEN C02 requests and configured cameras, preserves siteId in router links, and hides raw UUIDs/live media', async () => {
    const c02Spy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listSafetyIdentificationRequests')
      .mockResolvedValue({
        items: [
          makeOpenRequest(),
          makeOpenRequest({
            id: '22222222-3333-4444-5555-666666666666',
            reason: 'Verify restricted zone entry near East Hoist',
            dueAt: null,
          }),
        ],
        total: 3,
      });
    const camerasSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listCameras')
      .mockResolvedValue({
        items: [makeCamera()],
        total: 2,
      });
    const previewSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras');

    const { container, queryClient } = renderPanelWithRouter({
      siteId: 'site-a',
      siteName: 'Site Alpha',
    });

    await screen.findByText('Confirm helmet finding near North Crane');
    expect(screen.getByText('Verify restricted zone entry near East Hoist')).toBeTruthy();
    expect(screen.getByText(/3 open requests/i)).toBeTruthy();
    expect(screen.getByText(/2 configured cameras/i)).toBeTruthy();

    expect(c02Spy).toHaveBeenCalledWith(
      'manager-token-1',
      'site-a',
      { status: 'OPEN', offset: 0, limit: 5 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(camerasSpy).toHaveBeenCalledWith(
      'manager-token-1',
      'site-a',
      { offset: 0, limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(previewSpy).not.toHaveBeenCalled();
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img')).toBeNull();

    // Any technical UUID must live strictly inside collapsed <details>, never exposed in primary copy
    const uuidMatches = screen.queryAllByText(/11111111-2222-3333-4444-555555555555/);
    for (const node of uuidMatches) {
      expect(node.closest('details')).not.toBeNull();
    }

    const queueLink = screen.getByRole('link', { name: /Open identification queue/i });
    expect(queueLink.getAttribute('href')).toBe('/incidents?tab=identification&siteId=site-a');

    const cameraLink = screen.getByRole('link', { name: /Open Camera & Zone Setup/i });
    expect(cameraLink.getAttribute('href')).toBe('/camera-setup?siteId=site-a');

    await userEvent.setup().click(queueLink);
    expect(screen.getByTestId('router-location').textContent).toBe(
      '/incidents?tab=identification&siteId=site-a',
    );
    queryClient.clear();
  });

  it('surfaces a truthful empty-camera setup prompt when total is 0 and navigates to /camera-setup?siteId=<siteId>', async () => {
    vi.spyOn(
      SmartSiteManagementClient.prototype,
      'listSafetyIdentificationRequests',
    ).mockResolvedValue({
      items: [],
      total: 0,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({
      items: [],
      total: 0,
    });

    const { queryClient } = renderPanelWithRouter({ siteId: 'site-a', siteName: 'Site Alpha' });

    await screen.findByText(/No cameras are registered for this site yet/i);
    expect(screen.getByText(/live video and active monitoring are not shown here/i)).toBeTruthy();
    expect(screen.getByText(/No open identification requests/i)).toBeTruthy();

    // Even when 200 empty, Manager can still open the scoped identification workspace for history
    expect(
      screen.getByRole('link', { name: /Open identification queue/i }).getAttribute('href'),
    ).toBe('/incidents?tab=identification&siteId=site-a');

    const setupLink = screen.getByRole('link', { name: /Set up site cameras/i });
    expect(setupLink.getAttribute('href')).toBe('/camera-setup?siteId=site-a');

    await userEvent.setup().click(setupLink);
    expect(screen.getByTestId('router-location').textContent).toBe('/camera-setup?siteId=site-a');
    queryClient.clear();
  });

  it('separates C02 route-disabled, 404 feature unavailable, 503 temporarily unavailable (with retry), 401 expired, 403 denied, and 500 retriable errors', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({
      items: [makeCamera({ status: 'INACTIVE' })],
      total: 1,
    });

    // 1. Route helper disabled -> zero C02 HTTP calls, no queue link
    const c02Spy = vi.spyOn(
      SmartSiteManagementClient.prototype,
      'listSafetyIdentificationRequests',
    );
    const disabledRender = renderPanelWithRouter({
      siteId: 'site-a',
      enableIdentification: false,
    });
    await screen.findByText(/Identification workspace is unavailable/i);
    expect(c02Spy).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: /Open identification queue/i })).toBeNull();
    // Inactive configured camera note is also truthful
    await screen.findByText(/Registered cameras on this site are currently inactive/i);
    disabledRender.queryClient.clear();
    cleanup();

    // 2. 404 -> Plain unavailable notice (no HTTP 404 code, does NOT claim server disabled, no retry, not 0)
    c02Spy.mockRejectedValueOnce(new ApiError('http', 'Not Found', 404));
    const notFoundRender = renderPanelWithRouter({ siteId: 'site-a' });
    await screen.findByText(/Identification requests are unavailable right now/i);
    expect(notFoundRender.container.textContent).not.toMatch(
      /\b404\b|disabled|not enabled on this server/i,
    );
    expect(screen.queryByRole('button', { name: /Retry identification queue/i })).toBeNull();
    expect(screen.queryByText(/0 open requests/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /Open identification queue/i })).toBeNull();
    notFoundRender.queryClient.clear();
    cleanup();

    // 3. 503 -> Plain temporary interruption notice (no HTTP 503 code) + working Retry
    c02Spy
      .mockRejectedValueOnce(new ApiError('http', 'Service Unavailable', 503))
      .mockResolvedValueOnce({ items: [makeOpenRequest()], total: 1 });
    const unavailableRender = renderPanelWithRouter({ siteId: 'site-a' });
    await screen.findByText(/temporarily unavailable/i);
    expect(screen.getByText(/temporary interruption\. Please retry in a moment/i)).toBeTruthy();
    expect(unavailableRender.container.textContent).not.toMatch(/\b503\b/);
    expect(screen.queryByText(/0 open requests/i)).toBeNull();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /Retry identification queue/i }));
    await screen.findByText('Confirm helmet finding near North Crane');
    unavailableRender.queryClient.clear();
    cleanup();

    // 4. 401 -> Session expired (fail closed, no retry, no queue link)
    c02Spy.mockRejectedValueOnce(new ApiError('http', 'Unauthorized', 401));
    const expiredRender = renderPanelWithRouter({ siteId: 'site-a' });
    await screen.findByText(/Session expired/i);
    expect(screen.queryByRole('button', { name: /Retry identification queue/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /Open identification queue/i })).toBeNull();
    expiredRender.queryClient.clear();
    cleanup();

    // 5. 403 -> Access denied for site (fail closed, no retry, no 0 count)
    c02Spy.mockRejectedValueOnce(new ApiError('http', 'Forbidden', 403));
    const deniedRender = renderPanelWithRouter({ siteId: 'site-a' });
    await screen.findByText(/Access to identification requests is denied for this site/i);
    expect(screen.queryByRole('button', { name: /Retry identification queue/i })).toBeNull();
    expect(screen.queryByText(/0 open requests/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /Open identification queue/i })).toBeNull();
    deniedRender.queryClient.clear();
    cleanup();

    // 6. 500 -> Retriable error + working Retry
    c02Spy
      .mockRejectedValueOnce(new ApiError('http', 'Internal Server Error', 500))
      .mockResolvedValueOnce({ items: [], total: 0 });
    const serverErrorRender = renderPanelWithRouter({ siteId: 'site-a' });
    await screen.findByText(/Could not load open identification requests/i);
    expect(screen.queryByText(/0 open requests/i)).toBeNull();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /Retry identification queue/i }));
    await screen.findByText(/No open identification requests/i);
    serverErrorRender.queryClient.clear();
  });

  it('prevents cross-site and cross-session stale queue/counts during transitions and omits raw tokens from query keys', async () => {
    const staleSiteA = createDeferred<{ items: SafetyIdentificationRequest[]; total: number }>();
    const siteBLate = createDeferred<{ items: SafetyIdentificationRequest[]; total: number }>();
    let siteACalls = 0;
    let siteASignal: AbortSignal | undefined;

    const c02Spy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listSafetyIdentificationRequests')
      .mockImplementation((_token, requestedSiteId, _query, requestOptions) => {
        if (requestedSiteId === 'site-a') {
          siteASignal = requestOptions?.signal;
          siteACalls += 1;
          if (siteACalls === 1) {
            return staleSiteA.promise;
          }
          return Promise.resolve({
            items: [makeOpenRequest({ siteId: 'site-a', reason: 'Site A Request' })],
            total: 4,
          });
        }
        return siteBLate.promise;
      });

    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockImplementation(
      async (_token, requestedSiteId) => ({
        items: [makeCamera({ siteId: requestedSiteId })],
        total: 1,
      }),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ManagerSafetyTaskPanel apiUrl="https://api.example.test" siteId="site-a" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(c02Spy).toHaveBeenCalledTimes(1));

    // Switch to site-b BEFORE site-a's first slow response resolves
    rerender(
      <QueryClientProvider client={queryClient}>
        <ManagerSafetyTaskPanel apiUrl="https://api.example.test" siteId="site-b" />
      </QueryClientProvider>,
    );

    expect(siteASignal?.aborted).toBe(true);
    // Late resolution for site-a must never appear under site-b
    staleSiteA.resolve({
      items: [makeOpenRequest({ siteId: 'site-a', reason: 'Stale Site A Leak' })],
      total: 9,
    });
    await waitFor(() => expect(c02Spy).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Stale Site A Leak')).toBeNull();
    expect(screen.queryByText(/9 open requests/i)).toBeNull();
    expect(
      screen.getByRole('link', { name: /Open Camera & Zone Setup/i }).getAttribute('href'),
    ).toBe('/camera-setup?siteId=site-b');

    siteBLate.resolve({
      items: [makeOpenRequest({ siteId: 'site-b', reason: 'Site B Fresh Request' })],
      total: 1,
    });
    await screen.findByText('Site B Fresh Request');
    expect(screen.getByText(/1 open request/i)).toBeTruthy();

    // Now switch user/token session -> site-b previous user's items must immediately clear while new user loads
    const nextSession = createDeferred<{ items: SafetyIdentificationRequest[]; total: number }>();
    c02Spy.mockImplementationOnce(() => nextSession.promise);
    sessionState.accessToken = 'manager-token-2-secret';
    sessionState.user = {
      id: 'manager-2',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'site-b' }],
    };

    rerender(
      <QueryClientProvider client={queryClient}>
        <ManagerSafetyTaskPanel apiUrl="https://api.example.test" siteId="site-b" />
      </QueryClientProvider>,
    );

    expect(screen.queryByText('Site B Fresh Request')).toBeNull();
    expect(screen.queryByText(/1 open request/i)).toBeNull();

    for (const query of queryClient.getQueryCache().getAll()) {
      expect(JSON.stringify(query.queryKey)).not.toContain('manager-token-2-secret');
      expect(JSON.stringify(query.queryKey)).not.toContain('manager-token-1');
    }

    nextSession.resolve({ items: [], total: 0 });
    await screen.findByText(/No open identification requests/i);
    queryClient.clear();
  });

  it('supports concise Vietnamese localization, fails closed on unassigned sites, and keeps 390px-safe wrapping classes', async () => {
    await i18n.changeLanguage('vi');
    const c02Spy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listSafetyIdentificationRequests')
      .mockRejectedValueOnce(new ApiError('http', 'Service Unavailable', 503));
    const camerasSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listCameras')
      .mockRejectedValueOnce(new ApiError('http', 'Gateway Error', 502))
      .mockResolvedValueOnce({ items: [], total: 0 });

    // Unassigned site -> zero calls
    const unassignedRender = renderPanelWithRouter({ siteId: 'site-unassigned' });
    expect(c02Spy).not.toHaveBeenCalled();
    expect(camerasSpy).not.toHaveBeenCalled();
    unassignedRender.queryClient.clear();
    cleanup();

    // Assigned site in VI -> 503 temporary outage + camera check error (never reporting 0 cameras on error)
    const viRender = renderPanelWithRouter({ siteId: 'site-a' });
    const section = await screen.findByRole('region', { name: /Tác vụ vận hành công trường/i });
    expect(section.className).toContain('min-w-0');
    await within(section).findByText(/tạm thời gián đoạn/i);
    expect(within(section).getByText(/Sự cố chỉ mang tính tạm thời/i)).toBeTruthy();
    expect(section.textContent).not.toMatch(/\b503\b/);

    // Camera error never claims 0 cameras; retry loads truthful empty prompt in VI
    await within(section).findByText(/Không thể kiểm tra thiết lập camera/i);
    expect(within(section).queryByText(/Chưa có camera nào được đăng ký/i)).toBeNull();
    await userEvent
      .setup()
      .click(within(section).getByRole('button', { name: /Thử lại kiểm tra camera/i }));
    await within(section).findByText(/Chưa có camera nào được đăng ký/i);
    viRender.queryClient.clear();
  });

  it('loads cleanly under React StrictMode and refreshes OPEN queue on focus and 30s foreground interval while respecting denied guards', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const c02Spy = vi
        .spyOn(SmartSiteManagementClient.prototype, 'listSafetyIdentificationRequests')
        .mockResolvedValueOnce({ items: [], total: 0 })
        .mockResolvedValueOnce({
          items: [makeOpenRequest({ reason: 'Arrived on window focus' })],
          total: 1,
        })
        .mockResolvedValueOnce({
          items: [
            makeOpenRequest({ reason: 'Arrived on window focus' }),
            makeOpenRequest({
              id: '33333333-4444-5555-6666-777777777777',
              reason: 'Arrived on 30s foreground poll',
            }),
          ],
          total: 2,
        })
        .mockRejectedValueOnce(new ApiError('http', 'Forbidden', 403));

      vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({
        items: [makeCamera()],
        total: 1,
      });

      // Mirror main.tsx QueryClient defaults (staleTime: 30_000) inside React <StrictMode>
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
      });

      render(
        <StrictMode>
          <QueryClientProvider client={queryClient}>
            <ManagerSafetyTaskPanel apiUrl="https://api.example.test" siteId="site-a" />
          </QueryClientProvider>
        </StrictMode>,
      );

      // 1. StrictMode mount completes loading cleanly without sticking in loading state
      await screen.findByText(/No open identification requests/i);
      expect(c02Spy).toHaveBeenCalledTimes(1);

      // 2. Window focus refreshes OPEN queue even within global staleTime window
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await screen.findByText('Arrived on window focus');
      expect(screen.getByText(/1 open request/i)).toBeTruthy();

      // 3. Foreground 30s interval refreshes OPEN queue while page stays open
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      await screen.findByText('Arrived on 30s foreground poll');
      expect(screen.getByText(/2 open requests/i)).toBeTruthy();

      // 4. Next 30s poll hits 403 denied -> stops further interval & focus polling
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      await screen.findByText(/Access to identification requests is denied for this site/i);
      const callsAfterDenial = c02Spy.mock.calls.length;

      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(c02Spy).toHaveBeenCalledTimes(callsAfterDenial);

      queryClient.clear();
    } finally {
      focusManager.setFocused(undefined);
      vi.useRealTimers();
    }
  });
});
