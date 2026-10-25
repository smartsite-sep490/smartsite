// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient, type SiteResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import type { SharedSession } from '../../types/shared-session';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PpeMonitoringView } from './PpeMonitoringView';

const site = (n: number): SiteResponse => ({
  id: `site-${n}`,
  code: `SITE-${n}`,
  name: `Worksite ${n}`,
  createdAt: '2026-10-09T00:00:00Z',
});
const camera = (n: number, siteId = 'site-1'): CameraResponse => ({
  id: `${siteId}-cam-${n}`,
  siteId,
  code: `CAM-${n}`,
  name: `Camera ${n}`,
  externalId: `source-${n}`,
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-10-09T00:00:00Z',
});
const sites = Array.from({ length: 20 }, (_, n) => site(n + 1));
const cameras = Array.from({ length: 20 }, (_, n) => camera(n + 1));
let queries: QueryClient;
let session: SharedSession;
let siteManagerSession: SharedSession;
function mount(initial: SharedSession | null = session) {
  const element = (next: SharedSession | null = initial) => (
    <QueryClientProvider client={queries}>
      <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={next} />
    </QueryClientProvider>
  );
  const view = render(element(initial));
  return { ...view, changeSession: (next: SharedSession | null) => view.rerender(element(next)) };
}
beforeEach(() => {
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
  queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
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
  siteManagerSession = {
    accessToken: 'token-sm-a',
    sessionScope: 'session-sm-a',
    user: {
      id: 'site-manager-1',
      displayName: 'Site Manager 1',
      roleAssignments: [
        { role: 'SITE_MANAGER', siteId: 'site-1' },
        { role: 'SITE_MANAGER', siteId: 'site-2' },
      ],
    },
    onSignOut: vi.fn(),
  };
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [site(1)],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockImplementation(
    async (_t, s) => ({ items: [camera(1, s)], total: 1 }),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview').mockRejectedValue(
    new ApiError('http', 'AI must remain paused', 503),
  );
});
afterEach(() => {
  cleanup();
  queries.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('loads later sites explicitly and preserves the selected scope without starting AI requests', async () => {
  const list = vi
    .mocked(SmartSiteManagementClient.prototype.listSites)
    .mockResolvedValueOnce({ items: sites, total: 21 })
    .mockResolvedValueOnce({ items: [site(21)], total: 21 });
  mount();
  const more = await screen.findByRole('button', { name: 'Load more sites' });
  expect(list).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole('combobox', { name: 'Site' }), {
    target: { value: 'site-12' },
  });
  await screen.findByRole('option', { name: 'CAM-1 · Camera 1' });
  fireEvent.click(more);
  await screen.findByRole('option', { name: 'SITE-21 · Worksite 21' });
  expect((screen.getByRole('combobox', { name: 'Site' }) as HTMLSelectElement).value).toBe(
    'site-12',
  );
  expect(list).toHaveBeenLastCalledWith(
    'token-a',
    { offset: 20, limit: 20 },
    { signal: expect.any(AbortSignal) },
  );
  expect(SmartSiteManagementClient.prototype.getCameraPreview).not.toHaveBeenCalled();
});

it('loads later authorized cameras explicitly while preserving camera selection and overview chips', async () => {
  const list = vi
    .mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
    .mockResolvedValueOnce({ items: cameras, total: 21 })
    .mockResolvedValueOnce({ items: [camera(21)], total: 21 });
  mount();
  const more = await screen.findByRole('button', { name: 'Load more cameras' });
  expect(list).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole('combobox', { name: 'Camera' }), {
    target: { value: 'site-1-cam-12' },
  });
  fireEvent.click(more);
  await screen.findByRole('option', { name: 'CAM-21 · Camera 21' });
  expect(screen.getByTestId('camera-chip-site-1-cam-21')).toBeTruthy();
  expect((screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement).value).toBe(
    'site-1-cam-12',
  );
  expect(list).toHaveBeenLastCalledWith(
    'token-a',
    'site-1',
    { offset: 20, limit: 20 },
    { signal: expect.any(AbortSignal) },
  );
});

it('keeps the actual open Zone form draft when a pending site page finishes', async () => {
  let resolve!: (value: { items: SiteResponse[]; total: number }) => void;
  vi.mocked(SmartSiteManagementClient.prototype.listSites)
    .mockResolvedValueOnce({ items: sites, total: 21 })
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
  mount(siteManagerSession);
  fireEvent.click(await screen.findByRole('button', { name: 'Load more sites' }));
  await waitFor(() => expect(resolve).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: 'Configure PPE by Zone' }));
  const input = await screen.findByRole('textbox', { name: /Zone Name/i });
  fireEvent.change(input, { target: { value: 'Unsaved work area' } });
  await act(async () => resolve({ items: [site(21)], total: 21 }));
  expect((screen.getByRole('textbox', { name: /Zone Name/i }) as HTMLInputElement).value).toBe(
    'Unsaved work area',
  );
});

it.each(['sites', 'cameras'])(
  'retains authorized %s after transient next-page failure and retries the same offset',
  async (kind) => {
    if (kind === 'sites')
      vi.mocked(SmartSiteManagementClient.prototype.listSites)
        .mockResolvedValueOnce({ items: sites, total: 21 })
        .mockRejectedValueOnce(new ApiError('http', 'SECRET', 503))
        .mockResolvedValueOnce({ items: [site(21)], total: 21 });
    else
      vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
        .mockResolvedValueOnce({ items: cameras, total: 21 })
        .mockRejectedValueOnce(new ApiError('http', 'SECRET', 503))
        .mockResolvedValueOnce({ items: [camera(21)], total: 21 });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: `Load more ${kind}` }));
    const retry = await screen.findByRole('button', { name: `Retry loading more ${kind}` });
    expect(
      screen.getByRole('option', {
        name: kind === 'sites' ? 'SITE-1 · Worksite 1' : 'CAM-1 · Camera 1',
      }),
    ).toBeTruthy();
    expect(screen.queryByText('SECRET')).toBeNull();
    fireEvent.click(retry);
    await screen.findByRole('option', {
      name: kind === 'sites' ? 'SITE-21 · Worksite 21' : 'CAM-21 · Camera 21',
    });
    const offsets =
      kind === 'sites'
        ? vi
            .mocked(SmartSiteManagementClient.prototype.listSites)
            .mock.calls.map((c) => c[1]?.offset)
        : vi
            .mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
            .mock.calls.map((c) => c[2]?.offset);
    expect(offsets).toEqual([0, 20, 20]);
  },
);

it.each([401, 403, 404])(
  'revokes cached Site/camera scope on next Site page error %i',
  async (status) => {
    vi.mocked(SmartSiteManagementClient.prototype.listSites)
      .mockResolvedValueOnce({ items: sites, total: 21 })
      .mockRejectedValueOnce(new ApiError('http', 'SECRET', status));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more sites' }));
    await screen.findByRole('button', { name: 'Retry loading sites' });
    expect(screen.queryByRole('option', { name: 'SITE-1 · Worksite 1' })).toBeNull();
    expect(screen.queryByTestId('camera-chip-site-1-cam-1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Configure PPE by Zone' })).toBeNull();
    expect(session.onSignOut).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  },
);

it.each([401, 403, 404])(
  'revokes cached camera options/chips on next camera page error %i',
  async (status) => {
    vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
      .mockResolvedValueOnce({ items: cameras, total: 21 })
      .mockRejectedValueOnce(new ApiError('http', 'SECRET', status));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more cameras' }));
    await screen.findByRole('button', { name: 'Retry loading cameras' });
    expect(screen.queryByRole('option', { name: 'CAM-1 · Camera 1' })).toBeNull();
    expect(screen.queryByTestId('camera-chip-site-1-cam-1')).toBeNull();
    expect(session.onSignOut).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  },
);

it.each(['sites', 'cameras'])(
  'treats failure on a later page of a BASE %s refetch as a base error',
  async (kind) => {
    if (kind === 'sites')
      vi.mocked(SmartSiteManagementClient.prototype.listSites)
        .mockResolvedValueOnce({ items: sites, total: 21 })
        .mockResolvedValueOnce({ items: [site(21)], total: 21 })
        .mockResolvedValueOnce({ items: sites, total: 21 })
        .mockRejectedValueOnce(new ApiError('http', 'SECRET', 503));
    else
      vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
        .mockResolvedValueOnce({ items: cameras, total: 21 })
        .mockResolvedValueOnce({ items: [camera(21)], total: 21 })
        .mockResolvedValueOnce({ items: cameras, total: 21 })
        .mockRejectedValueOnce(new ApiError('http', 'SECRET', 503));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: `Load more ${kind}` }));
    await screen.findByRole('option', {
      name: kind === 'sites' ? 'SITE-21 · Worksite 21' : 'CAM-21 · Camera 21',
    });
    await act(async () => {
      await queries.invalidateQueries({ predicate: (q) => q.queryKey.includes(kind) });
    });
    await screen.findByRole('button', { name: `Retry loading ${kind}` });
    expect(
      screen.queryByRole('option', {
        name: kind === 'sites' ? 'SITE-21 · Worksite 21' : 'CAM-21 · Camera 21',
      }),
    ).toBeNull();
  },
);

it('aborts late camera pages and hides old scoped rows on Site change', async () => {
  let resolve!: (value: { items: CameraResponse[]; total: number }) => void;
  let signal: AbortSignal | undefined;
  vi.mocked(SmartSiteManagementClient.prototype.listSites).mockResolvedValue({
    items: [site(1), site(2)],
    total: 2,
  });
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
    .mockResolvedValueOnce({ items: cameras, total: 21 })
    .mockImplementationOnce((_t, _s, _o, request) => {
      signal = request?.signal;
      return new Promise((done) => {
        resolve = done;
      });
    })
    .mockResolvedValueOnce({ items: [camera(1, 'site-2')], total: 1 });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more cameras' }));
  await waitFor(() => expect(resolve).toBeDefined());
  fireEvent.change(screen.getByRole('combobox', { name: 'Site' }), { target: { value: 'site-2' } });
  expect(screen.queryByTestId('camera-chip-site-1-cam-1')).toBeNull();
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve({ items: [camera(21)], total: 21 }));
  await screen.findByTestId('camera-chip-site-2-cam-1');
  expect(screen.queryByTestId('camera-chip-site-1-cam-21')).toBeNull();
});

it('isolates pending Site pages across token rotation even with unchanged sessionScope', async () => {
  let resolve!: (value: { items: SiteResponse[]; total: number }) => void;
  let signal: AbortSignal | undefined;
  vi.mocked(SmartSiteManagementClient.prototype.listSites)
    .mockResolvedValueOnce({ items: sites, total: 21 })
    .mockImplementationOnce((_t, _o, request) => {
      signal = request?.signal;
      return new Promise((done) => {
        resolve = done;
      });
    })
    .mockRejectedValueOnce(new ApiError('http', 'DENIED', 403));
  const view = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more sites' }));
  await waitFor(() => expect(resolve).toBeDefined());
  view.changeSession({ ...session, accessToken: 'token-b' });
  expect(screen.queryByRole('option', { name: 'SITE-1 · Worksite 1' })).toBeNull();
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve({ items: [site(21)], total: 21 }));
  await screen.findByRole('button', { name: 'Retry loading sites' });
  expect(screen.queryByRole('option', { name: 'SITE-21 · Worksite 21' })).toBeNull();
  expect(
    JSON.stringify(
      queries
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey),
    ),
  ).not.toContain('token-');
});

it('deduplicates overlapping pages and excludes wrong-Site cameras before rendering options or chips', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
    .mockResolvedValueOnce({
      items: [camera(1), ...cameras.slice(1, 19), camera(20, 'foreign-site')],
      total: 22,
    })
    .mockResolvedValueOnce({ items: [camera(1), camera(21)], total: 22 });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more cameras' }));
  await screen.findByRole('option', { name: 'CAM-21 · Camera 21' });
  expect(screen.getAllByRole('option', { name: 'CAM-1 · Camera 1' })).toHaveLength(1);
  expect(screen.queryByRole('option', { name: 'CAM-20 · Camera 20' })).toBeNull();
  expect(screen.queryByTestId('camera-chip-foreign-site-cam-20')).toBeNull();
});

it.each([
  { items: [], total: 21 },
  { items: [site(21)], total: 21.5 },
])(
  'rejects invalid/non-progressing Site pages while retaining prior authorized options',
  async (badPage) => {
    vi.mocked(SmartSiteManagementClient.prototype.listSites)
      .mockResolvedValueOnce({ items: sites, total: 21 })
      .mockResolvedValueOnce(badPage);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more sites' }));
    await screen.findByRole('button', { name: 'Retry loading more sites' });
    expect(screen.queryByRole('option', { name: 'SITE-21 · Worksite 21' })).toBeNull();
  },
);

it('does not duplicate next-page requests when clicked twice in the same turn', async () => {
  let resolve!: (value: { items: SiteResponse[]; total: number }) => void;
  const list = vi
    .mocked(SmartSiteManagementClient.prototype.listSites)
    .mockResolvedValueOnce({ items: sites, total: 21 })
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
  mount();
  const more = await screen.findByRole('button', { name: 'Load more sites' });
  act(() => {
    fireEvent.click(more);
    fireEvent.click(more);
  });
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  await act(async () => resolve({ items: [site(21)], total: 21 }));
});

it('does not show stale options or a false empty list while initial metadata is pending', async () => {
  let resolve!: (value: { items: SiteResponse[]; total: number }) => void;
  vi.mocked(SmartSiteManagementClient.prototype.listSites).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  mount();
  await within(screen.getByRole('region', { name: 'Monitoring scope' })).findByText(
    'Loading sites…',
  );
  expect(screen.queryByText(/No authorized sites/)).toBeNull();
  await act(async () => resolve({ items: [], total: 0 }));
  await within(screen.getByRole('region', { name: 'Monitoring scope' })).findByText(
    /No authorized sites/,
  );
});

it.each(['sites', 'cameras'])(
  'shows the latest %s page total rather than a stale first-page total',
  async (kind) => {
    if (kind === 'sites')
      vi.mocked(SmartSiteManagementClient.prototype.listSites)
        .mockResolvedValueOnce({ items: sites, total: 25 })
        .mockResolvedValueOnce({ items: [site(21)], total: 21 });
    else
      vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
        .mockResolvedValueOnce({ items: cameras, total: 25 })
        .mockResolvedValueOnce({ items: [camera(21)], total: 21 });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: `Load more ${kind}` }));
    await screen.findByRole('option', {
      name: kind === 'sites' ? 'SITE-21 · Worksite 21' : 'CAM-21 · Camera 21',
    });
    expect(screen.getByText('(21/21 loaded)')).toBeTruthy();
  },
);

it('does not claim an empty authorized Site list when the controlled session is absent', async () => {
  const view = mount();
  await screen.findByRole('option', { name: 'SITE-1 · Worksite 1' });
  view.changeSession(null);
  expect(screen.queryByText(/No authorized sites/)).toBeNull();
});

it('closes and discards a Zone draft when a base refresh changes the selected Site', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listSites)
    .mockResolvedValueOnce({ items: [site(1)], total: 1 })
    .mockResolvedValueOnce({ items: [site(2)], total: 1 });
  mount(siteManagerSession);
  await screen.findByRole('option', { name: 'SITE-1 · Worksite 1' });
  fireEvent.click(screen.getByRole('button', { name: 'Configure PPE by Zone' }));
  const input = await screen.findByRole('textbox', { name: /Zone Name/i });
  fireEvent.change(input, { target: { value: 'Old Site draft' } });
  await act(async () => {
    await queries.invalidateQueries({ predicate: (q) => q.queryKey.includes('sites') });
  });
  await waitFor(() => expect(screen.queryByRole('textbox', { name: /Zone Name/i })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Configure PPE by Zone' }));
  expect(
    ((await screen.findByRole('textbox', { name: /Zone Name/i })) as HTMLInputElement).value,
  ).toBe('');
});

it('does not invent a Global Administrator restriction for a Site metadata 403', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listSites).mockRejectedValueOnce(
    new ApiError('http', 'SECRET', 403),
  );
  mount();
  await screen.findByRole('button', { name: 'Retry loading sites' });
  expect(screen.queryByText(/Global Administrator privileges are required/)).toBeNull();
});

it('distinguishes pending camera metadata from a successfully empty authorized page', async () => {
  let resolve!: (value: { items: CameraResponse[]; total: number }) => void;
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  mount();
  await within(screen.getByRole('region', { name: 'Monitoring scope' })).findByText(
    'Loading cameras…',
  );
  expect(screen.queryByText('No cameras available in this site scope.')).toBeNull();
  await act(async () => resolve({ items: [], total: 0 }));
  const emptyStatus = await within(
    screen.getByRole('region', { name: 'Monitoring scope' }),
  ).findByText('No cameras available in this site scope.');
  expect(emptyStatus.closest('[role="status"][aria-live="polite"]')).toBeTruthy();
  expect((screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement).disabled).toBe(
    true,
  );
  expect(SmartSiteManagementClient.prototype.getCameraPreview).not.toHaveBeenCalled();
});

it('explains filtered partial camera pages and keeps loading possible before declaring no cameras', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
    .mockResolvedValueOnce({
      items: Array.from({ length: 20 }, (_, n) => camera(n + 1, 'foreign-site')),
      total: 21,
    })
    .mockResolvedValueOnce({ items: [camera(21)], total: 21 });
  mount();
  const partialStatus = await within(
    screen.getByRole('region', { name: 'Monitoring scope' }),
  ).findByText('No cameras from this site loaded yet. More camera pages are available.');
  expect(partialStatus.closest('[role="status"][aria-live="polite"]')).toBeTruthy();
  expect(screen.queryByText('No cameras available in this site scope.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Load more cameras' }));
  await screen.findByRole('option', { name: 'CAM-21 · Camera 21' });
  expect(
    screen.queryByText('No cameras from this site loaded yet. More camera pages are available.'),
  ).toBeNull();
});

it.each([403, 503])(
  'does not misreport camera metadata error %i as successful emptiness',
  async (status) => {
    vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mockRejectedValueOnce(
      new ApiError('http', 'SECRET', status),
    );
    mount();
    await screen.findByRole('button', { name: 'Retry loading cameras' });
    expect(screen.queryByText('No cameras available in this site scope.')).toBeNull();
    expect(
      screen.queryByText('No cameras from this site loaded yet. More camera pages are available.'),
    ).toBeNull();
  },
);

it('clears successful camera emptiness immediately when switching to a pending Site scope', async () => {
  let resolve!: (value: { items: CameraResponse[]; total: number }) => void;
  vi.mocked(SmartSiteManagementClient.prototype.listSites).mockResolvedValue({
    items: [site(1), site(2)],
    total: 2,
  });
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
    .mockResolvedValueOnce({ items: [], total: 0 })
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
  mount();
  await within(screen.getByRole('region', { name: 'Monitoring scope' })).findByText(
    'No cameras available in this site scope.',
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Site' }), { target: { value: 'site-2' } });
  expect(screen.queryByText('No cameras available in this site scope.')).toBeNull();
  await within(screen.getByRole('region', { name: 'Monitoring scope' })).findByText(
    'Loading cameras…',
  );
  await act(async () => resolve({ items: [camera(1, 'site-2')], total: 1 }));
  await screen.findByTestId('camera-chip-site-2-cam-1');
});

it('does not show stale successful emptiness during a base camera refresh', async () => {
  let resolve!: (value: { items: CameraResponse[]; total: number }) => void;
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
    .mockResolvedValueOnce({ items: [], total: 0 })
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
  mount();
  await within(screen.getByRole('region', { name: 'Monitoring scope' })).findByText(
    'No cameras available in this site scope.',
  );
  let pending!: Promise<void>;
  act(() => {
    pending = queries.invalidateQueries({ predicate: (q) => q.queryKey.includes('cameras') });
  });
  await waitFor(() => expect(resolve).toBeDefined());
  expect(screen.queryByText('No cameras available in this site scope.')).toBeNull();
  expect(
    await within(screen.getByRole('region', { name: 'Monitoring scope' })).findByText(
      'Refreshing cameras…',
    ),
  ).toBeTruthy();
  await act(async () => {
    resolve({ items: [camera(1)], total: 1 });
    await pending;
  });
  await screen.findByTestId('camera-chip-site-1-cam-1');
});

it('hides a previously empty Site status during base metadata refresh', async () => {
  let resolve!: (value: { items: SiteResponse[]; total: number }) => void;
  vi.mocked(SmartSiteManagementClient.prototype.listSites)
    .mockResolvedValueOnce({ items: [], total: 0 })
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
  mount();
  await within(screen.getByRole('region', { name: 'Monitoring scope' })).findByText(
    /No authorized sites/,
  );
  let pending!: Promise<void>;
  act(() => {
    pending = queries.invalidateQueries({ predicate: (q) => q.queryKey.includes('sites') });
  });
  await waitFor(() => expect(resolve).toBeDefined());
  expect(screen.queryByText(/No authorized sites/)).toBeNull();
  await act(async () => {
    resolve({ items: [site(1)], total: 1 });
    await pending;
  });
  await screen.findByRole('option', { name: 'SITE-1 · Worksite 1' });
});
