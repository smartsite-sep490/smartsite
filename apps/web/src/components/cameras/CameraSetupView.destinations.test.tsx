// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CameraResponse, SiteResponse } from '@smartsite/contracts/management';
import { changeUiLanguage } from '../../i18n/runtime';
import type { SharedSession } from '../../types/shared-session';
import { CameraSetupView } from './CameraSetupView';

const mocks = vi.hoisted(() => ({
  listSites: vi.fn(),
  listCameras: vi.fn(),
  listPreviewCameras: vi.fn(),
  client: {} as Record<string, unknown>,
}));

vi.mock('../../features/auth/auth-session', () => ({
  useManagementClient: () => mocks.client,
}));
vi.mock('./CameraRegistrationDialog', () => ({
  CameraRegistrationDialog: () => <div role="dialog">Register camera</div>,
}));
vi.mock('./CameraManagementDialog', () => ({
  CameraManagementDialog: () => <div role="dialog">Manage camera</div>,
}));
vi.mock('../ppe/ZonePpeSetupDialog', () => ({
  ZonePpeSetupDialog: () => <div role="dialog">Zone PPE setup</div>,
}));

const site: SiteResponse = {
  id: 'site-1',
  code: 'S1',
  name: 'North Site',
  createdAt: '2026-10-16T00:00:00Z',
};

const camera: CameraResponse = {
  id: 'cam-1',
  siteId: site.id,
  code: 'C1',
  name: 'Gate camera',
  externalId: 'private-alias',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: site.createdAt,
};

const adminSession: SharedSession = {
  accessToken: 'private-token',
  sessionScope: 'session-1',
  user: {
    id: 'admin-1',
    displayName: 'Admin',
    roleAssignments: [{ role: 'ADMIN', siteId: null }],
  },
};

function createSession(
  roleAssignments: SharedSession['user']['roleAssignments'],
  id = 'user-1',
): SharedSession {
  return {
    ...adminSession,
    user: {
      ...adminSession.user,
      id,
      roleAssignments,
    },
  };
}

const caches: QueryClient[] = [];

function mount(session: SharedSession | null = adminSession, entry = '/camera-setup') {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  caches.push(cache);
  const tree = (value: SharedSession | null) => (
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[entry]}>
        <CameraSetupView apiUrl="http://localhost:3000" sharedSession={value} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(session));
  return {
    cache,
    rerender: (value: SharedSession | null) => view.rerender(tree(value)),
  };
}

beforeEach(() => {
  changeUiLanguage('en');
  mocks.listSites.mockReset().mockResolvedValue({ items: [site], total: 1 });
  mocks.listCameras.mockReset().mockResolvedValue({ items: [camera], total: 1 });
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

it('renders named PPE and Restricted-zone monitoring links with validated Site and camera query parameters', async () => {
  mount(adminSession, '/camera-setup?siteId=site-1&cameraId=cam-1');
  await screen.findByText(camera.name);

  const nav = screen.getByRole('navigation', { name: 'Open monitoring' });
  const ppeLink = within(nav).getByRole('link', { name: 'PPE monitoring' });
  const zonesLink = within(nav).getByRole('link', { name: 'Restricted-zone monitoring' });

  expect(ppeLink.getAttribute('href')).toBe('/ppe?siteId=site-1&cameraId=cam-1');
  expect(zonesLink.getAttribute('href')).toBe('/zones?siteId=site-1&cameraId=cam-1');
  expect(screen.queryByRole('link', { name: 'Open monitoring' })).toBeNull();
});

it('omits unresolved or out-of-scope camera and Site parameters from both monitoring destination links', async () => {
  mocks.listCameras.mockResolvedValueOnce({
    items: [camera, { ...camera, id: 'foreign-cam', siteId: 'site-2', name: 'Foreign camera' }],
    total: 2,
  });

  mount(adminSession, '/camera-setup?siteId=site-1&cameraId=foreign-cam');
  await screen.findByText(camera.name);

  expect(screen.getByRole('link', { name: 'PPE monitoring' }).getAttribute('href')).toBe(
    '/ppe?siteId=site-1',
  );
  expect(
    screen.getByRole('link', { name: 'Restricted-zone monitoring' }).getAttribute('href'),
  ).toBe('/zones?siteId=site-1');

  cleanup();
  mount(adminSession, '/camera-setup?siteId=unowned-site&cameraId=cam-1');
  await screen.findByText(
    'The linked selection is not in the loaded list. Load more or choose an available item.',
  );

  expect(screen.getByRole('link', { name: 'PPE monitoring' }).getAttribute('href')).toBe('/ppe');
  expect(
    screen.getByRole('link', { name: 'Restricted-zone monitoring' }).getAttribute('href'),
  ).toBe('/zones');
});

it('withholds both monitoring destination links when the session lacks monitoring access for the selected Site', async () => {
  const { rerender } = mount(
    createSession([{ role: 'SITE_MANAGER', siteId: site.id }], 'manager-only'),
    '/camera-setup?siteId=site-1&cameraId=cam-1',
  );
  await screen.findByText(camera.name);

  expect(screen.queryByRole('link', { name: 'PPE monitoring' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Restricted-zone monitoring' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Open monitoring' })).toBeNull();

  rerender(
    createSession(
      [
        { role: 'SITE_MANAGER', siteId: site.id },
        { role: 'SAFETY_OFFICER', siteId: 'site-2' },
      ],
      'manager-other-officer',
    ),
  );
  await screen.findByText(camera.name);

  expect(screen.queryByRole('link', { name: 'PPE monitoring' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Restricted-zone monitoring' })).toBeNull();
});

it('updates both monitoring destination labels in place on locale change without extra API calls or closing active setup dialogs', async () => {
  const scopedManagerOfficer = createSession(
    [
      { role: 'SITE_MANAGER', siteId: site.id },
      { role: 'SAFETY_OFFICER', siteId: site.id },
    ],
    'manager-officer-1',
  );
  mount(scopedManagerOfficer, '/camera-setup?siteId=site-1&cameraId=cam-1');
  await screen.findByText(camera.name);

  fireEvent.click(screen.getByRole('button', { name: 'Manage Gate camera' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(mocks.listSites).toHaveBeenCalledTimes(1);
  expect(mocks.listCameras).toHaveBeenCalledTimes(1);

  await act(async () => changeUiLanguage('vi'));

  const nav = screen.getByRole('navigation', { name: 'Mở giám sát' });
  expect(within(nav).getByRole('link', { name: 'Giám sát PPE' }).getAttribute('href')).toBe(
    '/ppe?siteId=site-1&cameraId=cam-1',
  );
  expect(
    within(nav).getByRole('link', { name: 'Giám sát vùng hạn chế' }).getAttribute('href'),
  ).toBe('/zones?siteId=site-1&cameraId=cam-1');
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(mocks.listSites).toHaveBeenCalledTimes(1);
  expect(mocks.listCameras).toHaveBeenCalledTimes(1);
});
