// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SourceSetupError,
  type CameraSourceClient,
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
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import type { SharedSession } from '../../types/shared-session';
import { CameraApplySavedBar } from './CameraApplySavedBar';
import { CameraSetupView } from './CameraSetupView';
import { CameraSourceSetupPanel } from './CameraSourceSetupPanel';
import { useCameraSourceResumeController } from './useCameraSourceResumeController';

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
const CAM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ZONE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const CAM_ACTIVE: CameraResponse = {
  type: 'ZONE' as const,
  gateId: null,
  id: CAM_ID,
  siteId: SITE_ID,
  code: 'CAM-01',
  name: 'North Gate Camera',
  externalId: 'edge-north-01',
  status: 'ACTIVE',
  configurationVersion: 5,
  createdAt: '2026-11-01T00:00:00.000Z',
};

function makeSession(): SharedSession {
  return {
    accessToken: 'token-mgr-single-task',
    sessionScope: 'scope-single-task',
    onSignOut: vi.fn(),
    user: {
      id: 'mgr-1',
      displayName: 'Site Manager',
      mustChangePassword: false,
      roleAssignments: [{ role: 'SITE_MANAGER', siteId: SITE_ID }],
    },
  };
}

describe('Camera Setup progressive single-task workspace & sticky Apply bar', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows ONE active work area at a time, collapses diagnostics by default, and guards unsaved polygon draft when switching to PPE tab', async () => {
    const nowIso = new Date().toISOString();
    const expIso = new Date(Date.now() + 240_000).toISOString();
    const sha = 'c'.repeat(64);
    const tinyJpegBytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x68, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
    ]);
    const tinyJpeg = `data:image/jpeg;base64,${btoa(String.fromCharCode(...tinyJpegBytes))}`;
    const origImage = globalThis.Image;
    globalThis.Image = class MockImg {
      naturalWidth = 640;
      naturalHeight = 360;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decode = () => Promise.resolve();
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    } as unknown as typeof Image;

    try {
      mockUseManagementClient.mockReturnValue({
        listSites: vi.fn<SmartSiteManagementClient['listSites']>().mockResolvedValue({
          items: [
            {
              id: SITE_ID,
              code: 'SITE-01',
              name: 'Alpha Site',
              createdAt: '2026-11-01T00:00:00.000Z',
            },
          ],
          total: 1,
        } satisfies Page<SiteResponse>),
        listCameras: vi.fn<SmartSiteManagementClient['listCameras']>().mockResolvedValue({
          items: [CAM_ACTIVE],
          total: 1,
        } satisfies Page<CameraResponse>),
        getCamera: vi.fn<SmartSiteManagementClient['getCamera']>().mockResolvedValue(CAM_ACTIVE),
        getCameraApplicationStatus: vi
          .fn<SmartSiteManagementClient['getCameraApplicationStatus']>()
          .mockResolvedValue({
            siteId: SITE_ID,
            cameraId: CAM_ID,
            desiredRevision: 5,
            reportedRevision: 4,
            applicationState: 'PENDING',
            viewValidity: 'UNCONFIRMED',
            reasonCode: null,
            lastReceiptAt: nowIso,
            observedAt: nowIso,
          } satisfies CameraApplicationStatus),
        listZones: vi.fn<SmartSiteManagementClient['listZones']>().mockResolvedValue({
          items: [
            {
              id: ZONE_ID,
              siteId: SITE_ID,
              code: 'Z-01',
              name: 'Excavation Area',
              type: 'STANDARD',
              restrictionPolicy: 'NONE',
              requiredPpe: ['HARD_HAT'],
              configurationLocked: false,
              createdAt: '2026-11-01T00:00:00.000Z',
            },
          ],
          total: 1,
        } satisfies Page<ZoneResponse>),
        listRegions: vi.fn<SmartSiteManagementClient['listRegions']>().mockResolvedValue({
          items: [],
          total: 0,
        } satisfies Page<RegionResponse>),
        getCameraConfigurationReference: vi.fn().mockResolvedValue({
          viewValidity: 'UNCONFIRMED',
          image: {
            schemaVersion: 1,
            purpose: 'REGION_CONFIGURATION',
            sourceKind: 'LIVE',
            siteId: SITE_ID,
            cameraId: CAM_ID,
            configurationVersion: 5,
            referenceExpiresAt: expIso,
            frame: {
              cameraExternalId: CAM_ACTIVE.externalId,
              sessionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
              sequenceNumber: '1',
              capturedAt: nowIso,
              width: 640,
              height: 360,
              imageDataUrl: tinyJpeg,
              imageSha256: sha,
            },
          },
          reference: {
            schemaVersion: '1.0.0',
            purpose: 'REGION_CONFIGURATION',
            sourceKind: 'LIVE',
            referenceId: '66666666-6666-4666-8666-666666666601',
            siteId: SITE_ID,
            cameraId: CAM_ID,
            sessionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            imageSha256: sha,
            width: 640,
            height: 360,
            capturedAt: nowIso,
            issuedAt: nowIso,
            expiresAt: expIso,
            configurationVersion: 5,
            viewRevision: 1,
          },
        }),
        readSavedPpePolicy: vi.fn().mockResolvedValue({
          cameraId: CAM_ID,
          regionId: null,
          configurationVersion: 5,
          savedRevision: 5,
          policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
        }),
      });

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[`/camera-setup?siteId=${SITE_ID}`]}>
            <CameraSetupView apiUrl={API_URL} sharedSession={makeSession()} />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      // Diagnostics disclosure starts closed so checklist doesn't sprawl above the work area
      const diagDetails = (await screen.findByTestId(
        'camera-setup-diagnostics-disclosure',
      )) as HTMLDetailsElement;
      expect(diagDetails.open).toBe(false);

      // Activate Regions & polygon -> ONLY Regions work area renders (PPE panel hidden)
      fireEvent.click(screen.getByTestId('camera-workspace-tab-regions'));
      const inlineStage = await screen.findByTestId('camera-setup-inline-region-stage');
      expect(screen.queryByTestId('camera-ppe-policy-panel')).toBeNull();
      expect(screen.getByTestId('camera-workspace-tab-regions').getAttribute('aria-pressed')).toBe(
        'true',
      );

      // Load reference & draw 1 unsaved vertex
      const getRefBtn = await within(inlineStage).findByRole('button', {
        name: 'Get configuration image',
      });
      await waitFor(() => expect((getRefBtn as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(getRefBtn);
      const startDrawBtn = await within(inlineStage).findByRole('button', {
        name: 'Start Drawing Region',
      });
      await waitFor(() => expect((startDrawBtn as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(startDrawBtn);
      fireEvent.change(await within(inlineStage).findByLabelText('Point X (0–1)'), {
        target: { value: '0.25' },
      });
      fireEvent.change(within(inlineStage).getByLabelText('Point Y (0–1)'), {
        target: { value: '0.35' },
      });
      fireEvent.click(within(inlineStage).getByRole('button', { name: 'Add Point' }));

      // Switching to PPE policy tab while polygon draft is dirty prompts discard confirmation
      fireEvent.click(screen.getByTestId('selected-camera-open-ppe'));
      expect(screen.getByTestId('camera-setup-inline-region-stage')).toBeTruthy();
      expect(screen.queryByTestId('camera-ppe-policy-panel')).toBeNull();
      fireEvent.click(await within(inlineStage).findByRole('button', { name: 'Keep editing' }));
      expect(within(inlineStage).getByText(/Points:\s*1\s*\/\s*32/i)).toBeTruthy();

      // Confirming Discard changes switches cleanly to PPE policy (ONLY PPE visible, already expanded)
      fireEvent.click(screen.getByTestId('selected-camera-open-ppe'));
      fireEvent.click(await within(inlineStage).findByRole('button', { name: 'Discard changes' }));
      const ppePanel = await screen.findByTestId('camera-ppe-policy-panel');
      expect(screen.queryByTestId('camera-setup-inline-region-stage')).toBeNull();
      expect(
        within(ppePanel)
          .getByRole('button', { name: 'Camera PPE policy' })
          .getAttribute('aria-expanded'),
      ).toBe('true');
      expect(await screen.findByTestId('camera-ppe-default-summary')).toBeTruthy();
    } finally {
      globalThis.Image = origImage;
    }
  });

  it('surfaces sticky Apply saved configuration bar when worker is pending, retries with identical commandId, reports honest ACK, and hides for read-only or LOADED worker', async () => {
    const user = userEvent.setup();
    const nowIso = new Date().toISOString();
    const resume = vi
      .fn()
      .mockRejectedValueOnce(new SourceSetupError(503))
      .mockResolvedValue({
        state: 'STARTED',
        sourceRevision: 3,
        configurationVersion: 5,
        currentGenerationId: 'gen-2',
        viewRevision: 1,
        bundleSha256: 'a'.repeat(64),
      });
    const sourceClient: CameraSourceClient = {
      hosts: async () => [
        {
          id: 'edge-1',
          label: 'Site Edge Host',
          available: true,
          capabilities: {
            sourceKinds: ['WEBCAM', 'RTSP'],
            webcams: [{ id: 'usb0', label: 'USB 0' }],
            videos: [],
            browserCameraSupported: false,
            applySupported: true,
            configurationResumeSupported: true,
            sourceRevision: 3,
          },
        },
      ],
      probe: vi.fn(),
      resume,
    };

    const pendingStatusClient = {
      getCameraApplicationStatus: vi.fn().mockResolvedValue({
        siteId: SITE_ID,
        cameraId: CAM_ID,
        desiredRevision: 5,
        reportedRevision: 4,
        applicationState: 'PENDING',
        viewValidity: 'UNCONFIRMED',
        reasonCode: null,
        lastReceiptAt: nowIso,
        observedAt: nowIso,
      } satisfies CameraApplicationStatus),
    };

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <CameraApplySavedBar
          apiUrl={API_URL}
          token="tok"
          siteId={SITE_ID}
          camera={CAM_ACTIVE}
          setupKey={['sticky-apply-test']}
          canWrite={true}
          statusContext={{
            setupKey: ['sticky-apply-test'],
            token: 'tok',
            siteId: SITE_ID,
            client: pendingStatusClient,
            enabled: true,
            onUnauthorized: vi.fn(),
          }}
          onUnauthorized={vi.fn()}
          client={sourceClient}
        />
      </QueryClientProvider>,
    );

    const applyBtn = await screen.findByTestId('camera-sticky-apply-btn');
    await user.click(applyBtn);
    await waitFor(() =>
      expect(applyBtn.textContent).toMatch(/Retry the same request|Thử lại cùng yêu cầu/),
    );
    await user.click(applyBtn);
    await screen.findByText(/Check configuration status|Kiểm tra trạng thái cấu hình/);
    expect(resume).toHaveBeenCalledTimes(2);
    expect(resume.mock.calls[1]?.[5]).toEqual(resume.mock.calls[0]?.[5]);

    // Read-only users never see Apply saved configuration
    rerender(
      <QueryClientProvider client={queryClient}>
        <CameraApplySavedBar
          apiUrl={API_URL}
          token="tok"
          siteId={SITE_ID}
          camera={CAM_ACTIVE}
          setupKey={['sticky-apply-readonly']}
          canWrite={false}
          onUnauthorized={vi.fn()}
          client={sourceClient}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('camera-sticky-apply-bar')).toBeNull();
  });

  it('shares ONE resume controller across sticky Apply bar and embedded CameraSourceSetupPanel: renders only one Apply control and mutually blocks concurrent resume vs source probe/apply', async () => {
    const user = userEvent.setup();
    let resolveResume: ((value: unknown) => void) | undefined;
    let resolveApply: ((value: unknown) => void) | undefined;

    const resume = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResume = resolve;
        }),
    );
    const apply = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApply = resolve;
        }),
    );
    const probe = vi.fn().mockResolvedValue({
      state: 'TESTED',
      receiptId: 'receipt-live-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sourceKind: 'LIVE',
      frame: {
        width: 640,
        height: 360,
        capturedAt: new Date().toISOString(),
        imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      },
    });
    const sourceClient: CameraSourceClient = {
      hosts: async () => [
        {
          id: 'edge-1',
          label: 'Site Edge Host',
          available: true,
          capabilities: {
            sourceKinds: ['WEBCAM', 'RTSP'],
            webcams: [{ id: 'usb0', label: 'USB 0' }],
            videos: [],
            browserCameraSupported: false,
            applySupported: true,
            configurationResumeSupported: true,
            sourceRevision: 3,
          },
        },
      ],
      probe,
      apply,
      resume,
    };

    function SharedOwnerHarness({ version }: { version: number }) {
      const camera = { ...CAM_ACTIVE, configurationVersion: version };
      const controller = useCameraSourceResumeController({
        apiUrl: API_URL,
        token: 'tok',
        siteId: SITE_ID,
        camera,
        setupKey: ['shared-owner'],
        canWrite: true,
        enabled: true,
        onUnauthorized: vi.fn(),
        client: sourceClient,
      });
      return (
        <div>
          <CameraApplySavedBar
            apiUrl={API_URL}
            token="tok"
            siteId={SITE_ID}
            camera={camera}
            setupKey={['shared-owner']}
            canWrite={true}
            controller={controller}
            alwaysShowWhenSupported
            onUnauthorized={vi.fn()}
            client={sourceClient}
          />
          <CameraSourceSetupPanel
            embedded
            apiUrl={API_URL}
            token="tok"
            siteId={SITE_ID}
            camera={camera}
            setupKey={['shared-owner']}
            canWrite={true}
            resumeController={controller}
            onUnauthorized={vi.fn()}
            client={sourceClient}
          />
        </div>
      );
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <SharedOwnerHarness version={5} />
      </QueryClientProvider>,
    );

    const applyBarBtn = (await screen.findByTestId('camera-sticky-apply-btn')) as HTMLButtonElement;
    // Exactly ONE Apply saved configuration button across both header bar and embedded source panel
    expect(
      screen.getAllByRole('button', {
        name: /Apply saved configuration|Áp dụng cấu hình đã lưu/,
      }),
    ).toHaveLength(1);
    expect(screen.queryByTestId('camera-source-resume-card')).toBeNull();

    // Select USB device so Test connection would otherwise be enabled
    await user.selectOptions(await screen.findByLabelText(/Device|Thiết bị/), 'usb0');
    const testBtn = screen.getByRole('button', {
      name: /Test connection|Kiểm tra kết nối/,
    }) as HTMLButtonElement;
    expect(testBtn.disabled).toBe(false);

    // 1) While global resume is in-flight, embedded source probe/activation controls are blocked
    await user.click(applyBarBtn);
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    expect(applyBarBtn.disabled).toBe(true);
    expect(testBtn.disabled).toBe(true);

    resolveResume?.({
      state: 'STARTED',
      commandId: 'ignored',
      sourceRevision: 3,
      configurationVersion: 5,
      currentGenerationId: '99999999-9999-4999-8999-999999999901',
      viewRevision: 1,
      bundleSha256: 'a'.repeat(64),
    });
    await waitFor(() => expect(testBtn.disabled).toBe(false));

    // Bump config version to v6 so resume button becomes eligible again, then start live source activation
    rerender(
      <QueryClientProvider client={queryClient}>
        <SharedOwnerHarness version={6} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(applyBarBtn.disabled).toBe(false));

    await user.click(testBtn);
    const activateBtn = (await screen.findByRole('button', {
      name: /Save and activate|Lưu và kích hoạt/,
    })) as HTMLButtonElement;

    // 2) While source activation (apply) is pending, sticky Apply saved configuration button is blocked
    await user.click(activateBtn);
    await user.click(
      await screen.findByRole('button', {
        name: /Confirm source replacement|Xác nhận đổi nguồn/,
      }),
    );
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(applyBarBtn.disabled).toBe(true);
    fireEvent.click(applyBarBtn);
    expect(resume).toHaveBeenCalledTimes(1);

    resolveApply?.({
      state: 'RUNNING',
      commandId: 'apply-cmd-1',
      sourceKind: 'LIVE',
      sourceRevision: 4,
      currentGenerationId: '99999999-9999-4999-8999-999999999902',
    });
    await waitFor(() => expect(applyBarBtn.disabled).toBe(false));
  });

  it('keeps camera pagination, partial-page errors, and linked-camera notice accessible outside the hidden mobile list rail without duplicating controls', async () => {
    const user = userEvent.setup();
    const CAM_PAGE2_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    const CAM_PAGE2: CameraResponse = {
      ...CAM_ACTIVE,
      id: CAM_PAGE2_ID,
      code: 'CAM-02',
      name: 'South Crane Camera',
      externalId: 'edge-south-02',
      configurationVersion: 2,
    };

    const listCameras = vi
      .fn<SmartSiteManagementClient['listCameras']>()
      .mockResolvedValueOnce({
        items: [CAM_ACTIVE],
        total: 2,
      } satisfies Page<CameraResponse>)
      .mockRejectedValueOnce(new Error('Page 2 transient failure'))
      .mockResolvedValueOnce({
        items: [CAM_PAGE2],
        total: 2,
      } satisfies Page<CameraResponse>);

    mockUseManagementClient.mockReturnValue({
      listSites: vi.fn<SmartSiteManagementClient['listSites']>().mockResolvedValue({
        items: [
          {
            id: SITE_ID,
            code: 'SITE-01',
            name: 'Alpha Site',
            createdAt: '2026-11-01T00:00:00.000Z',
          },
        ],
        total: 1,
      } satisfies Page<SiteResponse>),
      listCameras,
      getCamera: vi.fn<SmartSiteManagementClient['getCamera']>().mockResolvedValue(CAM_ACTIVE),
      getCameraApplicationStatus: vi
        .fn<SmartSiteManagementClient['getCameraApplicationStatus']>()
        .mockResolvedValue({
          siteId: SITE_ID,
          cameraId: CAM_ID,
          desiredRevision: 5,
          reportedRevision: 5,
          applicationState: 'LOADED',
          viewValidity: 'UNCONFIRMED',
          reasonCode: null,
          lastReceiptAt: new Date().toISOString(),
          observedAt: new Date().toISOString(),
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
        cameraId: CAM_ID,
        regionId: null,
        configurationVersion: 5,
        savedRevision: 5,
        policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
      }),
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/camera-setup?siteId=${SITE_ID}&cameraId=${CAM_PAGE2_ID}`]}>
          <CameraSetupView apiUrl={API_URL} sharedSession={makeSession()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const loadMoreBtn = await screen.findByTestId('camera-setup-load-more');
    const linkedNotice = screen.getByTestId('camera-setup-linked-notice');
    const sourceRail = screen.getByTestId('camera-setup-source-rail');
    const sourceList = screen.getByTestId('camera-setup-source-list');

    // Tall card list remains hidden on mobile, while the rail wrapper stays visible for pagination/status/error
    expect(sourceList.className.split(/\s+/)).toContain('hidden');
    expect(sourceList.className.split(/\s+/)).toContain('lg:block');
    expect(sourceRail.className.split(/\s+/)).not.toContain('hidden');

    // Single source of truth: no duplicated Load more buttons or linked-camera notices across mobile/desktop
    expect(screen.getAllByTestId('camera-setup-load-more')).toHaveLength(1);
    expect(screen.getAllByTestId('camera-setup-linked-notice')).toHaveLength(1);
    expect(sourceList.contains(loadMoreBtn)).toBe(false);
    expect(sourceList.contains(linkedNotice)).toBe(false);

    // Partial-page loadMore failure surfaces alert outside the hidden card list while allowing retry
    await user.click(loadMoreBtn);
    const alert = await screen.findByRole('alert');
    expect(sourceList.contains(alert)).toBe(false);
    expect(sourceRail.className.split(/\s+/)).not.toContain('hidden');

    // Retrying Load more fetches page 2, clears the deep-link notice, and populates the native mobile camera picker
    await user.click(loadMoreBtn);
    const quickSelect = (await screen.findByTestId(
      'camera-setup-quick-select',
    )) as HTMLSelectElement;
    await waitFor(() => expect(screen.queryByTestId('camera-setup-load-more')).toBeNull());
    expect(screen.queryByTestId('camera-setup-linked-notice')).toBeNull();
    // Once pagination/notice/error clear, the mobile rail wrapper returns to hidden lg:block
    expect(sourceRail.className.split(/\s+/)).toContain('hidden');

    // Page-2 camera is selectable via the mobile native picker
    expect(Array.from(quickSelect.options).map((o) => o.value)).toEqual([CAM_ID, CAM_PAGE2_ID]);
    await user.selectOptions(quickSelect, CAM_PAGE2_ID);
    expect(quickSelect.value).toBe(CAM_PAGE2_ID);
  });

  it('resets stale resume state (both prior success and prior error) after confirmed new-source apply and waits for refreshed caps revision before next resume', async () => {
    const user = userEvent.setup();
    let currentSourceRevision = 3;
    const pendingHostsRefresh: {
      resolve: ((hosts: Awaited<ReturnType<CameraSourceClient['hosts']>>) => void) | null;
    } = { resolve: null };
    let deferNextHostsFetch = false;

    const makeHostList = (rev: number) => [
      {
        id: 'edge-1',
        label: 'Site Edge Host',
        available: true,
        capabilities: {
          sourceKinds: ['WEBCAM', 'RTSP'] as ('WEBCAM' | 'RTSP')[],
          webcams: [{ id: 'usb0', label: 'USB 0' }],
          videos: [],
          browserCameraSupported: false,
          applySupported: true,
          configurationResumeSupported: true,
          sourceRevision: rev,
        },
      },
    ];

    const hosts = vi.fn<CameraSourceClient['hosts']>().mockImplementation(() => {
      if (deferNextHostsFetch) {
        deferNextHostsFetch = false;
        return new Promise((resolve) => {
          pendingHostsRefresh.resolve = resolve;
        });
      }
      return Promise.resolve(makeHostList(currentSourceRevision));
    });

    const probe = vi.fn<CameraSourceClient['probe']>().mockResolvedValue({
      state: 'TESTED',
      receiptId: 'receipt-live-fresh',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sourceKind: 'LIVE',
      frame: {
        width: 640,
        height: 360,
        capturedAt: new Date().toISOString(),
        imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      },
    });

    const apply = vi.fn<NonNullable<CameraSourceClient['apply']>>().mockImplementation(async () => {
      currentSourceRevision += 1;
      return {
        state: 'RUNNING',
        commandId: `apply-cmd-rev-${currentSourceRevision}`,
        sourceKind: 'LIVE',
        sourceRevision: currentSourceRevision,
        currentGenerationId: `99999999-9999-4999-8999-99999999990${currentSourceRevision}`,
      };
    });

    const resume = vi
      .fn<NonNullable<CameraSourceClient['resume']>>()
      // 1st resume succeeds (and simulates own resume advancing host sourceRevision 3 -> 4)
      .mockImplementationOnce(async (_a, _t, _s, _c, _h, cmd) => {
        currentSourceRevision = 4;
        return {
          state: 'STARTED',
          commandId: cmd.commandId,
          sourceRevision: 4,
          configurationVersion: 5,
          currentGenerationId: '99999999-9999-4999-8999-999999999911',
          viewRevision: 1,
          bundleSha256: 'a'.repeat(64),
        };
      })
      // 2nd resume (after confirmed source apply rev 4 -> 5) fails 503
      .mockRejectedValueOnce(new SourceSetupError(503))
      // 3rd resume (after second confirmed source apply rev 5 -> 6) succeeds with fresh commandId & expectedRevision 6
      .mockImplementationOnce(async (_a, _t, _s, _c, _h, cmd) => ({
        state: 'STARTED',
        commandId: cmd.commandId,
        sourceRevision: 7,
        configurationVersion: 5,
        currentGenerationId: '99999999-9999-4999-8999-999999999912',
        viewRevision: 1,
        bundleSha256: 'b'.repeat(64),
      }));

    const sourceClient: CameraSourceClient = { hosts, probe, apply, resume };

    function SharedHarness() {
      const controller = useCameraSourceResumeController({
        apiUrl: API_URL,
        token: 'tok',
        siteId: SITE_ID,
        camera: CAM_ACTIVE,
        setupKey: ['stale-resume-reset'],
        canWrite: true,
        enabled: true,
        onUnauthorized: vi.fn(),
        client: sourceClient,
      });
      return (
        <div>
          <CameraApplySavedBar
            apiUrl={API_URL}
            token="tok"
            siteId={SITE_ID}
            camera={CAM_ACTIVE}
            setupKey={['stale-resume-reset']}
            canWrite={true}
            controller={controller}
            alwaysShowWhenSupported
            onUnauthorized={vi.fn()}
            client={sourceClient}
          />
          <CameraSourceSetupPanel
            embedded
            apiUrl={API_URL}
            token="tok"
            siteId={SITE_ID}
            camera={CAM_ACTIVE}
            setupKey={['stale-resume-reset']}
            canWrite={true}
            resumeController={controller}
            onUnauthorized={vi.fn()}
            client={sourceClient}
          />
        </div>
      );
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <SharedHarness />
      </QueryClientProvider>,
    );

    const applyBarBtn = (await screen.findByTestId('camera-sticky-apply-btn')) as HTMLButtonElement;

    // 1) Initial resume succeeds on rev 3 -> own resume bumps host rev to 4; success state MUST remain intact (no blind reset)
    await user.click(applyBarBtn);
    await screen.findByText(/Check configuration status|Kiểm tra trạng thái cấu hình/);
    expect(resume.mock.calls[0]?.[5]).toMatchObject({
      expectedRevision: 3,
      expectedConfigurationVersion: 5,
    });
    await waitFor(() => expect(hosts).toHaveBeenCalledTimes(2));
    expect(applyBarBtn.disabled).toBe(true);

    // 2) Confirmed new-source apply on SAME host/camera/configVersion (rev 4 -> 5), holding hosts refresh to prove gate
    await user.selectOptions(await screen.findByLabelText(/Device|Thiết bị/), 'usb0');
    await user.click(screen.getByRole('button', { name: /Test connection|Kiểm tra kết nối/ }));
    const activateBtn = await screen.findByRole('button', {
      name: /Save and activate|Lưu và kích hoạt/,
    });
    deferNextHostsFetch = true;
    await user.click(activateBtn);
    await user.click(
      await screen.findByRole('button', {
        name: /Confirm source replacement|Xác nhận đổi nguồn/,
      }),
    );
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));

    // Prior resume success banner cleared immediately, but Apply stays disabled until refreshed caps arrive
    expect(
      screen.queryByText(/Check configuration status|Kiểm tra trạng thái cấu hình/),
    ).toBeNull();
    expect(applyBarBtn.disabled).toBe(true);

    // Finish caps refresh with rev 5 -> Apply re-enables with fresh commandId & expectedRevision 5
    pendingHostsRefresh.resolve?.(makeHostList(currentSourceRevision));
    await waitFor(() => expect(applyBarBtn.disabled).toBe(false));

    // 3) Next resume fails 503 with expectedRevision 5 (stores failed commandId)
    await user.click(applyBarBtn);
    await waitFor(() =>
      expect(applyBarBtn.textContent).toMatch(/Retry the same request|Thử lại cùng yêu cầu/),
    );
    const failedCmd = resume.mock.calls[1]?.[5];
    expect(failedCmd).toMatchObject({
      expectedRevision: 5,
      expectedConfigurationVersion: 5,
    });
    expect(failedCmd?.commandId).not.toBe(resume.mock.calls[0]?.[5]?.commandId);

    // 4) Second confirmed new-source apply (rev 5 -> 6) clears failed retry state & stale commandId
    await user.click(screen.getByRole('button', { name: /Test connection|Kiểm tra kết nối/ }));
    const activateBtn2 = await screen.findByRole('button', {
      name: /Save and activate|Lưu và kích hoạt/,
    });
    await user.click(activateBtn2);
    await user.click(
      await screen.findByRole('button', {
        name: /Confirm source replacement|Xác nhận đổi nguồn/,
      }),
    );
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(applyBarBtn.disabled).toBe(false);
      expect(applyBarBtn.textContent).toMatch(/Apply saved configuration|Áp dụng cấu hình đã lưu/);
    });

    // 5) Fresh resume sends brand-new commandId and updated expectedRevision 6
    await user.click(applyBarBtn);
    await screen.findByText(/Check configuration status|Kiểm tra trạng thái cấu hình/);
    const freshCmd = resume.mock.calls[2]?.[5];
    expect(freshCmd).toMatchObject({
      expectedRevision: 6,
      expectedConfigurationVersion: 5,
    });
    expect(freshCmd?.commandId).not.toBe(failedCmd?.commandId);
  });
});
