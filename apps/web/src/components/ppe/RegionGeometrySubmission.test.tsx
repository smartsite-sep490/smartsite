// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  SmartSiteManagementClient,
  type CameraConfigurationImageReference,
  type Page,
  type ReferenceRegionMutationResponse,
  type ZoneResponse,
} from '@smartsite/api-client';
import type { CameraResponse, RegionResponse } from '@smartsite/contracts';
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

const REF_ID_V3 = '00000000-0000-4000-8000-000000000103';
const REF_ID_V4 = '00000000-0000-4000-8000-000000000104';
const REF_ID_V5 = '00000000-0000-4000-8000-000000000105';
const ACTOR_ID = '00000000-0000-4000-8000-000000000999';

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
  overrides: Partial<Omit<CameraConfigurationReference, 'issuedReference'>> = {},
  issuedOverrides: Partial<CameraConfigurationImageReference> = {},
): CameraConfigurationReference {
  const nowMs = Date.now();
  const capturedAt = overrides.frame?.capturedAt ?? new Date(nowMs).toISOString();
  const referenceExpiresAt =
    overrides.referenceExpiresAt ?? new Date(nowMs + 300_000).toISOString();
  const configurationVersion = overrides.configurationVersion ?? 3;
  const siteId = overrides.siteId ?? 'site-alpha';
  const cameraId = overrides.cameraId ?? 'cam-1';
  const sourceKind = overrides.sourceKind ?? 'LIVE';
  const frame = {
    sessionId: '00000000-0000-4000-8000-000000000001',
    sequenceNumber: '1',
    cameraExternalId: 'CAM-EXT-01',
    capturedAt,
    width: 640,
    height: 480,
    imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    imageSha256: 'a'.repeat(64),
    ...overrides.frame,
  };
  return {
    siteId,
    cameraId,
    schemaVersion: 1,
    purpose: 'REGION_CONFIGURATION',
    configurationVersion,
    sourceKind,
    referenceExpiresAt,
    ...overrides,
    frame,
    issuedReference: {
      schemaVersion: '1.0.0',
      purpose: 'REGION_CONFIGURATION',
      sourceKind,
      referenceId: REF_ID_V3,
      siteId,
      cameraId,
      sessionId: frame.sessionId,
      imageSha256: frame.imageSha256,
      width: frame.width,
      height: frame.height,
      capturedAt: frame.capturedAt,
      issuedAt: frame.capturedAt,
      expiresAt: referenceExpiresAt,
      configurationVersion,
      viewRevision: 1,
      ...issuedOverrides,
    },
    image: {} as HTMLImageElement,
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

  it.each([false, true])(
    'saves with a fresh issued reference, preserves duplicate blocking and legacy isolation (same coordinates: %s)',
    async (sameCoordinates) => {
      const user = userEvent.setup();
      let currentCamera: CameraResponse = { ...baseCamera, configurationVersion: 3 };
      let storedRegions: RegionResponse[] = [];

      vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockImplementation(
        async (): Promise<Page<CameraResponse>> => ({ items: [currentCamera], total: 1 }),
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

      const legacyCreateSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion');
      const legacyUpdateSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'updatePolygon');

      const createReferenceRegionSpy = vi
        .spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion')
        .mockImplementation(async (_token, _siteId, cameraId, payload) => {
          const createdRegion = {
            id: 'reg-created-101',
            cameraId,
            zoneId: payload.zoneId,
            polygon: { coordinates: payload.polygon.coordinates.map(([x, y]) => [x, y]) },
            coordinateSpace: 'NORMALIZED_0_1' as const,
            version: 1,
            isActive: true,
            createdAt: '2026-10-15T12:00:00.000Z',
            geometryConfirmation: {
              status: 'MANUALLY_CONFIRMED' as const,
              referenceId: payload.referenceId,
              viewRevision: payload.viewRevision,
              confirmedByUserId: ACTOR_ID,
              confirmedAt: '2026-10-15T12:00:00.000Z',
            },
          };
          currentCamera = { ...currentCamera, configurationVersion: 4 };
          referenceState.reference = createFreshReference(
            { configurationVersion: 4 },
            { referenceId: REF_ID_V4, viewRevision: 2 },
          );
          storedRegions = [createdRegion];
          return { region: createdRegion, configurationVersion: 4 };
        });

      const updateReferencePolygonSpy = vi
        .spyOn(SmartSiteManagementClient.prototype, 'updateReferencePolygon')
        .mockImplementation(async (_token, _siteId, cameraId, regionId, payload) => {
          const updatedRegion = {
            id: regionId,
            cameraId,
            zoneId: 'zone-1',
            polygon: { coordinates: payload.polygon.coordinates.map(([x, y]) => [x, y]) },
            coordinateSpace: 'NORMALIZED_0_1' as const,
            version: 2,
            isActive: true,
            createdAt: '2026-10-15T12:00:00.000Z',
            geometryConfirmation: {
              status: 'MANUALLY_CONFIRMED' as const,
              referenceId: payload.referenceId,
              viewRevision: payload.viewRevision,
              confirmedByUserId: ACTOR_ID,
              confirmedAt: '2026-10-15T12:01:00.000Z',
            },
          };
          currentCamera = { ...currentCamera, configurationVersion: 5 };
          referenceState.reference = createFreshReference(
            { configurationVersion: 5 },
            { referenceId: REF_ID_V5, viewRevision: 3 },
          );
          storedRegions = [updatedRegion];
          return { region: updatedRegion, configurationVersion: 5 };
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

      await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
      const canvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);

      fireEvent.click(canvas, { clientX: 64, clientY: 48 }); // [0.1, 0.1]
      fireEvent.click(canvas, { clientX: 512, clientY: 48 }); // [0.8, 0.1]
      fireEvent.click(canvas, { clientX: 512, clientY: 384 }); // [0.8, 0.8]
      expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();

      await user.click(screen.getByRole('button', { name: /Save Region/i }));

      expect(await screen.findByText(/Saved region "reg-created-101" \(v1\)/i)).toBeDefined();
      expect(createReferenceRegionSpy).toHaveBeenCalledTimes(1);
      expect(createReferenceRegionSpy).toHaveBeenCalledWith(
        'mock-token-xyz',
        'site-alpha',
        'cam-1',
        {
          zoneId: 'zone-1',
          expectedConfigurationVersion: 3,
          referenceId: REF_ID_V3,
          viewRevision: 1,
          confirmReferenceView: true,
          polygon: {
            coordinates: [
              [0.1, 0.1],
              [0.8, 0.1],
              [0.8, 0.8],
            ],
          },
        },
        { signal: expect.any(AbortSignal) },
      );
      expect(updateReferencePolygonSpy).not.toHaveBeenCalled();
      expect(legacyCreateSpy).not.toHaveBeenCalled();
      expect(legacyUpdateSpy).not.toHaveBeenCalled();

      // Append 4th vertex in-place; saving before accepting v4 reference conflicts closed (409)
      const activeCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);
      if (!sameCoordinates) fireEvent.click(activeCanvas, { clientX: 64, clientY: 384 });
      expect(
        screen.getByText(sameCoordinates ? /Points: 3 \/ 32/i : /Points: 4 \/ 32/i),
      ).toBeDefined();

      await user.click(screen.getByRole('button', { name: /Save Region/i }));
      expect(
        await screen.findByText(
          sameCoordinates
            ? /This polygon draft has already been saved/i
            : /Configuration version conflict\. Camera configuration was updated/i,
        ),
      ).toBeDefined();
      expect(updateReferencePolygonSpy).not.toHaveBeenCalled();

      // Review and accept the newly issued v4 candidate reference, then save
      await user.click(screen.getByRole('button', { name: /Review new reference/i }));
      await user.click(await screen.findByRole('button', { name: /Use new reference/i }));
      await user.click(screen.getByRole('button', { name: /Save Region/i }));

      expect(await screen.findByText(/Saved region "reg-created-101" \(v2\)/i)).toBeDefined();
      expect(createReferenceRegionSpy).toHaveBeenCalledTimes(1);
      expect(updateReferencePolygonSpy).toHaveBeenCalledTimes(1);
      expect(updateReferencePolygonSpy).toHaveBeenCalledWith(
        'mock-token-xyz',
        'site-alpha',
        'cam-1',
        'reg-created-101',
        {
          expectedConfigurationVersion: 4,
          referenceId: REF_ID_V4,
          viewRevision: 2,
          confirmReferenceView: true,
          polygon: {
            coordinates: [
              [0.1, 0.1],
              [0.8, 0.1],
              [0.8, 0.8],
              ...(!sameCoordinates ? [[0.1, 0.8]] : []),
            ],
          },
        },
        { signal: expect.any(AbortSignal) },
      );
      expect(legacyCreateSpy).not.toHaveBeenCalled();
      expect(legacyUpdateSpy).not.toHaveBeenCalled();

      fireEvent.keyDown(screen.getByLabelText(/Camera Region Drawing Canvas/i), { key: 'Escape' });
      expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();

      await user.click(await screen.findByRole('button', { name: /Edit Geometry/i }));
      expect(screen.getByText(/Editing Region reg-created-101 \(v2\)/i)).toBeDefined();
      expect(
        screen.getByText(sameCoordinates ? /Points: 3 \/ 32/i : /Points: 4 \/ 32/i),
      ).toBeDefined();
    },
  );

  it('acknowledges only the submitted polygon across a held createReferenceRegion request, fails closed on unissued fixtures, and never falls back to legacy writes', async () => {
    const user = userEvent.setup();
    let currentCamera: CameraResponse = { ...baseCamera, configurationVersion: 3 };

    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockImplementation(
      async (): Promise<Page<CameraResponse>> => ({ items: [currentCamera], total: 1 }),
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockImplementation(
      async () => currentCamera,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue({
      items: [],
      total: 0,
    });

    let resolveCreate!: (value: ReferenceRegionMutationResponse) => void;
    const createReferenceRegionSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion')
      .mockImplementation(
        () =>
          new Promise<ReferenceRegionMutationResponse>((resolve) => {
            resolveCreate = resolve;
          }),
      );
    const updateReferencePolygonSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'updateReferencePolygon')
      .mockRejectedValue(new ApiError('http', 'Service Unavailable', 503));
    const legacyCreateSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion');
    const legacyUpdateSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'updatePolygon');

    // Unissued legacy fixture (missing issuedReference) must fail closed and keep Start Drawing disabled
    const unissuedFixture = { ...createFreshReference() } as Record<string, unknown>;
    delete unissuedFixture.issuedReference;
    referenceState.reference = unissuedFixture as unknown as CameraConfigurationReference;

    const { rerender } = render(
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

    const disabledStartBtn = await screen.findByRole('button', { name: /Start Drawing Region/i });
    expect((disabledStartBtn as HTMLButtonElement).disabled).toBe(true);

    referenceState.reference = createFreshReference();
    rerender(
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
    fireEvent.click(canvas, { clientX: 64, clientY: 48 });
    fireEvent.click(canvas, { clientX: 512, clientY: 48 });
    fireEvent.click(canvas, { clientX: 512, clientY: 384 });

    await user.click(screen.getByRole('button', { name: /Save Region/i }));
    await waitFor(() => expect(createReferenceRegionSpy).toHaveBeenCalledTimes(1));

    // Attempted canvas click while submission is pending must not alter the submitted geometry
    fireEvent.click(canvas, { clientX: 64, clientY: 384 });

    currentCamera = { ...currentCamera, configurationVersion: 4 };
    referenceState.reference = createFreshReference(
      { configurationVersion: 4 },
      { referenceId: REF_ID_V4, viewRevision: 2 },
    );
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
          createdAt: '2026-10-15T12:00:00.000Z',
          geometryConfirmation: {
            status: 'MANUALLY_CONFIRMED',
            referenceId: REF_ID_V3,
            viewRevision: 1,
            confirmedByUserId: ACTOR_ID,
            confirmedAt: '2026-10-15T12:00:00.000Z',
          },
        },
        configurationVersion: 4,
      });
    });

    expect(await screen.findByText(/Saved region "reg-held-1" \(v1\)/i)).toBeDefined();
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();

    // Accept v4 reference, add 4th vertex, and trigger failing updateReferencePolygon (503) -> no legacy fallback
    await user.click(screen.getByRole('button', { name: /Review new reference/i }));
    await user.click(await screen.findByRole('button', { name: /Use new reference/i }));
    fireEvent.click(screen.getByLabelText(/Camera Region Drawing Canvas/i), {
      clientX: 64,
      clientY: 384,
    });

    await user.click(screen.getByRole('button', { name: /Save Region/i }));
    await waitFor(() => expect(updateReferencePolygonSpy).toHaveBeenCalledTimes(1));
    expect(createReferenceRegionSpy).toHaveBeenCalledTimes(1);
    expect(legacyCreateSpy).not.toHaveBeenCalled();
    expect(legacyUpdateSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/Points: 4 \/ 32/i)).toBeDefined();
  });
});
