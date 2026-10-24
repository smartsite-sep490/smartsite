// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraResponse, RegionResponse } from '@smartsite/contracts';
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
  addPointViaInputs,
  addTriangleViaInputs,
  baseCamera,
  buildCanonicalReference,
  existingRegionFixture,
  installReferencePanelDomPolyfills,
  mockZones,
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

const secondCamera: CameraResponse = {
  ...baseCamera,
  id: CAM_2,
  externalId: 'CAM-EXT-02',
  code: 'CAM-02',
  name: 'South Gate Camera',
  status: 'ACTIVE',
  configurationVersion: 5,
};

const secondCameraRegionFixture: RegionResponse = {
  ...existingRegionFixture,
  id: 'reg-existing-cam-2',
  cameraId: CAM_2,
  zoneId: ZONE_1,
  version: 1,
};

describe('ZonePpeCameraRegionPanel Configuration Reference 404 Scope Recovery vs 401/403 Account Block', () => {
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

  it('clears camera A pixels/drawing on createRegion 404, allows requesting a fresh reference on active authorized camera B while requiring a fresh B image before drawing, and never reuses old pixels or silently retries when returning to missing camera A', async () => {
    const user = userEvent.setup();
    const cameraAReference = buildCanonicalReference(
      { siteId: SITE_A, cameraId: CAM_1, configurationVersion: 3 },
      {
        cameraExternalId: 'CAM-EXT-01',
        sequenceNumber: '1',
        capturedAt: '2026-10-15T09:00:00.000Z',
      },
    );
    refHookState.reference = cameraAReference;
    stubCameraAndRegionPages([baseCamera, secondCamera], []);

    const getCameraSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getCamera')
      .mockImplementation(async (_token, _siteId, cameraId) =>
        cameraId === CAM_2
          ? { ...secondCamera, configurationVersion: 5 }
          : { ...baseCamera, configurationVersion: 3 },
      );
    const { createSpy } = stubRegionMutationSpies();
    createSpy.mockRejectedValueOnce(new ApiError('http', 'Secret camera A 404 missing', 404));

    const { rerenderWith } = renderReferencePanel(queryClient);

    // 1. Start drawing on Camera A and fail createRegion with 404
    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    await addTriangleViaInputs(user);
    expect(
      screen.getByLabelText(/Camera Region Drawing Canvas/i).querySelector('image'),
    ).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /Save Region/i }));

    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.queryByText(/Secret camera A 404 missing/i)).toBeNull();
    expect(
      screen.queryByLabelText(/Camera Region Drawing Canvas/i)?.querySelector('image') ?? null,
    ).toBeNull();
    expect(screen.getByRole('button', { name: /Start Drawing Region/i })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: /Get configuration image/i })).toHaveProperty(
      'disabled',
      true,
    );
    expect(refHookState.lastOptions?.cameraId).toBe(CAM_1);
    expect(refHookState.lastOptions?.enabled).toBe(false);

    // 2. Explicitly select active authorized Camera B: reference acquisition must be enabled,
    //    but drawing must remain disabled until a fresh Camera B reference is explicitly fetched.
    await user.selectOptions(screen.getByLabelText(/Select Camera/i), CAM_2);

    await waitFor(() => {
      expect(refHookState.lastOptions).toEqual(
        expect.objectContaining({
          siteId: SITE_A,
          cameraId: CAM_2,
          cameraExternalId: 'CAM-EXT-02',
          enabled: true,
        }),
      );
    });
    expect(refHookState.requestSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Get configuration image/i })).toHaveProperty(
      'disabled',
      false,
    );
    expect(screen.getByRole('button', { name: /Start Drawing Region/i })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();

    // 3. Returning to missing Camera A before fetching B must not reuse old A pixels or silently retry
    await user.selectOptions(screen.getByLabelText(/Select Camera/i), CAM_1);

    await waitFor(() => {
      expect(refHookState.lastOptions?.cameraId).toBe(CAM_1);
    });
    expect(refHookState.lastOptions?.enabled).toBe(false);
    expect(screen.getByRole('button', { name: /Get configuration image/i })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: /Start Drawing Region/i })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
    expect(refHookState.requestSpy).not.toHaveBeenCalled();
    expect(getCameraSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledTimes(1);

    // 4. Select Camera B again and explicitly request a fresh scoped reference for Camera B
    await user.selectOptions(screen.getByLabelText(/Select Camera/i), CAM_2);
    await waitFor(() => {
      expect(refHookState.lastOptions?.cameraId).toBe(CAM_2);
      expect(refHookState.lastOptions?.enabled).toBe(true);
    });

    refHookState.requestImpl = async () => {
      refHookState.reference = buildCanonicalReference(
        { siteId: SITE_A, cameraId: CAM_2, configurationVersion: 5 },
        {
          cameraExternalId: 'CAM-EXT-02',
          sequenceNumber: '2',
          capturedAt: '2026-10-15T09:00:30.000Z',
        },
      );
    };
    await user.click(screen.getByRole('button', { name: /Get configuration image/i }));
    rerenderWith();

    expect(refHookState.requestSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Start Drawing Region/i })).toHaveProperty(
      'disabled',
      false,
    );

    await user.click(screen.getByRole('button', { name: /Start Drawing Region/i }));
    expect(
      screen.getByLabelText(/Camera Region Drawing Canvas/i).querySelector('image'),
    ).not.toBeNull();
    await addTriangleViaInputs(user);
    await user.click(screen.getByRole('button', { name: /Save Region/i }));

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(createSpy).toHaveBeenLastCalledWith(
      'admin-jwt-token',
      SITE_A,
      CAM_2,
      expect.objectContaining({
        zoneId: ZONE_1,
        expectedConfigurationVersion: 5,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // 5. Returning to missing Camera A after drawing on B closes B editor and still blocks A without retry
    refHookState.reference = cameraAReference;
    await user.selectOptions(screen.getByLabelText(/Select Camera/i), CAM_1);

    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
    expect(refHookState.lastOptions?.cameraId).toBe(CAM_1);
    expect(refHookState.lastOptions?.enabled).toBe(false);
    expect(screen.getByRole('button', { name: /Get configuration image/i })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: /Start Drawing Region/i })).toHaveProperty(
      'disabled',
      true,
    );
    expect(refHookState.requestSpy).toHaveBeenCalledTimes(1);
  });

  it('recovers reference acquisition on camera B after updatePolygon fails with 404 while editing an existing region on camera A', async () => {
    const user = userEvent.setup();
    refHookState.reference = buildCanonicalReference(
      { siteId: SITE_A, cameraId: CAM_1, configurationVersion: 3 },
      { cameraExternalId: 'CAM-EXT-01', sequenceNumber: '1' },
    );
    stubCameraAndRegionPages(
      [baseCamera, secondCamera],
      [existingRegionFixture, secondCameraRegionFixture],
    );

    vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockResolvedValue({
      ...baseCamera,
      configurationVersion: 3,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'updatePolygon').mockRejectedValueOnce(
      new ApiError('http', 'Secret region 404 missing', 404),
    );

    const { rerenderWith } = renderReferencePanel(queryClient);

    await user.click(await screen.findByRole('button', { name: /Edit Geometry/i }));
    await addPointViaInputs(user, '0.25', '0.75');
    await user.click(screen.getByRole('button', { name: /Save Region/i }));

    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.queryByText(/Secret region 404 missing/i)).toBeNull();
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
    expect(refHookState.lastOptions?.enabled).toBe(false);

    // Switch to Camera B: can request reference, but Edit Geometry / Start Drawing require fresh B reference
    await user.selectOptions(screen.getByLabelText(/Select Camera/i), CAM_2);

    await waitFor(() => {
      expect(refHookState.lastOptions?.cameraId).toBe(CAM_2);
      expect(refHookState.lastOptions?.enabled).toBe(true);
    });
    expect(screen.getByRole('button', { name: /Get configuration image/i })).toHaveProperty(
      'disabled',
      false,
    );
    expect(screen.getByRole('button', { name: /Start Drawing Region/i })).toHaveProperty(
      'disabled',
      true,
    );
    expect(await screen.findByRole('button', { name: /Edit Geometry/i })).toHaveProperty(
      'disabled',
      true,
    );

    refHookState.requestImpl = async () => {
      refHookState.reference = buildCanonicalReference(
        { siteId: SITE_A, cameraId: CAM_2, configurationVersion: 5 },
        { cameraExternalId: 'CAM-EXT-02', sequenceNumber: '2' },
      );
    };
    await user.click(screen.getByRole('button', { name: /Get configuration image/i }));
    rerenderWith();

    expect(screen.getByRole('button', { name: /Start Drawing Region/i })).toHaveProperty(
      'disabled',
      false,
    );
    expect(screen.getByRole('button', { name: /Edit Geometry/i })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it.each([401, 403])(
    'keeps account-scope blocked across camera switches when createRegion fails with %i on camera A, while retaining keyed remount recovery on site or token change',
    async (status) => {
      const user = userEvent.setup();
      refHookState.reference = buildCanonicalReference(
        { siteId: SITE_A, cameraId: CAM_1, configurationVersion: 3 },
        { cameraExternalId: 'CAM-EXT-01', sequenceNumber: '1' },
      );

      const siteBCamera: CameraResponse = {
        ...baseCamera,
        id: CAM_2,
        siteId: SITE_B,
        externalId: 'CAM-EXT-SITE-B',
        code: 'CAM-B1',
        name: 'Site B Gate Camera',
        status: 'ACTIVE',
        configurationVersion: 2,
      };
      vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockImplementation(
        async (_token, requestedSiteId) => ({
          items: requestedSiteId === SITE_B ? [siteBCamera] : [baseCamera, secondCamera],
          total: requestedSiteId === SITE_B ? 1 : 2,
        }),
      );
      vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue({
        items: [],
        total: 0,
      });
      vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockResolvedValue({
        ...baseCamera,
        configurationVersion: 3,
      });
      vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion').mockRejectedValueOnce(
        new ApiError('http', `Secret account denial ${status}`, status),
      );

      const { rerenderWith } = renderReferencePanel(queryClient);

      await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
      await addTriangleViaInputs(user);
      await user.click(screen.getByRole('button', { name: /Save Region/i }));

      expect(await screen.findByRole('alert')).toBeDefined();
      expect(screen.queryByText(/Secret account denial/i)).toBeNull();
      expect(refHookState.lastOptions?.enabled).toBe(false);

      // Switching to Camera B within the same site/account scope must stay blocked after 401/403
      await user.selectOptions(screen.getByLabelText(/Select Camera/i), CAM_2);

      await waitFor(() => {
        expect(refHookState.lastOptions?.cameraId).toBe(CAM_2);
      });
      expect(refHookState.lastOptions?.enabled).toBe(false);
      expect(screen.getByRole('button', { name: /Get configuration image/i })).toHaveProperty(
        'disabled',
        true,
      );
      expect(screen.getByRole('button', { name: /Start Drawing Region/i })).toHaveProperty(
        'disabled',
        true,
      );
      expect(refHookState.requestSpy).not.toHaveBeenCalled();

      // Keyed remount on site/token scope change resets the panel cleanly without reusing old pixels
      refHookState.reference = null;
      rerenderWith({
        token: 'rotated-jwt-token',
        sessionScope: 'admin:GLOBAL:rotated',
        credentialId: 9,
        siteId: SITE_B,
        zones: mockZones.map((zone) => ({ ...zone, siteId: SITE_B })),
      });

      await waitFor(() => {
        expect(refHookState.lastOptions).toEqual(
          expect.objectContaining({
            token: 'rotated-jwt-token',
            sessionScope: 'admin:GLOBAL:rotated',
            credentialId: 9,
            siteId: SITE_B,
            cameraId: CAM_2,
            cameraExternalId: 'CAM-EXT-SITE-B',
            enabled: true,
          }),
        );
      });
      expect(screen.getByRole('button', { name: /Get configuration image/i })).toHaveProperty(
        'disabled',
        false,
      );
      expect(screen.getByRole('button', { name: /Start Drawing Region/i })).toHaveProperty(
        'disabled',
        true,
      );
    },
  );
});
