// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, type AccountResponse } from '@smartsite/api-client';
import { DashboardView } from './DashboardView';
import i18n from '../../i18n';

vi.mock('../../features/auth/auth-session', async (original) => ({
  ...(await original<typeof import('../../features/auth/auth-session')>()),
  useAuth: () => ({ accessToken: 'admin-token' }),
  useCurrentUser: () => ({
    data: {
      id: 'admin',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'ADMIN', siteId: null }],
    },
  }),
}));
let cache: QueryClient;
const navigate = vi.fn();
const accounts: AccountResponse[] = [
  {
    id: 'locked-manager',
    username: 'manager',
    displayName: 'Manager',
    isActive: false,
    mustChangePassword: false,
    roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'alpha' }],
  },
];
beforeEach(async () => {
  await i18n.changeLanguage('en');
  navigate.mockReset();
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [
      { id: 'alpha', name: 'Alpha', code: 'A', createdAt: '' },
      { id: 'beta', name: 'Beta', code: 'B', createdAt: '' },
    ],
    total: 2,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listUsers').mockResolvedValue({
    items: accounts,
    total: 1,
  });
});
afterEach(() => {
  cleanup();
  cache?.clear();
  vi.restoreAllMocks();
});
function mount() {
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cache}>
      <DashboardView onNavigate={navigate} />
    </QueryClientProvider>,
  );
}
it('uses complete account pages and shows actionable manager states instead of sample operations', async () => {
  const users = vi
    .spyOn(SmartSiteManagementClient.prototype, 'listUsers')
    .mockImplementation(async (_token, page) =>
      page?.offset === 0
        ? { items: accounts, total: 2 }
        : { items: [{ ...accounts[0]!, id: 'other', roleAssignments: [] }], total: 2 },
    );
  mount();
  expect(await screen.findByRole('heading', { name: 'Administration overview' })).toBeTruthy();
  expect(await screen.findByText('Manager account disabled')).toBeTruthy();
  expect(screen.getByText('No manager assigned')).toBeTruthy();
  expect(users).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('328')).toBeNull();
  const row = screen.getByText('Alpha').closest('li')!;
  fireEvent.click(within(row).getByRole('button', { name: 'Open site' }));
  expect(navigate).toHaveBeenCalledWith('site-setup', { siteId: 'alpha' });
});
it('shows an error instead of fabricated zero counts and can retry', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'listUsers')
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValue({ items: [], total: 0 });
  mount();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('0', { exact: true })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(await screen.findAllByText('No manager assigned')).toHaveLength(2);
});

it('shows a real empty site state and a password-required manager separately', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listSites).mockResolvedValue({
    items: [],
    total: 0,
  });
  mount();
  expect(
    await screen.findByText('No construction sites yet. Create one in Site Setup.'),
  ).toBeTruthy();
  cleanup();
  cache.clear();
  vi.mocked(SmartSiteManagementClient.prototype.listSites).mockResolvedValue({
    items: [{ id: 'alpha', name: 'Alpha', code: 'A', createdAt: '' }],
    total: 1,
  });
  vi.mocked(SmartSiteManagementClient.prototype.listUsers).mockResolvedValue({
    items: [{ ...accounts[0]!, isActive: true, mustChangePassword: true }],
    total: 1,
  });
  mount();
  expect(await screen.findByText('Manager must change password')).toBeTruthy();
});
