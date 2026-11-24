// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedPpePolicy } from '@smartsite/api-client';
import type { CameraApplicationStatus } from '@smartsite/contracts/camera-application-status';
import type { CameraResponse, RegionResponse, ZoneResponse } from '@smartsite/contracts/management';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import type { CameraApplicationStatusContext } from './CameraApplicationStatusSummary';
import { CameraPpePolicyPanel, type CameraPpeContext } from './CameraPpePolicyPanel';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAMERA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REGION_INHERIT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const REGION_EXPLICIT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const REGION_DISABLED_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const ZONE_1_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const ZONE_2_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const ZONE_3_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';

function makeCamera(configurationVersion = 4): CameraResponse {
  return {
    type: 'ZONE' as const,
    gateId: null,
    id: CAMERA_ID,
    siteId: SITE_ID,
    code: 'CAM-01',
    name: 'North Gate',
    externalId: 'rtsp-cam-01',
    status: 'ACTIVE',
    configurationVersion,
    createdAt: '2026-11-01T00:00:00.000Z',
  };
}

function makeRegion(
  id: string,
  zoneId: string,
  overrides: Partial<RegionResponse> = {},
): RegionResponse {
  return {
    id,
    cameraId: CAMERA_ID,
    zoneId,
    polygon: {
      coordinates: [
        [0.1, 0.1],
        [0.8, 0.1],
        [0.8, 0.8],
      ],
    },
    coordinateSpace: 'NORMALIZED_0_1',
    version: 2,
    isActive: true,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeZone(id: string, code: string, name: string, requiredPpe: string[]): ZoneResponse {
  return {
    id,
    siteId: SITE_ID,
    code,
    name,
    type: 'HAZARDOUS',
    restrictionPolicy: 'NONE',
    requiredPpe,
    configurationLocked: false,
    createdAt: '2026-11-01T00:00:00.000Z',
  };
}

function renderPanel(props: {
  context: CameraPpeContext;
  camera?: CameraResponse;
  statusContext?: CameraApplicationStatusContext;
  canWrite?: boolean;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient: client,
    ...render(
      <QueryClientProvider client={client}>
        <CameraPpePolicyPanel
          cameraId={CAMERA_ID}
          camera={props.camera}
          context={props.context}
          statusContext={props.statusContext}
          canWrite={props.canWrite ?? true}
        />
      </QueryClientProvider>,
    ),
  };
}

describe('CameraPpePolicyPanel effective PPE, mode distinction, and saved vs applied state', () => {
  beforeEach(async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows effective PPE for INHERIT, EXPLICIT, and DISABLED regions in EN and VI without inferring from legacy Zone PPE', async () => {
    const zones = [
      // Legacy Zone PPE differs from camera default (includes BOOTS) to verify zero client inference.
      makeZone(ZONE_1_ID, 'Z-01', 'Scaffold Area', ['BOOTS']),
      makeZone(ZONE_2_ID, 'Z-02', 'Welding Bay', ['HARD_HAT', 'BOOTS']),
      makeZone(ZONE_3_ID, 'Z-03', 'Maintenance Path', ['SAFETY_VEST']),
    ];
    const regions = [
      makeRegion(REGION_INHERIT_ID, ZONE_1_ID, { version: 2, isActive: true }),
      makeRegion(REGION_EXPLICIT_ID, ZONE_2_ID, { version: 3, isActive: true }),
      makeRegion(REGION_DISABLED_ID, ZONE_3_ID, { version: 4, isActive: true }),
    ];
    const readSavedPpePolicy = vi
      .fn<CameraPpeContext['client']['readSavedPpePolicy']>()
      .mockImplementation(async (_token, _siteId, _cameraId, regionId) => {
        const map: Record<string, SavedPpePolicy> = {
          camera: {
            cameraId: CAMERA_ID,
            regionId: null,
            configurationVersion: 4,
            savedRevision: 2,
            policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT', 'SAFETY_VEST'] },
          },
          [REGION_INHERIT_ID]: {
            cameraId: CAMERA_ID,
            regionId: REGION_INHERIT_ID,
            configurationVersion: 4,
            savedRevision: 2,
            policy: { mode: 'INHERIT' },
          },
          [REGION_EXPLICIT_ID]: {
            cameraId: CAMERA_ID,
            regionId: REGION_EXPLICIT_ID,
            configurationVersion: 4,
            savedRevision: 3,
            policy: { mode: 'EXPLICIT', requiredPpe: ['GLOVES', 'GOGGLES'] },
          },
          [REGION_DISABLED_ID]: {
            cameraId: CAMERA_ID,
            regionId: REGION_DISABLED_ID,
            configurationVersion: 4,
            savedRevision: 4,
            policy: { mode: 'DISABLED', reason: 'Maintenance corridor' },
          },
        };
        const selected = map[regionId ?? 'camera'];
        if (!selected) throw new Error(`Missing mock region policy: ${regionId}`);
        return selected;
      });

    const context: CameraPpeContext = {
      setupKey: ['camera-setup-test'],
      token: 'token-1',
      siteId: SITE_ID,
      onUnauthorized: vi.fn(),
      client: {
        readSavedPpePolicy,
        listRegions: vi.fn().mockResolvedValue({ items: regions, total: 3 }),
        listZones: vi.fn().mockResolvedValue({ items: zones, total: 3 }),
        initializePpePolicy: vi.fn(),
        updateCameraPpePolicy: vi.fn(),
        updateRegionPpePolicy: vi.fn(),
        activateRegionWithPpePolicy: vi.fn(),
      },
    };

    const user = userEvent.setup();
    renderPanel({ context, camera: makeCamera(4) });
    await user.click(screen.getByRole('button', { name: 'Camera PPE policy' }));

    const inheritCard = await screen.findByTestId(`camera-ppe-region-card-${REGION_INHERIT_ID}`);
    expect(inheritCard.getAttribute('data-policy-mode')).toBe('INHERIT');
    expect(within(inheritCard).getByText('Scaffold Area')).toBeTruthy();
    expect(within(inheritCard).getByText('Use camera default')).toBeTruthy();
    expect(within(inheritCard).getByText('From camera default')).toBeTruthy();
    expect(within(inheritCard).getByText('Hard hat')).toBeTruthy();
    expect(within(inheritCard).getByText('Safety vest')).toBeTruthy();
    expect(within(inheritCard).queryByText('Boots')).toBeNull();

    const explicitCard = screen.getByTestId(`camera-ppe-region-card-${REGION_EXPLICIT_ID}`);
    expect(explicitCard.getAttribute('data-policy-mode')).toBe('EXPLICIT');
    expect(within(explicitCard).getByText('Welding Bay')).toBeTruthy();
    expect(within(explicitCard).getByText('Custom')).toBeTruthy();
    expect(within(explicitCard).getByText('Custom on this region')).toBeTruthy();
    expect(within(explicitCard).getByText('Gloves')).toBeTruthy();
    expect(within(explicitCard).getByText('Goggles')).toBeTruthy();
    expect(within(explicitCard).queryByText('Hard hat')).toBeNull();

    const disabledCard = screen.getByTestId(`camera-ppe-region-card-${REGION_DISABLED_ID}`);
    expect(disabledCard.getAttribute('data-policy-mode')).toBe('DISABLED');
    expect(within(disabledCard).getByText('Maintenance Path')).toBeTruthy();
    expect(within(disabledCard).getByText('Disabled')).toBeTruthy();
    expect(within(disabledCard).getByText('PPE checks disabled')).toBeTruthy();
    expect(within(disabledCard).getByText('Reason: Maintenance corridor')).toBeTruthy();

    // Quick-selecting a region shows live effective PPE preview in editor
    await user.click(
      within(inheritCard).getByRole('button', { name: 'Edit policy for Scaffold Area' }),
    );
    const preview = await screen.findByTestId('camera-ppe-draft-preview');
    expect(within(preview).getByText('Hard hat')).toBeTruthy();
    expect(within(preview).getByText('Safety vest')).toBeTruthy();

    // Switch to Vietnamese and verify mode & PPE item translations
    await i18n.changeLanguage('vi');
    await waitFor(() => {
      expect(within(inheritCard).getByText('Dùng mặc định camera')).toBeTruthy();
      expect(within(inheritCard).getByText('Mũ bảo hộ')).toBeTruthy();
      expect(within(explicitCard).getByText('Tùy chỉnh')).toBeTruthy();
      expect(within(explicitCard).getByText('Găng tay')).toBeTruthy();
      expect(within(disabledCard).getByText('Tắt')).toBeTruthy();
      expect(within(disabledCard).getByText('Đã tắt kiểm tra PPE')).toBeTruthy();
    });
  });

  it('never guesses PPE for unconfigured or failed region reads and allows per-region retry', async () => {
    const regions = [
      makeRegion(REGION_INHERIT_ID, ZONE_1_ID),
      makeRegion(REGION_EXPLICIT_ID, ZONE_2_ID),
    ];
    let secondRegionCalls = 0;
    const readSavedPpePolicy = vi
      .fn<CameraPpeContext['client']['readSavedPpePolicy']>()
      .mockImplementation(async (_token, _siteId, _cameraId, regionId) => {
        if (regionId === null) {
          return {
            cameraId: CAMERA_ID,
            regionId: null,
            configurationVersion: 2,
            savedRevision: 1,
            policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
          };
        }
        if (regionId === REGION_INHERIT_ID) {
          return {
            cameraId: CAMERA_ID,
            regionId: REGION_INHERIT_ID,
            configurationVersion: 2,
            savedRevision: null,
            policy: null,
          };
        }
        secondRegionCalls += 1;
        if (secondRegionCalls === 1) {
          throw new Error('Transient read error');
        }
        return {
          cameraId: CAMERA_ID,
          regionId: REGION_EXPLICIT_ID,
          configurationVersion: 2,
          savedRevision: 2,
          policy: { mode: 'EXPLICIT', requiredPpe: ['BOOTS'] },
        };
      });

    const context: CameraPpeContext = {
      setupKey: ['camera-setup-test'],
      token: 'token-1',
      siteId: SITE_ID,
      onUnauthorized: vi.fn(),
      client: {
        readSavedPpePolicy,
        listRegions: vi.fn().mockResolvedValue({ items: regions, total: 2 }),
        // Non-fatal 403 on zones still leaves regions inspectable by region ID.
        listZones: vi.fn().mockRejectedValue({ status: 403 }),
        initializePpePolicy: vi.fn(),
        updateCameraPpePolicy: vi.fn(),
        updateRegionPpePolicy: vi.fn(),
        activateRegionWithPpePolicy: vi.fn(),
      },
    };

    const user = userEvent.setup();
    renderPanel({ context, camera: makeCamera(2) });
    await user.click(screen.getByRole('button', { name: 'Camera PPE policy' }));

    const unconfiguredCard = await screen.findByTestId(
      `camera-ppe-region-card-${REGION_INHERIT_ID}`,
    );
    expect(within(unconfiguredCard).getByText('Not configured')).toBeTruthy();
    expect(
      within(unconfiguredCard).getByText(
        'Effective PPE unavailable — this region has no saved v2 PPE policy.',
      ),
    ).toBeTruthy();
    expect(within(unconfiguredCard).queryByText('Hard hat')).toBeNull();

    const erroredCard = screen.getByTestId(`camera-ppe-region-card-${REGION_EXPLICIT_ID}`);
    await waitFor(() => {
      expect(
        within(erroredCard).getByText('Could not load saved policy for this region.'),
      ).toBeTruthy();
    });
    expect(within(erroredCard).queryByText('Boots')).toBeNull();

    await user.click(within(erroredCard).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(within(erroredCard).getByText('Boots')).toBeTruthy();
    });
  });

  it('distinguishes saved vs worker-applied ACK status across pending, unconfirmed, stale, applied, and read-only scopes', async () => {
    const regions = [makeRegion(REGION_INHERIT_ID, ZONE_1_ID)];
    const context: CameraPpeContext = {
      setupKey: ['camera-setup-test'],
      token: 'token-1',
      siteId: SITE_ID,
      onUnauthorized: vi.fn(),
      client: {
        readSavedPpePolicy: vi.fn<CameraPpeContext['client']['readSavedPpePolicy']>(
          async (_t, _s, _c, regionId) =>
            regionId === null
              ? {
                  cameraId: CAMERA_ID,
                  regionId: null,
                  configurationVersion: 4,
                  savedRevision: 2,
                  policy: { mode: 'DISABLED', reason: 'Night pause' },
                }
              : {
                  cameraId: CAMERA_ID,
                  regionId: REGION_INHERIT_ID,
                  configurationVersion: 4,
                  savedRevision: 2,
                  policy: { mode: 'INHERIT' },
                },
        ),
        listRegions: vi.fn().mockResolvedValue({ items: regions, total: 1 }),
        initializePpePolicy: vi.fn(),
        updateCameraPpePolicy: vi.fn(),
        updateRegionPpePolicy: vi.fn(),
        activateRegionWithPpePolicy: vi.fn(),
      },
    };

    const now = new Date();
    const expiredIso = new Date(now.getTime() - 120_000).toISOString();
    const freshIso = now.toISOString();
    const statusMock = vi
      .fn<NonNullable<CameraApplicationStatusContext['client']['getCameraApplicationStatus']>>()
      .mockResolvedValueOnce({
        siteId: SITE_ID,
        cameraId: CAMERA_ID,
        desiredRevision: 4,
        reportedRevision: 3,
        applicationState: 'PENDING',
        viewValidity: 'UNCONFIRMED',
        reasonCode: 'WORKER_POLL_PENDING',
        lastReceiptAt: freshIso,
        observedAt: freshIso,
      } satisfies CameraApplicationStatus)
      .mockResolvedValueOnce({
        siteId: SITE_ID,
        cameraId: CAMERA_ID,
        desiredRevision: 4,
        reportedRevision: 4,
        applicationState: 'LOADED',
        viewValidity: 'UNCONFIRMED',
        reasonCode: null,
        lastReceiptAt: expiredIso,
        observedAt: freshIso,
      } satisfies CameraApplicationStatus)
      .mockResolvedValueOnce({
        siteId: SITE_ID,
        cameraId: CAMERA_ID,
        desiredRevision: 4,
        reportedRevision: 4,
        applicationState: 'LOADED',
        viewValidity: 'UNCONFIRMED',
        reasonCode: null,
        lastReceiptAt: freshIso,
        observedAt: freshIso,
      } satisfies CameraApplicationStatus);

    const statusContext: CameraApplicationStatusContext = {
      setupKey: ['camera-setup-test'],
      token: 'token-1',
      siteId: SITE_ID,
      client: { getCameraApplicationStatus: statusMock },
      enabled: true,
      onUnauthorized: vi.fn(),
    };

    const { queryClient } = renderPanel({
      context,
      camera: makeCamera(4),
      statusContext,
      canWrite: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Camera PPE policy' }));

    const syncBanner = await screen.findByTestId('camera-ppe-sync-status');
    await waitFor(() => {
      expect(syncBanner.getAttribute('data-sync-state')).toBe('not-yet-applied');
    });
    expect(syncBanner.textContent).toContain('Saved only');
    expect(syncBanner.textContent).not.toContain('Applied by worker');

    // Camera default DISABLED inherited by region shows disabled via camera default
    const regionCard = screen.getByTestId(`camera-ppe-region-card-${REGION_INHERIT_ID}`);
    expect(within(regionCard).getByText('PPE checks disabled (via camera default)')).toBeTruthy();
    expect(within(regionCard).getByText('Saved v4 · Not yet confirmed by worker')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save PPE policy' })).toBeNull();
    expect(
      screen.getByText(
        'Read-only mode: Site Manager role is required to modify camera or region PPE policies.',
      ),
    ).toBeTruthy();

    // Expired receipt must stay STALE and never report Applied
    await queryClient.invalidateQueries({ queryKey: ['camera-setup-test'] });
    await waitFor(() => {
      expect(syncBanner.getAttribute('data-sync-state')).toBe('stale');
    });
    expect(syncBanner.textContent).not.toContain('Applied by worker');

    // Fresh LOADED matching desired & reported revision shows Applied
    await queryClient.invalidateQueries({ queryKey: ['camera-setup-test'] });
    await waitFor(() => {
      expect(syncBanner.getAttribute('data-sync-state')).toBe('applied');
    });
    expect(syncBanner.textContent).toContain('Applied by worker (ACK v4)');
    expect(within(regionCard).getByText('Worker applied (v4)')).toBeTruthy();
  });

  it('uses configuration Zone metadata for a Manager without requesting the monitoring-only projection', async () => {
    const getCameraObservationZones = vi.fn().mockRejectedValue({ status: 403 });
    const listZones = vi.fn().mockResolvedValue({
      items: [makeZone(ZONE_1_ID, 'Z-01', 'Scaffold Area', ['BOOTS'])],
      total: 1,
    });
    const context: CameraPpeContext = {
      setupKey: ['manager-zone-metadata'],
      token: 'manager-token',
      siteId: SITE_ID,
      onUnauthorized: vi.fn(),
      client: {
        readSavedPpePolicy: vi.fn(async (_token, _siteId, _cameraId, regionId) => ({
          cameraId: CAMERA_ID,
          regionId: regionId ?? null,
          configurationVersion: 4,
          savedRevision: 2,
          policy: regionId
            ? { mode: 'INHERIT' as const }
            : { mode: 'EXPLICIT' as const, requiredPpe: ['HARD_HAT' as const] },
        })),
        listRegions: vi.fn().mockResolvedValue({
          items: [makeRegion(REGION_INHERIT_ID, ZONE_1_ID)],
          total: 1,
        }),
        getCameraObservationZones,
        listZones,
        initializePpePolicy: vi.fn(),
        updateCameraPpePolicy: vi.fn(),
        updateRegionPpePolicy: vi.fn(),
        activateRegionWithPpePolicy: vi.fn(),
      },
    };
    renderPanel({ context, camera: makeCamera(4), canWrite: true });
    fireEvent.click(screen.getByRole('button', { name: 'Camera PPE policy' }));
    const region = await screen.findByTestId(`camera-ppe-region-card-${REGION_INHERIT_ID}`);
    await waitFor(() => expect(within(region).getByText('Scaffold Area')).toBeTruthy());
    expect(listZones).toHaveBeenCalledWith(
      'manager-token',
      SITE_ID,
      { offset: 0, limit: 100 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(getCameraObservationZones).not.toHaveBeenCalled();
    expect(context.onUnauthorized).not.toHaveBeenCalled();
  });

  it('resolves human Zone labels from scoped getCameraObservationZones, rejects cross-scope responses, hides UUIDs in details on missing/denied metadata, and explains config vs worker/model capability truthfully without static CORE/HOLD badges', async () => {
    const OTHER_SITE_ID = '99999999-9999-4999-8999-999999999999';
    const OTHER_CAMERA_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const regions = [
      makeRegion(REGION_INHERIT_ID, ZONE_1_ID, { version: 2, isActive: true }),
      makeRegion(REGION_EXPLICIT_ID, ZONE_2_ID, { version: 3, isActive: true }),
    ];

    const getCameraObservationZones = vi
      .fn<NonNullable<CameraPpeContext['client']['getCameraObservationZones']>>()
      .mockResolvedValueOnce({
        siteId: SITE_ID,
        cameraId: CAMERA_ID,
        configurationVersion: 4,
        items: [{ id: ZONE_1_ID, code: 'Z-OBS', name: 'Crane Hook Zone' }],
        total: 1,
        unresolvedRegionCount: 1,
      })
      .mockResolvedValueOnce({
        // Mismatched camera scope on a subsequent refetch must be rejected
        siteId: SITE_ID,
        cameraId: OTHER_CAMERA_ID,
        configurationVersion: 4,
        items: [{ id: ZONE_2_ID, code: 'Z-LEAK', name: 'Leaked Other Camera Zone' }],
        total: 1,
        unresolvedRegionCount: 0,
      });

    // listZones returns a wrong-site entry for ZONE_2_ID (must be rejected) before 403 on page 2
    const listZones = vi
      .fn<NonNullable<CameraPpeContext['client']['listZones']>>()
      .mockResolvedValue({
        items: [
          {
            ...makeZone(ZONE_2_ID, 'Z-WRONG-SITE', 'Wrong Site Zone', ['HARD_HAT']),
            siteId: OTHER_SITE_ID,
          },
        ],
        total: 1,
      });

    const context: CameraPpeContext = {
      setupKey: ['camera-setup-p8s4'],
      token: 'token-1',
      siteId: SITE_ID,
      onUnauthorized: vi.fn(),
      client: {
        readSavedPpePolicy: vi.fn<CameraPpeContext['client']['readSavedPpePolicy']>(
          async (_t, _s, _c, regionId) => ({
            cameraId: CAMERA_ID,
            regionId: regionId ?? null,
            configurationVersion: 4,
            savedRevision: 2,
            policy: regionId
              ? { mode: 'INHERIT' }
              : { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT', 'GLOVES'] },
          }),
        ),
        listRegions: vi.fn().mockResolvedValue({ items: regions, total: 2 }),
        getCameraObservationZones,
        listZones,
        initializePpePolicy: vi.fn(),
        updateCameraPpePolicy: vi.fn(),
        updateRegionPpePolicy: vi.fn(),
        activateRegionWithPpePolicy: vi.fn(),
      },
    };

    const { queryClient } = renderPanel({ context, camera: makeCamera(4), canWrite: false });
    fireEvent.click(screen.getByRole('button', { name: 'Camera PPE policy' }));

    const resolvedCard = await screen.findByTestId(`camera-ppe-region-card-${REGION_INHERIT_ID}`);
    await waitFor(() => {
      expect(within(resolvedCard).getByText('Crane Hook Zone')).toBeTruthy();
    });

    // Technical codes & UUIDs live inside closed <details>, not as exposed primary text
    const resolvedTech = within(resolvedCard).getByTestId(
      `camera-ppe-region-tech-${REGION_INHERIT_ID}`,
    ) as HTMLDetailsElement;
    expect(resolvedTech.open).toBe(false);
    expect(resolvedTech.textContent).toContain('Z-OBS');
    expect(resolvedTech.textContent).toContain(REGION_INHERIT_ID);
    expect(resolvedTech.textContent).toContain(ZONE_1_ID);

    // Unresolved / cross-site-rejected region shows human fallback context, never leaked name or raw UUID primary label
    const unresolvedCard = screen.getByTestId(`camera-ppe-region-card-${REGION_EXPLICIT_ID}`);
    expect(within(unresolvedCard).getByText('Observation region #2')).toBeTruthy();
    expect(within(unresolvedCard).getByText('Zone metadata unavailable')).toBeTruthy();
    expect(within(unresolvedCard).queryByText(/Wrong Site Zone/i)).toBeNull();
    const unresolvedTech = within(unresolvedCard).getByTestId(
      `camera-ppe-region-tech-${REGION_EXPLICIT_ID}`,
    ) as HTMLDetailsElement;
    expect(unresolvedTech.open).toBe(false);
    expect(unresolvedTech.textContent).toContain(REGION_EXPLICIT_ID);

    // Policy scope <select> options use human labels without raw UUIDs
    const scopeSelect = screen.getByLabelText('Policy scope') as HTMLSelectElement;
    const optionTexts = Array.from(scopeSelect.options).map((o) => o.textContent ?? '');
    expect(optionTexts.some((txt) => txt.includes('Crane Hook Zone'))).toBe(true);
    expect(optionTexts.some((txt) => txt.includes('Observation region #2'))).toBe(true);
    expect(optionTexts.some((txt) => txt.includes(REGION_INHERIT_ID))).toBe(false);
    expect(optionTexts.some((txt) => txt.includes(REGION_EXPLICIT_ID))).toBe(false);

    // Refetching observation-zones with mismatched cameraId rejects leaked zone name
    await queryClient.invalidateQueries({ queryKey: ['camera-setup-p8s4'] });
    await waitFor(() => expect(getCameraObservationZones).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Leaked Other Camera Zone/i)).toBeNull();

    // Truthful configuration vs worker-applied / model capability note; zero invented CORE/HOLD badges
    const capabilityNote = screen.getByTestId('camera-ppe-capability-note');
    expect(capabilityNote.textContent).toMatch(/desired policy configuration only/i);
    expect(capabilityNote.textContent).toMatch(/worker-applied receipt/i);
    expect(capabilityNote.textContent).toMatch(/active worker model/i);
    const panelEl = screen.getByTestId('camera-ppe-policy-panel');
    expect(panelEl.textContent).not.toMatch(/\b(CORE|HOLD|Core active|Model-ready)\b/);

    // Verify Vietnamese translation parity on human fallback & capability note
    await i18n.changeLanguage('vi');
    await waitFor(() => {
      expect(within(unresolvedCard).getByText('Vùng quan sát #2')).toBeTruthy();
      expect(within(unresolvedCard).getByText('Chưa có thông tin khu vực')).toBeTruthy();
      expect(screen.getByTestId('camera-ppe-capability-note').textContent).toMatch(
        /mô hình trên máy AI đang chạy/i,
      );
    });
  });
});
