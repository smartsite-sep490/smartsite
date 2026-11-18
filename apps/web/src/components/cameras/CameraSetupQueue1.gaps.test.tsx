// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraApplicationStatus } from '@smartsite/contracts/camera-application-status';
import type { CameraResponse, Page, ZoneResponse } from '@smartsite/contracts/management';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import { ZonePpeCameraRegionDrawer } from '../ppe/ZonePpeCameraRegionDrawer';
import { ZonePpeCameraRegionPanel } from '../ppe/ZonePpeCameraRegionPanel';
import type { CameraApplicationStatusContext } from './CameraApplicationStatusSummary';
import { CameraPpePolicyPanel, type CameraPpeContext } from './CameraPpePolicyPanel';
import { CameraSetupCatalog } from './CameraSetupCatalog';
import { CameraSetupContextBar } from './CameraSetupContextPanel';
import type { CameraSetupOpenHandler } from './CameraSetupWorkflow';
import { useSetupCatalog } from './useSetupCatalog';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const ZONE_ID = '22222222-2222-4222-8222-222222222222';
const CAM_101: CameraResponse = {
  id: '00000000-0000-4000-8000-000000000101',
  siteId: SITE_ID,
  externalId: 'rtsp-cam-101',
  code: 'CAM-101',
  name: 'North Crane',
  status: 'ACTIVE',
  configurationVersion: 3,
  createdAt: '2026-11-01T00:00:00.000Z',
};
const CAM_102: CameraResponse = {
  id: '00000000-0000-4000-8000-000000000102',
  siteId: SITE_ID,
  externalId: 'rtsp-cam-102',
  code: 'CAM-102',
  name: 'South Gate',
  status: 'ACTIVE',
  configurationVersion: 2,
  createdAt: '2026-11-01T00:00:00.000Z',
};
const ZONE_A: ZoneResponse = {
  id: ZONE_ID,
  siteId: SITE_ID,
  code: 'ZONE-A',
  name: 'Crane Lifting Bay',
  type: 'STANDARD',
  restrictionPolicy: 'NONE',
  requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
  configurationLocked: false,
  createdAt: '2026-11-01T00:00:00.000Z',
};

function EmptyOrLoadedCatalog({
  items,
  canManage,
  open,
  policyContext,
}: {
  items: CameraResponse[];
  canManage: boolean;
  open: CameraSetupOpenHandler;
  policyContext?: CameraPpeContext;
}) {
  const cameras = useSetupCatalog<CameraResponse>(
    ['q1-catalog-test', SITE_ID, items.length, canManage],
    true,
    async () => ({ items, total: items.length }) satisfies Page<CameraResponse>,
  );
  return (
    <CameraSetupCatalog
      siteId={SITE_ID}
      siteCode="SITE-01"
      siteName="North Yard"
      canOpenMonitoring={!canManage}
      capabilities={{ canManageZones: canManage, canManageRegions: canManage }}
      canReadCameras={true}
      canReadZones={true}
      cameras={cameras}
      rows={cameras.rows}
      cameraError={null}
      open={open}
      policyContext={policyContext}
    />
  );
}

describe('Camera Setup Queue 1 approved missing UI regressions', () => {
  beforeEach(async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders step-flow onboarding on empty catalog for SITE_MANAGER and read-only guidance without setup actions for ADMIN', async () => {
    const open = vi.fn<CameraSetupOpenHandler>();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <EmptyOrLoadedCatalog items={[]} canManage={true} open={open} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const emptyBox = await screen.findByTestId('camera-setup-empty-catalog');
    const zoneStepBtn = within(emptyBox).getByRole('button', { name: 'Step 1 · Set up Zone PPE' });
    const regStepBtn = within(emptyBox).getByRole('button', {
      name: 'Step 2 · Register provisioned camera',
    });
    fireEvent.click(zoneStepBtn);
    expect(open).toHaveBeenCalledWith('zones', undefined, zoneStepBtn);
    fireEvent.click(regStepBtn);
    expect(open).toHaveBeenCalledWith('register', undefined, regStepBtn);

    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <EmptyOrLoadedCatalog items={[]} canManage={false} open={open} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const adminEmptyBox = await screen.findByTestId('camera-setup-empty-catalog');
    expect(within(adminEmptyBox).queryByRole('button')).toBeNull();
    expect(adminEmptyBox.textContent).toMatch(/Site Manager/i);
  });

  it('surfaces Source ID, quick camera switcher, direct PPE policy open CTA, and scope-preserving monitoring links', async () => {
    const open = vi.fn<CameraSetupOpenHandler>();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const policyContext: CameraPpeContext = {
      setupKey: ['q1-ppe-test'],
      token: 'token-mgr',
      siteId: SITE_ID,
      onUnauthorized: vi.fn(),
      client: {
        readSavedPpePolicy: vi.fn().mockResolvedValue({
          cameraId: CAM_101.id,
          regionId: null,
          configurationVersion: 3,
          savedRevision: 3,
          policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
        }),
        listRegions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
        initializePpePolicy: vi.fn(),
        updateCameraPpePolicy: vi.fn(),
        updateRegionPpePolicy: vi.fn(),
        activateRegionWithPpePolicy: vi.fn(),
      },
    };

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <EmptyOrLoadedCatalog
            items={[CAM_101, CAM_102]}
            canManage={true}
            open={open}
            policyContext={policyContext}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByRole('listitem', { name: CAM_101.name });
    expect(screen.getByTestId('selected-camera-source-id').textContent).toContain('rtsp-cam-101');
    expect(screen.getAllByTestId('camera-row-source-id')[0]?.textContent).toContain('rtsp-cam-101');

    // Quick camera switcher changes selected camera
    const quickSelect = screen.getByTestId('camera-setup-quick-select') as HTMLSelectElement;
    fireEvent.change(quickSelect, { target: { value: CAM_102.id } });
    expect(screen.getByTestId('selected-camera-source-id').textContent).toContain('rtsp-cam-102');

    // Direct Configure PPE policy button expands CameraPpePolicyPanel
    const ppePanel = screen.getByTestId('camera-ppe-policy-panel');
    expect(
      within(ppePanel)
        .getByRole('button', { name: 'Camera PPE policy' })
        .getAttribute('aria-expanded'),
    ).toBe('false');
    fireEvent.click(screen.getByTestId('selected-camera-open-ppe'));
    expect(
      within(ppePanel)
        .getByRole('button', { name: 'Camera PPE policy' })
        .getAttribute('aria-expanded'),
    ).toBe('true');

    // F6: Collapsing PPE panel on CAM-102 and switching back to CAM-101 must NOT auto-expand CAM-101
    fireEvent.click(within(ppePanel).getByRole('button', { name: 'Camera PPE policy' }));
    expect(
      within(ppePanel)
        .getByRole('button', { name: 'Camera PPE policy' })
        .getAttribute('aria-expanded'),
    ).toBe('false');
    fireEvent.change(quickSelect, { target: { value: CAM_101.id } });
    expect(
      within(screen.getByTestId('camera-ppe-policy-panel'))
        .getByRole('button', { name: 'Camera PPE policy' })
        .getAttribute('aria-expanded'),
    ).toBe('false');

    // Monitoring links preserve siteId and cameraId when authorized
    cleanup();
    render(
      <MemoryRouter>
        <CameraSetupContextBar
          siteId={SITE_ID}
          siteCode="SITE-01"
          siteName="North Yard"
          rows={[CAM_101]}
          selectedCamera={CAM_101}
          canManageCameras={false}
          canOpenMonitoring={true}
          open={open}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('selected-camera-monitor-ppe').getAttribute('href')).toBe(
      `/ppe?siteId=${SITE_ID}&cameraId=${CAM_101.id}`,
    );
    expect(screen.getByTestId('selected-camera-monitor-zones').getAttribute('href')).toBe(
      `/zones?siteId=${SITE_ID}&cameraId=${CAM_101.id}`,
    );
  });

  it('surfaces actionable worker/source reason guidance directly on non-LOADED camera status in EN and VI', async () => {
    const nowIso = new Date().toISOString();
    const getCameraApplicationStatus = vi.fn().mockResolvedValue({
      siteId: SITE_ID,
      cameraId: CAM_101.id,
      desiredRevision: 3,
      reportedRevision: null,
      applicationState: 'UNCONFIRMED',
      viewValidity: 'UNAVAILABLE',
      reasonCode: 'VIEW_UNAVAILABLE',
      lastReceiptAt: null,
      observedAt: nowIso,
    } satisfies CameraApplicationStatus);
    const statusContext: CameraApplicationStatusContext = {
      setupKey: ['q1-status'],
      token: 'token',
      siteId: SITE_ID,
      client: { getCameraApplicationStatus },
      enabled: true,
      onUnauthorized: vi.fn(),
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <CameraSetupContextBar
          rows={[CAM_101]}
          selectedCamera={CAM_101}
          canManageCameras={true}
          canOpenMonitoring={false}
          open={vi.fn()}
          statusContext={statusContext}
        />
      </QueryClientProvider>,
    );

    const guidance = await screen.findByTestId('camera-application-reason-guidance');
    expect(guidance.textContent).toMatch(/Current reference view is unavailable/i);
    expect(guidance.textContent).toMatch(/load a fresh configuration image in Regions/i);

    await i18n.changeLanguage('vi');
    await waitFor(() => {
      expect(screen.getByTestId('camera-application-reason-guidance').textContent).toMatch(
        /Vùng quan sát|ảnh cấu hình/i,
      );
    });
  });

  it('shows unsaved draft reset and actionable HTTP 409 conflict message in CameraPpePolicyPanel', async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const updateCameraPpePolicy = vi
      .fn<CameraPpeContext['client']['updateCameraPpePolicy']>()
      .mockRejectedValueOnce(new ApiError('http', 'Version conflict', 409));
    const client: CameraPpeContext['client'] = {
      readSavedPpePolicy: vi.fn().mockResolvedValue({
        cameraId: CAM_101.id,
        regionId: null,
        configurationVersion: 3,
        savedRevision: 3,
        policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
      }),
      listRegions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      initializePpePolicy: vi.fn(),
      updateCameraPpePolicy,
      updateRegionPpePolicy: vi.fn(),
      activateRegionWithPpePolicy: vi.fn(),
    };

    render(
      <QueryClientProvider client={cache}>
        <CameraPpePolicyPanel
          context={{
            client,
            token: 't',
            siteId: SITE_ID,
            setupKey: ['q1-409'],
            onUnauthorized: vi.fn(),
          }}
          cameraId={CAM_101.id}
          canWrite
          expandSignal={1}
        />
      </QueryClientProvider>,
    );

    const vestBox = await screen.findByRole('checkbox', { name: 'Safety vest' });
    expect(document.querySelector('fieldset legend')?.textContent).toBe('Camera default');
    expect(screen.queryByTestId('camera-ppe-unsaved-draft')).toBeNull();
    fireEvent.click(vestBox);
    expect(screen.getByTestId('camera-ppe-unsaved-draft')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save PPE policy' }));
    const conflictAlert = await screen.findByRole('alert');
    expect(conflictAlert.textContent).toMatch(
      /configuration changed or the camera view needs confirmation/i,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset draft' }));
    expect(screen.queryByTestId('camera-ppe-unsaved-draft')).toBeNull();
  });

  it('preserves per-region bindings on 409 during initial v2 PPE setup, invalidates setupKey, and never marks inactive regions Worker applied', async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    cache.setQueryData(['setup-parent-key'], { staleMarker: true });
    cache.setQueryData(['status-parent-key'], { staleMarker: true });
    const invalidateSpy = vi.spyOn(cache, 'invalidateQueries');

    const regActiveId = '77777777-7777-4777-8777-777777777701';
    const regInactiveId = '77777777-7777-4777-8777-777777777702';
    let initializedRemotely = false;

    const client: CameraPpeContext['client'] = {
      readSavedPpePolicy: vi.fn().mockImplementation(async (_tok, _site, camId, regId = null) => {
        if (!initializedRemotely) {
          return {
            cameraId: camId,
            regionId: regId,
            configurationVersion: 3,
            savedRevision: null,
            policy: null,
          };
        }
        return {
          cameraId: camId,
          regionId: regId,
          configurationVersion: 4,
          savedRevision: 4,
          policy: regId
            ? { mode: 'INHERIT' }
            : { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT', 'SAFETY_VEST'] },
        };
      }),
      listRegions: vi.fn().mockResolvedValue({
        items: [
          {
            id: regActiveId,
            cameraId: CAM_101.id,
            zoneId: ZONE_A.id,
            polygon: {
              coordinates: [
                [0.1, 0.1],
                [0.4, 0.1],
                [0.4, 0.4],
              ],
            },
            coordinateSpace: 'NORMALIZED_0_1',
            version: 1,
            isActive: true,
            createdAt: '2026-11-01T00:00:00.000Z',
          },
          {
            id: regInactiveId,
            cameraId: CAM_101.id,
            zoneId: ZONE_A.id,
            polygon: {
              coordinates: [
                [0.5, 0.5],
                [0.8, 0.5],
                [0.8, 0.8],
              ],
            },
            coordinateSpace: 'NORMALIZED_0_1',
            version: 1,
            isActive: false,
            createdAt: '2026-11-01T00:00:00.000Z',
          },
        ],
        total: 2,
      }),
      listZones: vi.fn().mockResolvedValue({ items: [ZONE_A], total: 1 }),
      initializePpePolicy: vi.fn().mockImplementation(async () => {
        initializedRemotely = true;
        throw new ApiError('http', 'Initialized concurrently', 409);
      }),
      updateCameraPpePolicy: vi.fn().mockResolvedValue({
        cameraId: CAM_101.id,
        regionId: null,
        configurationVersion: 5,
        savedRevision: 5,
        policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
      }),
      updateRegionPpePolicy: vi.fn(),
      activateRegionWithPpePolicy: vi.fn(),
    };

    const nowIso = new Date().toISOString();
    const statusClient = {
      getCameraApplicationStatus: vi.fn().mockResolvedValue({
        cameraId: CAM_101.id,
        siteId: SITE_ID,
        desiredRevision: 4,
        reportedRevision: 4,
        applicationState: 'LOADED',
        viewValidity: 'UNCONFIRMED',
        reasonCode: null,
        lastReceiptAt: nowIso,
        observedAt: nowIso,
      }),
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={cache}>
        <CameraPpePolicyPanel
          context={{
            client,
            token: 't',
            siteId: SITE_ID,
            setupKey: ['setup-parent-key'],
            onUnauthorized: vi.fn(),
          }}
          statusContext={{
            setupKey: ['status-parent-key'],
            token: 't',
            siteId: SITE_ID,
            client: statusClient,
            enabled: true,
            onUnauthorized: vi.fn(),
          }}
          cameraId={CAM_101.id}
          canWrite
          expandSignal={1}
        />
      </QueryClientProvider>,
    );

    const modeSelects = (await screen.findAllByLabelText('Policy mode')) as HTMLSelectElement[];
    expect(modeSelects).toHaveLength(2);
    fireEvent.change(modeSelects[0]!, { target: { value: 'EXPLICIT' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Hard hat' }));
    fireEvent.change(modeSelects[1]!, { target: { value: 'DISABLED' } });
    fireEvent.change(await screen.findByLabelText('Reason'), {
      target: { value: 'Public sidewalk buffer' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Initialize PPE policies' }));
    await screen.findByRole('alert');

    // F3: 409 invalidates parent setupKey & statusContext.setupKey
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['setup-parent-key'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['status-parent-key'] });

    // Wait for reload into non-initial mode (v4)
    const scopeSelect = (await screen.findByLabelText('Policy scope')) as HTMLSelectElement;
    expect(await screen.findByTestId('camera-ppe-preserved-region-drafts')).toBeTruthy();

    // F9a: Inactive region with saved v2 policy must NOT display "Worker applied (v4)"
    await waitFor(() => {
      const inactiveCard = screen.getByTestId(`camera-ppe-region-card-${regInactiveId}`);
      expect(inactiveCard.textContent).not.toMatch(/Worker applied/i);
      expect(inactiveCard.textContent).toMatch(/Region inactive/i);
    });

    // F3: Saving camera default does NOT wipe preserved per-region draft
    fireEvent.click(screen.getByRole('button', { name: 'Save PPE policy' }));
    await waitFor(() => expect(client.updateCameraPpePolicy).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('camera-ppe-preserved-region-drafts')).toBeTruthy();

    // Selecting regActiveId loads preserved DISABLED + reason draft instead of server's INHERIT
    fireEvent.change(scopeSelect, { target: { value: regActiveId } });
    expect((screen.getByLabelText('Policy mode') as HTMLSelectElement).value).toBe('DISABLED');
    expect((screen.getByLabelText('Reason') as HTMLInputElement).value).toBe(
      'Public sidewalk buffer',
    );
  });

  it('renders state-specific polygon readiness hints, v2 new-region effective PPE preview, and save readiness feedback', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mockClient = {
      listCameras: vi.fn().mockResolvedValue({ items: [CAM_101], total: 1 }),
      listRegions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      readSavedPpePolicy: vi.fn().mockResolvedValue({
        cameraId: CAM_101.id,
        regionId: null,
        configurationVersion: 3,
        savedRevision: 3,
        policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT', 'SAFETY_VEST'] },
      }),
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          embedded
          apiUrl="http://127.0.0.1:49999"
          token="token-mgr"
          sessionScope="mgr-scope"
          credentialId={1}
          siteId={SITE_ID}
          zones={[]}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('region-start-drawing-hint').textContent).toMatch(
      /Create at least one Zone/i,
    );

    cleanup();
    const capturedIso = new Date().toISOString();
    const futureIso = new Date(Date.now() + 240_000).toISOString();
    const sessionId = '33333333-3333-4333-8333-333333333333';
    const imageSha256 = 'a'.repeat(64);
    const mockImage = new Image();
    Object.defineProperty(mockImage, 'naturalWidth', { value: 640 });
    Object.defineProperty(mockImage, 'naturalHeight', { value: 360 });
    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionDrawer
          apiUrl="http://127.0.0.1:49999"
          client={mockClient}
          token="token-mgr"
          sessionScope="mgr-scope"
          credentialId={1}
          internalNonce={1}
          siteId={SITE_ID}
          selectedCamera={CAM_101}
          selectedZone={ZONE_A}
          frozenReference={{
            schemaVersion: 1,
            purpose: 'REGION_CONFIGURATION',
            sourceKind: 'LIVE',
            cameraId: CAM_101.id,
            siteId: SITE_ID,
            configurationVersion: 3,
            referenceExpiresAt: futureIso,
            frame: {
              cameraExternalId: CAM_101.externalId,
              sessionId,
              sequenceNumber: '1',
              capturedAt: capturedIso,
              width: 640,
              height: 360,
              imageDataUrl:
                'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
              imageSha256,
            },
            issuedReference: {
              schemaVersion: '1.0.0',
              purpose: 'REGION_CONFIGURATION',
              sourceKind: 'LIVE',
              referenceId: '44444444-4444-4444-8444-444444444444',
              siteId: SITE_ID,
              cameraId: CAM_101.id,
              sessionId,
              imageSha256,
              width: 640,
              height: 360,
              capturedAt: capturedIso,
              issuedAt: capturedIso,
              expiresAt: futureIso,
              configurationVersion: 3,
              viewRevision: 1,
            },
            image: mockImage,
          }}
          candidateReference={null}
          lastSavedDraft={null}
          onAcceptCandidateReference={vi.fn()}
          onCancelCandidateReview={vi.fn()}
          onScopeRevoked={vi.fn()}
          onSaveSuccess={vi.fn()}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('polygon-save-readiness').textContent).toMatch(
      /Add at least 3 more point/i,
    );
    const modeSelect = await screen.findByLabelText('Policy mode');
    fireEvent.change(modeSelect, { target: { value: 'INHERIT' } });
    expect(await screen.findByTestId('camera-ppe-draft-preview')).toBeTruthy();

    // F8: 3 collinear points must NOT show Ready to save or enable Save Region; valid >=3 renders <polygon>
    const xInput = screen.getByLabelText('Point X (0–1)');
    const yInput = screen.getByLabelText('Point Y (0–1)');
    const addBtn = screen.getByRole('button', { name: 'Add Point' });
    for (const [x, y] of [
      ['0.1', '0.5'],
      ['0.5', '0.5'],
      ['0.9', '0.5'],
    ] as const) {
      fireEvent.change(xInput, { target: { value: x } });
      fireEvent.change(yInput, { target: { value: y } });
      fireEvent.click(addBtn);
    }
    fireEvent.click(
      within(screen.getByTestId('region-reference-view-consent')).getByRole('checkbox'),
    );
    expect(screen.getByTestId('polygon-save-readiness').textContent).toMatch(/zero or degenerate/i);
    expect(
      (screen.getByRole('button', { name: 'Save Region' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Undo Point' }));
    fireEvent.change(xInput, { target: { value: '0.5' } });
    fireEvent.change(yInput, { target: { value: '0.9' } });
    fireEvent.click(addBtn);
    expect(document.querySelector('svg polygon')).toBeTruthy();
  });

  it('guards dirty Zone/Camera switches (F7), invalidates camera-setup by credentialId (F4), and blocks stale-reference 409 traps after save (F2)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const apiUrl = 'http://127.0.0.1:49999';
    const zoneB: ZoneResponse = {
      ...ZONE_A,
      id: '55555555-5555-4555-8555-555555555502',
      code: 'Z-02',
      name: 'South Gate',
    };
    let currentCamVersion = 3;
    let refSeq = 1;
    const sessionId = '33333333-3333-4333-8333-333333333333';
    const imageSha256 = 'b'.repeat(64);
    const tinyJpegBytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x68, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
    ]);
    const tinyJpeg = `data:image/jpeg;base64,${btoa(String.fromCharCode(...tinyJpegBytes))}`;

    const buildRefResponse = (version: number) => {
      const capturedIso = new Date().toISOString();
      const expIso = new Date(Date.now() + 240_000).toISOString();
      const seq = String(refSeq++);
      return {
        viewValidity: 'UNCONFIRMED' as const,
        image: {
          schemaVersion: 1 as const,
          purpose: 'REGION_CONFIGURATION' as const,
          sourceKind: 'LIVE' as const,
          siteId: SITE_ID,
          cameraId: CAM_101.id,
          configurationVersion: version,
          referenceExpiresAt: expIso,
          frame: {
            cameraExternalId: CAM_101.externalId,
            sessionId,
            sequenceNumber: seq,
            capturedAt: capturedIso,
            width: 640,
            height: 360,
            imageDataUrl: tinyJpeg,
            imageSha256,
          },
        },
        reference: {
          schemaVersion: '1.0.0' as const,
          purpose: 'REGION_CONFIGURATION' as const,
          sourceKind: 'LIVE' as const,
          referenceId: `66666666-6666-4666-8666-66666666660${seq}`,
          siteId: SITE_ID,
          cameraId: CAM_101.id,
          sessionId,
          imageSha256,
          width: 640,
          height: 360,
          capturedAt: capturedIso,
          issuedAt: capturedIso,
          expiresAt: expIso,
          configurationVersion: version,
          viewRevision: Number(seq),
        },
      };
    };

    const origImage = globalThis.Image;
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

    try {
      const mockClient = {
        listCameras: vi.fn().mockImplementation(async () => ({
          items: [{ ...CAM_101, configurationVersion: currentCamVersion }],
          total: 1,
        })),
        getCamera: vi.fn().mockImplementation(async () => ({
          ...CAM_101,
          configurationVersion: currentCamVersion,
        })),
        listRegions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
        readSavedPpePolicy: vi.fn().mockImplementation(async () => ({
          cameraId: CAM_101.id,
          regionId: null,
          configurationVersion: currentCamVersion,
          savedRevision: null,
          policy: null,
        })),
        getCameraConfigurationReference: vi
          .fn()
          .mockImplementation(async () => buildRefResponse(currentCamVersion)),
        createReferenceRegion: vi.fn().mockImplementation(async () => {
          currentCamVersion = 4;
          return {
            configurationVersion: 4,
            region: {
              id: '88888888-8888-4888-8888-888888888888',
              cameraId: CAM_101.id,
              zoneId: ZONE_A.id,
              polygon: {
                coordinates: [
                  [0.1, 0.2],
                  [0.6, 0.2],
                  [0.4, 0.8],
                ],
              },
              coordinateSpace: 'NORMALIZED_0_1',
              version: 1,
              isActive: true,
              createdAt: new Date().toISOString(),
              geometryConfirmation: {
                status: 'MANUALLY_CONFIRMED',
                referenceId: '66666666-6666-4666-8666-666666666601',
                viewRevision: 1,
                confirmedByUserId: '99999999-9999-4999-8999-999999999999',
                confirmedAt: new Date().toISOString(),
              },
            },
          };
        }),
      } as unknown as SmartSiteManagementClient;

      // Seed camera-setup queries with credentialId = 77 (distinct from panel internalNonce = 1)
      const camSetupKey = [
        'camera-setup',
        apiUrl,
        'mgr-scope',
        'mgr-1',
        77,
        [],
        SITE_ID,
        'cameras',
      ];
      const appStatusKey = [
        'camera-setup',
        apiUrl,
        'mgr-scope',
        'mgr-1',
        77,
        [],
        SITE_ID,
        'application-status',
        CAM_101.id,
      ];
      queryClient.setQueryData(camSetupKey, { pages: [], pageParams: [] });
      queryClient.setQueryData(appStatusKey, { status: 'LOADED' });

      render(
        <QueryClientProvider client={queryClient}>
          <ZonePpeCameraRegionPanel
            embedded
            apiUrl={apiUrl}
            client={mockClient}
            token="token-mgr"
            sessionScope="mgr-scope"
            credentialId={77}
            siteId={SITE_ID}
            zones={[ZONE_A, zoneB]}
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
        ['0.1', '0.2'],
        ['0.6', '0.2'],
        ['0.4', '0.8'],
      ] as const) {
        fireEvent.change(xInput, { target: { value: x } });
        fireEvent.change(yInput, { target: { value: y } });
        fireEvent.click(addBtn);
      }

      // F7: Switching Zone while draft is dirty prompts confirmation instead of wiping points
      fireEvent.change(screen.getByLabelText('Select Zone'), { target: { value: zoneB.id } });
      const discardPrompt = await screen.findByTestId('region-scope-discard-prompt');
      fireEvent.click(within(discardPrompt).getByRole('button', { name: 'Keep Editing' }));
      expect(screen.queryByTestId('region-scope-discard-prompt')).toBeNull();
      expect((screen.getByLabelText('Select Zone') as HTMLSelectElement).value).toBe(ZONE_A.id);

      // Save region (v3 -> v4)
      fireEvent.click(
        within(screen.getByTestId('region-reference-view-consent')).getByRole('checkbox'),
      );
      const saveBtn = screen.getByRole('button', { name: 'Save Region' }) as HTMLButtonElement;
      await waitFor(() => expect(saveBtn.disabled).toBe(false));
      fireEvent.click(saveBtn);
      await screen.findByTestId('region-saved-feedback');

      // F4: camera-setup queries keyed by credentialId = 77 were invalidated
      expect(queryClient.getQueryState(camSetupKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(appStatusKey)?.isInvalidated).toBe(true);

      // F2: Moving/adding a point on stale v3 reference must NOT report Ready to save or enable Save Region
      fireEvent.change(xInput, { target: { value: '0.2' } });
      fireEvent.change(yInput, { target: { value: '0.75' } });
      fireEvent.click(addBtn);
      fireEvent.click(
        within(screen.getByTestId('region-reference-view-consent')).getByRole('checkbox'),
      );
      expect(screen.getByTestId('polygon-save-readiness').textContent).not.toMatch(
        /Ready to save/i,
      );
      expect(screen.getByTestId('polygon-save-readiness').textContent).toMatch(
        /v3.*v4|fresh reference/i,
      );
      expect(
        (screen.getByRole('button', { name: 'Save Region' }) as HTMLButtonElement).disabled,
      ).toBe(true);

      // Accepting fresh v4 reference clears reload button and unblocks editing on v4
      fireEvent.click(screen.getByTestId('region-saved-reload-reference'));
      fireEvent.click(await screen.findByRole('button', { name: 'Use new reference' }));
      expect(screen.queryByTestId('region-saved-reload-reference')).toBeNull();
    } finally {
      globalThis.Image = origImage;
    }
  });

  it('places PPE requirements and save controls in a beside-canvas inspector column while keeping canvas first in DOM, preserving tour anchors, and collapsing pre-draw chrome', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const futureIso = new Date(Date.now() + 240_000).toISOString();
    const capturedIso = new Date(Date.parse(futureIso) - 60_000).toISOString();
    const sessionId = '33333333-3333-4333-8333-333333333333';
    const imageSha256 = 'a'.repeat(64);
    const tinyJpegBytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x68, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
    ]);
    const tinyJpeg = `data:image/jpeg;base64,${btoa(String.fromCharCode(...tinyJpegBytes))}`;

    const origImage = globalThis.Image;
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

    try {
      const mockClient = {
        listCameras: vi.fn().mockResolvedValue({ items: [CAM_101], total: 1 }),
        getCamera: vi.fn().mockResolvedValue(CAM_101),
        listRegions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
        readSavedPpePolicy: vi.fn().mockResolvedValue({
          cameraId: CAM_101.id,
          regionId: null,
          configurationVersion: 3,
          savedRevision: 3,
          policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT', 'SAFETY_VEST'] },
        }),
        getCameraConfigurationReference: vi.fn().mockResolvedValue({
          viewValidity: 'UNCONFIRMED',
          image: {
            schemaVersion: 1,
            purpose: 'REGION_CONFIGURATION',
            sourceKind: 'LIVE',
            siteId: SITE_ID,
            cameraId: CAM_101.id,
            configurationVersion: 3,
            referenceExpiresAt: futureIso,
            frame: {
              cameraExternalId: CAM_101.externalId,
              sessionId,
              sequenceNumber: '1',
              capturedAt: capturedIso,
              width: 640,
              height: 360,
              imageDataUrl: tinyJpeg,
              imageSha256,
            },
          },
          reference: {
            schemaVersion: '1.0.0',
            purpose: 'REGION_CONFIGURATION',
            sourceKind: 'LIVE',
            referenceId: '44444444-4444-4444-8444-444444444444',
            siteId: SITE_ID,
            cameraId: CAM_101.id,
            sessionId,
            imageSha256,
            width: 640,
            height: 360,
            capturedAt: capturedIso,
            issuedAt: capturedIso,
            expiresAt: futureIso,
            configurationVersion: 3,
            viewRevision: 1,
          },
        }),
      } as unknown as SmartSiteManagementClient;

      render(
        <QueryClientProvider client={queryClient}>
          <ZonePpeCameraRegionPanel
            embedded
            apiUrl="http://127.0.0.1:49998"
            client={mockClient}
            token="token-mgr"
            sessionScope="mgr-layout"
            credentialId={88}
            siteId={SITE_ID}
            zones={[ZONE_A]}
          />
        </QueryClientProvider>,
      );

      const getRefBtn = await screen.findByRole('button', { name: 'Get configuration image' });
      await waitFor(() => expect((getRefBtn as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(getRefBtn);

      const startDrawBtn = await screen.findByRole('button', { name: 'Start Drawing Region' });
      await waitFor(() => expect((startDrawBtn as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(startDrawBtn);

      // Redundant disabled Start Drawing button row collapses into compact status badge while drawing
      expect(screen.queryByRole('button', { name: 'Drawing Active' })).toBeNull();
      expect(screen.getByTestId('reference-drawing-active-badge').textContent).toContain(
        'Drawing Active',
      );

      const contextBar = await screen.findByTestId('polygon-authoring-context');
      expect(contextBar.textContent).toContain('ZONE-A');
      expect(contextBar.textContent).toContain('CAM-101');
      expect(contextBar.textContent).toContain('640×360');

      const layoutGrid = screen.getByTestId('polygon-authoring-layout');
      expect(layoutGrid.className).toContain('grid-cols-1');
      expect(layoutGrid.className).toMatch(/xl:grid-cols-/);

      const canvasCol = screen.getByTestId('polygon-canvas-column');
      const inspectorCol = screen.getByTestId('polygon-inspector-column');
      expect(
        Boolean(canvasCol.compareDocumentPosition(inspectorCol) & Node.DOCUMENT_POSITION_FOLLOWING),
      ).toBe(true);
      expect(canvasCol.querySelector('[data-tour-anchor="polygon-canvas"]')).toBeTruthy();
      expect(canvasCol.querySelector('[data-tour-anchor="polygon-edit-controls"]')).toBeTruthy();

      const policySelect = await within(inspectorCol).findByLabelText('Policy mode');
      expect(
        inspectorCol.querySelector('[data-tour-anchor="polygon-frozen-reference"] > fieldset'),
      ).toBeTruthy();
      expect(inspectorCol.querySelector('fieldset legend')?.textContent).toBe('Region PPE policy');
      expect(within(inspectorCol).queryByText('Camera PPE policy')).toBeNull();

      await i18n.changeLanguage('vi');
      await waitFor(() => {
        expect(inspectorCol.querySelector('fieldset legend')?.textContent).toBe(
          'Chính sách PPE của vùng',
        );
      });
      await i18n.changeLanguage('en');
      await waitFor(() => {
        expect(inspectorCol.querySelector('fieldset legend')?.textContent).toBe(
          'Region PPE policy',
        );
      });
      expect(inspectorCol.querySelector('[data-tour-anchor="polygon-save-footer"]')).toBeTruthy();
      expect(within(inspectorCol).getByRole('button', { name: 'Save Region' })).toBeTruthy();

      // Escape inside adjacent inspector column still guards dirty polygon points
      fireEvent.change(screen.getByLabelText('Point X (0–1)'), { target: { value: '0.25' } });
      fireEvent.change(screen.getByLabelText('Point Y (0–1)'), { target: { value: '0.35' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add Point' }));

      policySelect.focus();
      fireEvent.keyDown(policySelect, { key: 'Escape' });
      expect(screen.getByText('Discard unsaved region geometry changes?')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Keep Editing' }));
      expect(screen.queryByText('Discard unsaved region geometry changes?')).toBeNull();

      // Confirming discard restores pre-draw Start Drawing Region button
      fireEvent.click(screen.getByRole('button', { name: 'Cancel Drawing' }));
      fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
      expect(await screen.findByRole('button', { name: 'Start Drawing Region' })).toBeTruthy();
    } finally {
      globalThis.Image = origImage;
    }
  });
});
