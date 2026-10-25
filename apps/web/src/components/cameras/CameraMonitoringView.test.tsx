// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import i18n from '../../i18n';
import type { SharedSession } from '../../types/shared-session';
import * as useRealtimePreviewModule from './useRealtimePreview';
import * as useScopedCameraPreviewModule from './useScopedCameraPreview';
import * as useScopedCameraMediaModule from './useScopedCameraMedia';
import * as useScopedRecordedVideoModule from './useScopedRecordedVideo';
import { CameraMonitoringView } from './CameraMonitoringView';

beforeEach(() => {
  // Hooks below supply synthetic pixels; production-wide paused env is not the media fixture.
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
});

describe('CameraMonitoringView DOM Regression & Liveness Claim Prevention', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    window.localStorage.clear();
    await i18n.changeLanguage('en');

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    });

    // Browser API stubs for JSDOM environment
    class MockResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    // Scoped canvas 2d context stub (avoids external canvas npm installation)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId: string) => {
      if (contextId === '2d') {
        return {
          clearRect: vi.fn(),
          fillRect: vi.fn(),
          strokeRect: vi.fn(),
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          closePath: vi.fn(),
          stroke: vi.fn(),
          fill: vi.fn(),
          arc: vi.fn(),
          measureText: vi.fn(() => ({ width: 0 })),
          fillText: vi.fn(),
          strokeText: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
          drawImage: vi.fn(),
          createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
          setTransform: vi.fn(),
          resetTransform: vi.fn(),
          scale: vi.fn(),
          rotate: vi.fn(),
          translate: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
      }
      return null;
    });
    vi.stubEnv('VITE_AI_BACKEND_SERVICE_TOKEN', 'mock-ai-backend-token');
    vi.stubEnv('VITE_AI_WS_URL', 'ws://127.0.0.1:8000/ws/realtime');
  });

  afterEach(async () => {
    cleanup();
    queryClient.clear();
    window.localStorage.clear();
    await i18n.changeLanguage('en');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('1. Neutral Parent Badge: never claims Live AI Active even when stream is disconnected or erroring', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [
        {
          id: 'site-alpha',
          code: 'ALPHA',
          name: 'Alpha Construction Site',
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
      items: [
        {
          id: 'cam-gate-1',
          siteId: 'site-alpha',
          code: 'GATE-01',
          configurationVersion: 1,
          name: 'Main Gate Camera',
          externalId: 'gate-cam-1',
          status: 'ACTIVE' as const,
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
      total: 1,
    });

    // Simulate stream in disconnected/error state
    vi.spyOn(useRealtimePreviewModule, 'useRealtimePreview').mockReturnValue({
      url: null,
      preview: null,
      connected: false,
      error: 'Connection refused: AI worker stream offline',
    });
    vi.spyOn(useScopedCameraPreviewModule, 'useScopedCameraPreview').mockReturnValue({
      preview: null,
      status: 'UNAVAILABLE',
      sourceKind: null,
      error: 'Snapshot feed disconnected',
      errorStatus: 503,
      isLoading: false,
      isPolling: false,
      retry: vi.fn(),
      cameraExternalId: 'gate-cam-1',
      capturedAt: null,
      siteId: 'site-alpha',
      cameraId: 'cam-gate-1',
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CameraMonitoringView
          apiUrl="http://localhost:3000"
          sharedSession={{
            accessToken: 'test-token-1',
            sessionScope: 'user-cam-admin:1',
            user: {
              id: 'user-cam-admin',
              username: 'admin.cam',
              displayName: 'Camera Admin',
              roleAssignments: [{ role: 'ADMIN', siteId: null }],
            },
          }}
        />
      </QueryClientProvider>,
    );

    // Parent header must display neutral workspace label
    expect(screen.getByText('Camera Monitoring')).not.toBeNull();
    expect(screen.getByText('Vision Workspace')).not.toBeNull();

    // Parent must NEVER hardcode or claim Live AI Active
    expect(screen.queryByText(/live ai active/i)).toBeNull();

    // Child runtime error indicator must remain visible and honest
    expect(await screen.findByText(/Camera Snapshot Unavailable/i)).not.toBeNull();
    expect((await screen.findAllByText(/UNAVAILABLE/i)).length).toBeGreaterThan(0);
  });

  it('2. Sub-tab switching: preserves neutral parent header and switches to Restricted Zones view', async () => {
    const user = userEvent.setup();
    vi.spyOn(useRealtimePreviewModule, 'useRealtimePreview').mockReturnValue({
      url: null,
      preview: null,
      connected: false,
      error: 'AI backend unavailable',
    });
    vi.spyOn(useScopedCameraPreviewModule, 'useScopedCameraPreview').mockReturnValue({
      preview: null,
      status: 'UNAVAILABLE',
      sourceKind: null,
      error: null,
      errorStatus: null,
      isLoading: false,
      isPolling: false,
      retry: vi.fn(),
      cameraExternalId: null,
      capturedAt: null,
      siteId: null,
      cameraId: null,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CameraMonitoringView />
      </QueryClientProvider>,
    );

    // Initial tab is PPE Monitoring (MF05)
    expect(
      screen.getByRole('button', { name: /PPE Monitoring.*MF05/i }).getAttribute('aria-pressed'),
    ).toBe('true');
    const zonesTabButton = screen.getByRole('button', { name: /Restricted Zones.*MF06/i });
    expect(zonesTabButton.getAttribute('aria-pressed')).toBe('false');

    // Switch to Restricted Zones sub-tab
    await user.click(zonesTabButton);
    expect(zonesTabButton.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByRole('button', { name: /PPE Monitoring.*MF05/i }).getAttribute('aria-pressed'),
    ).toBe('false');

    // Parent header remains strictly neutral
    expect(screen.getByText('Vision Workspace')).not.toBeNull();
    expect(screen.queryByText(/live ai active/i)).toBeNull();
  });

  it('updates its local selection when an uncontrolled caller observes sub-tab changes', async () => {
    const onSubTabChange = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <CameraMonitoringView onSubTabChange={onSubTabChange} />
      </QueryClientProvider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /Restricted Zones.*MF06/i }));
    expect(onSubTabChange).toHaveBeenCalledWith('zones');
    expect(screen.getByRole('heading', { name: 'Backend Camera Configuration' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'PPE Compliance Monitoring' })).toBeNull();
    expect(
      screen.getByRole('button', { name: /Restricted Zones.*MF06/i }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('keeps selection under the controlled caller while reporting requested changes', async () => {
    const onSubTabChange = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <CameraMonitoringView activeSubTab="ppe" onSubTabChange={onSubTabChange} />
      </QueryClientProvider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /Restricted Zones.*MF06/i }));
    expect(onSubTabChange).toHaveBeenCalledWith('zones');
    expect(screen.getByRole('heading', { name: 'PPE Compliance Monitoring' })).not.toBeNull();
    expect(
      screen.getByRole('button', { name: /PPE Monitoring.*MF05/i }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

describe('CameraMonitoringView Single-Runtime i18n & Scoped Boundaries', () => {
  let queryClient: QueryClient;

  const mockSharedSession: SharedSession = {
    accessToken: 'secret-camera-jwt-999',
    sessionScope: 'user-cam-admin:1',
    user: {
      id: 'user-cam-admin',
      username: 'admin.cam',
      displayName: 'Camera Admin',
      roleAssignments: [{ role: 'ADMIN', siteId: null }],
    },
    onSignOut: vi.fn(),
  };

  beforeEach(async () => {
    window.localStorage.clear();
    await i18n.changeLanguage('en');

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    });

    class MockResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId: string) => {
      if (contextId === '2d') {
        return {
          clearRect: vi.fn(),
          fillRect: vi.fn(),
          strokeRect: vi.fn(),
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          closePath: vi.fn(),
          stroke: vi.fn(),
          fill: vi.fn(),
          arc: vi.fn(),
          measureText: vi.fn(() => ({ width: 0 })),
          fillText: vi.fn(),
          strokeText: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
          drawImage: vi.fn(),
          createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
          setTransform: vi.fn(),
          resetTransform: vi.fn(),
          scale: vi.fn(),
          rotate: vi.fn(),
          translate: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
      }
      return null;
    });

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [
        {
          id: 'site-alpha',
          code: 'ALPHA',
          name: 'Alpha Construction Site',
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
      total: 1,
    });

    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
      items: [
        Object.assign(
          {
            id: 'cam-usb-0',
            siteId: 'site-alpha',
            code: 'LAPTOP',
            configurationVersion: 1,
            name: 'North Gate Live USB',
            externalId: 'laptop-webcam-live',
            status: 'ACTIVE' as const,
            createdAt: '2026-10-01T00:00:00Z',
          },
          { streamUrl: 'rtsp://operator:supersecret@10.0.0.50:554/stream1' },
        ),
      ],
      total: 1,
    });

    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({
      items: [
        Object.assign(
          {
            id: 'cam-usb-0',
            siteId: 'site-alpha',
            code: 'LAPTOP',
            configurationVersion: 1,
            name: 'North Gate Live USB',
            externalId: 'laptop-webcam-live',
            status: 'ACTIVE' as const,
            createdAt: '2026-10-01T00:00:00Z',
          },
          { streamUrl: 'rtsp://operator:supersecret@10.0.0.50:554/stream1' },
        ),
      ],
      total: 1,
    });

    vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue({
      items: [],
      total: 0,
    });
  });

  afterEach(async () => {
    cleanup();
    queryClient.clear();
    window.localStorage.clear();
    await i18n.changeLanguage('en');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('1. Language switch (en -> vi -> en) retranslates header and sub-tabs while preserving MF05/MF06 codes, SharedSession scope, and opaque query keys', async () => {
    vi.spyOn(useScopedCameraPreviewModule, 'useScopedCameraPreview').mockReturnValue({
      preview: null,
      status: 'UNAVAILABLE',
      sourceKind: null,
      error: null,
      errorStatus: null,
      isLoading: false,
      isPolling: false,
      retry: vi.fn(),
      cameraExternalId: null,
      capturedAt: null,
      siteId: 'site-alpha',
      cameraId: 'cam-usb-0',
    });
    vi.spyOn(useScopedCameraMediaModule, 'useScopedCameraMedia').mockReturnValue({
      image: null,
      frame: null,
      status: 'UNAVAILABLE',
      error: null,
      errorStatus: null,
      isStreaming: false,
      retry: vi.fn(),
    });
    vi.spyOn(useScopedRecordedVideoModule, 'useScopedRecordedVideo').mockReturnValue({
      videoUrl: null,
      status: 'IDLE',
      error: null,
      errorStatus: null,
      isLoading: false,
      retry: vi.fn(),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CameraMonitoringView apiUrl="http://localhost:3000" sharedSession={mockSharedSession} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Camera Monitoring')).not.toBeNull();
    });
    expect(screen.getByText('Vision Workspace')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: /PPE Monitoring.*MF05/i }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: /Restricted Zones.*MF06/i }).getAttribute('aria-pressed'),
    ).toBe('false');

    // Switch to Vietnamese
    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    expect(screen.getByText('Giám sát camera')).not.toBeNull();
    expect(screen.getByText('Không gian thị giác máy tính')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: /Giám sát bảo hộ.*MF05/i }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: /Khu vực hạn chế.*MF06/i }).getAttribute('aria-pressed'),
    ).toBe('false');

    // Switch back to English
    await act(async () => {
      await i18n.changeLanguage('en');
    });

    expect(screen.getByText('Camera Monitoring')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: /PPE Monitoring.*MF05/i }).getAttribute('aria-pressed'),
    ).toBe('true');

    // Verify no query key in TanStack Query cache contains raw accessToken or service camera streamUrl
    const serializedKeys = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey),
    );
    expect(serializedKeys).not.toContain('secret-camera-jwt-999');
    expect(serializedKeys).not.toContain('rtsp://operator:supersecret@10.0.0.50:554/stream1');
  });

  it('2. VITE_AI_WORK_PAUSED=true keeps preview, raw media, and recorded video hooks disabled across language and sub-tab switches', async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    const user = userEvent.setup();

    const previewSpy = vi
      .spyOn(useScopedCameraPreviewModule, 'useScopedCameraPreview')
      .mockReturnValue({
        preview: null,
        status: 'UNAVAILABLE',
        sourceKind: null,
        error: null,
        errorStatus: null,
        isLoading: false,
        isPolling: false,
        retry: vi.fn(),
        cameraExternalId: null,
        capturedAt: null,
        siteId: 'site-alpha',
        cameraId: 'cam-usb-0',
      });
    const mediaSpy = vi.spyOn(useScopedCameraMediaModule, 'useScopedCameraMedia').mockReturnValue({
      image: null,
      frame: null,
      status: 'IDLE',
      error: null,
      errorStatus: null,
      isStreaming: false,
      retry: vi.fn(),
    });
    const recordedSpy = vi
      .spyOn(useScopedRecordedVideoModule, 'useScopedRecordedVideo')
      .mockReturnValue({
        videoUrl: null,
        status: 'IDLE',
        error: null,
        errorStatus: null,
        isLoading: false,
        retry: vi.fn(),
      });

    render(
      <QueryClientProvider client={queryClient}>
        <CameraMonitoringView apiUrl="http://localhost:3000" sharedSession={mockSharedSession} />
      </QueryClientProvider>,
    );

    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    await user.click(screen.getByRole('button', { name: /Khu vực hạn chế.*MF06/i }));

    await act(async () => {
      await i18n.changeLanguage('en');
    });

    expect(previewSpy.mock.calls.length).toBeGreaterThan(0);
    for (const [opts] of previewSpy.mock.calls) {
      expect(opts.enabled).toBe(false);
    }
    for (const [opts] of mediaSpy.mock.calls) {
      expect(opts.enabled).toBe(false);
    }
    for (const [opts] of recordedSpy.mock.calls) {
      expect(opts.enabled).toBe(false);
    }
  });

  it('3. Preserves raw-pixel vs exact AI-evidence separation and live-empty vs offline distinction across language switches', async () => {
    const user = userEvent.setup();
    const mockRawImage = { width: 640, height: 480 } as unknown as HTMLImageElement;
    const mockAiImage = { width: 640, height: 480 } as unknown as HTMLImageElement;

    vi.spyOn(useScopedCameraMediaModule, 'useScopedCameraMedia').mockReturnValue({
      image: mockRawImage,
      frame: {
        type: 'media-frame',
        mediaVersion: 1,
        sessionId: 'raw-session-1',
        sequenceNumber: '42',
        cameraExternalId: 'usb-0',
        capturedAt: '2026-10-02T10:00:00Z',
        width: 640,
        height: 480,
        imageDataUrl: 'data:image/jpeg;base64,raw',
      },
      status: 'LIVE',
      error: null,
      errorStatus: null,
      isStreaming: true,
      retry: vi.fn(),
    });

    vi.spyOn(useScopedCameraPreviewModule, 'useScopedCameraPreview').mockReturnValue({
      preview: {
        image: mockAiImage,
        frame: {
          sessionId: '00000000-0000-4000-8000-000000000099',
          sequenceNumber: '77',
          cameraExternalId: 'usb-0',
          capturedAt: '2026-10-02T10:00:01Z',
          width: 640,
          height: 480,
          imageDataUrl: 'data:image/jpeg;base64,ai',
          zonePolygons: [],
          detections: [],
          zoneDetections: [],
        },
      },
      status: 'LIVE',
      sourceKind: 'LIVE',
      error: null,
      errorStatus: null,
      isLoading: false,
      isPolling: true,
      retry: vi.fn(),
      cameraExternalId: 'usb-0',
      capturedAt: '2026-10-02T10:00:01Z',
      siteId: 'site-alpha',
      cameraId: 'cam-usb-0',
    });

    vi.spyOn(useScopedRecordedVideoModule, 'useScopedRecordedVideo').mockReturnValue({
      videoUrl: null,
      status: 'IDLE',
      error: null,
      errorStatus: null,
      isLoading: false,
      retry: vi.fn(),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CameraMonitoringView apiUrl="http://localhost:3000" sharedSession={mockSharedSession} />
      </QueryClientProvider>,
    );

    // Wait for camera metadata to settle so live-raw mode activates for usb-0
    await waitFor(() => {
      expect(screen.getByTestId('mode-toggle-live-raw').getAttribute('aria-pressed')).toBe('true');
    });

    // In live-raw mode: RawCameraMediaCanvas is rendered, RealtimePreviewCanvas is NOT rendered
    expect(screen.getByTestId('raw-camera-media-canvas')).not.toBeNull();
    expect(screen.queryByRole('region', { name: /Synchronized AI camera frame/i })).toBeNull();

    // Switch to AI Evidence mode
    await user.click(screen.getByTestId('mode-toggle-ai-analyzed'));
    expect(screen.getByTestId('mode-toggle-ai-analyzed').getAttribute('aria-pressed')).toBe('true');

    // Now RealtimePreviewCanvas is rendered and live-empty banner is shown with SOURCE: LIVE
    const aiCanvasEn = screen.getByRole('region', { name: 'Synchronized AI camera frame' });
    expect(aiCanvasEn.getAttribute('data-frame-id')).toBe(
      '00000000-0000-4000-8000-000000000099:77',
    );
    expect(screen.getByText('Live Snapshot Active · No Person detections in frame')).not.toBeNull();
    expect(screen.getByTestId('factual-source-label').textContent).toBe('SOURCE: LIVE');

    // Switch language to Vietnamese: preserves AI mode, frame identity, and live-empty vs offline distinction
    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    const aiCanvasVi = screen.getByRole('region', { name: 'Khung hình camera AI đã đồng bộ' });
    expect(aiCanvasVi.getAttribute('data-frame-id')).toBe(
      '00000000-0000-4000-8000-000000000099:77',
    );
    expect(
      screen.getByText(
        'Ảnh chụp trực tiếp đang hoạt động · Không phát hiện người trong khung hình',
      ),
    ).not.toBeNull();
    expect(screen.getByTestId('factual-source-label').textContent).toBe('NGUỒN: LIVE');
  });
});
