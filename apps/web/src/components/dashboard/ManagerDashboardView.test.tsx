// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { DashboardView } from './DashboardView';

const defaultRoleAssignments: { role: 'SITE_MANAGER'; siteId: string }[] = [
  { role: 'SITE_MANAGER', siteId: 'site-a' },
];
let currentRoleAssignments = defaultRoleAssignments;

vi.mock('../../features/auth/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/auth/auth-session')>()),
  useAuth: () => ({ accessToken: 'manager-token' }),
  useCurrentUser: () => ({
    data: { id: 'manager', roleAssignments: currentRoleAssignments },
  }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  currentRoleAssignments = defaultRoleAssignments;
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
  expect(screen.queryByText('CTR-A')).toBeNull();
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
  expect(dialog.queryByText('CTR-A')).toBeNull();
  expect(dialog.getByText('Team work area')).toBeTruthy();
  expect(dialog.getAllByText('01/01/2026 – 01/01/2027')).toHaveLength(2);
  expect(dialog.getByText(/\d{2}:\d{2}/)).toBeTruthy();
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

it('surfaces Manager operational task panel with scoped links and clears previous site queue on site switch', async () => {
  currentRoleAssignments = [
    { role: 'SITE_MANAGER', siteId: 'site-a' },
    { role: 'SITE_MANAGER', siteId: 'site-b' },
  ];
  sites();
  vi.spyOn(SmartSiteManagementClient.prototype, 'managerOverview').mockImplementation(
    async (_token, siteId) => ({
      site: { id: siteId, code: siteId.toUpperCase(), name: `Site ${siteId}` },
      contractorCount: 2,
      zoneCount: 4,
      teamCount: 3,
      workerCount: 15,
      contractors: {
        total: 1,
        items: [{ id: 'contractor-a', code: 'CTR-A', name: 'Alpha', teamCount: 1, workerCount: 5 }],
      },
    }),
  );

  let resolveSiteBRequests!: (value: { items: never[]; total: number }) => void;
  const siteBRequestsPromise = new Promise<{ items: never[]; total: number }>((resolve) => {
    resolveSiteBRequests = resolve;
  });
  vi.spyOn(
    SmartSiteManagementClient.prototype,
    'listSafetyIdentificationRequests',
  ).mockImplementation((_token, siteId) => {
    if (siteId === 'site-a') {
      return Promise.resolve({
        items: [
          {
            id: '11111111-2222-3333-4444-555555555555',
            siteId: 'site-a',
            episodeId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            subject: { kind: 'TRACKED', segmentId: 'seg-1', scopeSha256: 'a'.repeat(64) },
            assignedTo: 'manager',
            requestedBy: 'officer',
            reason: 'Pending vest check at Site A',
            status: 'OPEN',
            version: 1,
            dueAt: null,
            evidenceRefs: ['ev-1'],
            evidenceAvailability: { status: 'AVAILABLE', reason: null },
            result: null,
            createdAt: '2026-11-17T01:00:00Z',
            updatedAt: '2026-11-17T01:00:00Z',
          },
        ],
        total: 2,
      });
    }
    return siteBRequestsPromise;
  });

  vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({
    items: [],
    total: 0,
  });

  const cache = renderDashboard();
  const user = userEvent.setup();

  await screen.findByText('Pending vest check at Site A');
  expect(screen.getByText(/2 open requests/i)).toBeTruthy();
  expect(screen.getByText(/No cameras are registered for this site yet/i)).toBeTruthy();
  expect(screen.getByText('15', { selector: 'dd' })).toBeTruthy();
  expect(
    screen.getByRole('link', { name: /Open identification queue/i }).getAttribute('href'),
  ).toBe('/incidents?tab=identification&siteId=site-a');
  expect(screen.getByRole('link', { name: /Set up site cameras/i }).getAttribute('href')).toBe(
    '/camera-setup?siteId=site-a',
  );

  // Switch Managed Site from Site a to Site b -> previous site's queue and counts clear immediately
  await user.selectOptions(screen.getByLabelText('Managed Site'), 'site-b');
  expect(screen.queryByText('Pending vest check at Site A')).toBeNull();
  expect(screen.queryByText(/2 open requests/i)).toBeNull();

  await waitFor(() =>
    expect(screen.getByRole('link', { name: /Set up site cameras/i }).getAttribute('href')).toBe(
      '/camera-setup?siteId=site-b',
    ),
  );
  resolveSiteBRequests({ items: [], total: 0 });
  await screen.findByText(/No open identification requests/i);
  expect(
    screen.getByRole('link', { name: /Open identification queue/i }).getAttribute('href'),
  ).toBe('/incidents?tab=identification&siteId=site-b');
  cache.clear();
});
