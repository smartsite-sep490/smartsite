// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type LoginResponse,
  type SmartSiteManagementClient,
} from '@smartsite/api-client';
import type {
  CameraResponse,
  Page,
  RegionResponse,
  SiteResponse,
  ZoneResponse,
} from '@smartsite/contracts/management';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import { RestrictedZoneView } from './RestrictedZoneView';
import { resolveZoneMonitorStageState } from './zone-monitor-model';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const mockClient = vi.hoisted(() => ({ current: null as unknown as SmartSiteManagementClient }));

vi.mock('../../features/auth/auth-session', () => ({
  useManagementClient: () => mockClient.current,
}));

vi.mock('../ppe/FocusedCameraMedia', () => ({
  FocusedCameraMedia: ({ siteId, camera }: { siteId: string; camera: { id: string } }) => (
    <div data-testid="mock-focused-camera-media" data-site={siteId} data-camera={camera.id} />
  ),
}));

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SITE_ID = '99999999-9999-4999-8999-999999999999';
const ACTIVE_CAM_ID = '22222222-2222-4222-8222-222222222201';
const INACTIVE_CAM_IDS = [
  '22222222-2222-4222-8222-222222222211',
  '22222222-2222-4222-8222-222222222212',
  '22222222-2222-4222-8222-222222222213',
  '22222222-2222-4222-8222-222222222214',
];
const GATE_CAM_ID = '22222222-2222-4222-8222-222222222299';

const MANAGER_SESSION: Pick<LoginResponse, 'accessToken' | 'user'> = {
  accessToken: 'tok-manager',
  user: {
    id: 'manager-1',
    username: 'test.manager',
    displayName: 'Test Manager',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'SITE_MANAGER', siteId: SITE_ID }],
  },
};

const OFFICER_SESSION: Pick<LoginResponse, 'accessToken' | 'user'> = {
  accessToken: 'tok-officer',
  user: {
    id: 'officer-1',
    username: 'test.safety',
    displayName: 'Test Safety Officer',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: SITE_ID }],
  },
};

function makeCamera(overrides: Partial<CameraResponse> & { id: string }): CameraResponse {
  return {
    type: 'ZONE',
    gateId: null,
    siteId: SITE_ID,
    externalId: `ext-${overrides.id.slice(-4)}`,
    code: `CAM-${overrides.id.slice(-2)}`,
    name: `Camera ${overrides.id.slice(-2)}`,
    status: 'INACTIVE',
    configurationVersion: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

const FOUR_INACTIVE_PLUS_GATE: CameraResponse[] = [
  ...INACTIVE_CAM_IDS.map((id, idx) =>
    makeCamera({ id, code: `CAM-${idx + 1}`, name: `Zone Camera ${idx + 1}`, status: 'INACTIVE' }),
  ),
  makeCamera({
    id: GATE_CAM_ID,
    type: 'GATE',
    gateId: 'b38f02d9-984b-4633-a266-8511f2e702f0',
    code: 'CAM-GATE-01',
    name: 'Main Gate Camera',
    status: 'INACTIVE',
  }),
];

const SITE_ZONES: ZoneResponse[] = [
  {
    id: '33333333-3333-4333-8333-333333333301',
    siteId: SITE_ID,
    code: 'Z-01',
    name: 'Restricted Crane Bay',
    type: 'RESTRICTED',
    restrictionPolicy: 'PROHIBITED_FOR_ALL',
    requiredPpe: [],
    configurationLocked: false,
    createdAt: '2026-11-01T00:00:00.000Z',
  },
];

function makeClient(overrides: Partial<SmartSiteManagementClient> = {}): SmartSiteManagementClient {
  return {
    listSites: vi.fn().mockResolvedValue({
      items: [
        {
          id: SITE_ID,
          code: 'TEST-SITE',
          name: 'Test Construction Site',
          createdAt: '2026-11-01T00:00:00.000Z',
        },
      ],
      total: 1,
    } satisfies Page<SiteResponse>),
    listCameras: vi.fn().mockResolvedValue({
      items: FOUR_INACTIVE_PLUS_GATE,
      total: FOUR_INACTIVE_PLUS_GATE.length,
    } satisfies Page<CameraResponse>),
    listRegions: vi.fn().mockResolvedValue({ items: [], total: 0 } satisfies Page<RegionResponse>),
    listZones: vi.fn().mockResolvedValue({
      items: SITE_ZONES,
      total: SITE_ZONES.length,
    } satisfies Page<ZoneResponse>),
    ...overrides,
  } as unknown as SmartSiteManagementClient;
}

describe('resolveZoneMonitorStageState pure derivation', () => {
  const base = {
    sitesPending: false,
    sitesError: false,
    sitesErrorStatus: null,
    scopedSiteCount: 1,
    hasSelectedSite: true,
    hasUnresolvedLinkedSite: false,
    firstAvailableSiteId: SITE_ID,
    camerasPending: false,
    camerasError: false,
    camerasErrorStatus: null,
    hasUnresolvedLinkedCamera: false,
    firstActiveCameraId: null,
    inactiveZoneCameraCount: 0,
    gateCameraCount: 0,
  };

  it('distinguishes loading, denied, error, missing links, inactive cameras, and zero cameras', () => {
    expect(resolveZoneMonitorStageState({ ...base, sitesPending: true })).toEqual({
      kind: 'LOADING',
    });
    expect(
      resolveZoneMonitorStageState({ ...base, sitesError: true, sitesErrorStatus: 403 }),
    ).toEqual({ kind: 'DENIED', source: 'sites' });
    expect(
      resolveZoneMonitorStageState({ ...base, sitesError: true, sitesErrorStatus: 503 }),
    ).toEqual({ kind: 'LOAD_ERROR', source: 'sites' });
    expect(
      resolveZoneMonitorStageState({
        ...base,
        hasUnresolvedLinkedSite: true,
        hasSelectedSite: false,
      }),
    ).toEqual({ kind: 'LINKED_SITE_UNAVAILABLE', fallbackSiteId: SITE_ID });
    expect(
      resolveZoneMonitorStageState({
        ...base,
        scopedSiteCount: 0,
        hasSelectedSite: false,
        camerasPending: true,
      }),
    ).toEqual({ kind: 'NO_SITES' });
    expect(resolveZoneMonitorStageState({ ...base, camerasPending: true })).toEqual({
      kind: 'LOADING',
    });
    expect(
      resolveZoneMonitorStageState({ ...base, camerasError: true, camerasErrorStatus: 403 }),
    ).toEqual({ kind: 'DENIED', source: 'cameras' });
    expect(
      resolveZoneMonitorStageState({ ...base, camerasError: true, camerasErrorStatus: 503 }),
    ).toEqual({ kind: 'LOAD_ERROR', source: 'cameras' });
    expect(
      resolveZoneMonitorStageState({
        ...base,
        hasUnresolvedLinkedCamera: true,
        firstActiveCameraId: ACTIVE_CAM_ID,
      }),
    ).toEqual({
      kind: 'LINKED_CAMERA_UNAVAILABLE',
      fallbackCameraId: ACTIVE_CAM_ID,
      inactiveZoneCameraCount: 0,
    });
    expect(resolveZoneMonitorStageState({ ...base, inactiveZoneCameraCount: 4 })).toEqual({
      kind: 'ALL_CAMERAS_INACTIVE',
      inactiveZoneCameraCount: 4,
    });
    expect(resolveZoneMonitorStageState({ ...base, gateCameraCount: 1 })).toEqual({
      kind: 'NO_ZONE_CAMERAS',
      gateCameraCount: 1,
    });
  });
});

describe('RestrictedZoneView honest empty, loading, denied, and error states', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    window.localStorage.clear();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'vi');
    await i18n.changeLanguage('vi');
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('shows 4 inactive zone cameras and Camera Setup CTA for Site Manager instead of generic administrator error (VI & EN)', async () => {
    mockClient.current = makeClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/zones?siteId=${SITE_ID}`]}>
          <RestrictedZoneView
            apiUrl="http://api.invalid"
            authenticatedSession={MANAGER_SESSION}
            linkedSiteId={SITE_ID}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const card = await screen.findByTestId('zones-stage-all-inactive');
    expect(card.textContent).toContain('Chưa có camera khu vực nào đang hoạt động.');
    expect(card.textContent).toContain('4 camera khu vực');
    expect(card.textContent).toContain('Đang tắt');
    expect(screen.queryByText(/Không thể xem camera lúc này/i)).toBeNull();
    expect(screen.queryByText(/quản trị viên/i)).toBeNull();

    const setupLink = screen.getByTestId('zones-empty-open-camera-setup');
    expect(setupLink.getAttribute('href')).toBe(`/camera-setup?siteId=${SITE_ID}`);

    await i18n.changeLanguage('en');
    await waitFor(() => {
      expect(card.textContent).toContain('No active zone cameras on this site.');
      expect(card.textContent).toContain('4 zone camera(s) are saved as Disabled');
    });
    expect(screen.queryByText(/Contact your administrator/i)).toBeNull();
  });

  it('keeps Safety Officer read-only with no Camera Setup CTA when all zone cameras are inactive', async () => {
    mockClient.current = makeClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/zones?siteId=${SITE_ID}`]}>
          <RestrictedZoneView
            apiUrl="http://api.invalid"
            authenticatedSession={OFFICER_SESSION}
            linkedSiteId={SITE_ID}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const card = await screen.findByTestId('zones-stage-all-inactive');
    expect(card.textContent).toContain('4 camera khu vực');
    expect(card.textContent).toContain('Quản lý công trường được phân công');
    expect(screen.queryByTestId('zones-empty-open-camera-setup')).toBeNull();
    expect(screen.queryByRole('link', { name: /Thiết lập camera|Camera setup/i })).toBeNull();
  });

  it('distinguishes a site with zero zone cameras and notes gate-only cameras separately', async () => {
    mockClient.current = makeClient({
      listCameras: vi.fn().mockResolvedValue({
        items: [
          makeCamera({
            id: GATE_CAM_ID,
            type: 'GATE',
            gateId: 'b38f02d9-984b-4633-a266-8511f2e702f0',
            code: 'CAM-GATE-01',
            name: 'Gate Camera',
            status: 'ACTIVE',
          }),
        ],
        total: 1,
      } satisfies Page<CameraResponse>),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/zones?siteId=${SITE_ID}`]}>
          <RestrictedZoneView
            apiUrl="http://api.invalid"
            authenticatedSession={MANAGER_SESSION}
            linkedSiteId={SITE_ID}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const card = await screen.findByTestId('zones-stage-no-zone-cameras');
    expect(card.textContent).toContain('Chưa có camera khu vực nào được đăng ký');
    expect(card.textContent).toContain('1 camera cổng');
    expect(screen.getByTestId('zones-empty-open-camera-setup')).toBeTruthy();
    expect(screen.queryByText(/Không thể xem camera lúc này/i)).toBeNull();
  });

  it('shows loading indicator while camera list is pending without flashing an error', async () => {
    let resolveCameras!: (value: Page<CameraResponse>) => void;
    mockClient.current = makeClient({
      listCameras: vi.fn().mockReturnValue(
        new Promise<Page<CameraResponse>>((resolve) => {
          resolveCameras = resolve;
        }),
      ),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/zones?siteId=${SITE_ID}`]}>
          <RestrictedZoneView
            apiUrl="http://api.invalid"
            authenticatedSession={MANAGER_SESSION}
            linkedSiteId={SITE_ID}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const loading = await screen.findByTestId('zones-stage-loading');
    expect(loading.getAttribute('role')).toBe('status');
    expect(screen.queryByTestId('zones-stage-error')).toBeNull();
    expect(screen.queryByText(/Không thể xem camera lúc này/i)).toBeNull();

    resolveCameras({ items: FOUR_INACTIVE_PLUS_GATE, total: FOUR_INACTIVE_PLUS_GATE.length });
    await screen.findByTestId('zones-stage-all-inactive');
  });

  it('shows an error banner with working Retry when GET /cameras fails with 503', async () => {
    const user = userEvent.setup();
    const listCameras = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('http', 'SERVICE_UNAVAILABLE', 503))
      .mockResolvedValueOnce({
        items: [makeCamera({ id: ACTIVE_CAM_ID, status: 'ACTIVE' })],
        total: 1,
      } satisfies Page<CameraResponse>);
    mockClient.current = makeClient({ listCameras });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/zones?siteId=${SITE_ID}`]}>
          <RestrictedZoneView
            apiUrl="http://api.invalid"
            authenticatedSession={MANAGER_SESSION}
            linkedSiteId={SITE_ID}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const errorCard = await screen.findByTestId('zones-stage-error');
    expect(errorCard.getAttribute('role')).toBe('alert');
    expect(errorCard.textContent).toContain('Không tải được danh sách camera giám sát');
    expect(screen.queryByTestId('zones-stage-all-inactive')).toBeNull();

    await user.click(screen.getByTestId('zones-stage-retry'));
    const media = await screen.findByTestId('mock-focused-camera-media');
    expect(media.getAttribute('data-camera')).toBe(ACTIVE_CAM_ID);
    expect(listCameras).toHaveBeenCalledTimes(2);
  });

  it('shows a restricted access alert when GET /cameras returns 403 instead of empty cameras', async () => {
    mockClient.current = makeClient({
      listCameras: vi.fn().mockRejectedValue(new ApiError('http', 'FORBIDDEN', 403)),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/zones?siteId=${SITE_ID}`]}>
          <RestrictedZoneView
            apiUrl="http://api.invalid"
            authenticatedSession={OFFICER_SESSION}
            linkedSiteId={SITE_ID}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const deniedCard = await screen.findByTestId('zones-stage-denied');
    expect(deniedCard.getAttribute('role')).toBe('alert');
    expect(deniedCard.textContent).toContain('không có quyền xem camera');
    expect(screen.queryByTestId('zones-stage-all-inactive')).toBeNull();
    expect(screen.queryByTestId('zones-empty-open-camera-setup')).toBeNull();
  });

  it('distinguishes an unavailable linked camera and allows switching to an available active camera', async () => {
    const user = userEvent.setup();
    mockClient.current = makeClient({
      listCameras: vi.fn().mockResolvedValue({
        items: [
          makeCamera({ id: INACTIVE_CAM_IDS[0]!, status: 'INACTIVE' }),
          makeCamera({
            id: ACTIVE_CAM_ID,
            status: 'ACTIVE',
            code: 'CAM-LIVE',
            name: 'Active Zone Cam',
          }),
        ],
        total: 2,
      } satisfies Page<CameraResponse>),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/zones?siteId=${SITE_ID}&cameraId=${INACTIVE_CAM_IDS[0]}`]}>
          <RestrictedZoneView
            apiUrl="http://api.invalid"
            authenticatedSession={OFFICER_SESSION}
            linkedSiteId={SITE_ID}
            linkedCameraId={INACTIVE_CAM_IDS[0]}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const linkedCard = await screen.findByTestId('zones-stage-linked-camera-unavailable');
    expect(linkedCard.textContent).toContain('Camera trong liên kết không khả dụng');

    await user.click(screen.getByTestId('zones-stage-switch-camera'));
    const media = await screen.findByTestId('mock-focused-camera-media');
    expect(media.getAttribute('data-camera')).toBe(ACTIVE_CAM_ID);
  });

  it('distinguishes an unavailable linked site and allows switching to an available site', async () => {
    const user = userEvent.setup();
    mockClient.current = makeClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/zones?siteId=${OTHER_SITE_ID}`]}>
          <RestrictedZoneView
            apiUrl="http://api.invalid"
            authenticatedSession={MANAGER_SESSION}
            linkedSiteId={OTHER_SITE_ID}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const linkedSiteCard = await screen.findByTestId('zones-stage-linked-site-unavailable');
    expect(linkedSiteCard.textContent).toContain('Công trường trong liên kết không khả dụng');

    await user.click(screen.getByTestId('zones-stage-switch-site'));
    await screen.findByTestId('zones-stage-all-inactive');
  });
});
