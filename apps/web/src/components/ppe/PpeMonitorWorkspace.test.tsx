// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LoginResponse } from '@smartsite/api-client';
import { ApiError } from '@smartsite/api-client';
import { PpeMonitorWorkspace } from './PpeMonitorWorkspace';

const state = vi.hoisted(() => ({ sites: vi.fn(), cameras: vi.fn() }));
const client = { listSites: state.sites, listPreviewCameras: state.cameras };
vi.mock('../../features/auth/auth-session', () => ({ useManagementClient: () => client }));
vi.mock('./FocusedCameraMedia', () => ({
  FocusedCameraMedia: (p: { camera: { id: string }; aiPaused?: boolean; onExitFocus?: () => void }) => (
    <div data-testid="focus" data-paused={String(Boolean(p.aiPaused))}>
      {p.camera.id}
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
    onEnlargeCamera: (id: string) => void;
  }) => (
    <button
      data-testid="wall"
      data-paused={String(p.isAiWorkPaused)}
      onClick={() => p.onEnlargeCamera(p.selectedCameraId)}
    >
      {p.selectedCameraId}
    </button>
  ),
  FourSourceWallTile: (p: { camera: { id: string } }) => (
    <div data-testid="focus">{p.camera.id}</div>
  ),
}));
const site = '11111111-1111-4111-8111-111111111111';
const camera = {
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

it('mounts authorized metadata and single-camera focus default while paused state reaches the preview boundary', async () => {
  render(<PpeMonitorWorkspace apiUrl="https://backend.example" session={session()} aiPaused />, {
    wrapper,
  });
  const focused = await screen.findByTestId('focus');
  expect(focused.getAttribute('data-paused')).toBe('true');
  expect(focused.textContent).toContain(camera.id);
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

it('manager-only session does not request Safety monitoring metadata', () => {
  render(
    <PpeMonitorWorkspace
      apiUrl="https://backend.example"
      session={session('manager', 'SITE_MANAGER')}
    />,
    { wrapper },
  );
  expect(screen.getByRole('alert').textContent).toContain('requires an active Admin');
  expect(state.sites).not.toHaveBeenCalled();
  expect(state.cameras).not.toHaveBeenCalled();
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
