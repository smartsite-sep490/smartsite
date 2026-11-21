// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraApplicationStatus } from '@smartsite/contracts/camera-application-status';
import type {
  CameraResponse,
  Page,
  RegionResponse,
  SiteResponse,
  ZoneResponse,
} from '@smartsite/contracts/management';
import i18n from '../../i18n';
import type { SharedSession } from '../../types/shared-session';
import { SAFETY_TOUR_STORAGE_KEY } from '../safety/safetyTaskTourModel';
import { CameraSetupView } from './CameraSetupView';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

type UsedClientMethod =
  | 'listSites'
  | 'listCameras'
  | 'getCamera'
  | 'createCamera'
  | 'getCameraApplicationStatus'
  | 'listZones'
  | 'listRegions'
  | 'readSavedPpePolicy';

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
const CAM_ACTIVE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAM_INACTIVE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ZONE_1_ID = 'zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz';
const REGION_1_ID = 'rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrr1';
const SECRET_TOKEN = 'secret-jwt-camera-setup-tour-token';

function makeCamera(overrides: Partial<CameraResponse> = {}): CameraResponse {
  return {
    type: 'ZONE' as const,
    gateId: null,
    id: CAM_ACTIVE_ID,
    siteId: SITE_A_ID,
    code: 'CAM-01',
    name: 'North Gate Camera',
    externalId: 'prov-source-north-01',
    status: 'ACTIVE',
    configurationVersion: 2,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSession(overrides: Partial<SharedSession> = {}): SharedSession {
  return {
    accessToken: SECRET_TOKEN,
    sessionScope: 'session-scope-tour',
    onSignOut: vi.fn(),
    user: {
      id: 'manager-alpha',
      displayName: 'Alpha Site Manager',
      mustChangePassword: false,
      roleAssignments: [
        { role: 'SITE_MANAGER', siteId: SITE_A_ID },
        { role: 'SITE_MANAGER', siteId: SITE_B_ID },
      ],
    },
    ...overrides,
  };
}

function createTransport(): MockTransport {
  const sites: SiteResponse[] = [
    { id: SITE_A_ID, code: 'SITE-A', name: 'Alpha Site', createdAt: '2026-03-01T00:00:00.000Z' },
    { id: SITE_B_ID, code: 'SITE-B', name: 'Beta Site', createdAt: '2026-03-01T00:00:00.000Z' },
  ];
  const camActive = makeCamera();
  const camInactive = makeCamera({
    id: CAM_INACTIVE_ID,
    code: 'CAM-02',
    name: 'South Yard Camera',
    externalId: 'prov-source-south-02',
    status: 'INACTIVE',
    configurationVersion: 1,
  });

  return {
    listSites: vi.fn<SmartSiteManagementClient['listSites']>().mockResolvedValue({
      items: sites,
      total: sites.length,
    } satisfies Page<SiteResponse>),
    listCameras: vi
      .fn<SmartSiteManagementClient['listCameras']>()
      .mockImplementation(async (_token, siteId) => ({
        items: siteId === SITE_A_ID ? [camActive, camInactive] : [],
        total: siteId === SITE_A_ID ? 2 : 0,
      })),
    getCamera: vi.fn<SmartSiteManagementClient['getCamera']>().mockResolvedValue(camActive),
    createCamera: vi.fn<SmartSiteManagementClient['createCamera']>(),
    getCameraApplicationStatus: vi
      .fn<SmartSiteManagementClient['getCameraApplicationStatus']>()
      .mockImplementation(async (_token, siteId, cameraId) => {
        const nowIso = new Date().toISOString();
        return {
          siteId,
          cameraId,
          desiredRevision: cameraId === CAM_INACTIVE_ID ? 1 : 2,
          reportedRevision: cameraId === CAM_INACTIVE_ID ? 1 : 2,
          applicationState: 'LOADED',
          viewValidity: 'UNCONFIRMED',
          reasonCode: null,
          lastReceiptAt: nowIso,
          observedAt: nowIso,
        } satisfies CameraApplicationStatus;
      }),
    listZones: vi.fn<SmartSiteManagementClient['listZones']>().mockResolvedValue({
      items: [
        {
          id: ZONE_1_ID,
          siteId: SITE_A_ID,
          code: 'Z-01',
          name: 'Excavation Area',
          type: 'STANDARD',
          restrictionPolicy: 'NONE',
          requiredPpe: ['HARD_HAT'],
          configurationLocked: false,
          createdAt: '2026-03-01T00:00:00.000Z',
        },
      ],
      total: 1,
    } satisfies Page<ZoneResponse>),
    listRegions: vi.fn<SmartSiteManagementClient['listRegions']>().mockResolvedValue({
      items: [],
      total: 0,
    } satisfies Page<RegionResponse>),
    readSavedPpePolicy: vi
      .fn<SmartSiteManagementClient['readSavedPpePolicy']>()
      .mockImplementation(async (_token, _siteId, cameraId, regionId = null) => ({
        cameraId,
        regionId,
        configurationVersion: 2,
        savedRevision: null,
        policy: null,
      })),
  };
}

function renderSetup(
  session: SharedSession | null = makeSession(),
  initialEntry = `/camera-setup?siteId=${SITE_A_ID}`,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <CameraSetupView apiUrl={API_URL} sharedSession={session} />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe('CameraSetupView guided tour and persisted setup checklist (P3.3)', () => {
  let transport: MockTransport;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.localStorage.clear();
    window.sessionStorage.clear();
    transport = createTransport();
    mockUseManagementClient.mockReturnValue(transport);
  });

  afterEach(async () => {
    cleanup();
    window.localStorage.clear();
    await i18n.changeLanguage('en');
    vi.restoreAllMocks();
  });

  it('guides an assigned Site Manager through selecting camera, provisioned source, zone & inherited/override/disabled PPE, reference & small polygon, and saved vs worker-applied receipt', async () => {
    renderSetup();

    expect(await screen.findByTestId('safety-task-tour-invitation')).toBeTruthy();
    expect(screen.getByTestId('safety-task-tour-trigger').textContent).toBe('Guided help');

    fireEvent.click(screen.getByTestId('safety-task-tour-invitation-start'));

    const step1 = await screen.findByTestId('safety-task-tour');
    expect(step1.getAttribute('data-tour-step')).toBe('camera-setup-scope');
    expect(step1.textContent).toContain('Step 1 of 6');
    expect(step1.textContent).toContain('Select Site & Camera');
    expect(step1.textContent).toMatch(/Choose a camera|Select/i);
    expect(
      document
        .querySelector('[data-tour-anchor="camera-setup-scope"]')
        ?.getAttribute('data-tour-active-anchor'),
    ).toBe('true');

    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    const step2 = screen.getByTestId('safety-task-tour');
    expect(step2.getAttribute('data-tour-step')).toBe('camera-setup-source');
    expect(step2.textContent).toContain('Register Provisioned Source');
    expect(step2.textContent).toContain('already-provisioned Source ID');

    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    const step3 = screen.getByTestId('safety-task-tour');
    expect(step3.getAttribute('data-tour-step')).toBe('camera-setup-zone-draw');
    expect(step3.textContent).toContain('Configure Zone');

    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    const step4 = screen.getByTestId('safety-task-tour');
    expect(step4.getAttribute('data-tour-step')).toBe('camera-setup-ppe-policy');
    expect(step4.textContent).toMatch(/Inherited|Use camera default/i);
    expect(step4.textContent).toMatch(/Override|Custom/i);
    expect(step4.textContent).toMatch(/Disabled/i);
    expect(
      screen.getByTestId('camera-ppe-policy-panel').getAttribute('data-tour-active-anchor'),
    ).toBe('true');

    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    const step5 = screen.getByTestId('safety-task-tour');
    expect(step5.getAttribute('data-tour-step')).toBe('camera-setup-regions');
    expect(step5.textContent).toMatch(/Capture Reference & Draw Small Region/i);
    expect(step5.textContent).toContain('5-minute reference image');
    expect(step5.textContent).toMatch(/small.*polygon/i);
    expect(
      document
        .querySelector('[data-tour-anchor="camera-setup-regions"]')
        ?.getAttribute('data-tour-active-anchor'),
    ).toBe('true');

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(screen.getByTestId('safety-task-tour').textContent).toContain('Bước 5 / 6');
    expect(screen.getByTestId('safety-task-tour').textContent).toContain(
      'Lấy Ảnh tham chiếu & Vẽ Vùng gọn',
    );
    await act(async () => {
      await i18n.changeLanguage('en');
    });

    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    const step6 = screen.getByTestId('safety-task-tour');
    expect(step6.getAttribute('data-tour-step')).toBe('camera-setup-save');
    expect(step6.textContent).toContain('Saved Config vs Worker-Applied Receipt');
    expect(step6.textContent).toContain('fresh matching worker receipt');

    fireEvent.click(screen.getByTestId('safety-task-tour-done'));
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    expect(screen.getByTestId('safety-task-tour-trigger').textContent).toBe('Replay guide');

    const storedRaw = window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY) ?? '{}';
    expect(storedRaw).not.toContain(SECRET_TOKEN);
    expect(JSON.parse(storedRaw)['manager-alpha:camera-setup:v2']).toEqual({
      status: 'COMPLETED',
      tourVersion: 2,
    });
    expect(transport.createCamera).not.toHaveBeenCalled();

    // Selecting the disabled camera updates step 5 (regions) to enable-first guidance on replay
    fireEvent.click(screen.getByRole('button', { name: 'Select CAM-02' }));
    fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
    fireEvent.click(await screen.findByTestId('safety-task-tour-next'));
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').textContent).toContain(
      'Enable Camera Before Capturing Reference',
    );
  });

  it('supports keyboard Back, Next, Escape close, Skip, and Replay guide reopen with deterministic focus', async () => {
    const user = userEvent.setup();
    renderSetup();

    const startBtn = await screen.findByTestId('safety-task-tour-invitation-start');
    startBtn.focus();
    await user.keyboard('{Enter}');

    const nextBtn = await screen.findByTestId('safety-task-tour-next');
    await waitFor(() => expect(document.activeElement).toBe(nextBtn));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'camera-setup-scope',
    );

    await user.keyboard('{Enter}');
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'camera-setup-source',
    );

    const backBtn = screen.getByTestId('safety-task-tour-back');
    backBtn.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'camera-setup-scope',
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('safety-task-tour-next')),
    );

    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    expect(window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY)).toBeNull();
    const trigger = screen.getByTestId('safety-task-tour-trigger');
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    await user.keyboard('{Enter}');
    expect(await screen.findByTestId('safety-task-tour')).toBeTruthy();

    const skipBtn = screen.getByTestId('safety-task-tour-skip');
    skipBtn.focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    expect(trigger.textContent).toBe('Replay guide');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(
      JSON.parse(window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY) ?? '{}')[
        'manager-alpha:camera-setup:v2'
      ],
    ).toEqual({ status: 'SKIPPED', tourVersion: 2 });

    await user.keyboard('{Enter}');
    expect((await screen.findByTestId('safety-task-tour')).getAttribute('data-tour-step')).toBe(
      'camera-setup-scope',
    );
  });

  it('denies ADMIN and closes the Manager tour on camera/site/error and dialog changes', async () => {
    const adminSession = makeSession({
      user: {
        id: 'admin-global',
        displayName: 'Global Admin',
        mustChangePassword: false,
        roleAssignments: [{ role: 'ADMIN', siteId: null }],
      },
    });
    const adminView = renderSetup(adminSession);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('safety-task-tour-trigger')).toBeNull();
    adminView.unmount();

    // Unauthorized Safety Officer never sees Camera Setup or tour
    const deniedView = renderSetup(
      makeSession({
        user: {
          id: 'officer-1',
          displayName: 'Safety Officer',
          mustChangePassword: false,
          roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: SITE_A_ID }],
        },
      }),
    );
    expect(screen.queryByTestId('safety-task-tour-trigger')).toBeNull();
    deniedView.unmount();

    // Manager: switching site, opening Register dialog, or failing camera refetch closes open tour cleanly
    const { queryClient } = renderSetup();
    fireEvent.click(await screen.findByTestId('safety-task-tour-trigger'));
    expect(await screen.findByTestId('safety-task-tour')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Register camera' }));
    const dialog = await screen.findByRole('dialog');
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    const codeInput = within(dialog).getByLabelText(/Camera code/i) as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: 'CAM-DRAFT-99' } });
    expect(codeInput.value).toBe('CAM-DRAFT-99');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(await screen.findByTestId('safety-task-tour-trigger'));
    expect(await screen.findByTestId('safety-task-tour')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Site', { selector: 'select#camera-setup-site' }), {
      target: { value: SITE_B_ID },
    });
    await waitFor(() => expect(screen.queryByTestId('safety-task-tour')).toBeNull());

    // On empty Site B, scope explains Step 1/Step 2 onboarding, checklist anchor provides step 4, and camera 500 error closes tour
    fireEvent.click(await screen.findByTestId('safety-task-tour-trigger'));
    const emptySiteTour = await screen.findByTestId('safety-task-tour');
    expect(emptySiteTour.textContent).toContain('Step 1 of 4');
    expect(emptySiteTour.textContent).toMatch(/No cameras are registered on this site yet/i);
    transport.listCameras.mockRejectedValueOnce(new ApiError('http', 'Catalog error', 500));
    await act(async () => {
      await queryClient.invalidateQueries({
        predicate: ({ queryKey }) => queryKey[0] === 'camera-setup' && queryKey[7] === 'cameras',
      });
    });
    await waitFor(() => expect(screen.queryByTestId('safety-task-tour')).toBeNull());
    expect(screen.queryByTestId('safety-task-tour-trigger')).toBeNull();
  });

  it('only shows setup completion from real persisted camera/region/worker state and never from tour completion', async () => {
    let cameraVersion = 2;
    let savedRegions: RegionResponse[] = [];
    let workerReportedRevision = 2;
    let workerState: CameraApplicationStatus['applicationState'] = 'LOADED';

    transport.listCameras.mockImplementation(async () => ({
      items: [makeCamera({ configurationVersion: cameraVersion })],
      total: 1,
    }));
    transport.listRegions.mockImplementation(async () => ({
      items: savedRegions,
      total: savedRegions.length,
    }));
    transport.getCameraApplicationStatus.mockImplementation(async (_token, siteId, cameraId) => {
      const nowIso = new Date().toISOString();
      return {
        siteId,
        cameraId,
        desiredRevision: cameraVersion,
        reportedRevision: workerReportedRevision,
        applicationState: workerState,
        viewValidity: 'UNCONFIRMED',
        reasonCode: workerState === 'LOADED' ? null : 'WORKER_POLL_PENDING',
        lastReceiptAt: nowIso,
        observedAt: nowIso,
      } satisfies CameraApplicationStatus;
    });

    const { queryClient } = renderSetup();

    const checklist = await screen.findByTestId('camera-setup-checklist');
    await waitFor(() =>
      expect(within(checklist).getByText('No active polygon saved yet')).toBeTruthy(),
    );
    expect(checklist.getAttribute('data-setup-state')).toBe('INCOMPLETE');
    expect(checklist.getAttribute('data-setup-complete')).toBe('false');

    // Completing the guided tour in localStorage must NEVER mark camera setup complete
    fireEvent.click(await screen.findByTestId('safety-task-tour-invitation-start'));
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    }
    fireEvent.click(screen.getByTestId('safety-task-tour-done'));
    expect(screen.getByTestId('safety-task-tour-trigger').textContent).toBe('Replay guide');
    expect(checklist.getAttribute('data-setup-state')).toBe('INCOMPLETE');
    expect(checklist.getAttribute('data-setup-complete')).toBe('false');

    // Persisted active polygon saved (v3), but worker still on v2 (PENDING) -> SAVED_NOT_APPLIED
    cameraVersion = 3;
    workerReportedRevision = 2;
    workerState = 'PENDING';
    savedRegions = [
      {
        id: REGION_1_ID,
        cameraId: CAM_ACTIVE_ID,
        zoneId: ZONE_1_ID,
        polygon: {
          coordinates: [
            [0.1, 0.1],
            [0.6, 0.1],
            [0.5, 0.7],
          ],
        },
        coordinateSpace: 'NORMALIZED_0_1',
        version: 1,
        isActive: true,
        createdAt: '2026-03-01T00:00:00.000Z',
        geometryConfirmation: {
          status: 'MANUALLY_CONFIRMED',
          referenceId: '33333333-3333-4333-8333-333333333333',
          viewRevision: 1,
          confirmedByUserId: 'manager-alpha',
          confirmedAt: '2026-03-01T00:00:00.000Z',
        },
      },
    ];
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['camera-setup'] });
    });

    await waitFor(() => {
      expect(checklist.getAttribute('data-setup-state')).toBe('SAVED_NOT_APPLIED');
    });
    expect(checklist.getAttribute('data-config-saved')).toBe('true');
    expect(checklist.getAttribute('data-worker-applied')).toBe('false');
    expect(checklist.getAttribute('data-setup-complete')).toBe('false');
    expect(within(checklist).getByText('Config saved (v3) · Not worker-applied')).toBeTruthy();
    expect(within(checklist).getByText('Saved · 1 active region(s)')).toBeTruthy();

    // Fresh worker receipt acknowledges v3 -> APPLIED and setup complete
    workerReportedRevision = 3;
    workerState = 'LOADED';
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['camera-setup'] });
    });

    await waitFor(() => {
      expect(checklist.getAttribute('data-setup-state')).toBe('APPLIED');
    });
    expect(checklist.getAttribute('data-config-saved')).toBe('true');
    expect(checklist.getAttribute('data-worker-applied')).toBe('true');
    expect(checklist.getAttribute('data-setup-complete')).toBe('true');
    expect(
      within(checklist).getByText('Setup complete · Saved & worker-applied (v3)'),
    ).toBeTruthy();

    // Moving the camera can retire the reference without changing the saved configuration revision.
    const [previousRegion] = savedRegions;
    savedRegions = [
      {
        ...previousRegion!,
        geometryConfirmation: {
          ...previousRegion!.geometryConfirmation!,
          status: 'NEEDS_REVALIDATION',
          referenceId: '33333333-3333-4333-8333-333333333333',
          viewRevision: 1,
          confirmedByUserId: 'manager-alpha',
          confirmedAt: '2026-03-01T00:00:00.000Z',
        },
      },
    ];
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['camera-setup'] });
    });
    await waitFor(() => {
      expect(checklist.getAttribute('data-setup-complete')).toBe('false');
    });
    expect(checklist.getAttribute('data-setup-state')).toBe('INCOMPLETE');
    expect(
      within(checklist).getByText('Confirm active regions on the current camera view'),
    ).toBeTruthy();
  });
});
