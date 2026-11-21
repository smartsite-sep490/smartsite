// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  SourceSetupError,
  type CameraSourceClient,
  type LoginResponse,
  type SavedPpePolicy,
  type SmartSiteManagementClient,
} from '@smartsite/api-client';
import type { CameraApplicationStatus } from '@smartsite/contracts/camera-application-status';
import type {
  CameraResponse,
  RegionResponse,
  SiteResponse,
  ZoneResponse,
} from '@smartsite/contracts/management';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import type { SharedSession } from '../../types/shared-session';
import { ZonePpeCameraRegionPanel } from '../ppe/ZonePpeCameraRegionPanel';
import { ZonePpeList } from '../ppe/ZonePpeList';
import { registerZonePpeSetupCopy } from '../ppe/zone-ppe-setup-copy';
import { RestrictedZoneView } from '../zones/RestrictedZoneView';
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

vi.mock('../ppe/FocusedCameraMedia', () => ({
  FocusedCameraMedia: ({
    siteId,
    camera,
    observationMode,
  }: {
    siteId: string;
    camera: { id: string };
    observationMode: string;
  }) => (
    <div data-testid="mock-focused-media">
      {siteId}:{camera.id}:{observationMode}
    </div>
  ),
}));

const API_URL = 'https://api.smartsite.local';
const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAM_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const CAM_B_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const ZONE_STD_ID = '22222222-2222-4222-8222-222222222201';
const ZONE_RESTRICTED_ID = '22222222-2222-4222-8222-222222222202';
const REG_RESTRICTED_ID = '77777777-7777-4777-8777-777777777702';
const SESSION_ID = '33333333-3333-4333-8333-333333333399';

const SITE_FIXTURE: SiteResponse = {
  id: SITE_ID,
  code: 'SITE-01',
  name: 'North Yard',
  createdAt: '2026-11-01T00:00:00.000Z',
};

const CAM_A: CameraResponse = {
  type: 'ZONE',
  gateId: null,
  id: CAM_A_ID,
  siteId: SITE_ID,
  code: 'CAM-01',
  name: 'North Crane Camera',
  externalId: 'edge-cam-north-01',
  status: 'ACTIVE',
  configurationVersion: 4,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const CAM_B: CameraResponse = {
  type: 'ZONE',
  gateId: null,
  id: CAM_B_ID,
  siteId: SITE_ID,
  code: 'CAM-02',
  name: 'South Gate Camera',
  externalId: 'edge-cam-south-02',
  status: 'ACTIVE',
  configurationVersion: 2,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const ZONE_STD: ZoneResponse = {
  id: ZONE_STD_ID,
  siteId: SITE_ID,
  code: 'Z-GENERAL',
  name: 'General Walkway',
  type: 'STANDARD',
  restrictionPolicy: 'NONE',
  requiredPpe: ['HARD_HAT'],
  configurationLocked: false,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const ZONE_RESTRICTED: ZoneResponse = {
  id: ZONE_RESTRICTED_ID,
  siteId: SITE_ID,
  code: 'Z-RESTRICTED',
  name: 'High Voltage Substation',
  type: 'RESTRICTED',
  restrictionPolicy: 'AUTHORIZATION_REQUIRED',
  requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
  configurationLocked: true,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const SAVED_RESTRICTED_REGION: RegionResponse = {
  id: REG_RESTRICTED_ID,
  cameraId: CAM_A_ID,
  zoneId: ZONE_RESTRICTED_ID,
  polygon: {
    coordinates: [
      [0.15, 0.2],
      [0.55, 0.2],
      [0.55, 0.65],
      [0.15, 0.65],
    ],
  },
  coordinateSpace: 'NORMALIZED_0_1',
  version: 2,
  isActive: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  geometryConfirmation: {
    status: 'MANUALLY_CONFIRMED',
    referenceId: '66666666-6666-4666-8666-666666666601',
    viewRevision: 1,
    confirmedByUserId: '99999999-9999-4999-8999-999999999999',
    confirmedAt: '2026-11-17T08:00:00.000Z',
  },
};

const TINY_JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x68, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00, 0xff,
  0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
]);
const TINY_JPEG = `data:image/jpeg;base64,${btoa(String.fromCharCode(...TINY_JPEG_BYTES))}`;

function buildRefEnvelope(configVersion: number, viewRevision = 1, seq = 1) {
  const capturedIso = new Date().toISOString();
  const expIso = new Date(Date.now() + 240_000).toISOString();
  const sha = 'b'.repeat(64);
  return {
    viewValidity: 'UNCONFIRMED' as const,
    image: {
      schemaVersion: 1 as const,
      purpose: 'REGION_CONFIGURATION' as const,
      sourceKind: 'LIVE' as const,
      siteId: SITE_ID,
      cameraId: CAM_A_ID,
      configurationVersion: configVersion,
      referenceExpiresAt: expIso,
      frame: {
        cameraExternalId: CAM_A.externalId,
        sessionId: SESSION_ID,
        sequenceNumber: String(seq),
        capturedAt: capturedIso,
        width: 640,
        height: 360,
        imageDataUrl: TINY_JPEG,
        imageSha256: sha,
      },
    },
    reference: {
      schemaVersion: '1.0.0' as const,
      purpose: 'REGION_CONFIGURATION' as const,
      sourceKind: 'LIVE' as const,
      referenceId: `66666666-6666-4666-8666-66666666660${seq}`,
      siteId: SITE_ID,
      cameraId: CAM_A_ID,
      sessionId: SESSION_ID,
      imageSha256: sha,
      width: 640,
      height: 360,
      capturedAt: capturedIso,
      issuedAt: capturedIso,
      expiresAt: expIso,
      configurationVersion: configVersion,
      viewRevision,
    },
  };
}

function makeManagerSession(): SharedSession {
  return {
    accessToken: 'token-mgr-edit',
    sessionScope: 'scope-mgr-edit',
    onSignOut: vi.fn(),
    user: {
      id: 'mgr-user-1',
      displayName: 'Site Manager',
      mustChangePassword: false,
      roleAssignments: [{ role: 'SITE_MANAGER', siteId: SITE_ID }],
    },
  };
}

describe('Post-setup Camera PPE and Restricted Zone polygon editability', () => {
  const origImage = globalThis.Image;

  beforeEach(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
    registerZonePpeSetupCopy();
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
  });

  afterEach(async () => {
    globalThis.Image = origImage;
    cleanup();
    await i18n.changeLanguage('en');
    vi.restoreAllMocks();
  });

  it('reopens saved camera PPE, edits and saves revision v5, shows pending vs applied worker ACK + refresh/apply actions, and isolates drafts across cameras', async () => {
    const user = userEvent.setup();
    let camAPolicy: SavedPpePolicy = {
      cameraId: CAM_A_ID,
      regionId: null,
      configurationVersion: 4,
      savedRevision: 4,
      policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
    };
    const camBPolicy: SavedPpePolicy = {
      cameraId: CAM_B_ID,
      regionId: null,
      configurationVersion: 2,
      savedRevision: 2,
      policy: { mode: 'DISABLED', reason: 'Temporarily paused' },
    };
    let reportedRevision = 4;

    const getCameraApplicationStatus = vi.fn().mockImplementation(async () => {
      const nowIso = new Date().toISOString();
      return {
        siteId: SITE_ID,
        cameraId: CAM_A_ID,
        desiredRevision: camAPolicy.configurationVersion,
        reportedRevision,
        applicationState:
          reportedRevision === camAPolicy.configurationVersion ? 'LOADED' : 'PENDING',
        viewValidity: 'UNCONFIRMED',
        reasonCode: null,
        lastReceiptAt: nowIso,
        observedAt: nowIso,
      } satisfies CameraApplicationStatus;
    });

    const updateCameraPpePolicy = vi.fn().mockImplementation(async (_tok, _site, _cam, command) => {
      camAPolicy = {
        cameraId: CAM_A_ID,
        regionId: null,
        configurationVersion: 5,
        savedRevision: 5,
        policy: command.policy,
      };
      return {
        cameraId: CAM_A_ID,
        commandId: command.commandId,
        configurationVersion: 5,
        viewRevision: 1,
        bundleSha256: 'c'.repeat(64),
        replayed: false,
      };
    });

    const client: CameraPpeContext['client'] & {
      getCameraApplicationStatus: typeof getCameraApplicationStatus;
    } = {
      readSavedPpePolicy: vi
        .fn()
        .mockImplementation(async (_tok, _site, cameraId) =>
          cameraId === CAM_A_ID ? camAPolicy : camBPolicy,
        ),
      listRegions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      initializePpePolicy: vi.fn(),
      updateCameraPpePolicy,
      updateRegionPpePolicy: vi.fn(),
      activateRegionWithPpePolicy: vi.fn(),
      getCameraApplicationStatus,
    };

    const onOpenApply = vi.fn();
    const setupKey = ['post-setup-ppe-edit'];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <CameraPpePolicyPanel
          cameraId={CAM_A_ID}
          camera={CAM_A}
          canWrite
          expandSignal={1}
          onOpenApply={onOpenApply}
          context={{ client, token: 'tok', siteId: SITE_ID, setupKey, onUnauthorized: vi.fn() }}
          statusContext={{
            client,
            token: 'tok',
            siteId: SITE_ID,
            setupKey,
            enabled: true,
            onUnauthorized: vi.fn(),
          }}
        />
      </QueryClientProvider>,
    );

    const vestCheckbox = (await screen.findByRole('checkbox', {
      name: 'Safety vest',
    })) as HTMLInputElement;
    expect(vestCheckbox.checked).toBe(false);
    expect(screen.getByTestId('camera-ppe-capability-note').textContent).toContain(
      'Required PPE vs model support',
    );

    // Toggling mode on Camera A preserves selected PPE items in the same scope
    await user.click(vestCheckbox);
    expect(vestCheckbox.checked).toBe(true);
    const modeSelect = screen.getByLabelText('Policy mode');
    await user.selectOptions(modeSelect, 'DISABLED');
    await user.selectOptions(modeSelect, 'EXPLICIT');
    expect(
      (screen.getByRole('checkbox', { name: 'Safety vest' }) as HTMLInputElement).checked,
    ).toBe(true);

    // Save edited PPE -> revision 5 saved, worker still reports v4 -> pending state + Apply shortcut
    await user.click(screen.getByRole('button', { name: 'Save PPE policy' }));
    await waitFor(() => expect(updateCameraPpePolicy).toHaveBeenCalledTimes(1));
    expect(updateCameraPpePolicy.mock.calls[0]?.[3]).toMatchObject({
      expectedConfigurationVersion: 4,
      policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT', 'SAFETY_VEST'] },
    });

    await waitFor(() => {
      expect(screen.getByTestId('camera-ppe-sync-status').getAttribute('data-sync-state')).toBe(
        'not-yet-applied',
      );
    });
    const jumpApplyBtn = screen.getByTestId('camera-ppe-jump-to-apply');
    await user.click(jumpApplyBtn);
    expect(onOpenApply).toHaveBeenCalledTimes(1);

    // Worker confirms v5 -> Refresh worker status transitions cleanly to applied
    reportedRevision = 5;
    await user.click(screen.getByTestId('camera-ppe-refresh-worker-status'));
    await waitFor(() => {
      expect(screen.getByTestId('camera-ppe-sync-status').getAttribute('data-sync-state')).toBe(
        'applied',
      );
    });

    // Switching to Camera B (whose saved policy is DISABLED) and choosing EXPLICIT must NOT leak Camera A's HARD_HAT/SAFETY_VEST draft
    rerender(
      <QueryClientProvider client={queryClient}>
        <CameraPpePolicyPanel
          cameraId={CAM_B_ID}
          camera={CAM_B}
          canWrite
          expandSignal={1}
          context={{ client, token: 'tok', siteId: SITE_ID, setupKey, onUnauthorized: vi.fn() }}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect((screen.getByLabelText('Policy mode') as HTMLSelectElement).value).toBe('DISABLED');
    });
    await user.selectOptions(screen.getByLabelText('Policy mode'), 'EXPLICIT');
    expect((screen.getByRole('checkbox', { name: 'Hard hat' }) as HTMLInputElement).checked).toBe(
      false,
    );
    expect(
      (screen.getByRole('checkbox', { name: 'Safety vest' }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('keeps stale revision 409 reload distinct from view-revalidation reference capture in CameraPpePolicyPanel', async () => {
    const user = userEvent.setup();
    const onOpenReference = vi.fn();
    let viewValidity: CameraApplicationStatus['viewValidity'] = 'UNCONFIRMED';
    const client: CameraPpeContext['client'] & {
      getCameraApplicationStatus: () => Promise<CameraApplicationStatus>;
    } = {
      readSavedPpePolicy: vi.fn().mockResolvedValue({
        cameraId: CAM_A_ID,
        regionId: null,
        configurationVersion: 4,
        savedRevision: 4,
        policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
      }),
      listRegions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      initializePpePolicy: vi.fn(),
      updateCameraPpePolicy: vi.fn().mockRejectedValue(new ApiError('http', 'Conflict', 409)),
      updateRegionPpePolicy: vi.fn(),
      activateRegionWithPpePolicy: vi.fn(),
      getCameraApplicationStatus: vi.fn().mockImplementation(async () => ({
        siteId: SITE_ID,
        cameraId: CAM_A_ID,
        desiredRevision: 4,
        reportedRevision: 4,
        applicationState: viewValidity === 'NEEDS_REVALIDATION' ? 'PENDING' : 'LOADED',
        viewValidity,
        reasonCode: null,
        lastReceiptAt: new Date().toISOString(),
        observedAt: new Date().toISOString(),
      })),
    };

    const setupKey = ['ppe-409-distinction'];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CameraPpePolicyPanel
          cameraId={CAM_A_ID}
          camera={CAM_A}
          canWrite
          expandSignal={1}
          onOpenReference={onOpenReference}
          context={{ client, token: 'tok', siteId: SITE_ID, setupKey, onUnauthorized: vi.fn() }}
          statusContext={{
            client,
            token: 'tok',
            siteId: SITE_ID,
            setupKey,
            enabled: true,
            onUnauthorized: vi.fn(),
          }}
        />
      </QueryClientProvider>,
    );

    await screen.findByRole('checkbox', { name: 'Hard hat' });
    await user.click(screen.getByRole('button', { name: 'Save PPE policy' }));
    expect(await screen.findByTestId('camera-ppe-409-reload-policy')).toBeTruthy();
    // Stale revision 409 without invalid view must NOT push user to recapture a reference image
    expect(screen.queryByTestId('camera-ppe-409-open-reference')).toBeNull();
    expect(screen.queryByTestId('camera-ppe-reference-guidance')).toBeNull();

    // When viewValidity becomes REVALIDATION_REQUIRED, offer Set up reference image while keeping draft
    viewValidity = 'NEEDS_REVALIDATION';
    await user.click(screen.getByTestId('camera-ppe-refresh-worker-status'));
    const refGuidance = await screen.findByTestId('camera-ppe-reference-guidance');
    const refBtn = within(refGuidance).getByRole('button', { name: 'Set up reference image' });
    await user.click(refBtn);
    expect(onOpenReference).toHaveBeenCalledTimes(1);
  });

  it('auto-selects a single available AI host in CameraSourceSetupPanel so Apply saved configuration and retry are immediately accessible', async () => {
    const user = userEvent.setup();
    const resume = vi
      .fn()
      .mockRejectedValueOnce(new SourceSetupError(503))
      .mockResolvedValue({
        state: 'STARTED',
        sourceRevision: 3,
        configurationVersion: 5,
        currentGenerationId: 'gen-2',
        viewRevision: 1,
        bundleSha256: 'd'.repeat(64),
      });

    const sourceClient: CameraSourceClient = {
      hosts: async () => [
        {
          id: 'edge-1',
          label: 'Site Edge Host',
          available: true,
          capabilities: {
            sourceKinds: ['WEBCAM', 'RTSP'],
            webcams: [{ id: 'usb0', label: 'USB Cam' }],
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

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CameraSourceSetupPanel
          apiUrl={API_URL}
          token="tok"
          siteId={SITE_ID}
          camera={{ id: CAM_A_ID, name: CAM_A.name, configurationVersion: 5 }}
          setupKey={['auto-host-resume']}
          canWrite
          onUnauthorized={vi.fn()}
          client={sourceClient}
        />
      </QueryClientProvider>,
    );

    // Without manually selecting host dropdown, Apply saved configuration card is immediately visible
    const resumeCard = await screen.findByTestId('camera-source-resume-card');
    const applyBtn = within(resumeCard).getByRole('button', {
      name: /Apply saved configuration|Áp dụng cấu hình đã lưu/,
    });
    await user.click(applyBtn);
    const retryBtn = await screen.findByRole('button', {
      name: /Retry the same request|Thử lại cùng yêu cầu/,
    });
    await user.click(retryBtn);
    await screen.findByText(/Check configuration status|Kiểm tra trạng thái cấu hình/);
    expect(resume).toHaveBeenCalledTimes(2);
    expect(resume.mock.calls[1]?.[5]).toEqual(resume.mock.calls[0]?.[5]);
  });

  it('surfaces a saved Restricted Zone polygon even when another zone is selected by default, supports one-click reference load & edit, saves v5, and shows consecutive-edit reload banner', async () => {
    const user = userEvent.setup();
    const onOpenApply = vi.fn();
    let currentCamVersion = 4;
    const getCameraConfigurationReference = vi
      .fn()
      .mockImplementation(async () => buildRefEnvelope(currentCamVersion, 1, currentCamVersion));
    const updateReferencePolygon = vi.fn().mockImplementation(async () => {
      currentCamVersion = 5;
      return {
        configurationVersion: 5,
        region: {
          ...SAVED_RESTRICTED_REGION,
          version: 3,
          polygon: {
            coordinates: [
              [0.15, 0.2],
              [0.55, 0.2],
              [0.55, 0.65],
              [0.15, 0.65],
            ],
          },
          geometryConfirmation: {
            status: 'MANUALLY_CONFIRMED',
            referenceId: '66666666-6666-4666-8666-666666666604',
            viewRevision: 1,
            confirmedByUserId: '99999999-9999-4999-8999-999999999999',
            confirmedAt: new Date().toISOString(),
          },
        },
      };
    });

    const mockClient = {
      listCameras: vi.fn().mockImplementation(async () => ({
        items: [{ ...CAM_A, configurationVersion: currentCamVersion }],
        total: 1,
      })),
      getCamera: vi
        .fn()
        .mockImplementation(async () => ({ ...CAM_A, configurationVersion: currentCamVersion })),
      listRegions: vi.fn().mockResolvedValue({ items: [SAVED_RESTRICTED_REGION], total: 1 }),
      readSavedPpePolicy: vi.fn().mockResolvedValue({
        cameraId: CAM_A_ID,
        regionId: null,
        configurationVersion: 4,
        savedRevision: 4,
        policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
      }),
      getCameraConfigurationReference,
      updateReferencePolygon,
    } as unknown as SmartSiteManagementClient;

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          embedded
          apiUrl={API_URL}
          client={mockClient}
          token="token-mgr"
          sessionScope="mgr-scope"
          credentialId={1}
          siteId={SITE_ID}
          zones={[ZONE_STD, ZONE_RESTRICTED]}
          onOpenApply={onOpenApply}
        />
      </QueryClientProvider>,
    );

    // ZONE_STD is selected first (0 regions), yet ZONE_RESTRICTED's saved polygon is visible in Other Zones
    const otherSection = await screen.findByTestId('other-zone-regions-section');
    expect(within(otherSection).getByText('High Voltage Substation · Region #1')).toBeTruthy();
    expect(within(otherSection).getByText('Restricted Zone')).toBeTruthy();

    // One-click "Load image & edit" switches Zone, loads fresh reference, and opens the polygon editor
    const oneClickEditBtn = within(otherSection).getByRole('button', {
      name: 'Load image & edit',
    });
    expect((oneClickEditBtn as HTMLButtonElement).disabled).toBe(false);
    await user.click(oneClickEditBtn);

    await waitFor(() => {
      expect(getCameraConfigurationReference).toHaveBeenCalledTimes(1);
    });
    expect((screen.getByLabelText('Select Zone') as HTMLSelectElement).value).toBe(
      ZONE_RESTRICTED_ID,
    );
    const contextHeader = await screen.findByTestId('polygon-authoring-context');
    expect(contextHeader.textContent).toContain('High Voltage Substation · Region v2');

    // Edit the saved 4-point polygon by adding a 5th vertex via coordinate controls so draft differs cleanly from saved polygon
    const xInput = screen.getByLabelText('Point X (0–1)');
    const yInput = screen.getByLabelText('Point Y (0–1)');
    await user.clear(xInput);
    await user.type(xInput, '0.12');
    await user.clear(yInput);
    await user.type(yInput, '0.42');
    await user.click(screen.getByRole('button', { name: 'Add Point' }));
    const consentCheckbox = within(screen.getByTestId('region-reference-view-consent')).getByRole(
      'checkbox',
    );
    await user.click(consentCheckbox);
    const saveBtn = screen.getByRole('button', { name: 'Save Region' });
    await user.click(saveBtn);

    await waitFor(() => expect(updateReferencePolygon).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('region-saved-feedback')).toBeTruthy();
    const jumpApplyBtn = screen.getByTestId('region-saved-jump-to-apply');
    await user.click(jumpApplyBtn);
    expect(onOpenApply).toHaveBeenCalledTimes(1);

    // Open drawer now shows stale revision reload banner for consecutive saves
    expect(await screen.findByTestId('polygon-stale-revision-banner')).toBeTruthy();
    expect(screen.getByTestId('polygon-stale-reload-reference')).toBeTruthy();
  });

  it('provides a role-gated Edit zone polygon deep-link from /zones that opens inline region setup aligned to the saved Restricted Zone', async () => {
    const mockClient = {
      listSites: vi.fn().mockResolvedValue({ items: [SITE_FIXTURE], total: 1 }),
      listCameras: vi.fn().mockResolvedValue({ items: [CAM_A], total: 1 }),
      getCamera: vi.fn().mockResolvedValue(CAM_A),
      listZones: vi.fn().mockResolvedValue({ items: [ZONE_STD, ZONE_RESTRICTED], total: 2 }),
      listRegions: vi.fn().mockResolvedValue({ items: [SAVED_RESTRICTED_REGION], total: 1 }),
      getCameraApplicationStatus: vi.fn().mockResolvedValue({
        siteId: SITE_ID,
        cameraId: CAM_A_ID,
        desiredRevision: 4,
        reportedRevision: 4,
        applicationState: 'LOADED',
        viewValidity: 'UNCONFIRMED',
        reasonCode: null,
        lastReceiptAt: new Date().toISOString(),
        observedAt: new Date().toISOString(),
      }),
      getCameraConfigurationReference: vi.fn().mockRejectedValue({ status: 404 }),
      readSavedPpePolicy: vi.fn().mockResolvedValue({
        cameraId: CAM_A_ID,
        regionId: null,
        configurationVersion: 4,
        savedRevision: 4,
        policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
      }),
    };
    mockUseManagementClient.mockReturnValue(mockClient);

    const officerSession = {
      accessToken: 'tok-off',
      user: {
        id: 'off-1',
        username: 'officer',
        displayName: 'Safety Officer',
        isActive: true,
        mustChangePassword: false,
        roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: SITE_ID }],
      },
    } as Pick<LoginResponse, 'accessToken' | 'user'>;

    const managerLoginSession = {
      accessToken: 'tok-mgr',
      user: {
        id: 'mgr-1',
        username: 'manager',
        displayName: 'Site Manager',
        isActive: true,
        mustChangePassword: false,
        roleAssignments: [{ role: 'SITE_MANAGER', siteId: SITE_ID }],
      },
    } as Pick<LoginResponse, 'accessToken' | 'user'>;

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RestrictedZoneView apiUrl={API_URL} authenticatedSession={officerSession} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByTestId('mock-focused-media');
    expect(screen.queryByTestId('zones-edit-polygon-link')).toBeNull();

    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RestrictedZoneView apiUrl={API_URL} authenticatedSession={managerLoginSession} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const editLink = await screen.findByTestId('zones-edit-polygon-link');
    await waitFor(() => {
      const currentHref = editLink.getAttribute('href') ?? '';
      expect(currentHref).toContain(`siteId=${SITE_ID}`);
      expect(currentHref).toContain(`cameraId=${CAM_A_ID}`);
      expect(currentHref).toContain('action=regions');
      expect(currentHref).toContain(`regionId=${REG_RESTRICTED_ID}`);
    });
    const href = editLink.getAttribute('href') ?? '';

    // Following that deep-link into CameraSetupView auto-opens inline region stage aligned to ZONE_RESTRICTED
    cleanup();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[href]}>
          <CameraSetupView apiUrl={API_URL} sharedSession={makeManagerSession()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const inlineStage = await screen.findByTestId('camera-setup-inline-region-stage');
    await waitFor(() => {
      expect((within(inlineStage).getByLabelText('Select Zone') as HTMLSelectElement).value).toBe(
        ZONE_RESTRICTED_ID,
      );
    });
  });

  it('gates URL-driven action=regions and action=ppe strictly on an exact requestedCameraId match without auto-opening fallback Camera A', async () => {
    const missingCameraId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa999';
    const baseClient = {
      listSites: vi.fn().mockResolvedValue({ items: [SITE_FIXTURE], total: 1 }),
      listCameras: vi.fn().mockResolvedValue({ items: [CAM_A], total: 1 }),
      getCamera: vi.fn().mockResolvedValue(CAM_A),
      listZones: vi.fn().mockResolvedValue({ items: [ZONE_STD, ZONE_RESTRICTED], total: 2 }),
      listRegions: vi.fn().mockResolvedValue({ items: [SAVED_RESTRICTED_REGION], total: 1 }),
      getCameraApplicationStatus: vi.fn().mockResolvedValue({
        siteId: SITE_ID,
        cameraId: CAM_A_ID,
        desiredRevision: 4,
        reportedRevision: 4,
        applicationState: 'LOADED',
        viewValidity: 'UNCONFIRMED',
        reasonCode: null,
        lastReceiptAt: new Date().toISOString(),
        observedAt: new Date().toISOString(),
      }),
      getCameraConfigurationReference: vi.fn().mockRejectedValue({ status: 404 }),
      readSavedPpePolicy: vi.fn().mockImplementation(async (_tok, _site, cameraId) => ({
        cameraId,
        regionId: null,
        configurationVersion: cameraId === CAM_B_ID ? 2 : 4,
        savedRevision: cameraId === CAM_B_ID ? 2 : 4,
        policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
      })),
    };
    mockUseManagementClient.mockReturnValue(baseClient);

    // 1. Unavailable / unloaded cameraId with action=regions must NOT auto-open Camera A's region editor
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter
          initialEntries={[
            `/camera-setup?siteId=${SITE_ID}&cameraId=${missingCameraId}&action=regions&regionId=${REG_RESTRICTED_ID}`,
          ]}
        >
          <CameraSetupView apiUrl={API_URL} sharedSession={makeManagerSession()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('listitem', { name: CAM_A.name });
    expect(screen.queryByTestId('camera-setup-inline-region-stage')).toBeNull();

    // 2. Unavailable / unloaded cameraId with action=ppe must NOT auto-expand Camera A's PPE panel
    cleanup();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter
          initialEntries={[
            `/camera-setup?siteId=${SITE_ID}&cameraId=${missingCameraId}&action=ppe`,
          ]}
        >
          <CameraSetupView apiUrl={API_URL} sharedSession={makeManagerSession()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const fallbackPpePanel = await screen.findByTestId('camera-ppe-policy-panel');
    expect(
      within(fallbackPpePanel)
        .getByRole('button', { name: 'Camera PPE policy' })
        .getAttribute('aria-expanded'),
    ).toBe('false');

    // 3. Exact requestedCameraId match (CAM_B while CAM_A is first row) DOES auto-expand CAM_B's PPE panel
    cleanup();
    mockUseManagementClient.mockReturnValue({
      ...baseClient,
      listCameras: vi.fn().mockResolvedValue({ items: [CAM_A, CAM_B], total: 2 }),
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter
          initialEntries={[`/camera-setup?siteId=${SITE_ID}&cameraId=${CAM_B_ID}&action=ppe`]}
        >
          <CameraSetupView apiUrl={API_URL} sharedSession={makeManagerSession()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const matchedPpePanel = await screen.findByTestId('camera-ppe-policy-panel');
    await waitFor(() => {
      expect(
        within(matchedPpePanel)
          .getByRole('button', { name: 'Camera PPE policy' })
          .getAttribute('aria-expanded'),
      ).toBe('true');
    });
    expect(screen.getByTestId('selected-camera-source-id').textContent).toContain(CAM_B.externalId);
  });

  it('explains in ZonePpeList where to edit active PPE after a zone locks (EN/VI)', async () => {
    const t = (key: string, params?: Record<string, string | number>) =>
      i18n.t(key, { ns: 'safety', ...params });
    const { rerender } = render(
      <ZonePpeList
        showZoneSection
        canManageZones
        scopedZones={[ZONE_RESTRICTED]}
        serverTotal={1}
        isPending={false}
        isFetching={false}
        isFetchingNextPage={false}
        hasNextPage={false}
        isInitialError={false}
        isAuthRevoked={false}
        isTransientNextPageError={false}
        isZonesSettledEmpty={false}
        editingZoneId={null}
        editingZoneName=""
        renameValidationError={null}
        renameServerError={null}
        renameSuccessFeedback={null}
        isRenamingZone={false}
        renameInputRef={{ current: null }}
        renameTriggerRefs={{ current: {} }}
        t={t}
        onRefetch={vi.fn()}
        onFetchNextPage={vi.fn()}
        onStartRename={vi.fn()}
        onCancelRename={vi.fn()}
        onEditingZoneNameChange={vi.fn()}
        onSaveRename={vi.fn()}
      />,
    );

    expect(screen.getByTestId('zone-locked-ppe-edit-guidance').textContent).toContain(
      'Camera PPE policy',
    );
    await i18n.changeLanguage('vi');
    rerender(
      <ZonePpeList
        showZoneSection
        canManageZones
        scopedZones={[ZONE_RESTRICTED]}
        serverTotal={1}
        isPending={false}
        isFetching={false}
        isFetchingNextPage={false}
        hasNextPage={false}
        isInitialError={false}
        isAuthRevoked={false}
        isTransientNextPageError={false}
        isZonesSettledEmpty={false}
        editingZoneId={null}
        editingZoneName=""
        renameValidationError={null}
        renameServerError={null}
        renameSuccessFeedback={null}
        isRenamingZone={false}
        renameInputRef={{ current: null }}
        renameTriggerRefs={{ current: {} }}
        t={(key, params) => i18n.t(key, { ns: 'safety', ...params })}
        onRefetch={vi.fn()}
        onFetchNextPage={vi.fn()}
        onStartRename={vi.fn()}
        onCancelRename={vi.fn()}
        onEditingZoneNameChange={vi.fn()}
        onSaveRename={vi.fn()}
      />,
    );
    expect(screen.getByTestId('zone-locked-ppe-edit-guidance').textContent).toContain(
      'Chính sách PPE',
    );
  });
});
