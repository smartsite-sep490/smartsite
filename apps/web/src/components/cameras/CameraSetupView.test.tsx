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
  client: {} as Record<string, unknown>,
  dialog: null as null | { onClose: () => void; onUnauthorized?: () => void },
}));
vi.mock('../../features/auth/auth-session', () => ({ useManagementClient: () => mocks.client }));
vi.mock('./CameraRegistrationDialog', () => ({
  CameraRegistrationDialog: () => <div role="dialog">Register camera</div>,
}));
vi.mock('./CameraManagementDialog', () => ({
  CameraManagementDialog: (props: { onClose: () => void; onUnauthorized?: () => void }) => {
    mocks.dialog = props;
    return <div role="dialog">Manage camera</div>;
  },
}));
vi.mock('../ppe/ZonePpeSetupDialog', () => ({
  ZonePpeSetupDialog: (p: { canManageZones: boolean; canManageRegions: boolean }) => (
    <div role="dialog">
      Zones {String(p.canManageZones)} Regions {String(p.canManageRegions)}
    </div>
  ),
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
function mount(session: SharedSession | null = admin, entry = '/camera-setup') {
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
  changeUiLanguage('en');
  mocks.listSites.mockReset().mockResolvedValue({ items: [site], total: 1 });
  mocks.listCameras.mockReset().mockResolvedValue({ items: [camera], total: 1 });
  mocks.listPreviewCameras.mockReset();
  mocks.dialog = null;
  mocks.client = {
    listSites: mocks.listSites,
    listCameras: mocks.listCameras,
    listPreviewCameras: mocks.listPreviewCameras,
  };
});
it('does not let a callback from a closed dialog revoke a later dialog in the same Site', async () => {
  const signOut = vi.fn();
  mount({ ...admin, onSignOut: signOut });
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
  await act(async () => changeUiLanguage('vi'));
  expect(screen.getByRole('heading', { name: 'Thiết lập camera' })).toBeTruthy();
  expect(screen.getByText(camera.name)).toBeTruthy();
  expect(screen.getByText('Đã tắt trong cấu hình')).toBeTruthy();
});
it('returns to monitoring with only a validated Site/camera context', async () => {
  mount(admin, '/camera-setup?siteId=site-1&cameraId=cam-1');
  await screen.findByText(camera.name);
  expect(screen.getByRole('link', { name: 'Open monitoring' }).getAttribute('href')).toBe(
    '/ppe?siteId=site-1&cameraId=cam-1',
  );
});
afterEach(() => {
  cleanup();
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
it('lets the scoped Site Manager reach the existing policy writer without camera/preview permission', async () => {
  mount(manager());
  fireEvent.click(await screen.findByRole('button', { name: 'Configure PPE by Zone' }));
  expect(screen.getByRole('dialog').textContent).toBe('Zones true Regions false');
  expect(mocks.listCameras).not.toHaveBeenCalled();
  expect(mocks.listPreviewCameras).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: 'Open monitoring' })).toBeNull();
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
  const { cache } = mount({ ...admin, onSignOut: signOut });
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
  rerender({ ...admin, user: { ...admin.user, roleAssignments: [] } });
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
  mount({ ...admin, onSignOut });
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
  const { rerender } = mount({ ...admin, onSignOut });
  await screen.findByText(camera.name);
  fireEvent.click(screen.getByRole('button', { name: 'Manage Gate camera' }));
  const old = mocks.dialog!;
  rerender({ ...admin, accessToken: 'replacement', onSignOut });
  await screen.findByText(camera.name);
  act(() => old.onUnauthorized?.());
  expect(screen.getByText(camera.name)).toBeTruthy();
  expect(onSignOut).not.toHaveBeenCalled();
});
