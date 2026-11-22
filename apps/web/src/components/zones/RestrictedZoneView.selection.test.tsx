// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoginResponse, SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraApplicationStatus } from '@smartsite/contracts/camera-application-status';
import type {
  CameraResponse,
  Page,
  RegionResponse,
  SiteResponse,
  ZoneResponse,
} from '@smartsite/contracts/management';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import { RestrictedZoneView } from './RestrictedZoneView';

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

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

const SITE_A_ID = '11111111-1111-4111-8111-111111111111';
const SITE_B_ID = '22222222-2222-4222-8222-222222222222';
const CAM_1_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAM_2_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAM_B1_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const MANAGER_SESSION: Pick<LoginResponse, 'accessToken' | 'user'> = {
  accessToken: 'tok-manager',
  user: {
    id: 'manager-1',
    username: 'demo.manager',
    displayName: 'Site Manager Demo',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [
      { role: 'SITE_MANAGER', siteId: SITE_A_ID },
      { role: 'SITE_MANAGER', siteId: SITE_B_ID },
    ],
  },
};

const CAM_1: CameraResponse = {
  type: 'ZONE',
  gateId: null,
  id: CAM_1_ID,
  siteId: SITE_A_ID,
  externalId: 'demo-cam-1',
  code: 'LAPTOP-DEMO',
  name: 'Old Demo Camera',
  status: 'ACTIVE',
  configurationVersion: 2,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const CAM_2: CameraResponse = {
  type: 'ZONE',
  gateId: null,
  id: CAM_2_ID,
  siteId: SITE_A_ID,
  externalId: 'setup-cam-2',
  code: 'LAPTOP-SETUP',
  name: 'Setup Camera',
  status: 'ACTIVE',
  configurationVersion: 3,
  createdAt: '2026-11-02T00:00:00.000Z',
};

const CAM_B1: CameraResponse = {
  type: 'ZONE',
  gateId: null,
  id: CAM_B1_ID,
  siteId: SITE_B_ID,
  externalId: 'beta-cam-1',
  code: 'BETA-1',
  name: 'Beta Camera',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-11-02T00:00:00.000Z',
};

function makeClient(): SmartSiteManagementClient {
  const nowIso = new Date().toISOString();
  return {
    listSites: vi.fn().mockResolvedValue({
      items: [
        {
          id: SITE_A_ID,
          code: 'SITE-A',
          name: 'Alpha Site',
          createdAt: '2026-11-01T00:00:00.000Z',
        },
        {
          id: SITE_B_ID,
          code: 'SITE-B',
          name: 'Beta Site',
          createdAt: '2026-11-01T00:00:00.000Z',
        },
      ],
      total: 2,
    } satisfies Page<SiteResponse>),
    listCameras: vi.fn().mockImplementation(async (_token: string, siteId: string) => ({
      items: siteId === SITE_B_ID ? [CAM_B1] : [CAM_1, CAM_2],
      total: siteId === SITE_B_ID ? 1 : 2,
    })),
    listRegions: vi.fn().mockResolvedValue({ items: [], total: 0 } satisfies Page<RegionResponse>),
    listZones: vi.fn().mockResolvedValue({ items: [], total: 0 } satisfies Page<ZoneResponse>),
    getCameraApplicationStatus: vi.fn().mockImplementation(
      async (_token, siteId, cameraId) =>
        ({
          siteId,
          cameraId,
          desiredRevision: 2,
          reportedRevision: 2,
          applicationState: 'LOADED',
          viewValidity: 'UNCONFIRMED',
          reasonCode: null,
          lastReceiptAt: nowIso,
          observedAt: nowIso,
        }) satisfies CameraApplicationStatus,
    ),
  } as unknown as SmartSiteManagementClient;
}

describe('RestrictedZoneView URL selection persistence', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    window.localStorage.clear();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockClient.current = makeClient();
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it('syncs siteId and cameraId to the URL on selection and responds to external prop updates', async () => {
    const view = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/zones']}>
          <RestrictedZoneView
            apiUrl="https://api.smartsite.local"
            authenticatedSession={MANAGER_SESSION}
          />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const preview = await screen.findByTestId('mock-focused-camera-media');
    expect(preview.getAttribute('data-camera')).toBe(CAM_1_ID);

    const selects = screen.getAllByRole('combobox');
    // Camera selector is the second combobox (Site, Camera, Region/Zone)
    fireEvent.change(selects[1]!, { target: { value: CAM_2_ID } });
    await waitFor(() =>
      expect(screen.getByTestId('mock-focused-camera-media').getAttribute('data-camera')).toBe(
        CAM_2_ID,
      ),
    );
    expect(screen.getByTestId('location-probe').textContent).toBe(
      `/zones?siteId=${SITE_A_ID}&cameraId=${CAM_2_ID}`,
    );

    // Switching Site drops previous site's cameraId from URL
    fireEvent.change(selects[0]!, { target: { value: SITE_B_ID } });
    await waitFor(() =>
      expect(screen.getByTestId('mock-focused-camera-media').getAttribute('data-camera')).toBe(
        CAM_B1_ID,
      ),
    );
    expect(screen.getByTestId('location-probe').textContent).toBe(`/zones?siteId=${SITE_B_ID}`);

    // External route prop update (without remounting) syncs active Site & Camera
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/zones']}>
          <RestrictedZoneView
            apiUrl="https://api.smartsite.local"
            authenticatedSession={MANAGER_SESSION}
            linkedSiteId={SITE_A_ID}
            linkedCameraId={CAM_2_ID}
          />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('mock-focused-camera-media').getAttribute('data-camera')).toBe(
        CAM_2_ID,
      ),
    );
  });
});
