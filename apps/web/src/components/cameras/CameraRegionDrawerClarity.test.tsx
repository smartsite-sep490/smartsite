// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraResponse, RegionResponse, ZoneResponse } from '@smartsite/contracts/management';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import { CameraRegionList } from '../ppe/CameraRegionList';
import { CameraRegionSelectionControls } from '../ppe/CameraRegionSelectionControls';
import type { CameraConfigurationReference } from '../ppe/useCameraConfigurationReference';
import { ZonePpeCameraRegionDrawer } from '../ppe/ZonePpeCameraRegionDrawer';
import { CameraPpePolicyPanel, type CameraPpeContext } from './CameraPpePolicyPanel';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAMERA_ID = '22222222-2222-4222-8222-222222222222';
const SHARED_ZONE_ID = '5f8a3b12-9012-4a67-8cde-1234567890ab';
const LONG_ZONE_ID = '9d1c4e77-1111-4222-8333-abcdef012345';
const GENERATED_SHARED_CODE = 'ZONE-5F8A3B12-9012-4A67-8CDE-1234567890AB';
const GENERATED_LONG_CODE = 'ZONE-9D1C4E77-1111-4222-8333-ABCDEF012345';
const LONG_ZONE_NAME = 'North Tower Hoist Material Unloading and Heavy Rigging Inspection Apron';
const REGION_EDIT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

const CAMERA_FIXTURE: CameraResponse = {
  type: 'ZONE' as const,
  gateId: null,
  id: CAMERA_ID,
  siteId: SITE_ID,
  code: 'SETUP-CLIP',
  name: 'Recorded Setup Camera',
  externalId: 'camera-a',
  status: 'ACTIVE',
  configurationVersion: 4,
  createdAt: '2026-11-18T00:00:00.000Z',
};

function makeRegion(id: string, zoneId: string, version: number): RegionResponse {
  return {
    id,
    cameraId: CAMERA_ID,
    zoneId,
    polygon: {
      coordinates: [
        [0.14, 0.18],
        [0.46, 0.18],
        [0.46, 0.56],
        [0.14, 0.56],
      ],
    },
    coordinateSpace: 'NORMALIZED_0_1',
    version,
    isActive: true,
    createdAt: '2026-11-18T00:00:00.000Z',
  };
}

describe('Region drawer human-first labels and duplicate-Zone-name disambiguation', () => {
  beforeEach(async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('aligns region drawer selectors and authoring context with human Zone and camera names first while preserving selection keys, disambiguation, image provenance, and technical IDs in collapsible details (EN/VI)', async () => {
    const dupZone1Id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
    const dupZone2Id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
    const zones: ZoneResponse[] = [
      {
        id: SHARED_ZONE_ID,
        siteId: SITE_ID,
        code: GENERATED_SHARED_CODE,
        name: 'Setup review zone',
        type: 'HAZARDOUS',
        restrictionPolicy: 'NONE',
        requiredPpe: ['HARD_HAT'],
        configurationLocked: true,
        createdAt: '2026-11-18T00:00:00.000Z',
      },
      {
        id: LONG_ZONE_ID,
        siteId: SITE_ID,
        code: GENERATED_LONG_CODE,
        name: LONG_ZONE_NAME,
        type: 'STANDARD',
        restrictionPolicy: 'NONE',
        requiredPpe: ['HARD_HAT'],
        configurationLocked: true,
        createdAt: '2026-11-18T00:00:00.000Z',
      },
      {
        id: dupZone1Id,
        siteId: SITE_ID,
        code: 'ZONE-DUP-01',
        name: 'Staging Gate',
        type: 'STANDARD',
        restrictionPolicy: 'NONE',
        requiredPpe: ['HARD_HAT'],
        configurationLocked: false,
        createdAt: '2026-11-18T00:00:00.000Z',
      },
      {
        id: dupZone2Id,
        siteId: SITE_ID,
        code: 'ZONE-DUP-02',
        name: 'Staging Gate',
        type: 'STANDARD',
        restrictionPolicy: 'NONE',
        requiredPpe: ['HARD_HAT'],
        configurationLocked: false,
        createdAt: '2026-11-18T00:00:00.000Z',
      },
    ];

    const expiresAt = new Date(Date.now() + 240_000).toISOString();
    const capturedAt = new Date(Date.parse(expiresAt) - 60_000).toISOString();
    const sessionId = '44444444-4444-4444-8444-444444444444';
    const imageSha256 = 'a'.repeat(64);
    const mockImage = new Image();
    Object.defineProperty(mockImage, 'naturalWidth', { value: 640 });
    Object.defineProperty(mockImage, 'naturalHeight', { value: 360 });
    const frozenReference: CameraConfigurationReference = {
      schemaVersion: 1,
      purpose: 'REGION_CONFIGURATION',
      sourceKind: 'LIVE',
      cameraId: CAMERA_ID,
      siteId: SITE_ID,
      configurationVersion: 4,
      referenceExpiresAt: expiresAt,
      frame: {
        cameraExternalId: CAMERA_FIXTURE.externalId,
        sessionId,
        sequenceNumber: '1',
        capturedAt,
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
        referenceId: '55555555-5555-4555-8555-555555555555',
        siteId: SITE_ID,
        cameraId: CAMERA_ID,
        sessionId,
        imageSha256,
        width: 640,
        height: 360,
        capturedAt,
        issuedAt: capturedAt,
        expiresAt,
        configurationVersion: 4,
        viewRevision: 1,
      },
      image: mockImage,
    };

    const onZoneChange = vi.fn();
    const onCameraChange = vi.fn();
    const mockClient = {
      readSavedPpePolicy: vi.fn().mockResolvedValue({
        cameraId: CAMERA_ID,
        regionId: null,
        configurationVersion: 4,
        savedRevision: 4,
        policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
      }),
    } as unknown as SmartSiteManagementClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <CameraRegionSelectionControls
          zones={zones}
          selectedZoneId={SHARED_ZONE_ID}
          onZoneChange={onZoneChange}
          selectedCameraId={CAMERA_ID}
          onCameraChange={onCameraChange}
          allFetchedCameras={[CAMERA_FIXTURE]}
          visibleActiveCameras={[CAMERA_FIXTURE]}
          cameraServerTotal={1}
          isCamerasInitialLoading={false}
          cameraError={null}
          isCameraBaseError={false}
          isTransientNextCameraError={false}
          isFetchingCameras={false}
          hasNextCameraPage={false}
          onRetryInitialCameras={vi.fn()}
          onFetchNextCameras={vi.fn()}
        />
        <ZonePpeCameraRegionDrawer
          apiUrl="http://127.0.0.1:49999"
          client={mockClient}
          token="token-mgr"
          sessionScope="mgr-scope"
          credentialId={1}
          internalNonce={1}
          siteId={SITE_ID}
          selectedCamera={CAMERA_FIXTURE}
          selectedZone={zones[0]!}
          frozenReference={frozenReference}
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

    const zoneSelect = screen.getByLabelText('Select Zone') as HTMLSelectElement;
    const zoneOptions = Array.from(zoneSelect.options).map((opt) => ({
      value: opt.value,
      text: opt.textContent ?? '',
      title: opt.getAttribute('title') ?? '',
    }));
    expect(zoneOptions).toEqual([
      {
        value: SHARED_ZONE_ID,
        text: 'Setup review zone',
        title: `Setup review zone (${GENERATED_SHARED_CODE})`,
      },
      {
        value: LONG_ZONE_ID,
        text: LONG_ZONE_NAME,
        title: `${LONG_ZONE_NAME} (${GENERATED_LONG_CODE})`,
      },
      {
        value: dupZone1Id,
        text: 'Staging Gate (ZONE-DUP-01)',
        title: 'Staging Gate (ZONE-DUP-01)',
      },
      {
        value: dupZone2Id,
        text: 'Staging Gate (ZONE-DUP-02)',
        title: 'Staging Gate (ZONE-DUP-02)',
      },
    ]);
    expect(zoneSelect.getAttribute('title')).toBe(`Setup review zone (${GENERATED_SHARED_CODE})`);

    fireEvent.change(zoneSelect, { target: { value: dupZone2Id } });
    expect(onZoneChange).toHaveBeenCalledWith(dupZone2Id);

    const selectedZoneTech = screen.getByTestId('region-zone-selection-tech') as HTMLDetailsElement;
    expect(selectedZoneTech.open).toBe(false);
    expect(selectedZoneTech.textContent).toContain(`Zone code: ${GENERATED_SHARED_CODE}`);
    expect(selectedZoneTech.textContent).toContain(`Zone ID: ${SHARED_ZONE_ID}`);

    const cameraSelect = screen.getByLabelText('Select Camera') as HTMLSelectElement;
    expect(Array.from(cameraSelect.options).map((opt) => opt.textContent)).toEqual([
      'Recorded Setup Camera (SETUP-CLIP)',
    ]);
    expect(cameraSelect.value).toBe(CAMERA_ID);

    const contextHeader = screen.getByTestId('polygon-authoring-context');
    expect(contextHeader.textContent).toBe(
      'Setup review zone → Recorded Setup Camera · SETUP-CLIP (LIVE v4 · 640×360)',
    );
    expect(contextHeader.textContent).not.toContain(GENERATED_SHARED_CODE);

    const authoringTech = screen.getByTestId(
      'polygon-authoring-tech-details',
    ) as HTMLDetailsElement;
    expect(authoringTech.open).toBe(false);
    expect(authoringTech.textContent).toContain(`Zone code: ${GENERATED_SHARED_CODE}`);
    expect(authoringTech.textContent).toContain(`Zone ID: ${SHARED_ZONE_ID}`);
    expect(authoringTech.textContent).toContain(`Source ID: ${CAMERA_FIXTURE.externalId}`);

    rerender(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionDrawer
          apiUrl="http://127.0.0.1:49999"
          client={mockClient}
          token="token-mgr"
          sessionScope="mgr-scope"
          credentialId={1}
          internalNonce={1}
          siteId={SITE_ID}
          selectedCamera={CAMERA_FIXTURE}
          selectedZone={zones[0]!}
          frozenReference={frozenReference}
          candidateReference={null}
          editingRegion={{
            id: REGION_EDIT_ID,
            version: 2,
            expectedConfigurationVersion: 4,
            initialPoints: [
              [0.14, 0.18],
              [0.46, 0.18],
              [0.46, 0.56],
            ],
          }}
          lastSavedDraft={null}
          onAcceptCandidateReference={vi.fn()}
          onCancelCandidateReview={vi.fn()}
          onScopeRevoked={vi.fn()}
          onSaveSuccess={vi.fn()}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('polygon-authoring-context').textContent).toBe(
      'Setup review zone · Region v2 → Recorded Setup Camera · SETUP-CLIP (LIVE v4 · 640×360)',
    );
    expect(screen.getByTestId('polygon-authoring-tech-details').textContent).toContain(
      `Region ID: ${REGION_EDIT_ID} (v2)`,
    );

    await i18n.changeLanguage('vi');
    await waitFor(() => {
      expect(screen.getByTestId('polygon-authoring-context').textContent).toBe(
        'Setup review zone · Vùng v2 → Recorded Setup Camera · SETUP-CLIP (LIVE v4 · 640×360)',
      );
      expect(
        screen.getByTestId('polygon-authoring-tech-details').querySelector('summary')?.textContent,
      ).toBe('Mã định danh kỹ thuật');
    });
  });

  it('disambiguates regions across distinct Zone IDs sharing an identical human zone.name and labels technical IDs in CameraRegionList details (EN/VI)', async () => {
    const dupZone1Id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
    const dupZone2Id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
    const regDup1 = makeRegion('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', dupZone1Id, 1);
    const regDup2 = makeRegion('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', dupZone2Id, 2);

    const zones: ZoneResponse[] = [
      {
        id: dupZone1Id,
        siteId: SITE_ID,
        code: 'ZONE-DUP-A1',
        name: 'Staging Gate',
        type: 'HAZARDOUS',
        restrictionPolicy: 'NONE',
        requiredPpe: ['HARD_HAT'],
        configurationLocked: true,
        createdAt: '2026-11-18T00:00:00.000Z',
      },
      {
        id: dupZone2Id,
        siteId: SITE_ID,
        code: 'ZONE-DUP-B2',
        name: 'Staging Gate',
        type: 'STANDARD',
        restrictionPolicy: 'NONE',
        requiredPpe: ['HARD_HAT'],
        configurationLocked: true,
        createdAt: '2026-11-18T00:00:00.000Z',
      },
    ];

    const context: CameraPpeContext = {
      setupKey: ['clarity-dup-zone-name-test'],
      token: 'token-mgr',
      siteId: SITE_ID,
      onUnauthorized: vi.fn(),
      client: {
        readSavedPpePolicy: vi
          .fn()
          .mockImplementation(async (_tok, _site, _cam, regionId = null) => ({
            cameraId: CAMERA_ID,
            regionId: regionId ?? null,
            configurationVersion: 4,
            savedRevision: 4,
            policy: regionId
              ? { mode: 'INHERIT' }
              : { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
          })),
        listRegions: vi.fn().mockResolvedValue({ items: [regDup1, regDup2], total: 2 }),
        listZones: vi.fn().mockResolvedValue({ items: zones, total: 2 }),
        initializePpePolicy: vi.fn(),
        updateCameraPpePolicy: vi.fn(),
        updateRegionPpePolicy: vi.fn(),
        activateRegionWithPpePolicy: vi.fn(),
      },
    };

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CameraPpePolicyPanel
          cameraId={CAMERA_ID}
          camera={CAMERA_FIXTURE}
          context={context}
          canWrite
          expandSignal={1}
        />
        <CameraRegionList
          selectedCameraId={CAMERA_ID}
          selectedZone={{ code: 'ZONE-DUP-A1', name: 'Staging Gate' }}
          currentViewRevision={1}
          isCameraBaseError={false}
          isLoadingCameras={false}
          allFetchedRegions={[regDup1]}
          visibleLinkedRegions={[regDup1]}
          regionServerTotal={1}
          isRegionsInitialLoading={false}
          regionError={null}
          isRegionBaseError={false}
          isTransientNextRegionError={false}
          isFetchingRegions={false}
          hasNextRegionPage={false}
          canStartDrawing={true}
          isCurrentScopeActive={false}
          onStartEditingRegion={vi.fn()}
          onRetryInitialRegions={vi.fn()}
          onFetchNextRegions={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const card1 = await screen.findByTestId(`camera-ppe-region-card-${regDup1.id}`);
    const card2 = screen.getByTestId(`camera-ppe-region-card-${regDup2.id}`);

    expect(within(card1).getByText('Staging Gate (Region #1)')).toBeTruthy();
    expect(within(card2).getByText('Staging Gate (Region #2)')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Edit policy for Staging Gate (Region #1)' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Edit policy for Staging Gate (Region #2)' }),
    ).toBeTruthy();

    const impactPreview = screen.getByTestId('camera-ppe-affected-regions-preview');
    expect(impactPreview.textContent).toContain(
      'Staging Gate (Region #1), Staging Gate (Region #2)',
    );

    const listTech = screen.getByTestId(
      `camera-region-list-tech-${regDup1.id}`,
    ) as HTMLDetailsElement;
    expect(listTech.open).toBe(false);
    expect(listTech.textContent).toContain(`Region ID: ${regDup1.id}`);
    expect(listTech.textContent).toContain('Zone code: ZONE-DUP-A1');
    expect(listTech.textContent).toContain(`Zone ID: ${dupZone1Id}`);

    await i18n.changeLanguage('vi');
    await waitFor(() => {
      expect(within(card1).getByText('Staging Gate (Vùng #1)')).toBeTruthy();
      expect(within(card2).getByText('Staging Gate (Vùng #2)')).toBeTruthy();
      expect(listTech.textContent).toContain(`Mã vùng (Region ID): ${regDup1.id}`);
      expect(listTech.textContent).toContain('Mã định danh khu vực (Zone code): ZONE-DUP-A1');
      expect(listTech.textContent).toContain(`Mã khu vực (Zone ID): ${dupZone1Id}`);
    });
  });
});
