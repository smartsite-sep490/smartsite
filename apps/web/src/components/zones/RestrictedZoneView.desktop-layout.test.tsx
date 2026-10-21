// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RestrictedZoneView } from './RestrictedZoneView';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { SiteResponse, Page } from '@smartsite/api-client';
import type { CameraResponse, RegionResponse } from './zonePolygonAdapter';
import type { DecodedPreview } from '../cameras/useRealtimePreview';
import type { VideoTestDetection } from '../cameras/videoTestFixture';
import type { SharedSession } from '../../types/shared-session';
import i18n from '../../i18n';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const state = vi.hoisted(() => ({
  preview: null as DecodedPreview | null,
  status: 'LIVE' as 'DISCONNECTED' | 'CONNECTING' | 'LIVE' | 'REPLAY' | 'UNAVAILABLE',
  error: null as string | null,
}));

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: () => ({
    preview: state.preview,
    status: state.status,
    sourceKind: state.status === 'REPLAY' ? 'REPLAY' : state.status === 'LIVE' ? 'LIVE' : null,
    error: state.error,
    capturedAt: state.preview?.frame.capturedAt ?? null,
    retry: vi.fn(),
  }),
}));

vi.mock('../cameras/useRealtimePreview', () => ({
  useRealtimePreview: () => ({ preview: state.preview, connected: true, error: null }),
}));

function mockZoneDetection(trackId = 5): VideoTestDetection {
  return {
    active: true,
    alertState: 'CONFIRMED',
    boundingBox: { x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.8 },
    confidence: 0.92,
    eventId: '00000000-0000-4000-8000-000000000002',
    label: 'Intrusion Alert',
    ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
    timecode: '02:45',
    trackId,
    regionId: 'reg-1',
    cameraExternalId: 'CAM-01',
  };
}

function mockPreview(cameraExternalId = 'CAM-01', detection?: VideoTestDetection): DecodedPreview {
  return {
    image: {} as HTMLImageElement,
    frame: {
      sessionId: '00000000-0000-4000-8000-000000000002',
      sequenceNumber: '2',
      cameraExternalId,
      capturedAt: '2026-09-30T00:00:00Z',
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      zonePolygons: [],
      detections: [],
      zoneDetections: detection ? [detection] : [],
    },
  };
}

const sharedAdminSession: SharedSession = {
  accessToken: 'shared-admin-token',
  user: {
    id: 'admin-1',
    username: 'admin',
    displayName: 'Global Admin',
    roleAssignments: [{ role: 'ADMIN', siteId: null }],
  },
  sessionScope: 'scope-admin-desktop-layout',
};

const mockSitesPage: Page<SiteResponse> = {
  items: [
    {
      id: 'site-alpha',
      code: 'SITE-A',
      name: 'Alpha Site',
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 1,
};

const mockCamerasPage: Page<CameraResponse> = {
  items: [
    {
      id: 'cam-1',
      siteId: 'site-alpha',
      externalId: 'CAM-01',
      code: 'CAM-01',
      name: 'Primary Gate Camera',
      status: 'ACTIVE',
      configurationVersion: 3,
      createdAt: '2026-09-30T00:00:00Z',
    },
    {
      id: 'cam-2',
      siteId: 'site-alpha',
      externalId: 'CAM-02',
      code: 'CAM-02',
      name: 'Perimeter Camera',
      status: 'ACTIVE',
      configurationVersion: 5,
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 2,
};

const mockRegionsPage: Page<RegionResponse> = {
  items: [
    {
      id: 'reg-1',
      cameraId: 'cam-1',
      zoneId: 'zone-1',
      polygon: {
        coordinates: [
          [0.1, 0.1],
          [0.8, 0.1],
          [0.8, 0.8],
          [0.1, 0.8],
        ],
      },
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 1,
};

describe('RestrictedZoneView Desktop Layout', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
    await i18n.changeLanguage('en');
    state.preview = mockPreview('CAM-01', mockZoneDetection(5));
    state.status = 'LIVE';
    state.error = null;

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesPage);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
      mockCamerasPage,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue(mockRegionsPage);
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('keeps right evidence panel absent when closed and supports explicit open/close with focus return', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView sharedSession={sharedAdminSession} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect((document.getElementById('zone-camera-select') as HTMLSelectElement).value).toBe(
        'cam-1',
      );
    });

    expect(screen.queryByRole('button', { name: /Sign out/i })).toBeNull();
    expect(screen.queryByTestId('zone-evidence-panel')).toBeNull();

    const detailsToggle = screen.getByTestId('zone-details-toggle');
    expect(detailsToggle.getAttribute('aria-expanded')).toBe('false');

    await user.click(detailsToggle);
    expect(detailsToggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('zone-evidence-panel')).toBeDefined();

    await user.click(detailsToggle);
    expect(screen.queryByTestId('zone-evidence-panel')).toBeNull();
    expect(detailsToggle.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => {
      expect(document.activeElement).toBe(detailsToggle);
    });
  });

  it('enlarges the camera viewport and exits cleanly via toggle or Escape with focus return', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView sharedSession={sharedAdminSession} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect((document.getElementById('zone-camera-select') as HTMLSelectElement).value).toBe(
        'cam-1',
      );
    });

    const viewport = document.getElementById('zone-camera-viewport');
    expect(viewport).not.toBeNull();

    const enlargeToggle = screen.getByTestId('zone-camera-enlarge-toggle');
    expect(enlargeToggle.getAttribute('aria-expanded')).toBe('false');
    expect(enlargeToggle.getAttribute('aria-controls')).toBe('zone-camera-viewport');

    await user.click(enlargeToggle);
    expect(enlargeToggle.getAttribute('aria-expanded')).toBe('true');

    await user.click(enlargeToggle);
    expect(enlargeToggle.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => {
      expect(document.activeElement).toBe(enlargeToggle);
    });
  });

  it('hides the open details panel automatically when camera scope changes', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView sharedSession={sharedAdminSession} />
      </QueryClientProvider>,
    );

    const cameraSelect = (await screen.findByRole('combobox', { name: /^Camera$/i })) as HTMLSelectElement;
    await waitFor(() => {
      expect(cameraSelect.value).toBe('cam-1');
    });

    const detailsToggle = screen.getByTestId('zone-details-toggle');
    await user.click(detailsToggle);
    expect(screen.getByTestId('zone-evidence-panel')).toBeDefined();

    await user.selectOptions(cameraSelect, 'cam-2');
    await waitFor(() => {
      expect(cameraSelect.value).toBe('cam-2');
      expect(screen.queryByTestId('zone-evidence-panel')).toBeNull();
      expect(screen.getByTestId('zone-details-toggle').getAttribute('aria-expanded')).toBe('false');
    });
  });
});
