// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { DashboardView } from './DashboardView';

vi.mock('../../features/auth/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/auth/auth-session')>()),
  useAuth: () => ({ accessToken: 'manager-token' }),
  useCurrentUser: () => ({
    data: { id: 'manager', roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'site-a' }] },
  }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function renderDashboard() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cache}>
      <DashboardView apiUrl="https://api.example.test" onNavigate={vi.fn()} />
    </QueryClientProvider>,
  );
  return cache;
}
function sites() {
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: ['a', 'b'].map((id) => ({
      id: `site-${id}`,
      code: id,
      name: `Site ${id}`,
      createdAt: '2026-01-01T00:00:00Z',
    })),
    total: 2,
  });
}
it('manager Dashboard displays API counts, scopes Sites and opens dated contractor/team/Zone details', async () => {
  sites();
  const overview = vi
    .spyOn(SmartSiteManagementClient.prototype, 'managerOverview')
    .mockResolvedValue({
      site: { id: 'site-a', code: 'A', name: 'Site a' },
      contractorCount: 24,
      zoneCount: 3,
      teamCount: 5,
      workerCount: 42,
      contractors: {
        total: 24,
        items: [{ id: 'contractor-a', code: 'CTR-A', name: 'Alpha', teamCount: 2, workerCount: 8 }],
      },
    });
  const detail = vi
    .spyOn(SmartSiteManagementClient.prototype, 'managerContractorDetail')
    .mockImplementation(async (_token, _site, _contractor, query) => ({
      id: 'contractor-a',
      code: 'CTR-A',
      name: 'Alpha',
      ...query,
      teamCount: 2,
      workerCount: 8,
      teams: [
        {
          id: 'team-a',
          name: 'Crew A',
          workerCount: 4,
          zoneAssignments: [
            {
              id: 'team-zone-a',
              zoneId: 'zone-b',
              name: 'Team work area',
              code: 'ZONE-B',
              validFrom: '2026-01-01T00:00:00Z',
              validUntil: '2027-01-01T00:00:00Z',
            },
          ],
        },
        { id: 'team-b', name: 'Crew B', workerCount: 4, zoneAssignments: [] },
      ],
      zones: [
        {
          id: 'zone-a',
          code: 'ZONE-A',
          name: 'Tower A',
          validFrom: '2026-01-01T00:00:00Z',
          validUntil: '2027-01-01T00:00:00Z',
        },
      ],
      scheduledTeams: [
        {
          id: 'team-a',
          name: 'Crew A',
          workerCount: 3,
          shifts: [
            {
              id: 'shift-a',
              name: 'Morning',
              startsAt: `${query.date}T01:00:00Z`,
              endsAt: `${query.date}T10:00:00Z`,
              timezone: 'Asia/Ho_Chi_Minh',
            },
          ],
        },
      ],
      scheduledWorkerCount: 4,
      scheduledWorkersWithoutTeam: 1,
    }));
  const cache = renderDashboard(),
    user = userEvent.setup();
  await screen.findByText('24', { selector: 'dd' });
  expect(screen.getByText('3', { selector: 'dd' })).toBeTruthy();
  expect(screen.getByText('42', { selector: 'dd' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'Site b' })).toBeNull();
  expect(overview).toHaveBeenCalledWith('manager-token', 'site-a', { offset: 0, limit: 20 });
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() =>
    expect(overview).toHaveBeenCalledWith('manager-token', 'site-a', { offset: 20, limit: 20 }),
  );
  await user.click(screen.getByRole('button', { name: 'View details for Alpha' }));
  const dialog = within(await screen.findByRole('dialog'));
  await dialog.findByText('Tower A');
  expect(dialog.getByText('Team work area')).toBeTruthy();
  expect(dialog.getByText('No team Zone assignments on this date.')).toBeTruthy();
  expect(dialog.queryByText(/Team Zone data unavailable/)).toBeNull();
  expect(dialog.getByText(/3 scheduled workers/)).toBeTruthy();
  expect(dialog.getByText(/1 scheduled workers have no active team/)).toBeTruthy();
  await user.click(dialog.getByLabelText('Work date'));
  const now = new Date(),
    day = now.getDate() === 1 ? 2 : 1;
  const month = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(now);
  await user.click(
    screen.getByRole('button', {
      name: new RegExp(`${month} ${day}(?:st|nd|rd|th)?, ${now.getFullYear()}`),
    }),
  );
  await waitFor(() =>
    expect(detail).toHaveBeenCalledWith('manager-token', 'site-a', 'contractor-a', {
      date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      timezone: expect.any(String),
    }),
  );
  await user.click(dialog.getByRole('button', { name: 'Close dialog' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  cache.clear();
});
it('failed API shows unavailable and Retry without reporting zero contractors', async () => {
  sites();
  vi.spyOn(SmartSiteManagementClient.prototype, 'managerOverview')
    .mockRejectedValueOnce(new Error('Access denied'))
    .mockResolvedValue({
      site: { id: 'site-a', code: 'A', name: 'Site a' },
      contractorCount: 0,
      zoneCount: 0,
      teamCount: 0,
      workerCount: 0,
      contractors: { items: [], total: 0 },
    });
  const cache = renderDashboard();
  await screen.findByRole('alert');
  expect(screen.queryByText('0', { selector: 'dd' })).toBeNull();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('No active contractors on this Site.');
  cache.clear();
});
