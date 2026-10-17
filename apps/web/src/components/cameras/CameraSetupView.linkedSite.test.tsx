// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
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
  ZonePpeSetupDialog: () => <div role="dialog">Zones</div>,
}));

const site1 = {
  id: 'site-1',
  code: 'S1',
  name: 'North Site',
  createdAt: '2026-10-16T00:00:00Z',
};
const site2 = {
  id: 'site-2',
  code: 'S2',
  name: 'South Site',
  createdAt: '2026-10-16T00:00:00Z',
};
const camera1 = {
  id: 'cam-1',
  siteId: site1.id,
  code: 'C1',
  name: 'North Gate camera',
  externalId: 'source-1',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: site1.createdAt,
};
const camera2 = {
  id: 'cam-2',
  siteId: site2.id,
  code: 'C2',
  name: 'South Gate camera',
  externalId: 'source-2',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: site2.createdAt,
};

const EN_LINKED_HINT =
  'The linked selection is not in the loaded list. Load more or choose an available item.';
const VI_LINKED_HINT =
  'Lựa chọn trong liên kết chưa có trong danh sách đã tải. Tải thêm hoặc chọn mục khả dụng.';

function manager(siteIds: readonly string[] = [site1.id, site2.id]): SharedSession {
  return {
    accessToken: 'scoped-token-1',
    sessionScope: 'session-scope-1',
    user: {
      id: 'manager-1',
      displayName: 'Site Manager',
      roleAssignments: siteIds.map((siteId) => ({ role: 'SITE_MANAGER' as const, siteId })),
    },
  };
}

const activeCaches: QueryClient[] = [];

function mount(session: SharedSession | null = manager(), entry = '/camera-setup?siteId=site-2') {
  const cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  activeCaches.push(cache);
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

describe('CameraSetupView Deep-Linked Site Selection Hint', () => {
  beforeEach(() => {
    changeUiLanguage('en');
    mocks.listSites.mockReset();
    mocks.listCameras.mockReset();
    mocks.listPreviewCameras.mockReset();
    mocks.client = {
      listSites: mocks.listSites,
      listCameras: mocks.listCameras,
      listPreviewCameras: mocks.listPreviewCameras,
    };
  });

  afterEach(() => {
    cleanup();
    activeCaches.splice(0).forEach((cache) => cache.clear());
    vi.restoreAllMocks();
    changeUiLanguage('en');
  });

  it('shows a polite linkedSelection hint when the deep-linked Site is on a later page, makes no camera API calls until loaded, and selects the requested Site and removes the hint after loading more', async () => {
    mocks.listSites
      .mockResolvedValueOnce({ items: [site1], total: 2 })
      .mockResolvedValueOnce({ items: [site2], total: 2 });
    mocks.listCameras.mockResolvedValueOnce({ items: [camera2], total: 1 });

    mount(manager([site2.id]), '/camera-setup?siteId=site-2');

    await screen.findByRole('option', { name: 'S1 · North Site' });

    const hint = screen.getByText(EN_LINKED_HINT);
    expect(hint.getAttribute('role')).toBe('status');
    expect((screen.getByRole('combobox', { name: 'Site' }) as HTMLSelectElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Load more sites' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Cameras' })).toBeNull();
    expect(screen.queryByText('No cameras registered.')).toBeNull();
    expect(screen.queryByText('No sites available for configuration.')).toBeNull();
    expect(mocks.listCameras).not.toHaveBeenCalled();
    expect(mocks.listPreviewCameras).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Load more sites' }));

    expect(await screen.findByText(camera2.name)).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Site' }) as HTMLSelectElement).value).toBe(
      site2.id,
    );
    expect(screen.queryByText(EN_LINKED_HINT)).toBeNull();
    expect(mocks.listCameras).toHaveBeenCalledOnce();
    expect(mocks.listCameras.mock.calls[0]?.[1]).toBe(site2.id);
    expect(mocks.listPreviewCameras).not.toHaveBeenCalled();
  });

  it('retains the polite linkedSelection hint without fake empty states when a deep-linked Site is absent after exhausting all pages, and clears it when an available Site is selected', async () => {
    mocks.listSites
      .mockResolvedValueOnce({ items: [site1], total: 2 })
      .mockResolvedValueOnce({ items: [site2], total: 2 });
    mocks.listCameras.mockResolvedValueOnce({ items: [camera1], total: 1 });

    mount(manager([site1.id, site2.id]), '/camera-setup?siteId=site-missing');

    await screen.findByRole('option', { name: 'S1 · North Site' });
    expect(screen.getByText(EN_LINKED_HINT).getAttribute('role')).toBe('status');

    fireEvent.click(screen.getByRole('button', { name: 'Load more sites' }));
    await screen.findByRole('option', { name: 'S2 · South Site' });

    expect(screen.queryByRole('button', { name: 'Load more sites' })).toBeNull();
    expect(screen.getByText(EN_LINKED_HINT).getAttribute('role')).toBe('status');
    expect((screen.getByRole('combobox', { name: 'Site' }) as HTMLSelectElement).value).toBe('');
    expect(screen.queryByText('No sites available for configuration.')).toBeNull();
    expect(screen.queryByText('No cameras registered.')).toBeNull();
    expect(mocks.listCameras).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('combobox', { name: 'Site' }), {
      target: { value: site1.id },
    });

    expect(await screen.findByText(camera1.name)).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Site' }) as HTMLSelectElement).value).toBe(
      site1.id,
    );
    expect(screen.queryByText(EN_LINKED_HINT)).toBeNull();
    expect(mocks.listCameras).toHaveBeenCalledOnce();
    expect(mocks.listCameras.mock.calls[0]?.[1]).toBe(site1.id);
  });

  it('does not render the linkedSelection hint while pending, on settled empty Site catalog, on base error, or on hard 401/403/404 errors', async () => {
    let resolvePending!: (value: unknown) => void;
    mocks.listSites.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePending = resolve;
        }),
    );

    mount(manager(), '/camera-setup?siteId=site-2');
    expect(screen.getByText('Loading configuration…')).toBeTruthy();
    expect(screen.queryByText(EN_LINKED_HINT)).toBeNull();

    await act(async () => resolvePending({ items: [], total: 0 }));
    expect(await screen.findByText('No sites available for configuration.')).toBeTruthy();
    expect(screen.queryByText(EN_LINKED_HINT)).toBeNull();
    cleanup();

    mocks.listSites.mockRejectedValueOnce(new Error('network failure'));
    mount(manager(), '/camera-setup?siteId=site-2');
    expect(await screen.findByText('Could not load configuration. Please try again.')).toBeTruthy();
    expect(screen.queryByText(EN_LINKED_HINT)).toBeNull();
    cleanup();

    for (const status of [403, 404] as const) {
      mocks.listSites.mockRejectedValueOnce(new ApiError('http', 'Denied', status));
      mount(manager(), '/camera-setup?siteId=site-2');
      expect(
        await screen.findByText('Configuration access is unavailable for this scope.'),
      ).toBeTruthy();
      expect(screen.queryByText(EN_LINKED_HINT)).toBeNull();
      cleanup();
    }

    const onSignOut = vi.fn();
    mocks.listSites.mockRejectedValueOnce(new ApiError('http', 'Unauthorized', 401));
    mount({ ...manager(), onSignOut }, '/camera-setup?siteId=site-2');
    expect(await screen.findByText('Sign in to manage configuration.')).toBeTruthy();
    expect(screen.queryByText(EN_LINKED_HINT)).toBeNull();
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('rerenders the linkedSelection hint across EN and VI and clears it on next-page hard error or credential/session scope replacement', async () => {
    mocks.listSites
      .mockResolvedValueOnce({ items: [site1], total: 2 })
      .mockRejectedValueOnce(new ApiError('http', 'Forbidden', 403))
      .mockResolvedValueOnce({ items: [site2], total: 1 });
    mocks.listCameras.mockResolvedValueOnce({ items: [camera2], total: 1 });

    const { rerender } = mount(manager([site2.id]), '/camera-setup?siteId=site-2');

    await screen.findByRole('option', { name: 'S1 · North Site' });
    expect(screen.getByText(EN_LINKED_HINT).getAttribute('role')).toBe('status');

    await act(async () => changeUiLanguage('vi'));
    expect(screen.getByText(VI_LINKED_HINT).getAttribute('role')).toBe('status');
    expect(screen.getByRole('button', { name: 'Tải thêm công trường' })).toBeTruthy();

    await act(async () => changeUiLanguage('en'));
    expect(screen.getByText(EN_LINKED_HINT).getAttribute('role')).toBe('status');

    // A hard 403 on next-page fetch becomes a baseError and must hide the linkedSelection hint
    fireEvent.click(screen.getByRole('button', { name: 'Load more sites' }));
    expect(
      await screen.findByText('Configuration access is unavailable for this scope.'),
    ).toBeTruthy();
    expect(screen.queryByText(EN_LINKED_HINT)).toBeNull();

    // Replacing credential/session scope resets the workspace and loads the new scope cleanly
    rerender({
      ...manager([site2.id]),
      accessToken: 'scoped-token-2',
      sessionScope: 'session-scope-2',
    });
    expect(await screen.findByText(camera2.name)).toBeTruthy();
    expect(screen.queryByText(EN_LINKED_HINT)).toBeNull();

    // Clearing the session removes all workspace controls and hints
    rerender(null);
    await waitFor(() => expect(screen.getByText('Sign in to manage configuration.')).toBeTruthy());
    expect(screen.queryByText(EN_LINKED_HINT)).toBeNull();
    expect(screen.queryByText(camera2.name)).toBeNull();
  });

  it('does not offer a selectable empty Site that silently restores the first Site', async () => {
    mocks.listSites.mockResolvedValue({ items: [site1, site2], total: 2 });
    mocks.listCameras.mockResolvedValue({ items: [camera2], total: 1 });
    mount();
    await screen.findByText(camera2.name);
    const placeholder = screen.getByRole('option', { name: 'Choose a site' }) as HTMLOptionElement;
    expect(placeholder.disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Site' }) as HTMLSelectElement).value).toBe(
      site2.id,
    );
  });

  it('explains a linked camera on a later page and clears the notice when that camera loads', async () => {
    mocks.listSites.mockResolvedValue({ items: [site1], total: 1 });
    mocks.listCameras.mockResolvedValueOnce({ items: [camera1], total: 2 }).mockResolvedValueOnce({
      items: [{ ...camera1, id: 'cam-later', name: 'Later camera' }],
      total: 2,
    });
    mount(manager(), '/camera-setup?siteId=site-1&cameraId=cam-later');
    await screen.findByText(camera1.name);
    const notice = screen.getByText(
      'The linked camera is not on the loaded pages. Load more cameras to look for it.',
    );
    expect(notice.getAttribute('role')).toBe('status');
    expect(
      screen.queryByText(
        'The linked camera is unavailable in this site’s catalog. Check the link or choose another site.',
      ),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Load more cameras' }));
    await screen.findByText('Later camera');
    expect(notice.isConnected).toBe(false);
    expect(mocks.listCameras.mock.calls[1]?.[2]).toEqual({ offset: 1, limit: 20 });
    expect(mocks.listPreviewCameras).not.toHaveBeenCalled();
  });

  it('reports an unavailable linked camera only after a settled catalog and clears the context on Site change', async () => {
    let resolve!: (value: unknown) => void;
    mocks.listSites.mockResolvedValue({ items: [site1, site2], total: 2 });
    mocks.listCameras
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce({ items: [camera2], total: 1 });
    mount(manager(), '/camera-setup?siteId=site-1&cameraId=cam-missing');
    await screen.findByRole('option', { name: 'S1 · North Site' });
    const text =
      'The linked camera is unavailable in this site’s catalog. Check the link or choose another site.';
    expect(screen.queryByText(text)).toBeNull();
    await act(async () => resolve({ items: [{ ...camera2, id: 'cam-missing' }], total: 1 }));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.getByText(text).getAttribute('role')).toBe('status');
    await act(async () => changeUiLanguage('vi'));
    const translated =
      'Camera trong liên kết không có trong danh mục của công trường này. Kiểm tra liên kết hoặc chọn công trường khác.';
    expect(screen.getByText(translated)).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Công trường' }), {
      target: { value: site2.id },
    });
    await screen.findByText(camera2.name);
    expect(screen.queryByText(translated)).toBeNull();
    expect(mocks.listPreviewCameras).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404])(
    'does not describe a failed %s camera read as an unavailable linked camera',
    async (status) => {
      mocks.listSites.mockResolvedValue({ items: [site1], total: 1 });
      mocks.listCameras.mockRejectedValue(new ApiError('http', 'Denied', status));
      mount(manager(), '/camera-setup?siteId=site-1&cameraId=cam-missing');
      await waitFor(() => expect(mocks.listCameras).toHaveBeenCalledOnce());
      await screen.findByText(
        status === 401
          ? 'Sign in to manage configuration.'
          : 'Configuration access is unavailable for this scope.',
      );
      expect(
        screen.queryByText(
          'The linked camera is unavailable in this site’s catalog. Check the link or choose another site.',
        ),
      ).toBeNull();
      expect(
        screen.queryByText(
          'The linked camera is not on the loaded pages. Load more cameras to look for it.',
        ),
      ).toBeNull();
    },
  );
});
