// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type SavedPpePolicy,
  type SmartSiteManagementClient,
} from '@smartsite/api-client';
import type { CameraResponse, RegionResponse, ZoneResponse } from '@smartsite/contracts/management';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import { ZonePpeCameraRegionPanel } from '../ppe/ZonePpeCameraRegionPanel';
import { CameraPpePolicyPanel, type CameraPpeContext } from './CameraPpePolicyPanel';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const API_URL = 'http://127.0.0.1:49888';
const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAM_ID = '00000000-0000-4000-8000-000000000101';
const SESSION_ID = '33333333-3333-4333-8333-333333333399';
const ZONE_1_ID = '22222222-2222-4222-8222-222222222201';
const ZONE_2_ID = '22222222-2222-4222-8222-222222222202';
const REG_1_ID = '77777777-7777-4777-8777-777777777701';
const REG_2_ID = '77777777-7777-4777-8777-777777777702';

const CAM_101: CameraResponse = {
  type: 'ZONE' as const,
  gateId: null,
  id: CAM_ID,
  siteId: SITE_ID,
  externalId: 'prov-cam-hoist-north-01',
  code: 'CAM-101',
  name: 'North Tower Hoist Camera',
  status: 'ACTIVE',
  configurationVersion: 3,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const ZONE_1: ZoneResponse = {
  id: ZONE_1_ID,
  siteId: SITE_ID,
  code: 'Z-HOIST',
  name: 'Hoist Loading Deck',
  type: 'HAZARDOUS',
  restrictionPolicy: 'NONE',
  requiredPpe: ['HARD_HAT'],
  configurationLocked: false,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const ZONE_2: ZoneResponse = {
  id: ZONE_2_ID,
  siteId: SITE_ID,
  code: 'Z-WELD',
  name: 'Welding Bay',
  type: 'HAZARDOUS',
  restrictionPolicy: 'NONE',
  requiredPpe: ['HARD_HAT', 'GOGGLES'],
  configurationLocked: false,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const TINY_JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x68, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00, 0xff,
  0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
]);
const TINY_JPEG = `data:image/jpeg;base64,${btoa(String.fromCharCode(...TINY_JPEG_BYTES))}`;

function buildRefEnvelope(params: {
  configVersion: number;
  viewRevision: number;
  sourceKind?: 'LIVE' | 'REPLAY';
  seq?: number;
}) {
  const capturedIso = new Date().toISOString();
  const expIso = new Date(Date.now() + 240_000).toISOString();
  const seqStr = String(params.seq ?? params.viewRevision);
  const sha = 'b'.repeat(64);
  return {
    viewValidity: 'UNCONFIRMED' as const,
    image: {
      schemaVersion: 1 as const,
      purpose: 'REGION_CONFIGURATION' as const,
      sourceKind: params.sourceKind ?? 'REPLAY',
      siteId: SITE_ID,
      cameraId: CAM_ID,
      configurationVersion: params.configVersion,
      referenceExpiresAt: expIso,
      frame: {
        cameraExternalId: CAM_101.externalId,
        sessionId: SESSION_ID,
        sequenceNumber: seqStr,
        capturedAt: capturedIso,
        width: 640,
        height: 360,
        imageDataUrl: TINY_JPEG,
        imageSha256: sha,
      },
    },
    reference: {
      schemaVersion: '1.0.0' as const,
      purpose: 'REGION_CONFIGURATION' as const,
      sourceKind: params.sourceKind ?? 'REPLAY',
      referenceId: `66666666-6666-4666-8666-66666666660${seqStr}`,
      siteId: SITE_ID,
      cameraId: CAM_ID,
      sessionId: SESSION_ID,
      imageSha256: sha,
      width: 640,
      height: 360,
      capturedAt: capturedIso,
      issuedAt: capturedIso,
      expiresAt: expIso,
      configurationVersion: params.configVersion,
      viewRevision: params.viewRevision,
    },
  };
}

describe('Camera Setup Phase 2 completion regressions', () => {
  const origImage = globalThis.Image;

  beforeEach(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
    globalThis.Image = class MockImg {
      naturalWidth = 640;
      naturalHeight = 360;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decode = () => Promise.resolve();
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    } as unknown as typeof Image;
  });

  afterEach(async () => {
    globalThis.Image = origImage;
    cleanup();
    await i18n.changeLanguage('en');
    vi.restoreAllMocks();
  });

  it('shows reference source/session/time provenance, distinguishes a small polygon from full camera frame, preserves coordinates across UI resize, and flags view revalidation', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const revalidationRegion: RegionResponse = {
      id: REG_1_ID,
      cameraId: CAM_ID,
      zoneId: ZONE_1_ID,
      polygon: {
        coordinates: [
          [0.15, 0.2],
          [0.45, 0.2],
          [0.3, 0.55],
        ],
      },
      coordinateSpace: 'NORMALIZED_0_1',
      version: 2,
      isActive: true,
      createdAt: '2026-11-01T00:00:00.000Z',
      geometryConfirmation: {
        status: 'MANUALLY_CONFIRMED',
        referenceId: '66666666-6666-4666-8666-666666666601',
        viewRevision: 1,
        confirmedByUserId: '99999999-9999-4999-8999-999999999999',
        confirmedAt: '2026-11-17T08:00:00.000Z',
      },
    };

    const updateReferencePolygon = vi.fn().mockResolvedValue({
      configurationVersion: 4,
      region: {
        ...revalidationRegion,
        version: 3,
        geometryConfirmation: {
          status: 'MANUALLY_CONFIRMED',
          referenceId: '66666666-6666-4666-8666-666666666602',
          viewRevision: 2,
          confirmedByUserId: '99999999-9999-4999-8999-999999999999',
          confirmedAt: new Date().toISOString(),
        },
      },
    });

    const mockClient = {
      listCameras: vi.fn().mockResolvedValue({ items: [CAM_101], total: 1 }),
      getCamera: vi.fn().mockResolvedValue(CAM_101),
      listRegions: vi.fn().mockResolvedValue({ items: [revalidationRegion], total: 1 }),
      readSavedPpePolicy: vi.fn().mockResolvedValue({
        cameraId: CAM_ID,
        regionId: null,
        configurationVersion: 3,
        savedRevision: null,
        policy: null,
      }),
      // Fresh reference has viewRevision 2 while saved region was confirmed on viewRevision 1
      getCameraConfigurationReference: vi
        .fn()
        .mockResolvedValue(
          buildRefEnvelope({ configVersion: 3, viewRevision: 2, sourceKind: 'REPLAY' }),
        ),
      updateReferencePolygon,
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          embedded
          apiUrl={API_URL}
          client={mockClient}
          token="token-mgr"
          sessionScope="mgr-scope"
          credentialId={1}
          siteId={SITE_ID}
          zones={[ZONE_1]}
          tourUserId="mgr-1"
        />
      </QueryClientProvider>,
    );

    const getRefBtn = await screen.findByRole('button', { name: 'Get configuration image' });
    await waitFor(() => expect((getRefBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getRefBtn);

    // Source, session, and capture time are visibly shown on the reference card
    const provenance = await screen.findByTestId('reference-provenance-summary');
    expect(provenance.textContent).toContain(CAM_101.externalId);
    expect(provenance.textContent).toContain(SESSION_ID.slice(0, 8));
    expect(provenance.querySelector('time')).toBeTruthy();

    // Region confirmed on view v1 while current reference is view v2 shows revalidation state
    const confStatus = screen.getByTestId('region-geometry-confirmation-status');
    expect(confStatus.getAttribute('data-confirmation-state')).toBe('VIEW_MISMATCH');

    // Open saved geometry from API to revalidate on view v2
    const editBtn = screen.getByRole('button', { name: /Revalidate|Edit Geometry/i });
    fireEvent.click(editBtn);

    expect(await screen.findByTestId('polygon-revalidation-banner')).toBeTruthy();
    expect(screen.getByTestId('polygon-outside-dim-mask')).toBeTruthy();
    expect(screen.getByTestId('camera-full-frame-guide')).toBeTruthy();
    expect(screen.getByTestId('polygon-frame-coverage').textContent).toMatch(/5\.25%|5,25%/);

    // Non-v2 camera tour skips absent polygon-ppe-policy anchor cleanly without pausing or submitting
    fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
    const tour = await screen.findByTestId('safety-task-tour');
    expect(tour.getAttribute('data-tour-step')).toBe('polygon-camera-scope');
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'polygon-frozen-reference',
    );
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'polygon-canvas',
    );
    fireEvent.click(screen.getByTestId('safety-task-tour-skip'));
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    expect(updateReferencePolygon).not.toHaveBeenCalled();

    // UI resize from desktop to 390px must never alter normalized polygon coordinates
    const svg = screen.getByRole('region', { name: 'Camera Region Drawing Canvas' });
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 340,
      height: 191,
      right: 340,
      bottom: 191,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    fireEvent.click(
      within(screen.getByTestId('region-reference-view-consent')).getByRole('checkbox'),
    );
    const saveBtn = screen.getByRole('button', { name: 'Save Region' }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);

    await waitFor(() => expect(updateReferencePolygon).toHaveBeenCalledTimes(1));
    expect(updateReferencePolygon.mock.calls[0]?.[4]?.polygon.coordinates).toEqual([
      [0.15, 0.2],
      [0.45, 0.2],
      [0.3, 0.55],
    ]);
  });

  it('previews affected inheriting vs unaffected custom regions when editing Camera default PPE and purges restricted data on 403/404', async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const regions: RegionResponse[] = [
      {
        id: REG_1_ID,
        cameraId: CAM_ID,
        zoneId: ZONE_1_ID,
        polygon: {
          coordinates: [
            [0.1, 0.1],
            [0.4, 0.1],
            [0.3, 0.4],
          ],
        },
        coordinateSpace: 'NORMALIZED_0_1',
        version: 1,
        isActive: true,
        createdAt: '2026-11-01T00:00:00.000Z',
      },
      {
        id: REG_2_ID,
        cameraId: CAM_ID,
        zoneId: ZONE_2_ID,
        polygon: {
          coordinates: [
            [0.5, 0.5],
            [0.8, 0.5],
            [0.7, 0.8],
          ],
        },
        coordinateSpace: 'NORMALIZED_0_1',
        version: 1,
        isActive: true,
        createdAt: '2026-11-01T00:00:00.000Z',
      },
    ];

    const updateCameraPpePolicy = vi
      .fn<CameraPpeContext['client']['updateCameraPpePolicy']>()
      .mockRejectedValueOnce(new ApiError('http', 'Forbidden', 403));

    const client: CameraPpeContext['client'] = {
      readSavedPpePolicy: vi.fn().mockImplementation(async (_tok, _site, _cam, regionId = null) => {
        const map: Record<string, SavedPpePolicy> = {
          camera: {
            cameraId: CAM_ID,
            regionId: null,
            configurationVersion: 3,
            savedRevision: 3,
            policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
          },
          [REG_1_ID]: {
            cameraId: CAM_ID,
            regionId: REG_1_ID,
            configurationVersion: 3,
            savedRevision: 3,
            policy: { mode: 'INHERIT' },
          },
          [REG_2_ID]: {
            cameraId: CAM_ID,
            regionId: REG_2_ID,
            configurationVersion: 3,
            savedRevision: 3,
            policy: { mode: 'EXPLICIT', requiredPpe: ['GOGGLES'] },
          },
        };
        return map[regionId ?? 'camera']!;
      }),
      listRegions: vi.fn().mockResolvedValue({ items: regions, total: 2 }),
      listZones: vi.fn().mockResolvedValue({ items: [ZONE_1, ZONE_2], total: 2 }),
      initializePpePolicy: vi.fn(),
      updateCameraPpePolicy,
      updateRegionPpePolicy: vi.fn(),
      activateRegionWithPpePolicy: vi.fn(),
    };

    render(
      <QueryClientProvider client={cache}>
        <CameraPpePolicyPanel
          cameraId={CAM_ID}
          camera={CAM_101}
          canWrite
          expandSignal={1}
          context={{
            client,
            token: 'token-mgr',
            siteId: SITE_ID,
            setupKey: ['p2-ppe-impact'],
            onUnauthorized: vi.fn(),
          }}
        />
      </QueryClientProvider>,
    );

    const impactBox = await screen.findByTestId('camera-ppe-affected-regions-preview');
    expect(impactBox.textContent).toContain('Hoist Loading Deck');
    expect(impactBox.textContent).toContain('Welding Bay');

    // Toggling Boots on Camera default previews Hard hat + Boots for inheriting regions
    fireEvent.click(screen.getByRole('checkbox', { name: 'Boots' }));
    expect(within(impactBox).getByText('Boots')).toBeTruthy();

    // 403 on save purges and hides restricted camera/region policy cards
    fireEvent.click(screen.getByRole('button', { name: 'Save PPE policy' }));
    await waitFor(() =>
      expect(
        screen.getByText('You do not have permission to modify PPE policies for this Site.'),
      ).toBeTruthy(),
    );
    expect(screen.queryByTestId('camera-ppe-default-summary')).toBeNull();
    expect(screen.queryByTestId(`camera-ppe-region-card-${REG_1_ID}`)).toBeNull();
  });

  it('offers one-click fresh-reference recovery retaining draft points on 409 conflict and hides cached regions on 403/401', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let currentVersion = 3;
    let refSeq = 1;
    let failNextSaveWith403 = false;
    const onUnauthorized = vi.fn();

    const existingRegion: RegionResponse = {
      id: REG_2_ID,
      cameraId: CAM_ID,
      zoneId: ZONE_1_ID,
      polygon: {
        coordinates: [
          [0.6, 0.6],
          [0.85, 0.6],
          [0.75, 0.85],
        ],
      },
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
      createdAt: '2026-11-01T00:00:00.000Z',
    };

    const createReferenceRegion = vi
      .fn()
      .mockImplementationOnce(async () => {
        currentVersion = 4;
        throw new ApiError('http', 'Version conflict', 409);
      })
      .mockImplementationOnce(async (_tok, _site, _cam, cmd) => {
        if (failNextSaveWith403) {
          throw new ApiError('http', 'Forbidden', 403);
        }
        currentVersion = 5;
        return {
          configurationVersion: 5,
          region: {
            id: REG_1_ID,
            cameraId: CAM_ID,
            zoneId: ZONE_1_ID,
            polygon: cmd.polygon,
            coordinateSpace: 'NORMALIZED_0_1',
            version: 1,
            isActive: true,
            createdAt: new Date().toISOString(),
            geometryConfirmation: {
              status: 'MANUALLY_CONFIRMED',
              referenceId: cmd.referenceId,
              viewRevision: cmd.viewRevision,
              confirmedByUserId: '99999999-9999-4999-8999-999999999999',
              confirmedAt: new Date().toISOString(),
            },
          },
        };
      });

    const mockClient = {
      listCameras: vi.fn().mockImplementation(async () => ({
        items: [{ ...CAM_101, configurationVersion: currentVersion }],
        total: 1,
      })),
      getCamera: vi.fn().mockImplementation(async () => ({
        ...CAM_101,
        configurationVersion: currentVersion,
      })),
      listRegions: vi.fn().mockResolvedValue({ items: [existingRegion], total: 1 }),
      readSavedPpePolicy: vi.fn().mockImplementation(async () => ({
        cameraId: CAM_ID,
        regionId: null,
        configurationVersion: currentVersion,
        savedRevision: null,
        policy: null,
      })),
      getCameraConfigurationReference: vi.fn().mockImplementation(async () =>
        buildRefEnvelope({
          configVersion: currentVersion,
          viewRevision: currentVersion,
          sourceKind: 'LIVE',
          seq: refSeq++,
        }),
      ),
      createReferenceRegion,
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          embedded
          apiUrl={API_URL}
          client={mockClient}
          token="token-mgr"
          sessionScope="mgr-scope-409"
          credentialId={2}
          siteId={SITE_ID}
          zones={[ZONE_1]}
          onUnauthorized={onUnauthorized}
        />
      </QueryClientProvider>,
    );

    const getRefBtn = await screen.findByRole('button', { name: 'Get configuration image' });
    await waitFor(() => expect((getRefBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getRefBtn);

    const startDrawBtn = await screen.findByRole('button', { name: 'Start Drawing Region' });
    await waitFor(() => expect((startDrawBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(startDrawBtn);

    const xInput = await screen.findByLabelText('Point X (0–1)');
    const yInput = screen.getByLabelText('Point Y (0–1)');
    const addBtn = screen.getByRole('button', { name: 'Add Point' });
    for (const [x, y] of [
      ['0.12', '0.18'],
      ['0.38', '0.18'],
      ['0.25', '0.44'],
    ] as const) {
      fireEvent.change(xInput, { target: { value: x } });
      fireEvent.change(yInput, { target: { value: y } });
      fireEvent.click(addBtn);
    }

    fireEvent.click(
      within(screen.getByTestId('region-reference-view-consent')).getByRole('checkbox'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save Region' }));

    // 409 conflict retains 3 draft points and offers one-click reload of latest reference (v4)
    const reloadConflictBtn = await screen.findByTestId('polygon-conflict-reload-reference');
    expect(screen.getByText('Points: 3 / 32')).toBeTruthy();
    fireEvent.click(reloadConflictBtn);

    const useNewBtn = await screen.findByRole('button', { name: 'Use new reference' });
    fireEvent.click(useNewBtn);

    // Draft points are still 3/32 on v4; now trigger 403 to verify cached regions are hidden
    expect(screen.getByText('Points: 3 / 32')).toBeTruthy();
    failNextSaveWith403 = true;
    fireEvent.click(
      within(screen.getByTestId('region-reference-view-consent')).getByRole('checkbox'),
    );
    const retrySaveBtn = screen.getByRole('button', { name: 'Save Region' }) as HTMLButtonElement;
    await waitFor(() => expect(retrySaveBtn.disabled).toBe(false));
    fireEvent.click(retrySaveBtn);

    await waitFor(() =>
      expect(screen.getByText('You do not have permission to perform this action.')).toBeTruthy(),
    );
    expect(screen.queryByRole('button', { name: /Edit Geometry|Revalidate/i })).toBeNull();
  });
});
