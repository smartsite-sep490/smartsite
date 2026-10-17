// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTranslation } from 'react-i18next';
import type { Page } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import { changeUiLanguage, SAFETY_NAMESPACE } from '../../i18n/runtime';
import { deriveZonePpeCapabilities } from '../ppe/zone-ppe-scope';
import './camera-setup-catalog';
import { CameraSetupCatalog } from './CameraSetupCatalog';
import { useSetupCatalog } from './useSetupCatalog';

const SITE_ID = 'site-1';
const activeCamera: CameraResponse = {
  id: 'cam-active-1',
  siteId: SITE_ID,
  code: 'C1',
  name: 'Gate camera',
  externalId: 'private-source-alias-1',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-10-16T00:00:00Z',
};
const inactiveCamera: CameraResponse = {
  ...activeCamera,
  id: 'cam-inactive-2',
  code: 'C2',
  name: 'Perimeter camera',
  externalId: 'private-source-alias-2',
  status: 'INACTIVE',
  configurationVersion: 2,
};

type RoleUser = {
  roleAssignments: ReadonlyArray<{ role: string; siteId: string | null }>;
  mustChangePassword?: boolean;
};
const managerUser: RoleUser = { roleAssignments: [{ role: 'SITE_MANAGER', siteId: SITE_ID }] };
const adminUser: RoleUser = { roleAssignments: [{ role: 'ADMIN', siteId: null }] };
const foreignManagerUser: RoleUser = {
  roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'site-other' }],
};
const activeClients: QueryClient[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type HarnessProps = {
  user?: RoleUser | null;
  siteId?: string;
  load: (offset: number, signal: AbortSignal) => Promise<Page<CameraResponse>>;
  open: (kind: 'register' | 'manage' | 'zones', cameraId?: string) => void;
};

function CatalogHarness({ user = managerUser, siteId = SITE_ID, load, open }: HarnessProps) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const capabilities = deriveZonePpeCapabilities(user, siteId);
  const canReadCameras = Boolean(
    user &&
    !user.mustChangePassword &&
    siteId &&
    user.roleAssignments.some(
      ({ role, siteId: assignedSiteId }) =>
        (role === 'ADMIN' && assignedSiteId === null) ||
        (assignedSiteId === siteId && ['SITE_MANAGER', 'SAFETY_OFFICER'].includes(role)),
    ),
  );
  const cameras = useSetupCatalog<CameraResponse>(
    ['camera-setup-catalog', siteId],
    canReadCameras,
    load,
  );
  const rows = cameras.rows.filter((row) => row.siteId === siteId);
  const errorKey =
    cameras.status === 403 || cameras.status === 404
      ? 'cameraSetup.forbidden'
      : 'cameraSetup.error';
  return (
    <CameraSetupCatalog
      capabilities={capabilities}
      canReadCameras={canReadCameras}
      cameras={cameras}
      rows={rows}
      cameraError={cameras.error ? <div role="alert">{t(errorKey)}</div> : null}
      open={open}
    />
  );
}

function mountCatalog(options?: Partial<Pick<HarnessProps, 'user' | 'siteId' | 'load'>>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  activeClients.push(client);
  const load =
    options?.load ?? vi.fn().mockResolvedValue({ items: [activeCamera, inactiveCamera], total: 2 });
  const open = vi.fn<(kind: 'register' | 'manage' | 'zones', cameraId?: string) => void>();
  const view = render(
    <QueryClientProvider client={client}>
      <CatalogHarness {...options} load={load} open={open} />
    </QueryClientProvider>,
  );
  return { ...view, client, load, open };
}

beforeEach(() => changeUiLanguage('en'));
afterEach(() => {
  cleanup();
  activeClients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  changeUiLanguage('en');
});

it('grants register, zone PPE, and camera-specific manage actions only to the scoped Site Manager while keeping Admin read-only and denying foreign-site manager reads', async () => {
  const managerView = mountCatalog({ user: managerUser });
  await screen.findByText(activeCamera.name);
  expect(screen.getByRole('button', { name: 'Register camera' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Configure PPE by Zone' })).toBeTruthy();
  const manageButton = screen.getByRole('button', { name: `Manage ${activeCamera.name}` });
  expect(manageButton.textContent).toBe('Manage');
  expect(
    screen.getByText('Registration and status describe configuration, not a live connection.'),
  ).toBeTruthy();
  managerView.unmount();

  const adminView = mountCatalog({ user: adminUser });
  await screen.findByText(activeCamera.name);
  expect(screen.getByText(inactiveCamera.name)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
  expect(screen.queryByRole('button', { name: `Manage ${activeCamera.name}` })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Configure PPE by Zone' })).toBeNull();
  expect(
    screen.getByText('The assigned Site Manager configures cameras and observation regions.'),
  ).toBeTruthy();
  expect(screen.getByText('The Site Manager defines PPE requirements for each area.')).toBeTruthy();
  adminView.unmount();

  const foreignView = mountCatalog({ user: foreignManagerUser });
  expect(foreignView.load).not.toHaveBeenCalled();
  expect(screen.queryByText(activeCamera.name)).toBeNull();
  expect(screen.queryByText(inactiveCamera.name)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
  expect(screen.queryByRole('button', { name: `Manage ${activeCamera.name}` })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Configure PPE by Zone' })).toBeNull();
});

it('renders ACTIVE and INACTIVE as configuration status without claiming live stream or AI connectivity', async () => {
  const { container } = mountCatalog();
  await screen.findByText(activeCamera.name);
  expect(screen.getAllByText('Camera code').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Configuration status').length).toBeGreaterThan(0);
  expect(screen.getByText('Enabled in configuration')).toBeTruthy();
  expect(screen.getByText('Disabled in configuration')).toBeTruthy();
  expect(container.textContent).not.toMatch(
    /camera online|stream connected|live stream|ai connected|ai active/i,
  );
  expect(container.querySelector('video, canvas, img')).toBeNull();
});

it('distinguishes pending, base-error, partial-page, and settled-empty states without inventing a successful empty catalog', async () => {
  const pendingLoad = deferred<Page<CameraResponse>>();
  const pendingView = mountCatalog({ load: vi.fn(() => pendingLoad.promise) });
  expect(screen.getByRole('status').textContent).toBe('Loading configuration…');
  expect(screen.queryByText('No cameras registered.')).toBeNull();
  pendingView.unmount();

  const errorView = mountCatalog({ load: vi.fn().mockRejectedValue(new Error('network')) });
  await screen.findByRole('alert');
  expect(screen.queryByText('No cameras registered.')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
  errorView.unmount();

  const foreignRow = { ...activeCamera, id: 'cam-foreign', siteId: 'site-other' };
  const partialView = mountCatalog({
    load: vi.fn().mockResolvedValue({ items: [foreignRow], total: 2 }),
  });
  await screen.findByText('No matching cameras on the loaded pages. More pages are available.');
  expect(screen.queryByText('No cameras registered.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Load more cameras' })).toBeTruthy();
  partialView.unmount();

  mountCatalog({ load: vi.fn().mockResolvedValue({ items: [], total: 0 }) });
  await screen.findByText('No cameras registered.');
  expect(screen.queryByRole('button', { name: 'Load more cameras' })).toBeNull();
});

it('loads offset 0 then offset 1 once on Load more and disables the control while held', async () => {
  const secondPage = deferred<Page<CameraResponse>>();
  const load = vi
    .fn<(offset: number, signal: AbortSignal) => Promise<Page<CameraResponse>>>()
    .mockResolvedValueOnce({ items: [activeCamera], total: 2 })
    .mockImplementationOnce(() => secondPage.promise);
  mountCatalog({ load });
  await screen.findByText(activeCamera.name);
  expect(load).toHaveBeenCalledTimes(1);
  expect(load.mock.calls[0]?.[0]).toBe(0);

  const loadMore = screen.getByRole('button', { name: 'Load more cameras' }) as HTMLButtonElement;
  expect(loadMore.disabled).toBe(false);

  fireEvent.click(loadMore);
  await waitFor(() => expect(loadMore.disabled).toBe(true));
  fireEvent.click(loadMore);
  expect(load).toHaveBeenCalledTimes(2);
  expect(load.mock.calls.map((call) => call[0])).toEqual([0, 1]);

  await act(async () => secondPage.resolve({ items: [inactiveCamera], total: 2 }));
  await screen.findByText(inactiveCamera.name);
  expect(screen.queryByRole('button', { name: 'Load more cameras' })).toBeNull();
});

it('preserves long synthetic camera name and code text and invokes manage callback with exact camera ID', async () => {
  const longCamera: CameraResponse = {
    ...activeCamera,
    id: 'cam-exact-long-id-001',
    name: 'North Perimeter Tower Crane Telemetry Observation Camera Unit Section Alpha-09',
    code: 'CAM-NORTH-PERIMETER-TOWER-CRANE-TELEMETRY-ALPHA-09-CODE-0001',
  };
  const secondCamera: CameraResponse = {
    ...inactiveCamera,
    id: 'cam-exact-second-id-002',
    name: 'South Gate Turnstile Camera',
    code: 'CAM-SOUTH-GATE-0002',
  };
  const { open } = mountCatalog({
    load: vi.fn().mockResolvedValue({ items: [longCamera, secondCamera], total: 2 }),
  });
  await screen.findByText(longCamera.name);
  expect(screen.getByText(longCamera.code)).toBeTruthy();
  expect(screen.getByText(secondCamera.name)).toBeTruthy();
  expect(screen.getByText(secondCamera.code)).toBeTruthy();

  const longManageButton = screen.getByRole('button', { name: `Manage ${longCamera.name}` });
  expect(longManageButton.textContent).toBe('Manage');
  fireEvent.click(longManageButton);
  expect(open).toHaveBeenLastCalledWith('manage', 'cam-exact-long-id-001');

  const secondManageButton = screen.getByRole('button', { name: `Manage ${secondCamera.name}` });
  expect(secondManageButton.textContent).toBe('Manage');
  fireEvent.click(secondManageButton);
  expect(open).toHaveBeenLastCalledWith('manage', 'cam-exact-second-id-002');

  fireEvent.click(screen.getByRole('button', { name: 'Register camera' }));
  expect(open).toHaveBeenLastCalledWith('register');
  fireEvent.click(screen.getByRole('button', { name: 'Configure PPE by Zone' }));
  expect(open).toHaveBeenLastCalledWith('zones');
});

it('translates EN and VI catalog labels, metadata fields, configuration statuses, counts, and accessible manage actions in place', async () => {
  mountCatalog();
  await screen.findByText(activeCamera.name);
  expect(screen.getByRole('region', { name: 'Cameras' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Areas & PPE' })).toBeTruthy();
  expect(screen.getAllByText('Camera code').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Configuration status').length).toBeGreaterThan(0);
  expect(screen.getByText('2 shown · 2 returned by the catalog')).toBeTruthy();
  expect(screen.getByRole('button', { name: `Manage ${activeCamera.name}` }).textContent).toBe(
    'Manage',
  );

  await act(async () => changeUiLanguage('vi'));
  expect(screen.getByRole('region', { name: 'Camera' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Khu vực & PPE' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Đăng ký camera' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Cấu hình PPE theo khu vực' })).toBeTruthy();
  const viManageButton = screen.getByRole('button', { name: `Quản lý ${activeCamera.name}` });
  expect(viManageButton.textContent).toBe('Quản lý');
  expect(screen.getAllByText('Mã camera').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Trạng thái cấu hình').length).toBeGreaterThan(0);
  expect(screen.getByText('Đã bật trong cấu hình')).toBeTruthy();
  expect(screen.getByText('Đã tắt trong cấu hình')).toBeTruthy();
  expect(screen.getByText('Đang hiện 2 · danh mục trả về 2')).toBeTruthy();
  expect(screen.getByText('Cách thiết lập công trường')).toBeTruthy();
  expect(screen.getByText(activeCamera.name)).toBeTruthy();
  expect(screen.getByText(activeCamera.code)).toBeTruthy();
});
