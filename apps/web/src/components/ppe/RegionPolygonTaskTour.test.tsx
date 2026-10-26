// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  CONFIGURATION_REFERENCE_LIFETIME_MS,
  SmartSiteManagementClient,
  type ReferenceRegionMutationResponse,
  type ZoneResponse,
} from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { SAFETY_TOUR_STORAGE_KEY } from '../safety/safetyTaskTourModel';
import { PpeDialog } from './PpeDialog';
import {
  ZonePpeCameraRegionDrawer,
  type ZonePpeCameraRegionDrawerProps,
} from './ZonePpeCameraRegionDrawer';
import type { CameraConfigurationReference } from './useCameraConfigurationReference';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const TRIANGLE: [number, number][] = [
  [0.1, 0.1],
  [0.8, 0.1],
  [0.8, 0.8],
];

function createCamera(overrides: Partial<CameraResponse> = {}): CameraResponse {
  return {
    id: 'cam-1',
    siteId: 'site-alpha',
    externalId: 'CAM-EXT-01',
    code: 'CAM-01',
    name: 'Scaffold Camera 01',
    status: 'ACTIVE',
    configurationVersion: 3,
    createdAt: '2026-09-30T00:00:00Z',
    ...overrides,
  };
}

function createZone(overrides: Partial<ZoneResponse> = {}): ZoneResponse {
  return {
    id: 'zone-1',
    siteId: 'site-alpha',
    code: 'ZONE-A1',
    name: 'Hazardous Scaffold Area',
    type: 'HAZARDOUS',
    restrictionPolicy: 'NONE',
    requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
    configurationLocked: false,
    createdAt: '2026-10-07T00:00:00Z',
    ...overrides,
  };
}

function createReference(
  overrides: Partial<Omit<CameraConfigurationReference, 'issuedReference'>> = {},
): CameraConfigurationReference {
  const nowMs = Date.now();
  const referenceExpiresAt =
    overrides.referenceExpiresAt ??
    new Date(nowMs + CONFIGURATION_REFERENCE_LIFETIME_MS).toISOString();
  const expiresAtMs = Date.parse(referenceExpiresAt);
  const defaultCapturedAtMs = Number.isFinite(expiresAtMs)
    ? Math.min(nowMs, expiresAtMs - CONFIGURATION_REFERENCE_LIFETIME_MS)
    : nowMs;
  const capturedAt = overrides.frame?.capturedAt ?? new Date(defaultCapturedAtMs).toISOString();
  const siteId = overrides.siteId ?? 'site-alpha';
  const cameraId = overrides.cameraId ?? 'cam-1';
  const configurationVersion = overrides.configurationVersion ?? 3;
  const sourceKind = overrides.sourceKind ?? 'LIVE';
  const frame = {
    sessionId: '00000000-0000-4000-8000-000000000001',
    sequenceNumber: '1',
    cameraExternalId: 'CAM-EXT-01',
    capturedAt,
    width: 640,
    height: 480,
    imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    imageSha256: 'a'.repeat(64),
    ...overrides.frame,
  };
  return {
    schemaVersion: 1,
    purpose: 'REGION_CONFIGURATION',
    siteId,
    cameraId,
    configurationVersion,
    sourceKind,
    referenceExpiresAt,
    ...overrides,
    frame,
    issuedReference: {
      schemaVersion: '1.0.0',
      purpose: 'REGION_CONFIGURATION',
      sourceKind,
      referenceId: '00000000-0000-4000-8000-000000000099',
      siteId,
      cameraId,
      sessionId: frame.sessionId,
      imageSha256: frame.imageSha256,
      width: frame.width,
      height: frame.height,
      capturedAt: frame.capturedAt,
      issuedAt: frame.capturedAt,
      expiresAt: referenceExpiresAt,
      configurationVersion,
      viewRevision: 1,
    },
    image: {} as HTMLImageElement,
  };
}

function addTriangle() {
  for (const [x, y] of TRIANGLE) {
    fireEvent.change(screen.getByLabelText('Point X (0–1)'), { target: { value: String(x) } });
    fireEvent.change(screen.getByLabelText('Point Y (0–1)'), { target: { value: String(y) } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Point' }));
  }
}

const expectTourStep = (stepId: string) =>
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(stepId);

describe('RegionPolygonTaskTour', () => {
  let queryClient: QueryClient;
  let defaultReference: CameraConfigurationReference;

  beforeEach(async () => {
    window.localStorage.clear();
    await i18n.changeLanguage('en');
    defaultReference = createReference();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const buildDrawerProps = (
    overrides: Partial<ZonePpeCameraRegionDrawerProps> = {},
  ): ZonePpeCameraRegionDrawerProps => ({
    apiUrl: 'http://localhost:3000',
    token: 'secret-jwt-token',
    sessionScope: 'scope-01',
    credentialId: 1,
    internalNonce: 1,
    siteId: 'site-alpha',
    selectedCamera: createCamera(),
    selectedZone: createZone(),
    frozenReference: defaultReference,
    candidateReference: null,
    editingRegion: null,
    lastSavedDraft: null,
    onAcceptCandidateReference: vi.fn(),
    onCancelCandidateReview: vi.fn(),
    onScopeRevoked: vi.fn(),
    onSaveSuccess: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  });

  const renderDrawer = (overrides: Partial<ZonePpeCameraRegionDrawerProps> = {}) =>
    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionDrawer {...buildDrawerProps(overrides)} />
      </QueryClientProvider>,
    );

  const rerenderDrawer = (
    view: ReturnType<typeof render>,
    overrides: Partial<ZonePpeCameraRegionDrawerProps> = {},
  ) =>
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionDrawer {...buildDrawerProps(overrides)} />
      </QueryClientProvider>,
    );

  it('stays closed by default, walks 4 steps without mutating draft points or making API calls, persists progress across logins for the same authorized tourUserId, isolates different users, and persists nothing when tourUserId is null', () => {
    const getCameraSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera');
    const createReferenceSpy = vi.spyOn(
      SmartSiteManagementClient.prototype,
      'createReferenceRegion',
    );
    const updateReferenceSpy = vi.spyOn(
      SmartSiteManagementClient.prototype,
      'updateReferencePolygon',
    );
    const createSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion');
    const updateSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'updatePolygon');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    // 1. Unknown/null tourUserId persists nothing to localStorage (never substitutes sessionScope or token)
    const view = renderDrawer({ tourUserId: null });
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    addTriangle();
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeTruthy();

    const trigger = screen.getByTestId('safety-task-tour-trigger');
    expect(trigger.textContent).toBe('Guided help');
    fireEvent.click(trigger);

    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
    for (const [stepId, title, isDone] of [
      ['polygon-frozen-reference', 'Check Reference Image', false],
      ['polygon-canvas', 'Place Region Points', false],
      ['polygon-edit-controls', 'Adjust Points & View', false],
      ['polygon-save-footer', 'Save or Cancel', true],
    ] as const) {
      expectTourStep(stepId);
      expect(screen.getByText(title)).toBeTruthy();
      fireEvent.click(
        screen.getByTestId(isDone ? 'safety-task-tour-done' : 'safety-task-tour-next'),
      );
    }
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    expect(trigger.textContent).toBe('Replay guide');

    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeTruthy();
    for (const name of ['Vertex 1 (0.1, 0.1)', 'Vertex 2 (0.8, 0.1)', 'Vertex 3 (0.8, 0.8)']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(getCameraSpy).not.toHaveBeenCalled();
    expect(createReferenceSpy).not.toHaveBeenCalled();
    expect(updateReferenceSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY)).toBeNull();

    // 2. Authorized tourUserId persists progress across a new sessionScope / credentialId login
    rerenderDrawer(view, { tourUserId: 'user-manager-1', sessionScope: 'scope-login-1' });
    expect(screen.getByTestId('safety-task-tour-trigger').textContent).toBe('Guided help');
    fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
    fireEvent.click(screen.getByTestId('safety-task-tour-skip'));
    expect(JSON.parse(window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY) ?? '{}')).toEqual({
      'user-manager-1:polygon:v1': { status: 'SKIPPED', tourVersion: 1 },
    });

    // Same user with a brand-new sessionScope, credentialId, and frozenReference retains "Replay guide"
    rerenderDrawer(view, {
      tourUserId: 'user-manager-1',
      sessionScope: 'scope-login-2',
      credentialId: 2,
      internalNonce: 2,
      frozenReference: createReference({
        frame: { ...defaultReference.frame, sequenceNumber: '2' },
      }),
    });
    expect(screen.getByTestId('safety-task-tour-trigger').textContent).toBe('Replay guide');

    // 3. Different authorized user is isolated and sees "Guided help"
    rerenderDrawer(view, {
      tourUserId: 'user-manager-2',
      sessionScope: 'scope-login-3',
      credentialId: 3,
      internalNonce: 3,
    });
    expect(screen.getByTestId('safety-task-tour-trigger').textContent).toBe('Guided help');
  });

  it('resets tour session on credential, site, camera, frozen reference, or editingRegion owner change, and hides when scope mismatches', () => {
    const view = renderDrawer();
    const openAndAdvance = () => {
      fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
      fireEvent.click(screen.getByTestId('safety-task-tour-next'));
      expectTourStep('polygon-canvas');
    };

    openAndAdvance();
    rerenderDrawer(view, { credentialId: 2 });
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();

    const betaCam = createCamera({ id: 'cam-2', siteId: 'site-beta', externalId: 'CAM-EXT-02' });
    const betaRef = createReference({
      siteId: 'site-beta',
      cameraId: 'cam-2',
      frame: { ...createReference().frame, cameraExternalId: 'CAM-EXT-02' },
    });
    const betaProps = {
      siteId: 'site-beta',
      selectedCamera: betaCam,
      selectedZone: createZone({ id: 'zone-2', siteId: 'site-beta' }),
      frozenReference: betaRef,
    };
    rerenderDrawer(view, betaProps);
    openAndAdvance();

    const nextProps = {
      ...betaProps,
      selectedCamera: { ...betaCam, configurationVersion: 4 },
      frozenReference: createReference({
        siteId: 'site-beta',
        cameraId: 'cam-2',
        configurationVersion: 4,
        frame: { ...betaRef.frame, sequenceNumber: '2' },
      }),
    };
    rerenderDrawer(view, nextProps);
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();

    openAndAdvance();
    rerenderDrawer(view, {
      ...nextProps,
      editingRegion: {
        id: 'reg-1',
        version: 2,
        expectedConfigurationVersion: 4,
        initialPoints: TRIANGLE,
      },
    });
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();

    rerenderDrawer(view, { ...betaProps, siteId: 'site-mismatch' });
    expect(screen.queryByTestId('safety-task-tour-trigger')).toBeNull();
  });

  it('closes only the tour and returns focus on Escape inside PpeDialog, yields to child modal dialogs, and preserves dirty Escape prompt afterwards', async () => {
    const onDialogClose = vi.fn();
    const stableDrawerProps = buildDrawerProps();
    function DialogHost({ showChildModal = false }: { showChildModal?: boolean }) {
      return (
        <QueryClientProvider client={queryClient}>
          <PpeDialog open title="Link Zone to Camera Region" onClose={onDialogClose}>
            <ZonePpeCameraRegionDrawer {...stableDrawerProps} />
          </PpeDialog>
          {showChildModal && (
            <PpeDialog open title="Discard unsaved Zone changes?" onClose={vi.fn()}>
              <p>Confirm discard</p>
            </PpeDialog>
          )}
        </QueryClientProvider>
      );
    }

    const view = render(<DialogHost />);
    addTriangle();
    const trigger = screen.getByTestId('safety-task-tour-trigger');
    fireEvent.click(trigger);
    expect(screen.getByTestId('safety-task-tour')).toBeTruthy();

    view.rerender(<DialogHost showChildModal />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('safety-task-tour')).toBeTruthy();

    view.rerender(<DialogHost showChildModal={false} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    expect(onDialogClose).not.toHaveBeenCalled();
    expect(screen.queryByText('Discard unsaved region geometry changes?')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.keyDown(screen.getByLabelText('Point X (0–1)'), { key: 'Escape' });
    expect(screen.getByText('Discard unsaved region geometry changes?')).toBeTruthy();
  });

  it('adapts available steps when reference is expired or save is in flight without unlocking disabled controls', async () => {
    let resolveSave!: (value: ReferenceRegionMutationResponse) => void;
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockResolvedValue(
      createCamera({ configurationVersion: 5 }),
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion').mockImplementation(
      () => new Promise<ReferenceRegionMutationResponse>((resolve) => void (resolveSave = resolve)),
    );

    const view = renderDrawer({
      frozenReference: createReference({
        referenceExpiresAt: new Date(Date.now() - 5_000).toISOString(),
      }),
    });

    expect(screen.getByTestId('stale-image-notice')).toBeTruthy();
    fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expectTourStep('polygon-edit-controls');
    expect(
      (screen.getByRole('button', { name: /Save Region/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    rerenderDrawer(view, {
      selectedCamera: createCamera({ configurationVersion: 5 }),
      frozenReference: createReference({ configurationVersion: 5 }),
    });

    addTriangle();
    fireEvent.click(screen.getByRole('button', { name: /Save Region/i }));
    await waitFor(() => expect(resolveSave).toBeTypeOf('function'));

    fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expectTourStep('polygon-save-footer');
    expect((screen.getByRole('button', { name: /Add Point/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await act(async () => {
      resolveSave({
        region: {
          id: 'reg-saved-1',
          cameraId: 'cam-1',
          zoneId: 'zone-1',
          polygon: { coordinates: TRIANGLE },
          coordinateSpace: 'NORMALIZED_0_1',
          version: 1,
          isActive: true,
          createdAt: '2026-10-07T12:00:00Z',
          geometryConfirmation: {
            status: 'MANUALLY_CONFIRMED',
            referenceId: '00000000-0000-4000-8000-000000000099',
            viewRevision: 1,
            confirmedByUserId: '00000000-0000-4000-8000-000000000077',
            confirmedAt: '2026-10-07T12:00:00.000Z',
          },
        },
        configurationVersion: 6,
      });
    });
  });
});
