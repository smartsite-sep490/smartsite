// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient, type SiteResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import type { SharedSession } from '../../types/shared-session';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RestrictedZoneView } from './RestrictedZoneView';
import { saveLocalDraft } from './zonePolygonAdapter';

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
  vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'logout').mockResolvedValue(undefined as never);
});
afterEach(() => {
  cleanup();
  queries.clear();
  vi.restoreAllMocks();
});

it('keeps monitoring read-only without loading setup Region metadata', async () => {
  mount();
  await screen.findByRole('option', { name: 'CAM-1 · Camera 1 (v1)' });
  expect(SmartSiteManagementClient.prototype.listRegions).not.toHaveBeenCalled();
  expect(screen.queryByRole('combobox', { name: 'Region (Geometry Editing)' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Edit.*polygon|Save.*polygon/i })).toBeNull();
  expect(screen.getByRole('link', { name: 'Camera setup' }).getAttribute('href')).toContain(
    'siteId=site-1',
  );
});

it.each(['sites', 'cameras'] as const)(
  'loads %s beyond 100 without replacing the selected item',
  async (kind) => {
    const list =
      kind === 'sites'
        ? vi.mocked(SmartSiteManagementClient.prototype.listSites)
        : vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras);
    const rows = Array.from({ length: 100 }, (_, index) =>
      kind === 'sites' ? site(index + 1) : camera(index + 1),
    );
    const last = kind === 'sites' ? site(101) : camera(101);
    list
      .mockResolvedValueOnce({ items: rows, total: 101 } as never)
      .mockResolvedValueOnce({ items: [last], total: 101 } as never);
    mount();
    const more = await screen.findByRole('button', { name: `Load more ${kind}` });
    const index = kind === 'sites' ? 0 : 1;
    const select = screen.getAllByRole('combobox')[index] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: rows[4]!.id } });
    fireEvent.click(more);
    await screen.findByRole('option', {
      name: kind === 'sites' ? 'SITE-101 · Worksite 101' : 'CAM-101 · Camera 101 (v1)',
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
  await screen.findByRole('option', { name: 'CAM-1 · Camera 1 (v1)' });
  view.changeSession({ ...session, accessToken: 'token-b' });
  expect(screen.queryByRole('option', { name: 'SITE-1 · Worksite 1' })).toBeNull();
  expect(screen.queryByRole('option', { name: 'CAM-1 · Camera 1 (v1)' })).toBeNull();
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
  await screen.findByRole('option', { name: 'CAM-1 · Camera 1 (v1)' });
  view.changeSession({
    ...session,
    user: { ...session.user, roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-2' }] },
  });
  expect(screen.queryByRole('option', { name: 'SITE-1 · Worksite 1' })).toBeNull();
  expect(screen.queryByRole('option', { name: 'CAM-1 · Camera 1 (v1)' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Region (Geometry Editing)' })).toBeNull();
});

it.each([401, 403, 404])(
  'hides already loaded cameras when a later page denies scope with %i',
  async (status) => {
    vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
      .mockResolvedValueOnce({ items: [camera(1)], total: 2 })
      .mockRejectedValueOnce(new ApiError('http', 'PRIVATE server detail', status));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more cameras' }));
    if (status === 401) {
      await screen.findByText('Session pending or expired');
      await waitFor(() => expect(session.onSignOut).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('button', { name: 'Retry loading cameras' })).toBeNull();
    } else {
      await screen.findByRole('button', { name: 'Retry loading cameras' });
      expect(session.onSignOut).not.toHaveBeenCalled();
    }
    expect(screen.queryByRole('option', { name: 'CAM-1 · Camera 1 (v1)' })).toBeNull();
    expect(screen.queryByText('PRIVATE server detail')).toBeNull();
  },
);

it('keeps cameras on transient later-page error and retries the same offset', async () => {
  const list = vi
    .mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
    .mockResolvedValueOnce({ items: [camera(1)], total: 2 })
    .mockRejectedValueOnce(new ApiError('http', 'PRIVATE detail', 503))
    .mockResolvedValueOnce({ items: [camera(2)], total: 2 });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more cameras' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry loading more cameras' }));
  await screen.findByRole('option', { name: 'CAM-2 · Camera 2 (v1)' });
  expect(screen.getByRole('option', { name: 'CAM-1 · Camera 1 (v1)' })).toBeTruthy();
  expect(list.mock.calls.slice(1).map((call) => call[2]?.offset)).toEqual([1, 1]);
});

it('rejects an empty non-progressing page without looping or dropping authorized rows', async () => {
  const list = vi
    .mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
    .mockResolvedValueOnce({ items: [camera(1)], total: 2 })
    .mockResolvedValueOnce({ items: [], total: 2 });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more cameras' }));
  await screen.findByRole('button', { name: 'Retry loading more cameras' });
  expect(list).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('option', { name: 'CAM-1 · Camera 1 (v1)' })).toBeTruthy();
});

it('deduplicates overlapping pages without changing the consumed offset', async () => {
  const list = vi
    .mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
    .mockResolvedValueOnce({ items: [camera(1)], total: 3 })
    .mockResolvedValueOnce({ items: [camera(1), camera(2)], total: 3 });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more cameras' }));
  await screen.findByRole('option', { name: 'CAM-2 · Camera 2 (v1)' });
  expect(screen.getAllByRole('option', { name: 'CAM-1 · Camera 1 (v1)' })).toHaveLength(1);
  expect(screen.getByText('2 of 3 cameras loaded')).toBeTruthy();
  expect(list.mock.calls.at(-1)?.[2]?.offset).toBe(1);
});

it('ignores cameras from a different Site even if returned in a page', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mockResolvedValueOnce({
    items: [camera(99, 'other-site'), camera(1)],
    total: 2,
  });
  mount();
  await screen.findByRole('option', { name: 'CAM-1 · Camera 1 (v1)' });
  expect(screen.queryByRole('option', { name: 'CAM-99 · Camera 99 (v1)' })).toBeNull();
  expect((screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement).value).toBe(
    'cam-1',
  );
});

it('aborts a pending camera page on Site change and ignores its eventual result', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listSites).mockResolvedValue({
    items: [site(1), site(2)],
    total: 2,
  });
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mockImplementation(
    async (_token, siteId) => ({ items: [camera(siteId === 'site-1' ? 1 : 2, siteId)], total: 1 }),
  );
  let resolve!: (page: { items: CameraResponse[]; total: number }) => void;
  let signal: AbortSignal | undefined;
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
    .mockResolvedValueOnce({ items: [camera(1)], total: 2 })
    .mockImplementationOnce((_token, _site, _options, request) => {
      signal = request?.signal;
      return new Promise((done) => {
        resolve = done;
      });
    })
    .mockResolvedValueOnce({ items: [camera(99, 'site-2')], total: 1 });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more cameras' }));
  await waitFor(() => expect(resolve).toBeDefined());
  fireEvent.change(screen.getByRole('combobox', { name: 'Site' }), { target: { value: 'site-2' } });
  await screen.findByRole('option', { name: 'CAM-99 · Camera 99 (v1)' });
  await waitFor(() => expect(signal?.aborted).toBe(true));
  await act(async () => resolve({ items: [camera(2)], total: 2 }));
  expect(screen.queryByRole('option', { name: 'CAM-2 · Camera 2 (v1)' })).toBeNull();
});

it('hides prior rows if a later page fails during a base refetch', async () => {
  const list = vi
    .mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
    .mockResolvedValueOnce({ items: [camera(1)], total: 2 })
    .mockResolvedValueOnce({ items: [camera(2)], total: 2 })
    .mockResolvedValueOnce({ items: [camera(1)], total: 2 })
    .mockRejectedValueOnce(new ApiError('http', 'PRIVATE', 503));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more cameras' }));
  await screen.findByRole('option', { name: 'CAM-2 · Camera 2 (v1)' });
  await act(async () => {
    await queries.invalidateQueries({
      queryKey: ['zone-admin', 'http://localhost:3000', 'session-a', 'site-1', 'cameras'],
    });
  });
  await screen.findByRole('button', { name: 'Retry loading cameras' });
  expect(list).toHaveBeenCalledTimes(4);
  expect(screen.queryByRole('option', { name: 'CAM-1 · Camera 1 (v1)' })).toBeNull();
});

it('does not create concurrent next-page requests from repeated clicks', async () => {
  let resolve!: (page: { items: CameraResponse[]; total: number }) => void;
  const list = vi
    .mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
    .mockResolvedValueOnce({ items: [camera(1)], total: 2 })
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
  mount();
  const more = await screen.findByRole('button', { name: 'Load more cameras' });
  fireEvent.click(more);
  fireEvent.click(more);
  await waitFor(() => expect(resolve).toBeDefined());
  expect(list).toHaveBeenCalledTimes(2);
  await act(async () => resolve({ items: [camera(2)], total: 2 }));
  await screen.findByRole('option', { name: 'CAM-2 · Camera 2 (v1)' });
});

it('handles wrong-Site partial pages for Sites and Cameras with accurate authorized counts', async () => {
  session = {
    ...session,
    user: {
      id: 'officer-2',
      displayName: 'Site 2 Safety Officer',
      roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-2' }],
    },
  };
  vi.mocked(SmartSiteManagementClient.prototype.listSites)
    .mockResolvedValueOnce({ items: [site(1)], total: 2 })
    .mockResolvedValueOnce({ items: [site(2)], total: 2 });
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
    .mockResolvedValueOnce({ items: [camera(99, 'site-1')], total: 2 })
    .mockResolvedValueOnce({ items: [camera(2, 'site-2')], total: 2 });

  mount();
  const moreSites = await screen.findByRole('button', { name: 'Load more sites' });
  expect(screen.getByText('0 of 2 sites loaded')).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'SITE-1 · Worksite 1' })).toBeNull();

  fireEvent.click(moreSites);
  await screen.findByRole('option', { name: 'SITE-2 · Worksite 2' });
  expect(screen.getByText('1 of 2 sites loaded')).toBeTruthy();

  const moreCameras = await screen.findByRole('button', { name: 'Load more cameras' });
  expect(screen.getByText('0 of 2 cameras loaded')).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'CAM-99 · Camera 99 (v1)' })).toBeNull();

  fireEvent.click(moreCameras);
  await screen.findByRole('option', { name: 'CAM-2 · Camera 2 (v1)' });
  expect(screen.getByText('1 of 2 cameras loaded')).toBeTruthy();
  expect((screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement).value).toBe(
    'cam-2',
  );
});

it('retains authorized draft polygon and settled site actions on transient next-page errors, and resets draft when a hard next-page error hides rows', async () => {
  saveLocalDraft('site-1', 'cam-1', 'default', 1, [
    [0.12, 0.18],
    [0.88, 0.18],
    [0.88, 0.84],
    [0.12, 0.84],
  ]);
  vi.mocked(SmartSiteManagementClient.prototype.listSites)
    .mockResolvedValueOnce({ items: [site(1)], total: 2 })
    .mockRejectedValueOnce(new ApiError('http', 'Transient site page error', 503));
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
    .mockResolvedValueOnce({ items: [camera(1)], total: 2 })
    .mockRejectedValueOnce(new ApiError('http', 'Transient camera page error', 503))
    .mockRejectedValueOnce(new ApiError('http', 'Revoked camera scope', 403));

  const { container } = render(
    <QueryClientProvider client={queries}>
      <RestrictedZoneView
        apiUrl="http://localhost:3000"
        sharedSession={session}
        onNavigate={vi.fn()}
      />
    </QueryClientProvider>,
  );

  await screen.findByRole('option', { name: 'CAM-1 · Camera 1 (v1)' });
  const polygon = container.querySelector('polygon');
  const draftPointsAttr = polygon?.getAttribute('points');
  expect(draftPointsAttr).toBeTruthy();
  expect(draftPointsAttr).not.toContain('0.63');

  fireEvent.click(await screen.findByRole('button', { name: 'Load more sites' }));
  await screen.findByRole('button', { name: 'Retry loading more sites' });
  fireEvent.click(await screen.findByRole('button', { name: 'Load more cameras' }));
  const retryMoreCameras = await screen.findByRole('button', {
    name: 'Retry loading more cameras',
  });

  expect(screen.getByRole('option', { name: 'SITE-1 · Worksite 1' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'CAM-1 · Camera 1 (v1)' })).toBeTruthy();
  expect(container.querySelector('polygon')?.getAttribute('points')).toBe(draftPointsAttr);

  fireEvent.click(screen.getByTestId('zone-details-toggle'));
  expect(await screen.findByTestId('zone-evidence-view-safety-alerts-btn')).toBeTruthy();

  fireEvent.click(retryMoreCameras);
  await screen.findByRole('button', { name: 'Retry loading cameras' });
  expect(screen.queryByRole('option', { name: 'CAM-1 · Camera 1 (v1)' })).toBeNull();
  expect(container.querySelector('polygon')?.getAttribute('points')).not.toBe(draftPointsAttr);
});

it('does not claim the linked Site is missing while its first metadata page is pending', () => {
  vi.mocked(SmartSiteManagementClient.prototype.listSites).mockImplementation(
    () => new Promise(() => {}),
  );
  render(
    <QueryClientProvider client={queries}>
      <RestrictedZoneView
        apiUrl="http://localhost:3000"
        sharedSession={session}
        initialSelection={{ siteId: 'site-1', cameraId: 'cam-1' }}
      />
    </QueryClientProvider>,
  );
  expect(
    screen.queryByText(
      'The linked selection is not in the loaded list. Load more or choose an available item.',
    ),
  ).toBeNull();
});
