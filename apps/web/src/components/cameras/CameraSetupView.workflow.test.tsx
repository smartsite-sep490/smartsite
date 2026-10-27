// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import type { CameraResponse, SiteResponse } from '@smartsite/contracts/management';
import type { SharedSession } from '../../types/shared-session';
import { changeUiLanguage } from '../../i18n/runtime';
import { CameraSetupView } from './CameraSetupView';

const mocks = vi.hoisted(() => ({
  listSites: vi.fn(),
  listCameras: vi.fn(),
  listPreviewCameras: vi.fn(),
  client: {} as Record<string, unknown>,
  section: undefined as string | undefined,
  initialCameraId: undefined as string | undefined,
  canManageZones: false,
  canManageRegions: false,
  canReadZones: false,
}));
vi.mock('../../features/auth/auth-session', () => ({ useManagementClient: () => mocks.client }));
vi.mock('../ppe/ZonePpeSetupDialog', () => ({
  ZonePpeSetupDialog: (props: {
    section?: string;
    initialCameraId?: string;
    canReadZones?: boolean;
    canManageZones: boolean;
    canManageRegions: boolean;
    onClose: () => void;
  }) => {
    mocks.section = props.section;
    mocks.initialCameraId = props.initialCameraId;
    mocks.canManageZones = props.canManageZones;
    mocks.canManageRegions = props.canManageRegions;
    mocks.canReadZones = Boolean(props.canReadZones);
    return (
      <div role="dialog">
        <button onClick={props.onClose}>Close setup task</button>
      </div>
    );
  },
}));
vi.mock('./CameraRegistrationDialog', () => ({
  CameraRegistrationDialog: () => <div role="dialog">Register camera form</div>,
}));
const site: SiteResponse = {
  id: 'site-1',
  code: 'S1',
  name: 'North Site',
  createdAt: '2026-10-17T00:00:00Z',
};
const activeCamera: CameraResponse = {
  id: 'cam-1',
  siteId: site.id,
  code: 'C1',
  name: 'Gate camera',
  externalId: 'source-gate',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: site.createdAt,
};
const inactiveCamera: CameraResponse = {
  id: 'cam-2',
  siteId: site.id,
  code: 'C2',
  name: 'Storage camera',
  externalId: 'source-storage',
  status: 'INACTIVE',
  configurationVersion: 1,
  createdAt: site.createdAt,
};
const manager: SharedSession = {
  accessToken: 'synthetic-token',
  sessionScope: 'workflow-session',
  user: {
    id: 'manager',
    displayName: 'Manager',
    roleAssignments: [{ role: 'SITE_MANAGER', siteId: site.id }],
  },
};
const caches: QueryClient[] = [];
function mount(session = manager) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  caches.push(cache);
  const tree = (value: SharedSession) => (
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <CameraSetupView apiUrl="http://localhost:3000" sharedSession={value} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(session));
  return { rerender: (value: SharedSession) => view.rerender(tree(value)) };
}
beforeEach(() => {
  changeUiLanguage('en');
  mocks.listSites.mockReset().mockResolvedValue({ items: [site], total: 1 });
  mocks.listCameras.mockReset().mockResolvedValue({
    items: [activeCamera, inactiveCamera],
    total: 2,
  });
  mocks.listPreviewCameras.mockReset();
  mocks.client = {
    listSites: mocks.listSites,
    listCameras: mocks.listCameras,
    listPreviewCameras: mocks.listPreviewCameras,
  };
  mocks.section = undefined;
  mocks.initialCameraId = undefined;
  mocks.canManageZones = false;
  mocks.canManageRegions = false;
  mocks.canReadZones = false;
});
afterEach(() => {
  cleanup();
  caches.splice(0).forEach((cache) => cache.clear());
});

it('makes the ordered setup workflow visible with one action per task and separate policy/region entry', async () => {
  mount();
  const camerasSection = await screen.findByRole('region', { name: 'Cameras' });
  await within(camerasSection).findByRole('heading', { name: activeCamera.name });

  const helpSummary = within(camerasSection).getByText('Setup guide').closest('summary');
  const helpDetails = helpSummary?.parentElement;
  if (!(helpDetails instanceof HTMLDetailsElement) || !helpSummary) {
    throw new Error('Expected native details/summary for setup help.');
  }
  expect(helpDetails.open).toBe(false);
  fireEvent.click(helpSummary);
  expect(helpDetails.open).toBe(true);

  const guide = within(helpDetails).getByRole('list', { name: 'Four-stage setup reference' });
  expect(guide.tagName).toBe('OL');
  expect(within(guide).getAllByRole('listitem')).toHaveLength(4);
  expect(within(guide).queryByRole('button')).toBeNull();

  for (const name of ['Configure PPE by Zone', 'Register camera', 'Link observation regions']) {
    expect(within(camerasSection).getAllByRole('button', { name })).toHaveLength(1);
  }
  fireEvent.click(within(camerasSection).getByRole('button', { name: 'Configure PPE by Zone' }));
  expect(mocks.section).toBe('zones');
  expect(mocks.initialCameraId).toBeUndefined();
  expect(mocks.canManageZones).toBe(true);
  expect(mocks.canManageRegions).toBe(true);
  expect(mocks.canReadZones).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Close setup task' }));

  const activeRow = within(camerasSection)
    .getByRole('heading', { name: activeCamera.name })
    .closest('li');
  if (!activeRow) {
    throw new Error('Expected active camera row.');
  }
  fireEvent.click(within(activeRow).getByRole('button', { name: 'Link observation regions' }));
  expect(mocks.section).toBe('regions');
  expect(mocks.initialCameraId).toBe(activeCamera.id);
  expect(mocks.canManageZones).toBe(true);
  expect(mocks.canManageRegions).toBe(true);
  expect(mocks.listPreviewCameras).not.toHaveBeenCalled();
});

it('keeps registration on its existing form through the workflow entry', async () => {
  mount();
  const camerasSection = await screen.findByRole('region', { name: 'Cameras' });
  fireEvent.click(within(camerasSection).getByRole('button', { name: 'Register camera' }));
  expect(screen.getByRole('dialog').textContent).toBe('Register camera form');
  expect(mocks.listPreviewCameras).not.toHaveBeenCalled();
});

it('offers Admin policy reading but no camera or Region writer in the visible guide', async () => {
  mount({
    ...manager,
    user: { ...manager.user, roleAssignments: [{ role: 'ADMIN', siteId: null }] },
  });
  const camerasSection = await screen.findByRole('region', { name: 'Cameras' });
  await within(camerasSection).findByRole('heading', { name: activeCamera.name });
  fireEvent.click(within(camerasSection).getByRole('button', { name: 'View area policies' }));
  expect(mocks.section).toBe('zones');
  expect(mocks.canReadZones).toBe(true);
  expect(mocks.canManageZones).toBe(false);
  expect(mocks.canManageRegions).toBe(false);
  expect(screen.queryByRole('button', { name: 'Link observation regions' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
});

it('does not grant task actions to a Site Manager assigned to another Site', async () => {
  mount({
    ...manager,
    user: { ...manager.user, roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'other' }] },
  });
  await screen.findByRole('option', { name: 'S1 · North Site' });
  for (const name of ['Configure PPE by Zone', 'Register camera', 'Link observation regions']) {
    expect(screen.queryByRole('button', { name })).toBeNull();
  }
  expect(mocks.listCameras).not.toHaveBeenCalled();
});

it('preserves a policy task on locale changes and removes it on role withdrawal', async () => {
  const { rerender } = mount();
  const camerasSection = await screen.findByRole('region', { name: 'Cameras' });
  await within(camerasSection).findByRole('heading', { name: activeCamera.name });
  fireEvent.click(within(camerasSection).getByRole('button', { name: 'Configure PPE by Zone' }));
  const dialog = screen.getByRole('dialog');
  await act(async () => changeUiLanguage('vi'));
  expect(screen.getByRole('dialog')).toBe(dialog);
  const translatedCameras = screen.getByRole('region', { name: 'Camera' });
  expect(
    within(translatedCameras).getByRole('list', { name: 'Tham chiếu 4 bước thiết lập' }),
  ).toBeTruthy();
  expect(within(translatedCameras).getByRole('button', { name: 'Gắn vùng quan sát' })).toBeTruthy();
  rerender({
    ...manager,
    user: { ...manager.user, roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: site.id }] },
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cấu hình PPE theo khu vực' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Đăng ký camera' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Gắn vùng quan sát' })).toBeNull();
});

it('keeps policy management independent of a denied camera catalog without exposing Region actions', async () => {
  mocks.listCameras.mockRejectedValue(new ApiError('http', 'Denied', 403));
  mount();
  await screen.findByText('Configuration access is unavailable for this scope.');
  expect(screen.queryByRole('button', { name: 'Link observation regions' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Configure PPE by Zone' }));
  expect(mocks.section).toBe('zones');
  expect(mocks.canManageZones).toBe(true);
  expect(mocks.canManageRegions).toBe(false);
});

it('exposes per-row PPE and Restricted-zone monitoring links with siteId and cameraId only for active scoped rows when monitoring access is authorized', async () => {
  const foreignActiveCamera: CameraResponse = {
    ...activeCamera,
    id: 'cam-foreign',
    siteId: 'site-2',
    code: 'CF',
    name: 'Foreign camera',
  };
  mocks.listCameras.mockResolvedValue({
    items: [activeCamera, inactiveCamera, foreignActiveCamera],
    total: 3,
  });

  const { rerender } = mount();
  const camerasSection = await screen.findByRole('region', { name: 'Cameras' });
  const activeHeading = await within(camerasSection).findByRole('heading', {
    name: activeCamera.name,
  });
  const inactiveHeading = within(camerasSection).getByRole('heading', {
    name: inactiveCamera.name,
  });
  expect(
    within(camerasSection).queryByRole('heading', { name: foreignActiveCamera.name }),
  ).toBeNull();

  const activeRow = activeHeading.closest('li')!;
  const inactiveRow = inactiveHeading.closest('li')!;

  expect(within(activeRow).queryByRole('link')).toBeNull();
  expect(within(inactiveRow).queryByRole('link')).toBeNull();
  expect(within(activeRow).getByRole('button', { name: 'Link observation regions' })).toBeTruthy();

  rerender({
    ...manager,
    user: {
      ...manager.user,
      roleAssignments: [{ role: 'ADMIN', siteId: null }],
    },
  });

  const refreshedHeading = await screen.findByRole('heading', { name: activeCamera.name });
  const adminRow = refreshedHeading.closest('li')!;
  const adminInactiveRow = screen
    .getByRole('heading', { name: inactiveCamera.name })
    .closest('li')!;
  const adminPpeLink = await within(adminRow).findByRole('link', {
    name: `PPE monitoring ${activeCamera.name}`,
  });
  const adminZonesLink = within(adminRow).getByRole('link', {
    name: `Restricted-zone monitoring ${activeCamera.name}`,
  });
  expect(adminPpeLink.getAttribute('href')).toBe('/ppe?siteId=site-1&cameraId=cam-1');
  expect(adminZonesLink.getAttribute('href')).toBe('/zones?siteId=site-1&cameraId=cam-1');
  expect(within(adminRow).queryByRole('button', { name: 'Link observation regions' })).toBeNull();
  expect(
    within(adminRow).queryByRole('button', { name: `Manage ${activeCamera.name}` }),
  ).toBeNull();
  expect(within(adminInactiveRow).queryByRole('link')).toBeNull();

  await act(async () => changeUiLanguage('vi'));
  const translatedCameras = screen.getByRole('region', { name: 'Camera' });
  const viActiveRow = within(translatedCameras)
    .getByRole('heading', { name: activeCamera.name })
    .closest('li')!;
  expect(
    within(viActiveRow)
      .getByRole('link', { name: `Giám sát PPE ${activeCamera.name}` })
      .getAttribute('href'),
  ).toBe('/ppe?siteId=site-1&cameraId=cam-1');
  expect(
    within(viActiveRow)
      .getByRole('link', { name: `Giám sát vùng hạn chế ${activeCamera.name}` })
      .getAttribute('href'),
  ).toBe('/zones?siteId=site-1&cameraId=cam-1');
});
