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
});
