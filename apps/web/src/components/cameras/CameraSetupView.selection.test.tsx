// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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
import type { SharedSession } from '../../types/shared-session';
import { CameraSetupView } from './CameraSetupView';

const mockUseManagementClient = vi.fn();

vi.mock('../../features/auth/auth-session', () => ({
  useManagementClient: (apiUrl: string) => mockUseManagementClient(apiUrl),
}));

const API_URL = 'https://api.smartsite.local';
const SITE_A_ID = '11111111-1111-4111-8111-111111111111';
const SITE_B_ID = '22222222-2222-4222-8222-222222222222';
const CAM_1_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAM_2_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAM_CREATED_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const CAM_1: CameraResponse = {
  type: 'ZONE',
  gateId: null,
  id: CAM_1_ID,
  siteId: SITE_A_ID,
  code: 'LAPTOP-DEMO',
  name: 'Old Demo Camera',
  externalId: 'demo-01',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-03-01T00:00:00.000Z',
};

const CAM_2: CameraResponse = {
  type: 'ZONE',
  gateId: null,
  id: CAM_2_ID,
  siteId: SITE_A_ID,
  code: 'CAM-02',
  name: 'South Crane Camera',
  externalId: 'south-02',
  status: 'ACTIVE',
  configurationVersion: 2,
  createdAt: '2026-03-02T00:00:00.000Z',
};

const CAM_CREATED: CameraResponse = {
  type: 'ZONE',
  gateId: null,
  id: CAM_CREATED_ID,
  siteId: SITE_A_ID,
  code: 'LAPTOP-SETUP',
  name: 'Laptop Setup Camera',
  externalId: 'laptop-setup',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-03-03T00:00:00.000Z',
};

vi.mock('./CameraRegistrationDialog', () => ({
  CameraRegistrationDialog: ({
    open,
    onCreated,
  }: {
    open: boolean;
    onCreated?: (camera: CameraResponse) => void;
  }) =>
    open ? (
      <button
        type="button"
        data-testid="mock-complete-register"
        onClick={() => onCreated?.(CAM_CREATED)}
      >
        Complete mock registration
      </button>
    ) : null,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

function makeSession(): SharedSession {
  return {
    accessToken: 'token-valid-1',
    sessionScope: 'session-scope-1',
    onSignOut: vi.fn(),
    user: {
      id: 'user-manager-1',
      displayName: 'Site Manager One',
      mustChangePassword: false,
      roleAssignments: [
        { role: 'SITE_MANAGER', siteId: SITE_A_ID },
        { role: 'SITE_MANAGER', siteId: SITE_B_ID },
      ],
    },
  };
}

describe('CameraSetupView URL selection persistence', () => {
  let queryClient: QueryClient;
  let camerasForSiteA: CameraResponse[];

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    localStorage.clear();
    sessionStorage.clear();
    camerasForSiteA = [CAM_1, CAM_2];
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    const nowIso = new Date().toISOString();
    const transport = {
      listSites: vi.fn<SmartSiteManagementClient['listSites']>().mockResolvedValue({
        items: [
          {
            id: SITE_A_ID,
            code: 'SITE-A',
            name: 'Alpha Construction Site',
            createdAt: '2026-03-01T00:00:00.000Z',
          },
          {
            id: SITE_B_ID,
            code: 'SITE-B',
            name: 'Beta Logistics Yard',
            createdAt: '2026-03-01T00:00:00.000Z',
          },
        ],
        total: 2,
      } satisfies Page<SiteResponse>),
      listCameras: vi
        .fn<SmartSiteManagementClient['listCameras']>()
        .mockImplementation(async (_token, siteId) => ({
          items: siteId === SITE_A_ID ? camerasForSiteA : [],
          total: siteId === SITE_A_ID ? camerasForSiteA.length : 0,
        })),
      getCamera: vi
        .fn<SmartSiteManagementClient['getCamera']>()
        .mockImplementation(async (_token, _siteId, cameraId) => {
          return camerasForSiteA.find((c) => c.id === cameraId) ?? CAM_1;
        }),
      getCameraApplicationStatus: vi
        .fn<SmartSiteManagementClient['getCameraApplicationStatus']>()
        .mockImplementation(
          async (_token, siteId, cameraId) =>
            ({
              siteId,
              cameraId,
              desiredRevision: 1,
              reportedRevision: 1,
              applicationState: 'LOADED',
              viewValidity: 'UNCONFIRMED',
              reasonCode: null,
              lastReceiptAt: nowIso,
              observedAt: nowIso,
            }) satisfies CameraApplicationStatus,
        ),
      listZones: vi.fn<SmartSiteManagementClient['listZones']>().mockResolvedValue({
        items: [],
        total: 0,
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
          configurationVersion: 1,
          savedRevision: null,
          policy: null,
        })),
    };
    mockUseManagementClient.mockReturnValue(transport);
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it('writes selected and newly registered cameras to URL params and clears cameraId when switching sites', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[`/camera-setup?siteId=${SITE_A_ID}&cameraId=${CAM_1_ID}&action=ppe`]}
        >
          <CameraSetupView apiUrl={API_URL} sharedSession={makeSession()} />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const selectCam2Btn = await screen.findByRole('button', { name: /Select CAM-02/i });
    fireEvent.click(selectCam2Btn);

    await waitFor(() =>
      expect(screen.getByTestId('location-probe').textContent).toBe(
        `/camera-setup?siteId=${SITE_A_ID}&cameraId=${CAM_2_ID}`,
      ),
    );

    const monitoringNav = screen.getByRole('navigation', { name: 'Open monitoring' });
    expect(
      within(monitoringNav)
        .getByRole('link', { name: /PPE monitoring/i })
        .getAttribute('href'),
    ).toBe(`/ppe?siteId=${SITE_A_ID}&cameraId=${CAM_2_ID}`);
    expect(
      within(monitoringNav)
        .getByRole('link', { name: /Zone monitoring/i })
        .getAttribute('href'),
    ).toBe(`/zones?siteId=${SITE_A_ID}&cameraId=${CAM_2_ID}`);

    // Registering a new camera focuses it and persists it in URL for sidebar navigation
    const workflowGroup = screen.getByRole('group', { name: 'Camera setup actions' });
    fireEvent.click(within(workflowGroup).getByRole('button', { name: 'Register camera' }));
    camerasForSiteA = [CAM_1, CAM_2, CAM_CREATED];
    fireEvent.click(screen.getByTestId('mock-complete-register'));

    await waitFor(() =>
      expect(screen.getByTestId('location-probe').textContent).toBe(
        `/camera-setup?siteId=${SITE_A_ID}&cameraId=${CAM_CREATED_ID}`,
      ),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('navigation', { name: 'Open monitoring' }))
          .getByRole('link', { name: /PPE monitoring/i })
          .getAttribute('href'),
      ).toBe(`/ppe?siteId=${SITE_A_ID}&cameraId=${CAM_CREATED_ID}`),
    );

    // Switching Site clears previous site's cameraId from URL
    fireEvent.change(screen.getByRole('combobox', { name: 'Site' }), {
      target: { value: SITE_B_ID },
    });
    expect(screen.getByTestId('location-probe').textContent).toBe(
      `/camera-setup?siteId=${SITE_B_ID}`,
    );
  });
});
