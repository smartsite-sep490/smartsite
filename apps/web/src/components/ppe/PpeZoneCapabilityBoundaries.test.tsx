// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SmartSiteManagementClient,
  ApiError,
  type AccountResponse,
  type Page,
  type SiteResponse,
  type ZoneResponse,
} from '@smartsite/api-client';
import type { CameraResponse, RegionResponse } from '@smartsite/contracts';
import { LocaleProvider } from '../../i18n/LocaleProvider';
import i18n from '../../i18n';
import type { SharedSession } from '../../types/shared-session';
import type { DecodedPreview } from '../cameras/useRealtimePreview';
import { PpeMonitoringView } from './PpeMonitoringView';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const previewFixture: DecodedPreview = {
  image: {} as HTMLImageElement,
  frame: {
    sessionId: '00000000-0000-4000-8000-000000000001',
    sequenceNumber: '1',
    cameraExternalId: 'CAM-EXT-01',
    capturedAt: '2026-10-15T00:00:00.000Z',
    width: 640,
    height: 480,
    imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    zonePolygons: [],
    detections: [],
    zoneDetections: [],
  },
};

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: () => ({
    preview: previewFixture,
    status: 'LIVE' as const,
    sourceKind: 'LIVE' as const,
    error: null,
    errorStatus: null,
    isError: false,
    isLoading: false,
    isPolling: true,
    retry: vi.fn(),
    cameraExternalId: 'CAM-EXT-01',
    capturedAt: previewFixture.frame.capturedAt,
  }),
}));

vi.mock('../cameras/useScopedCameraMedia', () => ({
  useScopedCameraMedia: () => ({
    image: null,
    frame: null,
    status: 'LIVE' as const,
    error: null,
    errorStatus: null,
    isStreaming: false,
    retry: vi.fn(),
  }),
}));

vi.mock('../cameras/useScopedRecordedVideo', () => ({
  useScopedRecordedVideo: () => ({
    videoUrl: null,
    status: 'READY' as const,
    error: null,
    errorStatus: null,
    isLoading: false,
    retry: vi.fn(),
  }),
}));

vi.mock('../cameras/useRealtimePreview', () => ({
  useRealtimePreview: () => ({ preview: previewFixture, connected: true, error: null }),
}));

const mockSitesPage: Page<SiteResponse> = {
  items: [
    {
      id: 'site-alpha',
      code: 'SITE-A',
      name: 'Alpha Construction Site',
      createdAt: '2026-10-01T00:00:00Z',
    },
    {
      id: 'site-beta',
      code: 'SITE-B',
      name: 'Beta Construction Site',
      createdAt: '2026-10-01T00:00:00Z',
    },
  ],
  total: 2,
};

const mockCamerasPage: Page<CameraResponse> = {
  items: [
    {
      id: 'cam-alpha-1',
      siteId: 'site-alpha',
      externalId: 'CAM-EXT-01',
      code: 'CAM-01',
      name: 'Alpha Gate Camera',
      status: 'ACTIVE',
      configurationVersion: 1,
      createdAt: '2026-10-01T00:00:00Z',
    },
  ],
  total: 1,
};

const mockZonesAlpha: ZoneResponse[] = [
  {
    id: 'zone-1',
    siteId: 'site-alpha',
    code: 'ZONE-A1',
    name: 'Hazardous Scaffold Area',
    type: 'HAZARDOUS',
    restrictionPolicy: 'NONE',
    requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
    configurationLocked: false,
    createdAt: '2026-10-07T00:00:00Z',
  },
];

const mockRegionsPage: Page<RegionResponse> = {
  items: [
    {
      id: 'reg-alpha-1',
      cameraId: 'cam-alpha-1',
      zoneId: 'zone-1',
      polygon: {
        coordinates: [
          [0.1, 0.1],
          [0.5, 0.1],
          [0.5, 0.5],
          [0.1, 0.5],
        ],
      },
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
      createdAt: '2026-10-07T00:00:00Z',
    },
  ],
  total: 1,
};

function makeAccount(
  id: string,
  roleAssignments: AccountResponse['roleAssignments'],
  mustChangePassword = false,
): AccountResponse {
  return { id, username: id, displayName: id, roleAssignments, isActive: true, mustChangePassword };
}

function makeSession(
  accessToken: string,
  sessionScope: string,
  user: AccountResponse,
): SharedSession {
  return { accessToken, sessionScope, user };
}

describe('PpeMonitoringView & ZonePpeSetupPanel Role/Scope Capability Boundaries', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
    window.localStorage.clear();
    await i18n.changeLanguage('en');
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesPage);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockImplementation(
      async (_token, siteId) => ({
        items: mockCamerasPage.items.filter((c) => c.siteId === siteId),
        total: mockCamerasPage.items.filter((c) => c.siteId === siteId).length,
      }),
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockImplementation(
      async (_token, siteId) => ({
        items: siteId === 'site-alpha' ? mockZonesAlpha : [],
        total: siteId === 'site-alpha' ? mockZonesAlpha.length : 0,
      }),
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue(mockCamerasPage);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue(mockRegionsPage);
  });

  afterEach(async () => {
    cleanup();
    queryClient.clear();
    window.localStorage.clear();
    await i18n.changeLanguage('en');
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function renderWithProviders(session: SharedSession | null) {
    return render(
      <QueryClientProvider client={queryClient}>
        <LocaleProvider defaultLocale="en">
          <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={session} />
        </LocaleProvider>
      </QueryClientProvider>,
    );
  }

  it('allows scoped SITE_MANAGER to manage own-Site Zones and Camera/Region setup', async () => {
    const user = userEvent.setup();
    const listCamerasSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras');
    const listRegionsSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions');
    const createZoneSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createZone')
      .mockResolvedValue({
        id: 'zone-created-2',
        siteId: 'site-alpha',
        code: 'ZONE-A2',
        name: 'Excavation Trench',
        type: 'HAZARDOUS',
        restrictionPolicy: 'NONE',
        requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
        configurationLocked: false,
        createdAt: '2026-10-15T00:00:00Z',
      });
    const renameZoneSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'renameZone')
      .mockResolvedValue({ ...mockZonesAlpha[0]!, name: 'Updated Scaffold Area' });

    const siteManagerAccount = makeAccount('user-sm-alpha', [
      { role: 'SITE_MANAGER', siteId: 'site-alpha' },
    ]);

    renderWithProviders(makeSession('token-sm-alpha', 'scope-sm-alpha', siteManagerAccount));
    await screen.findByRole('option', { name: /Alpha Construction Site/i });

    expect(screen.getByRole('button', { name: /Register camera/i })).toBeDefined();
    expect(await screen.findByRole('button', { name: /Manage camera/i })).toBeDefined();

    await user.click(await screen.findByRole('button', { name: /Configure PPE by Zone/i }));
    expect(await screen.findByRole('dialog', { name: /Zone PPE configuration/i })).toBeDefined();
    expect(await screen.findByText('ZONE-A1')).toBeDefined();

    expect(
      await screen.findByRole('heading', { name: /Link Zone to Camera Region/i }),
    ).toBeDefined();
    await waitFor(() => expect(listCamerasSpy).toHaveBeenCalled());
    await waitFor(() => expect(listRegionsSpy).toHaveBeenCalled());

    // Scoped SITE_MANAGER can create a new Zone on site-alpha
    await user.type(screen.getByLabelText(/Zone Code/i), 'ZONE-A2');
    await user.type(screen.getByLabelText(/Zone Name/i), 'Excavation Trench');
    await user.click(screen.getByRole('button', { name: /Save Zone PPE/i }));

    await waitFor(() => expect(createZoneSpy).toHaveBeenCalledTimes(1));
    expect(createZoneSpy).toHaveBeenCalledWith('token-sm-alpha', 'site-alpha', {
      code: 'ZONE-A2',
      name: 'Excavation Trench',
      type: 'HAZARDOUS',
      restrictionPolicy: 'NONE',
      requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
    });

    // Scoped SITE_MANAGER can rename an existing Zone on site-alpha
    await user.click(screen.getByRole('button', { name: /Rename ZONE-A1/i }));
    const renameInput = screen.getByLabelText(/New Zone Name/i);
    await user.clear(renameInput);
    await user.type(renameInput, 'Updated Scaffold Area');
    await user.click(screen.getByRole('button', { name: /Save Name/i }));

    await waitFor(() => expect(renameZoneSpy).toHaveBeenCalledTimes(1));
    expect(renameZoneSpy).toHaveBeenCalledWith(
      'token-sm-alpha',
      'site-alpha',
      'zone-1',
      'Updated Scaffold Area',
    );
    expect(listCamerasSpy).toHaveBeenCalled();
    expect(listRegionsSpy).toHaveBeenCalled();
  });

  it('allows global ADMIN to read the Zone catalog without exposing Zone or Camera/Region writers', async () => {
    const user = userEvent.setup();
    const listZonesSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listZones');
    const listCamerasSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras');
    const listRegionsSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions');
    const createZoneSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createZone');
    const renameZoneSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'renameZone');

    const globalAdminAccount = makeAccount('user-global-admin', [{ role: 'ADMIN', siteId: null }]);

    renderWithProviders(
      makeSession('token-global-admin', 'scope-global-admin', globalAdminAccount),
    );
    await screen.findByRole('option', { name: /Alpha Construction Site/i });

    await user.click(await screen.findByRole('button', { name: /Configure PPE by Zone/i }));
    expect(await screen.findByRole('dialog', { name: /Zone PPE configuration/i })).toBeDefined();
    expect(await screen.findByText('ZONE-A1')).toBeDefined();
    expect(screen.getByText('Hazardous Scaffold Area')).toBeDefined();
    expect(listZonesSpy).toHaveBeenCalled();

    expect(screen.queryByRole('heading', { name: /Link Zone to Camera Region/i })).toBeNull();
    expect(listCamerasSpy).not.toHaveBeenCalled();
    expect(listRegionsSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Register camera|Manage camera/i })).toBeNull();

    // Zone create and rename controls must NOT be exposed to Global ADMIN
    expect(screen.queryByLabelText(/Zone Code/i)).toBeNull();
    expect(screen.queryByLabelText(/Zone Name/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Save Zone PPE/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Rename ZONE-A1/i })).toBeNull();
    expect(createZoneSpy).not.toHaveBeenCalled();
    expect(renameZoneSpy).not.toHaveBeenCalled();
  });

  it('fails closed for SAFETY_OFFICER, wrong-Site SITE_MANAGER, and accounts with mustChangePassword=true', async () => {
    const listZonesSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listZones');
    const deniedAccounts: AccountResponse[] = [
      makeAccount('user-safety-officer', [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }]),
      makeAccount('user-sm-wrong-site', [{ role: 'SITE_MANAGER', siteId: 'site-beta' }]),
      makeAccount('user-admin-must-change-pw', [{ role: 'ADMIN', siteId: null }], true),
      makeAccount('user-sm-must-change-pw', [{ role: 'SITE_MANAGER', siteId: 'site-alpha' }], true),
    ];

    for (const account of deniedAccounts) {
      vi.spyOn(SmartSiteManagementClient.prototype, 'me').mockResolvedValue(account);
      const { unmount } = renderWithProviders(
        makeSession(`token-${account.id}`, `scope-${account.id}`, account),
      );
      await screen.findByRole('option', { name: /Alpha Construction Site/i });

      expect(screen.queryByRole('button', { name: /Configure PPE by Zone/i })).toBeNull();
      expect(screen.queryByRole('dialog', { name: /Zone PPE configuration/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Register camera/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Manage camera/i })).toBeNull();
      expect(listZonesSpy).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('revokes an open Zone dialog on a parent camera metadata401 even if the controlled session has not cleared yet', async () => {
    const user = userEvent.setup();
    const session = makeSession(
      'token-admin-still-controlled',
      'scope-admin-held',
      makeAccount('admin', [{ role: 'ADMIN', siteId: null }]),
    );
    session.onSignOut = vi.fn();
    renderWithProviders(session);
    await screen.findByRole('option', { name: /Alpha Gate Camera/i });
    await user.click(await screen.findByRole('button', { name: /Configure PPE by Zone/i }));
    expect(await screen.findByRole('dialog', { name: /Zone PPE configuration/i })).toBeDefined();
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockRejectedValue(
      new ApiError('http', 'Unauthorized', 401),
    );
    await act(async () => {
      await queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'ppe-monitoring' &&
          query.queryKey.includes('cameras') &&
          query.queryKey.includes('pages'),
      });
    });
    await waitFor(() => expect(session.onSignOut).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: /Zone PPE configuration/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Configure PPE by Zone/i })).toBeNull();
  });

  it('supports dual-role (global ADMIN + own-Site SITE_MANAGER) on site-alpha, and closes/revokes Zone write controls on Site switch or role loss without late mutations', async () => {
    const user = userEvent.setup();
    let resolveLateCreate!: (value: ZoneResponse) => void;
    const createZoneSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createZone')
      .mockImplementation(
        () =>
          new Promise<ZoneResponse>((resolve) => {
            resolveLateCreate = resolve;
          }),
      );

    const dualRoleAccount = makeAccount('user-dual-role', [
      { role: 'ADMIN', siteId: null },
      { role: 'SITE_MANAGER', siteId: 'site-alpha' },
    ]);

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <LocaleProvider defaultLocale="en">
          <PpeMonitoringView
            apiUrl="http://localhost:3000"
            sharedSession={makeSession('token-dual', 'scope-dual', dualRoleAccount)}
          />
        </LocaleProvider>
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Alpha Construction Site/i });
    await user.click(await screen.findByRole('button', { name: /Configure PPE by Zone/i }));

    expect(await screen.findByLabelText(/Zone Code/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Save Zone PPE/i })).toBeDefined();
    expect(await screen.findByRole('button', { name: /Rename ZONE-A1/i })).toBeDefined();
    expect(
      await screen.findByRole('heading', { name: /Link Zone to Camera Region/i }),
    ).toBeDefined();

    await user.type(screen.getByLabelText(/Zone Code/i), 'ZONE-LATE');
    await user.type(screen.getByLabelText(/Zone Name/i), 'Late Alpha Zone');
    await user.click(screen.getByRole('button', { name: /Save Zone PPE/i }));
    expect(createZoneSpy).toHaveBeenCalledTimes(1);

    // Programmatic scope change while the modal correctly keeps background controls inert.
    fireEvent.change(screen.getByLabelText('Site', { selector: 'select' }), {
      target: { value: 'site-beta' },
    });
    expect(screen.queryByRole('dialog', { name: /Zone PPE configuration/i })).toBeNull();
    await act(async () =>
      resolveLateCreate({
        id: 'zone-late',
        siteId: 'site-alpha',
        code: 'ZONE-LATE',
        name: 'Late Alpha Zone',
        type: 'HAZARDOUS',
        restrictionPolicy: 'NONE',
        requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
        configurationLocked: false,
        createdAt: '2026-10-15T00:00:00Z',
      }),
    );
    expect(screen.queryByText(/ZONE-LATE/i)).toBeNull();

    // On site-beta, user is ADMIN only (not SITE_MANAGER for site-beta): read-only Zone catalog only
    await user.click(screen.getByRole('button', { name: /Configure PPE by Zone/i }));
    expect(await screen.findByRole('dialog', { name: /Zone PPE configuration/i })).toBeDefined();
    expect(screen.queryByLabelText(/Zone Code/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Save Zone PPE/i })).toBeNull();

    // Downgrading role to SAFETY_OFFICER while dialog is open immediately unmounts dialog and hides trigger
    const officerAccount = makeAccount('user-dual-role', [
      { role: 'SAFETY_OFFICER', siteId: 'site-beta' },
    ]);
    rerender(
      <QueryClientProvider client={queryClient}>
        <LocaleProvider defaultLocale="en">
          <PpeMonitoringView
            apiUrl="http://localhost:3000"
            sharedSession={makeSession('token-dual', 'scope-dual', officerAccount)}
          />
        </LocaleProvider>
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('dialog', { name: /Zone PPE configuration/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Configure PPE by Zone/i })).toBeNull();
  });
});
