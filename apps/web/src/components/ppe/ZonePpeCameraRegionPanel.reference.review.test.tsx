// @vitest-environment jsdom
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import type {
  CameraConfigurationReference,
  UseCameraConfigurationReferenceOptions,
  UseCameraConfigurationReferenceResult,
} from './useCameraConfigurationReference';
import {
  BASE_TIME_MS,
  CAM_1,
  SITE_A,
  ZONE_1,
  addTriangleViaInputs,
  baseCamera,
  buildCanonicalReference,
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

describe('ZonePpeCameraRegionPanel Configuration Reference Review & Negative Journeys', () => {
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

  it.each([401, 403, 404])(
    'clears both active drawing and candidate review canvases without retaining pixels when reference hook fails with %i',
    async (status) => {
      const user = userEvent.setup();
      refHookState.reference = buildCanonicalReference(
        { configurationVersion: 3 },
        { sequenceNumber: '1', capturedAt: '2026-10-15T09:00:00.000Z' },
      );
      stubCameraAndRegionPages([baseCamera], []);

      const { rerenderWith } = renderReferencePanel(queryClient);

      await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
      await addTriangleViaInputs(user);
      expect(
        screen.getByLabelText(/Camera Region Drawing Canvas/i).querySelector('image'),
      ).not.toBeNull();

      // Open candidate reference review with fresh candidate v4
      vi.mocked(Date.now).mockReturnValue(BASE_TIME_MS + 30_000);
      refHookState.requestImpl = async () => {
        refHookState.reference = buildCanonicalReference(
          { configurationVersion: 4 },
          { sequenceNumber: '2', capturedAt: '2026-10-15T09:00:30.000Z' },
        );
      };
      await user.click(screen.getByRole('button', { name: /Review new reference/i }));
      rerenderWith();

      expect(
        screen.getByLabelText(/Camera Region Drawing Canvas/i).querySelector('image'),
      ).not.toBeNull();
      expect(
        screen.getByLabelText(/Candidate Reference Preview Canvas/i).querySelector('image'),
      ).not.toBeNull();

      // Hard auth/scope failure (401/403/404) while both drawing and candidate review are open
      refHookState.reference = null;
      refHookState.error = new ApiError('http', `Secret reference denial ${status}`, status);
      rerenderWith();

      expect(
        screen.queryByLabelText(/Camera Region Drawing Canvas/i)?.querySelector('image') ?? null,
      ).toBeNull();
      expect(
        screen.queryByLabelText(/Candidate Reference Preview Canvas/i)?.querySelector('image') ??
          null,
      ).toBeNull();
      expect(screen.queryByRole('button', { name: /Use new reference/i })).toBeNull();
      expect(screen.queryByText(/Secret reference denial/i)).toBeNull();
    },
  );

  it('retains valid frozen reference pixels and 3 draft points on transient 503 before expiry while displaying safe failure text', async () => {
    const user = userEvent.setup();
    refHookState.reference = buildCanonicalReference(
      { configurationVersion: 3, referenceExpiresAt: '2026-10-15T09:05:00.000Z' },
      { sequenceNumber: '1', capturedAt: '2026-10-15T09:00:00.000Z' },
    );
    stubCameraAndRegionPages([baseCamera], []);

    const { rerenderWith } = renderReferencePanel(queryClient);

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    await addTriangleViaInputs(user);

    // 60s elapsed: frozen draft reference (expires at +300s) is still valid when candidate request fails with 503
    vi.mocked(Date.now).mockReturnValue(BASE_TIME_MS + 60_000);
    refHookState.requestImpl = async () => {
      refHookState.reference = null;
      refHookState.error = new ApiError('http', 'Private upstream 503 stack', 503);
    };
    await user.click(screen.getByRole('button', { name: /Review new reference/i }));
    rerenderWith();

    expect(
      screen.getByLabelText(/Camera Region Drawing Canvas/i).querySelector('image'),
    ).not.toBeNull();
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Save Region/i })).toHaveProperty('disabled', false);
    expect(
      screen.getByText(/Camera configuration image source is currently unavailable/i),
    ).toBeDefined();
    expect(screen.queryByText(/Private upstream 503 stack/i)).toBeNull();
  });

  it('removes candidate pixels and disables or hides "Use new reference" when the candidate expires while candidate review is open', async () => {
    vi.mocked(Date.now).mockRestore();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(BASE_TIME_MS);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    refHookState.reference = buildCanonicalReference(
      { configurationVersion: 3, referenceExpiresAt: '2026-10-15T09:05:00.000Z' },
      { sequenceNumber: '1', capturedAt: '2026-10-15T09:00:00.000Z' },
    );
    stubCameraAndRegionPages([baseCamera], []);

    const { rerenderWith } = renderReferencePanel(queryClient);

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    await addTriangleViaInputs(user);

    // Candidate v4 has a 60s remaining lifetime (expires at 09:01:00Z, before frozen v3 at 09:05:00Z)
    refHookState.requestImpl = async () => {
      refHookState.reference = buildCanonicalReference(
        { configurationVersion: 4, referenceExpiresAt: '2026-10-15T09:01:00.000Z' },
        { sequenceNumber: '2', capturedAt: '2026-10-15T09:00:00.000Z' },
      );
    };
    await user.click(screen.getByRole('button', { name: /Review new reference/i }));
    rerenderWith();

    expect(
      screen.getByLabelText(/Candidate Reference Preview Canvas/i).querySelector('image'),
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: /Use new reference/i })).toHaveProperty(
      'disabled',
      false,
    );

    // Advance 61s: candidate v4 expires while candidate review is open
    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    expect(
      screen.queryByLabelText(/Candidate Reference Preview Canvas/i)?.querySelector('image') ??
        null,
    ).toBeNull();
    const useNewBtn = screen.queryByRole('button', { name: /Use new reference/i });
    expect(useNewBtn === null || (useNewBtn as HTMLButtonElement).disabled).toBe(true);
    // Original frozen draft (valid until 09:05:00Z) retains its pixels and 3 points
    expect(
      screen.getByLabelText(/Camera Region Drawing Canvas/i).querySelector('image'),
    ).not.toBeNull();
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();
  });

  it('cancels candidate review via "Keep current reference" without altering draft revision or points, and saves with original expectedConfigurationVersion 3', async () => {
    const user = userEvent.setup();
    refHookState.reference = buildCanonicalReference(
      { configurationVersion: 3 },
      { sequenceNumber: '1', capturedAt: '2026-10-15T09:00:00.000Z' },
    );
    stubCameraAndRegionPages([baseCamera], []);
    const getCameraSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getCamera')
      .mockResolvedValue({ ...baseCamera, configurationVersion: 3 });
    const { createSpy } = stubRegionMutationSpies();

    const { rerenderWith } = renderReferencePanel(queryClient);

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    await addTriangleViaInputs(user);

    vi.mocked(Date.now).mockReturnValue(BASE_TIME_MS + 30_000);
    refHookState.requestImpl = async () => {
      refHookState.reference = buildCanonicalReference(
        { configurationVersion: 4 },
        { sequenceNumber: '2', capturedAt: '2026-10-15T09:00:30.000Z' },
      );
    };
    await user.click(screen.getByRole('button', { name: /Review new reference/i }));
    rerenderWith();

    expect(screen.getByLabelText(/Candidate Reference Preview Canvas/i)).toBeDefined();
    await user.click(screen.getByRole('button', { name: /Keep current reference/i }));

    expect(screen.queryByLabelText(/Candidate Reference Preview Canvas/i)).toBeNull();
    expect(
      screen.getByLabelText(/Camera Region Drawing Canvas/i).querySelector('image'),
    ).not.toBeNull();
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();

    await user.click(screen.getByRole('button', { name: /Save Region/i }));
    expect(getCameraSpy).toHaveBeenCalledWith(
      'admin-jwt-token',
      SITE_A,
      CAM_1,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(createSpy).toHaveBeenCalledWith(
      'admin-jwt-token',
      SITE_A,
      CAM_1,
      expect.objectContaining({
        zoneId: ZONE_1,
        expectedConfigurationVersion: 3,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('preserves draft points and performs no retry, rebase, or update fallback when createRegion rejects with 409 after a matching getCamera preflight', async () => {
    const user = userEvent.setup();
    refHookState.reference = buildCanonicalReference({ configurationVersion: 3 });
    stubCameraAndRegionPages([baseCamera], []);

    const getCameraSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getCamera')
      .mockResolvedValue({ ...baseCamera, configurationVersion: 3 });
    const createSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createRegion')
      .mockRejectedValueOnce(new ApiError('http', 'Secret SQL 409 conflict', 409));
    const updateSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'updatePolygon');

    renderReferencePanel(queryClient);

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    await addTriangleViaInputs(user);

    await user.click(screen.getByRole('button', { name: /Save Region/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Configuration version conflict/i,
    );
    expect(screen.queryByText(/Secret SQL 409 conflict/i)).toBeNull();
    expect(getCameraSpy).toHaveBeenCalledTimes(1);
    expect(getCameraSpy).toHaveBeenCalledWith(
      'admin-jwt-token',
      SITE_A,
      CAM_1,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith(
      'admin-jwt-token',
      SITE_A,
      CAM_1,
      expect.objectContaining({
        zoneId: ZONE_1,
        expectedConfigurationVersion: 3,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(updateSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();
    expect(
      screen.getByLabelText(/Camera Region Drawing Canvas/i).querySelector('image'),
    ).not.toBeNull();
  });

  it.each([401, 403, 404])(
    'clears drawing and candidate pixels, disables further drawing/reference requests for the revoked scope, and performs no retry or secret leak when createRegion rejects with %i after matching getCamera preflight',
    async (status) => {
      const user = userEvent.setup();
      refHookState.reference = buildCanonicalReference(
        { configurationVersion: 3 },
        { sequenceNumber: '1', capturedAt: '2026-10-15T09:00:00.000Z' },
      );
      stubCameraAndRegionPages([baseCamera], []);

      const getCameraSpy = vi
        .spyOn(SmartSiteManagementClient.prototype, 'getCamera')
        .mockResolvedValue({ ...baseCamera, configurationVersion: 3 });
      const createSpy = vi
        .spyOn(SmartSiteManagementClient.prototype, 'createRegion')
        .mockRejectedValueOnce(
          new ApiError('http', `Secret createRegion denial ${status}`, status),
        );

      const { rerenderWith } = renderReferencePanel(queryClient);

      await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
      await addTriangleViaInputs(user);

      vi.mocked(Date.now).mockReturnValue(BASE_TIME_MS + 30_000);
      refHookState.requestImpl = async () => {
        refHookState.reference = buildCanonicalReference(
          { configurationVersion: 4 },
          { sequenceNumber: '2', capturedAt: '2026-10-15T09:00:30.000Z' },
        );
      };
      await user.click(screen.getByRole('button', { name: /Review new reference/i }));
      rerenderWith();

      expect(
        screen.getByLabelText(/Camera Region Drawing Canvas/i).querySelector('image'),
      ).not.toBeNull();
      expect(
        screen.getByLabelText(/Candidate Reference Preview Canvas/i).querySelector('image'),
      ).not.toBeNull();

      await user.click(screen.getByRole('button', { name: /Save Region/i }));

      expect(await screen.findByRole('alert')).toBeDefined();
      expect(screen.queryByText(/Secret createRegion denial/i)).toBeNull();
      expect(getCameraSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByLabelText(/Camera Region Drawing Canvas/i)?.querySelector('image') ?? null,
      ).toBeNull();
      expect(
        screen.queryByLabelText(/Candidate Reference Preview Canvas/i)?.querySelector('image') ??
          null,
      ).toBeNull();
      expect(screen.queryByRole('button', { name: /Use new reference/i })).toBeNull();
      const startDrawBtn = screen.queryByRole('button', { name: /Start Drawing Region/i });
      expect(startDrawBtn === null || (startDrawBtn as HTMLButtonElement).disabled).toBe(true);
      const refActionBtn =
        screen.queryByRole('button', { name: /Get configuration image/i }) ??
        screen.queryByRole('button', { name: /Review new reference/i });
      expect(refActionBtn === null || (refActionBtn as HTMLButtonElement).disabled).toBe(true);
      expect(refHookState.lastOptions?.enabled).toBe(false);
    },
  );
});
