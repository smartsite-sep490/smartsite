// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import type { ZoneResponse } from '@smartsite/contracts/management';
import { changeUiLanguage } from '../../i18n/runtime';
import type { SharedSession } from '../../types/shared-session';
import { CameraSetupView } from './CameraSetupView';

const mocks = vi.hoisted(() => ({
  client: {
    listSites: vi.fn(),
    listCameras: vi.fn(),
    listZones: vi.fn(),
    listCameraRegions: vi.fn(),
    getCameraPreview: vi.fn(),
    listPreviewCameras: vi.fn(),
    createZone: vi.fn(),
    renameZone: vi.fn(),
    updateZonePolicy: vi.fn(),
  },
  clientOverride: null as SmartSiteManagementClient | null,
}));
vi.mock('../../features/auth/auth-session', () => ({
  useManagementClient: () => mocks.clientOverride ?? mocks.client,
}));
const site = { id: 'site-1', code: 'S1', name: 'North Site', createdAt: '2026-10-16T00:00:00Z' };
const zone: ZoneResponse = {
  id: 'zone-1',
  siteId: site.id,
  code: 'PPE-1',
  name: 'Required PPE area',
  type: 'STANDARD',
  restrictionPolicy: 'NONE',
  requiredPpe: ['HARD_HAT'],
  configurationLocked: false,
  createdAt: site.createdAt,
};
const admin: SharedSession = {
  accessToken: 'private-token',
  sessionScope: 'admin-session',
  user: { id: 'admin', displayName: 'Admin', roleAssignments: [{ role: 'ADMIN', siteId: null }] },
};
const clients: QueryClient[] = [];
function mount(session = admin) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(cache);
  const tree = (value: SharedSession) => (
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <CameraSetupView apiUrl="http://localhost:3000" sharedSession={value} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(session));
  return { cache, rerender: (value: SharedSession) => view.rerender(tree(value)) };
}
beforeEach(() => {
  changeUiLanguage('en');
  mocks.clientOverride = null;
  Object.values(mocks.client).forEach((mock) => mock.mockReset());
  mocks.client.listSites.mockResolvedValue({ items: [site], total: 1 });
  mocks.client.listCameras.mockResolvedValue({ items: [], total: 0 });
  mocks.client.listZones.mockResolvedValue({ items: [zone], total: 1 });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clients.splice(0).forEach((cache) => cache.clear());
});

it('opens the actual Zone dialog for an administrator without any writer or preview controls', async () => {
  const { cache } = mount();
  const action = await screen.findByRole('button', { name: 'View area policies' });
  expect(mocks.client.listZones).not.toHaveBeenCalled();
  fireEvent.click(action);
  const dialog = screen.getByRole('dialog');
  expect(await within(dialog).findByText(zone.name)).toBeTruthy();
  expect(within(dialog).getByRole('note')).toBeTruthy();
  expect(within(dialog).queryByRole('textbox')).toBeNull();
  expect(within(dialog).queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Configure PPE by Zone' })).toBeNull();
  for (const name of [
    'listCameraRegions',
    'getCameraPreview',
    'listPreviewCameras',
    'createZone',
    'renameZone',
    'updateZonePolicy',
  ] as const) {
    expect(mocks.client[name]).not.toHaveBeenCalled();
  }
  expect(mocks.client.listZones).toHaveBeenCalledWith(
    admin.accessToken,
    site.id,
    { offset: 0, limit: 20 },
    { signal: expect.any(AbortSignal) },
  );
  expect(
    JSON.stringify(
      cache
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ),
  ).not.toContain(admin.accessToken);
});

it('localizes the read-only entry without changing its capability', async () => {
  mount();
  await screen.findByRole('button', { name: 'View area policies' });
  await act(async () => changeUiLanguage('vi'));
  fireEvent.click(screen.getByRole('button', { name: 'Xem chính sách khu vực' }));
  expect(await within(screen.getByRole('dialog')).findByText(zone.name)).toBeTruthy();
  expect(within(screen.getByRole('dialog')).queryByRole('textbox')).toBeNull();
});

it('aborts an open read-only request on role loss and suppresses its late result', async () => {
  let resolve!: (page: { items: (typeof zone)[]; total: number }) => void;
  mocks.client.listZones.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { rerender } = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'View area policies' }));
  await waitFor(() => expect(mocks.client.listZones).toHaveBeenCalledOnce());
  const signal = mocks.client.listZones.mock.calls[0]![3].signal as AbortSignal;
  rerender({
    ...admin,
    user: { ...admin.user, roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'other-site' }] },
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ items: [zone], total: 1 }));
  expect(screen.queryByText(zone.name)).toBeNull();
  expect(screen.queryByRole('button', { name: 'View area policies' })).toBeNull();
});

it('shows a forbidden Zone read as an error without creating writer controls or signing out', async () => {
  const onSignOut = vi.fn();
  mocks.client.listZones.mockRejectedValue(new ApiError('http', 'Forbidden', 403));
  mount({ ...admin, onSignOut });
  fireEvent.click(await screen.findByRole('button', { name: 'View area policies' }));
  expect(await within(screen.getByRole('dialog')).findByRole('alert')).toBeTruthy();
  expect(screen.queryByText(zone.name)).toBeNull();
  expect(within(screen.getByRole('dialog')).queryByRole('textbox')).toBeNull();
  expect(mocks.client.createZone).not.toHaveBeenCalled();
  expect(onSignOut).not.toHaveBeenCalled();
});

it('does not grant global metadata access to an improperly scoped Admin assignment', () => {
  mount({
    ...admin,
    user: { ...admin.user, roleAssignments: [{ role: 'ADMIN', siteId: site.id }] },
  });
  expect(screen.getByRole('alert').textContent).toBe('You do not have setup access.');
  expect(screen.queryByRole('button', { name: 'View area policies' })).toBeNull();
  expect(mocks.client.listSites).not.toHaveBeenCalled();
  expect(mocks.client.listZones).not.toHaveBeenCalled();
});

it('uses the owning session adapter for an expired Zone read and clears the dialog on session withdrawal', async () => {
  const onUnauthorized = vi.fn();
  const refreshAccessToken = vi.fn().mockRejectedValue(new ApiError('http', 'Expired', 401));
  mocks.clientOverride = new SmartSiteManagementClient('https://api.example.test', {
    signal: new AbortController().signal,
    getAccessToken: () => admin.accessToken,
    refreshAccessToken,
    onUnauthorized,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/zones')) return Response.json({}, { status: 401 });
      return Response.json(
        url.includes('/cameras') ? { items: [], total: 0 } : { items: [site], total: 1 },
      );
    }),
  );
  const { rerender } = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'View area policies' }));
  await waitFor(() => expect(onUnauthorized).toHaveBeenCalledExactlyOnceWith(admin.accessToken));
  expect(refreshAccessToken).toHaveBeenCalledExactlyOnceWith(admin.accessToken);
  expect(screen.queryByText(zone.name)).toBeNull();
  rerender({ ...admin, accessToken: '' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: 'View area policies' })).toBeNull();
  expect(screen.queryByText(zone.name)).toBeNull();
  expect(mocks.client.createZone).not.toHaveBeenCalled();
});
