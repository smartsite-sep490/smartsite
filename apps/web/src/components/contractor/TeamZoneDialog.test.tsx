// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { TeamZoneDialog } from './TeamZoneDialog';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const options = {
  availableZones: [
    {
      permissionId: 'parent',
      zoneId: 'zone',
      name: 'Gạch',
      validFrom: '2026-10-12T12:00:00Z',
      validUntil: '2026-10-13T12:00:00Z',
    },
  ],
  permissions: [],
};
function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <TeamZoneDialog
        apiUrl="https://api.example.test"
        token="rep-token"
        userId="rep"
        siteId="site"
        contractorId="contractor"
        teamId="team"
        teamName="Team Gạch"
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
it('loads only granted Zones, formats dates and retains request ID through failed assignment/retry', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'teamZoneSetup').mockResolvedValue(options);
  const grant = vi
    .spyOn(SmartSiteManagementClient.prototype, 'grantTeamZone')
    .mockRejectedValueOnce(new Error('Connection unavailable'))
    .mockResolvedValue({ id: 'permission' });
  const user = mount();
  await screen.findByLabelText('Granted Zone');
  await user.selectOptions(screen.getByLabelText('Granted Zone'), 'parent');
  expect(screen.getByLabelText('Start date').textContent).toContain('12/10/2026');
  expect(screen.getByLabelText('End date').textContent).toContain('13/10/2026');
  await user.click(screen.getByRole('button', { name: 'Assign Team Zone' }));
  await screen.findByText('Something went wrong. Please try again.');
  await user.click(screen.getByRole('button', { name: 'Assign Team Zone' }));
  await waitFor(() => expect(grant).toHaveBeenCalledTimes(2));
  expect(grant.mock.calls[0]![4].requestId).toBe(grant.mock.calls[1]![4].requestId);
  expect(grant.mock.calls[1]![4]).toEqual({
    requestId: expect.any(String),
    contractorZonePermissionId: 'parent',
    startDate: '2026-10-12',
    endDate: '2026-10-13',
    timezone: expect.any(String),
  });
  await screen.findByText('Team Zone saved.');
});
it('edits the assigned Zone with prefilled dates instead of posting another assignment', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'teamZoneSetup').mockResolvedValue({
    ...options,
    permissions: [
      {
        id: 'existing',
        contractorZonePermissionId: 'parent',
        zoneId: 'zone',
        name: 'Gạch',
        validFrom: options.availableZones[0]!.validFrom,
        validUntil: options.availableZones[0]!.validUntil,
        revokedAt: null,
        effective: true,
      },
    ],
  });
  const create = vi.spyOn(SmartSiteManagementClient.prototype, 'grantTeamZone');
  const edit = vi
    .spyOn(SmartSiteManagementClient.prototype, 'updateTeamZone')
    .mockResolvedValue({ id: 'replacement' });
  const user = mount();
  await screen.findByRole('button', { name: 'Save Zone Changes' });
  expect(screen.queryByRole('button', { name: 'Assign Team Zone' })).toBeNull();
  expect((screen.getByLabelText('Granted Zone') as HTMLSelectElement).value).toBe('parent');
  await user.click(screen.getByRole('button', { name: 'Save Zone Changes' }));
  await waitFor(() => expect(edit).toHaveBeenCalled());
  expect(edit.mock.calls[0]!.slice(0, 5)).toEqual([
    'rep-token',
    'site',
    'contractor',
    'team',
    'existing',
  ]);
  expect(create).not.toHaveBeenCalled();
});
it('shows unavailable with Retry and no writable form', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'teamZoneSetup').mockRejectedValue(
    new Error('Forbidden'),
  );
  mount();
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Assign Team Zone' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
});
