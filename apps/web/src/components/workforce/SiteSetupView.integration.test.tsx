// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, type AccountResponse } from '@smartsite/api-client';
import { SiteSetupView } from './SiteSetupView';

vi.mock('../../features/auth/auth-session', () => ({
  useAuth: () => ({ accessToken: 'admin-token' }),
  useCurrentUser: () => ({
    data: { id: 'admin', roleAssignments: [{ role: 'ADMIN', siteId: null }] },
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function manager(id: string, isActive = true, mustChangePassword = false): AccountResponse {
  return {
    id,
    username: id,
    displayName: id,
    isActive,
    mustChangePassword,
    roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'site-a' }],
  };
}

function setup() {
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [{ id: 'site-a', code: 'A', name: 'Alpha', createdAt: new Date().toISOString() }],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listContractors').mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.spyOn(
    SmartSiteManagementClient.prototype,
    'listContractorRepresentativeAssignments',
  ).mockResolvedValue({ items: [], total: 0 });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <SiteSetupView apiUrl="https://api.example.test" />
    </QueryClientProvider>,
  );
  return { cache, user: userEvent.setup() };
}

it('renders a manager returned after the first account page', async () => {
  const records: AccountResponse[] = [
    ...Array.from({ length: 100 }, (_, index) => ({
      ...manager(`worker-${index}`),
      roleAssignments: [{ role: 'WORKER' as const, siteId: 'site-a' }],
    })),
    manager('later-manager'),
  ];
  const users = vi
    .spyOn(SmartSiteManagementClient.prototype, 'listUsers')
    .mockImplementation(async (_token, options) => ({
      items: records.slice(options!.offset!, options!.offset! + options!.limit!),
      total: records.length,
    }));
  const { cache } = setup();
  await screen.findByText('later-manager (Ready to approve)');
  expect(users).toHaveBeenCalledWith('admin-token', { offset: 100, limit: 100 });
  cache.clear();
});

it.each([
  [false, false, 'Disabled'],
  [true, true, 'Password change required'],
] as const)(
  'keeps manager setup available when an assigned account is unavailable (%s, %s)',
  async (active, temporary, status) => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listUsers').mockResolvedValue({
      items: [manager('unavailable-manager', active, temporary)],
      total: 1,
    });
    const { cache, user } = setup();
    await screen.findByText(`unavailable-manager (${status})`);
    await user.click(screen.getByRole('button', { name: 'Manage Site Managers' }));
    expect(screen.getByRole('button', { name: '+ Create New Site Manager' })).not.toBeNull();
    expect(screen.queryByText('unavailable-manager (Ready to approve)')).toBeNull();
    cache.clear();
  },
);

it('reports unavailable account data instead of claiming no manager is assigned', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'listUsers').mockRejectedValue(
    new Error('offline'),
  );
  const { cache } = setup();
  await screen.findByText('Account data unavailable');
  expect(screen.getByRole('alert').textContent).toContain(
    'Could not load complete site setup data',
  );
  expect(screen.getByRole('button', { name: 'Assign Site Manager' }).hasAttribute('disabled')).toBe(
    true,
  );
  cache.clear();
});

it('creates a manager scoped to the selected site and explains the required password change', async () => {
  const users = vi
    .spyOn(SmartSiteManagementClient.prototype, 'listUsers')
    .mockResolvedValue({ items: [], total: 0 });
  const create = vi
    .spyOn(SmartSiteManagementClient.prototype, 'createUser')
    .mockImplementation(async () => {
      const account = manager('new-manager', true, true);
      users.mockResolvedValue({ items: [account], total: 1 });
      return account;
    });
  const { user, cache } = setup();
  await screen.findByText('Not assigned yet');
  await user.click(screen.getByRole('button', { name: 'Assign Site Manager' }));
  await user.click(screen.getByRole('button', { name: '+ Create New Site Manager' }));
  await user.type(screen.getByLabelText(/Username/), 'new-manager');
  await user.type(screen.getByLabelText(/Display Name/), 'New Manager');
  await user.type(screen.getByLabelText(/Temporary Password/), 'TempDemo2026!');
  await user.click(screen.getByRole('button', { name: 'Create Site Manager' }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith('admin-token', {
      username: 'new-manager',
      displayName: 'New Manager',
      temporaryPassword: 'TempDemo2026!',
      roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'site-a' }],
    }),
  );
  await screen.findByText('new-manager (Password change required)');
  expect(screen.getByText(/They must sign in and change their temporary password/)).not.toBeNull();
  cache.clear();
});
