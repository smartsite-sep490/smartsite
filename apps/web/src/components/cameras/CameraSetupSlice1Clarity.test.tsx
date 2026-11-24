// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SourceSetupError,
  type CameraSourceClient,
  type SavedPpePolicy,
  type SmartSiteManagementClient,
} from '@smartsite/api-client';
import type { CameraApplicationStatus } from '@smartsite/contracts/camera-application-status';
import type {
  CameraResponse,
  Page,
  RegionResponse,
  SiteResponse,
  ZoneResponse,
} from '@smartsite/contracts/management';
import { PPE_ITEMS } from '@smartsite/contracts/ppe-items';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import type { SharedSession } from '../../types/shared-session';
import { CANONICAL_PPE_ITEMS } from '../ppe/zone-ppe-setup-types';
import { CameraPpePolicyPanel, type CameraPpeContext } from './CameraPpePolicyPanel';
import { CameraSetupView } from './CameraSetupView';
import { CameraSourceSetupPanel } from './CameraSourceSetupPanel';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const mockUseManagementClient = vi.fn();
vi.mock('../../features/auth/auth-session', () => ({
  useManagementClient: (apiUrl: string) => mockUseManagementClient(apiUrl),
}));

const API_URL = 'https://api.smartsite.local';
const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAM_ACTIVE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const CAM_INACTIVE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const ZONE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REGION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

const CAM_ACTIVE: CameraResponse = {
  type: 'ZONE',
  gateId: null,
  id: CAM_ACTIVE_ID,
  siteId: SITE_ID,
  code: 'CAM-01',
  name: 'North Gate Camera',
  externalId: 'edge-north-01',
  status: 'ACTIVE',
  configurationVersion: 4,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const CAM_INACTIVE: CameraResponse = {
  type: 'ZONE',
  gateId: null,
  id: CAM_INACTIVE_ID,
  siteId: SITE_ID,
  code: 'CAM-02',
  name: 'South Yard Camera',
  externalId: 'edge-south-02',
  status: 'INACTIVE',
  configurationVersion: 1,
  createdAt: '2026-11-02T00:00:00.000Z',
};

function makeManagerSession(): SharedSession {
  return {
    accessToken: 'tok-slice1-mgr',
    sessionScope: 'scope-slice1-mgr',
    onSignOut: vi.fn(),
    user: {
      id: 'mgr-slice1',
      displayName: 'Site Manager',
      mustChangePassword: false,
      roleAssignments: [{ role: 'SITE_MANAGER', siteId: SITE_ID }],
    },
  };
}

describe('Camera setup Slice 1: AI-host prerequisites, historical PPE truthfulness, and mobile/step clarity', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
    vi.restoreAllMocks();
  });

  it('reuses canonical PPE_ITEMS from @smartsite/contracts without a handwritten duplicate enum', () => {
    expect(CANONICAL_PPE_ITEMS).toBe(PPE_ITEMS);
  });

  it('surfaces AI-host fetch errors with Retry, no-host prerequisites, all-offline hosts, test-only capability limits, and empty webcam/video lists upfront without generic conflation', async () => {
    const user = userEvent.setup();
    const hostsFn = vi
      .fn<CameraSourceClient['hosts']>()
      .mockRejectedValueOnce(new SourceSetupError(503))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'edge-off',
          label: 'Site A Edge Box',
          available: false,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'edge-online',
          label: 'Site A Edge Box',
          available: true,
          capabilities: {
            sourceKinds: ['WEBCAM', 'RTSP', 'VIDEO'],
            webcams: [],
            videos: [],
            browserCameraSupported: false,
            applySupported: false,
          },
        },
      ]);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CameraSourceSetupPanel
          apiUrl={API_URL}
          token="tok"
          siteId={SITE_ID}
          camera={CAM_ACTIVE}
          setupKey={['slice1-hosts']}
          canWrite
          onUnauthorized={vi.fn()}
          client={{ hosts: hostsFn, probe: vi.fn() }}
        />
      </QueryClientProvider>,
    );

    // 1) Host capability fetch failure -> distinct alert prerequisite banner with Retry button BEFORE source radio cards
    const errorPrereq = await screen.findByTestId('camera-source-host-prerequisite');
    expect(errorPrereq.getAttribute('role')).toBe('alert');
    expect(errorPrereq.textContent).toMatch(/Could not check AI hosts/i);
    const firstRadio = screen.getByRole('radio', { name: /USB \/ host webcam/i });
    expect(
      Boolean(errorPrereq.compareDocumentPosition(firstRadio) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);

    // Clicking Retry refetches -> 2) Empty hosts list -> distinct no-host prerequisite banner
    await user.click(within(errorPrereq).getByRole('button', { name: /Retry|Thử lại/i }));
    await waitFor(() => {
      const noHostBanner = screen.getByTestId('camera-source-host-prerequisite');
      expect(noHostBanner.getAttribute('role')).toBe('status');
      expect(noHostBanner.textContent).toMatch(/No AI host connected/i);
    });

    // Refresh -> 3) All assigned hosts offline -> distinct offline-hosts prerequisite naming the host
    await user.click(screen.getByRole('button', { name: /Refresh hosts/i }));
    await waitFor(() => {
      const offlineBanner = screen.getByTestId('camera-source-host-prerequisite');
      expect(offlineBanner.textContent).toMatch(/Site A Edge Box/);
      expect(offlineBanner.textContent).toMatch(/offline/i);
    });

    // Refresh -> 4) Online test-only host with 0 webcams and 0 videos -> upfront test-only note + explicit empty device/video hints
    await user.click(screen.getByRole('button', { name: /Refresh hosts/i }));
    const testOnlyNote = await screen.findByTestId('camera-source-test-only-note');
    expect(testOnlyNote.textContent).toMatch(/test-only|cannot activate live AI/i);

    const emptyWebcams = await screen.findByTestId('camera-source-empty-devices');
    expect(emptyWebcams.textContent).toMatch(/No USB webcams found/i);
    const testBtn = screen.getByRole('button', { name: /Test connection/i }) as HTMLButtonElement;
    expect(testBtn.disabled).toBe(true);

    await user.click(screen.getByRole('radio', { name: /Recorded video/i }));
    const emptyVideos = await screen.findByTestId('camera-source-empty-videos');
    expect(emptyVideos.textContent).toMatch(/No approved videos found/i);
  });

  it('supports post-setup per-region PPE policy editing alongside camera defaults using strictly canonical contract PPE_ITEMS (EN/VI)', async () => {
    const user = userEvent.setup();
    let savedRegionPolicy: SavedPpePolicy['policy'] = { mode: 'INHERIT' };
    const updateRegionPpePolicy = vi
      .fn()
      .mockImplementation(async (_tok, _site, _cam, _reg, command) => {
        savedRegionPolicy = command.policy;
        return {
          cameraId: CAM_ACTIVE_ID,
          regionId: REGION_ID,
          commandId: 'cmd-1',
          configurationVersion: 5,
          viewRevision: 1,
          bundleSha256: 'a'.repeat(64),
          replayed: false,
        };
      });

    const region: RegionResponse = {
      id: REGION_ID,
      cameraId: CAM_ACTIVE_ID,
      zoneId: ZONE_ID,
      polygon: {
        coordinates: [
          [0.1, 0.1],
          [0.5, 0.1],
          [0.5, 0.5],
        ],
      },
      coordinateSpace: 'NORMALIZED_0_1',
      version: 2,
      isActive: true,
      createdAt: '2026-11-01T00:00:00.000Z',
    };

    const context: CameraPpeContext = {
      setupKey: ['slice1-ppe-contract'],
      token: 'tok',
      siteId: SITE_ID,
      onUnauthorized: vi.fn(),
      client: {
        readSavedPpePolicy: vi.fn(
          async (_tok, _site, _cam, regionId = null): Promise<SavedPpePolicy> =>
            regionId === null
              ? {
                  cameraId: CAM_ACTIVE_ID,
                  regionId: null,
                  configurationVersion: 4,
                  savedRevision: 4,
                  policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT', 'SAFETY_VEST'] },
                }
              : {
                  cameraId: CAM_ACTIVE_ID,
                  regionId: REGION_ID,
                  configurationVersion: 4,
                  savedRevision: 4,
                  policy: savedRegionPolicy,
                },
        ),
        listRegions: vi.fn().mockResolvedValue({ items: [region], total: 1 }),
        listZones: vi.fn().mockResolvedValue({
          items: [
            {
              id: ZONE_ID,
              siteId: SITE_ID,
              code: 'Z-SCAFFOLD',
              name: 'Scaffold Deck',
              type: 'HAZARDOUS',
              restrictionPolicy: 'NONE',
              requiredPpe: ['HARD_HAT'],
              configurationLocked: true,
              createdAt: '2026-11-01T00:00:00.000Z',
            } satisfies ZoneResponse,
          ],
          total: 1,
        }),
        initializePpePolicy: vi.fn(),
        updateCameraPpePolicy: vi.fn(),
        updateRegionPpePolicy,
        activateRegionWithPpePolicy: vi.fn(),
      },
    };

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CameraPpePolicyPanel
          cameraId={CAM_ACTIVE_ID}
          camera={CAM_ACTIVE}
          context={context}
          canWrite
          expandSignal={1}
        />
      </QueryClientProvider>,
    );

    // Exactly the 5 canonical contract PPE_ITEMS checkboxes render (no invented selectable items)
    const initialCheckboxes = await screen.findAllByRole('checkbox');
    expect(initialCheckboxes).toHaveLength(PPE_ITEMS.length);

    // Capability notes & 3 non-selectable PPE families are collapsed by default (<details>),
    // keeping all 8 families discoverable on expand without extra checkboxes or technical jargon
    const capabilityDetails = screen.getByTestId(
      'camera-ppe-capability-note',
    ) as HTMLDetailsElement;
    expect(capabilityDetails.tagName).toBe('DETAILS');
    expect(capabilityDetails.open).toBe(false);

    const unsupportedDetails = screen.getByTestId(
      'ppe-catalog-not-selectable',
    ) as HTMLDetailsElement;
    expect(unsupportedDetails.tagName).toBe('DETAILS');
    expect(unsupportedDetails.open).toBe(false);
    expect(unsupportedDetails.textContent).toMatch(/Unsupported PPE types \(3 of 8\)/i);
    expect(unsupportedDetails.textContent).toMatch(/Mask.*Full-body harness.*Lanyard hook/i);
    expect(within(unsupportedDetails).queryAllByRole('checkbox')).toHaveLength(0);
    expect(unsupportedDetails.textContent).not.toMatch(/contract/i);

    // Edit post-setup Region policy -> switch to EXPLICIT -> select HARD_HAT + GLOVES -> save submits ONLY valid contract PPE_ITEMS
    const scopeSelect = screen.getByLabelText('Policy scope');
    await user.selectOptions(scopeSelect, REGION_ID);
    await user.selectOptions(screen.getByLabelText('Policy mode'), 'EXPLICIT');

    await user.click(screen.getByRole('checkbox', { name: 'Hard hat' }));
    await user.click(screen.getByRole('checkbox', { name: 'Gloves' }));
    await user.click(screen.getByRole('button', { name: 'Save PPE policy' }));

    await waitFor(() => expect(updateRegionPpePolicy).toHaveBeenCalledTimes(1));
    expect(updateRegionPpePolicy.mock.calls[0]?.[4]).toMatchObject({
      expectedConfigurationVersion: 4,
      policy: { mode: 'EXPLICIT', requiredPpe: ['GLOVES', 'HARD_HAT'] },
    });

    // Vietnamese parity on policy scope, readiness guidance, and collapsed unsupported families (no jargon)
    await i18n.changeLanguage('vi');
    await waitFor(() => {
      expect(screen.getByTestId('ppe-readiness-guidance').textContent).toMatch(/Mũ, áo: cơ bản/);
      const viUnsupported = screen.getByTestId('ppe-catalog-not-selectable');
      expect(viUnsupported.textContent).toMatch(/Thiết bị chưa hỗ trợ \(3 \/ 8\)/);
      expect(viUnsupported.textContent).toMatch(
        /Khẩu trang.*Dây đai an toàn toàn thân.*Móc dây an toàn/,
      );
      expect(viUnsupported.textContent).not.toMatch(/hợp đồng|cứu sinh|ranh giới/i);
    });
  });

  it('gives Site Managers mobile monitoring navigation preserving selected site/camera, status labels in quick camera selector, and numbered workspace step cues', async () => {
    const nowIso = new Date().toISOString();
    mockUseManagementClient.mockReturnValue({
      listSites: vi.fn<SmartSiteManagementClient['listSites']>().mockResolvedValue({
        items: [
          {
            id: SITE_ID,
            code: 'SITE-01',
            name: 'Alpha Construction Site',
            createdAt: '2026-11-01T00:00:00.000Z',
          },
        ],
        total: 1,
      } satisfies Page<SiteResponse>),
      listCameras: vi.fn<SmartSiteManagementClient['listCameras']>().mockResolvedValue({
        items: [CAM_ACTIVE, CAM_INACTIVE],
        total: 2,
      } satisfies Page<CameraResponse>),
      getCamera: vi.fn<SmartSiteManagementClient['getCamera']>().mockResolvedValue(CAM_ACTIVE),
      getCameraApplicationStatus: vi
        .fn<SmartSiteManagementClient['getCameraApplicationStatus']>()
        .mockResolvedValue({
          siteId: SITE_ID,
          cameraId: CAM_ACTIVE_ID,
          desiredRevision: 4,
          reportedRevision: 4,
          applicationState: 'LOADED',
          viewValidity: 'UNCONFIRMED',
          reasonCode: null,
          lastReceiptAt: nowIso,
          observedAt: nowIso,
        } satisfies CameraApplicationStatus),
      listZones: vi.fn<SmartSiteManagementClient['listZones']>().mockResolvedValue({
        items: [],
        total: 0,
      } satisfies Page<ZoneResponse>),
      listRegions: vi.fn<SmartSiteManagementClient['listRegions']>().mockResolvedValue({
        items: [],
        total: 0,
      } satisfies Page<RegionResponse>),
      readSavedPpePolicy: vi.fn().mockResolvedValue({
        cameraId: CAM_ACTIVE_ID,
        regionId: null,
        configurationVersion: 4,
        savedRevision: 4,
        policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
      }),
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/camera-setup?siteId=${SITE_ID}`]}>
          <CameraSetupView apiUrl={API_URL} sharedSession={makeManagerSession()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Quick camera selector shows Enabled / Disabled status alongside camera name & code
    const quickSelect = (await screen.findByTestId(
      'camera-setup-quick-select',
    )) as HTMLSelectElement;
    const options = Array.from(quickSelect.options).map((o) => o.textContent ?? '');
    expect(options[0]).toMatch(/North Gate Camera.*CAM-01.*Enabled/);
    expect(options[1]).toMatch(/South Yard Camera.*CAM-02.*Disabled/);

    // Mobile monitoring nav exists for Site Manager on active camera and preserves exact siteId & cameraId
    const mobileMonitorNav = screen.getByTestId('selected-camera-mobile-monitor-nav');
    expect(mobileMonitorNav.className.split(/\s+/)).toContain('sm:hidden');
    expect(
      within(mobileMonitorNav)
        .getByRole('link', { name: /PPE monitoring/i })
        .getAttribute('href'),
    ).toBe(`/ppe?siteId=${SITE_ID}&cameraId=${CAM_ACTIVE_ID}`);
    expect(
      within(mobileMonitorNav)
        .getByRole('link', { name: /Zone monitoring/i })
        .getAttribute('href'),
    ).toBe(`/zones?siteId=${SITE_ID}&cameraId=${CAM_ACTIVE_ID}`);

    // Workspace task tabs show sequential step numbers inside visual badges
    const tabsGroup = screen.getByTestId('camera-setup-task-tabs');
    const stepBadges = tabsGroup.querySelectorAll('[data-testid^="camera-workspace-step-"]');
    expect(stepBadges.length).toBeGreaterThanOrEqual(2);
  });

  it('unblocks P0-3 fresh-site INACTIVE cameras: shows AI-host prerequisites and allows connection probe prep with explicit Disabled badge while blocking live apply/resume', async () => {
    const user = userEvent.setup();
    const apply = vi.fn();
    const resume = vi.fn();
    const probe = vi.fn<CameraSourceClient['probe']>().mockResolvedValue({
      state: 'TESTED',
      receiptId: 'inactive-preview-receipt',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sourceKind: 'LIVE',
      frame: {
        width: 640,
        height: 360,
        capturedAt: new Date().toISOString(),
        imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      },
    });
    const hostsFn = vi
      .fn<CameraSourceClient['hosts']>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'edge-1',
          label: 'Site Edge Host',
          available: true,
          capabilities: {
            sourceKinds: ['WEBCAM', 'RTSP'],
            webcams: [{ id: 'usb0', label: 'USB Cam 0' }],
            videos: [],
            browserCameraSupported: false,
            applySupported: true,
            configurationResumeSupported: true,
            sourceRevision: 1,
          },
        },
      ]);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CameraSourceSetupPanel
          apiUrl={API_URL}
          token="tok"
          siteId={SITE_ID}
          camera={CAM_INACTIVE}
          setupKey={['slice1-inactive-prep']}
          canWrite
          onUnauthorized={vi.fn()}
          client={{ hosts: hostsFn, probe, apply, resume }}
        />
      </QueryClientProvider>,
    );

    // Explicit Disabled badge & preparation notice, plus upfront missing AI-host prerequisite before enabling
    expect(await screen.findByTestId('camera-source-inactive-badge')).toBeTruthy();
    expect(screen.getByTestId('camera-source-inactive-notice').textContent).toMatch(
      /Camera is disabled/i,
    );
    expect((await screen.findByTestId('camera-source-host-prerequisite')).textContent).toMatch(
      /No AI host connected/i,
    );

    // Refresh to online host -> probe works for connection prep, but live Save & activate / Apply saved config stay blocked
    await user.click(screen.getByRole('button', { name: /Refresh hosts/i }));
    await user.selectOptions(await screen.findByLabelText(/Device/i), 'usb0');
    expect(screen.queryByTestId('camera-source-resume-card')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Test connection/i }));
    await screen.findByRole('img');
    expect(screen.getByTestId('camera-source-inactive-enable-required').textContent).toMatch(
      /Enable the camera in settings first/i,
    );
    expect(screen.queryByRole('button', { name: /Save and activate/i })).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it('mounts source preparation and saved PPE inspection below disabled stage on CameraSetupView when all site cameras are INACTIVE (P0-3)', async () => {
    vi.stubEnv('VITE_SMARTSITE_ENABLE_SOURCE_SETUP', 'true');
    try {
      const nowIso = new Date().toISOString();
      mockUseManagementClient.mockReturnValue({
        listSites: vi.fn<SmartSiteManagementClient['listSites']>().mockResolvedValue({
          items: [
            {
              id: SITE_ID,
              code: 'TEST-SITE',
              name: 'Test Site',
              createdAt: '2026-11-23T00:00:00.000Z',
            },
          ],
          total: 1,
        } satisfies Page<SiteResponse>),
        listCameras: vi.fn<SmartSiteManagementClient['listCameras']>().mockResolvedValue({
          items: [CAM_INACTIVE],
          total: 1,
        } satisfies Page<CameraResponse>),
        getCamera: vi.fn<SmartSiteManagementClient['getCamera']>().mockResolvedValue(CAM_INACTIVE),
        getCameraApplicationStatus: vi
          .fn<SmartSiteManagementClient['getCameraApplicationStatus']>()
          .mockResolvedValue({
            siteId: SITE_ID,
            cameraId: CAM_INACTIVE_ID,
            desiredRevision: 1,
            reportedRevision: null,
            applicationState: 'STALE',
            viewValidity: 'UNAVAILABLE',
            reasonCode: 'CAMERA_INACTIVE',
            lastReceiptAt: null,
            observedAt: nowIso,
          } satisfies CameraApplicationStatus),
        listZones: vi.fn<SmartSiteManagementClient['listZones']>().mockResolvedValue({
          items: [],
          total: 0,
        } satisfies Page<ZoneResponse>),
        listRegions: vi.fn<SmartSiteManagementClient['listRegions']>().mockResolvedValue({
          items: [],
          total: 0,
        } satisfies Page<RegionResponse>),
        readSavedPpePolicy: vi.fn().mockResolvedValue({
          cameraId: CAM_INACTIVE_ID,
          regionId: null,
          configurationVersion: 1,
          savedRevision: null,
          policy: null,
        }),
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ hosts: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[`/camera-setup?siteId=${SITE_ID}`]}>
            <CameraSetupView apiUrl={API_URL} sharedSession={makeManagerSession()} />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      // Disabled stage + explicit Enable button remain visible, AND source prerequisite panel + PPE panel are accessible without enabling first
      expect(await screen.findByTestId('camera-setup-disabled-stage')).toBeTruthy();
      expect(screen.getByTestId('camera-source-setup-panel')).toBeTruthy();
      expect(await screen.findByTestId('camera-source-inactive-badge')).toBeTruthy();
      expect(await screen.findByTestId('camera-source-host-prerequisite')).toBeTruthy();
      expect(screen.getByTestId('camera-ppe-policy-panel')).toBeTruthy();
      expect(screen.queryByTestId('camera-sticky-apply-bar')).toBeNull();
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
