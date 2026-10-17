// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient, ApiError } from '@smartsite/api-client';
import type { Page, SiteResponse, ZoneResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import { PpeMonitoringView } from './PpeMonitoringView';
import type { DecodedPreview } from '../cameras/useRealtimePreview';
import type { VideoTestDetection } from '../cameras/videoTestFixture';
import type { SharedSession } from '../../types/shared-session';
import { AuthContext } from '../../features/auth/auth-session';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 50 }),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

const state = vi.hoisted(() => ({
  preview: null as DecodedPreview | null,
  status: 'LIVE' as 'LIVE' | 'REPLAY' | 'UNAVAILABLE' | 'CONNECTING' | null,
  sourceKind: 'LIVE' as 'LIVE' | 'REPLAY' | null,
}));

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: () => ({
    preview: state.preview,
    status: state.status ?? (state.preview ? 'LIVE' : 'UNAVAILABLE'),
    sourceKind:
      state.sourceKind ?? (state.status === 'REPLAY' ? 'REPLAY' : state.preview ? 'LIVE' : null),
    error: null,
    isError: false,
    isLoading: false,
    isPolling: Boolean(state.preview),
    retry: vi.fn(),
    cameraExternalId: state.preview?.frame.cameraExternalId ?? null,
    capturedAt: state.preview?.frame.capturedAt ?? null,
  }),
}));

vi.mock('../cameras/useRealtimePreview', () => ({
  useRealtimePreview: () => ({ preview: state.preview, connected: true, error: null }),
}));

const mockSitesList: Page<SiteResponse> = {
  items: [
    {
      id: 'site-alpha',
      code: 'SITE-A',
      name: 'Công trường Alpha',
      createdAt: '2026-09-30T00:00:00Z',
    },
    {
      id: 'site-beta',
      code: 'SITE-B',
      name: 'Công trường Beta',
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 2,
};

const mockCamerasList: Page<CameraResponse> = {
  items: [
    {
      id: 'cam-1',
      siteId: 'site-alpha',
      externalId: 'CAM-01',
      code: 'CAM-01',
      name: 'Camera 01',
      status: 'ACTIVE',
      configurationVersion: 1,
      createdAt: '2026-09-30T00:00:00Z',
    },
    {
      id: 'cam-2',
      siteId: 'site-alpha',
      externalId: 'CAM-02',
      code: 'CAM-02',
      name: 'Camera 02',
      status: 'ACTIVE',
      configurationVersion: 1,
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 2,
};

function mockDetection(trackId = 7): VideoTestDetection {
  return {
    active: true,
    alertState: 'CONFIRMED',
    confirmedMissingItems: ['HARD_HAT'],
    boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9 },
    confidence: 0.88,
    eventId: '00000000-0000-4000-8000-000000000001',
    label: 'Missing Hard Hat',
    ppeStatus: { HARD_HAT: 'MISSING', SAFETY_VEST: 'PRESENT' },
    timecode: '01:23',
    trackId,
    cameraExternalId: 'CAM-01',
  };
}

function mockPreview(detection?: VideoTestDetection): DecodedPreview {
  return {
    image: {} as HTMLImageElement,
    frame: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      sequenceNumber: '1',
      cameraExternalId: 'CAM-01',
      capturedAt: '2026-09-30T00:00:00Z',
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      zonePolygons: [],
      detections: detection ? [detection] : [],
      zoneDetections: [],
    },
  };
}

const mockGlobalAdminSession: SharedSession = {
  accessToken: 'mock-admin-token-xyz',
  sessionScope: 'scope-admin-01',
  user: {
    id: 'admin-user-01',
    displayName: 'Global Site Administrator',
    roleAssignments: [{ role: 'ADMIN', siteId: null }],
  },
  onSignOut: vi.fn(),
};

const mockSiteManagerSession: SharedSession = {
  accessToken: 'mock-site-manager-token-xyz',
  sessionScope: 'scope-site-manager-01',
  user: {
    id: 'site-manager-user-01',
    displayName: 'Site Manager Alpha',
    roleAssignments: [
      { role: 'SITE_MANAGER', siteId: 'site-alpha' },
      { role: 'SITE_MANAGER', siteId: 'site-beta' },
    ],
  },
  onSignOut: vi.fn(),
};

const mockSiteAdminSession: SharedSession = {
  accessToken: 'mock-site-admin-token',
  sessionScope: 'scope-site-admin-01',
  user: {
    id: 'site-admin-user-01',
    displayName: 'Site Admin Alpha',
    roleAssignments: [{ role: 'ADMIN', siteId: 'site-alpha' }],
  },
  onSignOut: vi.fn(),
};

const mockSafetyOfficerSession: SharedSession = {
  accessToken: 'mock-officer-token-abc',
  sessionScope: 'scope-officer-01',
  user: {
    id: 'officer-user-01',
    displayName: 'Safety Officer Alpha',
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
  },
  onSignOut: vi.fn(),
};

describe('PpeMonitoringView - Zone PPE Configuration (Phase 2 Suite)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    state.preview = mockPreview(mockDetection(7));
    state.status = 'LIVE';
    state.sourceKind = 'LIVE';

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
      mockCamerasList,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
      items: [],
      total: 0,
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    state.preview = null;
    state.status = null;
    state.sourceKind = null;
  });

  // --------------------------------------------------------------------------
  // 1. BEHAVIORAL ENTRY: GLOBAL ADMIN SEES ENTRY AND OPENS/CLOSES PANEL (READ-ONLY ZONES)
  // --------------------------------------------------------------------------
  it('renders "Configure PPE by Zone" entry button for Global Admin, shows read-only zone notice without zone creation controls, and toggles panel visibility', async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockGlobalAdminSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    const configureBtn = screen.getByRole('button', { name: /Configure PPE by Zone/i });
    expect(configureBtn).toBeDefined();

    // Panel is closed by default
    expect(screen.queryByRole('region', { name: /Configure PPE by Zone/i })).toBeNull();

    // Open panel
    await user.click(configureBtn);
    expect(await screen.findByRole('heading', { name: 'Zone PPE configuration' })).toBeDefined();

    // Global Admin manages camera observation regions only; Zone creation controls must not render
    expect(
      screen.getByText(
        /Zone catalog is read-only for your role\. Only the assigned Site Manager can create or rename zones for this site\./i,
      ),
    ).toBeDefined();
    expect(screen.queryByLabelText(/Zone Code/i)).toBeNull();
    expect(screen.queryByLabelText(/Zone Name/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Save Zone PPE/i })).toBeNull();

    // Close panel via Close (X) button
    const closeBtn = screen.getByRole('button', { name: 'Close dialog' });
    await user.click(closeBtn);
    expect(screen.queryByRole('region', { name: /Configure PPE by Zone/i })).toBeNull();
  });

  it('opens configuration in a named dialog without expanding diagnostics, and restores trigger focus on Escape', async () => {
    const user = userEvent.setup();
    const result = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockGlobalAdminSession} />
      </QueryClientProvider>,
    );
    await screen.findByRole('option', { name: /Công trường Alpha/i });
    const trigger = screen.getByRole('button', { name: /Configure PPE by Zone/i });
    await user.click(screen.getByTestId('toggle-diagnostics-drawer'));
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Zone PPE configuration' })).toBeDefined();
    expect(
      result.container
        .querySelector('[data-testid="toggle-diagnostics-drawer"]')
        ?.getAttribute('aria-expanded'),
    ).toBe('false');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('removes the configuration dialog and its draft immediately after credentials change', async () => {
    const user = userEvent.setup();
    const result = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSiteManagerSession} />
      </QueryClientProvider>,
    );
    await screen.findByRole('option', { name: /Công trường Alpha/i });
    await user.click(screen.getByRole('button', { name: /Configure PPE by Zone/i }));
    await user.type(screen.getByLabelText(/Zone Code/i), 'SENSITIVE-DRAFT');
    result.rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView
          sharedSession={{
            ...mockSiteManagerSession,
            sessionScope: 'changed-scope',
            accessToken: 'changed-token',
          }}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByDisplayValue('SENSITIVE-DRAFT')).toBeNull();
    expect(result.container.hasAttribute('inert')).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 2. FOCUSED BEHAVIOR: ZONE CREATION WITH TRIMMING, INVARIANTS & TRUTHFUL FEEDBACK
  // --------------------------------------------------------------------------
  it('allows assigned Site Manager to create a HAZARDOUS zone scoped to selected site with trimmed inputs and core PPE', async () => {
    const user = userEvent.setup();
    const createZoneSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createZone')
      .mockResolvedValue({
        id: 'zone-demo-created-01',
        siteId: 'site-alpha',
        code: 'PPE-HAZ-01',
        name: 'Scaffold Work Area',
        type: 'HAZARDOUS',
        restrictionPolicy: 'NONE',
        requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
        configurationLocked: false,
        createdAt: '2026-10-07T00:00:00Z',
      });

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSiteManagerSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    const configureBtn = screen.getByRole('button', { name: /Configure PPE by Zone/i });
    await user.click(configureBtn);

    // Form inputs: fill with leading/trailing spaces to verify trimming invariant
    const codeInput = screen.getByLabelText(/Zone Code/i) as HTMLInputElement;
    const nameInput = screen.getByLabelText(/Zone Name/i) as HTMLInputElement;
    await user.clear(codeInput);
    await user.type(codeInput, '  PPE-HAZ-01  ');
    await user.clear(nameInput);
    await user.type(nameInput, '  Scaffold Work Area  ');

    // Core 2 Checkboxes (native .checked and .disabled assertions)
    const hardHatCheckbox = screen.getByRole('checkbox', {
      name: /Hard Hat|Helmet/i,
    }) as HTMLInputElement;
    const safetyVestCheckbox = screen.getByRole('checkbox', {
      name: /Safety Vest/i,
    }) as HTMLInputElement;
    expect(hardHatCheckbox.checked).toBe(true);
    expect(safetyVestCheckbox.checked).toBe(true);
    expect(hardHatCheckbox.disabled).toBe(false);
    expect(safetyVestCheckbox.disabled).toBe(false);

    // Submit zone creation
    const submitBtn = screen.getByRole('button', { name: /Save Zone PPE/i });
    await user.click(submitBtn);

    // Invariant assertions on createZone call
    expect(createZoneSpy).toHaveBeenCalledTimes(1);
    expect(createZoneSpy).toHaveBeenCalledWith('mock-site-manager-token-xyz', 'site-alpha', {
      code: 'PPE-HAZ-01',
      name: 'Scaffold Work Area',
      type: 'HAZARDOUS',
      restrictionPolicy: 'NONE',
      requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
    });

    // Truthful feedback: saved zone requires camera observation region connection before AI applies
    expect(
      await screen.findByText(/Link this zone to a camera observation region when ready\./i),
    ).toBeDefined();

    // Inputs reset after successful creation
    expect(codeInput.value).toBe('');
    expect(nameInput.value).toBe('');
  });

  // --------------------------------------------------------------------------
  // 3. ROLE DENIAL: SAFETY OFFICER AND SITE-SCOPED ADMIN ARE DENIED
  // --------------------------------------------------------------------------
  it('denies access to Non-Admin (Safety Officer) and Site-scoped Admin', async () => {
    // 3A: Safety Officer
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSafetyOfficerSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });
    expect(screen.queryByRole('button', { name: /Configure PPE by Zone/i })).toBeNull();
    unmount();

    // 3B: Site-scoped Admin (siteId !== null)
    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSiteAdminSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });
    expect(screen.queryByRole('button', { name: /Configure PPE by Zone/i })).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 4. VALIDATION: REQUIRE >= 1 CORE ITEM, NON-EMPTY, & REJECT CONTROL CHARACTERS
  // --------------------------------------------------------------------------
  it('validates required inputs, rejects control characters, and blocks submission when core PPE items are unselected', async () => {
    const user = userEvent.setup();
    const createZoneSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createZone');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSiteManagerSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });
    await user.click(screen.getByRole('button', { name: /Configure PPE by Zone/i }));

    const codeInput = screen.getByLabelText(/Zone Code/i) as HTMLInputElement;
    const nameInput = screen.getByLabelText(/Zone Name/i) as HTMLInputElement;
    const hardHatCheckbox = screen.getByRole('checkbox', {
      name: /Hard Hat|Helmet/i,
    }) as HTMLInputElement;
    const safetyVestCheckbox = screen.getByRole('checkbox', {
      name: /Safety Vest/i,
    }) as HTMLInputElement;
    const submitBtn = screen.getByRole('button', { name: /Save Zone PPE/i });

    // 1. Submit with empty code -> validation error
    await user.click(submitBtn);
    expect(await screen.findByText(/Zone Code is required/i)).toBeDefined();
    expect(createZoneSpy).not.toHaveBeenCalled();

    // 2. Control characters must be REJECTED, not silently stripped
    await user.type(codeInput, 'ZONE\x00HAZ');
    await user.type(nameInput, 'Valid Name');
    await user.click(submitBtn);
    expect(await screen.findByText(/Zone Code must not contain control characters/i)).toBeDefined();
    expect(createZoneSpy).not.toHaveBeenCalled();

    // Clear and enter valid code, then test control character in name
    await user.clear(codeInput);
    await user.type(codeInput, 'ZONE-01');
    await user.clear(nameInput);
    await user.type(nameInput, 'Scaffold\x1FArea');
    await user.click(submitBtn);
    expect(await screen.findByText(/Zone Name must not contain control characters/i)).toBeDefined();
    expect(createZoneSpy).not.toHaveBeenCalled();

    // Fill valid name
    await user.clear(nameInput);
    await user.type(nameInput, 'Hazardous Perimeter');

    // 3. Uncheck BOTH core PPE items
    await user.click(hardHatCheckbox);
    expect(hardHatCheckbox.checked).toBe(false);
    await user.click(safetyVestCheckbox);
    expect(safetyVestCheckbox.checked).toBe(false);

    // Submit with zero core items selected -> blocked
    await user.click(submitBtn);
    expect(await screen.findByText(/At least one PPE item must be selected/i)).toBeDefined();
    expect(createZoneSpy).not.toHaveBeenCalled();

    // Re-check Hard Hat -> valid state
    await user.click(hardHatCheckbox);
    expect(hardHatCheckbox.checked).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 5. MODEL CAPABILITY & UNSUPPORTED PPE GUARD
  // --------------------------------------------------------------------------
  it('enforces PPE capability boundaries: Harness/Mask/Hook unsupported, Gloves/Boots/Goggles selectable experimental', async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSiteManagerSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });
    await user.click(screen.getByRole('button', { name: /Configure PPE by Zone/i }));

    // Expanded items: rendered as selectable with experimental technical capability
    const glovesCheckbox = screen.getByRole('checkbox', { name: /Gloves/i }) as HTMLInputElement;
    const bootsCheckbox = screen.getByRole('checkbox', { name: /Boots/i }) as HTMLInputElement;
    const gogglesCheckbox = screen.getByRole('checkbox', { name: /Goggles/i }) as HTMLInputElement;

    expect(glovesCheckbox.disabled).toBe(false);
    expect(bootsCheckbox.disabled).toBe(false);
    expect(gogglesCheckbox.disabled).toBe(false);
    expect(glovesCheckbox.checked).toBe(false);
    expect(bootsCheckbox.checked).toBe(false);
    expect(gogglesCheckbox.checked).toBe(false);

    // Unsupported items: visible but disabled with explicit unsupported notice
    const harnessCheckbox = screen.getByRole('checkbox', { name: /Harness/i }) as HTMLInputElement;
    const maskCheckbox = screen.getByRole('checkbox', { name: /Mask/i }) as HTMLInputElement;
    const hookCheckbox = screen.getByRole('checkbox', { name: /Hook/i }) as HTMLInputElement;

    expect(harnessCheckbox.disabled).toBe(true);
    expect(maskCheckbox.disabled).toBe(true);
    expect(hookCheckbox.disabled).toBe(true);
    expect(harnessCheckbox.checked).toBe(false);
    expect(maskCheckbox.checked).toBe(false);
    expect(hookCheckbox.checked).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 6. CONCURRENCY: NO DUPLICATE PENDING SUBMIT GUARD
  // --------------------------------------------------------------------------
  it('prevents duplicate submissions while zone creation mutation is in-flight', async () => {
    const user = userEvent.setup();

    let resolveMutation!: (value: ZoneResponse) => void;
    const createZoneSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createZone')
      .mockReturnValue(
        new Promise<ZoneResponse>((resolve) => {
          resolveMutation = resolve;
        }),
      );

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSiteManagerSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });
    await user.click(screen.getByRole('button', { name: /Configure PPE by Zone/i }));

    const codeInput = screen.getByLabelText(/Zone Code/i);
    const nameInput = screen.getByLabelText(/Zone Name/i);
    await user.type(codeInput, 'ZONE-PENDING-01');
    await user.type(nameInput, 'Pending Area');

    const submitBtn = screen.getByRole('button', { name: /Save Zone PPE/i }) as HTMLButtonElement;
    await user.click(submitBtn);

    // Mutation is now in-flight
    expect(createZoneSpy).toHaveBeenCalledTimes(1);

    // While pending, submit button is disabled and shows loading text
    const pendingBtn = screen.getByRole('button', { name: /Saving.../i }) as HTMLButtonElement;
    expect(pendingBtn.disabled).toBe(true);

    // Clicking again must not fire a second mutation call
    await user.click(pendingBtn);
    expect(createZoneSpy).toHaveBeenCalledTimes(1);

    // Resolve deferred mutation
    await act(async () => {
      resolveMutation({
        id: 'zone-pending-01',
        siteId: 'site-alpha',
        code: 'ZONE-PENDING-01',
        name: 'Pending Area',
        type: 'HAZARDOUS',
        restrictionPolicy: 'NONE',
        requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
        configurationLocked: false,
        createdAt: '2026-10-07T00:00:00Z',
      });
    });

    expect(await screen.findByText(/created successfully/i)).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // 7. SCOPE RESET: SITE SWITCH UNMOUNTS PANEL AND PREVENTS STALE SUCCESS
  // --------------------------------------------------------------------------
  it('resets form state and prevents stale success banner on site switch', async () => {
    const user = userEvent.setup();

    vi.spyOn(SmartSiteManagementClient.prototype, 'createZone').mockResolvedValue({
      id: 'zone-site-a',
      siteId: 'site-alpha',
      code: 'ZONE-A',
      name: 'Zone Site A',
      type: 'HAZARDOUS',
      restrictionPolicy: 'NONE',
      requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
      configurationLocked: false,
      createdAt: '2026-10-07T00:00:00Z',
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSiteManagerSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });
    await user.click(screen.getByRole('button', { name: /Configure PPE by Zone/i }));

    const codeInput = screen.getByLabelText(/Zone Code/i);
    const nameInput = screen.getByLabelText(/Zone Name/i);
    await user.type(codeInput, 'ZONE-A');
    await user.type(nameInput, 'Zone Site A');
    await user.click(screen.getByRole('button', { name: /Save Zone PPE/i }));

    // Success banner visible for site-alpha
    expect(await screen.findByText(/Zone "ZONE-A" created successfully/i)).toBeDefined();

    // A modal keeps the background inert; close it before switching the site.
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    // User switches Site to site-beta
    const siteSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    await user.selectOptions(siteSelect, 'site-beta');

    // Panel is closed on site switch, and site-alpha success banner does NOT paint on site-beta
    expect(screen.queryByRole('heading', { name: 'Zone PPE configuration' })).toBeNull();
    expect(screen.queryByText(/Zone "ZONE-A" created successfully/i)).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 8. IN-FLIGHT TOKEN ROTATION / LATE SUCCESS UNMOUNT SIDE-EFFECT GUARD
  // --------------------------------------------------------------------------
  it('guards against in-flight late mutation success on token rotation and prevents state leakage', async () => {
    const user = userEvent.setup();

    let resolveInFlight!: (value: ZoneResponse) => void;
    vi.spyOn(SmartSiteManagementClient.prototype, 'createZone').mockReturnValue(
      new Promise<ZoneResponse>((resolve) => {
        resolveInFlight = resolve;
      }),
    );

    const sessionV1: SharedSession = {
      accessToken: 'token-rotation-1',
      sessionScope: 'scope-token-1',
      user: {
        id: 'site-manager-1',
        displayName: 'Site Manager User',
        roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'site-alpha' }],
      },
    };

    const sessionV2: SharedSession = {
      accessToken: 'token-rotation-2',
      sessionScope: 'scope-token-2',
      user: {
        id: 'site-manager-1',
        displayName: 'Site Manager User',
        roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'site-alpha' }],
      },
    };

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={sessionV1} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });
    await user.click(screen.getByRole('button', { name: /Configure PPE by Zone/i }));

    const codeInput = screen.getByLabelText(/Zone Code/i);
    const nameInput = screen.getByLabelText(/Zone Name/i);
    await user.type(codeInput, 'ZONE-ROTATION');
    await user.type(nameInput, 'Rotation Test');

    // Trigger mutation while on sessionV1
    await user.click(screen.getByRole('button', { name: /Save Zone PPE/i }));

    // Now rotate token to sessionV2 while mutation is still in-flight
    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={sessionV2} />
      </QueryClientProvider>,
    );

    // Panel is closed synchronously on scope token change
    expect(screen.queryByRole('heading', { name: 'Zone PPE configuration' })).toBeNull();

    // Now resolve the late deferred response from sessionV1
    await act(async () => {
      resolveInFlight({
        id: 'zone-late',
        siteId: 'site-alpha',
        code: 'ZONE-ROTATION',
        name: 'Rotation Test',
        type: 'HAZARDOUS',
        restrictionPolicy: 'NONE',
        requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
        configurationLocked: false,
        createdAt: '2026-10-07T00:00:00Z',
      });
    });

    // The late response must NOT paint success banner on the new sessionV2 scope
    expect(screen.queryByText(/Zone "ZONE-ROTATION" created successfully/i)).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 9. COMPACT SCOPED ZONE LIST WITH requiredPpe LABELS & WRONGSCOPE DATA REJECT
  // --------------------------------------------------------------------------
  it('renders compact scoped zone list with code, name, and requiredPpe labels, and rejects mismatched sites', async () => {
    const user = userEvent.setup();

    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
      items: [
        {
          id: 'zone-valid-alpha-1',
          siteId: 'site-alpha',
          code: 'ZONE-A1',
          name: 'Alpha Scaffold Area',
          type: 'HAZARDOUS',
          restrictionPolicy: 'NONE',
          requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
          configurationLocked: false,
          createdAt: '2026-10-07T00:00:00Z',
        },
        {
          id: 'zone-valid-alpha-2',
          siteId: 'site-alpha',
          code: 'ZONE-A2',
          name: 'Helmet Only Area',
          type: 'HAZARDOUS',
          restrictionPolicy: 'NONE',
          requiredPpe: ['HARD_HAT'],
          configurationLocked: false,
          createdAt: '2026-10-07T00:00:00Z',
        },
        {
          id: 'zone-wrong-gamma',
          siteId: 'site-gamma', // Mismatched siteId!
          code: 'ZONE-GAMMA',
          name: 'Leaked Gamma Zone',
          type: 'HAZARDOUS',
          restrictionPolicy: 'NONE',
          requiredPpe: ['HARD_HAT', 'GLOVES'],
          configurationLocked: false,
          createdAt: '2026-10-07T00:00:00Z',
        },
      ],
      total: 3,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockGlobalAdminSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });
    await user.click(screen.getByRole('button', { name: /Configure PPE by Zone/i }));

    // The list reports its loaded scope separately from the API's total.
    expect(await screen.findByText(/Configured Zones for this Site/i)).toBeDefined();

    // Exactly 2 valid zones on site-alpha rendered
    expect(screen.getByText('Showing 2 of 3 zones')).toBeDefined();
    expect(screen.getByText('ZONE-A1')).toBeDefined();
    expect(screen.getByText('Alpha Scaffold Area')).toBeDefined();
    expect(screen.getByText('ZONE-A2')).toBeDefined();
    expect(screen.getByText('Helmet Only Area')).toBeDefined();

    // PPE labels rendered in zone list
    expect(screen.getAllByText('Hard Hat / Helmet').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Safety Vest').length).toBeGreaterThanOrEqual(1);

    // Mismatched site-gamma zone is strictly excluded and never rendered
    expect(screen.queryByText('ZONE-GAMMA')).toBeNull();
    expect(screen.queryByText('Leaked Gamma Zone')).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 10. WRONG-SITE CREATE RESPONSE GUARD
  // --------------------------------------------------------------------------
  it('guards against mismatched siteId returned in createZone response', async () => {
    const user = userEvent.setup();

    // Backend anomalously returns a zone with a mismatched siteId
    vi.spyOn(SmartSiteManagementClient.prototype, 'createZone').mockResolvedValue({
      id: 'zone-mismatch-99',
      siteId: 'site-mismatch-omega', // Mismatched site!
      code: 'ZONE-MISMATCH',
      name: 'Mismatch Zone',
      type: 'HAZARDOUS',
      restrictionPolicy: 'NONE',
      requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
      configurationLocked: false,
      createdAt: '2026-10-07T00:00:00Z',
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSiteManagerSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });
    await user.click(screen.getByRole('button', { name: /Configure PPE by Zone/i }));

    const codeInput = screen.getByLabelText(/Zone Code/i);
    const nameInput = screen.getByLabelText(/Zone Name/i);
    await user.type(codeInput, 'ZONE-MISMATCH');
    await user.type(nameInput, 'Mismatch Zone');
    await user.click(screen.getByRole('button', { name: /Save Zone PPE/i }));

    // Must NOT show success banner
    expect(screen.queryByText(/created successfully/i)).toBeNull();
    // Must show scope mismatch error
    expect(
      await screen.findByText(/Zone was created with an unexpected site scope/i),
    ).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // 11. SECURITY & ERROR SAFETY: 401/403/409 SAFE PUBLIC TEXT WITH ApiError
  // --------------------------------------------------------------------------
  it('displays safe public error text on 401, 403, and 409 API errors without leaking secret details', async () => {
    const user = userEvent.setup();

    // 11A: 401 Unauthorized using ApiError(code: 'http', message, status: 401)
    const createZoneSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createZone')
      .mockRejectedValueOnce(new ApiError('http', 'Secret JWT invalid: key-999', 401));

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSiteManagerSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });
    await user.click(screen.getByRole('button', { name: /Configure PPE by Zone/i }));

    const codeInput = screen.getByLabelText(/Zone Code/i);
    const nameInput = screen.getByLabelText(/Zone Name/i);
    await user.type(codeInput, 'ZONE-ERR');
    await user.type(nameInput, 'Zone Error Test');
    await user.click(screen.getByRole('button', { name: /Save Zone PPE/i }));

    // Safe 401 text
    expect(
      await screen.findByText(/Session expired or unauthorized\. Please sign in again\./i),
    ).toBeDefined();
    // Raw secret must NOT be leaked
    expect(screen.queryByText(/Secret JWT invalid/i)).toBeNull();

    // 11B: 403 Forbidden using ApiError(code: 'http', message, status: 403)
    createZoneSpy.mockRejectedValueOnce(new ApiError('http', 'Secret RBAC denial trace', 403));
    await user.click(screen.getByRole('button', { name: /Save Zone PPE/i }));

    expect(
      await screen.findByText('You do not have permission to perform this action.'),
    ).toBeDefined();
    expect(screen.queryByText(/Secret RBAC denial trace/i)).toBeNull();

    // 11C: 409 Conflict using ApiError(code: 'http', message, status: 409)
    createZoneSpy.mockRejectedValueOnce(new ApiError('http', 'Unique constraint pkey_zones', 409));
    await user.click(screen.getByRole('button', { name: /Save Zone PPE/i }));

    expect(
      await screen.findByText(/A zone with this code already exists for this site\./i),
    ).toBeDefined();
    expect(screen.queryByText(/Unique constraint pkey_zones/i)).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 12. UNCONTROLLED AUTH: RESOLVES ROLE VIA ME QUERY WITHOUT SHARED-SESSION PROP
  // --------------------------------------------------------------------------
  it('resolves Global Admin role via me query in uncontrolled auth mode without sharedSession prop', async () => {
    const user = userEvent.setup();

    // Mock client.me returning Global Admin profile
    vi.spyOn(SmartSiteManagementClient.prototype, 'me').mockResolvedValue({
      id: 'uncontrolled-admin-01',
      username: 'admin',
      displayName: 'Uncontrolled Global Admin',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'ADMIN', siteId: null }],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{
            accessToken: 'uncontrolled-token-123',
            sessionScope: 'uncontrolled-scope-456',
            setAccessToken: vi.fn(),
            isSessionExpired: false,
            triggerSessionExpired: vi.fn(),
            dismissSessionExpired: vi.fn(),
          }}
        >
          <PpeMonitoringView />
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    // Once me query resolves in uncontrolled mode, Global Admin trigger button appears
    const configureBtn = await screen.findByRole('button', { name: /Configure PPE by Zone/i });
    expect(configureBtn).toBeDefined();

    await user.click(configureBtn);
    expect(await screen.findByRole('heading', { name: 'Zone PPE configuration' })).toBeDefined();
  });
});
