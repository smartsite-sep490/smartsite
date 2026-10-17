// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import type { SharedSession } from '../../types/shared-session';
import { changeUiLanguage } from '../../i18n/runtime';
import { CameraSetupView } from './CameraSetupView';

const mocks = vi.hoisted(() => ({
  listSites: vi.fn(),
  listCameras: vi.fn(),
  listPreviewCameras: vi.fn(),
  client: {} as Record<string, unknown>,
  section: undefined as string | undefined,
  canManageZones: false,
  canManageRegions: false,
  canReadZones: false,
}));
vi.mock('../../features/auth/auth-session', () => ({ useManagementClient: () => mocks.client }));
vi.mock('../ppe/ZonePpeSetupDialog', () => ({
  ZonePpeSetupDialog: (props: {
    section?: string;
    canReadZones?: boolean;
    canManageZones: boolean;
    canManageRegions: boolean;
    onClose: () => void;
  }) => {
    mocks.section = props.section;
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
const site = { id: 'site-1', code: 'S1', name: 'North Site', createdAt: '2026-10-17T00:00:00Z' };
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
  mocks.listCameras.mockReset().mockResolvedValue({ items: [], total: 0 });
  mocks.listPreviewCameras.mockReset();
  mocks.client = {
    listSites: mocks.listSites,
    listCameras: mocks.listCameras,
    listPreviewCameras: mocks.listPreviewCameras,
  };
  mocks.section = undefined;
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
  const guide = await screen.findByRole('list', { name: 'Setup steps' });
  expect(guide.tagName).toBe('OL');
  expect(guide.closest('details:not([open])')).toBeNull();
  expect(within(guide).getAllByRole('listitem')).toHaveLength(3);
  for (const name of ['Configure PPE by Zone', 'Register camera', 'Link observation regions']) {
    expect(screen.getAllByRole('button', { name })).toHaveLength(1);
    expect(within(guide).getByRole('button', { name })).toBeTruthy();
  }
  fireEvent.click(within(guide).getByRole('button', { name: 'Configure PPE by Zone' }));
  expect(mocks.section).toBe('zones');
  expect(mocks.canManageZones).toBe(true);
  expect(mocks.canManageRegions).toBe(true);
  expect(mocks.canReadZones).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Close setup task' }));
  fireEvent.click(within(guide).getByRole('button', { name: 'Link observation regions' }));
  expect(mocks.section).toBe('regions');
  expect(mocks.canManageZones).toBe(true);
  expect(mocks.canManageRegions).toBe(true);
  expect(mocks.listPreviewCameras).not.toHaveBeenCalled();
});

it('keeps registration on its existing form through the workflow entry', async () => {
  mount();
  const guide = await screen.findByRole('list', { name: 'Setup steps' });
  fireEvent.click(within(guide).getByRole('button', { name: 'Register camera' }));
  expect(screen.getByRole('dialog').textContent).toBe('Register camera form');
  expect(mocks.listPreviewCameras).not.toHaveBeenCalled();
});

it('offers Admin policy reading but no camera or Region writer in the visible guide', async () => {
  mount({
    ...manager,
    user: { ...manager.user, roleAssignments: [{ role: 'ADMIN', siteId: null }] },
  });
  const guide = await screen.findByRole('list', { name: 'Setup steps' });
  fireEvent.click(within(guide).getByRole('button', { name: 'View area policies' }));
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
  const guide = await screen.findByRole('list', { name: 'Setup steps' });
  fireEvent.click(within(guide).getByRole('button', { name: 'Configure PPE by Zone' }));
  const dialog = screen.getByRole('dialog');
  await act(async () => changeUiLanguage('vi'));
  expect(screen.getByRole('dialog')).toBe(dialog);
  const translated = screen.getByRole('list', { name: 'Thứ tự thiết lập' });
  expect(within(translated).getByRole('button', { name: 'Gắn vùng quan sát' })).toBeTruthy();
  rerender({
    ...manager,
    user: { ...manager.user, roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: site.id }] },
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('list', { name: 'Thứ tự thiết lập' })).toBeNull();
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
