// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, type Page, type ZoneResponse } from '@smartsite/api-client';
import type { CameraResponse, RegionResponse } from '@smartsite/contracts';
import { ZonePpeSetupPanel } from './ZonePpeSetupPanel';
import { ZonePpeCameraRegionPanel } from './ZonePpeCameraRegionPanel';
import type {
  UseCameraConfigurationReferenceOptions,
  UseCameraConfigurationReferenceResult,
} from './useCameraConfigurationReference';

const refState = vi.hoisted(() => ({
  lastOptions: null as UseCameraConfigurationReferenceOptions | null,
  requestSpy: vi.fn<() => Promise<void>>(),
}));

vi.mock('./useCameraConfigurationReference', () => ({
  useCameraConfigurationReference: (
    options: UseCameraConfigurationReferenceOptions,
  ): UseCameraConfigurationReferenceResult => {
    refState.lastOptions = options;
    return {
      reference: null,
      isLoading: false,
      error: null,
      request: refState.requestSpy,
    };
  },
}));

const zone: ZoneResponse = {
  id: 'zone-1',
  siteId: 'site-alpha',
  code: 'ZONE-A1',
  name: 'Hazardous Scaffold Area',
  type: 'HAZARDOUS',
  restrictionPolicy: 'NONE',
  requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
  configurationLocked: false,
  createdAt: '2026-10-07T00:00:00Z',
};

const cam1: CameraResponse = {
  id: 'cam-1',
  siteId: 'site-alpha',
  externalId: 'CAM-EXT-01',
  code: 'CAM-01',
  name: 'Scaffold Camera 01',
  status: 'ACTIVE',
  configurationVersion: 3,
  createdAt: '2026-09-30T00:00:00Z',
};

const cam2: CameraResponse = {
  id: 'cam-2',
  siteId: 'site-alpha',
  externalId: 'CAM-EXT-02',
  code: 'CAM-02',
  name: 'Tower Camera 02',
  status: 'ACTIVE',
  configurationVersion: 4,
  createdAt: '2026-09-30T00:00:00Z',
};

const camInactive: CameraResponse = {
  id: 'cam-inactive',
  siteId: 'site-alpha',
  externalId: 'CAM-EXT-03',
  code: 'CAM-03',
  name: 'Inactive Camera 03',
  status: 'INACTIVE',
  configurationVersion: 1,
  createdAt: '2026-09-30T00:00:00Z',
};

const camForeign: CameraResponse = {
  id: 'cam-foreign',
  siteId: 'site-other',
  externalId: 'CAM-EXT-04',
  code: 'CAM-04',
  name: 'Foreign Camera 04',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-09-30T00:00:00Z',
};

const regionOnCam2: RegionResponse = {
  id: 'reg-cam-2',
  cameraId: 'cam-2',
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
  version: 1,
  isActive: true,
  createdAt: '2026-10-07T00:00:00Z',
};

const caches: QueryClient[] = [];

function mountWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  caches.push(queryClient);
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('ZonePpeCameraRegionPanel initialCameraId selection invariants', () => {
  beforeEach(() => {
    refState.lastOptions = null;
    refState.requestSpy.mockReset();
  });

  afterEach(() => {
    cleanup();
    caches.splice(0).forEach((cache) => cache.clear());
    vi.restoreAllMocks();
  });

  it('forwards initialCameraId through ZonePpeSetupPanel and pre-selects the matching active same-Site camera', async () => {
    const listZones = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listZones')
      .mockResolvedValue({ items: [zone], total: 1 });
    const listCameras = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listCameras')
      .mockResolvedValue({ items: [cam1, cam2], total: 2 });
    const listRegions = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listRegions')
      .mockResolvedValue({ items: [regionOnCam2], total: 1 });

    mountWithQuery(
      <ZonePpeSetupPanel
        apiUrl="http://localhost:3000"
        token="token-1"
        sessionScope="scope-1"
        credentialId={1}
        siteId="site-alpha"
        siteName="Alpha Site"
        canManageZones
        canManageRegions
        section="regions"
        initialCameraId="cam-2"
        onClose={() => {}}
      />,
    );

    const cameraSelect = (await screen.findByLabelText('Select Camera')) as HTMLSelectElement;
    await waitFor(() => expect(cameraSelect.value).toBe('cam-2'));
    expect(listZones).toHaveBeenCalledTimes(1);
    expect(listCameras).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(listRegions).toHaveBeenCalledTimes(1));
    expect(listRegions.mock.calls[0]?.[2]).toBe('cam-2');
    expect(refState.lastOptions?.cameraId).toBe('cam-2');
    expect(refState.lastOptions?.enabled).toBe(true);
  });

  it('does not silently select the first camera when initialCameraId is on a later unloaded page, and binds once that page is loaded', async () => {
    const listCameras = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listCameras')
      .mockImplementation(async (_token, _siteId, options): Promise<Page<CameraResponse>> => {
        if (options?.offset === 0) {
          return { items: [cam1], total: 2 };
        }
        return { items: [cam2], total: 2 };
      });
    const listRegions = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listRegions')
      .mockResolvedValue({ items: [regionOnCam2], total: 1 });

    mountWithQuery(
      <ZonePpeCameraRegionPanel
        apiUrl="http://localhost:3000"
        token="token-1"
        sessionScope="scope-1"
        credentialId={1}
        siteId="site-alpha"
        zones={[zone]}
        initialCameraId="cam-2"
      />,
    );

    await screen.findByRole('button', { name: 'Load more cameras' });
    const cameraSelect = screen.getByLabelText('Select Camera') as HTMLSelectElement;

    expect(cameraSelect.value).toBe('');
    expect(listCameras).toHaveBeenCalledTimes(1);
    expect(listRegions).not.toHaveBeenCalled();
    expect(refState.lastOptions?.enabled).toBe(false);
    expect(
      screen.getByText('Please select an active camera to view observation regions.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Load more cameras' }));

    await waitFor(() => expect(cameraSelect.value).toBe('cam-2'));
    expect(listCameras).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(listRegions).toHaveBeenCalledTimes(1));
    expect(listRegions.mock.calls[0]?.[2]).toBe('cam-2');
    expect(refState.lastOptions?.cameraId).toBe('cam-2');
    expect(refState.lastOptions?.enabled).toBe(true);
  });

  it('never falls back to an unrelated camera when initialCameraId is inactive, cross-Site, or missing until the user deliberately selects another camera', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({
      items: [cam1, camInactive, camForeign],
      total: 3,
    });
    const listRegions = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listRegions')
      .mockResolvedValue({ items: [], total: 0 });

    mountWithQuery(
      <ZonePpeCameraRegionPanel
        apiUrl="http://localhost:3000"
        token="token-1"
        sessionScope="scope-1"
        credentialId={1}
        siteId="site-alpha"
        zones={[zone]}
        initialCameraId="cam-inactive"
      />,
    );

    const cameraSelect = (await screen.findByLabelText('Select Camera')) as HTMLSelectElement;
    await waitFor(() =>
      expect(
        screen.queryByText('Please select an active camera to view observation regions.'),
      ).not.toBeNull(),
    );

    expect(cameraSelect.value).toBe('');
    expect(listRegions).not.toHaveBeenCalled();
    expect(refState.lastOptions?.enabled).toBe(false);

    fireEvent.change(cameraSelect, { target: { value: 'cam-1' } });
    await waitFor(() => expect(cameraSelect.value).toBe('cam-1'));
    await waitFor(() => expect(listRegions).toHaveBeenCalledTimes(1));
    expect(listRegions.mock.calls[0]?.[2]).toBe('cam-1');
  });
});
