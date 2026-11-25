// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoginResponse } from '@smartsite/api-client';
import { ApiError } from '@smartsite/api-client';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import { PpeMonitorWorkspace } from './PpeMonitorWorkspace';

const state = vi.hoisted(() => ({ sites: vi.fn(), cameras: vi.fn() }));
const client = { listSites: state.sites, listPreviewCameras: state.cameras };
vi.mock('../../features/auth/auth-session', () => ({ useManagementClient: () => client }));
vi.mock('./FocusedCameraMedia', () => ({
  FocusedCameraMedia: (p: {
    camera: { id: string };
    aiPaused?: boolean;
    onOpenEvidence?: () => void;
    onExitFocus?: () => void;
  }) => (
    <div
      data-testid="focus"
      data-paused={String(Boolean(p.aiPaused))}
      data-has-evidence={String(Boolean(p.onOpenEvidence))}
    >
      {p.camera.id}
      {p.onOpenEvidence && (
        <button data-testid="focused-evidence-btn" onClick={p.onOpenEvidence}>
          Evidence
        </button>
      )}
      <button data-testid="focused-exit-to-grid" onClick={p.onExitFocus}>
        Back to grid
      </button>
    </div>
  ),
}));
vi.mock('./FourSourceWall', () => ({
  FourSourceWall: (p: {
    selectedCameraId: string;
    isAiWorkPaused: boolean;
    onOpenEvidence?: (id: string) => void;
    onEnlargeCamera: (id: string) => void;
  }) => (
    <button
      data-testid="wall"
      data-paused={String(p.isAiWorkPaused)}
      data-has-evidence={String(Boolean(p.onOpenEvidence))}
      onClick={() => p.onEnlargeCamera(p.selectedCameraId)}
    >
      {p.selectedCameraId}
    </button>
  ),
  FourSourceWallTile: (p: { camera: { id: string } }) => (
    <div data-testid="focus">{p.camera.id}</div>
  ),
}));
vi.mock('./MonitorEvidenceDrawer', () => ({
  MonitorEvidenceDrawer: (p: { open: boolean; siteId: string }) => (
    <div data-testid="monitor-evidence-drawer" data-open={String(p.open)} data-site-id={p.siteId} />
  ),
}));
const site = '11111111-1111-4111-8111-111111111111';
const camera = {
  type: 'ZONE' as const,
  gateId: null,
  id: '22222222-2222-4222-8222-222222222222',
  siteId: site,
  status: 'ACTIVE',
  name: 'Tapo',
  code: 'C',
  externalId: 'tapo',
  configurationVersion: 1,
  createdAt: '2026-11-04T00:00:00Z',
};
const session = (token = 'first', role = 'SAFETY_OFFICER') =>
  ({
    accessToken: token,
    user: {
      id: 'officer',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role, siteId: site }],
    },
  }) as unknown as Pick<LoginResponse, 'accessToken' | 'user'>;
let query: QueryClient;
let entry: string;
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={query}>
      <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  entry = '/ppe';
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.sites
    .mockReset()
    .mockResolvedValue({ items: [{ id: site, name: 'Site A', code: 'A' }], total: 1 });
  state.cameras.mockReset().mockResolvedValue({ items: [camera], total: 1 });
});
afterEach(() => {
  cleanup();
  query.clear();
});

it('mounts authorized metadata and single-camera focus default while paused state reaches the preview boundary without duplicating the top banner', async () => {
  render(<PpeMonitorWorkspace apiUrl="https://backend.example" session={session()} aiPaused />, {
    wrapper,
  });
  const focused = await screen.findByTestId('focus');
  expect(focused.getAttribute('data-paused')).toBe('true');
  expect(focused.textContent).toContain(camera.id);
  expect(screen.queryByText('AI processing is paused. Camera previews are disabled.')).toBeNull();
  expect(state.cameras).toHaveBeenCalledWith(
    'first',
    site,
    { offset: 0, limit: 20 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  fireEvent.click(screen.getByTestId('monitor-grid-btn'));
  expect(screen.getByTestId('wall').getAttribute('data-paused')).toBe('true');
  fireEvent.click(screen.getByTestId('wall'));
  expect(screen.getByTestId('focus').textContent).toContain(camera.id);
});

it('advances raw offsets through inactive pages instead of claiming successful empty metadata', async () => {
  const inactive = Array.from({ length: 20 }, (_, i) => ({
    ...camera,
    id: `inactive-${i}`,
    status: 'INACTIVE',
  }));
  state.cameras
    .mockResolvedValueOnce({ items: inactive, total: 21 })
    .mockResolvedValueOnce({ items: [camera], total: 21 });
  render(<PpeMonitorWorkspace apiUrl="https://backend.example" session={session()} />, { wrapper });
  expect(
    await screen.findByText('More cameras may be on later pages.', { exact: false }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  expect((await screen.findByTestId('focus')).textContent).toContain(camera.id);
  expect(state.cameras).toHaveBeenLastCalledWith(
    'first',
    site,
    { offset: 20, limit: 20 },
    expect.anything(),
  );
});

it('credential replacement removes old camera content while replacement metadata is pending', async () => {
  const view = render(
    <PpeMonitorWorkspace apiUrl="https://backend.example" session={session()} />,
    { wrapper },
  );
  await screen.findByTestId('focus');
  state.sites.mockImplementation(() => new Promise(() => {}));
  view.rerender(
    <PpeMonitorWorkspace apiUrl="https://backend.example" session={session('second')} />,
  );
  expect(screen.queryByTestId('focus')).toBeNull();
  expect(screen.queryByTestId('wall')).toBeNull();
  await waitFor(() =>
    expect(state.sites).toHaveBeenLastCalledWith(
      'second',
      { offset: 0, limit: 20 },
      expect.anything(),
    ),
  );
  expect(
    JSON.stringify(
      query
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey),
    ),
  ).not.toContain('second');
});

it('allows an active assigned SITE_MANAGER to view camera monitoring while hiding all Officer-only safety records and evidence drawer surfaces', async () => {
  const otherSite = '44444444-4444-4444-8444-444444444444';
  state.sites.mockResolvedValue({
    items: [
      { id: site, name: 'Site A', code: 'A' },
      { id: otherSite, name: 'Other Site', code: 'B' },
    ],
    total: 2,
  });

  render(
    <PpeMonitorWorkspace
      apiUrl="https://backend.example"
      session={session('manager', 'SITE_MANAGER')}
      enableFrameInboxLink
    />,
    { wrapper },
  );

  const focused = await screen.findByTestId('focus');
  expect(focused.textContent).toContain(camera.id);
  expect(focused.getAttribute('data-has-evidence')).toBe('false');
  expect(screen.queryByTestId('focused-evidence-btn')).toBeNull();
  expect(screen.queryByTestId('monitor-evidence-drawer')).toBeNull();
  expect(screen.queryByTestId('monitor-frame-inbox-link')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Open safety records' })).toBeNull();

  // Only the Manager's assigned site is selectable; other sites are filtered out
  const siteSelect = screen.getByRole('combobox', { name: 'Site' }) as HTMLSelectElement;
  expect(Array.from(siteSelect.options).map((o) => o.value)).toEqual([site]);

  // Grid mode also omits onOpenEvidence for Manager
  fireEvent.click(screen.getByTestId('monitor-grid-btn'));
  expect(screen.getByTestId('wall').getAttribute('data-has-evidence')).toBe('false');
});

it('blocks a SITE_MANAGER from opening another unassigned site via URL link', async () => {
  const otherSite = '44444444-4444-4444-8444-444444444444';
  entry = `/ppe?siteId=${otherSite}&cameraId=${camera.id}`;
  state.sites.mockResolvedValue({
    items: [
      { id: site, name: 'Site A', code: 'A' },
      { id: otherSite, name: 'Other Site', code: 'B' },
    ],
    total: 2,
  });

  render(
    <PpeMonitorWorkspace
      apiUrl="https://backend.example"
      session={session('manager', 'SITE_MANAGER')}
    />,
    { wrapper },
  );

  expect(await screen.findByText('The linked site is unavailable.')).toBeTruthy();
  expect(state.cameras).not.toHaveBeenCalled();
  expect(screen.queryByTestId('focus')).toBeNull();
  expect(screen.queryByTestId('monitor-evidence-drawer')).toBeNull();
});

it('denies unassigned Admin or inactive users without requesting monitoring metadata', () => {
  const adminOnlySession = {
    accessToken: 'admin-token',
    user: {
      id: 'admin-1',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'ADMIN', siteId: null }],
    },
  } as unknown as Pick<LoginResponse, 'accessToken' | 'user'>;

  render(<PpeMonitorWorkspace apiUrl="https://backend.example" session={adminOnlySession} />, {
    wrapper,
  });
  expect(screen.getByRole('alert').textContent).toContain(
    'Camera monitoring requires an active Site Manager or Safety Officer assigned to a site.',
  );
  expect(state.sites).not.toHaveBeenCalled();
  expect(state.cameras).not.toHaveBeenCalled();
});

it('retains Officer safety records, evidence callbacks, and drawer on an Officer-assigned site only', async () => {
  render(
    <PpeMonitorWorkspace
      apiUrl="https://backend.example"
      session={session('officer', 'SAFETY_OFFICER')}
      enableFrameInboxLink
    />,
    { wrapper },
  );

  const focused = await screen.findByTestId('focus');
  expect(focused.getAttribute('data-has-evidence')).toBe('true');
  expect(screen.getByRole('link', { name: 'Open safety records' })).toBeTruthy();
  expect(screen.getByTestId('monitor-frame-inbox-link')).toBeTruthy();
  expect(screen.getByTestId('monitor-evidence-drawer').getAttribute('data-open')).toBe('false');

  fireEvent.click(screen.getByTestId('focused-evidence-btn'));
  expect(screen.getByTestId('monitor-evidence-drawer').getAttribute('data-open')).toBe('true');
});

it('transient next-page failure preserves the camera but a later forbidden page revokes it', async () => {
  const first = [
    camera,
    ...Array.from({ length: 19 }, (_, i) => ({
      ...camera,
      id: `inactive-${i}`,
      status: 'INACTIVE',
    })),
  ];
  state.cameras
    .mockResolvedValueOnce({ items: first, total: 21 })
    .mockRejectedValueOnce(new ApiError('network', 'offline'))
    .mockRejectedValueOnce(new ApiError('http', 'Forbidden', 403));
  render(<PpeMonitorWorkspace apiUrl="https://backend.example" session={session()} />, { wrapper });
  await screen.findByTestId('focus');
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByRole('button', { name: 'Retry' });
  expect(screen.getByTestId('focus').textContent).toContain(camera.id);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.queryByTestId('focus')).toBeNull());
  expect(state.cameras).toHaveBeenLastCalledWith(
    'first',
    site,
    { offset: 20, limit: 20 },
    expect.anything(),
  );
});

it('opens the linked camera rather than the first camera in the authorized page', async () => {
  const target = { ...camera, id: '33333333-3333-4333-8333-333333333333', name: 'Linked' };
  entry = `/ppe?siteId=${site}&cameraId=${target.id}`;
  state.cameras.mockResolvedValue({ items: [camera, target], total: 2 });

  render(<PpeMonitorWorkspace apiUrl="https://backend.example" session={session()} aiPaused />, {
    wrapper,
  });

  expect((await screen.findByTestId('wall')).textContent).toBe(target.id);
});

it('does not show another camera while waiting for the linked camera on a later page', async () => {
  const target = { ...camera, id: '33333333-3333-4333-8333-333333333333', name: 'Linked' };
  entry = `/ppe?siteId=${site}&cameraId=${target.id}`;
  const firstPage = Array.from({ length: 20 }, (_, i) => ({ ...camera, id: `first-${i}` }));
  state.cameras
    .mockResolvedValueOnce({ items: firstPage, total: 21 })
    .mockResolvedValueOnce({ items: [target], total: 21 });

  render(<PpeMonitorWorkspace apiUrl="https://backend.example" session={session()} aiPaused />, {
    wrapper,
  });

  const loadMore = await screen.findByRole('button', { name: 'Load more' });
  expect(screen.queryByTestId('wall')).toBeNull();
  fireEvent.click(loadMore);
  expect((await screen.findByTestId('wall')).textContent).toBe(target.id);
});

it('keeps a linked site outside the authorized list from selecting another site', async () => {
  entry = `/ppe?siteId=44444444-4444-4444-8444-444444444444&cameraId=${camera.id}`;
  render(<PpeMonitorWorkspace apiUrl="https://backend.example" session={session()} aiPaused />, {
    wrapper,
  });

  expect(await screen.findByText('The linked site is unavailable.')).toBeTruthy();
  expect(state.cameras).not.toHaveBeenCalled();
  expect(screen.queryByTestId('wall')).toBeNull();
});

it('hides the pending /incidents?tab=ppe-frames link on Main by default while keeping /incidents?tab=episodes active', async () => {
  const view = render(
    <PpeMonitorWorkspace apiUrl="https://backend.example" session={session()} aiPaused />,
    { wrapper },
  );
  await screen.findByTestId('focus');
  expect(screen.queryByTestId('monitor-frame-inbox-link')).toBeNull();
  const episodesLink = screen.getByRole('link', { name: 'Open safety records' });
  expect(episodesLink.getAttribute('href')).toBe(
    `/incidents?tab=episodes&siteId=${encodeURIComponent(site)}`,
  );

  view.rerender(
    <PpeMonitorWorkspace
      apiUrl="https://backend.example"
      session={session()}
      aiPaused
      enableFrameInboxLink
    />,
  );
  expect(screen.getByTestId('monitor-frame-inbox-link').getAttribute('href')).toBe(
    `/incidents?tab=ppe-frames&siteId=${encodeURIComponent(site)}`,
  );
});

it('moving from toolbar into Focus reaches the viewer and returning reaches the grid controls', async () => {
  const second = { ...camera, id: '55555555-5555-4555-8555-555555555555', name: 'Second' };
  state.cameras.mockResolvedValue({ items: [camera, second], total: 2 });
  render(<PpeMonitorWorkspace apiUrl="https://backend.example" session={session()} />, { wrapper });
  await screen.findByTestId('wall');
  fireEvent.click(screen.getByTestId('monitor-focus-btn'));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByTestId('focused-exit-to-grid')),
  );
  fireEvent.click(screen.getByTestId('focused-exit-to-grid'));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('monitor-grid-btn')));
});

describe('linked camera setup recovery and distinct loading/error/auth boundaries', () => {
  const inactiveCamera = {
    ...camera,
    id: '4772d181-1111-4111-8111-4772d1810001',
    code: 'CAM1',
    name: 'Site Yard Cam 1',
    status: 'INACTIVE',
  };

  beforeEach(async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('offers a site- and camera-scoped Camera Setup recovery link for a verified inactive camera on the authorized Site for SITE_MANAGER (EN/VI) while keeping SAFETY_OFFICER read-only', async () => {
    entry = `/ppe?siteId=${site}&cameraId=${inactiveCamera.id}`;
    state.cameras.mockResolvedValue({ items: [inactiveCamera], total: 1 });

    const { unmount } = render(
      <PpeMonitorWorkspace
        apiUrl="https://backend.example"
        session={session('manager-tok', 'SITE_MANAGER')}
        aiPaused
      />,
      { wrapper },
    );

    const card = await screen.findByTestId('monitor-linked-camera-empty');
    expect(card.textContent).toContain('The linked camera is unavailable.');
    expect(card.textContent).toMatch(/disabled in configuration/i);

    const setupLink = within(card).getByTestId('monitor-linked-camera-setup-link');
    expect(setupLink.getAttribute('href')).toBe(
      `/camera-setup?siteId=${encodeURIComponent(site)}&cameraId=${encodeURIComponent(inactiveCamera.id)}`,
    );

    // Vietnamese copy parity
    await i18n.changeLanguage('vi');
    await waitFor(() => {
      expect(card.textContent).toContain('Camera trong liên kết không khả dụng.');
      expect(card.textContent).toContain('Camera này đang tắt trong cấu hình.');
      expect(setupLink.textContent).toContain('Xem Thiết lập Camera');
    });

    // Safety Officer stays read-only: no Camera Setup recovery link (no new role grants)
    unmount();
    query.clear();
    await i18n.changeLanguage('en');

    render(
      <PpeMonitorWorkspace
        apiUrl="https://backend.example"
        session={session('officer-tok', 'SAFETY_OFFICER')}
        aiPaused
      />,
      { wrapper },
    );

    const officerCard = await screen.findByTestId('monitor-linked-camera-empty');
    expect(officerCard.textContent).toMatch(/Site Manager/i);
    expect(within(officerCard).queryByTestId('monitor-linked-camera-setup-link')).toBeNull();
    expect(screen.queryByRole('link', { name: /Camera Setup|Thiết lập Camera/i })).toBeNull();
  });

  it('strips unknown or foreign cameraId from the Camera Setup recovery link while preserving authorized siteId and active camera fallback', async () => {
    const foreignCameraId = '99999999-9999-4999-8999-999999999999';
    const otherSiteId = '88888888-8888-4888-8888-888888888888';
    entry = `/ppe?siteId=${site}&cameraId=${foreignCameraId}`;
    // Even if a foreign-site row were present in payload, siteCameras filters it out and never propagates its ID.
    state.cameras.mockResolvedValue({
      items: [camera, { ...inactiveCamera, id: foreignCameraId, siteId: otherSiteId }],
      total: 2,
    });

    render(
      <PpeMonitorWorkspace
        apiUrl="https://backend.example"
        session={session('manager-tok', 'SITE_MANAGER')}
        aiPaused
      />,
      { wrapper },
    );

    const card = await screen.findByTestId('monitor-linked-camera-empty');
    const setupLink = within(card).getByTestId('monitor-linked-camera-setup-link');
    expect(setupLink.getAttribute('href')).toBe(`/camera-setup?siteId=${encodeURIComponent(site)}`);
    expect(setupLink.getAttribute('href')).not.toContain(foreignCameraId);

    // Active site camera fallback button remains available alongside the recovery link
    expect(within(card).getByTestId('monitor-clear-linked-camera')).toBeTruthy();
  });

  it('does not render a Camera Setup recovery link when there is no authorized selected Site', async () => {
    const unassignedSite = '77777777-7777-4777-8777-777777777777';
    entry = `/ppe?siteId=${unassignedSite}&cameraId=${inactiveCamera.id}`;
    state.sites.mockResolvedValue({ items: [], total: 0 });

    render(
      <PpeMonitorWorkspace
        apiUrl="https://backend.example"
        session={session('manager-tok', 'SITE_MANAGER')}
        aiPaused
      />,
      { wrapper },
    );

    expect(await screen.findByText('The linked site is unavailable.')).toBeTruthy();
    expect(screen.queryByTestId('monitor-linked-camera-empty')).toBeNull();
    expect(screen.queryByTestId('monitor-linked-camera-setup-link')).toBeNull();
    expect(screen.queryByTestId('monitor-inspect-camera-setup')).toBeNull();
    expect(state.cameras).not.toHaveBeenCalled();
  });

  it('keeps loading, 403 auth denial, and 503 metadata errors distinct without mislabelling them as empty or showing a Camera Setup link', async () => {
    entry = `/ppe?siteId=${site}&cameraId=${inactiveCamera.id}`;

    // 1) Loading state while camera list is pending
    let resolveCameras!: (value: { items: (typeof camera)[]; total: number }) => void;
    state.cameras.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCameras = resolve;
        }),
    );

    const { unmount } = render(
      <PpeMonitorWorkspace
        apiUrl="https://backend.example"
        session={session('manager-tok', 'SITE_MANAGER')}
        aiPaused
      />,
      { wrapper },
    );

    expect(await screen.findByTestId('monitor-catalog-status')).toBeTruthy();
    expect(screen.getByTestId('monitor-catalog-status').textContent).toContain('Loading…');
    expect(screen.queryByTestId('monitor-linked-camera-empty')).toBeNull();
    expect(screen.queryByTestId('monitor-linked-camera-setup-link')).toBeNull();

    resolveCameras({ items: [inactiveCamera], total: 1 });
    expect(await screen.findByTestId('monitor-linked-camera-setup-link')).toBeTruthy();
    unmount();
    query.clear();

    // 2) 403 auth denial on camera fetch -> role="alert" denied notice, NOT empty/unavailable
    state.cameras.mockRejectedValueOnce(new ApiError('http', 'Forbidden', 403));
    const deniedView = render(
      <PpeMonitorWorkspace
        apiUrl="https://backend.example"
        session={session('manager-tok', 'SITE_MANAGER')}
        aiPaused
      />,
      { wrapper },
    );

    const authAlert = await screen.findByTestId('monitor-camera-auth-error');
    expect(authAlert.getAttribute('role')).toBe('alert');
    expect(screen.queryByTestId('monitor-linked-camera-empty')).toBeNull();
    expect(screen.queryByTestId('monitor-linked-camera-setup-link')).toBeNull();
    expect(screen.queryByTestId('monitor-no-active-cameras')).toBeNull();
    deniedView.unmount();
    query.clear();

    // 3) 503 metadata error on camera fetch -> role="alert" with Retry, NOT empty/unavailable, recovers on Retry
    state.cameras
      .mockRejectedValueOnce(new ApiError('http', 'Service Unavailable', 503))
      .mockResolvedValueOnce({ items: [inactiveCamera], total: 1 });

    render(
      <PpeMonitorWorkspace
        apiUrl="https://backend.example"
        session={session('manager-tok', 'SITE_MANAGER')}
        aiPaused
      />,
      { wrapper },
    );

    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert.textContent).toContain('Could not load preview cameras for this site.');
    expect(screen.queryByTestId('monitor-linked-camera-empty')).toBeNull();
    expect(screen.queryByTestId('monitor-linked-camera-setup-link')).toBeNull();

    fireEvent.click(within(errorAlert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('monitor-linked-camera-setup-link')).toBeTruthy();
  });

  it('suppresses the Camera Setup recovery link when parent Site metadata fails on a retained next-page 503 or a 403/503 refetch after an inactive camera deep link loaded', async () => {
    entry = `/ppe?siteId=${site}&cameraId=${inactiveCamera.id}`;
    const firstSitePage = [
      { id: site, name: 'Site A', code: 'A' },
      ...Array.from({ length: 19 }, (_, i) => ({
        id: `11111111-1111-4111-8111-${String(i + 2).padStart(12, '0')}`,
        name: `Other Site ${i + 2}`,
        code: `S${i + 2}`,
      })),
    ];
    state.sites
      .mockResolvedValueOnce({ items: firstSitePage, total: 21 })
      .mockRejectedValueOnce(new ApiError('http', 'Service Unavailable', 503))
      .mockRejectedValueOnce(new ApiError('http', 'Forbidden', 403));
    state.cameras.mockResolvedValue({ items: [inactiveCamera], total: 1 });

    render(
      <PpeMonitorWorkspace
        apiUrl="https://backend.example"
        session={session('manager-tok', 'SITE_MANAGER')}
        aiPaused
      />,
      { wrapper },
    );

    // 1) Initial load succeeds -> recovery CTA is offered for verified inactive camera
    expect(await screen.findByTestId('monitor-linked-camera-setup-link')).toBeTruthy();

    // 2) Next-page Site metadata fetch fails 503 -> useMonitorPages retains sites.rows, but recovery CTA MUST be suppressed
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByTestId('monitor-linked-camera-empty')).toBeTruthy();
    expect(screen.queryByTestId('monitor-linked-camera-setup-link')).toBeNull();

    // 3) Retry next-page fails 403 -> useMonitorPages purges sites.rows and shows auth denial with zero recovery CTA
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const siteAuthAlert = await screen.findByTestId('monitor-site-auth-error');
    expect(siteAuthAlert.getAttribute('role')).toBe('alert');
    expect(screen.queryByTestId('monitor-linked-camera-empty')).toBeNull();
    expect(screen.queryByTestId('monitor-linked-camera-setup-link')).toBeNull();
  });
});
