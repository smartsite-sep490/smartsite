// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraApplicationStatus } from '@smartsite/contracts/camera-application-status';
import type { CameraResponse, Page, SiteResponse } from '@smartsite/contracts/management';
import i18n from '../../i18n';
import type { SharedSession } from '../../types/shared-session';
import { CameraSetupView } from './CameraSetupView';

const mockUseManagementClient = vi.fn();

vi.mock('../../features/auth/auth-session', () => ({
  useManagementClient: (apiUrl: string) => mockUseManagementClient(apiUrl),
}));

const API_URL = 'https://api.smartsite.local';
const SITE_ID = '11111111-1111-4111-8111-111111111111';
const GATE_ID = '33333333-3333-4333-8333-333333333331';
const GATE_CAM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
const ZONE_CAM_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02';

const SITE: SiteResponse = {
  id: SITE_ID,
  code: 'SITE-ALPHA',
  name: 'Alpha Construction Site',
  createdAt: '2026-11-01T00:00:00.000Z',
};

const GATE_CAMERA_ACTIVE: CameraResponse = {
  id: GATE_CAM_ID,
  siteId: SITE_ID,
  code: 'GATE-CAM-01',
  name: 'Main Entrance Gate Camera',
  externalId: 'gate-main-01',
  type: 'GATE',
  gateId: GATE_ID,
  status: 'ACTIVE',
  configurationVersion: 3,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const ZONE_CAMERA_ACTIVE: CameraResponse = {
  id: ZONE_CAM_ID,
  siteId: SITE_ID,
  code: 'ZONE-CAM-02',
  name: 'North Scaffold Camera',
  externalId: 'zone-north-02',
  type: 'ZONE',
  gateId: null,
  status: 'ACTIVE',
  configurationVersion: 4,
  createdAt: '2026-11-02T00:00:00.000Z',
};

function makeManagerSession(): SharedSession {
  return {
    accessToken: 'token-gate-boundary',
    sessionScope: 'scope-gate-boundary',
    onSignOut: vi.fn(),
    user: {
      id: 'user-manager-gate',
      displayName: 'Site Manager Gate',
      mustChangePassword: false,
      roleAssignments: [{ role: 'SITE_MANAGER', siteId: SITE_ID }],
    },
  };
}

function createTransport(cameras: CameraResponse[]) {
  const nowIso = new Date().toISOString();
  return {
    listSites: vi.fn<SmartSiteManagementClient['listSites']>().mockResolvedValue({
      items: [SITE],
      total: 1,
    } satisfies Page<SiteResponse>),
    listCameras: vi.fn<SmartSiteManagementClient['listCameras']>().mockResolvedValue({
      items: cameras,
      total: cameras.length,
    } satisfies Page<CameraResponse>),
    getCamera: vi
      .fn<SmartSiteManagementClient['getCamera']>()
      .mockImplementation(async (_t, _s, id) => {
        const match = cameras.find((c) => c.id === id);
        if (!match) throw new Error('Not found');
        return match;
      }),
    getCameraApplicationStatus: vi
      .fn<SmartSiteManagementClient['getCameraApplicationStatus']>()
      .mockImplementation(
        async (_t, siteId, cameraId) =>
          ({
            siteId,
            cameraId,
            desiredRevision: 4,
            reportedRevision: 4,
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
    }),
    listRegions: vi.fn<SmartSiteManagementClient['listRegions']>().mockResolvedValue({
      items: [],
      total: 0,
    }),
    readSavedPpePolicy: vi
      .fn<SmartSiteManagementClient['readSavedPpePolicy']>()
      .mockImplementation(async (_t, _s, cameraId, regionId = null) => ({
        cameraId,
        regionId,
        configurationVersion: 4,
        savedRevision: null,
        policy: null,
      })),
  };
}

describe('CameraSetup GATE camera boundary (follow-up to #338)', () => {
  beforeEach(async () => {
    vi.stubEnv('VITE_SMARTSITE_ENABLE_SOURCE_SETUP', 'true');
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('keeps GATE cameras out of PPE/Zone monitoring links and Zone AI setup while routing clearly to gate configuration (EN/VI)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ hosts: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const transport = createTransport([GATE_CAMERA_ACTIVE, ZONE_CAMERA_ACTIVE]);
    mockUseManagementClient.mockReturnValue(transport);

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[`/camera-setup?siteId=${SITE_ID}`]}>
          <CameraSetupView apiUrl={API_URL} sharedSession={makeManagerSession()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Default selection prefers the ZONE camera when mixed with a GATE camera
    const sourceList = await screen.findByTestId('camera-setup-source-list');
    const zoneItem = within(sourceList).getByRole('listitem', { name: ZONE_CAMERA_ACTIVE.name });
    const gateItem = within(sourceList).getByRole('listitem', { name: GATE_CAMERA_ACTIVE.name });

    expect(zoneItem.getAttribute('aria-current')).toBe('true');
    expect(within(zoneItem).getByRole('link', { name: /PPE monitoring/i })).toBeTruthy();

    // GATE row NEVER exposes PPE/Zone monitoring links or ZONE setup actions; routes to Site Setup
    expect(within(gateItem).getByTestId('camera-row-type-gate')).toBeTruthy();
    expect(within(gateItem).queryByRole('link', { name: /PPE monitoring/i })).toBeNull();
    expect(within(gateItem).queryByRole('link', { name: /Zone monitoring/i })).toBeNull();
    expect(within(gateItem).queryByRole('button', { name: /^Regions$/i })).toBeNull();
    expect(within(gateItem).queryByRole('button', { name: /^PPE policy$/i })).toBeNull();
    expect(within(gateItem).queryByRole('button', { name: /Manage/i })).toBeNull();

    const expectedGateHref = `/site-setup?siteId=${SITE_ID}&gateId=${GATE_ID}`;
    const gateRowLink = within(gateItem).getByRole('link', { name: /Open Site Setup/i });
    expect(gateRowLink.getAttribute('href')).toBe(expectedGateHref);

    // Select the GATE camera and verify detail pane + header isolation
    fetchSpy.mockClear();
    transport.getCameraApplicationStatus.mockClear();
    transport.readSavedPpePolicy.mockClear();

    fireEvent.click(within(gateItem).getByRole('button', { name: 'Select GATE-CAM-01' }));

    const boundaryStage = await screen.findByTestId('camera-setup-gate-boundary-stage');
    expect(boundaryStage.textContent).toMatch(/Gate camera/i);
    expect(boundaryStage.textContent).toMatch(/Site Setup/i);
    expect(boundaryStage.textContent).not.toMatch(/MF04/i);
    expect(
      within(boundaryStage).getByTestId('gate-camera-open-site-setup').getAttribute('href'),
    ).toBe(expectedGateHref);

    // Sticky header shows Gate badge + gate config link, and hides all ZONE tabs / apply / monitoring
    const stickyHeader = screen.getByTestId('camera-setup-sticky-header');
    expect(within(stickyHeader).getByTestId('selected-camera-type-gate')).toBeTruthy();
    expect(
      within(stickyHeader).getByTestId('selected-gate-camera-config-link').getAttribute('href'),
    ).toBe(expectedGateHref);
    expect(within(stickyHeader).queryByTestId('camera-setup-task-tabs')).toBeNull();
    expect(within(stickyHeader).queryByTestId('selected-camera-monitor-ppe')).toBeNull();
    expect(within(stickyHeader).queryByTestId('selected-camera-monitor-zones')).toBeNull();
    expect(screen.queryByTestId('camera-source-setup-panel')).toBeNull();
    expect(screen.queryByTestId('camera-ppe-policy-panel')).toBeNull();

    // Top-bar monitoring links must NOT include the GATE cameraId
    const topMonitorNav = screen.getByRole('navigation', { name: /Open monitoring/i });
    const topPpeHref = within(topMonitorNav)
      .getByRole('link', { name: /PPE monitoring/i })
      .getAttribute('href');
    const topZonesHref = within(topMonitorNav)
      .getByRole('link', { name: /Zone monitoring/i })
      .getAttribute('href');
    expect(topPpeHref).toBe(`/ppe?siteId=${SITE_ID}`);
    expect(topZonesHref).toBe(`/zones?siteId=${SITE_ID}`);

    // Zero ZONE AI host/status/policy requests fired for the GATE camera
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes(GATE_CAM_ID))).toBe(false);
    expect(
      transport.getCameraApplicationStatus.mock.calls.some(([, , id]) => id === GATE_CAM_ID),
    ).toBe(false);
    expect(transport.readSavedPpePolicy.mock.calls.some(([, , id]) => id === GATE_CAM_ID)).toBe(
      false,
    );

    // Vietnamese localization check (plain user language, zero internal MF04 codes)
    await i18n.changeLanguage('vi');
    await waitFor(() => {
      const viStage = screen.getByTestId('camera-setup-gate-boundary-stage');
      expect(viStage.textContent).toMatch(/Camera cổng/i);
      expect(viStage.textContent).toMatch(/Mở Thiết lập công trường/i);
      expect(viStage.textContent).not.toMatch(/MF04/i);
    });
  });

  it('refuses deep-linked action=ppe and action=regions on a GATE camera and routes to gate configuration even when a site has only GATE cameras', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ hosts: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const transport = createTransport([
      { ...GATE_CAMERA_ACTIVE, status: 'INACTIVE', gateId: null },
    ]);
    mockUseManagementClient.mockReturnValue(transport);

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter
          initialEntries={[
            `/camera-setup?siteId=${SITE_ID}&cameraId=${GATE_CAM_ID}&action=regions`,
          ]}
        >
          <CameraSetupView apiUrl={API_URL} sharedSession={makeManagerSession()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const boundaryStage = await screen.findByTestId('camera-setup-gate-boundary-stage');
    expect(
      within(boundaryStage).getByTestId('gate-camera-open-site-setup').getAttribute('href'),
    ).toBe(`/site-setup?siteId=${SITE_ID}`);
    expect(screen.queryByTestId('camera-setup-disabled-stage')).toBeNull();
    expect(screen.queryByTestId('camera-setup-empty-catalog')).toBeNull();
    expect(screen.queryByTestId('camera-ppe-policy-panel')).toBeNull();
    expect(screen.queryByTestId('camera-source-setup-panel')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(transport.getCameraApplicationStatus).not.toHaveBeenCalled();
    expect(transport.readSavedPpePolicy).not.toHaveBeenCalled();
    expect(transport.listRegions).not.toHaveBeenCalled();
  });
});
