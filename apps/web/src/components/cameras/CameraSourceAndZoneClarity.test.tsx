// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedPpePolicy, SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraResponse, RegionResponse, ZoneResponse } from '@smartsite/contracts/management';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import { CameraRegionList } from '../ppe/CameraRegionList';
import { CameraPpePolicyPanel, type CameraPpeContext } from './CameraPpePolicyPanel';
import { CameraRegistrationDialog } from './CameraRegistrationDialog';
import { CameraSetupContextBar } from './CameraSetupContextPanel';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAMERA_ID = '22222222-2222-4222-8222-222222222222';
const SHARED_ZONE_ID = '5f8a3b12-9012-4a67-8cde-1234567890ab';
const LONG_ZONE_ID = '9d1c4e77-1111-4222-8333-abcdef012345';
const GENERATED_SHARED_CODE = 'ZONE-5F8A3B12-9012-4A67-8CDE-1234567890AB';
const GENERATED_LONG_CODE = 'ZONE-9D1C4E77-1111-4222-8333-ABCDEF012345';
const LONG_ZONE_NAME =
  'North Tower Hoist Material Unloading and Heavy Rigging Inspection Apron';

const REGION_SHARED_1_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const REGION_SHARED_2_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const REGION_LONG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';

const CAMERA_FIXTURE: CameraResponse = {
  id: CAMERA_ID,
  siteId: SITE_ID,
  code: 'SETUP-CLIP',
  name: 'Recorded Setup Camera',
  externalId: 'camera-a',
  status: 'ACTIVE',
  configurationVersion: 4,
  createdAt: '2026-11-18T00:00:00.000Z',
};

function makeRegion(
  id: string,
  zoneId: string,
  version: number,
): RegionResponse {
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

describe('Human Zone/Region labels and honest provisioned-source setup guidance', () => {
  beforeEach(async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('makes human Zone names primary across PPE overview, impact preview, editor scope, and region list while keeping generated ZONE-UUID codes in collapsible details (EN/VI)', async () => {
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
    ];
    const regions: RegionResponse[] = [
      makeRegion(REGION_SHARED_1_ID, SHARED_ZONE_ID, 1),
      makeRegion(REGION_SHARED_2_ID, SHARED_ZONE_ID, 2),
      makeRegion(REGION_LONG_ID, LONG_ZONE_ID, 3),
    ];

    const readSavedPpePolicy = vi
      .fn<CameraPpeContext['client']['readSavedPpePolicy']>()
      .mockImplementation(async (_tok, _site, _cam, regionId = null) => {
        const policies: Record<string, SavedPpePolicy> = {
          camera: {
            cameraId: CAMERA_ID,
            regionId: null,
            configurationVersion: 4,
            savedRevision: 4,
            policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
          },
          [REGION_SHARED_1_ID]: {
            cameraId: CAMERA_ID,
            regionId: REGION_SHARED_1_ID,
            configurationVersion: 4,
            savedRevision: 4,
            policy: { mode: 'INHERIT' },
          },
          [REGION_SHARED_2_ID]: {
            cameraId: CAMERA_ID,
            regionId: REGION_SHARED_2_ID,
            configurationVersion: 4,
            savedRevision: 4,
            policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT', 'GLOVES'] },
          },
          [REGION_LONG_ID]: {
            cameraId: CAMERA_ID,
            regionId: REGION_LONG_ID,
            configurationVersion: 4,
            savedRevision: 4,
            policy: { mode: 'INHERIT' },
          },
        };
        return policies[regionId ?? 'camera']!;
      });

    const context: CameraPpeContext = {
      setupKey: ['clarity-ppe-test'],
      token: 'token-mgr',
      siteId: SITE_ID,
      onUnauthorized: vi.fn(),
      client: {
        readSavedPpePolicy,
        listRegions: vi.fn().mockResolvedValue({ items: regions, total: 3 }),
        listZones: vi.fn().mockResolvedValue({ items: zones, total: 2 }),
        initializePpePolicy: vi.fn(),
        updateCameraPpePolicy: vi.fn(),
        updateRegionPpePolicy: vi.fn(),
        activateRegionWithPpePolicy: vi.fn(),
      },
    };

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

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
          selectedZone={{ code: GENERATED_SHARED_CODE, name: 'Setup review zone' }}
          currentViewRevision={1}
          isCameraBaseError={false}
          isLoadingCameras={false}
          allFetchedRegions={[regions[0]!, regions[1]!]}
          visibleLinkedRegions={[regions[0]!, regions[1]!]}
          regionServerTotal={2}
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

    const sharedCard1 = await screen.findByTestId(`camera-ppe-region-card-${REGION_SHARED_1_ID}`);
    const sharedCard2 = screen.getByTestId(`camera-ppe-region-card-${REGION_SHARED_2_ID}`);
    const longCard = screen.getByTestId(`camera-ppe-region-card-${REGION_LONG_ID}`);

    // Human Zone names lead; multiple regions sharing a Zone keep Region #1 / #2 disambiguation
    expect(within(sharedCard1).getByText('Setup review zone (Region #1)')).toBeTruthy();
    expect(within(sharedCard2).getByText('Setup review zone (Region #2)')).toBeTruthy();
    const longHeading = within(longCard).getByText(LONG_ZONE_NAME);
    expect(longHeading.getAttribute('title')).toBe(LONG_ZONE_NAME);

    // Generated ZONE-<UUID> does NOT pollute primary headers or impact summary
    expect(within(sharedCard1).queryByText(new RegExp(`${GENERATED_SHARED_CODE}\\s*·`))).toBeNull();
    const impactCard = screen.getByTestId('camera-ppe-affected-regions-preview');
    expect(impactCard.textContent).toContain('Setup review zone (Region #1)');
    expect(impactCard.textContent).toContain('Setup review zone (Region #2)');
    expect(impactCard.textContent).toContain(LONG_ZONE_NAME);
    expect(impactCard.textContent).not.toContain(GENERATED_SHARED_CODE);
    expect(impactCard.textContent).not.toContain(GENERATED_LONG_CODE);

    // Exact generated Zone code + Region ID + Zone ID remain preserved in closed <details>
    const techDetails1 = within(sharedCard1).getByTestId(
      `camera-ppe-region-tech-${REGION_SHARED_1_ID}`,
    ) as HTMLDetailsElement;
    expect(techDetails1.open).toBe(false);
    expect(techDetails1.textContent).toContain(GENERATED_SHARED_CODE);
    expect(techDetails1.textContent).toContain(REGION_SHARED_1_ID);
    expect(techDetails1.textContent).toContain(SHARED_ZONE_ID);

    // Policy scope <select> leads with human Zone name + Region # + version, without ZONE-<UUID>
    const scopeSelect = screen.getByLabelText('Policy scope') as HTMLSelectElement;
    const optionTexts = Array.from(scopeSelect.options).map((opt) => opt.textContent ?? '');
    expect(optionTexts).toContain('Setup review zone · Region #1 (Region v1)');
    expect(optionTexts).toContain('Setup review zone · Region #2 (Region v2)');
    expect(optionTexts).toContain(`${LONG_ZONE_NAME} (Region #3 · Region v3)`);
    expect(optionTexts.some((txt) => txt.includes(GENERATED_SHARED_CODE))).toBe(false);

    // Selecting Region #2 exposes its exact technical Zone code + IDs in editor <details>
    await user.selectOptions(scopeSelect, REGION_SHARED_2_ID);
    const editorTech = screen.getByTestId('camera-ppe-editor-tech') as HTMLDetailsElement;
    expect(editorTech.open).toBe(false);
    expect(editorTech.textContent).toContain(GENERATED_SHARED_CODE);
    expect(editorTech.textContent).toContain(REGION_SHARED_2_ID);

    // CameraRegionList puts human Zone name first and keeps generated Zone code inside <details>
    expect(screen.getByText('Setup review zone · Region #1')).toBeTruthy();
    expect(screen.getByText('Setup review zone · Region #2')).toBeTruthy();
    expect(screen.queryByText(`Region #1 · ${GENERATED_SHARED_CODE} · Setup review zone`)).toBeNull();

    // Vietnamese parity check
    await i18n.changeLanguage('vi');
    await waitFor(() => {
      expect(within(sharedCard1).getByText('Setup review zone (Vùng #1)')).toBeTruthy();
      expect(screen.getByText('Setup review zone · Vùng #1')).toBeTruthy();
    });
  });

  it('explains provisioned edge source registration honestly without password/token inputs, rejects RTSP URLs and embedded credentials, and prioritizes human camera names (EN/VI)', async () => {
    const createCamera = vi.fn<SmartSiteManagementClient['createCamera']>().mockResolvedValue({
      ...CAMERA_FIXTURE,
      configurationVersion: 1,
    });
    const client = { createCamera } as unknown as SmartSiteManagementClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CameraSetupContextBar
            siteId={SITE_ID}
            siteCode="SETUP-SITE"
            siteName="Recorded-source setup Site"
            rows={[CAMERA_FIXTURE]}
            selectedCamera={CAMERA_FIXTURE}
            canManageCameras
            canOpenMonitoring={false}
            open={vi.fn()}
          />
          <CameraRegistrationDialog
            open={false}
            onClose={vi.fn()}
            apiUrl="http://127.0.0.1:49999"
            token="token-mgr"
            sessionScope="mgr-scope"
            credentialId={1}
            siteId={SITE_ID}
            siteName="Recorded-source setup Site"
            canManageCamera
            client={client}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Context bar leads with human camera name ahead of camera code
    const selectedRegion = screen.getByRole('region', { name: 'Selected camera' });
    expect(within(selectedRegion).getByText('Recorded Setup Camera · SETUP-CLIP')).toBeTruthy();

    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CameraSetupContextBar
            siteId={SITE_ID}
            siteCode="SETUP-SITE"
            siteName="Recorded-source setup Site"
            rows={[CAMERA_FIXTURE]}
            selectedCamera={CAMERA_FIXTURE}
            canManageCameras
            canOpenMonitoring={false}
            open={vi.fn()}
          />
          <CameraRegistrationDialog
            open
            onClose={vi.fn()}
            apiUrl="http://127.0.0.1:49999"
            token="token-mgr"
            sessionScope="mgr-scope"
            credentialId={1}
            siteId={SITE_ID}
            siteName="Recorded-source setup Site"
            canManageCamera
            client={client}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Register camera' });
    const guidance = within(dialog).getByTestId('camera-registration-source-guidance');
    expect(guidance.textContent).toMatch(/edge worker/i);
    expect(guidance.textContent).toMatch(/RTSP/i);
    expect(guidance.textContent).toMatch(/Get configuration image/i);

    // Never renders password/token inputs or fake worker-start/connect buttons
    expect(dialog.querySelector('input[type="password"]')).toBeNull();
    expect(within(dialog).queryByLabelText(/password|token/i)).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /connect|start worker|provision/i })).toBeNull();

    // Human Camera name field appears before Camera code and technical Source ID
    const inputs = Array.from(dialog.querySelectorAll('input'));
    expect(inputs).toHaveLength(3);
    const nameInput = within(dialog).getByLabelText('Camera name');
    const codeInput = within(dialog).getByLabelText('Camera code');
    const sourceInput = within(dialog).getByLabelText('Source ID');
    expect(inputs[0]).toBe(nameInput);
    expect(inputs[1]).toBe(codeInput);
    expect(inputs[2]).toBe(sourceInput);

    // Rejects RTSP URL in Source ID without calling createCamera
    await user.type(nameInput, 'North Gate Camera');
    await user.type(codeInput, 'CAM-01');
    await user.type(sourceInput, 'rtsp://192.168.1.50:554/stream1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register camera' }));

    expect(createCamera).not.toHaveBeenCalled();
    expect(sourceInput.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(sourceInput);

    // Also rejects credential-bearing host strings without scheme
    await user.clear(sourceInput);
    await user.type(sourceInput, 'admin:secretPass@192.168.1.50:554/live');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register camera' }));
    expect(createCamera).not.toHaveBeenCalled();
    expect(sourceInput.getAttribute('aria-invalid')).toBe('true');

    // Accepts opaque edge-provisioned technical Source ID
    await user.clear(sourceInput);
    await user.type(sourceInput, 'camera-a');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register camera' }));
    await waitFor(() =>
      expect(createCamera).toHaveBeenCalledWith('token-mgr', SITE_ID, {
        name: 'North Gate Camera',
        code: 'CAM-01',
        externalId: 'camera-a',
      }),
    );

    // Verify Vietnamese honest registration copy
    await i18n.changeLanguage('vi');
    await waitFor(() => {
      expect(
        within(screen.getByRole('dialog')).getByTestId('camera-registration-source-guidance')
          .textContent,
      ).toMatch(/edge worker|Lấy ảnh cấu hình/i);
    });
  });
});
