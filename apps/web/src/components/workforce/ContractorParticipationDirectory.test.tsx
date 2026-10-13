// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { ContractorParticipationDirectory } from './components/ContractorParticipationDirectory';

const auth = vi.hoisted(() => ({ admin: true }));
vi.mock('../../features/auth/auth-session', () => ({
  useAuth: () => ({ accessToken: 'token' }),
  useCurrentUser: () => ({
    data: {
      id: 'user',
      roleAssignments: [
        { role: auth.admin ? 'ADMIN' : 'SITE_MANAGER', siteId: auth.admin ? null : 'site-a' },
      ],
    },
  }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  auth.admin = true;
});
function mount() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cache}>
      <ContractorParticipationDirectory apiUrl="https://synthetic.test" />
    </QueryClientProvider>,
  );
  return cache;
}
function directory(total = 1) {
  return vi.spyOn(SmartSiteManagementClient.prototype, 'listGlobalContractors').mockResolvedValue({
    items: [{ id: 'contractor-a', code: 'CTR-A', name: 'Alpha', isActive: true }],
    total,
  });
}
const data = {
  contractor: { id: 'contractor-a', code: 'CTR-A', name: 'Alpha', isActive: true },
  items: [
    {
      id: 'p-a',
      site: { id: 'site-a', code: 'SITE-A', name: 'First Site' },
      validFrom: '2020-01-01T00:00:00Z',
      validUntil: null,
      isActive: true,
      status: 'ACTIVE' as const,
    },
  ],
  total: 21,
};
it('Admin selects a contractor and pages Site intervals; switching contractor pages clears stale Site details', async () => {
  const contractors = directory(21);
  const participations = vi
    .spyOn(SmartSiteManagementClient.prototype, 'listContractorParticipations')
    .mockResolvedValueOnce(data)
    .mockResolvedValueOnce({
      ...data,
      items: [
        {
          ...data.items[0]!,
          id: 'p-b',
          site: { id: 'site-b', name: 'Second Site', code: 'SITE-B' },
          status: 'EXPIRED',
        },
      ],
    });
  const cache = mount(),
    user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Alpha CTR-A/ }));
  await screen.findByText('No end date', { exact: false });
  expect(screen.getByText('ACTIVE')).toBeTruthy();
  expect(participations).toHaveBeenCalledWith('token', 'contractor-a', { offset: 0, limit: 20 });
  await user.click(screen.getByRole('button', { name: 'Next participations' }));
  await screen.findByText('Second Site', { exact: false });
  expect(participations).toHaveBeenCalledWith('token', 'contractor-a', { offset: 20, limit: 20 });
  expect(screen.queryByText('First Site', { exact: false })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Next contractors' }));
  await waitFor(() => expect(contractors).toHaveBeenCalledWith('token', { offset: 20, limit: 20 }));
  expect(screen.queryByText('Second Site', { exact: false })).toBeNull();
  expect(screen.getByText('Select a contractor to view its Sites.')).toBeTruthy();
  cache.clear();
});
it('unavailable participation data has retry and never looks like an empty Site list', async () => {
  directory();
  vi.spyOn(SmartSiteManagementClient.prototype, 'listContractorParticipations')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ ...data, items: [], total: 0 });
  const cache = mount(),
    user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Alpha CTR-A/ }));
  await screen.findByText('Site participations unavailable.', { exact: false });
  expect(screen.queryByText('No Site participations.')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Retry participations' }));
  await screen.findByText('No Site participations.');
  cache.clear();
});
it('directory denied state has retry and an empty directory is explicit', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'listGlobalContractors')
    .mockRejectedValueOnce(new ApiError('http', 'Forbidden', 403))
    .mockResolvedValueOnce({ items: [], total: 0 });
  const cache = mount();
  await screen.findByText('Contractor directory access denied.', { exact: false });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry directory' }));
  await screen.findByText('No contractors available.');
  cache.clear();
});
it('manager accounts never request the global contractor directory or participations', () => {
  auth.admin = false;
  const global = directory();
  const participations = vi.spyOn(
    SmartSiteManagementClient.prototype,
    'listContractorParticipations',
  );
  const cache = mount();
  expect(screen.queryByRole('region', { name: 'Contractor Site directory' })).toBeNull();
  expect(global).not.toHaveBeenCalled();
  expect(participations).not.toHaveBeenCalled();
  cache.clear();
});
