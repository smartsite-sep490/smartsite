// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraApplicationStatus } from '@smartsite/contracts/camera-application-status';
import type {
  CameraResponse,
  Page,
  RegionResponse,
  SiteResponse,
  ZoneResponse,
} from '@smartsite/contracts/management';
import i18n from '../../i18n';
const changeUiLanguage = (language: string) => i18n.changeLanguage(language);
import type { SharedSession } from '../../types/shared-session';
import { CameraSetupView } from './CameraSetupView';

type UsedClientMethod =
  | 'listSites'
  | 'listCameras'
  | 'getCamera'
  | 'createCamera'
  | 'renameCamera'
  | 'getCameraApplicationStatus'
  | 'listZones'
  | 'listRegions'
  | 'getCameraConfigurationReference'
  | 'readSavedPpePolicy'
  | 'updateCameraPpePolicy';

type MockTransport = {
  [K in UsedClientMethod]: ReturnType<typeof vi.fn<SmartSiteManagementClient[K]>>;
};

const mockUseManagementClient =
  vi.fn<(apiUrl: string) => Pick<SmartSiteManagementClient, UsedClientMethod>>();

vi.mock('../../features/auth/auth-session', () => ({
  useManagementClient: (apiUrl: string) => mockUseManagementClient(apiUrl),
}));

const API_URL = 'https://api.smartsite.local';
const SITE_A_ID = '11111111-1111-4111-8111-111111111111';
const SITE_B_ID = '22222222-2222-4222-8222-222222222222';
const CAM_1_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAM_2_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ZONE_1_ID = 'zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz';

function makeSite(overrides: Partial<SiteResponse> = {}): SiteResponse {
  return {
    id: SITE_A_ID,
    code: 'SITE-A',
    name: 'Alpha Construction Site',
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCamera(overrides: Partial<CameraResponse> = {}): CameraResponse {
  return {
    type: 'ZONE' as const,
    gateId: null,
    id: CAM_1_ID,
    siteId: SITE_A_ID,
    code: 'CAM-01',
    name: 'North Gate Camera',
    externalId: 'rtsp-north-01',
    status: 'ACTIVE',
    configurationVersion: 2,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeZone(overrides: Partial<ZoneResponse> = {}): ZoneResponse {
  return {
    id: ZONE_1_ID,
    siteId: SITE_A_ID,
    code: 'ZONE-01',
    name: 'Excavation Area',
    type: 'STANDARD',
    restrictionPolicy: 'NONE',
    requiredPpe: ['HARD_HAT'],
    configurationLocked: false,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSession(overrides: Partial<SharedSession> = {}): SharedSession {
  return {
    accessToken: 'token-valid-1',
    sessionScope: 'session-scope-1',
    onSignOut: vi.fn(),
    user: {
      id: 'user-manager-1',
      displayName: 'Site Manager One',
      mustChangePassword: false,
      roleAssignments: [{ role: 'SITE_MANAGER', siteId: SITE_A_ID }],
    },
    ...overrides,
  };
}

function createMockTransport(): MockTransport {
  const siteA = makeSite();
  const siteB = makeSite({
    id: SITE_B_ID,
    code: 'SITE-B',
    name: 'Beta Logistics Yard',
  });
  const cam1 = makeCamera();

  return {
    listSites: vi.fn<SmartSiteManagementClient['listSites']>().mockResolvedValue({
      items: [siteA, siteB],
      total: 2,
    } satisfies Page<SiteResponse>),
    listCameras: vi
      .fn<SmartSiteManagementClient['listCameras']>()
      .mockImplementation(async (_token, siteId) => ({
        items: siteId === SITE_A_ID ? [cam1] : [],
        total: siteId === SITE_A_ID ? 1 : 0,
      })),
    getCamera: vi.fn<SmartSiteManagementClient['getCamera']>().mockResolvedValue(cam1),
    createCamera: vi.fn<SmartSiteManagementClient['createCamera']>(),
    renameCamera: vi.fn<SmartSiteManagementClient['renameCamera']>(),
    getCameraApplicationStatus: vi
      .fn<SmartSiteManagementClient['getCameraApplicationStatus']>()
      .mockImplementation(async (_token, siteId, cameraId) => {
        const nowIso = new Date().toISOString();
        return {
          siteId,
          cameraId,
          desiredRevision: 2,
          reportedRevision: 2,
          applicationState: 'LOADED',
          viewValidity: 'UNCONFIRMED',
          reasonCode: null,
          lastReceiptAt: nowIso,
          observedAt: nowIso,
        } satisfies CameraApplicationStatus;
      }),
    listZones: vi.fn<SmartSiteManagementClient['listZones']>().mockResolvedValue({
      items: [makeZone()],
      total: 1,
    } satisfies Page<ZoneResponse>),
    listRegions: vi.fn<SmartSiteManagementClient['listRegions']>().mockResolvedValue({
      items: [],
      total: 0,
    } satisfies Page<RegionResponse>),
    getCameraConfigurationReference: vi
      .fn<SmartSiteManagementClient['getCameraConfigurationReference']>()
      .mockRejectedValue({ status: 404 }),
    readSavedPpePolicy: vi
      .fn<SmartSiteManagementClient['readSavedPpePolicy']>()
      .mockImplementation(async (_token, _siteId, cameraId, regionId = null) => ({
        cameraId,
        regionId,
        configurationVersion: 2,
        savedRevision: null,
        policy: null,
      })),
    updateCameraPpePolicy: vi.fn<SmartSiteManagementClient['updateCameraPpePolicy']>(),
  };
}

function renderWorkspace(
  sharedSession: SharedSession | null,
  initialEntry = '/camera-setup',
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <CameraSetupView apiUrl={API_URL} sharedSession={sharedSession} />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe('CameraSetupView parent workspace integration', () => {
  let transport: MockTransport;

  it('uses only the explicit manager site for a mixed Admin account', async () => {
    const otherSite = 'b1000000-0000-4000-8000-000000000002';
    transport.listSites.mockResolvedValue({
      items: [makeSite(), makeSite({ id: otherSite, name: 'Assigned Beta' })],
      total: 2,
    });
    const session = makeSession();
    session.user.roleAssignments = [
      { role: 'ADMIN', siteId: null },
      { role: 'SITE_MANAGER', siteId: otherSite },
    ];
    renderWorkspace(session);
    await waitFor(() => expect(transport.listCameras).toHaveBeenCalled());
    expect(transport.listCameras.mock.calls.every((call) => call[1] === otherSite)).toBe(true);
    expect(screen.queryByRole('option', { name: /Alpha Construction Site/ })).toBeNull();
  });

  beforeEach(async () => {
    await changeUiLanguage('en');
    localStorage.clear();
    sessionStorage.clear();
    transport = createMockTransport();
    mockUseManagementClient.mockReturnValue(transport);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('guards unauthenticated, password-change-required, and unauthorized role sessions before querying setup catalogs', () => {
    const { unmount: unmountAnon } = renderWorkspace(null);
    expect(screen.getByRole('status').textContent).toBe('Sign in to manage configuration.');
    expect(transport.listSites).not.toHaveBeenCalled();
    unmountAnon();

    const { unmount: unmountPwd } = renderWorkspace(
      makeSession({
        user: {
          id: 'user-pwd',
          displayName: 'Password Reset Manager',
          mustChangePassword: true,
          roleAssignments: [{ role: 'SITE_MANAGER', siteId: SITE_A_ID }],
        },
      }),
    );
    expect(screen.getByRole('alert').textContent).toBe('You do not have setup access.');
    expect(transport.listSites).not.toHaveBeenCalled();
    unmountPwd();

    renderWorkspace(
      makeSession({
        user: {
          id: 'user-officer',
          displayName: 'Safety Officer Only',
          mustChangePassword: false,
          roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: SITE_A_ID }],
        },
      }),
    );
    expect(screen.getByRole('alert').textContent).toBe('You do not have setup access.');
    expect(transport.listSites).not.toHaveBeenCalled();
  });

  it('renders assigned Site Manager actions, missing-site notice, and tour context while denying a pure Admin', async () => {
    const managerSession = makeSession();
    const { unmount } = renderWorkspace(managerSession, '/camera-setup?siteId=missing-site-999');

    await waitFor(() => {
      expect(
        screen.getByText(
          'The linked selection is not in the loaded list. Load more or choose an available item.',
        ),
      ).toBeTruthy();
    });

    const siteSelect = screen.getByRole('combobox', { name: 'Site' }) as HTMLSelectElement;
    fireEvent.change(siteSelect, { target: { value: SITE_A_ID } });

    await waitFor(() => {
      expect(screen.getByText('North Gate Camera')).toBeTruthy();
    });

    const workflowGroup = screen.getByRole('group', { name: 'Camera setup actions' });
    expect(
      within(workflowGroup).getByRole('button', { name: 'Configure PPE by Zone' }),
    ).toBeTruthy();
    expect(within(workflowGroup).getByRole('button', { name: 'Register camera' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Regions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage North Gate Camera' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Open monitoring' })).toBeNull();
    expect(document.querySelector('[data-tour-anchor="camera-setup-scope"]')).toBeTruthy();

    unmount();

    const adminSession = makeSession({
      user: {
        id: 'user-admin-1',
        displayName: 'System Admin',
        mustChangePassword: false,
        roleAssignments: [{ role: 'ADMIN', siteId: null }],
      },
    });
    renderWorkspace(adminSession, `/camera-setup?siteId=${SITE_A_ID}&cameraId=${CAM_1_ID}`);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('North Gate Camera')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Open monitoring' })).toBeNull();
  });

  it('resolves deep-linked unloaded region camera lookup and aborts in-flight getCamera when site scope changes', async () => {
    const cam1 = makeCamera({ id: CAM_1_ID, code: 'CAM-01', name: 'North Gate Camera' });
    const cam2Unloaded = makeCamera({
      id: CAM_2_ID,
      code: 'CAM-02',
      name: 'South Crane Camera',
      siteId: SITE_A_ID,
      status: 'ACTIVE',
    });

    let listCamerasCallCount = 0;
    transport.listCameras.mockImplementation(async (_token: string, siteId: string) => {
      listCamerasCallCount += 1;
      if (siteId !== SITE_A_ID) {
        return { items: [], total: 0 };
      }
      // First call is CameraSetupView page 0 (only cam1 loaded); subsequent call in RegionPanel includes cam2Unloaded
      if (listCamerasCallCount === 1) {
        return { items: [cam1], total: 2 };
      }
      return { items: [cam1, cam2Unloaded], total: 2 };
    });

    let capturedLookupSignal: AbortSignal | undefined;
    let resolveLookup: ((cam: CameraResponse) => void) | undefined;
    transport.getCamera.mockImplementation(
      (_token: string, _siteId: string, _cameraId: string, options?: { signal?: AbortSignal }) => {
        capturedLookupSignal = options?.signal;
        return new Promise<CameraResponse>((resolve) => {
          resolveLookup = resolve;
        });
      },
    );

    const session = makeSession({
      user: {
        id: 'user-mgr-safety',
        displayName: 'Manager & Officer',
        mustChangePassword: false,
        roleAssignments: [
          { role: 'SITE_MANAGER', siteId: SITE_A_ID },
          { role: 'SITE_MANAGER', siteId: SITE_B_ID },
          { role: 'SAFETY_OFFICER', siteId: SITE_A_ID },
        ],
      },
    });

    renderWorkspace(session, `/camera-setup?siteId=${SITE_A_ID}`);

    await waitFor(() => {
      expect(screen.getByText('North Gate Camera')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Regions' }));

    const regionCameraSelect = await screen.findByLabelText(/camera/i, {
      selector: 'select#select-camera-link',
    });
    await waitFor(() => {
      expect(within(regionCameraSelect).getByRole('option', { name: /CAM-02/ })).toBeTruthy();
    });

    fireEvent.change(regionCameraSelect, { target: { value: CAM_2_ID } });

    await waitFor(() => {
      expect(transport.getCamera).toHaveBeenCalledWith(
        session.accessToken,
        SITE_A_ID,
        CAM_2_ID,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    expect(capturedLookupSignal?.aborted).toBe(false);

    // Switching site while getCamera is in flight aborts the lookup and closes the region dialog
    const siteSelect = screen.getByLabelText('Site', { selector: 'select#camera-setup-site' });
    fireEvent.change(siteSelect, { target: { value: SITE_B_ID } });

    await waitFor(() => {
      expect(capturedLookupSignal?.aborted).toBe(true);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    resolveLookup?.(cam2Unloaded);
  });

  it('closes active dialog on site change and ignores late update completion from a previous site scope', async () => {
    const cam1 = makeCamera({
      id: CAM_1_ID,
      siteId: SITE_A_ID,
      code: 'CAM-01',
      name: 'North Gate v2',
      configurationVersion: 2,
    });
    const camB = makeCamera({
      id: CAM_1_ID,
      siteId: SITE_B_ID,
      code: 'CAM-B1',
      name: 'Beta Yard Camera',
      configurationVersion: 1,
    });

    transport.listCameras.mockImplementation(async (_token: string, siteId: string) => ({
      items: siteId === SITE_A_ID ? [cam1] : [camB],
      total: 1,
    }));

    let resolveUpdate: ((updated: CameraResponse) => void) | undefined;
    transport.renameCamera.mockImplementation(
      () =>
        new Promise<CameraResponse>((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    const session = makeSession({
      user: {
        id: 'user-multi-mgr',
        displayName: 'Multi Site Manager',
        mustChangePassword: false,
        roleAssignments: [
          { role: 'SITE_MANAGER', siteId: SITE_A_ID },
          { role: 'SITE_MANAGER', siteId: SITE_B_ID },
        ],
      },
    });

    renderWorkspace(session, `/camera-setup?siteId=${SITE_A_ID}`);

    await waitFor(() => {
      expect(screen.getByText('North Gate v2')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Manage North Gate v2' }));

    const dialog = await screen.findByRole('dialog');
    const nameInput = within(dialog).getByLabelText(/Camera name/i);
    fireEvent.change(nameInput, { target: { value: 'Late North Gate v3' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save name' }));

    await waitFor(() => {
      expect(transport.renameCamera).toHaveBeenCalledWith(
        session.accessToken,
        SITE_A_ID,
        CAM_1_ID,
        'Late North Gate v3',
      );
    });

    // Switch site before the Site A mutation resolves
    fireEvent.change(screen.getByLabelText('Site', { selector: 'select#camera-setup-site' }), {
      target: { value: SITE_B_ID },
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByText('Beta Yard Camera')).toBeTruthy();
    });

    resolveUpdate?.({
      ...cam1,
      name: 'Late North Gate v3',
      configurationVersion: 3,
    });

    await waitFor(() => {
      expect(screen.getByText('Beta Yard Camera')).toBeTruthy();
    });
    expect(screen.queryByText('Late North Gate v3')).toBeNull();
  });

  it('publishes updated camera version through CameraManagementDialog and refreshes status for the new revision', async () => {
    let currentCam = makeCamera({
      id: CAM_1_ID,
      siteId: SITE_A_ID,
      code: 'CAM-01',
      name: 'North Gate v2',
      configurationVersion: 2,
    });

    transport.listCameras.mockImplementation(async () => ({
      items: [currentCam],
      total: 1,
    }));

    transport.getCameraApplicationStatus.mockImplementation(
      async (_token: string, siteId: string, cameraId: string) => {
        const nowIso = new Date().toISOString();
        return {
          siteId,
          cameraId,
          desiredRevision: currentCam.configurationVersion,
          reportedRevision: 2,
          applicationState: currentCam.configurationVersion === 2 ? 'LOADED' : 'PENDING',
          viewValidity: 'UNCONFIRMED',
          reasonCode: currentCam.configurationVersion === 2 ? null : 'WORKER_POLL_PENDING',
          lastReceiptAt: nowIso,
          observedAt: nowIso,
        } satisfies CameraApplicationStatus;
      },
    );

    transport.renameCamera.mockImplementation(
      async (_token: string, _siteId: string, _cameraId: string, name: string) => {
        currentCam = {
          ...currentCam,
          name,
          configurationVersion: 3,
        };
        return currentCam;
      },
    );

    renderWorkspace(makeSession(), `/camera-setup?siteId=${SITE_A_ID}&cameraId=${CAM_1_ID}`);

    await waitFor(() => {
      expect(
        screen.getByTestId('camera-application-status').getAttribute('data-application-state'),
      ).toBe('LOADED');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Manage North Gate v2' }));

    const dialog = await screen.findByRole('dialog');
    const nameInput = within(dialog).getByLabelText(/Camera name/i);
    fireEvent.change(nameInput, { target: { value: 'North Gate v3' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save name' }));

    await waitFor(() => {
      expect(screen.getAllByText(/North Gate v3/).length).toBeGreaterThan(0);
      expect(
        screen.getByTestId('camera-application-status').getAttribute('data-application-state'),
      ).toBe('PENDING');
    });
  });

  it('revokes workspace session and calls sharedSession.onSignOut once on 401 unauthorized response', async () => {
    transport.listCameras.mockRejectedValueOnce({ status: 401 });
    const onSignOut = vi.fn();
    const session = makeSession({ onSignOut });

    renderWorkspace(session, `/camera-setup?siteId=${SITE_A_ID}`);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Sign in to manage configuration.');
    });
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('wires region effective PPE overview and updates saved-vs-applied status after saving camera default PPE in workspace', async () => {
    const REGION_1_ID = 'rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrr1';
    const REGION_2_ID = 'rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrr2';
    const ZONE_2_ID = 'zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzz2';

    let configVersion = 2;
    let cameraPpe: ('HARD_HAT' | 'SAFETY_VEST' | 'BOOTS')[] = ['HARD_HAT', 'SAFETY_VEST'];

    transport.listCameras.mockImplementation(async () => ({
      items: [makeCamera({ configurationVersion: configVersion })],
      total: 1,
    }));
    transport.listZones.mockResolvedValue({
      items: [
        makeZone({ id: ZONE_1_ID, code: 'Z-01', name: 'Excavation Area', requiredPpe: ['BOOTS'] }),
        makeZone({ id: ZONE_2_ID, code: 'Z-02', name: 'Glove Station', requiredPpe: ['GLOVES'] }),
      ],
      total: 2,
    });
    transport.listRegions.mockResolvedValue({
      items: [
        {
          id: REGION_1_ID,
          cameraId: CAM_1_ID,
          zoneId: ZONE_1_ID,
          polygon: {
            coordinates: [
              [0.1, 0.1],
              [0.5, 0.1],
              [0.5, 0.5],
            ],
          },
          coordinateSpace: 'NORMALIZED_0_1',
          version: 1,
          isActive: true,
          createdAt: '2026-03-01T00:00:00.000Z',
        },
        {
          id: REGION_2_ID,
          cameraId: CAM_1_ID,
          zoneId: ZONE_2_ID,
          polygon: {
            coordinates: [
              [0.5, 0.5],
              [0.9, 0.5],
              [0.9, 0.9],
            ],
          },
          coordinateSpace: 'NORMALIZED_0_1',
          version: 1,
          isActive: true,
          createdAt: '2026-03-01T00:00:00.000Z',
        },
      ],
      total: 2,
    });
    transport.readSavedPpePolicy.mockImplementation(async (_token, _siteId, cameraId, regionId) => {
      if (regionId === null) {
        return {
          cameraId,
          regionId: null,
          configurationVersion: configVersion,
          savedRevision: configVersion,
          policy: { mode: 'EXPLICIT', requiredPpe: [...cameraPpe] },
        };
      }
      if (regionId === REGION_1_ID) {
        return {
          cameraId,
          regionId: REGION_1_ID,
          configurationVersion: configVersion,
          savedRevision: 1,
          policy: { mode: 'INHERIT' },
        };
      }
      return {
        cameraId,
        regionId: REGION_2_ID,
        configurationVersion: configVersion,
        savedRevision: 1,
        policy: { mode: 'EXPLICIT', requiredPpe: ['GLOVES'] },
      };
    });
    transport.getCameraApplicationStatus.mockImplementation(async (_token, siteId, cameraId) => {
      const nowIso = new Date().toISOString();
      return {
        siteId,
        cameraId,
        desiredRevision: configVersion,
        reportedRevision: 2,
        applicationState: configVersion === 2 ? 'LOADED' : 'PENDING',
        viewValidity: 'UNCONFIRMED',
        reasonCode: configVersion === 2 ? null : 'WORKER_POLL_PENDING',
        lastReceiptAt: nowIso,
        observedAt: nowIso,
      } satisfies CameraApplicationStatus;
    });
    transport.updateCameraPpePolicy.mockImplementation(
      async (_token, _siteId, cameraId, command) => {
        if (command.policy.mode === 'EXPLICIT') {
          cameraPpe = [...command.policy.requiredPpe] as ('HARD_HAT' | 'SAFETY_VEST' | 'BOOTS')[];
        }
        configVersion = 3;
        return {
          commandId: command.commandId,
          cameraId,
          configurationVersion: 3,
          viewRevision: 3,
          bundleSha256: 'a'.repeat(64),
          replayed: false,
        };
      },
    );

    renderWorkspace(makeSession(), `/camera-setup?siteId=${SITE_A_ID}&cameraId=${CAM_1_ID}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Camera PPE policy' }));

    const inheritCard = await screen.findByTestId(`camera-ppe-region-card-${REGION_1_ID}`);
    expect(within(inheritCard).getByText('Excavation Area')).toBeTruthy();
    expect(within(inheritCard).getByText('Use camera default')).toBeTruthy();
    expect(within(inheritCard).getByText('Hard hat')).toBeTruthy();
    expect(within(inheritCard).getByText('Safety vest')).toBeTruthy();
    expect(within(inheritCard).queryByText('Boots')).toBeNull();

    const syncBanner = screen.getByTestId('camera-ppe-sync-status');
    await waitFor(() => {
      expect(syncBanner.getAttribute('data-sync-state')).toBe('applied');
    });

    // Updating camera default adds BOOTS to inherited region effective PPE and moves sync to not-yet-applied
    fireEvent.click(screen.getByRole('checkbox', { name: 'Boots' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save PPE policy' }));

    await waitFor(() => {
      expect(within(inheritCard).getByText('Boots')).toBeTruthy();
      expect(syncBanner.getAttribute('data-sync-state')).toBe('not-yet-applied');
    });
    expect(within(inheritCard).getByText('Saved v3 · Not yet confirmed by worker')).toBeTruthy();
    expect(syncBanner.textContent).not.toContain('Applied by worker');
  });
});
