// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { ContractorZoneSetup } from './components/ContractorZoneSetup';

const options = {
  canReviewAssignments: true,
  canGrantContractorZones: true,
  canGrantWorkerZones: false,
  participations: [
    {
      id: 'participation',
      contractorId: 'contractor',
      name: 'Contractor',
      validFrom: '2026-01-01T00:00:00Z',
      validUntil: null,
    },
  ],
  zones: [{ id: 'zone', name: 'Work area' }],
  workers: [],
  assignments: [],
  contractorPermissions: [],
  workerPermissions: [],
};
let cache: QueryClient;
afterEach(() => {
  cleanup();
  cache?.clear();
  vi.restoreAllMocks();
});
function mount() {
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <ContractorZoneSetup
        apiUrl="https://api.example.test"
        token="manager-token"
        siteId="site"
        userId="manager"
      />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

it('shows unavailable data and supports Retry without an empty permission form', async () => {
  const read = vi
    .spyOn(SmartSiteManagementClient.prototype, 'accessSetup')
    .mockRejectedValueOnce(new Error('Site data unavailable'))
    .mockResolvedValue(options);
  const user = mount();
  await screen.findByRole('alert');
  expect(screen.queryByLabelText('Contractor')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByLabelText('Contractor');
  expect(read).toHaveBeenLastCalledWith('manager-token', 'site');
});

it('denied scope does not expose the assignment form', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'accessSetup').mockResolvedValue({
    ...options,
    canGrantContractorZones: false,
  });
  mount();
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Assign Contractor Zone' })).toBeNull();
});

it('retains the request ID when a failed permission assignment is retried', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'accessSetup').mockResolvedValue(options);
  const grant = vi
    .spyOn(SmartSiteManagementClient.prototype, 'grantContractorZoneDates')
    .mockRejectedValueOnce(new Error('Connection unavailable'))
    .mockResolvedValue({ id: 'permission' });
  const user = mount();
  await screen.findByLabelText('Contractor');
  await user.selectOptions(screen.getByLabelText('Contractor'), 'participation');
  await user.selectOptions(screen.getByLabelText('Zone'), 'zone');
  await user.click(screen.getByRole('button', { name: 'Assign Contractor Zone' }));
  await screen.findByText('Connection unavailable');
  await user.click(screen.getByRole('button', { name: 'Assign Contractor Zone' }));
  await waitFor(() => expect(grant).toHaveBeenCalledTimes(2));
  expect(grant.mock.calls[0]?.[2].requestId).toBe(grant.mock.calls[1]?.[2].requestId);
  await screen.findByText('Contractor Zone assigned.');
});

it('only accepts calendar dates, includes the entire selected end day and permits a single-day assignment', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'accessSetup').mockResolvedValue(options);
  const grant = vi
    .spyOn(SmartSiteManagementClient.prototype, 'grantContractorZoneDates')
    .mockResolvedValue({ id: 'permission' });
  const user = mount();
  await screen.findByLabelText('Start date');
  expect(screen.getByLabelText('Start date').textContent).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  expect(screen.getByLabelText('End date').textContent).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  await user.selectOptions(screen.getByLabelText('Contractor'), 'participation');
  await user.selectOptions(screen.getByLabelText('Zone'), 'zone');
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await user.click(screen.getByRole('button', { name: 'Assign Contractor Zone' }));
  await waitFor(() =>
    expect(grant).toHaveBeenCalledWith('manager-token', 'site', {
      requestId: expect.any(String),
      siteContractorId: 'participation',
      zoneId: 'zone',
      startDate: iso,
      endDate: iso,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  );
});
