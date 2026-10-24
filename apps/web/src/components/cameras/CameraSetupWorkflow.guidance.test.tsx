// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraResponse, SiteResponse } from '@smartsite/contracts/management';
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
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    caches.splice(0).forEach((cache) => cache.clear());
  });

  it('shows exact site-scoped intro in EN/VI for assigned Site Manager without monitoring link while embedding toolbar, default-closed help details, and per-row ACTIVE region action inside Cameras', async () => {
    mountSetup(assignedManagerSession);

    const camerasSection = await screen.findByRole('region', { name: 'Cameras' });
    await within(camerasSection).findByRole('heading', { name: activeCamera.name });

    expect(screen.getByText('Site cameras and area PPE policies.')).toBeTruthy();
    expect(
      screen.queryByText(
        'Register cameras and link observation areas. Open monitoring to view images.',
      ),
    ).toBeNull();
    expect(screen.queryByRole('link', { name: 'PPE monitoring' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Restricted-zone monitoring' })).toBeNull();

    expect(
      within(camerasSection).getByRole('button', { name: 'Configure PPE by Zone' }),
    ).toBeTruthy();
    expect(within(camerasSection).getByRole('button', { name: 'Register camera' })).toBeTruthy();

    const helpSummary = within(camerasSection).getByText('Setup guide').closest('summary');
    const helpDetails = helpSummary?.parentElement;
    if (!(helpDetails instanceof HTMLDetailsElement) || !helpSummary) {
      throw new Error('Expected native details/summary for setup help.');
    }
    expect(helpDetails.open).toBe(false);
    fireEvent.click(helpSummary);
    expect(helpDetails.open).toBe(true);

    const guide = within(helpDetails).getByRole('list', { name: 'Setup steps' });
    expect(within(guide).getByText('Create site areas and PPE requirements.')).toBeTruthy();
    expect(within(guide).getByText('Register each camera in configuration.')).toBeTruthy();
    expect(
      within(guide).getByText(
        'Link observation regions to areas. Source verification is separate.',
      ),
    ).toBeTruthy();
    expect(within(helpDetails).queryByRole('button')).toBeNull();

    const activeRow = within(camerasSection)
      .getByRole('heading', { name: activeCamera.name })
      .closest('li');
    const inactiveRow = within(camerasSection)
      .getByRole('heading', { name: inactiveCamera.name })
      .closest('li');
    if (!activeRow || !inactiveRow) {
      throw new Error('Expected active and inactive camera rows.');
    }
    expect(
      within(activeRow).getByRole('button', { name: 'Link observation regions' }),
    ).toBeTruthy();
    expect(
      within(inactiveRow).queryByRole('button', { name: 'Link observation regions' }),
    ).toBeNull();
    expect(
      within(camerasSection).getAllByRole('button', { name: 'Link observation regions' }),
    ).toHaveLength(1);
    expect(mocks.listPreviewCameras).not.toHaveBeenCalled();

    await act(async () => changeUiLanguage('vi'));
    expect(screen.getByText('Camera và PPE của công trường.')).toBeTruthy();
    expect(
      screen.queryByText('Đăng ký camera và liên kết vùng quan sát. Mở giám sát để xem hình ảnh.'),
    ).toBeNull();
    expect(screen.queryByRole('link', { name: 'Giám sát PPE' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Giám sát vùng hạn chế' })).toBeNull();
    expect(within(activeRow).getByRole('button', { name: 'Gắn vùng quan sát' })).toBeTruthy();
  });

  it('shows exact site-scoped intro in EN/VI for read-only Global Admin without imperative register/link copy or region buttons while preserving View area policies and PPE monitoring', async () => {
    mountSetup(globalAdminSession);

    const camerasSection = await screen.findByRole('region', { name: 'Cameras' });
    await within(camerasSection).findByRole('heading', { name: activeCamera.name });

    expect(screen.getByText('Site cameras and area PPE policies.')).toBeTruthy();
    expect(
      screen.queryByText(
        'Register cameras and link observation areas. Open monitoring to view images.',
      ),
    ).toBeNull();

    const helpSummary = within(camerasSection).getByText('Setup guide').closest('summary');
    const helpDetails = helpSummary?.parentElement;
    if (!(helpDetails instanceof HTMLDetailsElement) || !helpSummary) {
      throw new Error('Expected native details/summary for setup help.');
    }
    expect(helpDetails.open).toBe(false);
    expect(within(helpDetails).getByRole('list', { name: 'Setup steps' })).toBeTruthy();

    expect(within(camerasSection).getByRole('button', { name: 'View area policies' })).toBeTruthy();
    expect(
      within(camerasSection).queryByRole('button', { name: 'Configure PPE by Zone' }),
    ).toBeNull();
    expect(within(camerasSection).queryByRole('button', { name: 'Register camera' })).toBeNull();
    expect(
      within(camerasSection).queryByRole('button', { name: 'Link observation regions' }),
    ).toBeNull();
    expect(screen.getByRole('link', { name: 'PPE monitoring' })).toBeTruthy();
    expect(mocks.listPreviewCameras).not.toHaveBeenCalled();

    await act(async () => changeUiLanguage('vi'));
    expect(screen.getByText('Camera và PPE của công trường.')).toBeTruthy();
    expect(
      screen.queryByText('Đăng ký camera và liên kết vùng quan sát. Mở giám sát để xem hình ảnh.'),
    ).toBeNull();
    expect(screen.getByRole('link', { name: 'Giám sát PPE' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Gắn vùng quan sát' })).toBeNull();
  });

  it('shows exact site-scoped intro in EN/VI and preserves default-closed step overview without persistent managerHint, task buttons, or camera queries for foreign-site Site Manager', async () => {
    mountSetup(foreignManagerSession);

    const camerasSection = await screen.findByRole('region', { name: 'Cameras' });
    expect(screen.getByText('Site cameras and area PPE policies.')).toBeTruthy();
    expect(
      within(camerasSection).getByText(
        'The assigned Site Manager configures cameras and observation regions.',
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText('The Site Manager defines PPE requirements for each area.'),
    ).toBeNull();

    const helpSummary = within(camerasSection).getByText('Setup guide').closest('summary');
    const helpDetails = helpSummary?.parentElement;
    if (!(helpDetails instanceof HTMLDetailsElement) || !helpSummary) {
      throw new Error('Expected native details/summary for setup help.');
    }
    expect(helpDetails.open).toBe(false);
    fireEvent.click(helpSummary);
    expect(helpDetails.open).toBe(true);
    expect(within(helpDetails).getByRole('list', { name: 'Setup steps' })).toBeTruthy();

    for (const name of [
      'Configure PPE by Zone',
      'View area policies',
      'Register camera',
      'Link observation regions',
    ]) {
      expect(within(camerasSection).queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByRole('link', { name: 'PPE monitoring' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Restricted-zone monitoring' })).toBeNull();
    expect(mocks.listCameras).not.toHaveBeenCalled();
    expect(mocks.listPreviewCameras).not.toHaveBeenCalled();

    await act(async () => changeUiLanguage('vi'));
    expect(screen.getByText('Camera và PPE của công trường.')).toBeTruthy();
    expect(
      screen.getByText('Quản lý công trường được phân công thiết lập camera và vùng quan sát.'),
    ).toBeTruthy();
    expect(screen.queryByText('Quản lý công trường quy định PPE cho từng khu vực.')).toBeNull();
    expect(within(helpDetails).getByRole('list', { name: 'Thứ tự thiết lập' })).toBeTruthy();
  });
});
