import React from 'react';
import { render, screen } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { vi } from 'vitest';
import {
  CONFIGURATION_REFERENCE_LIFETIME_MS,
  SmartSiteManagementClient,
  parseCameraConfigurationImageResponse,
  type CameraConfigurationImageResponse,
  type Page,
  type ZoneResponse,
} from '@smartsite/api-client';
import type { CameraResponse, RegionResponse } from '@smartsite/contracts';
import { LocaleProvider } from '../../i18n/LocaleProvider';
import type { CameraConfigurationReference } from './useCameraConfigurationReference';
import {
  ZonePpeCameraRegionPanel,
  type ZonePpeCameraRegionPanelProps,
} from './ZonePpeCameraRegionPanel';

export function installReferencePanelDomPolyfills(): void {
  if (typeof globalThis.ResizeObserver !== 'function') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }

  if (typeof SVGElement !== 'undefined') {
    SVGElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 120,
      height: 80,
      right: 120,
      bottom: 80,
    });
  }
}

export const SITE_A = '11111111-1111-4111-8111-111111111111';
export const SITE_B = '99999999-9999-4999-8999-999999999999';
export const CAM_1 = '22222222-2222-4222-8222-222222222222';
export const CAM_2 = '44444444-4444-4444-8444-444444444444';
export const SESSION_1 = '33333333-3333-4333-8333-333333333333';
export const ZONE_1 = '55555555-5555-4555-8555-555555555555';
export const ZONE_2 = '66666666-6666-4666-8666-666666666666';
export const BASE_TIME_MS = Date.parse('2026-10-15T09:00:00.000Z');

export const SYNTHETIC_JPEG_120X80 = Buffer.from([
  255, 216, 255, 192, 0, 17, 8, 0, 80, 0, 120, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217,
]).toString('base64');

export function buildCanonicalReference(
  overrides: Partial<CameraConfigurationImageResponse> = {},
  frameOverrides: Partial<CameraConfigurationImageResponse['frame']> = {},
): CameraConfigurationReference {
  const capturedAt = frameOverrides.capturedAt ?? new Date(Date.now()).toISOString();
  const expiresAt =
    overrides.referenceExpiresAt ??
    new Date(Date.parse(capturedAt) + CONFIGURATION_REFERENCE_LIFETIME_MS).toISOString();
  const dto = parseCameraConfigurationImageResponse({
    schemaVersion: 1,
    purpose: 'REGION_CONFIGURATION',
    sourceKind: 'LIVE',
    siteId: SITE_A,
    cameraId: CAM_1,
    configurationVersion: 3,
    referenceExpiresAt: expiresAt,
    ...overrides,
    frame: {
      cameraExternalId: 'CAM-EXT-01',
      sessionId: SESSION_1,
      sequenceNumber: '1',
      capturedAt,
      width: 120,
      height: 80,
      imageDataUrl: `data:image/jpeg;base64,${SYNTHETIC_JPEG_120X80}`,
      imageSha256: 'a'.repeat(64),
      ...frameOverrides,
    },
  });
  const image = new Image();
  Object.defineProperty(image, 'naturalWidth', { value: dto.frame.width, configurable: true });
  Object.defineProperty(image, 'naturalHeight', { value: dto.frame.height, configurable: true });
  return { ...dto, image };
}

export const mockZones: ZoneResponse[] = [
  {
    id: ZONE_1,
    siteId: SITE_A,
    code: 'ZONE-A1',
    name: 'Scaffold Hazard Zone',
    type: 'HAZARDOUS',
    restrictionPolicy: 'NONE',
    requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
    configurationLocked: false,
    createdAt: '2026-10-07T00:00:00Z',
  },
  {
    id: ZONE_2,
    siteId: SITE_A,
    code: 'ZONE-A2',
    name: 'Crane Perimeter Zone',
    type: 'HAZARDOUS',
    restrictionPolicy: 'NONE',
    requiredPpe: ['HARD_HAT'],
    configurationLocked: false,
    createdAt: '2026-10-07T00:00:00Z',
  },
];

export const baseCamera: CameraResponse = {
  id: CAM_1,
  siteId: SITE_A,
  externalId: 'CAM-EXT-01',
  code: 'CAM-01',
  name: 'North Gate Camera',
  status: 'ACTIVE',
  configurationVersion: 3,
  createdAt: '2026-09-30T00:00:00Z',
};

export const existingRegionFixture: RegionResponse = {
  id: 'reg-existing-1',
  cameraId: CAM_1,
  zoneId: ZONE_1,
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
  createdAt: '2026-10-10T00:00:00Z',
};

export function stubCameraAndRegionPages(
  cameras: CameraResponse[] = [baseCamera],
  regions: RegionResponse[] = [],
): void {
  vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockImplementation(
    async (): Promise<Page<CameraResponse>> => ({
      items: cameras,
      total: cameras.length,
    }),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockImplementation(
    async (): Promise<Page<RegionResponse>> => ({
      items: regions,
      total: regions.length,
    }),
  );
}

export async function addPointViaInputs(
  user: ReturnType<typeof userEvent.setup>,
  x: string,
  y: string,
): Promise<void> {
  const xInput = screen.getByLabelText(/Point X/i);
  const yInput = screen.getByLabelText(/Point Y/i);
  await user.clear(xInput);
  await user.type(xInput, x);
  await user.clear(yInput);
  await user.type(yInput, y);
  await user.click(screen.getByRole('button', { name: /Add Point/i }));
}

export async function addTriangleViaInputs(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  for (const [x, y] of [
    ['0.1', '0.1'],
    ['0.8', '0.1'],
    ['0.8', '0.8'],
  ] as const) {
    await addPointViaInputs(user, x, y);
  }
}

export function stubRegionMutationSpies(onCreated?: () => void) {
  const createSpy = vi
    .spyOn(SmartSiteManagementClient.prototype, 'createRegion')
    .mockImplementation(async (_token, _siteId, cameraId, payload) => {
      onCreated?.();
      return {
        region: {
          id: 'reg-created-1',
          cameraId,
          zoneId: payload.zoneId,
          polygon: payload.polygon,
          coordinateSpace: 'NORMALIZED_0_1',
          version: 1,
          isActive: true,
          createdAt: '2026-10-15T09:01:00Z',
        },
        configurationVersion: payload.expectedConfigurationVersion + 1,
      };
    });
  const updateSpy = vi
    .spyOn(SmartSiteManagementClient.prototype, 'updatePolygon')
    .mockImplementation(async (_token, _siteId, cameraId, regionId, payload) => ({
      region: {
        id: regionId,
        cameraId,
        zoneId: ZONE_1,
        polygon: payload.polygon,
        coordinateSpace: 'NORMALIZED_0_1',
        version: 2,
        isActive: true,
        createdAt: '2026-10-15T09:01:00Z',
      },
      configurationVersion: payload.expectedConfigurationVersion + 1,
    }));
  return { createSpy, updateSpy };
}

export function renderReferencePanel(
  queryClient: QueryClient,
  overrides: Partial<ZonePpeCameraRegionPanelProps> = {},
) {
  const props: ZonePpeCameraRegionPanelProps = {
    apiUrl: 'http://localhost:3000',
    token: 'admin-jwt-token',
    sessionScope: 'admin:GLOBAL',
    credentialId: 7,
    siteId: SITE_A,
    zones: mockZones,
    ...overrides,
  };
  const view = render(
    <LocaleProvider defaultLocale="en">
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel {...props} />
      </QueryClientProvider>
    </LocaleProvider>,
  );
  return {
    ...view,
    rerenderWith: (nextOverrides: Partial<ZonePpeCameraRegionPanelProps> = {}) =>
      view.rerender(
        <LocaleProvider defaultLocale="en">
          <QueryClientProvider client={queryClient}>
            <ZonePpeCameraRegionPanel {...props} {...nextOverrides} />
          </QueryClientProvider>
        </LocaleProvider>,
      ),
  };
}
