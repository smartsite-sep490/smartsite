// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraResponse, SiteResponse } from '@smartsite/contracts/management';
import { changeUiLanguage } from '../../i18n/runtime';
import type { SharedSession } from '../../types/shared-session';
import { CameraSetupView } from './CameraSetupView';

const mocks = vi.hoisted(() => ({
  listSites: vi.fn(),
  listCameras: vi.fn(),
  listPreviewCameras: vi.fn(),
  client: {} as Record<string, unknown>,
  zoneDialogProps: null as null | {
    section?: string;
    initialCameraId?: string;
    canManageZones: boolean;
    canManageRegions: boolean;
  },
}));

vi.mock('../../features/auth/auth-session', () => ({
  useManagementClient: () => mocks.client,
}));
vi.mock('./CameraRegistrationDialog', () => ({
  CameraRegistrationDialog: () => <div role="dialog">Register camera dialog</div>,
}));
vi.mock('./CameraManagementDialog', () => ({
  CameraManagementDialog: ({ camera }: { camera: CameraResponse }) => (
    <div role="dialog">Manage {camera.name} dialog</div>
  ),
}));
vi.mock('../ppe/ZonePpeSetupDialog', () => ({
  ZonePpeSetupDialog: (props: {
    section?: string;
    initialCameraId?: string;
    canManageZones: boolean;
    canManageRegions: boolean;
  }) => {
    mocks.zoneDialogProps = props;
    return (
      <div role="dialog">
        Section {props.section ?? 'all'} Camera {props.initialCameraId ?? 'none'}
      </div>
    );
  },
}));

const site: SiteResponse = {
  id: 'site-1',
  code: 'S1',
  name: 'North Site',
  createdAt: '2026-10-16T00:00:00Z',
};

const gateCamera: CameraResponse = {
  id: 'cam-1',
  siteId: site.id,
  code: 'C1',
  name: 'Gate camera',
  externalId: 'source-gate',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: site.createdAt,
};

const towerCamera: CameraResponse = {
  id: 'cam-2',
  siteId: site.id,
  code: 'C2',
  name: 'Tower camera',
  externalId: 'source-tower',
  status: 'ACTIVE',
  configurationVersion: 2,
  createdAt: site.createdAt,
};

const inactiveCamera: CameraResponse = {
  id: 'cam-3',
  siteId: site.id,
  code: 'C3',
  name: 'Storage camera',
  externalId: 'source-storage',
  status: 'INACTIVE',
  configurationVersion: 1,
  createdAt: site.createdAt,
};

const managerSession: SharedSession = {
  accessToken: 'private-token',
  sessionScope: 'session-1',
  user: {
    id: 'manager-1',
    displayName: 'Site Manager',
    roleAssignments: [{ role: 'SITE_MANAGER', siteId: site.id }],
  },
};

const adminSession: SharedSession = {
  ...managerSession,
  user: {
    id: 'admin-1',
    displayName: 'Global Admin',
    roleAssignments: [{ role: 'ADMIN', siteId: null }],
  },
};

const caches: QueryClient[] = [];

function mount(session: SharedSession = managerSession, entry = '/camera-setup') {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  caches.push(cache);
  return render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[entry]}>
        <CameraSetupView apiUrl="http://localhost:3000" sharedSession={session} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  changeUiLanguage('en');
  mocks.zoneDialogProps = null;
  mocks.listSites.mockReset().mockResolvedValue({ items: [site], total: 1 });
  mocks.listCameras.mockReset().mockResolvedValue({
    items: [gateCamera, towerCamera, inactiveCamera],
    total: 3,
  });
  mocks.listPreviewCameras.mockReset();
  mocks.client = {
    listSites: mocks.listSites,
    listCameras: mocks.listCameras,
    listPreviewCameras: mocks.listPreviewCameras,
  };
});

afterEach(() => {
  changeUiLanguage('en');
  cleanup();
  caches.splice(0).forEach((cache) => cache.clear());
  vi.restoreAllMocks();
});

describe('CameraSetupView workspace hierarchy & per-camera region binding', () => {
  it('anchors setup around the camera list with per-row region actions on active cameras, secondary Manage details, and default-closed help without a competing global Region CTA', async () => {
    mount();
    await screen.findByText(towerCamera.name);

    const camerasSection = screen.getByRole('region', { name: 'Cameras' });
    expect(within(camerasSection).getByRole('button', { name: 'Register camera' })).toBeTruthy();
    expect(
      within(camerasSection).getByRole('button', { name: 'Configure PPE by Zone' }),
    ).toBeTruthy();

    const helpSummary = screen.getByText('Setup guide').closest('summary');
    const helpDetails = helpSummary?.parentElement;
    if (!(helpDetails instanceof HTMLDetailsElement) || !helpSummary) {
      throw new Error('Expected native details/summary for setup help.');
    }
    expect(helpDetails.open).toBe(false);
    expect(
      within(helpDetails).getByRole('list', { name: 'Four-stage setup reference' }),
    ).toBeTruthy();
    expect(within(helpDetails).queryByRole('button')).toBeNull();

    const gateRow = screen.getByRole('heading', { name: gateCamera.name }).closest('li');
    const towerRow = screen.getByRole('heading', { name: towerCamera.name }).closest('li');
    const inactiveRow = screen.getByRole('heading', { name: inactiveCamera.name }).closest('li');
    if (!gateRow || !towerRow || !inactiveRow) {
      throw new Error('Expected camera list rows.');
    }

    expect(within(gateRow).getByRole('button', { name: 'Link observation regions' })).toBeTruthy();
    expect(within(gateRow).getByRole('button', { name: 'Manage Gate camera' })).toBeTruthy();

    expect(
      within(inactiveRow).queryByRole('button', { name: 'Link observation regions' }),
    ).toBeNull();
    expect(within(inactiveRow).getByRole('button', { name: 'Manage Storage camera' })).toBeTruthy();

    expect(screen.getAllByRole('button', { name: 'Link observation regions' })).toHaveLength(2);

    fireEvent.click(within(towerRow).getByRole('button', { name: 'Link observation regions' }));
    expect(screen.getByRole('dialog').textContent).toContain('Section regions Camera cam-2');
    expect(mocks.zoneDialogProps?.initialCameraId).toBe(towerCamera.id);
  });

  it('keeps Register camera on an empty catalog, hides all region/camera writes on base error or read-only Admin, and never promises Admin region configuration', async () => {
    mocks.listCameras.mockResolvedValueOnce({ items: [], total: 0 });
    mount();
    await screen.findByText('No cameras registered.');

    expect(screen.getByRole('button', { name: 'Register camera' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Link observation regions' })).toBeNull();

    cleanup();
    mocks.listCameras.mockRejectedValueOnce(new Error('catalog failure'));
    mount();
    await screen.findByRole('alert');

    expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Link observation regions' })).toBeNull();

    cleanup();
    mount(adminSession);
    await screen.findByText(gateCamera.name);

    expect(screen.getByRole('button', { name: 'View area policies' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Link observation regions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Manage Gate camera' })).toBeNull();
  });

  it('preserves expanded setup help and updates camera-row region actions in place on locale switch without extra fetches', async () => {
    mount();
    await screen.findByText(gateCamera.name);

    const helpSummary = screen.getByText('Setup guide').closest('summary');
    const helpDetails = helpSummary?.parentElement;
    if (!(helpDetails instanceof HTMLDetailsElement) || !helpSummary) {
      throw new Error('Expected native details/summary for setup help.');
    }

    fireEvent.click(helpSummary);
    expect(helpDetails.open).toBe(true);

    await act(async () => changeUiLanguage('vi'));

    expect(helpDetails.isConnected).toBe(true);
    expect(helpDetails.open).toBe(true);
    expect(screen.getByText('Hướng dẫn thiết lập').closest('summary')).toBe(helpSummary);

    const gateRow = screen.getByRole('heading', { name: gateCamera.name }).closest('li');
    if (!gateRow) {
      throw new Error('Expected Gate camera row.');
    }
    expect(within(gateRow).getByRole('button', { name: 'Gắn vùng quan sát' })).toBeTruthy();
    expect(within(gateRow).getByRole('button', { name: 'Quản lý Gate camera' })).toBeTruthy();
    expect(mocks.listSites).toHaveBeenCalledTimes(1);
    expect(mocks.listCameras).toHaveBeenCalledTimes(1);
  });
});
