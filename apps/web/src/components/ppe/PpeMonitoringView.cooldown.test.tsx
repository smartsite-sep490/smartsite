// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient, ApiError } from '@smartsite/api-client';
import type {
  Page,
  SiteResponse,
  CameraPreviewResponse,
  AccountResponse,
} from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import { PpeMonitoringView } from './PpeMonitoringView';
import { AuthContext } from '../../features/auth/auth-session';
import type { SharedSession } from '../../types/shared-session';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

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

const mockCamerasList: Page<CameraResponse> = {
  items: [
    {
      id: 'cam-1',
      siteId: 'site-alpha',
      externalId: 'CAM-01',
      code: 'CAM-01',
      name: 'Camera 01',
      status: 'ACTIVE',
      configurationVersion: 1,
      createdAt: '2026-09-30T00:00:00Z',
    },
    {
      id: 'cam-2',
      siteId: 'site-alpha',
      externalId: 'CAM-02',
      code: 'CAM-02',
      name: 'Camera 02',
      status: 'ACTIVE',
      configurationVersion: 1,
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 2,
};

const mockAdminAccount: AccountResponse = {
  id: 'user-admin',
  username: 'admin',
  displayName: 'Admin User',
  isActive: true,
  mustChangePassword: false,
  roleAssignments: [{ role: 'ADMIN', siteId: null }],
};

const createAdminSession = (
  accessToken = 'token-admin-valid',
  sessionScope = 'scope-admin-valid',
): SharedSession => ({
  accessToken,
  sessionScope,
  user: {
    id: 'user-admin',
    username: 'admin',
    displayName: 'Admin User',
    roleAssignments: [{ role: 'ADMIN', siteId: null }],
  },
});

const createFakePreviewResponse = (
  siteId = 'site-alpha',
  cameraId = 'cam-1',
  cameraExternalId = 'CAM-01',
): CameraPreviewResponse => ({
  siteId,
  cameraId,
  cameraExternalId,
  sourceKind: 'LIVE',
  frame: {
    type: 'frame',
    previewVersion: 1,
    cameraExternalId,
    sessionId: '00000000-0000-4000-8000-000000000001',
    sequenceNumber: '1',
    capturedAt: new Date().toISOString(),
    width: 640,
    height: 480,
    imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    detections: [],
    zoneDetections: [],
    zonePolygons: [],
  },
});

describe('PpeMonitoringView 429 Cooldown & Retry Regression Audit', () => {
  let queryClient: QueryClient;
  const originalImage = globalThis.Image;

  beforeEach(() => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
    class MockImage {
      src = '';
      naturalWidth = 640;
      naturalHeight = 480;
      decode() {
        return Promise.resolve();
      }
    }
    globalThis.Image = MockImage as unknown as typeof Image;

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
      mockCamerasList,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'me').mockResolvedValue(mockAdminAccount);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    globalThis.Image = originalImage;
  });

  it('proves UI regression: Retry Snapshot button must not be actionable and silently no-op during 429 cooldown', async () => {
    const error429 = new ApiError('http', 'Too Many Requests', 429, undefined, 5);
    const adminSession = createAdminSession();

    const getPreviewSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview')
      .mockRejectedValue(error429);

    render(
      <AuthContext.Provider
        value={{
          accessToken: adminSession.accessToken,
          sessionScope: adminSession.sessionScope,
          isSessionExpired: false,
          triggerSessionExpired: vi.fn(),
          dismissSessionExpired: vi.fn(),
          setAccessToken: vi.fn(),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={adminSession} />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    // Expect the unavailable overlay to appear
    await screen.findByText(/Camera Snapshot Unavailable/i);

    // PROVE 429 REACHES HOOK: getCameraPreview MUST have been called at least once
    await waitFor(() => {
      expect(getPreviewSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    // Accessible cooldown status message is presented
    const statusMsg = await screen.findByRole('status');
    expect(statusMsg.textContent).toMatch(/Automatic retry resumes after server cooldown/i);

    // The Retry button appears on screen
    const retryBtn = await screen.findByRole('button', { name: /Retry Snapshot/i });

    // Verify click behavior: even if clicked, hook silently returns and does not issue a new network call during cooldown
    const callsBeforeClick = getPreviewSpy.mock.calls.length;
    fireEvent.click(retryBtn);
    expect(getPreviewSpy.mock.calls.length).toBe(callsBeforeClick);

    // CONTRACT REGRESSION ASSERTION:
    // UI MUST NOT present an actionable retry button that silently no-ops during server cooldown.
    // The retry button MUST be disabled while the server is cooling down (429).
    expect((retryBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('preserves 401/403 permanent halt: Retry button must not be actionable when access is forbidden (403)', async () => {
    const adminSession = createAdminSession();
    const getPreviewSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview')
      .mockRejectedValue(new ApiError('http', 'Forbidden camera access', 403));

    render(
      <AuthContext.Provider
        value={{
          accessToken: adminSession.accessToken,
          sessionScope: adminSession.sessionScope,
          isSessionExpired: false,
          triggerSessionExpired: vi.fn(),
          dismissSessionExpired: vi.fn(),
          setAccessToken: vi.fn(),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={adminSession} />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });
    await screen.findByText(/Camera Snapshot Unavailable/i);

    // PROVE 403 REACHES HOOK: getCameraPreview MUST have been called at least once
    await waitFor(() => {
      expect(getPreviewSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    // 429 accessible cooldown text is NOT shown for 403
    expect(screen.queryByRole('status')).toBeNull();

    const retryBtn = await screen.findByRole('button', { name: /Retry Snapshot/i });

    // When clicked, hook permanently halts and ignores retry
    const callsBeforeClick = getPreviewSpy.mock.calls.length;
    fireEvent.click(retryBtn);
    expect(getPreviewSpy.mock.calls.length).toBe(callsBeforeClick);

    // CONTRACT REGRESSION ASSERTION:
    // When permanently halted with 403, UI must not present an actionable retry button.
    expect((retryBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('enforces no early requests: does not issue network calls before 429 deadline expires', async () => {
    vi.useFakeTimers();

    const error429 = new ApiError('http', 'Too Many Requests', 429, undefined, 5);
    const adminSession = createAdminSession();

    const getPreviewSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview')
      .mockRejectedValue(error429);

    render(
      <AuthContext.Provider
        value={{
          accessToken: adminSession.accessToken,
          sessionScope: adminSession.sessionScope,
          isSessionExpired: false,
          triggerSessionExpired: vi.fn(),
          dismissSessionExpired: vi.fn(),
          setAccessToken: vi.fn(),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={adminSession} />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    // Initial mount call
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const callsCount = getPreviewSpy.mock.calls.length;
    expect(callsCount).toBeGreaterThanOrEqual(1);

    // Advance 3 seconds (less than 5s Retry-After cooldown)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // Must NOT have issued any new request early!
    expect(getPreviewSpy.mock.calls.length).toBe(callsCount);
  });

  it('recovers automatically via polling scheduler after 429 cooldown deadline expires and clears unavailable UI', async () => {
    vi.useFakeTimers();

    const error429 = new ApiError('http', 'Too Many Requests', 429, undefined, 2);
    const successResponse = createFakePreviewResponse('site-alpha', 'cam-1', 'CAM-01');
    const adminSession = createAdminSession();

    const getPreviewSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview')
      .mockRejectedValueOnce(error429)
      .mockResolvedValue(successResponse);

    render(
      <AuthContext.Provider
        value={{
          accessToken: adminSession.accessToken,
          sessionScope: adminSession.sessionScope,
          isSessionExpired: false,
          triggerSessionExpired: vi.fn(),
          dismissSessionExpired: vi.fn(),
          setAccessToken: vi.fn(),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={adminSession} />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    // Initial mount call: fails with 429
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(getPreviewSpy).toHaveBeenCalledTimes(1);

    // Unavailable overlay, cooldown status, and disabled button are visible initially
    expect(screen.queryByText(/Camera Snapshot Unavailable/i)).not.toBeNull();
    const retryBtn = screen.getByRole('button', { name: /Retry Snapshot/i }) as HTMLButtonElement;
    expect(retryBtn.disabled).toBe(true);

    // Advance through the 2s cooldown deadline + polling cadence (2500ms total)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    // Automatic polling scheduler must have refetched after deadline
    expect(getPreviewSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Allow frame decode and state update to complete
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    // STRENGTHENED RECOVERY ASSERTIONS:
    // Once successful frame is received and decoded, the unavailable overlay and retry button MUST clear
    expect(screen.queryByText(/Camera Snapshot Unavailable/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry Snapshot/i })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('re-enables Retry Snapshot button when transitioning from 429 cooldown to 503 Service Unavailable', async () => {
    vi.useFakeTimers();

    const error429 = new ApiError('http', 'Too Many Requests', 429, undefined, 2);
    const error503 = new ApiError('http', 'Service Unavailable', 503);
    const successResponse = createFakePreviewResponse('site-alpha', 'cam-1', 'CAM-01');
    const adminSession = createAdminSession();
    const requestTimes: number[] = [];

    const getPreviewSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview')
      .mockImplementation(() => {
        requestTimes.push(Date.now());
        if (requestTimes.length === 1) return Promise.reject(error429);
        if (requestTimes.length === 2) return Promise.reject(error503);
        return Promise.resolve(successResponse);
      });

    render(
      <AuthContext.Provider
        value={{
          accessToken: adminSession.accessToken,
          sessionScope: adminSession.sessionScope,
          isSessionExpired: false,
          triggerSessionExpired: vi.fn(),
          dismissSessionExpired: vi.fn(),
          setAccessToken: vi.fn(),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={adminSession} />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    // 1. Initial request fails with 429: button is disabled, 429 cooldown status shown
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(getPreviewSpy).toHaveBeenCalledTimes(1);

    const retryBtnDuring429 = screen.getByRole('button', {
      name: /Retry Snapshot/i,
    }) as HTMLButtonElement;
    expect(retryBtnDuring429.disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(
      /Automatic retry resumes after server cooldown/i,
    );

    // 2. Advance past 2s deadline: polling scheduler triggers second request, which fails with 503
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(requestTimes).toHaveLength(2);
    expect(requestTimes[1]! - requestTimes[0]!).toBeGreaterThanOrEqual(2000);

    // Allow query settlement
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // 3. Verify status transition from 429 to 503:
    // Unavailable overlay is still shown (due to 503)
    expect(screen.queryByText(/Camera Snapshot Unavailable/i)).not.toBeNull();
    // 429 cooldown status message is gone
    expect(screen.queryByRole('status')).toBeNull();

    // RETRY BUTTON IS RE-ENABLED ON 503 (no longer disabled by previous 429 status)
    const retryBtnAfter503 = screen.getByRole('button', {
      name: /Retry Snapshot/i,
    }) as HTMLButtonElement;
    expect(retryBtnAfter503.disabled).toBe(false);

    // Manual click on re-enabled retry button issues next request
    await act(async () => {
      fireEvent.click(retryBtnAfter503);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getPreviewSpy).toHaveBeenCalledTimes(3);
  });

  it('maintains scope isolation: camera change requests new camera independently', async () => {
    const error429 = new ApiError('http', 'Too Many Requests', 429, undefined, 10);
    const cam2Response = createFakePreviewResponse('site-alpha', 'cam-2', 'CAM-02');
    const adminSession = createAdminSession();

    const getPreviewSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview')
      .mockImplementation((_token, _siteId, cameraId) => {
        if (cameraId === 'cam-1') {
          return Promise.reject(error429);
        }
        return Promise.resolve(cam2Response);
      });

    render(
      <AuthContext.Provider
        value={{
          accessToken: adminSession.accessToken,
          sessionScope: adminSession.sessionScope,
          isSessionExpired: false,
          triggerSessionExpired: vi.fn(),
          dismissSessionExpired: vi.fn(),
          setAccessToken: vi.fn(),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={adminSession} />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });
    await screen.findByText(/Camera Snapshot Unavailable/i);
    await waitFor(() => {
      expect(getPreviewSpy).toHaveBeenCalledWith(
        adminSession.accessToken,
        'site-alpha',
        'cam-1',
        expect.anything(),
      );
    });

    // Switch camera to cam-2
    const cameraSelect = await screen.findByRole('combobox', { name: /Camera/i });
    fireEvent.change(cameraSelect, { target: { value: 'cam-2' } });

    // cam-2 should be requested independently without being blocked by cam-1's 10s cooldown
    await waitFor(() => {
      expect(getPreviewSpy).toHaveBeenCalledWith(
        adminSession.accessToken,
        'site-alpha',
        'cam-2',
        expect.anything(),
      );
    });
  });
});
