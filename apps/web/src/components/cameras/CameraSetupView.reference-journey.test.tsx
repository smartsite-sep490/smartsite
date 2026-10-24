// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIGURATION_REFERENCE_LIFETIME_MS,
  SmartSiteManagementClient,
  type CameraConfigurationImageResponse,
  type Page,
} from '@smartsite/api-client';
import type { CameraResponse, RegionResponse, SiteResponse } from '@smartsite/contracts';
import { LocaleProvider } from '../../i18n/LocaleProvider';
import { changeUiLanguage } from '../../i18n/runtime';
import type { SharedSession } from '../../types/shared-session';
import {
  BASE_TIME_MS,
  CAM_1,
  CAM_2,
  SESSION_1,
  SITE_A,
  SYNTHETIC_JPEG_120X80,
  baseCamera,
  installReferencePanelDomPolyfills,
  mockZones,
  stubCameraAndRegionPages,
} from '../ppe/ZonePpeCameraRegionPanel.reference.fixtures';
import { CameraSetupView } from './CameraSetupView';

const sharedManagementClient = new SmartSiteManagementClient('http://localhost:3000');

vi.mock('../../features/auth/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/auth/auth-session')>()),
  useManagementClient: () => sharedManagementClient,
}));

const siteAlpha: SiteResponse = {
  id: SITE_A,
  code: 'SITE-A',
  name: 'North Construction Site',
  createdAt: '2026-09-30T00:00:00Z',
};

const secondActiveCamera: CameraResponse = {
  id: CAM_2,
  siteId: SITE_A,
  externalId: 'CAM-EXT-02',
  code: 'CAM-02',
  name: 'Tower Crane Camera',
  status: 'ACTIVE',
  configurationVersion: 5,
  createdAt: '2026-09-30T00:00:00Z',
};

const managerSessionAlpha: SharedSession = {
  accessToken: 'manager-jwt-token-alpha',
  sessionScope: `manager-1:SITE_MANAGER:${SITE_A}`,
  user: {
    id: 'manager-1',
    displayName: 'Site Manager Alpha',
    mustChangePassword: false,
    roleAssignments: [{ role: 'SITE_MANAGER', siteId: SITE_A }],
  },
};

const managerSessionRotated: SharedSession = {
  accessToken: 'manager-jwt-token-rotated',
  sessionScope: `manager-2:SITE_MANAGER:${SITE_A}`,
  user: {
    id: 'manager-2',
    displayName: 'Site Manager Beta',
    mustChangePassword: false,
    roleAssignments: [{ role: 'SITE_MANAGER', siteId: SITE_A }],
  },
};

class MockReferenceImage {
  naturalWidth = 0;
  naturalHeight = 0;
  private currentSrc = '';

  get src(): string {
    return this.currentSrc;
  }

  set src(value: string) {
    this.currentSrc = value;
    this.naturalWidth = value ? 120 : 0;
    this.naturalHeight = value ? 80 : 0;
  }

  decode(): Promise<void> {
    return Promise.resolve();
  }
}

function buildCameraReferenceDto(
  camera: CameraResponse = secondActiveCamera,
  overrides: Partial<CameraConfigurationImageResponse> = {},
): CameraConfigurationImageResponse {
  const capturedAt = new Date(BASE_TIME_MS).toISOString();
  const referenceExpiresAt = new Date(
    BASE_TIME_MS + CONFIGURATION_REFERENCE_LIFETIME_MS,
  ).toISOString();
  return {
    schemaVersion: 1,
    purpose: 'REGION_CONFIGURATION',
    sourceKind: 'LIVE',
    siteId: camera.siteId,
    cameraId: camera.id,
    configurationVersion: camera.configurationVersion,
    referenceExpiresAt,
    ...overrides,
    frame: {
      cameraExternalId: camera.externalId,
      sessionId: SESSION_1,
      sequenceNumber: '7',
      capturedAt,
      width: 120,
      height: 80,
      imageDataUrl: `data:image/jpeg;base64,${SYNTHETIC_JPEG_120X80}`,
      imageSha256: 'a'.repeat(64),
      ...overrides.frame,
    },
  };
}

describe('CameraSetupView -> ZonePpeSetupDialog -> ZonePpeCameraRegionPanel -> useCameraConfigurationReference journey', () => {
  let queryClient: QueryClient;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    installReferencePanelDomPolyfills();
    changeUiLanguage('en');
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    vi.spyOn(Date, 'now').mockReturnValue(BASE_TIME_MS);
    vi.stubGlobal('Image', MockReferenceImage);

    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected raw fetch, preview stream, or AI call'));

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [siteAlpha],
      total: 1,
    } satisfies Page<SiteResponse>);

    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
      items: mockZones,
      total: mockZones.length,
    });

    stubCameraAndRegionPages([baseCamera, secondActiveCamera], [] satisfies RegionResponse[]);

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
  });

  afterEach(() => {
    changeUiLanguage('en');
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function mountJourney(initialSession: SharedSession | null = managerSessionAlpha) {
    const view = render(
      <LocaleProvider defaultLocale="en">
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/camera-setup']}>
            <CameraSetupView apiUrl="http://localhost:3000" sharedSession={initialSession} />
          </MemoryRouter>
        </QueryClientProvider>
      </LocaleProvider>,
    );
    return {
      ...view,
      rerenderSession: (nextSession: SharedSession | null) =>
        view.rerender(
          <LocaleProvider defaultLocale="en">
            <QueryClientProvider client={queryClient}>
              <MemoryRouter initialEntries={['/camera-setup']}>
                <CameraSetupView apiUrl="http://localhost:3000" sharedSession={nextSession} />
              </MemoryRouter>
            </QueryClientProvider>
          </LocaleProvider>,
        ),
    };
  }

  function getCameraRowRegionsButton(cameraName: string): HTMLElement {
    const row = screen.getByRole('heading', { name: cameraName }).closest('li');
    if (!row) {
      throw new Error(`Expected camera list item for ${cameraName}`);
    }
    return within(row).getByRole('button', { name: 'Link observation regions' });
  }

  it.each([false, true])(
    'returns to the camera selected inside Regions (later page: %s)',
    async (laterPage) => {
      const user = userEvent.setup();
      if (laterPage) {
        vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockResolvedValue(baseCamera);
        vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockImplementation(
          async (_token, _site, page) => ({
            items: page?.offset ? [baseCamera] : [secondActiveCamera],
            total: 2,
          }),
        );
      }
      mountJourney({
        ...managerSessionAlpha,
        user: {
          ...managerSessionAlpha.user,
          roleAssignments: [
            ...managerSessionAlpha.user.roleAssignments,
            { role: 'SAFETY_OFFICER', siteId: SITE_A },
          ],
        },
      });
      await screen.findByRole('heading', { name: secondActiveCamera.name });
      await user.click(getCameraRowRegionsButton(secondActiveCamera.name));
      const dialog = await screen.findByRole('dialog');
      const cameraSelect = await within(dialog).findByRole('combobox', { name: 'Select Camera' });
      await waitFor(() => expect((cameraSelect as HTMLSelectElement).value).toBe(CAM_2));
      if (laterPage) {
        await user.click(within(dialog).getByRole('button', { name: 'Load more cameras' }));
        await within(cameraSelect).findByRole('option', { name: new RegExp(baseCamera.name) });
      }
      await user.selectOptions(cameraSelect, CAM_1);
      await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      for (const name of ['PPE monitoring', 'Restricted-zone monitoring']) {
        const href = screen.getByRole('link', { name }).getAttribute('href');
        const destination = new URL(href!, 'http://localhost');
        await waitFor(() => {
          const currentHref = screen.getByRole('link', { name }).getAttribute('href');
          expect(new URL(currentHref!, 'http://localhost').searchParams.get('cameraId')).toBe(
            CAM_1,
          );
        });
        expect(destination.searchParams.get('siteId')).toBe(SITE_A);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('aborts a later-page return-camera lookup on logout and ignores its late result', async () => {
    const user = userEvent.setup();
    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockImplementation(
      async (_token, _site, page) => ({
        items: page?.offset ? [baseCamera] : [secondActiveCamera],
        total: 2,
      }),
    );
    let resolveLate!: (camera: CameraResponse) => void;
    let pendingSignal: AbortSignal | undefined;
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockImplementation(
      (_token, _site, _camera, options) => {
        pendingSignal = options?.signal;
        return new Promise((resolve) => {
          resolveLate = resolve;
        });
      },
    );
    const scopedSession: SharedSession = {
      ...managerSessionAlpha,
      user: {
        ...managerSessionAlpha.user,
        roleAssignments: [
          ...managerSessionAlpha.user.roleAssignments,
          { role: 'SAFETY_OFFICER', siteId: SITE_A },
        ],
      },
    };
    const { rerenderSession } = mountJourney(scopedSession);
    await screen.findByRole('heading', { name: secondActiveCamera.name });
    await user.click(getCameraRowRegionsButton(secondActiveCamera.name));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Load more cameras' }));
    const select = within(dialog).getByRole('combobox', { name: 'Select Camera' });
    await within(select).findByRole('option', { name: new RegExp(baseCamera.name) });
    await user.selectOptions(select, CAM_1);
    await waitFor(() => expect(pendingSignal?.aborted).toBe(false));
    rerenderSession(null);
    expect(pendingSignal?.aborted).toBe(true);
    await act(async () => {
      resolveLate(baseCamera);
      await Promise.resolve();
    });
    rerenderSession({
      ...scopedSession,
      accessToken: 'rotated-token',
      sessionScope: 'rotated-scope',
    });
    await screen.findByRole('heading', { name: secondActiveCamera.name });
    for (const name of ['PPE monitoring', 'Restricted-zone monitoring']) {
      const href = screen.getByRole('link', { name }).getAttribute('href');
      expect(new URL(href!, 'http://localhost').searchParams.has('cameraId')).toBe(false);
    }
  });

  it('drops an explicitly selected return camera when refreshed parent metadata deactivates it', async () => {
    const user = userEvent.setup();
    let active = true;
    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockImplementation(async () => ({
      items: [{ ...baseCamera, status: active ? 'ACTIVE' : 'INACTIVE' }, secondActiveCamera],
      total: 2,
    }));
    mountJourney({
      ...managerSessionAlpha,
      user: {
        ...managerSessionAlpha.user,
        roleAssignments: [
          ...managerSessionAlpha.user.roleAssignments,
          { role: 'SAFETY_OFFICER', siteId: SITE_A },
        ],
      },
    });
    await screen.findByRole('heading', { name: secondActiveCamera.name });
    await user.click(getCameraRowRegionsButton(secondActiveCamera.name));
    const dialog = await screen.findByRole('dialog');
    const select = await within(dialog).findByRole('combobox', { name: 'Select Camera' });
    await user.selectOptions(select, CAM_1);
    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
    active = false;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['camera-setup'] });
    });
    for (const name of ['PPE monitoring', 'Restricted-zone monitoring']) {
      await waitFor(() => {
        const href = screen.getByRole('link', { name }).getAttribute('href');
        expect(new URL(href!, 'http://localhost').searchParams.has('cameraId')).toBe(false);
      });
    }
  });

  it.each([401, 403, 404, 503, 'wrong-site', 'inactive'] as const)(
    'does not return a stale camera after later-page lookup refuses %s',
    async (failure) => {
      const user = userEvent.setup();
      const signOut = vi.fn();
      vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockImplementation(
        async (_token, _site, page) => ({
          items: page?.offset ? [baseCamera] : [secondActiveCamera],
          total: 2,
        }),
      );
      const lookup = vi
        .spyOn(SmartSiteManagementClient.prototype, 'getCamera')
        .mockImplementation(async () => {
          if (typeof failure === 'number')
            throw Object.assign(new Error('Synthetic refusal'), { status: failure });
          return {
            ...baseCamera,
            ...(failure === 'wrong-site'
              ? { siteId: 'other-site' }
              : { status: 'INACTIVE' as const }),
          };
        });
      mountJourney({
        ...managerSessionAlpha,
        onSignOut: signOut,
        user: {
          ...managerSessionAlpha.user,
          roleAssignments: [
            ...managerSessionAlpha.user.roleAssignments,
            { role: 'SAFETY_OFFICER', siteId: SITE_A },
          ],
        },
      });
      await screen.findByRole('heading', { name: secondActiveCamera.name });
      await user.click(getCameraRowRegionsButton(secondActiveCamera.name));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Load more cameras' }));
      const select = within(dialog).getByRole('combobox', { name: 'Select Camera' });
      await within(select).findByRole('option', { name: new RegExp(baseCamera.name) });
      await user.selectOptions(select, CAM_1);
      await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
      await act(async () => {
        await lookup.mock.results[0]!.value.catch(() => undefined);
      });
      if (failure === 401) {
        await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole('link', { name: 'PPE monitoring' })).toBeNull();
      } else {
        await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
        for (const name of ['PPE monitoring', 'Restricted-zone monitoring']) {
          const href = screen.getByRole('link', { name }).getAttribute('href');
          expect(new URL(href!, 'http://localhost').searchParams.has('cameraId')).toBe(false);
        }
        expect(signOut).not.toHaveBeenCalled();
      }
    },
  );

  it('opens Regions for the selected active camera row without auto-requesting an image, then fetches and renders the typed configuration reference on explicit click with no preview/AI calls', async () => {
    const user = userEvent.setup();
    const configImageSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getCameraConfigurationImage')
      .mockResolvedValue(buildCameraReferenceDto(secondActiveCamera));
    const listPreviewSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras');
    const getPreviewSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview');
    const streamVideoSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'streamCameraVideo');
    const recordedVideoSpy = vi.spyOn(
      SmartSiteManagementClient.prototype,
      'readRecordedCameraVideo',
    );
    const demoStatusSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'getMf05DemoStatus');
    const demoApplySpy = vi.spyOn(SmartSiteManagementClient.prototype, 'applyMf05DemoRegion');

    mountJourney();

    await screen.findByRole('heading', { name: secondActiveCamera.name });
    expect(configImageSpy).not.toHaveBeenCalled();

    await user.click(getCameraRowRegionsButton(secondActiveCamera.name));

    const dialog = await screen.findByRole('dialog');
    const cameraSelect = (await within(dialog).findByRole('combobox', {
      name: 'Select Camera',
    })) as HTMLSelectElement;
    await waitFor(() => {
      expect(cameraSelect.value).toBe(CAM_2);
    });
    expect(cameraSelect.value).not.toBe(CAM_1);

    const startDrawingButton = await within(dialog).findByRole('button', {
      name: 'Start Drawing Region',
    });
    expect(startDrawingButton.hasAttribute('disabled')).toBe(true);
    expect(
      within(dialog).getByText(
        'Request a configuration image for the selected active camera before drawing or editing a region.',
      ),
    ).toBeTruthy();
    expect(configImageSpy).not.toHaveBeenCalled();

    const getReferenceButton = within(dialog).getByRole('button', {
      name: 'Get configuration image',
    });
    await user.click(getReferenceButton);

    await waitFor(() => {
      expect(configImageSpy).toHaveBeenCalledTimes(1);
    });
    expect(configImageSpy.mock.calls[0]?.[0]).toBe(managerSessionAlpha.accessToken);
    expect(configImageSpy.mock.calls[0]?.[1]).toBe(SITE_A);
    expect(configImageSpy.mock.calls[0]?.[2]).toBe(CAM_2);
    expect(configImageSpy.mock.calls[0]?.[3]).toEqual(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await waitFor(() => {
      expect(startDrawingButton.hasAttribute('disabled')).toBe(false);
    });

    expect(within(dialog).getByText('LIVE')).toBeTruthy();
    expect(within(dialog).getByText('Config v5')).toBeTruthy();
    expect(within(dialog).getByText('Captured: 2026-10-15T09:00:00.000Z')).toBeTruthy();
    expect(within(dialog).getByText('Expires: 2026-10-15T09:05:00.000Z')).toBeTruthy();
    expect(
      within(dialog).queryByText(
        'Request a configuration image for the selected active camera before drawing or editing a region.',
      ),
    ).toBeNull();
    expect(listPreviewSpy).not.toHaveBeenCalled();
    expect(getPreviewSpy).not.toHaveBeenCalled();
    expect(streamVideoSpy).not.toHaveBeenCalled();
    expect(recordedVideoSpy).not.toHaveBeenCalled();
    expect(demoStatusSpy).not.toHaveBeenCalled();
    expect(demoApplySpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('aborts an in-flight configuration image request and clears reference state on session rotation or logout without leaking late responses', async () => {
    const user = userEvent.setup();
    let resolveLateReference!: (value: CameraConfigurationImageResponse) => void;
    let capturedSignal: AbortSignal | undefined;

    const configImageSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getCameraConfigurationImage')
      .mockImplementation((_token, _siteId, _cameraId, options) => {
        capturedSignal = options?.signal;
        return new Promise<CameraConfigurationImageResponse>((resolve) => {
          resolveLateReference = resolve;
        });
      });

    const { rerenderSession } = mountJourney(managerSessionAlpha);

    await screen.findByRole('heading', { name: secondActiveCamera.name });
    await user.click(getCameraRowRegionsButton(secondActiveCamera.name));

    const dialog = await screen.findByRole('dialog');
    const cameraSelect = (await within(dialog).findByRole('combobox', {
      name: 'Select Camera',
    })) as HTMLSelectElement;
    await waitFor(() => {
      expect(cameraSelect.value).toBe(CAM_2);
    });

    await user.click(within(dialog).getByRole('button', { name: 'Get configuration image' }));
    await waitFor(() => {
      expect(configImageSpy).toHaveBeenCalledTimes(1);
    });
    expect(capturedSignal?.aborted).toBe(false);

    rerenderSession(null);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Sign in to manage configuration.');
    expect(capturedSignal?.aborted).toBe(true);

    await act(async () => {
      resolveLateReference(buildCameraReferenceDto(secondActiveCamera));
      await Promise.resolve();
    });

    rerenderSession(managerSessionRotated);

    await screen.findByRole('heading', { name: secondActiveCamera.name });
    await user.click(getCameraRowRegionsButton(secondActiveCamera.name));

    const rotatedDialog = await screen.findByRole('dialog');
    const rotatedStartDrawingButton = await within(rotatedDialog).findByRole('button', {
      name: 'Start Drawing Region',
    });
    expect(rotatedStartDrawingButton.hasAttribute('disabled')).toBe(true);
    expect(
      within(rotatedDialog).getByText(
        'Request a configuration image for the selected active camera before drawing or editing a region.',
      ),
    ).toBeTruthy();
    expect(within(rotatedDialog).queryByText('Config v5')).toBeNull();
    expect(
      within(rotatedDialog).getByRole('button', { name: 'Get configuration image' }),
    ).toBeTruthy();
    expect(configImageSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
