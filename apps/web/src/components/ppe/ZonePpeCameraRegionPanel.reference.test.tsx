// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  CONFIGURATION_REFERENCE_LIFETIME_MS,
  SmartSiteManagementClient,
} from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import type {
  CameraConfigurationReference,
  UseCameraConfigurationReferenceOptions,
  UseCameraConfigurationReferenceResult,
} from './useCameraConfigurationReference';
import {
  BASE_TIME_MS,
  CAM_1,
  CAM_2,
  SITE_A,
  SITE_B,
  ZONE_1,
  ZONE_2,
  addPointViaInputs,
  addTriangleViaInputs,
  baseCamera,
  buildCanonicalReference,
  existingRegionFixture,
  installReferencePanelDomPolyfills,
  renderReferencePanel,
  stubCameraAndRegionPages,
  stubRegionMutationSpies,
} from './ZonePpeCameraRegionPanel.reference.fixtures';

installReferencePanelDomPolyfills();

const refHookState = vi.hoisted(() => ({
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
    refHookState.lastOptions = options;
    return {
      reference: options.enabled ? refHookState.reference : null,
      isLoading: refHookState.isLoading,
      error: refHookState.error,
      request: refHookState.requestSpy,
    };
  },
}));

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: () => ({
    preview: null,
    status: 'UNAVAILABLE',
    sourceKind: null,
    error: null,
    errorStatus: null,
    isError: false,
    isLoading: false,
    isPolling: false,
    retry: vi.fn(),
    cameraExternalId: null,
    capturedAt: null,
  }),
}));

describe('ZonePpeCameraRegionPanel Configuration Reference Journeys', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
    vi.spyOn(Date, 'now').mockReturnValue(BASE_TIME_MS);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    refHookState.reference = null;
    refHookState.isLoading = false;
    refHookState.error = null;
    refHookState.lastOptions = null;
    refHookState.requestImpl = null;
    refHookState.requestSpy = vi.fn(async () => {
      await refHookState.requestImpl?.();
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('requires a matching camera revision before opening a new drawing', async () => {
    const user = userEvent.setup();
    refHookState.reference = buildCanonicalReference({ configurationVersion: 3 });
    stubCameraAndRegionPages([{ ...baseCamera, configurationVersion: 4 }], []);
    const { rerenderWith } = renderReferencePanel(queryClient);
    await waitFor(() => expect(refHookState.lastOptions?.cameraId).toBe(CAM_1));
    expect(await screen.findByRole('button', { name: /Start Drawing Region/i })).toHaveProperty(
      'disabled',
      true,
    );
    refHookState.requestImpl = async () => {
      refHookState.reference = buildCanonicalReference({ configurationVersion: 4 });
    };
    await user.click(screen.getByRole('button', { name: /Get configuration image/i }));
    rerenderWith();
    expect(screen.getByRole('button', { name: /Start Drawing Region/i })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('requests a configuration image only on explicit button click when AI is paused, makes zero preview/media/AI calls, and displays sourceKind, capture time, and expiry', async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    const user = userEvent.setup();
    stubCameraAndRegionPages([baseCamera], [existingRegionFixture]);

    const previewSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview');
    const streamSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'streamCameraVideo');
    const recordSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'readRecordedCameraVideo');
    const demoStatusSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'getMf05DemoStatus');
    const demoApplySpy = vi.spyOn(SmartSiteManagementClient.prototype, 'applyMf05DemoRegion');

    const { rerenderWith } = renderReferencePanel(queryClient);

    const startDrawBtn = await screen.findByRole('button', { name: /Start Drawing Region/i });
    const editBtn = await screen.findByRole('button', { name: /Edit Geometry/i });
    expect(startDrawBtn).toHaveProperty('disabled', true);
    expect(editBtn).toHaveProperty('disabled', true);
    expect(refHookState.requestSpy).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(refHookState.lastOptions).toEqual({
        apiUrl: 'http://localhost:3000',
        token: 'admin-jwt-token',
        sessionScope: 'admin:GLOBAL',
        credentialId: 7,
        siteId: SITE_A,
        cameraId: CAM_1,
        cameraExternalId: 'CAM-EXT-01',
        enabled: true,
      });
    });

    const getRefBtn = screen.getByRole('button', { name: /Get configuration image/i });
    expect(getRefBtn).toHaveProperty('disabled', false);

    refHookState.requestImpl = async () => {
      refHookState.reference = buildCanonicalReference(
        { sourceKind: 'REPLAY', referenceExpiresAt: '2026-10-15T09:05:00.000Z' },
        { capturedAt: '2026-10-15T09:00:00.000Z' },
      );
    };

    await user.click(getRefBtn);
    expect(refHookState.requestSpy).toHaveBeenCalledTimes(1);
    rerenderWith();

    expect(screen.getByText(/REPLAY/i)).toBeDefined();
    expect(screen.getByText(/2026-10-15T09:00:00/i)).toBeDefined();
    expect(screen.getByText(/2026-10-15T09:05:00/i)).toBeDefined();
    expect(screen.queryByText(/Live AI Observations Active/i)).toBeNull();
    expect(screen.getByRole('button', { name: /Start Drawing Region/i })).toHaveProperty(
      'disabled',
      false,
    );
    expect(screen.getByRole('button', { name: /Edit Geometry/i })).toHaveProperty(
      'disabled',
      false,
    );
    expect(previewSpy).not.toHaveBeenCalled();
    expect(streamSpy).not.toHaveBeenCalled();
    expect(recordSpy).not.toHaveBeenCalled();
    expect(demoStatusSpy).not.toHaveBeenCalled();
    expect(demoApplySpy).not.toHaveBeenCalled();
  });

  it('uses the 5-minute referenceExpiresAt lifetime rather than the 5-second monitoring preview TTL, and hides pixels while keeping vertices after expiry', async () => {
    vi.mocked(Date.now).mockRestore();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(BASE_TIME_MS);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    refHookState.reference = buildCanonicalReference(
      { referenceExpiresAt: '2026-10-15T09:05:00.000Z' },
      { capturedAt: '2026-10-15T09:00:00.000Z' },
    );
    stubCameraAndRegionPages([baseCamera], []);
    renderReferencePanel(queryClient);

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    await addTriangleViaInputs(user);
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();

    // Advance 10s (past old 5s monitoring preview TTL, within 5-minute referenceExpiresAt)
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    const canvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);
    expect(canvas.querySelector('image')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Save Region/i })).toHaveProperty('disabled', false);

    // Advance past 5-minute referenceExpiresAt
    act(() => {
      vi.advanceTimersByTime(CONFIGURATION_REFERENCE_LIFETIME_MS);
    });
    expect(canvas.querySelector('image')).toBeNull();
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Save Region/i })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /Add Point/i })).toHaveProperty('disabled', true);
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(screen.getByText(/Discard unsaved region geometry changes/i)).toBeDefined();
  });

  it('enforces frozen reference configurationVersion on new-region create preflight (refusing 409 or externalId mismatch) and advances revision only after own save', async () => {
    const user = userEvent.setup();
    refHookState.reference = buildCanonicalReference({ configurationVersion: 3 });

    let serverCamera: CameraResponse = { ...baseCamera, configurationVersion: 4 };
    stubCameraAndRegionPages([baseCamera], []);
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockImplementation(
      async () => serverCamera,
    );
    const demoApplySpy = vi.spyOn(SmartSiteManagementClient.prototype, 'applyMf05DemoRegion');
    const { createSpy, updateSpy } = stubRegionMutationSpies(() => {
      serverCamera = { ...serverCamera, configurationVersion: 4 };
    });

    renderReferencePanel(queryClient);

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    await addTriangleViaInputs(user);

    // 1. Camera revision drifted to 4 while reference is frozen at 3 -> refuses create with 409
    await user.click(screen.getByRole('button', { name: /Save Region/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Configuration version conflict/i,
    );
    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();

    // 2. Camera externalId mismatch -> refuses preflight without POST/PATCH
    serverCamera = { ...baseCamera, configurationVersion: 3, externalId: 'CAM-EXT-CHANGED' };
    await user.click(screen.getByRole('button', { name: /Save Region/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Camera metadata changed or became inactive/i,
    );
    expect(createSpy).not.toHaveBeenCalled();

    // 3. Matching reference configurationVersion 3 -> creates region and advances edit revision to 4
    serverCamera = { ...baseCamera, configurationVersion: 3 };
    await user.click(screen.getByRole('button', { name: /Save Region/i }));
    expect(await screen.findByText(/Saved region "reg-created-1" \(v1\)/i)).toBeDefined();
    expect(createSpy).toHaveBeenCalledWith(
      'admin-jwt-token',
      SITE_A,
      CAM_1,
      {
        zoneId: ZONE_1,
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

    // 4. Subsequent edit uses acknowledged configurationVersion 4 and triggers no automatic model apply
    await addPointViaInputs(user, '0.2', '0.7');
    await user.click(screen.getByRole('button', { name: /Save Region/i }));
    expect(await screen.findByText(/Saved region "reg-created-1" \(v2\)/i)).toBeDefined();
    expect(updateSpy).toHaveBeenCalledWith(
      'admin-jwt-token',
      SITE_A,
      CAM_1,
      'reg-created-1',
      expect.objectContaining({ expectedConfigurationVersion: 4 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(demoApplySpy).not.toHaveBeenCalled();
  });

  it('refuses existing-region update preflight (409) when camera configurationVersion differs from the frozen reference revision and retains unsaved edits', async () => {
    const user = userEvent.setup();
    refHookState.reference = buildCanonicalReference({ configurationVersion: 5 });

    stubCameraAndRegionPages([{ ...baseCamera, configurationVersion: 5 }], [existingRegionFixture]);
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockResolvedValue({
      ...baseCamera,
      configurationVersion: 6,
    });
    const { createSpy, updateSpy } = stubRegionMutationSpies();

    renderReferencePanel(queryClient);

    await user.click(await screen.findByRole('button', { name: /Edit Geometry/i }));
    await addPointViaInputs(user, '0.25', '0.75');
    expect(screen.getByText(/Points: 4 \/ 32/i)).toBeDefined();

    await user.click(screen.getByRole('button', { name: /Save Region/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Configuration version conflict/i,
    );
    expect(updateSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/Points: 4 \/ 32/i)).toBeDefined();
  });

  it('requires explicit confirmation before binding a drawing draft to a refreshed reference and never resurrects expired pixels on failed refresh', async () => {
    const user = userEvent.setup();
    refHookState.reference = buildCanonicalReference(
      { configurationVersion: 3 },
      { sequenceNumber: '1', capturedAt: '2026-10-15T09:00:00.000Z' },
    );

    let currentCamera: CameraResponse = { ...baseCamera, configurationVersion: 3 };
    stubCameraAndRegionPages([currentCamera], []);
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockImplementation(
      async () => currentCamera,
    );
    const { createSpy } = stubRegionMutationSpies();

    const { rerenderWith } = renderReferencePanel(queryClient);

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    await addTriangleViaInputs(user);

    vi.mocked(Date.now).mockReturnValue(BASE_TIME_MS + 60_000);
    // 1. Requesting 'Review new reference' fetches candidate v4 without silently rebinding draft
    refHookState.requestImpl = async () => {
      currentCamera = { ...baseCamera, configurationVersion: 4 };
      refHookState.reference = buildCanonicalReference(
        { configurationVersion: 4 },
        { sequenceNumber: '2', capturedAt: '2026-10-15T09:01:00.000Z' },
      );
    };
    await user.click(screen.getByRole('button', { name: /Review new reference/i }));
    rerenderWith();

    // 2. Confirming 'Use new reference' retains points and binds editor to candidate v4
    await user.click(screen.getByRole('button', { name: /Use new reference/i }));
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();
    await user.click(screen.getByRole('button', { name: /Save Region/i }));
    expect(createSpy).toHaveBeenCalledWith(
      'admin-jwt-token',
      SITE_A,
      CAM_1,
      expect.objectContaining({ expectedConfigurationVersion: 4 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    vi.mocked(Date.now).mockReturnValue(BASE_TIME_MS + 361_000);
    // 3. A failed refresh after the accepted reference expires does not resurrect pixels
    refHookState.reference = null;
    refHookState.error = new ApiError('http', 'Configuration image unavailable', 503);
    rerenderWith();
    expect(
      screen.queryByLabelText(/Camera Region Drawing Canvas/i)?.querySelector('image') ?? null,
    ).toBeNull();
  });

  it('synchronously clears reference pixels and closes the drawing editor on Site, camera, Zone, or auth scope changes and 401/403/404 metadata errors', async () => {
    const user = userEvent.setup();
    refHookState.reference = buildCanonicalReference({ configurationVersion: 3 });

    const secondCamera: CameraResponse = {
      ...baseCamera,
      id: CAM_2,
      code: 'CAM-02',
      name: 'South Gate Camera',
      externalId: 'CAM-EXT-02',
    };
    stubCameraAndRegionPages([baseCamera, secondCamera], []);

    const { rerenderWith } = renderReferencePanel(queryClient);

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    expect(screen.getByLabelText(/Camera Region Drawing Canvas/i)).toBeDefined();

    // Switching Zone closes active editor synchronously
    await user.selectOptions(screen.getByLabelText(/Select Zone/i), ZONE_2);
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();

    // Reopen editor on ZONE_2, then switch Camera -> closes active editor synchronously
    await user.click(screen.getByRole('button', { name: /Start Drawing Region/i }));
    expect(screen.getByLabelText(/Camera Region Drawing Canvas/i)).toBeDefined();
    await user.selectOptions(screen.getByLabelText(/Select Camera/i), CAM_2);
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();

    // Metadata 403 error revokes drawing availability and clears active editor
    vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockRejectedValue(
      new ApiError('http', 'Forbidden', 403),
    );
    await user.selectOptions(screen.getByLabelText(/Select Camera/i), CAM_1);
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /do not have permission to view these regions/i,
    );
    expect(screen.getByRole('button', { name: /Start Drawing Region/i })).toHaveProperty(
      'disabled',
      true,
    );

    // Changing siteId/token/sessionScope/credentialId clears editor and reference scope synchronously
    refHookState.reference = null;
    rerenderWith({
      token: 'rotated-jwt-token',
      sessionScope: 'admin:GLOBAL:2',
      credentialId: 8,
      siteId: SITE_B,
      zones: [],
    });
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
  });
});
