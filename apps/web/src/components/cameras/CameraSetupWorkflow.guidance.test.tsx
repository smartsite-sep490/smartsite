// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SharedSession } from '../../types/shared-session';
import { changeUiLanguage } from '../../i18n/runtime';
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

const site = {
  id: 'site-1',
  code: 'S1',
  name: 'North Site',
  createdAt: '2026-10-17T00:00:00Z',
};

function createSession(
  id: string,
  roleAssignments: SharedSession['user']['roleAssignments'],
): SharedSession {
  return {
    accessToken: `token-${id}`,
    sessionScope: `scope-${id}`,
    user: {
      id,
      displayName: id,
      roleAssignments,
    },
  };
}

const assignedManagerSession = createSession('manager-assigned', [
  { role: 'SITE_MANAGER', siteId: site.id },
]);
const foreignManagerSession = createSession('manager-foreign', [
  { role: 'SITE_MANAGER', siteId: 'site-other' },
]);
const globalAdminSession = createSession('admin-global', [{ role: 'ADMIN', siteId: null }]);

const caches: QueryClient[] = [];

function mountSetup(session: SharedSession) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  caches.push(cache);
  return render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <CameraSetupView apiUrl="http://localhost:3000" sharedSession={session} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CameraSetupWorkflow & Header Intro Guidance vs Role Capabilities', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    changeUiLanguage('en');
    mocks.listSites.mockReset().mockResolvedValue({ items: [site], total: 1 });
    mocks.listCameras.mockReset().mockResolvedValue({ items: [], total: 0 });
    mocks.listPreviewCameras.mockReset();
    mocks.client = {
      listSites: mocks.listSites,
      listCameras: mocks.listCameras,
      listPreviewCameras: mocks.listPreviewCameras,
    };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    caches.splice(0).forEach((cache) => cache.clear());
  });

  it('shows exact site-scoped intro in EN/VI for assigned Site Manager without monitoring link while preserving all three task buttons and step copy', async () => {
    mountSetup(assignedManagerSession);

    const guide = await screen.findByRole('list', { name: 'Setup steps' });
    expect(screen.getByText('Cameras and area PPE policies for this site.')).toBeTruthy();
    expect(
      screen.queryByText(
        'Register cameras and link observation areas. Open monitoring to view images.',
      ),
    ).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open monitoring' })).toBeNull();

    expect(
      within(guide).getByText('The Site Manager creates areas and their PPE requirements.'),
    ).toBeTruthy();
    expect(within(guide).getByText('The Site Manager registers each camera.')).toBeTruthy();
    expect(
      within(guide).getByText(
        'The Site Manager links observation regions to areas. Source verification is separate.',
      ),
    ).toBeTruthy();
    expect(within(guide).getByRole('button', { name: 'Configure PPE by Zone' })).toBeTruthy();
    expect(within(guide).getByRole('button', { name: 'Register camera' })).toBeTruthy();
    expect(within(guide).getByRole('button', { name: 'Link observation regions' })).toBeTruthy();
    expect(mocks.listPreviewCameras).not.toHaveBeenCalled();

    await act(async () => changeUiLanguage('vi'));
    expect(screen.getByText('Camera và chính sách PPE của công trường.')).toBeTruthy();
    expect(
      screen.queryByText('Đăng ký camera và liên kết vùng quan sát. Mở giám sát để xem hình ảnh.'),
    ).toBeNull();
    expect(screen.queryByRole('link', { name: 'Mở giám sát' })).toBeNull();
  });

  it('shows exact site-scoped intro in EN/VI for read-only Global Admin without imperative register/link copy while preserving View area policies and Open monitoring', async () => {
    mountSetup(globalAdminSession);

    const guide = await screen.findByRole('list', { name: 'Setup steps' });
    expect(screen.getByText('Cameras and area PPE policies for this site.')).toBeTruthy();
    expect(
      screen.queryByText(
        'Register cameras and link observation areas. Open monitoring to view images.',
      ),
    ).toBeNull();

    expect(within(guide).getByRole('button', { name: 'View area policies' })).toBeTruthy();
    expect(within(guide).queryByRole('button', { name: 'Configure PPE by Zone' })).toBeNull();
    expect(within(guide).queryByRole('button', { name: 'Register camera' })).toBeNull();
    expect(within(guide).queryByRole('button', { name: 'Link observation regions' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open monitoring' })).toBeTruthy();
    expect(mocks.listPreviewCameras).not.toHaveBeenCalled();

    await act(async () => changeUiLanguage('vi'));
    expect(screen.getByText('Camera và chính sách PPE của công trường.')).toBeTruthy();
    expect(
      screen.queryByText('Đăng ký camera và liên kết vùng quan sát. Mở giám sát để xem hình ảnh.'),
    ).toBeNull();
    expect(screen.getByRole('link', { name: 'Mở giám sát' })).toBeTruthy();
  });

  it('shows exact site-scoped intro in EN/VI and preserves managerHint and step overview without task buttons or camera queries for foreign-site Site Manager', async () => {
    mountSetup(foreignManagerSession);

    const guide = await screen.findByRole('list', { name: 'Setup steps' });
    expect(screen.getByText('Cameras and area PPE policies for this site.')).toBeTruthy();
    expect(
      screen.getByText('The Site Manager defines PPE requirements for each area.'),
    ).toBeTruthy();
    for (const name of [
      'Configure PPE by Zone',
      'View area policies',
      'Register camera',
      'Link observation regions',
    ]) {
      expect(within(guide).queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByRole('link', { name: 'Open monitoring' })).toBeNull();
    expect(mocks.listCameras).not.toHaveBeenCalled();
    expect(mocks.listPreviewCameras).not.toHaveBeenCalled();

    await act(async () => changeUiLanguage('vi'));
    expect(screen.getByText('Camera và chính sách PPE của công trường.')).toBeTruthy();
    expect(screen.getByText('Quản lý công trường quy định PPE cho từng khu vực.')).toBeTruthy();
  });
});
