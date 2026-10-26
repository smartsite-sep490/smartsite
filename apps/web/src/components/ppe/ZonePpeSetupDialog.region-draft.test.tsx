// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApiError,
  CONFIGURATION_REFERENCE_LIFETIME_MS,
  SmartSiteManagementClient,
  type Page,
  type ReferenceRegionMutationResponse,
  type ZoneResponse,
} from '@smartsite/api-client';
import type { CameraResponse, RegionResponse } from '@smartsite/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { ZonePpeSetupDialog } from './ZonePpeSetupDialog';
import type {
  CameraConfigurationReference,
  UseCameraConfigurationReferenceOptions,
  UseCameraConfigurationReferenceResult,
} from './useCameraConfigurationReference';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 50 }),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
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

const refState = vi.hoisted(() => ({
  reference: null as CameraConfigurationReference | null,
  isLoading: false,
  error: null as ApiError | null,
  requestSpy: vi.fn<() => Promise<void>>(),
}));

vi.mock('./useCameraConfigurationReference', () => ({
  useCameraConfigurationReference: (
    options: UseCameraConfigurationReferenceOptions,
  ): UseCameraConfigurationReferenceResult => ({
    reference:
      options.enabled &&
      refState.reference &&
      refState.reference.siteId.toLowerCase() === options.siteId.trim().toLowerCase()
        ? refState.reference
        : null,
    isLoading: refState.isLoading,
    error: refState.error,
    request: refState.requestSpy,
  }),
}));

const DEFAULT_REF_ID = '00000000-0000-4000-8000-000000000106';
const DEFAULT_ACTOR_ID = '00000000-0000-4000-8000-000000000999';

function createSyntheticReference(siteId = 'site-alpha'): CameraConfigurationReference {
  const nowMs = Date.now();
  const capturedAt = new Date(nowMs).toISOString();
  const referenceExpiresAt = new Date(nowMs + CONFIGURATION_REFERENCE_LIFETIME_MS).toISOString();
  return {
    schemaVersion: 1,
    purpose: 'REGION_CONFIGURATION',
    siteId,
    cameraId: 'cam-1',
    configurationVersion: 3,
    sourceKind: 'LIVE',
    referenceExpiresAt,
    frame: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      sequenceNumber: '1',
      cameraExternalId: 'CAM-EXT-01',
      capturedAt,
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      imageSha256: 'a'.repeat(64),
    },
    issuedReference: {
      schemaVersion: '1.0.0',
      purpose: 'REGION_CONFIGURATION',
      sourceKind: 'LIVE',
      referenceId: DEFAULT_REF_ID,
      siteId,
      cameraId: 'cam-1',
      sessionId: '00000000-0000-4000-8000-000000000001',
      imageSha256: 'a'.repeat(64),
      width: 640,
      height: 480,
      capturedAt,
      issuedAt: capturedAt,
      expiresAt: referenceExpiresAt,
      configurationVersion: 3,
      viewRevision: 1,
    },
    image: {} as HTMLImageElement,
  };
}

const mockZone: ZoneResponse = {
  id: 'zone-1',
  siteId: 'site-alpha',
  code: 'ZONE-A1',
  name: 'Hazardous Scaffold Area',
  type: 'HAZARDOUS',
  restrictionPolicy: 'NONE',
  requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
  configurationLocked: false,
  createdAt: '2026-10-07T00:00:00Z',
};

const mockCameras: Page<CameraResponse> = {
  items: [
    {
      id: 'cam-1',
      siteId: 'site-alpha',
      externalId: 'CAM-EXT-01',
      code: 'CAM-01',
      name: 'Scaffold Camera 01',
      status: 'ACTIVE',
      configurationVersion: 3,
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 1,
};

const mockRegions: Page<RegionResponse> = {
  items: [],
  total: 0,
};

let queryClient: QueryClient;

function RegionDialogHarness({
  siteId = 'site-alpha',
  token = 'token-alpha',
  canManageRegions = true,
}: {
  siteId?: string;
  token?: string;
  canManageRegions?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={queryClient}>
      <button type="button" onClick={() => setOpen(true)}>
        Configure regions
      </button>
      {open && (
        <ZonePpeSetupDialog
          section="regions"
          canManageZones
          canManageRegions={canManageRegions}
          apiUrl="http://localhost:3000"
          token={token}
          sessionScope="scope-01"
          credentialId={1}
          siteId={siteId}
          siteName={siteId}
          onClose={() => setOpen(false)}
        />
      )}
    </QueryClientProvider>
  );
}

const regionDialog = () => screen.getByRole('dialog', { name: 'Link Zone to Camera Region' });
const discardDialog = () => screen.getByRole('dialog', { name: 'Discard unsaved Zone changes?' });

async function openPolygonDraftWithThreeVertices() {
  const startBtn = await screen.findByRole('button', { name: /Start Drawing Region/i });
  await waitFor(() => expect((startBtn as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(startBtn);
  const canvas = await screen.findByLabelText(/Camera Region Drawing Canvas/i);
  fireEvent.click(canvas, { clientX: 64, clientY: 48 });
  fireEvent.click(canvas, { clientX: 512, clientY: 48 });
  fireEvent.click(canvas, { clientX: 512, clientY: 384 });
  expect(screen.getByText(/Points: 3 \/ 32/i)).toBeTruthy();
  return canvas;
}

beforeEach(async () => {
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network in DOM test')));
  window.localStorage.clear();
  await i18n.changeLanguage('en');
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  refState.reference = createSyntheticReference('site-alpha');
  refState.isLoading = false;
  refState.error = null;
  refState.requestSpy = vi.fn(async () => undefined);

  vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockImplementation(
    async (_token, siteId) => ({
      items: [{ ...mockZone, siteId }],
      total: 1,
    }),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockImplementation(
    async (_token, siteId) => ({
      items: [{ ...mockCameras.items[0]!, siteId }],
      total: 1,
    }),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockImplementation(
    async (_token, siteId) => ({
      ...mockCameras.items[0]!,
      siteId,
    }),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue(mockRegions);
});

afterEach(async () => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('ZonePpeSetupDialog region polygon draft & save guards', () => {
  it.each(['close', 'backdrop'] as const)(
    'prompts before closing on outer %s when polygon has unsaved vertices and preserves vertices on Keep editing',
    async (trigger) => {
      render(<RegionDialogHarness />);
      await openPolygonDraftWithThreeVertices();

      if (trigger === 'close') {
        fireEvent.click(within(regionDialog()).getByRole('button', { name: 'Close dialog' }));
      } else {
        fireEvent.click(screen.getByTestId('ppe-dialog-backdrop'));
      }

      expect(discardDialog()).toBeTruthy();
      fireEvent.click(within(discardDialog()).getByRole('button', { name: 'Keep editing' }));
      expect(screen.queryByRole('dialog', { name: 'Discard unsaved Zone changes?' })).toBeNull();
      expect(regionDialog()).toBeTruthy();
      expect(screen.getByText(/Points: 3 \/ 32/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Vertex 1 (0.1, 0.1)' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Vertex 2 (0.8, 0.1)' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Vertex 3 (0.8, 0.8)' })).toBeTruthy();

      fireEvent.click(within(regionDialog()).getByRole('button', { name: 'Close dialog' }));
      fireEvent.click(within(discardDialog()).getByRole('button', { name: 'Discard changes' }));
      expect(screen.queryByRole('dialog')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Configure regions' }));
      expect(await screen.findByRole('button', { name: /Start Drawing Region/i })).toBeTruthy();
      expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
    },
  );

  it('blocks outer close button, backdrop, and Escape while Region save is pending, then closes cleanly after save', async () => {
    let resolveSave!: (value: ReferenceRegionMutationResponse) => void;
    vi.spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion').mockImplementation(
      () =>
        new Promise<ReferenceRegionMutationResponse>((resolve) => {
          resolveSave = resolve;
        }),
    );

    render(<RegionDialogHarness />);
    await openPolygonDraftWithThreeVertices();

    fireEvent.click(screen.getByRole('button', { name: /Save Region/i }));
    await waitFor(() => expect(resolveSave).toBeTypeOf('function'));

    const outerCloseBtn = within(regionDialog()).getByRole('button', {
      name: 'Close dialog',
    }) as HTMLButtonElement;
    expect(outerCloseBtn.disabled).toBe(true);

    fireEvent.click(outerCloseBtn);
    fireEvent.click(screen.getByTestId('ppe-dialog-backdrop'));
    fireEvent.keyDown(screen.getByLabelText('Point X (0–1)'), { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(regionDialog()).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Discard unsaved Zone changes?' })).toBeNull();
    expect(screen.getByLabelText(/Camera Region Drawing Canvas/i)).toBeTruthy();

    await act(async () => {
      resolveSave({
        region: {
          id: 'reg-saved-1',
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
          createdAt: '2026-10-07T12:00:00Z',
          geometryConfirmation: {
            status: 'MANUALLY_CONFIRMED',
            referenceId: DEFAULT_REF_ID,
            viewRevision: 1,
            confirmedByUserId: DEFAULT_ACTOR_ID,
            confirmedAt: '2026-10-07T12:00:00.000Z',
          },
        },
        configurationVersion: 4,
      });
    });

    await screen.findByText(/Saved region "reg-saved-1" \(v1\)/i);
    expect(outerCloseBtn.disabled).toBe(false);
    fireEvent.click(outerCloseBtn);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes cleanly without a discard prompt when no polygon vertices are dirty or after inline draft reset', async () => {
    render(<RegionDialogHarness />);
    await openPolygonDraftWithThreeVertices();

    fireEvent.click(screen.getByRole('button', { name: /Reset Drawing/i }));
    expect(screen.getByText(/Points: 0 \/ 32/i)).toBeTruthy();

    fireEvent.click(within(regionDialog()).getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clears dirty polygon draft and open discard prompt on siteId, token, or role revocation', async () => {
    const view = render(<RegionDialogHarness />);
    await openPolygonDraftWithThreeVertices();

    fireEvent.click(within(regionDialog()).getByRole('button', { name: 'Close dialog' }));
    expect(discardDialog()).toBeTruthy();

    refState.reference = createSyntheticReference('site-beta');
    view.rerender(<RegionDialogHarness siteId="site-beta" />);
    expect(screen.queryByRole('dialog', { name: 'Discard unsaved Zone changes?' })).toBeNull();
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();

    await openPolygonDraftWithThreeVertices();
    view.rerender(<RegionDialogHarness siteId="site-beta" token="token-rotated" />);
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();

    await openPolygonDraftWithThreeVertices();
    view.rerender(
      <RegionDialogHarness siteId="site-beta" token="token-rotated" canManageRegions={false} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
