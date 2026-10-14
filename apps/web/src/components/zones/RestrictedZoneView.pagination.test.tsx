// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient, type SiteResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import type { RegionResponse } from './zonePolygonAdapter';
import type { SharedSession } from '../../types/shared-session';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RestrictedZoneView } from './RestrictedZoneView';

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: () => ({
    preview: null,
    status: 'UNAVAILABLE',
    error: null,
    retry: vi.fn(),
  }),
}));
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
const site = (n: number): SiteResponse => ({
  id: `site-${n}`,
  code: `SITE-${n}`,
  name: `Worksite ${n}`,
  createdAt: '2026-10-09T00:00:00Z',
});
const camera = (n: number, siteId = 'site-1'): CameraResponse => ({
  id: `cam-${n}`,
  siteId,
  code: `CAM-${n}`,
  name: `Camera ${n}`,
  externalId: `source-${n}`,
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-10-09T00:00:00Z',
});
const region = (n: number, cameraId = 'cam-1'): RegionResponse => ({
  id: `r-${String(n).padStart(6, '0')}`,
  cameraId,
  zoneId: 'zone-1',
  polygon: {
    coordinates: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  },
  coordinateSpace: 'NORMALIZED_0_1',
  version: 1,
  isActive: true,
  createdAt: '2026-10-09T00:00:00Z',
});
let queries: QueryClient;
let session: SharedSession;
function mount() {
  const element = (next = session) => (
    <QueryClientProvider client={queries}>
      <RestrictedZoneView apiUrl="http://localhost:3000" sharedSession={next} />
    </QueryClientProvider>
  );
  const view = render(element());
  return { ...view, changeSession: (next: SharedSession) => view.rerender(element(next)) };
}
beforeEach(() => {
  localStorage.clear();
  queries = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
  session = {
    accessToken: 'token-a',
    sessionScope: 'session-a',
    user: {
      id: 'admin',
      displayName: 'Administrator',
      roleAssignments: [{ role: 'ADMIN', siteId: null }],
    },
    onSignOut: vi.fn(),
  };
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [site(1)],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockImplementation(
    async (_token, siteId) => ({ items: [camera(1, siteId)], total: 1 }),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockImplementation(
    async (_token, _site, cameraId) => ({ items: [region(1, cameraId)], total: 1 }),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'logout').mockResolvedValue(undefined as never);
});
afterEach(() => {
  cleanup();
  queries.clear();
  vi.restoreAllMocks();
});

it.each(['sites', 'cameras', 'regions'] as const)(
  'loads %s beyond 100 without replacing the selected item',
  async (kind) => {
    const list =
      kind === 'sites'
        ? vi.mocked(SmartSiteManagementClient.prototype.listSites)
        : kind === 'cameras'
          ? vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
          : vi.mocked(SmartSiteManagementClient.prototype.listRegions);
    const rows = Array.from({ length: 100 }, (_, index) =>
      kind === 'sites'
        ? site(index + 1)
        : kind === 'cameras'
          ? camera(index + 1)
          : region(index + 1),
    );
    const last = kind === 'sites' ? site(101) : kind === 'cameras' ? camera(101) : region(101);
    list
      .mockResolvedValueOnce({ items: rows, total: 101 } as never)
      .mockResolvedValueOnce({ items: [last], total: 101 } as never);
    mount();
    const more = await screen.findByRole('button', { name: `Load more ${kind}` });
    const index = kind === 'sites' ? 0 : kind === 'cameras' ? 1 : 2;
    const select = screen.getAllByRole('combobox')[index] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: rows[4]!.id } });
    fireEvent.click(more);
    await screen.findByRole('option', {
      name:
        kind === 'sites'
          ? 'SITE-101 · Worksite 101'
          : kind === 'cameras'
            ? 'CAM-101 · Camera 101 (v1)'
            : 'Region r-000101 (v1) · Active',
    });
    expect(select.value).toBe(rows[4]!.id);
    const args = list.mock.calls.at(-1)!;
    expect(args.at(-2)).toEqual({ offset: 100, limit: 100 });
    expect(args.at(-1)).toEqual({ signal: expect.any(AbortSignal) });
  },
);

it('does not expose previous account metadata when token rotates but sessionScope is reused', async () => {
  const list = vi
    .mocked(SmartSiteManagementClient.prototype.listSites)
    .mockResolvedValueOnce({ items: [site(1)], total: 1 })
    .mockImplementationOnce(() => new Promise(() => {}));
  const view = mount();
  await screen.findByRole('option', { name: 'SITE-1 · Worksite 1' });
  await screen.findByRole('option', { name: 'Region r-000001 (v1) · Active' });
  view.changeSession({ ...session, accessToken: 'token-b' });
  expect(screen.queryByRole('option', { name: 'SITE-1 · Worksite 1' })).toBeNull();
  expect(screen.queryByRole('option', { name: 'Region r-000001 (v1) · Active' })).toBeNull();
  await waitFor(() =>
    expect(list).toHaveBeenCalledWith('token-b', expect.anything(), expect.anything()),
  );
  expect(
    JSON.stringify(
      queries
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ),
  ).not.toContain('token-b');
});

it('isolates cached metadata when role scope changes without a token or sessionScope change', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listSites)
    .mockResolvedValueOnce({ items: [site(1)], total: 1 })
    .mockImplementationOnce(() => new Promise(() => {}));
  const view = mount();
  await screen.findByRole('option', { name: 'Region r-000001 (v1) · Active' });
  view.changeSession({
    ...session,
    user: { ...session.user, roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-2' }] },
  });
  expect(screen.queryByRole('option', { name: 'SITE-1 · Worksite 1' })).toBeNull();
  expect(screen.queryByRole('option', { name: 'CAM-1 · Camera 1 (v1)' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Region (Geometry Editing)' })).toBeNull();
});

it.each([401, 403, 404])(
  'hides already loaded regions when a later page denies scope with %i',
  async (status) => {
    vi.mocked(SmartSiteManagementClient.prototype.listRegions)
      .mockResolvedValueOnce({ items: [region(1)], total: 2 })
      .mockRejectedValueOnce(new ApiError('http', 'PRIVATE server detail', status));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more regions' }));
    if (status === 401) {
      await screen.findByText('Session pending or expired');
      await waitFor(() => expect(session.onSignOut).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('button', { name: 'Retry loading regions' })).toBeNull();
    } else {
      await screen.findByRole('button', { name: 'Retry loading regions' });
      expect(session.onSignOut).not.toHaveBeenCalled();
    }
    expect(screen.queryByRole('option', { name: 'Region r-000001 (v1) · Active' })).toBeNull();
    expect(screen.queryByText('PRIVATE server detail')).toBeNull();
  },
);

it('keeps regions on transient later-page error and retries the same offset', async () => {
  const list = vi
    .mocked(SmartSiteManagementClient.prototype.listRegions)
    .mockResolvedValueOnce({ items: [region(1)], total: 2 })
    .mockRejectedValueOnce(new ApiError('http', 'PRIVATE detail', 503))
    .mockResolvedValueOnce({ items: [region(2)], total: 2 });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more regions' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry loading more regions' }));
  await screen.findByRole('option', { name: 'Region r-000002 (v1) · Active' });
  expect(screen.getByRole('option', { name: 'Region r-000001 (v1) · Active' })).toBeTruthy();
  expect(list.mock.calls.slice(1).map((call) => call[3]?.offset)).toEqual([1, 1]);
});

it('rejects an empty non-progressing page without looping or dropping authorized rows', async () => {
  const list = vi
    .mocked(SmartSiteManagementClient.prototype.listRegions)
    .mockResolvedValueOnce({ items: [region(1)], total: 2 })
    .mockResolvedValueOnce({ items: [], total: 2 });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more regions' }));
  await screen.findByRole('button', { name: 'Retry loading more regions' });
  expect(list).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('option', { name: 'Region r-000001 (v1) · Active' })).toBeTruthy();
});

it('deduplicates overlapping pages without changing the consumed offset', async () => {
  const list = vi
    .mocked(SmartSiteManagementClient.prototype.listRegions)
    .mockResolvedValueOnce({ items: [region(1)], total: 3 })
    .mockResolvedValueOnce({ items: [region(1), region(2)], total: 3 });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more regions' }));
  await screen.findByRole('option', { name: 'Region r-000002 (v1) · Active' });
  expect(screen.getAllByRole('option', { name: 'Region r-000001 (v1) · Active' })).toHaveLength(1);
  expect(screen.getByText('2 of 3 regions loaded')).toBeTruthy();
  expect(list.mock.calls.at(-1)?.[3]?.offset).toBe(1);
});

it('ignores cameras and regions from a different scope even if returned in a page', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mockResolvedValueOnce({
    items: [camera(99, 'other-site'), camera(1)],
    total: 2,
  });
  vi.mocked(SmartSiteManagementClient.prototype.listRegions).mockResolvedValueOnce({
    items: [region(99, 'other-camera'), region(1)],
    total: 2,
  });
  mount();
  await screen.findByRole('option', { name: 'Region r-000001 (v1) · Active' });
  expect(screen.queryByRole('option', { name: 'CAM-99 · Camera 99 (v1)' })).toBeNull();
  expect(screen.queryByRole('option', { name: 'Region r-000099 (v1) · Active' })).toBeNull();
  expect((screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement).value).toBe(
    'cam-1',
  );
});

it('aborts a pending region page on Site change and ignores its eventual result', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listSites).mockResolvedValue({
    items: [site(1), site(2)],
    total: 2,
  });
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mockImplementation(
    async (_token, siteId) => ({ items: [camera(siteId === 'site-1' ? 1 : 2, siteId)], total: 1 }),
  );
  let resolve!: (page: { items: RegionResponse[]; total: number }) => void;
  let signal: AbortSignal | undefined;
  vi.mocked(SmartSiteManagementClient.prototype.listRegions)
    .mockResolvedValueOnce({ items: [region(1)], total: 2 })
    .mockImplementationOnce((_token, _site, _camera, _options, request) => {
      signal = request?.signal;
      return new Promise((done) => {
        resolve = done;
      });
    })
    .mockResolvedValueOnce({ items: [region(99, 'cam-2')], total: 1 });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more regions' }));
  await waitFor(() => expect(resolve).toBeDefined());
  fireEvent.change(screen.getByRole('combobox', { name: 'Site' }), { target: { value: 'site-2' } });
  await screen.findByRole('option', { name: 'Region r-000099 (v1) · Active' });
  await waitFor(() => expect(signal?.aborted).toBe(true));
  await act(async () => resolve({ items: [region(2)], total: 2 }));
  expect(screen.queryByRole('option', { name: 'Region r-000002 (v1) · Active' })).toBeNull();
});

it('hides prior rows if a later page fails during a base refetch', async () => {
  const list = vi
    .mocked(SmartSiteManagementClient.prototype.listRegions)
    .mockResolvedValueOnce({ items: [region(1)], total: 2 })
    .mockResolvedValueOnce({ items: [region(2)], total: 2 })
    .mockResolvedValueOnce({ items: [region(1)], total: 2 })
    .mockRejectedValueOnce(new ApiError('http', 'PRIVATE', 503));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more regions' }));
  await screen.findByRole('option', { name: 'Region r-000002 (v1) · Active' });
  await act(async () => {
    await queries.invalidateQueries({
      queryKey: ['zone-admin', 'http://localhost:3000', 'session-a', 'site-1', 'cam-1', 'regions'],
    });
  });
  await screen.findByRole('button', { name: 'Retry loading regions' });
  expect(list).toHaveBeenCalledTimes(4);
  expect(screen.queryByRole('option', { name: 'Region r-000001 (v1) · Active' })).toBeNull();
});

it('does not create concurrent next-page requests from repeated clicks', async () => {
  let resolve!: (page: { items: RegionResponse[]; total: number }) => void;
  const list = vi
    .mocked(SmartSiteManagementClient.prototype.listRegions)
    .mockResolvedValueOnce({ items: [region(1)], total: 2 })
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
  mount();
  const more = await screen.findByRole('button', { name: 'Load more regions' });
  fireEvent.click(more);
  fireEvent.click(more);
  await waitFor(() => expect(resolve).toBeDefined());
  expect(list).toHaveBeenCalledTimes(2);
  await act(async () => resolve({ items: [region(2)], total: 2 }));
  await screen.findByRole('option', { name: 'Region r-000002 (v1) · Active' });
});
