// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { SiteSetupView } from './components/SiteSetupView';

vi.mock('../../features/auth/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/auth/auth-session')>()),
  useAuth: () => ({ accessToken: 'manager-token' }),
  useCurrentUser: () => ({
    data: {
      id: 'manager',
      username: 'manager',
      displayName: 'Manager',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'site-a' }],
    },
  }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('manager sees only their Site and can create multiple contractors and Zones without Admin actions', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: ['a', 'b'].map((id) => ({
      id: `site-${id}`,
      code: id,
      name: `Site ${id}`,
      createdAt: new Date().toISOString(),
    })),
    total: 2,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listContractors').mockResolvedValue({
    items: [],
    total: 0,
  });
  const globalUsers = vi.spyOn(SmartSiteManagementClient.prototype, 'listUsers');
  const representatives = vi
    .spyOn(SmartSiteManagementClient.prototype, 'listSiteRepresentatives')
    .mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(
    SmartSiteManagementClient.prototype,
    'listContractorRepresentativeAssignments',
  ).mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
    items: [],
    total: 0,
  });
  const createContractor = vi
    .spyOn(SmartSiteManagementClient.prototype, 'createContractor')
    .mockImplementation(async (_token, siteId, input) => ({
      id: `contractor-${input.name}`,
      siteId,
      ...input,
      code: 'CTR-GENERATED',
      isActive: true,
      createdAt: new Date().toISOString(),
    }));
  const createZone = vi
    .spyOn(SmartSiteManagementClient.prototype, 'createZone')
    .mockImplementation(async (_token, siteId, input) => ({
      id: `zone-${input.name}`,
      siteId,
      ...input,
      code: 'ZONE-GENERATED',
      configurationLocked: false,
      createdAt: new Date().toISOString(),
    }));
  vi.spyOn(SmartSiteManagementClient.prototype, 'accessSetup').mockResolvedValue({
    canReviewAssignments: true,
    canGrantContractorZones: true,
    canGrantWorkerZones: false,
    participations: [
      {
        id: 'participation-a',
        contractorId: 'contractor-a',
        name: 'Contractor A',
        validFrom: '2026-01-01T00:00:00Z',
        validUntil: null,
      },
    ],
    zones: [{ id: 'zone-a', name: 'Zone A' }],
    workers: [],
    assignments: [],
    contractorPermissions: [],
    workerPermissions: [],
  });
  const grantZone = vi
    .spyOn(SmartSiteManagementClient.prototype, 'grantContractorZoneDates')
    .mockResolvedValue({ id: 'permission-a' });
  const attendance = vi.spyOn(SmartSiteManagementClient.prototype, 'attendanceDays');
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={cache}>
      <SiteSetupView apiUrl="https://api.example.test" />
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: 'Contractor & Zone Setup' });
  await screen.findByRole('button', { name: 'New Zone' });
  expect(screen.queryByText('Site b')).toBeNull();
  expect(screen.queryByRole('button', { name: 'New Site' })).toBeNull();
  expect(
    screen.queryByRole('button', { name: /Assign Site Manager|Manage Site Managers/ }),
  ).toBeNull();
  expect(globalUsers).not.toHaveBeenCalled();
  expect(representatives).toHaveBeenCalledWith('manager-token', 'site-a', {
    offset: 0,
    limit: 100,
  });
  for (const code of ['FIRST', 'SECOND']) {
    await user.click(screen.getByRole('button', { name: 'Add Contractor' }));
    expect(screen.queryByLabelText(/Contractor Code/)).toBeNull();
    await user.type(screen.getByLabelText(/Contractor Name/), `${code} contractor`);
    await user.click(screen.getByRole('button', { name: 'Register Contractor' }));
    await waitFor(() =>
      expect(createContractor).toHaveBeenCalledWith('manager-token', 'site-a', {
        name: `${code} contractor`,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Register Contractor' })).toBeNull(),
    );
  }
  await user.click(screen.getByRole('button', { name: 'New Zone' }));
  expect(screen.queryByLabelText('Zone code')).toBeNull();
  await user.type(screen.getByLabelText('Zone name'), 'Work area');
  await user.selectOptions(screen.getByLabelText('Access policy'), 'AUTHORIZATION_REQUIRED');
  await user.click(screen.getByRole('button', { name: 'Create Zone' }));
  await waitFor(() =>
    expect(createZone).toHaveBeenCalledWith('manager-token', 'site-a', {
      name: 'Work area',
      type: 'STANDARD',
      restrictionPolicy: 'AUTHORIZATION_REQUIRED',
      requiredPpe: [],
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Contractor Zone Assignments' }));
  await screen.findByRole('heading', { name: 'Assign Zone to Contractor' });
  expect(screen.queryByText('Worker Zone permissions')).toBeNull();
  expect(screen.queryByText('Daily Work Hours')).toBeNull();
  expect(screen.queryByText('Recent attendance')).toBeNull();
  expect(screen.queryByText('Site assignments')).toBeNull();
  await user.selectOptions(screen.getByLabelText('Contractor'), 'participation-a');
  await user.selectOptions(screen.getByLabelText('Zone'), 'zone-a');
  await user.click(screen.getByRole('button', { name: 'Assign Contractor Zone' }));
  await waitFor(() =>
    expect(grantZone).toHaveBeenCalledWith(
      'manager-token',
      'site-a',
      expect.objectContaining({
        siteContractorId: 'participation-a',
        zoneId: 'zone-a',
        requestId: expect.any(String),
        startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        timezone: expect.any(String),
      }),
    ),
  );
  expect(attendance).not.toHaveBeenCalled();
  cache.clear();
});
