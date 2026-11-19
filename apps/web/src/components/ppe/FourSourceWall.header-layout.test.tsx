// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import { FourSourceWallTile } from './FourSourceWall';

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: () => ({
    preview: null,
    status: 'UNAVAILABLE' as const,
    sourceKind: null,
    capturedAt: '2026-11-19T10:42:18.000Z',
    error: 'Offline',
    errorStatus: 503,
    isLoading: false,
    isPolling: false,
    cameraExternalId: 'cam-ext-01',
    siteId: '11111111-1111-4111-8111-111111111111',
    cameraId: '22222222-2222-4222-8222-222222222222',
    retry: vi.fn(),
  }),
}));

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAMERA: CameraResponse = {
  type: 'ZONE',
  gateId: null,
  id: '22222222-2222-4222-8222-222222222222',
  siteId: SITE_ID,
  code: 'CAM-NORTH-CRANE-01',
  name: 'North Crane Walkway Perimeter Camera With Long Label',
  externalId: 'cam-ext-01',
  status: 'ACTIVE',
  configurationVersion: 3,
  createdAt: '2026-11-01T00:00:00.000Z',
};

describe('FourSourceWallTile header truncation and UUID-derived zone code suppression', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('prefers human zone name over UUID-derived zone codes in the tile header chip and enforces bounded truncation so badges never collide', async () => {
    const uuidZoneCode = 'ZONE-5F8A3B12-9012-4A67-8CDE-1234567890AB';
    const mockClient = {
      getCameraObservationZones: vi.fn().mockResolvedValue({
        siteId: SITE_ID,
        cameraId: CAMERA.id,
        configurationVersion: 3,
        items: [
          {
            id: '5f8a3b12-9012-4a67-8cde-1234567890ab',
            code: uuidZoneCode,
            name: 'North Crane Restricted Zone',
          },
        ],
        total: 1,
        unresolvedRegionCount: 0,
      }),
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <FourSourceWallTile
          apiUrl="http://127.0.0.1:3000"
          client={mockClient}
          token="tok-1"
          sessionScope="scope-1"
          credentialId={1}
          siteId={SITE_ID}
          siteCode="SITE-NORTH"
          siteName="North Tower"
          camera={CAMERA}
          isSelected={true}
          onSelect={vi.fn()}
          enabled={true}
          showModelObjects={false}
        />
      </QueryClientProvider>,
    );

    const chip = await screen.findByTestId(`wall-zone-chip-${CAMERA.id}`);
    expect(chip.textContent).toBe('North Crane Restricted Zone');
    expect(chip.textContent).not.toContain('5F8A3B12');
    expect(chip.className).toContain('truncate');
    expect(chip.parentElement?.className ?? '').toContain('min-w-0');
  });
});
