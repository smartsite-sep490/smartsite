// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraObservationZones } from '@smartsite/contracts';
import type { CameraResponse } from '@smartsite/contracts/management';
import { LocaleProvider } from '../../i18n/LocaleProvider';
import i18n from '../../i18n/index';
import { FourSourceWall, type FourSourceWallProps } from './FourSourceWall';

const previewCalls: Array<{ cameraId: string; siteId: string; enabled: boolean }> = [];

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: (opts: { cameraId: string; siteId: string; enabled: boolean }) => {
    previewCalls.push(opts);
    return {
      preview: null,
      status: 'UNAVAILABLE' as const,
      sourceKind: null,
      error: 'Camera snapshot offline',
      errorStatus: null,
      isError: true,
      isLoading: false,
      isPolling: false,
      retry: vi.fn(),
      cameraExternalId: opts.cameraId,
      capturedAt: null,
      siteId: opts.siteId,
      cameraId: opts.cameraId,
    };
  },
}));

const SITE_ALPHA_ID = '11111111-1111-4111-8111-111111111111';
const SITE_BETA_ID = '22222222-2222-4222-8222-222222222222';
const CAM_1_ID = 'aaaa1111-1111-4111-8111-111111111111';
const CAM_2_ID = 'aaaa2222-2222-4222-8222-222222222222';
const ZONE_1_ID = 'bbbb1111-1111-4111-8111-111111111111';
const ZONE_2_ID = 'bbbb2222-2222-4222-8222-222222222222';
const ZONE_3_ID = 'bbbb3333-3333-4333-8333-333333333333';

const zoneItem = (id: string, code: string, name: string) => ({ id, code, name });

function makeCamera(overrides: Partial<CameraResponse> = {}): CameraResponse {
  return {
    id: CAM_1_ID,
    siteId: SITE_ALPHA_ID,
    externalId: 'rtsp://admin:supersecret@10.0.0.55:554/stream-07',
    code: 'CAM-07',
    name: 'Camera Cổng Phụ Bắc',
    status: 'ACTIVE',
    configurationVersion: 3,
    createdAt: '2026-10-15T00:00:00.000Z',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeZonesResponse(
  overrides: Partial<CameraObservationZones> = {},
): CameraObservationZones {
  const items = overrides.items ?? [];
  return {
    siteId: SITE_ALPHA_ID,
    cameraId: CAM_1_ID,
    configurationVersion: 3,
    items,
    total: overrides.total ?? items.length,
    unresolvedRegionCount: 0,
    ...overrides,
  };
}

const clickLoadMoreZones = (tile: HTMLElement) =>
  fireEvent.click(within(tile).getByRole('button', { name: /Tải thêm khu vực|Load more zones/i }));

function expectZoneCallAtOffset(spy: unknown, offset: number) {
  expect(spy).toHaveBeenLastCalledWith(
    'token-alpha-1',
    SITE_ALPHA_ID,
    CAM_1_ID,
    expect.objectContaining({ offset }),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
}

type WallContextOverrides = Partial<FourSourceWallProps> & {
  siteCode?: string;
  siteName?: string;
  configurationVersion?: number;
  cameraOverrides?: Partial<CameraResponse>;
  locale?: 'vi' | 'en';
};

describe('FourSourceWall Site/Camera/Zone Context (P0)', () => {
  let queryClient: QueryClient;
  let client: SmartSiteManagementClient;

  it('explains an intentional pause without an offline error or a dead retry action', async () => {
    render(buildWallTree({ locale: 'en', isAiWorkPaused: true }));
    await screen.findByText('Camera preview paused');
    expect(screen.getByTestId(`wall-source-badge-${CAM_1_ID}`).textContent).toBe('AI WORK PAUSED');
    expect(screen.queryByText('Snapshot Unavailable')).toBeNull();
    expect(screen.queryByText('No Person detections')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByTestId(`focus-btn-${CAM_1_ID}`).textContent).toBe('Selected');
    expect(previewCalls.every((call) => call.enabled === false)).toBe(true);
  });

  it.each([
    ['en', 'Enlarge camera', 'Evidence'],
    ['vi', 'Phóng to camera', 'Bằng chứng'],
  ] as const)(
    'identifies each camera action in the %s accessible button list',
    async (locale, enlargeLabel, evidenceLabel) => {
      const onEnlargeCamera = vi.fn();
      const onOpenEvidence = vi.fn();
      vi.spyOn(client, 'getCameraObservationZones').mockImplementation(
        async (_token, _siteId, cameraId) => makeZonesResponse({ cameraId }),
      );
      const cameras = [
        makeCamera({ name: 'North gate' }),
        makeCamera({ id: CAM_2_ID, name: 'North gate', code: 'CAM-08' }),
        makeCamera({ id: 'aaaa3333-3333-4333-8333-333333333333', name: '', code: 'CAM-09' }),
      ];
      render(
        buildWallTree({ locale, cameras, onEnlargeCamera, onOpenEvidence, isAiWorkPaused: true }),
      );

      for (const camera of cameras) {
        const name = camera.name ? `${camera.name} (${camera.code})` : camera.code;
        fireEvent.click(screen.getByRole('button', { name: `${enlargeLabel}: ${name}` }));
        expect(onEnlargeCamera).toHaveBeenLastCalledWith(camera.id);
        const evidence = screen.getByRole('button', { name: `${evidenceLabel}: ${name}` });
        expect(evidence.getAttribute('aria-haspopup')).toBe('dialog');
        fireEvent.click(evidence);
        expect(onOpenEvidence).toHaveBeenLastCalledWith(camera.id);
      }
    },
  );

  function buildWallTree({
    configurationVersion = 3,
    cameraOverrides,
    locale = 'vi',
    ...overrides
  }: WallContextOverrides = {}) {
    const camera = makeCamera({ configurationVersion, ...cameraOverrides });
    return (
      <LocaleProvider defaultLocale={locale}>
        <QueryClientProvider client={queryClient}>
          <FourSourceWall
            apiUrl="http://localhost:3000"
            client={client}
            token="token-alpha-1"
            sessionScope="scope-alpha"
            credentialId={1}
            siteId={camera.siteId}
            siteCode="SITE-A"
            siteName="Công trường Alpha"
            selectedCameraId={camera.id}
            onSelectCamera={vi.fn()}
            cameras={[camera]}
            enabled={true}
            showModelObjects={false}
            {...overrides}
          />
        </QueryClientProvider>
      </LocaleProvider>
    );
  }

  beforeEach(async () => {
    await i18n.changeLanguage('vi');
    localStorage.clear();
    previewCalls.length = 0;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    client = new SmartSiteManagementClient('http://localhost:3000');
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('renders selected Site name/code, true Camera code/name, and linked Zone from getCameraObservationZones instead of resolveCameraAndWorkArea guesses', async () => {
    const getZonesSpy = vi.spyOn(client, 'getCameraObservationZones').mockResolvedValue(
      makeZonesResponse({
        items: [zoneItem(ZONE_1_ID, 'ZONE-EXC-01', 'Hố đào sâu phía Bắc')],
      }),
    );

    render(buildWallTree());

    const tile = await screen.findByTestId(`wall-tile-${CAM_1_ID}`);
    await waitFor(() => {
      expectZoneCallAtOffset(getZonesSpy, 0);
      expect(tile.textContent).toContain('Hố đào sâu phía Bắc');
    });

    expect(tile.textContent).toContain('SITE-A');
    expect(tile.textContent).toContain('Công trường Alpha');
    expect(tile.textContent).toContain('CAM-07');
    expect(tile.textContent).toContain('Camera Cổng Phụ Bắc');
    expect(tile.textContent).toContain('ZONE-EXC-01');
    expect(tile.textContent).not.toContain('Khu vực hoàn thiện mặt ngoài');
    expect(tile.textContent).not.toContain('Active Monitoring Zone');
  });

  it('distinguishes real zero (total=0, unresolvedRegionCount=0) from loading, HTTP error (503/403), partial page failure, and unresolved region bindings', async () => {
    const pendingZero = deferred<CameraObservationZones>();
    const getZonesSpy = vi
      .spyOn(client, 'getCameraObservationZones')
      .mockImplementationOnce(() => pendingZero.promise);

    const { rerender } = render(buildWallTree({ configurationVersion: 1 }));

    const tile = await screen.findByTestId(`wall-tile-${CAM_1_ID}`);
    expect(tile.textContent).toMatch(/Đang tải khu vực|Loading zones/i);
    expect(tile.textContent).not.toMatch(/Chưa gắn khu vực|No zones linked/i);

    pendingZero.resolve(makeZonesResponse({ configurationVersion: 1 }));
    await waitFor(() => {
      expect(tile.textContent).toMatch(/Chưa gắn khu vực|No zones linked/i);
    });

    getZonesSpy.mockResolvedValueOnce(
      makeZonesResponse({ configurationVersion: 2, unresolvedRegionCount: 2 }),
    );
    rerender(buildWallTree({ configurationVersion: 2 }));
    await waitFor(() => {
      expect(tile.textContent).toMatch(/chưa xác định|unresolved/i);
    });
    expect(tile.textContent).not.toMatch(/Chưa gắn khu vực|No zones linked/i);

    getZonesSpy.mockRejectedValueOnce(
      new ApiError('http', 'SELECT * FROM internal_zones WHERE secret=1', 503),
    );
    rerender(buildWallTree({ configurationVersion: 3 }));
    await waitFor(() => {
      expect(tile.textContent).toMatch(
        /Không tải được khu vực|tạm thời không khả dụng|unavailable/i,
      );
    });
    expect(tile.textContent).not.toMatch(/Chưa gắn khu vực|No zones linked/i);
    expect(tile.textContent).not.toContain('SELECT * FROM internal_zones');

    getZonesSpy.mockClear();
    getZonesSpy
      .mockResolvedValueOnce(
        makeZonesResponse({
          configurationVersion: 4,
          items: [zoneItem(ZONE_1_ID, 'ZONE-P1', 'Khu vực Trang 1')],
          total: 2,
        }),
      )
      .mockRejectedValueOnce(new ApiError('http', 'Page 2 failed', 503));

    rerender(buildWallTree({ configurationVersion: 4 }));
    await waitFor(() => {
      expect(tile.textContent).toContain('Khu vực Trang 1');
    });
    expect(getZonesSpy).toHaveBeenCalledTimes(1);

    clickLoadMoreZones(tile);
    await waitFor(() => {
      expect(getZonesSpy).toHaveBeenCalledTimes(2);
      expect(tile.textContent).toContain('Khu vực Trang 1');
      expect(tile.textContent).toMatch(
        /một phần|1\/2|chưa tải đủ|Không thể tải thêm khu vực|partial/i,
      );
    });
    expect(tile.textContent).not.toMatch(/Chưa gắn khu vực|No zones linked/i);
  });

  it('paginates explicitly via Load more zones with raw-row offset, deduplicates zones case-insensitively, and enforces matching camera.configurationVersion', async () => {
    const pagesByOffset: Record<number, CameraObservationZones['items']> = {
      0: [zoneItem(ZONE_1_ID, 'Z-01', 'Khu vực A'), zoneItem(ZONE_2_ID, 'Z-02', 'Khu vực B')],
      2: [zoneItem(ZONE_2_ID.toUpperCase(), 'Z-02', 'Khu vực B')],
      3: [zoneItem(ZONE_3_ID, 'Z-03', 'Khu vực C')],
    };
    const getZonesSpy = vi
      .spyOn(client, 'getCameraObservationZones')
      .mockImplementation(async (_token, _siteId, _cameraId, paging) =>
        makeZonesResponse({
          configurationVersion: 5,
          items: pagesByOffset[paging?.offset ?? 0] ?? [],
          total: 4,
        }),
      );

    const { rerender } = render(buildWallTree({ configurationVersion: 5 }));

    const tile = await screen.findByTestId(`wall-tile-${CAM_1_ID}`);
    await waitFor(() => {
      expect(tile.textContent).toContain('Khu vực A');
      expect(tile.textContent).toContain('Khu vực B');
    });
    expect(getZonesSpy).toHaveBeenCalledTimes(1);
    expect(tile.textContent).not.toContain('Khu vực C');

    clickLoadMoreZones(tile);
    await waitFor(() => {
      expect(getZonesSpy).toHaveBeenCalledTimes(2);
    });
    expectZoneCallAtOffset(getZonesSpy, 2);
    expect(within(tile).getAllByText(/Khu vực B/).length).toBe(1);

    // Next page offset must advance by raw rows (2 + 1 = 3), not deduplicated count (2)
    clickLoadMoreZones(tile);
    await waitFor(() => {
      expect(tile.textContent).toContain('Khu vực C');
    });
    expect(getZonesSpy).toHaveBeenCalledTimes(3);
    expectZoneCallAtOffset(getZonesSpy, 3);
    expect(within(tile).getAllByText(/Khu vực B/).length).toBe(1);

    getZonesSpy.mockResolvedValueOnce(
      makeZonesResponse({
        configurationVersion: 5,
        items: [zoneItem(ZONE_1_ID, 'Z-STALE-V5', 'Khu vực Cũ v5')],
      }),
    );

    rerender(buildWallTree({ configurationVersion: 6 }));

    await waitFor(() => {
      expect(tile.textContent).not.toContain('Khu vực Cũ v5');
      expect(tile.textContent).not.toMatch(/Chưa gắn khu vực|No zones linked/i);
    });
  });

  it('keeps Site/Camera/Zone metadata enabled when pixel AI preview polling is paused or disabled (enabled=false)', async () => {
    const getZonesSpy = vi.spyOn(client, 'getCameraObservationZones').mockResolvedValue(
      makeZonesResponse({
        items: [zoneItem(ZONE_1_ID, 'ZONE-PAUSED-01', 'Khu vực Giàn Giáo Tầng 3')],
      }),
    );

    render(
      buildWallTree({
        token: 'token-paused-1',
        sessionScope: 'scope-paused',
        credentialId: 2,
        enabled: false,
      }),
    );

    const tile = await screen.findByTestId(`wall-tile-${CAM_1_ID}`);
    await waitFor(() => {
      expect(getZonesSpy).toHaveBeenCalledTimes(1);
      expect(tile.textContent).toContain('Khu vực Giàn Giáo Tầng 3');
    });

    expect(previewCalls.every((call) => call.enabled === false)).toBe(true);
    expect(tile.textContent).toContain('SITE-A');
    expect(tile.textContent).toContain('Công trường Alpha');
    expect(tile.textContent).toContain('CAM-07');
    expect(tile.textContent).toContain('Camera Cổng Phụ Bắc');
  });

  it('fences late responses across token rotation and site/camera switches with same credentialId and never exposes secrets or RTSP URLs', async () => {
    const staleAlphaDeferred = deferred<CameraObservationZones>();
    const freshBetaDeferred = deferred<CameraObservationZones>();

    vi.spyOn(client, 'getCameraObservationZones').mockImplementation((token, siteId) => {
      if (token === 'secret-jwt-token-old' || siteId === SITE_ALPHA_ID) {
        return staleAlphaDeferred.promise;
      }
      return freshBetaDeferred.promise;
    });

    const { rerender, container } = render(
      buildWallTree({
        token: 'secret-jwt-token-old',
        sessionScope: 'scope-shared',
        credentialId: 7,
      }),
    );

    rerender(
      buildWallTree({
        token: 'secret-jwt-token-new',
        sessionScope: 'scope-shared',
        credentialId: 7,
        siteCode: 'SITE-B',
        siteName: 'Công trường Beta',
        cameraOverrides: {
          id: CAM_2_ID,
          siteId: SITE_BETA_ID,
          code: 'CAM-B2',
          name: 'Camera Tháp B2',
          externalId: 'rtsp://root:privatepass@192.168.1.99:554/live',
        },
      }),
    );

    staleAlphaDeferred.resolve(
      makeZonesResponse({
        items: [zoneItem(ZONE_1_ID, 'ZONE-ALPHA-LEAK', 'Khu vực Rò Rỉ Alpha')],
      }),
    );

    freshBetaDeferred.resolve(
      makeZonesResponse({
        siteId: SITE_BETA_ID,
        cameraId: CAM_2_ID,
        items: [zoneItem(ZONE_2_ID, 'ZONE-BETA-OK', 'Khu vực Hợp Lệ Beta')],
      }),
    );

    const betaTile = await screen.findByTestId(`wall-tile-${CAM_2_ID}`);
    await waitFor(() => {
      expect(betaTile.textContent).toContain('Khu vực Hợp Lệ Beta');
    });

    expect(container.textContent).not.toContain('Khu vực Rò Rỉ Alpha');
    expect(container.textContent).not.toContain('ZONE-ALPHA-LEAK');
    expect(container.innerHTML).not.toContain('rtsp://');
    expect(container.innerHTML).not.toContain('privatepass');
    expect(container.innerHTML).not.toContain('supersecret');

    const serializedKeys = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey),
    );
    expect(serializedKeys).not.toContain('secret-jwt-token-old');
    expect(serializedKeys).not.toContain('secret-jwt-token-new');
  });

  it('localizes Focused badge in vi/en and exposes a single polite status region across loading, empty, error, and loaded states', async () => {
    const pendingZones = deferred<CameraObservationZones>();
    const getZonesSpy = vi
      .spyOn(client, 'getCameraObservationZones')
      .mockImplementationOnce(() => pendingZones.promise);

    const { rerender } = render(buildWallTree({ locale: 'vi', configurationVersion: 1 }));

    const viBadge = await screen.findByTestId(`focused-badge-${CAM_1_ID}`);
    expect(viBadge.textContent).toBe('Tiêu điểm');

    const zonesStatus = screen.getByTestId(`wall-zones-${CAM_1_ID}`);
    expect(zonesStatus.getAttribute('role')).toBe('status');
    expect(zonesStatus.getAttribute('aria-live')).toBe('polite');
    expect(zonesStatus.querySelectorAll('[role="status"], [aria-live]').length).toBe(0);
    expect(zonesStatus.textContent).toContain('Đang tải khu vực');

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(screen.getByTestId(`focused-badge-${CAM_1_ID}`).textContent).toBe('Focused');

    pendingZones.resolve(makeZonesResponse({ configurationVersion: 1 }));
    await waitFor(() => {
      expect(screen.getByTestId(`wall-zones-${CAM_1_ID}`).textContent).toContain('No zones linked');
    });
    expect(
      screen.getByTestId(`wall-zones-${CAM_1_ID}`).querySelectorAll('[role="status"], [aria-live]')
        .length,
    ).toBe(0);

    getZonesSpy.mockRejectedValueOnce(new ApiError('http', 'Offline', 503));
    rerender(buildWallTree({ locale: 'en', configurationVersion: 2 }));
    await waitFor(() => {
      expect(screen.getByTestId(`wall-zones-${CAM_1_ID}`).textContent).toContain(
        'Zones temporarily unavailable',
      );
    });
    expect(
      screen.getByTestId(`wall-zones-${CAM_1_ID}`).querySelectorAll('[role="status"], [aria-live]')
        .length,
    ).toBe(0);

    getZonesSpy.mockResolvedValueOnce(
      makeZonesResponse({
        configurationVersion: 3,
        items: [zoneItem(ZONE_1_ID, 'ZONE-EN-01', 'North Scaffold Zone')],
      }),
    );
    rerender(buildWallTree({ locale: 'en', configurationVersion: 3 }));
    await waitFor(() => {
      expect(screen.getByTestId(`wall-zones-${CAM_1_ID}`).textContent).toContain(
        'North Scaffold Zone',
      );
    });
    const finalStatus = screen.getByTestId(`wall-zones-${CAM_1_ID}`);
    expect(finalStatus.getAttribute('role')).toBe('status');
    expect(finalStatus.getAttribute('aria-live')).toBe('polite');
    expect(finalStatus.querySelectorAll('[role="status"], [aria-live]').length).toBe(0);
  });

  it('exposes each wall tile as a named group with a camera-specific aria-pressed focus button while preserving full-tile click and non-nested retry controls', async () => {
    vi.spyOn(client, 'getCameraObservationZones').mockResolvedValue(makeZonesResponse());
    const cam1 = makeCamera({ id: CAM_1_ID, code: 'CAM-07', name: 'Camera Cổng Phụ Bắc' });
    const cam2 = makeCamera({ id: CAM_2_ID, code: 'CAM-08', name: 'Camera Tháp B2' });
    const onSelectCamera = vi.fn();

    render(
      buildWallTree({
        locale: 'en',
        cameras: [cam1, cam2],
        selectedCameraId: CAM_1_ID,
        onSelectCamera,
      }),
    );

    const tile1 = screen.getByRole('group', { name: 'Camera Camera Cổng Phụ Bắc (focused)' });
    const tile2 = screen.getByRole('group', { name: 'Camera Camera Tháp B2 (available)' });
    expect(tile1).toBe(screen.getByTestId(`wall-tile-${CAM_1_ID}`));
    expect(tile2).toBe(screen.getByTestId(`wall-tile-${CAM_2_ID}`));
    expect(tile1.getAttribute('role')).toBe('group');
    expect(tile2.getAttribute('role')).toBe('group');
    expect(tile1.getAttribute('tabIndex')).toBeNull();
    expect(tile2.getAttribute('tabIndex')).toBeNull();

    const focusBtn1 = within(tile1).getByRole('button', {
      name: 'Selected: Camera Cổng Phụ Bắc',
    });
    const focusBtn2 = within(tile2).getByRole('button', {
      name: 'Select camera: Camera Tháp B2',
    });
    expect(focusBtn1).toBe(screen.getByTestId(`focus-btn-${CAM_1_ID}`));
    expect(focusBtn2).toBe(screen.getByTestId(`focus-btn-${CAM_2_ID}`));
    expect(focusBtn1.getAttribute('aria-pressed')).toBe('true');
    expect(focusBtn2.getAttribute('aria-pressed')).toBe('false');
    expect(focusBtn1.textContent).toBe('Selected');
    expect(focusBtn2.textContent).toBe('Select camera');

    const retryBtn2 = within(tile2).getByRole('button', { name: 'Retry' });
    expect(retryBtn2.closest('button')).toBe(retryBtn2);
    expect(tile2.querySelectorAll('button button').length).toBe(0);

    fireEvent.click(focusBtn2);
    expect(onSelectCamera).toHaveBeenCalledTimes(1);
    expect(onSelectCamera).toHaveBeenLastCalledWith(CAM_2_ID);

    fireEvent.click(tile2);
    expect(onSelectCamera).toHaveBeenCalledTimes(2);
    expect(onSelectCamera).toHaveBeenLastCalledWith(CAM_2_ID);
  });
});
