// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import type { SharedSession } from '../../types/shared-session';
import { CameraSetupView } from './CameraSetupView';

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
const SITE_B_ID = '22222222-2222-4222-8222-222222222222';
const CAM_ACTIVE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAM_INACTIVE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ZONE_1_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const CAM_ACTIVE: CameraResponse = {
  id: CAM_ACTIVE_ID,
  siteId: SITE_ID,
  code: 'CAM-01',
  name: 'North Gate Camera',
  externalId: 'prov-north-01',
  status: 'ACTIVE',
  configurationVersion: 2,
  createdAt: '2026-03-01T00:00:00.000Z',
};

const CAM_INACTIVE: CameraResponse = {
  id: CAM_INACTIVE_ID,
  siteId: SITE_ID,
  code: 'CAM-02',
  name: 'South Storage Camera',
  externalId: 'prov-south-02',
  status: 'INACTIVE',
  configurationVersion: 1,
  createdAt: '2026-03-02T00:00:00.000Z',
};

function makeSession(onSignOut = vi.fn()): SharedSession {
  return {
    accessToken: 'token-mgr-1',
    sessionScope: 'scope-mgr-1',
    onSignOut,
    user: {
      id: 'mgr-1',
      displayName: 'Site Manager',
      mustChangePassword: false,
      roleAssignments: [
        { role: 'SITE_MANAGER', siteId: SITE_ID },
        { role: 'SITE_MANAGER', siteId: SITE_B_ID },
      ],
    },
  };
}

describe('CameraSetupView master-detail layout, inline primary preview/polygon stage, and technical ID disclosure', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');

    const nowIso = new Date().toISOString();
    mockUseManagementClient.mockReturnValue({
      listSites: vi.fn<SmartSiteManagementClient['listSites']>().mockResolvedValue({
        items: [
          {
            id: SITE_ID,
            code: 'SITE-A',
            name: 'Alpha Site',
            createdAt: '2026-03-01T00:00:00.000Z',
          },
          {
            id: SITE_B_ID,
            code: 'SITE-B',
            name: 'Beta Site',
            createdAt: '2026-03-02T00:00:00.000Z',
          },
        ],
        total: 2,
      } satisfies Page<SiteResponse>),
      listCameras: vi
        .fn<SmartSiteManagementClient['listCameras']>()
        .mockImplementation(async (_tok, targetSiteId) =>
          targetSiteId === SITE_ID
            ? ({ items: [CAM_ACTIVE, CAM_INACTIVE], total: 2 } satisfies Page<CameraResponse>)
            : ({ items: [], total: 0 } satisfies Page<CameraResponse>),
        ),
      getCamera: vi.fn<SmartSiteManagementClient['getCamera']>().mockResolvedValue(CAM_ACTIVE),
      getCameraApplicationStatus: vi
        .fn<SmartSiteManagementClient['getCameraApplicationStatus']>()
        .mockImplementation(async (_tok, siteId, cameraId) => ({
          siteId,
          cameraId,
          desiredRevision: cameraId === CAM_ACTIVE_ID ? 2 : 1,
          reportedRevision: cameraId === CAM_ACTIVE_ID ? 2 : null,
          applicationState: cameraId === CAM_ACTIVE_ID ? 'LOADED' : 'PENDING',
          viewValidity: cameraId === CAM_ACTIVE_ID ? 'UNCONFIRMED' : 'UNAVAILABLE',
          reasonCode: null,
          lastReceiptAt: cameraId === CAM_ACTIVE_ID ? nowIso : null,
          observedAt: nowIso,
        } satisfies CameraApplicationStatus)),
      listZones: vi.fn<SmartSiteManagementClient['listZones']>().mockResolvedValue({
        items: [
          {
            id: ZONE_1_ID,
            siteId: SITE_ID,
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
      getCameraConfigurationReference: vi
        .fn<SmartSiteManagementClient['getCameraConfigurationReference']>()
        .mockRejectedValue({ status: 404 }),
      readSavedPpePolicy: vi
        .fn<SmartSiteManagementClient['readSavedPpePolicy']>()
        .mockImplementation(async (_tok, _site, cameraId, regionId = null) => ({
          cameraId,
          regionId,
          configurationVersion: 2,
          savedRevision: 2,
          policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT', 'SAFETY_VEST'] },
        })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders master-detail source rail + detail pane, tucks technical Source IDs inside closed details, opens region/reference stage inline (not modal), and shows honest enable CTA for disabled cameras', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/camera-setup?siteId=${SITE_ID}`]}>
          <CameraSetupView apiUrl={API_URL} sharedSession={makeSession()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const sourceRail = await screen.findByTestId('camera-setup-source-rail');
    const detailPane = screen.getByTestId('camera-setup-detail-pane');
    expect(sourceRail).toBeTruthy();
    expect(detailPane).toBeTruthy();

    // Technical Source IDs live inside closed <details> so human camera names lead
    const selectedSourceId = screen.getByTestId('selected-camera-source-id');
    const selectedDetails = selectedSourceId.closest('details');
    expect(selectedDetails).not.toBeNull();
    expect(selectedDetails?.open).toBe(false);

    const rowSourceIds = screen.getAllByTestId('camera-row-source-id');
    expect(rowSourceIds.length).toBe(2);
    for (const rowSource of rowSourceIds) {
      const rowDetails = rowSource.closest('details');
      expect(rowDetails).not.toBeNull();
      expect(rowDetails?.open).toBe(false);
    }

    // Clicking Edit observation regions opens the reference/polygon workspace INLINE inside the primary stage (not a modal dialog)
    fireEvent.click(
      within(detailPane).getByRole('button', { name: 'Edit observation regions (CAM-01)' }),
    );
    const inlineStage = await screen.findByTestId('camera-setup-inline-region-stage');
    expect(inlineStage).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      await within(inlineStage).findByRole('button', { name: /Get configuration image/i }),
    ).toBeTruthy();

    // Selecting the disabled camera shows an honest disabled-source stage with clear Open Manage CTA
    fireEvent.click(within(sourceRail).getByRole('button', { name: 'Select CAM-02' }));
    const disabledStage = await screen.findByTestId('camera-setup-disabled-stage');
    expect(disabledStage).toBeTruthy();
    expect(screen.queryByTestId('camera-setup-inline-region-stage')).toBeNull();
    expect(
      within(detailPane).getByRole('button', { name: 'Open Manage to enable (CAM-02)' }),
    ).toBeTruthy();
  });

  it('guards unsaved polygon drafts inside the inline region stage before closing or switching cameras', async () => {
    const nowIso = new Date().toISOString();
    const expIso = new Date(Date.now() + 240_000).toISOString();
    const sha = 'b'.repeat(64);
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
      const currentMock = mockUseManagementClient();
      mockUseManagementClient.mockReturnValue({
        ...currentMock,
        getCameraConfigurationReference: vi.fn().mockResolvedValue({
          viewValidity: 'UNCONFIRMED',
          image: {
            schemaVersion: 1,
            purpose: 'REGION_CONFIGURATION',
            sourceKind: 'LIVE',
            siteId: SITE_ID,
            cameraId: CAM_ACTIVE_ID,
            configurationVersion: 2,
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
            cameraId: CAM_ACTIVE_ID,
            sessionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            imageSha256: sha,
            width: 640,
            height: 360,
            capturedAt: nowIso,
            issuedAt: nowIso,
            expiresAt: expIso,
            configurationVersion: 2,
            viewRevision: 1,
          },
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

      const sourceRail = await screen.findByTestId('camera-setup-source-rail');
      const detailPane = screen.getByTestId('camera-setup-detail-pane');

      fireEvent.click(
        within(detailPane).getByRole('button', { name: 'Edit observation regions (CAM-01)' }),
      );
      const inlineStage = await screen.findByTestId('camera-setup-inline-region-stage');

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
        target: { value: '0.2' },
      });
      fireEvent.change(within(inlineStage).getByLabelText('Point Y (0–1)'), {
        target: { value: '0.3' },
      });
      fireEvent.click(within(inlineStage).getByRole('button', { name: 'Add Point' }));

      // Attempting to switch camera with unsaved polygon point prompts discard confirmation instead of losing work
      fireEvent.click(within(sourceRail).getByRole('button', { name: 'Select CAM-02' }));
      expect(screen.getByTestId('camera-setup-inline-region-stage')).toBeTruthy();
      const keepBtn = await within(inlineStage).findByRole('button', { name: 'Keep editing' });
      fireEvent.click(keepBtn);
      expect(within(inlineStage).queryByRole('button', { name: 'Discard changes' })).toBeNull();

      // Confirming Discard changes switches to CAM-02 cleanly
      fireEvent.click(within(sourceRail).getByRole('button', { name: 'Select CAM-02' }));
      fireEvent.click(await within(inlineStage).findByRole('button', { name: 'Discard changes' }));
      expect(await screen.findByTestId('camera-setup-disabled-stage')).toBeTruthy();
      expect(screen.queryByTestId('camera-setup-inline-region-stage')).toBeNull();
    } finally {
      globalThis.Image = origImage;
    }
  });

  it('guards Register, Manage, Zone dialog triggers, top Site selector, and in-flight saving when inline draft has an unsaved point without weakening 401 revocation', async () => {
    const nowIso = new Date().toISOString();
    const expIso = new Date(Date.now() + 240_000).toISOString();
    const sha = 'b'.repeat(64);
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

    let rejectSave: ((err: unknown) => void) | undefined;

    try {
      const pendingSaveFn = vi.fn().mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectSave = reject;
          }),
      );
      const currentMock = mockUseManagementClient();
      mockUseManagementClient.mockReturnValue({
        ...currentMock,
        createReferenceRegion: pendingSaveFn,
        createPolicyReferenceRegion: pendingSaveFn,
        getCameraConfigurationReference: vi.fn().mockResolvedValue({
          viewValidity: 'UNCONFIRMED',
          image: {
            schemaVersion: 1,
            purpose: 'REGION_CONFIGURATION',
            sourceKind: 'LIVE',
            siteId: SITE_ID,
            cameraId: CAM_ACTIVE_ID,
            configurationVersion: 2,
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
            cameraId: CAM_ACTIVE_ID,
            sessionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            imageSha256: sha,
            width: 640,
            height: 360,
            capturedAt: nowIso,
            issuedAt: nowIso,
            expiresAt: expIso,
            configurationVersion: 2,
            viewRevision: 1,
          },
        }),
      });

      const onSignOut = vi.fn();
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[`/camera-setup?siteId=${SITE_ID}`]}>
            <CameraSetupView apiUrl={API_URL} sharedSession={makeSession(onSignOut)} />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      const detailPane = await screen.findByTestId('camera-setup-detail-pane');
      fireEvent.click(
        within(detailPane).getByRole('button', { name: 'Edit observation regions (CAM-01)' }),
      );
      const inlineStage = await screen.findByTestId('camera-setup-inline-region-stage');

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

      // Draw 1 unsaved point
      fireEvent.change(await within(inlineStage).findByLabelText('Point X (0–1)'), {
        target: { value: '0.25' },
      });
      fireEvent.change(within(inlineStage).getByLabelText('Point Y (0–1)'), {
        target: { value: '0.35' },
      });
      fireEvent.click(within(inlineStage).getByRole('button', { name: 'Add Point' }));
      expect(within(inlineStage).getByText(/Points:\s*1\s*\/\s*32/i)).toBeTruthy();

      // 1) Attempt Register camera -> blocked by inline discard confirmation; Keep editing preserves point
      fireEvent.click(screen.getByRole('button', { name: 'Register camera' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(within(inlineStage).getByText(/Points:\s*1\s*\/\s*32/i)).toBeTruthy();
      fireEvent.click(await within(inlineStage).findByRole('button', { name: 'Keep editing' }));
      expect(within(inlineStage).queryByRole('button', { name: 'Discard changes' })).toBeNull();
      expect(within(inlineStage).getByText(/Points:\s*1\s*\/\s*32/i)).toBeTruthy();

      // 2) Attempt Manage camera -> blocked by inline discard confirmation; Keep editing preserves point
      fireEvent.click(
        within(detailPane).getByRole('button', { name: 'Edit camera settings (CAM-01)' }),
      );
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(within(inlineStage).getByText(/Points:\s*1\s*\/\s*32/i)).toBeTruthy();
      fireEvent.click(await within(inlineStage).findByRole('button', { name: 'Keep editing' }));
      expect(within(inlineStage).getByText(/Points:\s*1\s*\/\s*32/i)).toBeTruthy();

      // 3) Attempt Configure PPE by Zone -> blocked by inline discard confirmation; Keep editing preserves point
      fireEvent.click(screen.getByRole('button', { name: 'Configure PPE by Zone' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.click(await within(inlineStage).findByRole('button', { name: 'Keep editing' }));
      expect(within(inlineStage).getByText(/Points:\s*1\s*\/\s*32/i)).toBeTruthy();

      // 4) Attempt top Site selector change -> retained on SITE_ID until explicit discard
      const siteSelect = screen.getByLabelText('Site', {
        selector: 'select#camera-setup-site',
      }) as HTMLSelectElement;
      fireEvent.change(siteSelect, { target: { value: SITE_B_ID } });
      expect(siteSelect.value).toBe(SITE_ID);
      expect(screen.getByTestId('camera-setup-inline-region-stage')).toBeTruthy();
      expect(within(inlineStage).getByText(/Points:\s*1\s*\/\s*32/i)).toBeTruthy();

      // Keep editing preserves Site A and the unsaved point
      fireEvent.click(await within(inlineStage).findByRole('button', { name: 'Keep editing' }));
      expect(siteSelect.value).toBe(SITE_ID);
      expect(within(inlineStage).getByText(/Points:\s*1\s*\/\s*32/i)).toBeTruthy();

      // 5) Complete 3 points and start Save Region -> while saving, Site/Register exits are blocked; 401 still revokes immediately
      for (const [x, y] of [
        ['0.65', '0.35'],
        ['0.45', '0.75'],
      ] as const) {
        fireEvent.change(within(inlineStage).getByLabelText('Point X (0–1)'), {
          target: { value: x },
        });
        fireEvent.change(within(inlineStage).getByLabelText('Point Y (0–1)'), {
          target: { value: y },
        });
        fireEvent.click(within(inlineStage).getByRole('button', { name: 'Add Point' }));
      }
      fireEvent.change(within(inlineStage).getByLabelText('Policy mode'), {
        target: { value: 'INHERIT' },
      });
      fireEvent.click(
        within(within(inlineStage).getByTestId('region-reference-view-consent')).getByRole(
          'checkbox',
        ),
      );
      const saveBtn = within(inlineStage).getByRole('button', {
        name: 'Save Region',
      }) as HTMLButtonElement;
      await waitFor(() => expect(saveBtn.disabled).toBe(false));
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(rejectSave).toBeTypeOf('function');
      });

      // While saving is in flight, clicking Register camera or changing Site does not open a modal or switch site
      fireEvent.click(screen.getByRole('button', { name: 'Register camera' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.change(siteSelect, { target: { value: SITE_B_ID } });
      expect(siteSelect.value).toBe(SITE_ID);

      // 401 unauthorized response still revokes session immediately despite dirty draft
      rejectSave?.(new ApiError('http', 'Unauthorized', 401));
      await waitFor(() => {
        expect(onSignOut).toHaveBeenCalledTimes(1);
      });
    } finally {
      globalThis.Image = origImage;
    }
  });

  it('switches site or opens Manage dialog only after explicit Discard changes on a dirty inline draft', async () => {
    const nowIso = new Date().toISOString();
    const expIso = new Date(Date.now() + 240_000).toISOString();
    const sha = 'b'.repeat(64);
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
      const currentMock = mockUseManagementClient();
      mockUseManagementClient.mockReturnValue({
        ...currentMock,
        getCameraConfigurationReference: vi.fn().mockResolvedValue({
          viewValidity: 'UNCONFIRMED',
          image: {
            schemaVersion: 1,
            purpose: 'REGION_CONFIGURATION',
            sourceKind: 'LIVE',
            siteId: SITE_ID,
            cameraId: CAM_ACTIVE_ID,
            configurationVersion: 2,
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
            cameraId: CAM_ACTIVE_ID,
            sessionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            imageSha256: sha,
            width: 640,
            height: 360,
            capturedAt: nowIso,
            issuedAt: nowIso,
            expiresAt: expIso,
            configurationVersion: 2,
            viewRevision: 1,
          },
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

      const detailPane = await screen.findByTestId('camera-setup-detail-pane');
      fireEvent.click(
        within(detailPane).getByRole('button', { name: 'Edit observation regions (CAM-01)' }),
      );
      const inlineStage = await screen.findByTestId('camera-setup-inline-region-stage');

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

      // Attempt Manage -> confirm Discard changes -> Manage dialog opens
      fireEvent.click(
        within(detailPane).getByRole('button', { name: 'Edit camera settings (CAM-01)' }),
      );
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.click(await within(inlineStage).findByRole('button', { name: 'Discard changes' }));
      const manageDialog = await screen.findByRole('dialog');
      expect(manageDialog).toBeTruthy();
      expect(screen.queryByTestId('camera-setup-inline-region-stage')).toBeNull();
      fireEvent.click(within(manageDialog).getByRole('button', { name: /Close/i }));

      // Reopen inline regions, draw 1 point, attempt Site change -> confirm Discard changes -> switches to SITE_B_ID
      fireEvent.click(
        within(screen.getByTestId('camera-setup-detail-pane')).getByRole('button', {
          name: 'Edit observation regions (CAM-01)',
        }),
      );
      const inlineStage2 = await screen.findByTestId('camera-setup-inline-region-stage');
      const getRefBtn2 = await within(inlineStage2).findByRole('button', {
        name: 'Get configuration image',
      });
      await waitFor(() => expect((getRefBtn2 as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(getRefBtn2);
      const startDrawBtn2 = await within(inlineStage2).findByRole('button', {
        name: 'Start Drawing Region',
      });
      await waitFor(() => expect((startDrawBtn2 as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(startDrawBtn2);
      fireEvent.change(await within(inlineStage2).findByLabelText('Point X (0–1)'), {
        target: { value: '0.3' },
      });
      fireEvent.change(within(inlineStage2).getByLabelText('Point Y (0–1)'), {
        target: { value: '0.4' },
      });
      fireEvent.click(within(inlineStage2).getByRole('button', { name: 'Add Point' }));

      const siteSelect = screen.getByLabelText('Site', {
        selector: 'select#camera-setup-site',
      }) as HTMLSelectElement;
      fireEvent.change(siteSelect, { target: { value: SITE_B_ID } });
      expect(siteSelect.value).toBe(SITE_ID);
      fireEvent.click(
        await within(inlineStage2).findByRole('button', { name: 'Discard changes' }),
      );
      await waitFor(() => {
        expect(siteSelect.value).toBe(SITE_B_ID);
      });
      expect(screen.queryByTestId('camera-setup-inline-region-stage')).toBeNull();
    } finally {
      globalThis.Image = origImage;
    }
  });
});
