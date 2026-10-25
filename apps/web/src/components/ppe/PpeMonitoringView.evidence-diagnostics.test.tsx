// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { Page, SiteResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import type { ScopedPreviewStatus } from '../cameras/useScopedCameraPreview';
import { PpeMonitoringView } from './PpeMonitoringView';
import { FourSourceWallTile } from './FourSourceWall';
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

interface MockTilePreviewConfig {
  preview: DecodedPreview | null;
  status: ScopedPreviewStatus;
  sourceKind: 'LIVE' | 'REPLAY' | null;
  error?: string | null;
  errorStatus?: number | null;
  capturedAt?: string | null;
}

const previewStore = vi.hoisted(() => ({
  byCameraId: {} as Record<string, MockTilePreviewConfig>,
  retry: vi.fn(),
}));

const unavailableHook = { error: null, errorStatus: null, retry: vi.fn() };

vi.mock('../cameras/useScopedRecordedVideo', () => ({
  useScopedRecordedVideo: () => ({
    ...unavailableHook,
    videoUrl: null,
    status: 'UNAVAILABLE',
    isLoading: false,
  }),
}));

vi.mock('../cameras/useScopedCameraMedia', () => ({
  useScopedCameraMedia: () => ({
    ...unavailableHook,
    image: null,
    frame: null,
    status: 'UNAVAILABLE',
    isStreaming: false,
  }),
}));

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: (options?: {
    cameraId?: string | null;
    siteId?: string | null;
    enabled?: boolean;
  }) => {
    const camId = options?.cameraId ?? '';
    const entry = options?.enabled === false ? undefined : previewStore.byCameraId[camId];
    return {
      preview: entry?.preview ?? null,
      status: (entry?.status ?? 'UNAVAILABLE') as ScopedPreviewStatus,
      sourceKind: entry?.sourceKind ?? null,
      error: entry?.error ?? null,
      errorStatus: entry?.errorStatus ?? null,
      isError: Boolean(entry?.error || entry?.errorStatus),
      isLoading: entry?.status === 'CONNECTING',
      isPolling: Boolean(entry?.preview),
      retry: previewStore.retry,
      cameraExternalId: entry?.preview?.frame.cameraExternalId ?? null,
      capturedAt:
        entry?.capturedAt !== undefined
          ? entry.capturedAt
          : (entry?.preview?.frame.capturedAt ?? null),
      siteId: entry ? (options?.siteId ?? null) : null,
      cameraId: entry ? camId || null : null,
    };
  },
}));

const baseSite: SiteResponse = {
  id: 'site-alpha',
  code: 'SITE-A',
  name: 'Alpha Construction Site',
  createdAt: '2026-09-30T00:00:00Z',
};

const baseCamera: CameraResponse = {
  id: 'cam-1',
  siteId: 'site-alpha',
  externalId: 'CAM-01',
  code: 'CAM-01',
  name: 'Camera 01',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-09-30T00:00:00Z',
};

const officerSession: SharedSession = {
  accessToken: 'token-evidence-alpha',
  sessionScope: 'scope-evidence-alpha',
  user: {
    id: 'officer-evidence-1',
    displayName: 'Safety Officer Alpha',
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
  },
};

function makeDetection(overrides: Partial<VideoTestDetection> = {}): VideoTestDetection {
  return {
    active: true,
    alertState: 'CONFIRMED',
    confirmedMissingItems: ['HARD_HAT', 'GOGGLES'],
    boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9 },
    confidence: 0.91,
    eventId: '00000000-0000-4000-8000-000000000001',
    label: 'Missing Hard Hat',
    ppeStatus: { HARD_HAT: 'MISSING', SAFETY_VEST: 'PRESENT', GOGGLES: 'MISSING' },
    timecode: '01:23',
    trackId: 7,
    cameraExternalId: 'CAM-01',
    ...overrides,
  };
}

function makePreview(
  cameraExternalId: string,
  detections: VideoTestDetection[],
  withModelObjects = false,
): DecodedPreview {
  return {
    image: {} as HTMLImageElement,
    frame: {
      sessionId: '00000000-0000-4000-8000-000000000099',
      sequenceNumber: '1',
      cameraExternalId,
      capturedAt: '2026-10-19T08:30:00.000Z',
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      zonePolygons: [],
      detections,
      zoneDetections: [],
      ...(withModelObjects
        ? {
            modelObjects: {
              modelFamily: 'yolo11s',
              experimental: true,
              scope: 'OBJECT_DETECTION_ONLY',
              artifactId: 'synthetic-test-model',
              artifactSha256: 'a'.repeat(64),
              detections: [
                {
                  classId: 0,
                  className: 'Person',
                  confidence: 0.94,
                  boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
                },
              ],
            },
          }
        : {}),
    },
  };
}

describe('PpeMonitoringView Evidence Modal Diagnostics, Null-Track Keys & Wrapping (P7 Findings 1, 4, 5)', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
    await i18n.changeLanguage('en');
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    previewStore.byCameraId = {};
    previewStore.retry.mockClear();

    const noop = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      new Proxy(
        {},
        { get: (_t, prop) => (prop === 'measureText' ? () => ({ width: 42 }) : noop) },
      ) as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [baseSite],
      total: 1,
    } satisfies Page<SiteResponse>);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
      items: [baseCamera],
      total: 1,
    } satisfies Page<CameraResponse>);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
      items: [],
      total: 0,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue({
      items: [],
      total: 0,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('closes the Evidence modal, releases background inert, expands secondary-diagnostics-drawer, and focuses toggle-diagnostics-drawer when clicking raw detector objects link', async () => {
    previewStore.byCameraId['cam-1'] = {
      preview: makePreview('CAM-01', [makeDetection()], true),
      status: 'LIVE',
      sourceKind: 'LIVE',
    };

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={officerSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Camera 01/i });

    const diagnosticsToggle = screen.getByTestId('toggle-diagnostics-drawer');
    expect(diagnosticsToggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(screen.getByTestId('open-evidence-details-btn'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    const diagnosticsBtn = screen.getByTestId('evidence-open-diagnostics-btn');
    fireEvent.click(diagnosticsBtn);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(diagnosticsToggle.getAttribute('aria-expanded')).toBe('true');
    expect(diagnosticsToggle.closest('[inert]')).toBeNull();
    expect(diagnosticsToggle.closest('[aria-hidden="true"]')).toBeNull();

    await waitFor(() => {
      expect(document.activeElement).toBe(diagnosticsToggle);
    });
  });

  it('renders multiple untracked person detections (trackId: null) without duplicate React keys and wraps long PPE/context text without single-line truncate', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    previewStore.byCameraId['cam-1'] = {
      preview: makePreview('CAM-01', [
        makeDetection({
          trackId: null,
          eventId: '00000000-0000-4000-8000-000000000011',
          confirmedMissingItems: ['HARD_HAT', 'GOGGLES'],
          ppeStatus: { HARD_HAT: 'MISSING', SAFETY_VEST: 'PRESENT', GOGGLES: 'MISSING' },
        }),
        makeDetection({
          trackId: null,
          eventId: '00000000-0000-4000-8000-000000000012',
          confirmedMissingItems: ['SAFETY_VEST'],
          ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'MISSING' },
        }),
      ]),
      status: 'LIVE',
      sourceKind: 'LIVE',
    };

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={officerSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Camera 01/i });
    fireEvent.click(screen.getByTestId('open-evidence-details-btn'));

    const duplicateKeyCalls = errorSpy.mock.calls.filter((args) =>
      args.some((arg) => typeof arg === 'string' && arg.includes('same key')),
    );
    expect(duplicateKeyCalls).toHaveLength(0);

    const primaryContext = screen.getByTestId('ppe-primary-context');
    for (const valueEl of primaryContext.querySelectorAll('p.font-semibold:not(.font-mono)')) {
      expect(valueEl.className).toContain('break-words');
      expect(valueEl.className).not.toContain('truncate');
    }

    const ppeCheckSection = screen.getByTestId('ppe-check-section');
    expect(within(ppeCheckSection).getByText('Unknown track (1)')).toBeTruthy();
    expect(within(ppeCheckSection).getByText('Unknown track (2)')).toBeTruthy();
    expect(within(ppeCheckSection).queryByText('Track #')).toBeNull();
    const verdictSpans = within(ppeCheckSection).getAllByText(/Helmet ·|Safety Vest ·/i);
    expect(verdictSpans.length).toBeGreaterThanOrEqual(2);
    for (const span of verdictSpans) {
      expect(span.className).toContain('break-words');
      expect(span.className).not.toContain('truncate');
    }

    const techMeta = screen.getByTestId('ppe-subordinate-technical-meta');
    const trackIdValue = techMeta.querySelector('p.tabular-nums');
    expect(trackIdValue?.textContent).toBe('Unknown track (1), Unknown track (2)');
    expect(trackIdValue?.className).toContain('break-words');
    expect(trackIdValue?.className).not.toContain('truncate');
  });

  it('guards malformed capturedAt timestamps and wraps long error/disclaimer strings in FourSourceWallTile', () => {
    previewStore.byCameraId['cam-1'] = {
      preview: null,
      status: 'UNAVAILABLE',
      sourceKind: null,
      error: 'Long camera snapshot error message that should wrap cleanly without truncating',
      capturedAt: 'not-a-valid-iso-timestamp',
    };

    render(
      <QueryClientProvider client={queryClient}>
      <FourSourceWallTile
        camera={baseCamera}
        siteId="site-alpha"
        apiUrl="http://localhost:3000"
        client={new SmartSiteManagementClient('http://localhost:3000')}
        enabled={true}
        token="token-evidence-alpha"
        sessionScope="scope-evidence-alpha"
        credentialId={1}
        isSelected={true}
        isAiWorkPaused={false}
        isApplying={false}
        showModelObjects={false}
        filterClasses={[]}
        onSelect={vi.fn()}
      />
      </QueryClientProvider>,
    );

    const tile = screen.getByTestId('wall-tile-cam-1');
    expect(tile.textContent).toContain('--:--:--');
    expect(tile.textContent).not.toContain('Invalid Date');

    const errorParagraph = screen.getByText(/Long camera snapshot error message/i);
    expect(errorParagraph.className).toContain('break-words');
    expect(errorParagraph.className).not.toContain('truncate');
  });
});
