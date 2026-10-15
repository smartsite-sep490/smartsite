// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  CONFIGURATION_REFERENCE_LIFETIME_MS,
  SmartSiteManagementClient,
  type Page,
  type ZoneResponse,
} from '@smartsite/api-client';
import type { CameraResponse, RegionResponse } from '@smartsite/contracts';
import { LocaleProvider, useLocale } from '../../i18n/locale';
import type {
  CameraConfigurationReference,
  UseCameraConfigurationReferenceOptions,
  UseCameraConfigurationReferenceResult,
} from './useCameraConfigurationReference';
import { ZonePpeCameraRegionPanel } from './ZonePpeCameraRegionPanel';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof SVGElement !== 'undefined') {
  SVGElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 640,
    height: 480,
    right: 640,
    bottom: 480,
  });
}

const refState = vi.hoisted(() => ({
  reference: null as CameraConfigurationReference | null,
  isLoading: false,
  error: null as ApiError | null,
  lastOptions: null as UseCameraConfigurationReferenceOptions | null,
  requestImpl: null as (() => Promise<void>) | null,
  requestSpy: vi.fn<() => Promise<void>>(),
}));

vi.mock('./useCameraConfigurationReference', () => ({
  useCameraConfigurationReference: (
    options: UseCameraConfigurationReferenceOptions,
  ): UseCameraConfigurationReferenceResult => {
    refState.lastOptions = options;
    return {
      reference: options.enabled ? refState.reference : null,
      isLoading: refState.isLoading,
      error: refState.error,
      request: refState.requestSpy,
    };
  },
}));

function LocaleToggle() {
  const { locale, setLocale } = useLocale();
  return (
    <div>
      <span data-testid="active-locale">{locale}</span>
      <button type="button" onClick={() => setLocale('vi')}>
        switch-vi
      </button>
      <button type="button" onClick={() => setLocale('en')}>
        switch-en
      </button>
    </div>
  );
}

function mockConfigurationReference(
  overrides: Partial<Omit<CameraConfigurationReference, 'frame' | 'image'>> = {},
  frameOverrides: Partial<CameraConfigurationReference['frame']> = {},
): CameraConfigurationReference {
  const nowMs = Date.now();
  const capturedAt = frameOverrides.capturedAt ?? new Date(nowMs).toISOString();
  const capturedMs = Date.parse(capturedAt);
  const referenceExpiresAt =
    overrides.referenceExpiresAt ??
    new Date(
      (Number.isFinite(capturedMs) ? capturedMs : nowMs) + CONFIGURATION_REFERENCE_LIFETIME_MS,
    ).toISOString();
  return {
    schemaVersion: 1,
    purpose: 'REGION_CONFIGURATION',
    siteId: 'site-alpha',
    cameraId: 'cam-1',
    configurationVersion: 3,
    sourceKind: 'LIVE',
    referenceExpiresAt,
    ...overrides,
    frame: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      sequenceNumber: '1',
      cameraExternalId: 'CAM-EXT-01',
      capturedAt,
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      imageSha256: 'a'.repeat(64),
      ...frameOverrides,
    },
    image: {} as HTMLImageElement,
  };
}

const mockZones: ZoneResponse[] = [
  {
    id: 'zone-1',
    siteId: 'site-alpha',
    code: 'ZONE-A1',
    name: 'Khu vực giàn giáo A1',
    type: 'HAZARDOUS',
    restrictionPolicy: 'NONE',
    requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
    configurationLocked: false,
    createdAt: '2026-10-07T00:00:00Z',
  },
  {
    id: 'zone-2',
    siteId: 'site-alpha',
    code: 'ZONE-A2',
    name: 'Khu vực cẩu tháp A2',
    type: 'HAZARDOUS',
    restrictionPolicy: 'NONE',
    requiredPpe: ['HARD_HAT'],
    configurationLocked: false,
    createdAt: '2026-10-07T00:00:00Z',
  },
];

const mockCamerasPage: Page<CameraResponse> = {
  items: [
    {
      id: 'cam-1',
      siteId: 'site-alpha',
      externalId: 'CAM-EXT-01',
      code: 'CAM-01',
      name: 'Camera Giàn giáo 01',
      status: 'ACTIVE',
      configurationVersion: 3,
      createdAt: '2026-09-30T00:00:00Z',
    },
    {
      id: 'cam-2',
      siteId: 'site-alpha',
      externalId: 'CAM-EXT-02',
      code: 'CAM-02',
      name: 'Camera Cẩu tháp 02',
      status: 'ACTIVE',
      configurationVersion: 5,
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 25,
};

const mockRegionsPage: Page<RegionResponse> = {
  items: [
    {
      id: 'reg-1',
      cameraId: 'cam-1',
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
      version: 2,
      isActive: true,
      createdAt: '2026-10-07T00:00:00Z',
    },
  ],
  total: 22,
};

describe('ZonePpeCameraRegionPanel localization (vi/en)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    window.localStorage.clear();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    refState.reference = mockConfigurationReference();
    refState.isLoading = false;
    refState.error = null;
    refState.lastOptions = null;
    refState.requestImpl = null;
    refState.requestSpy = vi.fn(async () => {
      await refState.requestImpl?.();
    });

    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue(mockCamerasPage);
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockResolvedValue(
      mockCamerasPage.items[0]!,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue(mockRegionsPage);
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    window.localStorage.clear();
    refState.reference = null;
    refState.isLoading = false;
    refState.error = null;
    refState.lastOptions = null;
    refState.requestImpl = null;
  });

  it('renders selectors, linked region metadata, and Load more controls in Vietnamese and switches to English while preserving selected IDs and raw enums without refetching', async () => {
    const user = userEvent.setup();
    const listCamerasSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras');
    const listRegionsSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions');

    render(
      <LocaleProvider defaultLocale="vi">
        <QueryClientProvider client={queryClient}>
          <LocaleToggle />
          <ZonePpeCameraRegionPanel
            apiUrl="http://localhost:3000"
            token="mock-token-xyz"
            sessionScope="scope-01"
            credentialId={1}
            siteId="site-alpha"
            zones={mockZones}
          />
        </QueryClientProvider>
      </LocaleProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Liên kết Khu vực với Vùng quan sát Camera' }),
    ).toBeDefined();
    expect(
      await screen.findByText('Các vùng quan sát hiện có của Camera & Khu vực này'),
    ).toBeDefined();
    expect(await screen.findByText('reg-1')).toBeDefined();
    expect(screen.getByText('Phiên bản 2 · Đang hoạt động')).toBeDefined();
    // Raw coordinateSpace enum must remain untranslated
    expect(screen.getByText('NORMALIZED_0_1')).toBeDefined();

    // Load more buttons rendered in Vietnamese when total > loaded
    expect(screen.getByRole('button', { name: 'Tải thêm camera' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Tải thêm vùng quan sát' })).toBeDefined();

    // Select second zone and verify selection is retained across locale switch
    const zoneSelect = screen.getByLabelText('Chọn Khu vực') as HTMLSelectElement;
    await user.selectOptions(zoneSelect, 'zone-2');
    expect(zoneSelect.value).toBe('zone-2');

    const cameraCallsBeforeSwitch = listCamerasSpy.mock.calls.length;
    const regionCallsBeforeSwitch = listRegionsSpy.mock.calls.length;

    fireEvent.click(screen.getByText('switch-en'));

    expect(
      await screen.findByRole('heading', { name: 'Link Zone to Camera Region' }),
    ).toBeDefined();
    expect(screen.getByText('Existing Regions for this Camera & Zone')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Load more cameras' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Load more regions' })).toBeDefined();
    expect((screen.getByLabelText('Select Zone') as HTMLSelectElement).value).toBe('zone-2');
    expect((screen.getByLabelText('Select Camera') as HTMLSelectElement).value).toBe('cam-1');
    expect(listCamerasSpy).toHaveBeenCalledTimes(cameraCallsBeforeSwitch);
    expect(listRegionsSpy).toHaveBeenCalledTimes(regionCallsBeforeSwitch);
  });

  it('localizes explicit configuration reference controls, missing-reference hints, and unavailable/invalid reference errors across vi and en while AI is paused without preview/AI calls', async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    const user = userEvent.setup();
    refState.reference = null;

    const previewSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview');
    const streamSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'streamCameraVideo');
    const recordSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'readRecordedCameraVideo');
    const demoStatusSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'getMf05DemoStatus');
    const demoApplySpy = vi.spyOn(SmartSiteManagementClient.prototype, 'applyMf05DemoRegion');

    const { unmount } = render(
      <LocaleProvider defaultLocale="vi">
        <QueryClientProvider client={queryClient}>
          <LocaleToggle />
          <ZonePpeCameraRegionPanel
            apiUrl="http://localhost:3000"
            token="mock-token-xyz"
            sessionScope="scope-01"
            credentialId={1}
            siteId="site-alpha"
            zones={mockZones}
          />
        </QueryClientProvider>
      </LocaleProvider>,
    );

    const startBtnVi = await screen.findByRole('button', { name: 'Bắt đầu vẽ vùng quan sát' });
    await waitFor(() => {
      expect(refState.lastOptions).toEqual({
        apiUrl: 'http://localhost:3000',
        token: 'mock-token-xyz',
        sessionScope: 'scope-01',
        credentialId: 1,
        siteId: 'site-alpha',
        cameraId: 'cam-1',
        cameraExternalId: 'CAM-EXT-01',
        enabled: true,
      });
    });
    expect(refState.requestSpy).not.toHaveBeenCalled();
    expect((startBtnVi as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Ảnh tham chiếu cấu hình vùng quan sát')).toBeDefined();
    expect(
      screen.getByText(
        'Hãy lấy ảnh cấu hình cho camera đang hoạt động đã chọn trước khi vẽ hoặc sửa vùng quan sát.',
      ),
    ).toBeDefined();
    const getRefBtnVi = screen.getByRole('button', { name: 'Lấy ảnh cấu hình' });
    expect((getRefBtnVi as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByText('switch-en'));

    expect(await screen.findByText('Authoring Reference Image')).toBeDefined();
    expect(
      screen.getByText(
        'Request a configuration image for the selected active camera before drawing or editing a region.',
      ),
    ).toBeDefined();
    const getRefBtnEn = screen.getByRole('button', { name: 'Get configuration image' });
    expect((getRefBtnEn as HTMLButtonElement).disabled).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'Start Drawing Region' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await user.click(getRefBtnEn);
    expect(refState.requestSpy).toHaveBeenCalledTimes(1);
    expect(previewSpy).not.toHaveBeenCalled();
    expect(streamSpy).not.toHaveBeenCalled();
    expect(recordSpy).not.toHaveBeenCalled();
    expect(demoStatusSpy).not.toHaveBeenCalled();
    expect(demoApplySpy).not.toHaveBeenCalled();
    unmount();
    window.localStorage.clear();

    // Verify unavailable (503) and invalid-response configuration reference error copy across vi and en
    vi.unstubAllEnvs();
    refState.reference = null;
    refState.error = new ApiError('http', 'raw-503-source-diag', 503);

    const { unmount: unmountUnavailable } = render(
      <LocaleProvider defaultLocale="vi">
        <QueryClientProvider client={queryClient}>
          <LocaleToggle />
          <ZonePpeCameraRegionPanel
            apiUrl="http://localhost:3000"
            token="mock-token-xyz"
            sessionScope="scope-01"
            credentialId={1}
            siteId="site-alpha"
            zones={mockZones}
          />
        </QueryClientProvider>
      </LocaleProvider>,
    );

    expect(
      await screen.findByText(
        'Nguồn ảnh cấu hình camera hiện không khả dụng. Hãy kiểm tra tiến trình thu hình và thử lại.',
      ),
    ).toBeDefined();
    expect(screen.queryByText('raw-503-source-diag')).toBeNull();
    fireEvent.click(screen.getByText('switch-en'));
    expect(
      await screen.findByText(
        'Camera configuration image source is currently unavailable. Verify that the capture observer is active and try again.',
      ),
    ).toBeDefined();
    unmountUnavailable();
    window.localStorage.clear();

    refState.reference = null;
    refState.error = new ApiError('invalid-response', 'raw-external-id-mismatch-diag');

    render(
      <LocaleProvider defaultLocale="vi">
        <QueryClientProvider client={queryClient}>
          <LocaleToggle />
          <ZonePpeCameraRegionPanel
            apiUrl="http://localhost:3000"
            token="mock-token-xyz"
            sessionScope="scope-01"
            credentialId={1}
            siteId="site-alpha"
            zones={mockZones}
          />
        </QueryClientProvider>
      </LocaleProvider>,
    );

    expect(
      await screen.findByText('Không thể tải ảnh cấu hình camera. Vui lòng thử lại.'),
    ).toBeDefined();
    expect(screen.queryByText('raw-external-id-mismatch-diag')).toBeNull();
    fireEvent.click(screen.getByText('switch-en'));
    expect(
      await screen.findByText('Could not load camera configuration image. Please try again.'),
    ).toBeDefined();
  });

  it('retains open polygon draft points and re-translates validation and saved feedback across vi/en switches with unchanged mutation payload', async () => {
    const user = userEvent.setup();
    const listCamerasSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras');
    const createRegionSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createRegion')
      .mockResolvedValueOnce({
        region: {
          id: 'reg-vi-99',
          cameraId: 'cam-1',
          zoneId: 'zone-1',
          polygon: {
            coordinates: [
              [0.1, 0.1],
              [0.8, 0.1],
              [0.8, 0.8],
            ],
          },
          coordinateSpace: 'NORMALIZED_0_1',
          version: 1,
          isActive: true,
          createdAt: '2026-10-14T07:00:00Z',
        },
        configurationVersion: 4,
      });

    render(
      <LocaleProvider defaultLocale="vi">
        <QueryClientProvider client={queryClient}>
          <LocaleToggle />
          <ZonePpeCameraRegionPanel
            apiUrl="http://localhost:3000"
            token="mock-token-xyz"
            sessionScope="scope-01"
            credentialId={1}
            siteId="site-alpha"
            zones={mockZones}
          />
        </QueryClientProvider>
      </LocaleProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Bắt đầu vẽ vùng quan sát' }));
    const canvas = screen.getByLabelText('Khung vẽ vùng quan sát camera');

    // Out-of-bounds click rejected in Vietnamese
    fireEvent.click(canvas, { clientX: -15, clientY: 100 });
    expect(await screen.findByText('Tọa độ vừa chọn nằm ngoài khung hình camera.')).toBeDefined();
    expect(screen.getByText('Số điểm: 0 / 32')).toBeDefined();

    // Add 3 collinear points -> degenerate zero area error
    fireEvent.click(canvas, { clientX: 64, clientY: 48 });
    fireEvent.click(canvas, { clientX: 512, clientY: 48 });
    fireEvent.click(canvas, { clientX: 320, clientY: 48 });
    expect(screen.getByText('Số điểm: 3 / 32')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Lưu vùng quan sát' }));
    expect(
      await screen.findByText('Diện tích đa giác không được bằng 0 hoặc suy biến.'),
    ).toBeDefined();

    // Switch to English: draft points and active validation error re-translate in place
    const cameraCallsBefore = listCamerasSpy.mock.calls.length;
    fireEvent.click(screen.getByText('switch-en'));

    expect(await screen.findByText('Polygon area must not be zero or degenerate.')).toBeDefined();
    expect(screen.getByText('Points: 3 / 32')).toBeDefined();
    expect(listCamerasSpy).toHaveBeenCalledTimes(cameraCallsBefore);
    expect(createRegionSpy).not.toHaveBeenCalled();

    // Undo collinear 3rd point, add valid 3rd point (512, 384) -> [0.8, 0.8], switch back to Vietnamese and save
    await user.click(screen.getByRole('button', { name: 'Undo Point' }));
    fireEvent.click(screen.getByLabelText('Camera Region Drawing Canvas'), {
      clientX: 512,
      clientY: 384,
    });
    fireEvent.click(screen.getByText('switch-vi'));

    const saveBtnVi = await screen.findByRole('button', { name: 'Lưu vùng quan sát' });
    await user.click(saveBtnVi);

    expect(createRegionSpy).toHaveBeenCalledTimes(1);
    expect(createRegionSpy).toHaveBeenCalledWith(
      'mock-token-xyz',
      'site-alpha',
      'cam-1',
      {
        zoneId: 'zone-1',
        polygon: {
          coordinates: [
            [0.1, 0.1],
            [0.8, 0.1],
            [0.8, 0.8],
          ],
        },
        expectedConfigurationVersion: 3,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    expect(
      await screen.findByText(
        'Đã lưu vùng quan sát "reg-vi-99" (v1). Hãy chọn vùng này cho tiến trình AI và áp dụng/khởi động lại trước khi sử dụng trong giám sát.',
      ),
    ).toBeDefined();

    // Switch to English: saved feedback re-translates in place with original region ID and version
    fireEvent.click(screen.getByText('switch-en'));
    expect(
      await screen.findByText(
        'Saved region "reg-vi-99" (v1). Select this region for the AI worker and apply/restart it before monitoring uses it.',
      ),
    ).toBeDefined();
    expect(createRegionSpy).toHaveBeenCalledTimes(1);
  });

  it('re-translates 409 version conflict across vi and en while preserving polygon draft without automatic POST retry', async () => {
    const user = userEvent.setup();
    const createRegionSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createRegion')
      .mockRejectedValueOnce(new ApiError('http', 'raw-conflict-409-diag', 409));

    render(
      <LocaleProvider defaultLocale="vi">
        <QueryClientProvider client={queryClient}>
          <LocaleToggle />
          <ZonePpeCameraRegionPanel
            apiUrl="http://localhost:3000"
            token="mock-token-xyz"
            sessionScope="scope-01"
            credentialId={1}
            siteId="site-alpha"
            zones={mockZones}
          />
        </QueryClientProvider>
      </LocaleProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Bắt đầu vẽ vùng quan sát' }));
    const canvas = screen.getByLabelText('Khung vẽ vùng quan sát camera');
    fireEvent.click(canvas, { clientX: 64, clientY: 48 });
    fireEvent.click(canvas, { clientX: 512, clientY: 48 });
    fireEvent.click(canvas, { clientX: 512, clientY: 384 });

    await user.click(screen.getByRole('button', { name: 'Lưu vùng quan sát' }));

    expect(
      await screen.findByText(
        'Xung đột phiên bản cấu hình. Cấu hình camera đã được người vận hành khác cập nhật. Vui lòng kiểm tra và lưu lại.',
      ),
    ).toBeDefined();
    expect(screen.queryByText('raw-conflict-409-diag')).toBeNull();
    expect(createRegionSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('switch-en'));
    expect(
      await screen.findByText(
        'Configuration version conflict. Camera configuration was updated by another operator. Please review and try saving again.',
      ),
    ).toBeDefined();
    expect(screen.getByText('Points: 3 / 32')).toBeDefined();
    expect(createRegionSpy).toHaveBeenCalledTimes(1);
  });

  it('renders neutral localized 403 permission denial for camera list, region list, and region save without role overclaims or raw diagnostics', async () => {
    const user = userEvent.setup();
    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras')
      .mockRejectedValueOnce(new ApiError('http', 'raw-camera-403-trace', 403))
      .mockResolvedValue(mockCamerasPage);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions')
      .mockRejectedValueOnce(new ApiError('http', 'raw-region-403-trace', 403))
      .mockResolvedValue(mockRegionsPage);
    vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion').mockRejectedValue(
      new ApiError('http', 'raw-save-region-403-trace', 403),
    );

    const { unmount } = render(
      <LocaleProvider defaultLocale="vi">
        <QueryClientProvider client={queryClient}>
          <LocaleToggle />
          <ZonePpeCameraRegionPanel
            apiUrl="http://localhost:3000"
            token="mock-token-xyz"
            sessionScope="scope-01"
            credentialId={1}
            siteId="site-alpha"
            zones={mockZones}
          />
        </QueryClientProvider>
      </LocaleProvider>,
    );

    // 1. Camera list 403 in VI & EN
    expect(await screen.findByText('Bạn không có quyền xem các camera này.')).toBeDefined();
    expect(screen.queryByText('raw-camera-403-trace')).toBeNull();

    fireEvent.click(screen.getByText('switch-en'));
    expect(
      await screen.findByText('You do not have permission to view these cameras.'),
    ).toBeDefined();
    unmount();
    window.localStorage.clear();

    // 2. Region list 403 and Save 403 in VI & EN
    render(
      <LocaleProvider defaultLocale="vi">
        <QueryClientProvider client={queryClient}>
          <LocaleToggle />
          <ZonePpeCameraRegionPanel
            apiUrl="http://localhost:3000"
            token="mock-token-2"
            sessionScope="scope-02"
            credentialId={2}
            siteId="site-alpha"
            zones={mockZones}
          />
        </QueryClientProvider>
      </LocaleProvider>,
    );

    expect(await screen.findByText('Bạn không có quyền xem các vùng quan sát này.')).toBeDefined();
    expect(screen.queryByText('raw-region-403-trace')).toBeNull();

    // Retry regions so listRegions succeeds and drawing is enabled
    await user.click(screen.getByRole('button', { name: 'Thử tải lại vùng quan sát' }));
    await screen.findByText('reg-1');

    await user.click(screen.getByRole('button', { name: 'Bắt đầu vẽ vùng quan sát' }));
    const canvas = screen.getByLabelText('Khung vẽ vùng quan sát camera');
    fireEvent.click(canvas, { clientX: 64, clientY: 48 });
    fireEvent.click(canvas, { clientX: 512, clientY: 48 });
    fireEvent.click(canvas, { clientX: 512, clientY: 384 });

    await user.click(screen.getByRole('button', { name: 'Lưu vùng quan sát' }));

    expect(await screen.findByText('Bạn không có quyền thực hiện thao tác này.')).toBeDefined();
    expect(screen.queryByText('raw-save-region-403-trace')).toBeNull();
    expect(screen.queryByText(/Global Administrator/i)).toBeNull();

    fireEvent.click(screen.getByText('switch-en'));
    expect(
      await screen.findByText('You do not have permission to perform this action.'),
    ).toBeDefined();
    expect(screen.queryByText(/Global Administrator/i)).toBeNull();
  });
});
