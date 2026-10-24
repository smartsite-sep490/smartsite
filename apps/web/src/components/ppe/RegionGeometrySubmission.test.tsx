// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import type { Page, ZoneResponse } from '@smartsite/api-client';
import type { CameraResponse, RegionMutationResponse, RegionResponse } from '@smartsite/contracts';
import { LocaleProvider } from '../../i18n/LocaleProvider';
import type { CameraConfigurationReference } from './useCameraConfigurationReference';
import { ZonePpeCameraRegionPanel } from './ZonePpeCameraRegionPanel';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof SVGElement !== 'undefined') {
  SVGElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 640,
    height: 480,
    right: 640,
    bottom: 480,
  });
}

const referenceState = vi.hoisted(() => ({
  reference: null as CameraConfigurationReference | null,
  isLoading: false,
  error: null as ApiError | null,
  request: vi.fn(async () => {}),
}));

vi.mock('./useCameraConfigurationReference', () => ({
  useCameraConfigurationReference: () => ({
    reference: referenceState.reference,
    isLoading: referenceState.isLoading,
    error: referenceState.error,
    request: referenceState.request,
  }),
}));

function createFreshReference(
  overrides: Partial<CameraConfigurationReference> = {},
): CameraConfigurationReference {
  const nowMs = Date.now();
  return {
    siteId: 'site-alpha',
    cameraId: 'cam-1',
    schemaVersion: 1,
    purpose: 'REGION_CONFIGURATION',
    configurationVersion: 3,
    sourceKind: 'LIVE',
    referenceExpiresAt: new Date(nowMs + 300_000).toISOString(),
    frame: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      sequenceNumber: '1',
      cameraExternalId: 'CAM-EXT-01',
      capturedAt: new Date(nowMs).toISOString(),
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      imageSha256: 'a'.repeat(64),
    },
    image: {} as HTMLImageElement,
    ...overrides,
  };
}

const mockZones: ZoneResponse[] = [
  {
    id: 'zone-1',
    siteId: 'site-alpha',
    code: 'ZONE-A1',
    name: 'Hazardous Scaffold Area',
    type: 'HAZARDOUS',
    restrictionPolicy: 'NONE',
    requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
    configurationLocked: false,
    createdAt: '2026-10-07T00:00:00Z',
  },
];

const baseCamera: CameraResponse = {
  id: 'cam-1',
  siteId: 'site-alpha',
  externalId: 'CAM-EXT-01',
  code: 'CAM-01',
  name: 'Scaffold Camera 01',
  status: 'ACTIVE',
  configurationVersion: 3,
  createdAt: '2026-09-30T00:00:00Z',
};

describe('ZonePpeCameraRegionPanel Region Submission Journeys', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    referenceState.reference = createFreshReference();
    referenceState.isLoading = false;
    referenceState.error = null;
    referenceState.request.mockClear();
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    referenceState.reference = null;
    referenceState.isLoading = false;
    referenceState.error = null;
  });

  it('transitions a newly created Region into in-place editing so modifying and saving again calls updatePolygon with the returned region id and configurationVersion instead of creating a second Region', async () => {
    const user = userEvent.setup();
    let currentCamera: CameraResponse = { ...baseCamera, configurationVersion: 3 };
    let storedRegions: RegionResponse[] = [];

    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockImplementation(
      async (): Promise<Page<CameraResponse>> => ({
        items: [currentCamera],
        total: 1,
      }),
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockImplementation(
      async () => currentCamera,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockImplementation(
      async (): Promise<Page<RegionResponse>> => ({
        items: storedRegions,
        total: storedRegions.length,
      }),
    );

    const createRegionSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createRegion')
      .mockImplementation(async (_token, _siteId, cameraId, payload) => {
        const createdRegion: RegionResponse = {
          id: 'reg-created-101',
          cameraId,
          zoneId: payload.zoneId,
          polygon: payload.polygon,
          coordinateSpace: 'NORMALIZED_0_1',
          version: 1,
          isActive: true,
          createdAt: '2026-10-15T12:00:00Z',
        };
        currentCamera = { ...currentCamera, configurationVersion: 4 };
        referenceState.reference = createFreshReference({ configurationVersion: 4 });
        storedRegions = [createdRegion];
        return {
          region: createdRegion,
          configurationVersion: 4,
        };
      });

    const updatePolygonSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'updatePolygon')
      .mockImplementation(async (_token, _siteId, cameraId, regionId, payload) => {
        const updatedRegion: RegionResponse = {
          id: regionId,
          cameraId,
          zoneId: 'zone-1',
          polygon: payload.polygon,
          coordinateSpace: 'NORMALIZED_0_1',
          version: 2,
          isActive: true,
          createdAt: '2026-10-15T12:00:00Z',
        };
        currentCamera = { ...currentCamera, configurationVersion: 5 };
        referenceState.reference = createFreshReference({ configurationVersion: 5 });
        storedRegions = [updatedRegion];
        return {
          region: updatedRegion,
          configurationVersion: 5,
        };
      });

    render(
      <LocaleProvider defaultLocale="en">
        <QueryClientProvider client={queryClient}>
          <ZonePpeCameraRegionPanel
            apiUrl="http://localhost:3000"
            token="mock-token-xyz"
            sessionScope="scope-01"
            credentialId={1}
            siteId="site-alpha"
            zones={mockZones}
          />
        </QueryClientProvider>
      </LocaleProvider>,
    );

    // 1. Open new-region drawing editor and draw a 3-point polygon
    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    const canvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);

    fireEvent.click(canvas, { clientX: 64, clientY: 48 }); // [0.1, 0.1]
    fireEvent.click(canvas, { clientX: 512, clientY: 48 }); // [0.8, 0.1]
    fireEvent.click(canvas, { clientX: 512, clientY: 384 }); // [0.8, 0.8]
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();

    // 2. Save new region -> calls createRegion with expectedConfigurationVersion 3
    await user.click(screen.getByRole('button', { name: /Save Region/i }));

    expect(await screen.findByText(/Saved region "reg-created-101" \(v1\)/i)).toBeDefined();
    expect(createRegionSpy).toHaveBeenCalledTimes(1);
    expect(createRegionSpy).toHaveBeenCalledWith(
      'mock-token-xyz',
      'site-alpha',
      'cam-1',
      {
        zoneId: 'zone-1',
        polygon: {
          coordinates: [
            [0.1, 0.1],
            [0.8, 0.1],
            [0.8, 0.8],
          ],
        },
        expectedConfigurationVersion: 3,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(updatePolygonSpy).not.toHaveBeenCalled();

    // 3. Modify the just-saved polygon in the same open editor (append 4th vertex at [0.1, 0.8])
    const activeCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);
    fireEvent.click(activeCanvas, { clientX: 64, clientY: 384 });
    expect(screen.getByText(/Points: 4 \/ 32/i)).toBeDefined();

    // 4. Save again in the same editor -> must call updatePolygon on reg-created-101 with configurationVersion 4
    await user.click(screen.getByRole('button', { name: /Save Region/i }));

    expect(await screen.findByText(/Saved region "reg-created-101" \(v2\)/i)).toBeDefined();
    expect(createRegionSpy).toHaveBeenCalledTimes(1);
    expect(updatePolygonSpy).toHaveBeenCalledTimes(1);
    expect(updatePolygonSpy).toHaveBeenCalledWith(
      'mock-token-xyz',
      'site-alpha',
      'cam-1',
      'reg-created-101',
      {
        polygon: {
          coordinates: [
            [0.1, 0.1],
            [0.8, 0.1],
            [0.8, 0.8],
            [0.1, 0.8],
          ],
        },
        expectedConfigurationVersion: 4,
      },
      { signal: expect.any(AbortSignal) },
    );

    // 5. Just-saved 4-point geometry is now clean: single Escape closes editor without discard prompt, and reopen shows v2 with 4 vertices
    fireEvent.keyDown(screen.getByLabelText(/Camera Region Drawing Canvas/i), { key: 'Escape' });
    expect(screen.queryByText(/Discard unsaved region geometry changes\?/i)).toBeNull();
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();

    await user.click(await screen.findByRole('button', { name: /Edit Geometry/i }));
    expect(screen.getByText(/Editing Region reg-created-101 \(v2\)/i)).toBeDefined();
    expect(screen.getByText(/Points: 4 \/ 32/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Vertex 4/i }).getAttribute('cx')).toBe('64');
    expect(screen.getByRole('button', { name: /Vertex 4/i }).getAttribute('cy')).toBe('384');
  });

  it('acknowledges only the submitted polygon across a held createRegion request and never falls back to createRegion when a subsequent updatePolygon fails', async () => {
    const user = userEvent.setup();
    let currentCamera: CameraResponse = { ...baseCamera, configurationVersion: 3 };

    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockImplementation(
      async (): Promise<Page<CameraResponse>> => ({
        items: [currentCamera],
        total: 1,
      }),
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockImplementation(
      async () => currentCamera,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue({
      items: [],
      total: 0,
    });

    let resolveCreate!: (value: RegionMutationResponse) => void;
    const createRegionSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createRegion')
      .mockImplementation(
        () =>
          new Promise<RegionMutationResponse>((resolve) => {
            resolveCreate = resolve;
          }),
      );
    const updatePolygonSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'updatePolygon')
      .mockRejectedValue(new ApiError('http', 'Service Unavailable', 503));

    render(
      <LocaleProvider defaultLocale="en">
        <QueryClientProvider client={queryClient}>
          <ZonePpeCameraRegionPanel
            apiUrl="http://localhost:3000"
            token="mock-token-xyz"
            sessionScope="scope-01"
            credentialId={1}
            siteId="site-alpha"
            zones={mockZones}
          />
        </QueryClientProvider>
      </LocaleProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    const canvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);

    fireEvent.click(canvas, { clientX: 64, clientY: 48 }); // [0.1, 0.1]
    fireEvent.click(canvas, { clientX: 512, clientY: 48 }); // [0.8, 0.1]
    fireEvent.click(canvas, { clientX: 512, clientY: 384 }); // [0.8, 0.8]
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();

    // Submit the 3-point polygon; createRegion stays held in-flight
    await user.click(screen.getByRole('button', { name: /Save Region/i }));
    await waitFor(() => expect(createRegionSpy).toHaveBeenCalledTimes(1));

    // Attempted canvas click while submission is pending must not alter the submitted/acknowledged geometry
    fireEvent.click(canvas, { clientX: 64, clientY: 384 });

    currentCamera = { ...currentCamera, configurationVersion: 4 };
    await act(async () => {
      resolveCreate({
        region: {
          id: 'reg-held-1',
          cameraId: 'cam-1',
          zoneId: 'zone-1',
          polygon: {
            coordinates: [
              [0.1, 0.1],
              [0.8, 0.1],
              [0.8, 0.8],
            ],
          },
          coordinateSpace: 'NORMALIZED_0_1',
          version: 1,
          isActive: true,
          createdAt: '2026-10-15T12:00:00Z',
        },
        configurationVersion: 4,
      });
    });

    expect(await screen.findByText(/Saved region "reg-held-1" \(v1\)/i)).toBeDefined();
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Vertex 4/i })).toBeNull();

    // Now add a 4th vertex after save completes and trigger a failing updatePolygon (503) -> no createRegion fallback
    const activeCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);
    fireEvent.click(activeCanvas, { clientX: 64, clientY: 384 });
    expect(screen.getByText(/Points: 4 \/ 32/i)).toBeDefined();

    await user.click(screen.getByRole('button', { name: /Save Region/i }));
    await waitFor(() => expect(updatePolygonSpy).toHaveBeenCalledTimes(1));
    expect(createRegionSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Points: 4 \/ 32/i)).toBeDefined();
  });
});
