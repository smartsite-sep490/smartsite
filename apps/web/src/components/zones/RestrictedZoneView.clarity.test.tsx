// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoginResponse, SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraApplicationStatus } from '@smartsite/contracts/camera-application-status';
import type {
  CameraResponse,
  Page,
  RegionResponse,
  SiteResponse,
  ZoneResponse,
} from '@smartsite/contracts/management';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import { RestrictedZoneView } from './RestrictedZoneView';
import { classifyZonePolicy, resolveZoneWorkerOperationalStatus } from './zone-monitor-model';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const mockClient = vi.hoisted(() => ({ current: null as unknown as SmartSiteManagementClient }));

vi.mock('../../features/auth/auth-session', () => ({
  useManagementClient: () => mockClient.current,
}));

vi.mock('../ppe/FocusedCameraMedia', () => ({
  FocusedCameraMedia: ({
    siteId,
    camera,
    aiPaused,
  }: {
    siteId: string;
    camera: { id: string };
    aiPaused: boolean;
  }) => (
    <div
      data-testid="mock-focused-camera-media"
      data-site={siteId}
      data-camera={camera.id}
      data-ai-paused={aiPaused ? 'true' : 'false'}
    />
  ),
}));

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAM_ID = '22222222-2222-4222-8222-222222222222';
const ZONE_PROHIBITED_ID = '33333333-3333-4333-8333-333333333331';
const ZONE_PPE_ID = '33333333-3333-4333-8333-333333333332';

const OFFICER_SESSION: Pick<LoginResponse, 'accessToken' | 'user'> = {
  accessToken: 'tok-officer',
  user: {
    id: 'officer-1',
    username: 'demo.safety',
    displayName: 'Safety Officer Demo',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: SITE_ID }],
  },
};

const BASE_CAMERA: CameraResponse = {
  type: 'ZONE',
  gateId: null,
  id: CAM_ID,
  siteId: SITE_ID,
  externalId: 'edge-cam-01',
  code: 'LAPTOP',
  name: 'Camera laptop demo',
  status: 'ACTIVE',
  configurationVersion: 17,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const ZONES: ZoneResponse[] = [
  {
    id: ZONE_PROHIBITED_ID,
    siteId: SITE_ID,
    code: 'Z-PROH',
    name: 'Crane Exclusion Area',
    type: 'RESTRICTED',
    restrictionPolicy: 'PROHIBITED_FOR_ALL',
    requiredPpe: [],
    configurationLocked: false,
    createdAt: '2026-11-01T00:00:00.000Z',
  },
  {
    id: ZONE_PPE_ID,
    siteId: SITE_ID,
    code: 'Z-PPE',
    name: 'North Concrete Deck — Long Site PPE Zone Name',
    type: 'STANDARD',
    restrictionPolicy: 'NONE',
    requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
    configurationLocked: false,
    createdAt: '2026-11-01T00:00:00.000Z',
  },
];

const REGIONS: RegionResponse[] = [
  {
    id: 'reg-proh-1',
    cameraId: CAM_ID,
    zoneId: ZONE_PROHIBITED_ID,
    polygon: {
      coordinates: [
        [0.1, 0.1],
        [0.4, 0.1],
        [0.4, 0.4],
      ],
    },
    coordinateSpace: 'NORMALIZED_0_1',
    version: 2,
    isActive: true,
    createdAt: '2026-11-01T00:00:00.000Z',
  },
  {
    id: 'reg-proh-2',
    cameraId: CAM_ID,
    zoneId: ZONE_PROHIBITED_ID,
    polygon: {
      coordinates: [
        [0.5, 0.1],
        [0.8, 0.1],
        [0.8, 0.4],
      ],
    },
    coordinateSpace: 'NORMALIZED_0_1',
    version: 5,
    isActive: true,
    createdAt: '2026-11-01T00:00:00.000Z',
  },
  {
    id: 'reg-ppe-1',
    cameraId: CAM_ID,
    zoneId: ZONE_PPE_ID,
    polygon: {
      coordinates: [
        [0.1, 0.5],
        [0.5, 0.5],
        [0.5, 0.9],
      ],
    },
    coordinateSpace: 'NORMALIZED_0_1',
    version: 4,
    isActive: true,
    createdAt: '2026-11-01T00:00:00.000Z',
  },
];

function makeBaseClient(
  overrides: Partial<SmartSiteManagementClient> = {},
): SmartSiteManagementClient {
  const nowIso = new Date().toISOString();
  return {
    listSites: vi.fn().mockResolvedValue({
      items: [
        {
          id: SITE_ID,
          code: 'LOCAL-DEMO',
          name: 'Local Demo Site',
          createdAt: '2026-11-01T00:00:00.000Z',
        },
      ],
      total: 1,
    } satisfies Page<SiteResponse>),
    listCameras: vi.fn().mockResolvedValue({
      items: [BASE_CAMERA],
      total: 1,
    } satisfies Page<CameraResponse>),
    listRegions: vi.fn().mockResolvedValue({
      items: REGIONS,
      total: REGIONS.length,
    } satisfies Page<RegionResponse>),
    listZones: vi.fn().mockResolvedValue({
      items: ZONES,
      total: ZONES.length,
    } satisfies Page<ZoneResponse>),
    getCameraApplicationStatus: vi.fn().mockResolvedValue({
      siteId: SITE_ID,
      cameraId: CAM_ID,
      desiredRevision: 17,
      reportedRevision: 17,
      applicationState: 'STALE',
      viewValidity: 'UNCONFIRMED',
      reasonCode: 'WORKER_GENERATION_STALE',
      lastReceiptAt: nowIso,
      observedAt: nowIso,
    } satisfies CameraApplicationStatus),
    ...overrides,
  } as unknown as SmartSiteManagementClient;
}

describe('MF06 RestrictedZoneView clarity: human Zone names, policy distinction, and honest worker status', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('distinguishes prohibited and non-restricted zones by human Zone name, authoritative restrictionPolicy, and per-zone ordinal/version in selector and context', async () => {
    const user = userEvent.setup();
    mockClient.current = makeBaseClient();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RestrictedZoneView apiUrl="http://api.invalid" authenticatedSession={OFFICER_SESSION} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const regionSelect = (await screen.findByLabelText(/Region \/ Zone/i)) as HTMLSelectElement;
    await waitFor(() => {
      const texts = Array.from(regionSelect.options).map((o) => o.textContent ?? '');
      expect(texts).toHaveLength(3);
      expect(texts[0]).toContain('Crane Exclusion Area');
      expect(texts[0]).toContain('Prohibited');
      expect(texts[0]).toContain('#1');
      expect(texts[0]).toContain('v2');
      expect(texts[1]).toContain('Crane Exclusion Area');
      expect(texts[1]).toContain('Prohibited');
      expect(texts[1]).toContain('#2');
      expect(texts[1]).toContain('v5');
      expect(texts[2]).toContain('North Concrete Deck — Long Site PPE Zone Name');
      expect(texts[2]).toContain('No entry restriction');
      expect(texts[2]).toContain('#1');
      expect(texts[2]).toContain('v4');
    });

    const contextStrip = screen.getByTestId('zone-monitor-selected-region-context');
    expect(contextStrip.textContent).toContain('Crane Exclusion Area');
    expect(contextStrip.textContent).toContain('Prohibited');

    // Switch to non-restricted PPE zone -> updates cleanly using authoritative restrictionPolicy NONE without leaking UUIDs
    await user.selectOptions(regionSelect, 'reg-ppe-1');
    expect(contextStrip.textContent).toContain('North Concrete Deck — Long Site PPE Zone Name');
    expect(contextStrip.textContent).toContain('No entry restriction');
    expect(contextStrip.textContent).not.toContain(ZONE_PPE_ID.slice(0, 8));
  });

  it('keeps restrictionPolicy NONE as No entry restriction even when legacy zone.type is RESTRICTED/HAZARDOUS or requiredPpe is populated', () => {
    const legacyRestrictedButNone: ZoneResponse = {
      ...ZONES[0]!,
      type: 'RESTRICTED',
      restrictionPolicy: 'NONE',
      requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
    };
    const legacyHazardousButNone: ZoneResponse = {
      ...ZONES[0]!,
      type: 'HAZARDOUS',
      restrictionPolicy: 'NONE',
      requiredPpe: [],
    };
    const authRequired: ZoneResponse = {
      ...ZONES[0]!,
      type: 'STANDARD',
      restrictionPolicy: 'AUTHORIZATION_REQUIRED',
      requiredPpe: [],
    };

    expect(classifyZonePolicy(legacyRestrictedButNone)).toBe('NONE');
    expect(classifyZonePolicy(legacyHazardousButNone)).toBe('NONE');
    expect(classifyZonePolicy(authRequired)).toBe('AUTHORIZATION_REQUIRED');
    expect(classifyZonePolicy(ZONES[0])).toBe('PROHIBITED');
    expect(classifyZonePolicy(undefined)).toBe('UNAVAILABLE');
  });

  it('never renders green LOADED when AI work is paused, and maps LOADED/PENDING/REJECTED/STALE honestly from shared application status', () => {
    const loadedPayload = {
      status: {
        siteId: SITE_ID,
        cameraId: CAM_ID,
        desiredRevision: 17,
        reportedRevision: 17,
        applicationState: 'LOADED' as const,
        viewValidity: 'UNCONFIRMED' as const,
        reasonCode: null,
        lastReceiptAt: new Date().toISOString(),
        observedAt: new Date().toISOString(),
      },
      fetchedAtMonotonicMs: 100,
    };
    const idleQuery = { isFetching: false, isPending: false, isError: false, refetch: vi.fn() };

    const whenPaused = resolveZoneWorkerOperationalStatus(
      {
        canQuery: true,
        effectiveState: 'LOADED',
        verifiedPayload: loadedPayload,
        query: idleQuery,
      },
      true,
    );
    expect(whenPaused.state).toBe('UNCONFIRMED');
    expect(whenPaused.tone).not.toBe('emerald');

    const whenLiveLoaded = resolveZoneWorkerOperationalStatus(
      {
        canQuery: true,
        effectiveState: 'LOADED',
        verifiedPayload: loadedPayload,
        query: idleQuery,
      },
      false,
    );
    expect(whenLiveLoaded.state).toBe('LOADED');
    expect(whenLiveLoaded.tone).toBe('emerald');

    const whenPending = resolveZoneWorkerOperationalStatus(
      {
        canQuery: true,
        effectiveState: 'PENDING',
        verifiedPayload: {
          ...loadedPayload,
          status: { ...loadedPayload.status, applicationState: 'PENDING', reportedRevision: 16 },
        },
        query: idleQuery,
      },
      false,
    );
    expect(whenPending.state).toBe('PENDING');
    expect(whenPending.tone).toBe('amber');
  });

  it('explicitly marks missing Zone lookup as unavailable and never infers name or policy from ID', async () => {
    const mysteryZoneId = 'prohibited-restricted-9999-4999-8999-999999999999';
    mockClient.current = makeBaseClient({
      listZones: vi.fn().mockRejectedValue(new Error('Zone catalog temporarily unavailable')),
      listRegions: vi.fn().mockResolvedValue({
        items: [
          {
            ...REGIONS[0]!,
            id: 'reg-mystery-1',
            zoneId: mysteryZoneId,
            version: 3,
          },
        ],
        total: 1,
      } satisfies Page<RegionResponse>),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RestrictedZoneView apiUrl="http://api.invalid" authenticatedSession={OFFICER_SESSION} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const regionSelect = (await screen.findByLabelText(/Region \/ Zone/i)) as HTMLSelectElement;
    await waitFor(() => {
      const optionText = regionSelect.options[0]?.textContent ?? '';
      expect(optionText).toMatch(/Zone unavailable/i);
      expect(optionText).toMatch(/Policy unavailable/i);
      expect(optionText).not.toMatch(/Prohibited/i);
      expect(optionText).not.toContain('prohibited-restricted');
    });

    const contextStrip = screen.getByTestId('zone-monitor-selected-region-context');
    expect(contextStrip.textContent).toMatch(/Zone unavailable/i);
    expect(contextStrip.textContent).toMatch(/Policy unavailable/i);
    expect(contextStrip.textContent).not.toMatch(/Prohibited/i);
  });

  it('replaces misleading green Server Synced (vN) with neutral Saved config vN and honest worker application status across stale, pending, unavailable, and loaded states', async () => {
    mockClient.current = makeBaseClient();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RestrictedZoneView apiUrl="http://api.invalid" authenticatedSession={OFFICER_SESSION} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByTestId('mock-focused-camera-media');
    // Misleading green "Server Synced" label MUST be gone
    expect(screen.queryByText(/Server Synced/i)).toBeNull();

    const savedBadge = screen.getByTestId('zone-monitor-saved-config');
    expect(savedBadge.textContent).toMatch(/Saved config v17/i);
    expect(savedBadge.className).not.toContain('emerald');

    const workerStatus = await screen.findByTestId('zone-monitor-worker-status');
    await waitFor(() => {
      expect(workerStatus.getAttribute('data-worker-state')).toBe('STALE');
    });
    expect(workerStatus.textContent).toMatch(/No recent confirmation from AI/i);
    expect(workerStatus.textContent).not.toMatch(/Worker|receipt/i);

    await i18n.changeLanguage('vi');
    await waitFor(() => {
      expect(workerStatus.textContent).toContain('Chưa có xác nhận mới từ máy AI');
    });
    expect(workerStatus.textContent).not.toMatch(/Worker|Biên nhận/i);
    await i18n.changeLanguage('en');

    // AI boundary info disclosure must not claim unconditional server sync
    const boundaryNote = screen.getByText(/Saved region boundaries/i);
    expect(boundaryNote.textContent).not.toMatch(/is synced from the server configuration/i);
  });

  it('shows plain AI unavailable copy when application-status query fails or is absent', async () => {
    mockClient.current = makeBaseClient({
      getCameraApplicationStatus: vi.fn().mockRejectedValue(new Error('Status endpoint offline')),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RestrictedZoneView apiUrl="http://api.invalid" authenticatedSession={OFFICER_SESSION} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByTestId('mock-focused-camera-media');
    expect(screen.queryByText(/Server Synced/i)).toBeNull();
    const workerStatus = await screen.findByTestId('zone-monitor-worker-status');
    await waitFor(() => {
      expect(workerStatus.getAttribute('data-worker-state')).toBe('UNAVAILABLE');
    });
    expect(workerStatus.textContent).toMatch(/Unable to confirm AI/i);
    expect(workerStatus.textContent).not.toMatch(/Worker/i);

    await i18n.changeLanguage('vi');
    await waitFor(() => {
      expect(workerStatus.textContent).toContain('Chưa xác nhận được máy AI');
    });
    expect(workerStatus.textContent).not.toMatch(/worker/i);
  });

  it('uses plain AI received configuration copy for LOADED in EN and VI without worker jargon', async () => {
    const nowIso = new Date().toISOString();
    mockClient.current = makeBaseClient({
      getCameraApplicationStatus: vi.fn().mockResolvedValue({
        siteId: SITE_ID,
        cameraId: CAM_ID,
        desiredRevision: 17,
        reportedRevision: 17,
        applicationState: 'LOADED',
        viewValidity: 'UNCONFIRMED',
        reasonCode: null,
        lastReceiptAt: nowIso,
        observedAt: nowIso,
      } satisfies CameraApplicationStatus),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RestrictedZoneView apiUrl="http://api.invalid" authenticatedSession={OFFICER_SESSION} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByTestId('mock-focused-camera-media');
    const savedBadge = screen.getByTestId('zone-monitor-saved-config');
    expect(savedBadge.textContent).toMatch(/Saved config v17/i);

    const workerStatus = await screen.findByTestId('zone-monitor-worker-status');
    await waitFor(() => {
      expect(workerStatus.getAttribute('data-worker-state')).toBe('LOADED');
    });
    expect(workerStatus.textContent).toBe('AI has received configuration');
    expect(workerStatus.textContent).not.toMatch(/Worker|v17|Live|Ready/i);

    await i18n.changeLanguage('vi');
    await waitFor(() => {
      expect(workerStatus.textContent).toBe('Máy AI đã nhận cấu hình');
    });
    expect(workerStatus.textContent).not.toMatch(/Worker|v17|Sẵn sàng/i);
  });

  it('allows an assigned SITE_MANAGER to monitor scoped camera geometry while hiding Officer-only incident navigation and other sites', async () => {
    const otherSiteId = '99999999-9999-4999-8999-999999999999';
    const onNavigate = vi.fn();
    mockClient.current = makeBaseClient({
      listSites: vi.fn().mockResolvedValue({
        items: [
          {
            id: SITE_ID,
            code: 'LOCAL-DEMO',
            name: 'Local Demo Site',
            createdAt: '2026-11-01T00:00:00.000Z',
          },
          {
            id: otherSiteId,
            code: 'OTHER-SITE',
            name: 'Unassigned Site',
            createdAt: '2026-11-01T00:00:00.000Z',
          },
        ],
        total: 2,
      } satisfies Page<SiteResponse>),
    });
    const managerSession: Pick<LoginResponse, 'accessToken' | 'user'> = {
      accessToken: 'tok-manager',
      user: {
        id: 'manager-1',
        username: 'demo.manager',
        displayName: 'Site Manager Demo',
        isActive: true,
        mustChangePassword: false,
        roleAssignments: [{ role: 'SITE_MANAGER', siteId: SITE_ID }],
      },
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    const view = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RestrictedZoneView
            apiUrl="http://api.invalid"
            authenticatedSession={managerSession}
            onNavigate={onNavigate}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const media = await screen.findByTestId('mock-focused-camera-media');
    expect(media.getAttribute('data-site')).toBe(SITE_ID);
    expect(media.getAttribute('data-camera')).toBe(CAM_ID);
    expect(screen.getByTestId('zones-edit-polygon-link')).toBeTruthy();

    // Only the assigned site appears in the selector; other sites are excluded
    const siteSelect = screen.getByLabelText(/Site/i) as HTMLSelectElement;
    expect(Array.from(siteSelect.options).map((o) => o.value)).toEqual([SITE_ID]);

    // Officer-only incidents/safety records navigation button is hidden for Manager-only
    expect(screen.queryByRole('button', { name: /Safety Operations/i })).toBeNull();

    // Officer retains the incidents navigation button on their assigned site
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RestrictedZoneView
            apiUrl="http://api.invalid"
            authenticatedSession={OFFICER_SESSION}
            onNavigate={onNavigate}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const incidentsBtn = await screen.findByRole('button', { name: /Safety Operations/i });
    await userEvent.setup().click(incidentsBtn);
    expect(onNavigate).toHaveBeenCalledWith('incidents', {
      alertType: 'RESTRICTED_ZONE_INTRUSION',
      siteId: SITE_ID,
    });
  });

  it('denies unassigned Admin-only session in linked zone monitoring without requesting site or camera metadata', () => {
    const client = makeBaseClient();
    mockClient.current = client;
    const adminSession: Pick<LoginResponse, 'accessToken' | 'user'> = {
      accessToken: 'tok-admin',
      user: {
        id: 'admin-1',
        username: 'demo.admin',
        displayName: 'Admin Demo',
        isActive: true,
        mustChangePassword: false,
        roleAssignments: [{ role: 'ADMIN', siteId: null }],
      },
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RestrictedZoneView apiUrl="http://api.invalid" authenticatedSession={adminSession} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(client.listSites).not.toHaveBeenCalled();
    expect(client.listCameras).not.toHaveBeenCalled();
  });
});
