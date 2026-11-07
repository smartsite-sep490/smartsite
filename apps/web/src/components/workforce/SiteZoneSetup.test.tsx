// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { SiteZoneSetup } from './components/SiteZoneSetup';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(locked = false) {
  vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
    items: [
      {
        id: 'zone',
        siteId: 'site',
        code: 'ZONE',
        name: 'Work area',
        type: 'STANDARD',
        restrictionPolicy: 'NONE',
        requiredPpe: [],
        configurationLocked: locked,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
    total: 1,
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <SiteZoneSetup
        apiUrl="https://api.example.test"
        token="token"
        siteId="site"
        userId="manager"
      />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

it('requires confirmation before deleting a Zone and allows cancellation', async () => {
  const remove = vi
    .spyOn(SmartSiteManagementClient.prototype, 'deleteZone')
    .mockResolvedValue({ id: 'zone' });
  const user = mount();
  await user.click(await screen.findByRole('button', { name: 'Delete Zone' }));
  expect(remove).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('button', { name: 'Confirm delete' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Delete Zone' }));
  await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
  expect(remove).toHaveBeenCalledWith('token', 'site', 'zone');
  expect(await screen.findByText('Zone deleted successfully.')).toBeTruthy();
});

it('unifies Create and Edit form UI, allows renaming a locked Zone while disabling policy edits', async () => {
  const rename = vi
    .spyOn(SmartSiteManagementClient.prototype, 'renameZone')
    .mockResolvedValue({} as never);
  const user = mount(true);

  // Initially in Create mode: single form with "Create Zone"
  expect(screen.getByRole('heading', { level: 2, name: 'Create Zone' })).toBeTruthy();
  const form = screen.getByRole('form', { name: 'Create Zone' });
  expect(within(form).getByRole('button', { name: 'Create Zone' })).toBeTruthy();

  // Click Edit Zone on the configured zone row
  await user.click(await screen.findByRole('button', { name: 'Edit Zone' }));

  // Form switches to Edit mode with "Edit Zone" title and submit button
  expect(screen.getByRole('heading', { level: 2, name: 'Edit Zone' })).toBeTruthy();
  const editForm = screen.getByRole('form', { name: 'Edit Zone' });
  expect(within(editForm).getByRole('button', { name: 'Edit Zone' })).toBeTruthy();
  expect(within(editForm).getByRole('button', { name: 'Cancel' })).toBeTruthy();

  // Since configurationLocked is true, policy fields are disabled
  expect((screen.getByLabelText('Zone type') as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByLabelText('Access policy') as HTMLSelectElement).disabled).toBe(true);

  // Rename Zone
  const input = screen.getByLabelText('Zone name') as HTMLInputElement;
  expect(input.value).toBe('Work area');
  await user.clear(input);
  await user.type(input, 'New area');
  await user.click(within(editForm).getByRole('button', { name: 'Edit Zone' }));
  expect(rename).toHaveBeenCalledWith('token', 'site', 'zone', 'New area');
  expect(await screen.findByText('Zone updated.')).toBeTruthy();
});

it('allows editing policy and PPE on an unlocked Zone and supports cancelling edit', async () => {
  const rename = vi
    .spyOn(SmartSiteManagementClient.prototype, 'renameZone')
    .mockResolvedValue({} as never);
  const updatePolicy = vi
    .spyOn(SmartSiteManagementClient.prototype, 'updateZonePolicy')
    .mockResolvedValue({} as never);
  const user = mount(false);

  // Click Edit Zone
  await user.click(await screen.findByRole('button', { name: 'Edit Zone' }));
  const editForm = screen.getByRole('form', { name: 'Edit Zone' });

  // Fields are enabled on unlocked zone
  expect((screen.getByLabelText('Zone type') as HTMLSelectElement).disabled).toBe(false);
  expect((screen.getByLabelText('Access policy') as HTMLSelectElement).disabled).toBe(false);

  // Cancel edit mode
  await user.click(within(editForm).getByRole('button', { name: 'Cancel' }));

  // Returns to Create mode
  expect(screen.getByRole('heading', { level: 2, name: 'Create Zone' })).toBeTruthy();
  expect((screen.getByLabelText('Zone name') as HTMLInputElement).value).toBe('');

  // Re-enter edit mode
  await user.click(screen.getByRole('button', { name: 'Edit Zone' }));
  const activeEditForm = screen.getByRole('form', { name: 'Edit Zone' });
  await user.selectOptions(screen.getByLabelText('Zone type'), 'RESTRICTED');
  await user.selectOptions(screen.getByLabelText('Access policy'), 'AUTHORIZATION_REQUIRED');
  await user.click(screen.getByLabelText('Hard hat'));

  await user.click(within(activeEditForm).getByRole('button', { name: 'Edit Zone' }));
  expect(rename).not.toHaveBeenCalled();
  expect(updatePolicy).toHaveBeenCalledWith('token', 'site', 'zone', {
    type: 'RESTRICTED',
    restrictionPolicy: 'AUTHORIZATION_REQUIRED',
    requiredPpe: ['HARD_HAT'],
  });
});
