// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraResponse, Page } from '@smartsite/contracts/management';
import i18n from '../../i18n';
import { CameraSetupCatalog } from './CameraSetupCatalog';
import type { CameraSetupOpenHandler } from './CameraSetupWorkflow';
import { useSetupCatalog } from './useSetupCatalog';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAM_ACTIVE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAM_INACTIVE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const CAMERA_ROWS: [CameraResponse, CameraResponse] = [
  {
    id: CAM_ACTIVE_ID,
    siteId: SITE_ID,
    code: 'CAM-01',
    name: 'North Perimeter Perimeter-Gate High-Elevation Wide-Angle Crane Observation Camera',
    externalId: 'rtsp-north-01',
    status: 'ACTIVE',
    configurationVersion: 4,
    createdAt: '2026-03-01T00:00:00.000Z',
  },
  {
    id: CAM_INACTIVE_ID,
    siteId: SITE_ID,
    code: 'CAM-02',
    name: 'South Material Storage Bay Secondary Entry Camera',
    externalId: 'rtsp-south-02',
    status: 'INACTIVE',
    configurationVersion: 1,
    createdAt: '2026-03-02T00:00:00.000Z',
  },
];

function CatalogHarness({
  open,
  canOpenMonitoring = true,
  requestedCameraId = null,
}: {
  open: CameraSetupOpenHandler;
  canOpenMonitoring?: boolean;
  requestedCameraId?: string | null;
}) {
  const cameras = useSetupCatalog<CameraResponse>(
    ['test-camera-catalog', SITE_ID],
    true,
    async () => ({ items: CAMERA_ROWS, total: CAMERA_ROWS.length }) satisfies Page<CameraResponse>,
  );
  return (
    <CameraSetupCatalog
      siteId={SITE_ID}
      siteCode="SITE-A"
      siteName="Alpha Site"
      canOpenMonitoring={canOpenMonitoring}
      capabilities={{ canManageZones: true, canManageRegions: true }}
      canReadCameras={true}
      canReadZones={true}
      cameras={cameras}
      rows={cameras.rows}
      requestedCameraId={requestedCameraId}
      cameraError={null}
      open={open}
    />
  );
}

describe('CameraSetupCatalog row hierarchy and action semantics', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('distinguishes selected camera row, orders setup actions ahead of monitoring links, and preserves selection and dialog callbacks', async () => {
    const open = vi.fn<CameraSetupOpenHandler>();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/camera-setup']}>
          <CatalogHarness open={open} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const activeItem = await screen.findByRole('listitem', {
      name: CAMERA_ROWS[0].name,
    });
    const inactiveItem = screen.getByRole('listitem', {
      name: CAMERA_ROWS[1].name,
    });

    expect(activeItem.getAttribute('aria-current')).toBe('true');
    expect(inactiveItem.getAttribute('aria-current')).toBeNull();
    expect(
      within(activeItem)
        .getByRole('button', { name: 'Selected CAM-01' })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    const regionsBtn = within(activeItem).getByRole('button', { name: 'Regions' });
    const manageActiveBtn = within(activeItem).getByRole('button', {
      name: `Manage ${CAMERA_ROWS[0].name}`,
    });
    const ppeLink = within(activeItem).getByRole('link', { name: /PPE monitoring/i });
    const zonesLink = within(activeItem).getByRole('link', { name: /Zone monitoring/i });

    expect(
      Boolean(
        regionsBtn.compareDocumentPosition(manageActiveBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(manageActiveBtn.compareDocumentPosition(ppeLink) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(ppeLink.getAttribute('href')).toBe(`/ppe?siteId=${SITE_ID}&cameraId=${CAM_ACTIVE_ID}`);
    expect(zonesLink.getAttribute('href')).toBe(
      `/zones?siteId=${SITE_ID}&cameraId=${CAM_ACTIVE_ID}`,
    );

    // Inactive row hides Regions and monitoring links, and routes name/Manage clicks to 'manage'
    expect(within(inactiveItem).queryByRole('button', { name: 'Regions' })).toBeNull();
    expect(within(inactiveItem).queryByRole('link', { name: /PPE monitoring/i })).toBeNull();

    fireEvent.click(within(inactiveItem).getByRole('button', { name: 'Select CAM-02' }));
    expect(inactiveItem.getAttribute('aria-current')).toBe('true');
    expect(activeItem.getAttribute('aria-current')).toBeNull();

    fireEvent.click(within(inactiveItem).getByRole('button', { name: CAMERA_ROWS[1].name }));
    expect(open).toHaveBeenLastCalledWith('manage', CAM_INACTIVE_ID, expect.any(HTMLButtonElement));

    fireEvent.click(regionsBtn);
    expect(open).toHaveBeenLastCalledWith('regions', CAM_ACTIVE_ID, regionsBtn);
  });
});
