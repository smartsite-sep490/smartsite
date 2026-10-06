// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { WorkforceScheduleTab } from '../components/WorkforceScheduleTab';

let queries: QueryClient;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2030-01-01T10:00:00Z'));
  for (const method of ['listShifts', 'listWorkers', 'listCoworkers'] as const) {
    vi.spyOn(SmartSiteManagementClient.prototype, method).mockResolvedValue({
      items: [],
      total: 0,
    });
  }
  vi.spyOn(SmartSiteManagementClient.prototype, 'listShiftRequests').mockResolvedValue({
    items: [],
    total: 0,
    pendingCount: 0,
    incomingCount: 0,
    pendingScheduleIds: [],
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'getSite').mockImplementation(
    async (_token, id) => ({
      id,
      code: id,
      name: id === 'site-1' ? 'Demo Construction Site' : 'Thu Duc Site',
      createdAt: '2030-01-01T00:00:00Z',
    }),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'listWorkerSchedules').mockImplementation(
    async (_token, siteId) => ({
      items: ['morning', 'evening'].map((shiftId) => ({
        id: `${siteId}-${shiftId}`,
        siteId,
        workerId: 'worker-a',
        shiftId,
        scheduleVersionId: 'version-1',
        workDate: '2030-01-01',
        isActive: true,
        createdAt: '2030-01-01T00:00:00Z',
      })),
      total: 2,
    }),
  );
});

afterEach(() => {
  cleanup();
  queries?.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mount(siteId = 'site-1') {
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (id: string) => (
    <QueryClientProvider client={queries}>
      <MemoryRouter>
        <WorkforceScheduleTab
          apiUrl="https://api.example.test"
          siteId={id}
          token="synthetic-token"
          currentUserId="user-a"
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(view(siteId));
  return { changeSite: (id: string) => result.rerender(view(id)) };
}

it.each([
  ['site-1', 'Demo Construction Site', 'timetable'],
  ['site-1', 'Demo Construction Site', 'list'],
  ['site-2', 'Thu Duc Site', 'timetable'],
  ['site-2', 'Thu Duc Site', 'list'],
])(
  'shows the schedule Site %s (%s) in %s view and shares its lookup across shifts',
  async (id, name, mode) => {
    mount(id);
    if (mode === 'list') fireEvent.click(await screen.findByRole('button', { name: 'List' }));
    const labels = await screen.findAllByText(name);
    expect(labels).toHaveLength(2);
    expect(labels.every((label) => label.getAttribute('title') === name)).toBe(true);
    expect(screen.queryByText('Main Construction Area')).toBeNull();
    expect(SmartSiteManagementClient.prototype.getSite).toHaveBeenCalledExactlyOnceWith(
      'synthetic-token',
      id,
    );
  },
);

it('does not reuse the previous Site name when switching Sites', async () => {
  const { changeSite } = mount();
  await screen.findAllByText('Demo Construction Site');
  changeSite('site-2');
  await screen.findAllByText('Thu Duc Site');
  expect(screen.queryByText('Demo Construction Site')).toBeNull();
});

it('lets keyboard users switch views using the summary cards', async () => {
  const user = userEvent.setup();
  mount();
  const requests = await screen.findByRole('button', { name: /Shift Requests/ });
  requests.focus();
  await user.keyboard('{Enter}');
  expect(requests.getAttribute('aria-pressed')).toBe('true');
  const schedule = screen.getByRole('button', { name: /Upcoming shifts/ });
  schedule.focus();
  await user.keyboard(' ');
  expect(schedule.getAttribute('aria-pressed')).toBe('true');
  expect(requests.getAttribute('aria-pressed')).toBe('false');
});

it('shows loading until the Site lookup finishes', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.getSite).mockImplementation(
    () => new Promise(() => {}),
  );
  mount();
  expect(await screen.findAllByText('Loading site...')).toHaveLength(2);
});

it.each(['network', 403] as const)(
  'shows unavailable with retry when the Site lookup fails (%s)',
  async (status) => {
    const siteLookup = vi.mocked(SmartSiteManagementClient.prototype.getSite);
    siteLookup.mockRejectedValueOnce(
      new ApiError(
        status === 'network' ? 'network' : 'http',
        'Synthetic private detail',
        status === 'network' ? undefined : status,
      ),
    );
    mount();
    expect(await screen.findAllByText('Site name unavailable')).toHaveLength(2);
    expect(screen.queryByText('Synthetic private detail')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry loading site name' })[0]!);
    expect(await screen.findAllByText('Demo Construction Site')).toHaveLength(2);
  },
);

it('does not label a shift with metadata for a different Site', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.getSite).mockResolvedValue({
    id: 'site-2',
    code: 'OTHER',
    name: 'Wrong Site',
    createdAt: '2030-01-01T00:00:00Z',
  });
  mount();
  expect(await screen.findAllByText('Site name unavailable')).toHaveLength(2);
  expect(screen.queryByText('Wrong Site')).toBeNull();
});
