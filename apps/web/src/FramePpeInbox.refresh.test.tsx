// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, type LoginResponse } from '@smartsite/api-client';
import { FramePpeInbox } from './FramePpeInbox';
import i18n from './i18n';

const { list, sites } = vi.hoisted(() => ({ list: vi.fn(), sites: vi.fn() }));
vi.mock('./features/auth/auth-session', () => ({
  useManagementClient: () => ({ listSafetyFrameInbox: list, listSites: sites }),
}));

const session = {
  accessToken: 'test-only',
  user: {
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-1' }],
  },
} as unknown as Pick<LoginResponse, 'accessToken' | 'user'>;
const page = (count: number) => ({ items: [], total: 0, unreadCount: count });
let client: QueryClient;

async function mount(initialPath = '/', currentSession = session) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <FramePpeInbox apiUrl="http://test.invalid" session={currentSession} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

beforeEach(async () => {
  sites.mockReset().mockResolvedValue({ items: [], total: 0 });
  await i18n.changeLanguage('vi');
});

afterEach(() => {
  cleanup();
  client?.clear();
  vi.useRealTimers();
  list.mockReset();
});

it('updates unread count while the Inbox stays open without a page reload', async () => {
  vi.useFakeTimers();
  list.mockResolvedValueOnce(page(1)).mockResolvedValue(page(2));
  await mount();
  expect(screen.getByText('1 khung chưa đọc')).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10010);
  });
  expect(screen.getByText('2 khung chưa đọc')).toBeTruthy();
  expect(list).toHaveBeenCalledTimes(2);
});

it('switches the frame Inbox between assigned sites and clears the previous exact frame', async () => {
  vi.useFakeTimers();
  const multiSite = {
    ...session,
    user: {
      ...session.user,
      roleAssignments: [
        { role: 'SAFETY_OFFICER', siteId: 'site-1' },
        { role: 'SAFETY_OFFICER', siteId: 'site-2' },
      ],
    },
  } as typeof session;
  sites.mockResolvedValue({
    items: [
      { id: 'site-1', name: 'North site' },
      { id: 'site-2', name: 'South site' },
      { id: 'outside', name: 'Outside scope' },
    ],
    total: 3,
  });
  list.mockResolvedValue(page(0));
  await mount(
    '/incidents?tab=ppe-frames&siteId=site-1&frameKey=event:old&recipientId=old',
    multiSite,
  );
  expect(screen.getByRole('link', { name: 'Xem tất cả khung' }).getAttribute('href')).toBe(
    '/incidents?tab=ppe-frames&siteId=site-1',
  );
  const select = screen.getByRole('combobox', { name: 'Công trường' });
  expect(screen.queryByRole('option', { name: 'Outside scope' })).toBeNull();
  fireEvent.change(select, { target: { value: 'site-2' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(list.mock.calls.at(-1)![1]).toMatchObject({ siteId: 'site-2', frameKey: undefined });
  expect(screen.queryByRole('link', { name: 'Xem tất cả khung' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Công trường' }), {
    target: { value: '' },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(list.mock.calls.at(-1)![1]).toMatchObject({ siteId: undefined, frameKey: undefined });
});

it('lets the operator request a fresh Inbox immediately', async () => {
  vi.useFakeTimers();
  list.mockResolvedValueOnce(page(1)).mockResolvedValue(page(3));
  await mount();
  fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByText('3 khung chưa đọc')).toBeTruthy();
});

it('loads site names by raw offset and retries the same failed metadata page', async () => {
  vi.useFakeTimers();
  list.mockResolvedValue(page(0));
  sites
    .mockResolvedValueOnce({
      items: [
        { id: 'site-1', name: 'North site' },
        ...Array.from({ length: 19 }, (_, n) => ({ id: 'outside-' + n, name: 'Outside scope' })),
      ],
      total: 21,
    })
    .mockRejectedValueOnce(new Error('Temporary failure'))
    .mockResolvedValue({ items: [{ id: 'site-1', name: 'North renamed' }], total: 21 });
  await mount();
  fireEvent.click(screen.getByRole('button', { name: 'Tải thêm tên công trường' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByRole('option', { name: 'North site' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(sites.mock.calls.map((call) => call[1].offset)).toEqual([0, 20, 20]);
  expect(screen.getAllByRole('option', { name: 'North renamed' })).toHaveLength(1);
  expect(screen.queryByRole('option', { name: 'Outside scope' })).toBeNull();
});

it('hides frames from another assigned site when one site is selected', async () => {
  vi.useFakeTimers();
  const multiSite = {
    ...session,
    user: {
      ...session.user,
      roleAssignments: [
        { role: 'SAFETY_OFFICER', siteId: 'site-1' },
        { role: 'SAFETY_OFFICER', siteId: 'site-2' },
      ],
    },
  } as typeof session;
  list.mockResolvedValue({
    total: 1,
    unreadCount: 1,
    items: [
      {
        siteId: 'site-2',
        cameraId: 'camera',
        frameKey: 'event:other',
        siteName: 'Wrong site frame',
        cameraName: 'Other camera',
        capturedAt: '2026-11-13T00:00:00Z',
        unread: true,
        findingCount: 1,
        cases: [],
      },
    ],
  });
  await mount('/incidents?tab=ppe-frames&siteId=site-1', multiSite);
  expect(screen.queryByText(/Wrong site frame/)).toBeNull();
});

it('removes cached site names when metadata access is revoked', async () => {
  vi.useFakeTimers();
  list.mockResolvedValue(page(0));
  sites
    .mockResolvedValueOnce({ items: [{ id: 'site-1', name: 'North site' }], total: 1 })
    .mockRejectedValue(new ApiError('http', 'Forbidden', 403));
  await mount();
  expect(screen.getByRole('option', { name: 'North site' })).toBeTruthy();
  await act(async () => {
    await client.refetchQueries({ queryKey: ['frame-inbox-sites'] });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.queryByRole('option', { name: 'North site' })).toBeNull();
  expect(
    (screen.getByRole('combobox', { name: 'Công trường' }) as HTMLSelectElement).disabled,
  ).toBe(true);
});

it('clears old counts and stops polling when access is revoked', async () => {
  vi.useFakeTimers();
  list.mockResolvedValueOnce(page(1)).mockRejectedValue(new ApiError('http', 'Forbidden', 403));
  await mount();
  expect(screen.getByText('1 khung chưa đọc')).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10010);
  });
  expect(screen.queryByText('1 khung chưa đọc')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Không có quyền');
  const requests = list.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(list).toHaveBeenCalledTimes(requests);
});

it('opens an exact Bell target directly and sends its Site and frame filters', async () => {
  vi.useFakeTimers();
  const frameKey = 'event:target-frame';
  list.mockResolvedValue({
    total: 1,
    unreadCount: 1,
    items: [
      {
        siteId: 'site-1',
        cameraId: 'camera-1',
        frameKey,
        siteName: 'Site A',
        cameraName: 'Camera A',
        capturedAt: '2026-11-12T00:00:00Z',
        unread: true,
        findingCount: 1,
        cases: [
          {
            recipientId: 'case-1',
            episodeId: 'episode-1',
            findingCount: 1,
            contentRevision: 1,
            unread: true,
            source: null,
            zoneEntries: [],
          },
          {
            recipientId: 'case-2',
            episodeId: 'episode-2',
            findingCount: 0,
            contentRevision: 1,
            unread: true,
            source: null,
            zoneEntries: [
              { requestId: 'denied', status: 'DENIED' },
              { requestId: 'pending', status: 'PENDING' },
              { requestId: 'later', status: 'DENIED', laterFrame: true },
            ],
          },
        ],
      },
    ],
  });
  await mount(
    '/incidents?' + new URLSearchParams({ tab: 'ppe-frames', siteId: 'site-1', frameKey }),
  );
  expect(list.mock.calls[0]![1]).toMatchObject({ siteId: 'site-1', frameKey });
  expect(screen.getByRole('link', { name: 'Mở hồ sơ người 1' })).toBeTruthy();
  expect(
    screen
      .getByRole('button', {
        name: /2 người cần xem xét · 1 phát hiện PPE · 1 lượt vào vùng không được phép/,
      })
      .getAttribute('aria-expanded'),
  ).toBe('true');
  expect(screen.queryByText(/0 phát hiện PPE/)).toBeNull();
  expect(screen.getByText('Vùng hạn chế (khung sau) · Không được phép')).toBeTruthy();
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  expect(screen.getByRole('region', { name: 'Frame inbox' })).toBeTruthy();
  expect(
    screen
      .getByRole('button', {
        name: /2 people to review · 1 PPE finding · 1 denied Zone entry/,
      })
      .getAttribute('aria-expanded'),
  ).toBe('true');
  expect(screen.getByText('1 Zone denial in a later frame')).toBeTruthy();
  expect(screen.getByText('Restricted Zone (later frame) · Denied')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open case for person 1' })).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: 'Unread only' })).toBeTruthy();
  expect(screen.getByText('1 unread frame')).toBeTruthy();
  expect(list).toHaveBeenCalledTimes(1);
});

it('sends selected UUID cameraId to Backend and clears frameKey when switching or clearing Camera filter', async () => {
  vi.useFakeTimers();
  const camA = '22222222-2222-4222-8222-222222222221';
  const camB = '22222222-2222-4222-8222-222222222222';
  list.mockImplementation(async (_token: string, options?: { cameraId?: string }) => ({
    total: options?.cameraId ? 1 : 2,
    unreadCount: 1,
    items: [
      {
        siteId: 'site-1',
        cameraId: camA,
        frameKey: 'event:frame-cam-a',
        siteName: 'North site',
        cameraName: 'Gate Camera',
        capturedAt: '2026-11-12T00:00:00Z',
        unread: true,
        findingCount: 1,
        cases: [],
      },
      {
        siteId: 'site-1',
        cameraId: camB,
        frameKey: 'event:frame-cam-b',
        siteName: 'North site',
        cameraName: 'Yard Camera',
        capturedAt: '2026-11-12T00:01:00Z',
        unread: false,
        findingCount: 1,
        cases: [],
      },
    ].filter((f) => !options?.cameraId || f.cameraId === options.cameraId),
  }));

  await mount('/incidents?tab=ppe-frames&siteId=site-1&frameKey=event:frame-cam-a');
  expect(list.mock.calls.at(-1)![1]).toMatchObject({
    siteId: 'site-1',
    cameraId: undefined,
    frameKey: 'event:frame-cam-a',
  });

  fireEvent.change(screen.getByRole('combobox', { name: 'Camera' }), { target: { value: camB } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(list.mock.calls.at(-1)![1]).toMatchObject({
    siteId: 'site-1',
    cameraId: camB,
    frameKey: undefined,
  });

  fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc camera' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(list.mock.calls.at(-1)![1]).toMatchObject({
    siteId: 'site-1',
    cameraId: undefined,
    frameKey: undefined,
  });
});
