// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import { changeUiLanguage } from '../../i18n/runtime';
import type { SharedSession } from '../../types/shared-session';
import { CameraSetupView } from './CameraSetupView';

const mocks = vi.hoisted(() => ({
  listSites: vi.fn(),
  listCameras: vi.fn(),
  listPreviewCameras: vi.fn(),
  getCameraApplicationStatus: vi.fn(),
  client: {} as Record<string, unknown>,
  registerDialog: null as null | {
    onClose: () => void;
    onCreated?: (camera: unknown) => void;
    onUnauthorized?: () => void;
  },
  dialog: null as null | {
    camera?: unknown;
    onClose: () => void;
    onUpdated?: (camera: unknown) => void;
    onUnauthorized?: () => void;
  },
  onSelectRegionCamera: null as null | ((cameraId: string) => void),
}));
vi.mock('../../features/auth/auth-session', () => ({ useManagementClient: () => mocks.client }));
vi.mock('./CameraRegistrationDialog', () => ({
  CameraRegistrationDialog: (props: {
    onClose: () => void;
    onCreated?: (camera: unknown) => void;
    onUnauthorized?: () => void;
  }) => {
    mocks.registerDialog = props;
    return <div role="dialog">Register camera</div>;
  },
}));
vi.mock('./CameraManagementDialog', () => ({
  CameraManagementDialog: (props: {
    camera?: unknown;
    onClose: () => void;
    onUpdated?: (camera: unknown) => void;
    onUnauthorized?: () => void;
  }) => {
    mocks.dialog = props;
    return <div role="dialog">Manage camera</div>;
  },
}));
vi.mock('../ppe/ZonePpeSetupDialog', () => ({
  ZonePpeSetupDialog: (p: {
    section?: string;
    initialCameraId?: string;
    tourUserId?: string | null;
    onSelectCamera?: (cameraId: string) => void;
    canManageZones: boolean;
    canManageRegions: boolean;
  }) => {
    mocks.onSelectRegionCamera = p.onSelectCamera ?? null;
    return (
      <div
        role="dialog"
        data-camera-id={p.initialCameraId ?? ''}
        data-tour-user-id={p.tourUserId ?? ''}
      >
        Section {p.section ?? 'all'} Zones {String(p.canManageZones)} Regions{' '}
        {String(p.canManageRegions)}
      </div>
    );
  },
}));

const site = { id: 'site-1', code: 'S1', name: 'North Site', createdAt: '2026-10-16T00:00:00Z' };
const camera = {
  id: 'cam-1',
  siteId: site.id,
  code: 'C1',
  name: 'Gate camera',
  externalId: 'private-alias',
  status: 'INACTIVE',
  configurationVersion: 1,
  createdAt: site.createdAt,
};
const admin: SharedSession = {
  accessToken: 'private-token',
  sessionScope: 'session-1',
  user: { id: 'admin', displayName: 'Admin', roleAssignments: [{ role: 'ADMIN', siteId: null }] },
};
function manager(siteId = site.id): SharedSession {
  return {
    ...admin,
    user: { ...admin.user, id: 'manager', roleAssignments: [{ role: 'SITE_MANAGER', siteId }] },
  };
}
function mount(session: SharedSession | null = manager(), entry = '/camera-setup') {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const tree = (value: SharedSession | null) => (
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[entry]}>
        <CameraSetupView apiUrl="http://localhost:3000" sharedSession={value} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(session));
  return { cache, rerender: (value: SharedSession | null) => view.rerender(tree(value)) };
}
beforeEach(() => {
  window.localStorage.clear();
  changeUiLanguage('en');
  mocks.listSites.mockReset().mockResolvedValue({ items: [site], total: 1 });
  mocks.listCameras.mockReset().mockResolvedValue({ items: [camera], total: 1 });
  mocks.listPreviewCameras.mockReset();
  mocks.getCameraApplicationStatus.mockReset();
  mocks.registerDialog = null;
  mocks.dialog = null;
  mocks.client = {
    listSites: mocks.listSites,
    listCameras: mocks.listCameras,
    listPreviewCameras: mocks.listPreviewCameras,
  };
});
it('does not let a callback from a closed dialog revoke a later dialog in the same Site', async () => {
  const signOut = vi.fn();
  mount({ ...manager(), onSignOut: signOut });
  await screen.findByText(camera.name);
  fireEvent.click(screen.getByRole('button', { name: 'Manage Gate camera' }));
  const old = mocks.dialog!;
  act(() => old.onClose());
  fireEvent.click(screen.getByRole('button', { name: 'Manage Gate camera' }));
  act(() => old.onUnauthorized?.());
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(signOut).not.toHaveBeenCalled();
});
it('translates setup in place without replacing authorized camera metadata', async () => {
  mount();
  await screen.findByText(camera.name);
  expect(screen.getByText('1 shown · 1 returned by the catalog')).toBeTruthy();
  expect(screen.getByText('Setup guide')).toBeTruthy();
  await act(async () => changeUiLanguage('vi'));
  expect(screen.getByRole('heading', { name: 'Thiết lập camera' })).toBeTruthy();
  expect(screen.getByText(camera.name)).toBeTruthy();
  expect(screen.getByText('Đã tắt trong cấu hình')).toBeTruthy();
  expect(screen.getByText('Đang hiện 1 · danh mục trả về 1')).toBeTruthy();
  expect(screen.getByText('Hướng dẫn thiết lập')).toBeTruthy();
});
it('returns to monitoring with only a validated Site/camera context', async () => {
  mount(admin, '/camera-setup?siteId=site-1&cameraId=cam-1');
  await screen.findByText(camera.name);
  expect(screen.getByRole('link', { name: 'PPE monitoring' }).getAttribute('href')).toBe(
    '/ppe?siteId=site-1&cameraId=cam-1',
  );
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

it('denies a direct setup URL without a setup role and makes no metadata requests', async () => {
  mount({
    ...admin,
    user: { ...admin.user, roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: site.id }] },
  });
  expect(screen.getByText('You do not have setup access.')).toBeTruthy();
  expect(mocks.listSites).not.toHaveBeenCalled();
  expect(mocks.listCameras).not.toHaveBeenCalled();
});
it('shows metadata including inactive cameras without claiming connection or requesting previews', async () => {
  const { cache } = mount();
  expect(await screen.findByText(camera.name)).toBeTruthy();
  expect(screen.getByText('Disabled in configuration')).toBeTruthy();
  expect(document.querySelector('video, canvas')).toBeNull();
  expect(mocks.listPreviewCameras).not.toHaveBeenCalled();
  expect(
    JSON.stringify(
      cache
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey),
    ),
  ).not.toContain(admin.accessToken);
  fireEvent.click(screen.getByRole('button', { name: 'Manage Gate camera' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
});
it('lets the scoped Site Manager configure camera regions and policy without preview requests', async () => {
  mount(manager());
  fireEvent.click(await screen.findByRole('button', { name: 'Configure PPE by Zone' }));
  expect(screen.getByRole('dialog').textContent).toBe('Section zones Zones true Regions true');
  expect(mocks.listCameras).toHaveBeenCalledOnce();
  expect(mocks.listPreviewCameras).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: 'PPE monitoring' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Restricted-zone monitoring' })).toBeNull();
});
it('does not expose writes for a Site Manager assigned to another Site', async () => {
  mount(manager('site-2'));
  await screen.findByRole('option', { name: 'S1 · North Site' });
  expect(screen.queryByRole('button', { name: 'Configure PPE by Zone' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
  expect(mocks.listCameras).not.toHaveBeenCalled();
});
it('deduplicates IDs, filters wrong-Site cameras and paginates using raw returned offsets', async () => {
  mocks.listCameras
    .mockResolvedValueOnce({
      items: [camera, { ...camera, id: 'foreign', siteId: 'other', name: 'Foreign camera' }],
      total: 3,
    })
    .mockResolvedValueOnce({ items: [{ ...camera, name: 'Duplicate camera' }], total: 3 });
  mount();
  await screen.findByText(camera.name);
  expect(screen.queryByText('Foreign camera')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Load more cameras' }));
  await waitFor(() => expect(mocks.listCameras).toHaveBeenCalledTimes(2));
  expect(mocks.listCameras.mock.calls[1]![2]).toEqual({ offset: 2, limit: 20 });
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Load more cameras' })).toBeNull(),
  );
  expect(screen.queryByText('Duplicate camera')).toBeNull();
});
it('keeps authorized rows after transient next-page failure and retries the same offset', async () => {
  mocks.listCameras
    .mockResolvedValueOnce({ items: [camera], total: 2 })
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({
      items: [{ ...camera, id: 'cam-2', name: 'Second camera' }],
      total: 2,
    });
  mount();
  await screen.findByText(camera.name);
  fireEvent.click(screen.getByRole('button', { name: 'Load more cameras' }));
  await screen.findByRole('alert');
  expect(screen.getByText(camera.name)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Load more cameras' }));
  await screen.findByText('Second camera');
  expect(mocks.listCameras.mock.calls.slice(1).map((c) => c[2].offset)).toEqual([1, 1]);
});
it('does not report an empty camera catalog on initial failure', async () => {
  mocks.listCameras.mockRejectedValue(new Error('private SQL details'));
  mount();
  await screen.findByRole('alert');
  expect(screen.queryByText('No cameras registered.')).toBeNull();
  expect(screen.queryByText(/private SQL/)).toBeNull();
});
it('revokes rows and dialogs on a base refetch denial without signing out on403', async () => {
  const signOut = vi.fn();
  const { cache } = mount({ ...manager(), onSignOut: signOut });
  await screen.findByText(camera.name);
  fireEvent.click(screen.getByRole('button', { name: 'Manage Gate camera' }));
  mocks.listCameras.mockRejectedValue(new ApiError('http', 'Forbidden', 403));
  await act(() => cache.refetchQueries({ queryKey: ['camera-setup'] }));
  await waitFor(() => expect(screen.queryByText(camera.name)).toBeNull());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
  expect(signOut).not.toHaveBeenCalled();
});
it('removes scoped rows on logout and ignores an old pending response', async () => {
  let resolve!: (value: unknown) => void;
  mocks.listCameras.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { rerender } = mount();
  await waitFor(() => expect(mocks.listCameras).toHaveBeenCalledOnce());
  rerender(null);
  await act(async () => resolve({ items: [camera], total: 1 }));
  expect(screen.queryByText(camera.name)).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('hides setup actions after role reassignment for the same account/session', async () => {
  const { rerender } = mount();
  await screen.findByText(camera.name);
  fireEvent.click(screen.getByRole('button', { name: 'Manage Gate camera' }));
  rerender({ ...manager(), user: { ...manager().user, roleAssignments: [] } });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText(camera.name)).toBeNull();
});

it('treats a non-progressing metadata page as an error rather than an empty catalog', async () => {
  mocks.listCameras.mockResolvedValue({ items: [], total: 2 });
  mount();
  await screen.findByRole('alert');
  expect(screen.queryByText('No cameras registered.')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
});

it('settles a successful zero-camera page without an offset-zero Load more loop', async () => {
  mocks.listCameras.mockResolvedValue({ items: [], total: 0 });
  mount();
  expect(await screen.findByText('No cameras registered.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Load more cameras' })).toBeNull();
  expect(mocks.listCameras).toHaveBeenCalledOnce();
});

it('settles an empty Site catalog without a Load more control', async () => {
  mocks.listSites.mockResolvedValue({ items: [], total: 0 });
  mount();
  expect(await screen.findByText('No sites available for configuration.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Load more sites' })).toBeNull();
  expect(mocks.listCameras).not.toHaveBeenCalled();
});

it('revokes the current setup scope on401 and signs out once', async () => {
  const onSignOut = vi.fn();
  mocks.listCameras.mockRejectedValue(new ApiError('http', 'Expired', 401));
  mount({ ...manager(), onSignOut });
  await screen.findByText('Sign in to manage configuration.');
  expect(onSignOut).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
});

it('hides stale rows and actions when a later page fails during a base refetch', async () => {
  mocks.listCameras.mockImplementation((_token, _site, options) =>
    Promise.resolve({
      items: [{ ...camera, id: `cam-${options.offset}`, name: `Camera ${options.offset}` }],
      total: 2,
    }),
  );
  const { cache } = mount();
  await screen.findByText('Camera 0');
  fireEvent.click(screen.getByRole('button', { name: 'Load more cameras' }));
  await screen.findByText('Camera 1');
  mocks.listCameras.mockImplementation((_token, _site, options) =>
    options.offset === 1
      ? Promise.reject(new Error('network'))
      : Promise.resolve({ items: [camera], total: 2 }),
  );
  await act(() => cache.refetchQueries({ queryKey: ['camera-setup'] }));
  await screen.findByRole('alert');
  expect(screen.queryByText('Camera 0')).toBeNull();
  expect(screen.queryByText('Camera 1')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
});

it('does not let an old popup401 sign out a replacement credential scope', async () => {
  const onSignOut = vi.fn();
  const { rerender } = mount({ ...manager(), onSignOut });
  await screen.findByText(camera.name);
  fireEvent.click(screen.getByRole('button', { name: 'Manage Gate camera' }));
  const old = mocks.dialog!;
  rerender({ ...manager(), accessToken: 'replacement', onSignOut });
  await screen.findByText(camera.name);
  act(() => old.onUnauthorized?.());
  expect(screen.getByText(camera.name)).toBeTruthy();
  expect(onSignOut).not.toHaveBeenCalled();
});

it('shows current Main camera metadata to Admin without granting configuration writes', async () => {
  mount(admin);
  await screen.findByText(camera.name);
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Manage Gate camera' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Configure PPE by Zone' })).toBeNull();
  expect(
    screen.getByText(
      'Read-only catalog scope: only the assigned Site Manager can register cameras, change status, or edit Zone and region policies.',
    ),
  ).toBeTruthy();
  expect(mocks.listPreviewCameras).not.toHaveBeenCalled();
});

it('opens direct edit context for existing active and inactive cameras without forcing re-registration', async () => {
  const activeCamera = {
    ...camera,
    id: 'cam-2',
    code: 'C2',
    name: 'Yard camera',
    externalId: 'private-yard-alias',
    status: 'ACTIVE' as const,
    configurationVersion: 4,
  };
  const secondActiveCamera = {
    ...camera,
    id: 'cam-3',
    code: 'C3',
    name: 'Perimeter camera',
    externalId: 'private-perimeter-alias',
    status: 'ACTIVE' as const,
    configurationVersion: 6,
  };
  mocks.listCameras.mockResolvedValue({
    items: [camera, activeCamera, secondActiveCamera],
    total: 3,
  });
  mount(manager());
  await screen.findByText(activeCamera.name);
  expect(screen.getByText('2 enabled · 1 disabled')).toBeTruthy();
  expect(screen.queryByText(/private-alias|private-yard-alias|private-perimeter-alias/)).toBeNull();
  expect(screen.queryByText(/worker applied|camera moved/i)).toBeNull();

  // Clicking an existing INACTIVE camera title opens Manage directly so it can be enabled in place
  fireEvent.click(screen.getByRole('button', { name: camera.name }));
  expect(screen.getByRole('dialog').textContent).toBe('Manage camera');
  act(() => mocks.dialog?.onClose());

  // Selecting the existing ACTIVE camera updates the context bar and opens region setup directly
  fireEvent.click(screen.getByRole('button', { name: 'Select C2' }));
  expect(screen.getByText('C2 · Yard camera')).toBeTruthy();
  expect(
    screen.getByText('Saved config version v4; worker application status unavailable.'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Edit observation regions (C2)' }));
  const regionDialog = screen.getByRole('dialog');
  expect(regionDialog.textContent).toBe('Section regions Zones true Regions true');
  expect(regionDialog.getAttribute('data-camera-id')).toBe('cam-2');
  expect(regionDialog.getAttribute('data-tour-user-id')).toBe('manager');

  // Switching camera inside the region dialog syncs requestedCameraId and updates the catalog's selected camera context bar
  act(() => {
    mocks.onSelectRegionCamera?.('cam-3');
  });
  expect(screen.getByText('C3 · Perimeter camera')).toBeTruthy();
  expect(
    screen.getByText('Saved config version v6; worker application status unavailable.'),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Selected C3' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
});

it('distinguishes the four setup stages, per-Zone policy scope, and revision honesty in EN and VI', async () => {
  mount(manager());
  await screen.findByText(camera.name);
  expect(screen.getByText('Stage 1 · Per-Zone PPE Policy')).toBeTruthy();
  expect(screen.getByText('Stage 2 · Camera & Source ID')).toBeTruthy();
  expect(screen.getByText('Stage 3 · Reference Image')).toBeTruthy();
  expect(screen.getByText('Stage 4 · Observation Regions')).toBeTruthy();
  expect(
    screen.getByText('Saved config version v1; worker application status unavailable.'),
  ).toBeTruthy();

  await act(async () => changeUiLanguage('vi'));
  expect(screen.getByText('Bước 1 · Chính sách PPE theo khu vực')).toBeTruthy();
  expect(screen.getByText('Bước 4 · Vùng quan sát')).toBeTruthy();
  expect(
    screen.getByText('Phiên bản cấu hình đã lưu v1; chưa có trạng thái áp dụng của worker.'),
  ).toBeTruthy();
});

it('provides an optional setup tour bound to real stage elements, skips unauthorized steps dynamically, and resets on Site or credential change', async () => {
  const secondSite = {
    id: 'site-2',
    code: 'S2',
    name: 'South Site',
    createdAt: site.createdAt,
  };
  mocks.listSites.mockResolvedValue({ items: [site, secondSite], total: 2 });
  mocks.listCameras.mockImplementation((_token, siteId: string) =>
    Promise.resolve({ items: [{ ...camera, siteId }], total: 1 }),
  );

  const { rerender } = mount(manager(site.id));
  await screen.findByText(camera.name);

  const trigger = screen.getByTestId('safety-task-tour-trigger');
  expect(trigger.textContent).toBe('Guided help');
  expect(screen.queryByTestId('safety-task-tour')).toBeNull();

  // Open tour as scoped Site Manager on assigned site-1: all 4 setup steps are available
  fireEvent.click(trigger);
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
    'camera-setup-scope',
  );
  expect(screen.getByText('Step 1 of 4')).toBeTruthy();
  expect(
    document
      .querySelector('[data-tour-anchor="camera-setup-scope"]')
      ?.getAttribute('data-tour-active-anchor'),
  ).toBe('true');

  // Step 2: Register or Manage Camera
  fireEvent.click(screen.getByTestId('safety-task-tour-next'));
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
    'camera-setup-source',
  );
  expect(
    screen.getByRole('button', { name: 'Register camera' }).getAttribute('data-tour-active-anchor'),
  ).toBe('true');
  expect(screen.getByText(/does not confirm a live connection/i)).toBeTruthy();

  // Step 3: Zone PPE Policies & Camera Regions
  fireEvent.click(screen.getByTestId('safety-task-tour-next'));
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
    'camera-setup-zone-draw',
  );
  expect(
    screen
      .getByRole('button', { name: 'Configure PPE by Zone' })
      .getAttribute('data-tour-active-anchor'),
  ).toBe('true');
  expect(screen.getByText(/Read-only access does not allow editing/i)).toBeTruthy();

  // Step 4: Saved Configuration & Status (plain language copy in EN & VI)
  fireEvent.click(screen.getByTestId('safety-task-tour-next'));
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
    'camera-setup-save',
  );
  expect(
    screen.getByRole('region', { name: 'Selected camera' }).getAttribute('data-tour-active-anchor'),
  ).toBe('true');
  expect(
    screen.getByText(/does not confirm changes are applied or that the camera is live/i),
  ).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mocks.listPreviewCameras).not.toHaveBeenCalled();

  await act(async () => changeUiLanguage('vi'));
  expect(screen.getByText('Cấu hình Đã lưu & Trạng thái')).toBeTruthy();
  expect(
    screen.getByText(
      /không xác nhận thay đổi đã được áp dụng hoặc camera đang hoạt động trực tiếp/i,
    ),
  ).toBeTruthy();
  await act(async () => changeUiLanguage('en'));

  // Switching to unassigned site-2 closes the open tour and dynamically skips write/camera steps
  fireEvent.change(screen.getByRole('combobox', { name: 'Site' }), {
    target: { value: secondSite.id },
  });
  expect(screen.queryByTestId('safety-task-tour')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Configure PPE by Zone' })).toBeNull();

  fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
  expect(screen.getByText('Step 1 of 1')).toBeTruthy();
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
    'camera-setup-scope',
  );

  // Switching session to read-only Admin resets the tour and omits the write-only source step (3 steps)
  rerender(admin);
  await screen.findByText(camera.name);
  expect(screen.queryByTestId('safety-task-tour')).toBeNull();

  fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
  expect(screen.getByText('Step 1 of 3')).toBeTruthy();
  fireEvent.click(screen.getByTestId('safety-task-tour-next'));
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
    'camera-setup-zone-draw',
  );
  expect(
    screen
      .getByRole('button', { name: 'View area policies' })
      .getAttribute('data-tour-active-anchor'),
  ).toBe('true');

  // Rotating accessToken closes the active tour immediately
  rerender({ ...admin, accessToken: 'rotated-admin-token' });
  await screen.findByText(camera.name);
  expect(screen.queryByTestId('safety-task-tour')).toBeNull();
});

it('updates camera setup state immediately on management save and invalidates same-site region/monitoring caches without touching other scopes', async () => {
  const activeCam = {
    ...camera,
    status: 'ACTIVE' as const,
    configurationVersion: 1,
  };
  let resolveRefetch!: (value: unknown) => void;
  mocks.listCameras.mockResolvedValueOnce({ items: [activeCam], total: 1 }).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRefetch = resolve;
      }),
  );

  const { cache } = mount(manager(site.id), '/camera-setup?siteId=site-1&cameraId=cam-1');
  await screen.findByText(activeCam.name);
  expect(screen.getByText('1 enabled · 0 disabled')).toBeTruthy();
  expect(
    screen.getByText('Saved config version v1; worker application status unavailable.'),
  ).toBeTruthy();

  const sameSiteRegionCamerasKey = [
    'ppe-monitoring',
    'http://localhost:3000',
    'session-1',
    99,
    site.id,
    'cameras-for-region',
  ];
  const sameSiteCameraRegionsKey = [
    'ppe-monitoring',
    'http://localhost:3000',
    'session-1',
    99,
    site.id,
    'cameras',
    activeCam.id,
    'regions',
  ];
  const sameSiteZonesKey = [
    'ppe-monitoring',
    'http://localhost:3000',
    'session-1',
    1,
    site.id,
    'zones',
  ];
  const sameSiteZoneAdminKey = [
    'zone-admin',
    'http://localhost:3000',
    'session-1',
    site.id,
    activeCam.id,
  ];
  const otherSiteRegionCamerasKey = [
    'ppe-monitoring',
    'http://localhost:3000',
    'session-1',
    99,
    'site-2',
    'cameras-for-region',
  ];
  const otherSessionRegionCamerasKey = [
    'ppe-monitoring',
    'http://localhost:3000',
    'session-2',
    99,
    site.id,
    'cameras-for-region',
  ];
  const otherApiZoneAdminKey = [
    'zone-admin',
    'http://other-api.local',
    'session-1',
    site.id,
    activeCam.id,
  ];

  cache.setQueryData(sameSiteRegionCamerasKey, { items: [activeCam], total: 1 });
  cache.setQueryData(sameSiteCameraRegionsKey, []);
  cache.setQueryData(sameSiteZonesKey, []);
  cache.setQueryData(sameSiteZoneAdminKey, []);
  cache.setQueryData(otherSiteRegionCamerasKey, { items: [], total: 0 });
  cache.setQueryData(otherSessionRegionCamerasKey, { items: [], total: 0 });
  cache.setQueryData(otherApiZoneAdminKey, []);

  fireEvent.click(screen.getByRole('button', { name: 'Manage Gate camera' }));
  expect(mocks.dialog).toBeTruthy();

  const updatedCam = {
    ...activeCam,
    name: 'Gate camera West',
    status: 'INACTIVE' as const,
    configurationVersion: 2,
  };
  await act(async () => {
    mocks.dialog?.onUpdated?.(updatedCam);
  });

  // Verify cache entry updated immediately while listCameras refetch promise remains unresolved:
  const setupCameraEntries = cache
    .getQueriesData<{ pages: { items: (typeof updatedCam)[] }[] }>({ queryKey: ['camera-setup'] })
    .filter(([qk]) => qk.includes('cameras'));
  expect(setupCameraEntries[0]?.[1]?.pages[0]?.items[0]).toEqual(updatedCam);

  // Await TanStack notifyManager observer flush while listCameras refetch is still pending:
  expect(await screen.findByText('Gate camera West')).toBeTruthy();
  await waitFor(() => {
    expect(screen.getByText('0 enabled · 1 disabled')).toBeTruthy();
    expect(
      screen.getByText('Saved config version v2; worker application status unavailable.'),
    ).toBeTruthy();
    expect(mocks.dialog?.camera).toEqual(updatedCam);
  });

  // Older out-of-order configurationVersion must not overwrite v2 while refetch is still unresolved:
  await act(async () => {
    mocks.dialog?.onUpdated?.({
      ...activeCam,
      name: 'Stale v1 camera',
      status: 'ACTIVE' as const,
      configurationVersion: 1,
    });
  });
  expect(screen.getByText('Gate camera West')).toBeTruthy();
  expect(
    screen.getByText('Saved config version v2; worker application status unavailable.'),
  ).toBeTruthy();

  // Same-site / same-session region and zone caches are invalidated before resolveRefetch:
  expect(cache.getQueryState(sameSiteRegionCamerasKey)?.isInvalidated).toBe(true);
  expect(cache.getQueryState(sameSiteCameraRegionsKey)?.isInvalidated).toBe(true);
  expect(cache.getQueryState(sameSiteZonesKey)?.isInvalidated).toBe(true);
  expect(cache.getQueryState(sameSiteZoneAdminKey)?.isInvalidated).toBe(true);

  // Other site / session / API caches remain untouched:
  expect(cache.getQueryState(otherSiteRegionCamerasKey)?.isInvalidated).toBe(false);
  expect(cache.getQueryState(otherSessionRegionCamerasKey)?.isInvalidated).toBe(false);
  expect(cache.getQueryState(otherApiZoneAdminKey)?.isInvalidated).toBe(false);

  await act(async () => {
    resolveRefetch({ items: [updatedCam], total: 1 });
  });
});

it('displays concise LOADED status, Details disclosure, EN/VI copy, manual refresh, and expires LOADED after 60s total receipt age via monotonic fake timers without network calls', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const uuidSite = {
      ...site,
      id: '11111111-1111-4111-8111-111111111111',
    };
    const uuidCam = {
      ...camera,
      id: '22222222-2222-4222-8222-222222222222',
      siteId: uuidSite.id,
      status: 'ACTIVE' as const,
      configurationVersion: 2,
    };
    mocks.listSites.mockResolvedValue({ items: [uuidSite], total: 1 });
    mocks.listCameras.mockResolvedValue({ items: [uuidCam], total: 1 });
    mocks.client.getCameraApplicationStatus = mocks.getCameraApplicationStatus;
    mocks.getCameraApplicationStatus.mockResolvedValueOnce({
      cameraId: uuidCam.id,
      siteId: uuidSite.id,
      desiredRevision: 2,
      reportedRevision: 2,
      applicationState: 'LOADED',
      observedAt: '2026-10-27T05:00:40.000Z',
      lastReceiptAt: '2026-10-27T05:00:00.000Z',
      viewValidity: 'UNCONFIRMED',
      reasonCode: null,
    });

    mount(manager(uuidSite.id));
    expect(await screen.findByText('Worker loaded v2')).toBeTruthy();
    expect(screen.getByText('Saved v2 · Worker reported: v2')).toBeTruthy();
    expect(screen.getByText('Physical camera view is unconfirmed.')).toBeTruthy();
    expect(
      screen.getByTestId('camera-application-status').getAttribute('data-application-state'),
    ).toBe('LOADED');
    expect(
      screen.getByText(
        'Observed: 2026-10-27T05:00:40.000Z · Last receipt: 2026-10-27T05:00:00.000Z',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Configuration receipt does not prove live stream or model health.'),
    ).toBeTruthy();
    expect(mocks.listPreviewCameras).not.toHaveBeenCalled();
    expect(mocks.getCameraApplicationStatus).toHaveBeenCalledTimes(1);

    await act(async () => changeUiLanguage('vi'));
    expect(screen.getByText('Đã lưu v2 · Worker báo cáo: v2')).toBeTruthy();
    expect(screen.getByText('Worker đã nạp v2')).toBeTruthy();
    expect(screen.getByText('Góc nhìn vật lý chưa được xác nhận.')).toBeTruthy();
    await act(async () => changeUiLanguage('en'));

    // Server observedAt - lastReceiptAt = 40s, so 20s local freshness budget remains.
    await act(async () => {
      vi.advanceTimersByTime(19_000);
    });
    expect(screen.getByText('Worker loaded v2')).toBeTruthy();
    expect(mocks.getCameraApplicationStatus).toHaveBeenCalledTimes(1);

    // Advancing the remaining 1s reaches 60s total receipt age and expires LOADED locally without network:
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.queryByText('Worker loaded v2')).toBeNull();
    expect(screen.getByText('Application receipt is old')).toBeTruthy();
    expect(
      screen.getByTestId('camera-application-status').getAttribute('data-application-state'),
    ).toBe('STALE');
    expect(
      screen.getByText(
        'Reason: Historical worker claim / old receipt past 60s window; does not mean camera is offline. (APPLICATION_RECEIPT_STALE)',
      ),
    ).toBeTruthy();
    expect(mocks.getCameraApplicationStatus).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it('distinguishes UNCONFIRMED, PENDING, REJECTED, and STALE states and hides stale LOADED on pending refresh, error, version bump, or 401', async () => {
  const onSignOut = vi.fn();
  const uuidSite = {
    ...site,
    id: '11111111-1111-4111-8111-111111111111',
  };
  const uuidCam = {
    ...camera,
    id: '22222222-2222-4222-8222-222222222222',
    siteId: uuidSite.id,
    status: 'ACTIVE' as const,
    configurationVersion: 2,
  };
  mocks.listSites.mockResolvedValue({ items: [uuidSite], total: 1 });
  mocks.listCameras.mockResolvedValue({ items: [uuidCam], total: 1 });
  mocks.client.getCameraApplicationStatus = mocks.getCameraApplicationStatus;

  const baseStatus = {
    cameraId: uuidCam.id,
    siteId: uuidSite.id,
    desiredRevision: 2,
    observedAt: '2026-10-27T05:00:10.000Z',
  };

  mocks.getCameraApplicationStatus
    .mockResolvedValueOnce({
      ...baseStatus,
      reportedRevision: null,
      applicationState: 'UNCONFIRMED',
      lastReceiptAt: null,
      viewValidity: 'UNAVAILABLE',
      reasonCode: 'NO_APPLICATION_RECEIPT',
    })
    .mockResolvedValueOnce({
      ...baseStatus,
      reportedRevision: null,
      applicationState: 'PENDING',
      lastReceiptAt: null,
      viewValidity: 'NEEDS_REVALIDATION',
      reasonCode: 'CONFIGURATION_NOT_ISSUED',
    })
    .mockResolvedValueOnce({
      ...baseStatus,
      reportedRevision: 2,
      applicationState: 'REJECTED',
      lastReceiptAt: '2026-10-27T05:00:05.000Z',
      viewValidity: 'UNCONFIRMED',
      reasonCode: 'BUNDLE_HASH_MISMATCH',
    })
    .mockResolvedValueOnce({
      ...baseStatus,
      reportedRevision: 2,
      applicationState: 'LOADED',
      lastReceiptAt: '2026-10-27T05:00:08.000Z',
      viewValidity: 'UNCONFIRMED',
      reasonCode: null,
    });

  mount({ ...manager(uuidSite.id), onSignOut });
  expect(await screen.findByText('Worker application unconfirmed')).toBeTruthy();
  expect(screen.getByText('Saved v2 · Worker reported: none')).toBeTruthy();
  expect(screen.getByText('Reference view is unavailable.')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  expect(await screen.findByText('Pending worker application')).toBeTruthy();
  expect(screen.getByText('Reference view needs revalidation.')).toBeTruthy();
  expect(
    screen.getByText('Reason: Configuration bundle is not issued yet. (CONFIGURATION_NOT_ISSUED)'),
  ).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  expect(await screen.findByText('Worker rejected v2')).toBeTruthy();
  expect(
    screen.getByText('Reason: Worker reported reason code. (BUNDLE_HASH_MISMATCH)'),
  ).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  expect(await screen.findByText('Worker loaded v2')).toBeTruthy();

  // Pending manual refresh hides LOADED immediately and fails closed on error:
  let rejectRefresh!: (err: unknown) => void;
  mocks.getCameraApplicationStatus.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectRefresh = reject;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await waitFor(() => {
    expect(screen.queryByText('Worker loaded v2')).toBeNull();
    expect(
      screen.getByText('Saved config version v2; worker application status unavailable.'),
    ).toBeTruthy();
  });
  await act(async () => {
    rejectRefresh(new ApiError('http', 'Unavailable', 503));
  });
  expect(await screen.findByText('Could not verify worker application status.')).toBeTruthy();
  expect(screen.queryByText('Worker loaded v2')).toBeNull();

  // Restore LOADED v2, then bump configurationVersion (v2 -> v3) via camera update:
  mocks.getCameraApplicationStatus.mockResolvedValueOnce({
    ...baseStatus,
    reportedRevision: 2,
    applicationState: 'LOADED',
    lastReceiptAt: '2026-10-27T05:00:08.000Z',
    viewValidity: 'UNCONFIRMED',
    reasonCode: null,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  expect(await screen.findByText('Worker loaded v2')).toBeTruthy();

  let resolveV3Status!: (value: unknown) => void;
  const v3StatusPromise = new Promise((resolve) => {
    resolveV3Status = resolve;
  });
  const transitionSignals: AbortSignal[] = [];
  mocks.getCameraApplicationStatus.mockImplementation(
    (_token: string, _siteId: string, _cameraId: string, options?: { signal?: AbortSignal }) => {
      if (options?.signal) transitionSignals.push(options.signal);
      return v3StatusPromise;
    },
  );
  const updatedV3Cam = {
    ...uuidCam,
    configurationVersion: 3,
  };
  mocks.listCameras.mockResolvedValue({ items: [updatedV3Cam], total: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Manage Gate camera' }));
  await act(async () => {
    mocks.dialog?.onUpdated?.(updatedV3Cam);
  });
  await waitFor(() => {
    expect(screen.queryByText('Worker loaded v2')).toBeNull();
    expect(
      screen.getByText('Saved config version v3; worker application status unavailable.'),
    ).toBeTruthy();
    expect(transitionSignals.length).toBeGreaterThanOrEqual(2);
  });
  expect(transitionSignals[0]?.aborted).toBe(true);
  expect(transitionSignals.at(-1)?.aborted).toBe(false);
  await act(async () => {
    resolveV3Status({
      ...baseStatus,
      desiredRevision: 3,
      reportedRevision: 3,
      applicationState: 'LOADED',
      lastReceiptAt: '2026-10-27T05:00:09.000Z',
      viewValidity: 'UNCONFIRMED',
      reasonCode: null,
    });
  });
  expect(await screen.findByText('Worker loaded v3')).toBeTruthy();

  // 401 on application status revokes setup scope and signs out once:
  mocks.getCameraApplicationStatus.mockRejectedValueOnce(new ApiError('http', 'Expired', 401));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await screen.findByText('Sign in to manage configuration.');
  expect(onSignOut).toHaveBeenCalledOnce();
});
