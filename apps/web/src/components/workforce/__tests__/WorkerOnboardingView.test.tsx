// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  type AccountResponse,
  type WorkerResponse,
} from '@smartsite/api-client';
import { WorkerOnboardingView } from '../components/WorkerOnboardingView';
import i18n, { translate as tr } from '../../../i18n';
import { LanguageSwitcher } from '../../../i18n/LanguageSwitcher';

const session = vi.hoisted(() => ({ user: null as AccountResponse | null }));
vi.mock('../../../features/auth/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../features/auth/auth-session')>()),
  useAuth: () => ({ accessToken: 'representative-token' }),
  useCurrentUser: () => ({ data: session.user, isPending: false, isError: false }),
}));
vi.mock('../../access/enrollment/WorkerEnrollmentView', () => ({
  WorkerEnrollmentView: ({
    siteId,
    canManageAccounts,
  }: {
    siteId: string;
    canManageAccounts: boolean;
  }) => (
    <p>
      Biometrics {siteId} / account management {String(canManageAccounts)}
    </p>
  ),
}));
let cache: QueryClient;
beforeEach(() => {
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  session.user = {
    id: 'representative',
    username: 'representative',
    displayName: 'Representative',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [
      { role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-a' },
      { role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-b' },
    ],
  };
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: ['site-a', 'site-b', 'other-site'].map((id) => ({
      id,
      code: id,
      name: id,
      createdAt: '2026-01-01T00:00:00Z',
    })),
    total: 3,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'contractorWorkerAccountOptions').mockResolvedValue(
    { contractors: [{ id: 'own-contractor', name: 'Own Contractor' }] },
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'listWorkers').mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'updateContractorWorker').mockImplementation(
    async (_token, _siteId, _contractorId, workerId, input) => ({
      ...rosterWorker(workerId),
      externalId: input.externalId,
      displayName: input.displayName,
      isActive: input.isActive,
    }),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'createContractorWorkerAccount').mockResolvedValue({
    worker: {
      id: 'worker-1',
      siteId: 'site-a',
      contractorId: 'own-contractor',
      userId: 'account-1',
      externalId: 'W000001',
      displayName: 'New Worker',
      isActive: true,
      createdAt: '2026-10-09T00:00:00Z',
    },
    account: {
      id: 'account-1',
      username: 'worker001',
      displayName: 'New Worker',
      roleAssignments: [{ role: 'WORKER', siteId: 'site-a' }],
      isActive: true,
      mustChangePassword: false,
    },
  });
});
afterEach(() => {
  cleanup();
  cache.clear();
  vi.restoreAllMocks();
});
function mount() {
  render(
    <QueryClientProvider client={cache}>
      <LanguageSwitcher />
      <WorkerOnboardingView apiUrl="https://api.example.test" />
    </QueryClientProvider>,
  );
}
async function fill() {
  const user = userEvent.setup();
  await screen.findByRole('heading', { name: 'Create Worker account' });
  await user.type(screen.getByLabelText('Full name'), 'New Worker');
  await user.type(screen.getByLabelText('Username'), 'Worker001');
  return user;
}
it('Representative creates a Worker login at its Site/Contractor without Admin account controls', async () => {
  mount();
  const user = await fill();
  expect(screen.queryByRole('option', { name: 'other-site' })).toBeNull();
  expect(screen.getByText('Biometrics site-a / account management false')).toBeTruthy();
  expect(screen.queryByLabelText('Worker code')).toBeNull();
  expect(screen.queryByLabelText(/Temporary password/)).toBeNull();
  expect(screen.getByText('12345678')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Create Worker account' }));
  await screen.findByText(/Account worker001 and Worker profile created/);
  expect(SmartSiteManagementClient.prototype.createContractorWorkerAccount).toHaveBeenCalledWith(
    'representative-token',
    'own-contractor',
    {
      siteId: 'site-a',
      displayName: 'New Worker',
      username: 'worker001',
    },
  );
  expect(screen.getByText(/Account worker001 and Worker profile created/).textContent).toMatch(
    /temporary password 12345678/,
  );
  expect(screen.getByText('W000001')).toBeTruthy();
});

it.each(['en', 'vi'] as const)(
  'preserves the Worker draft, scope and API payload when switching from %s',
  async (language) => {
    await i18n.changeLanguage(language);
    mount();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: tr('common.create_worker_account') });
    await user.type(screen.getByLabelText(tr('common.full_name')), 'Nguyễn Văn QA');
    await user.type(screen.getByLabelText(tr('common.username')), 'workerqa');
    const calls = vi.mocked(SmartSiteManagementClient.prototype.listSites).mock.calls.length;
    await user.click(screen.getByRole('button', { name: tr('language.choose') }));
    await user.click(
      screen.getByRole('button', { name: language === 'en' ? /Tiếng Việt/ : /English/ }),
    );
    expect((screen.getByLabelText(tr('common.full_name')) as HTMLInputElement).value).toBe(
      'Nguyễn Văn QA',
    );
    expect((screen.getByLabelText(tr('common.username')) as HTMLInputElement).value).toBe(
      'workerqa',
    );
    expect(SmartSiteManagementClient.prototype.listSites).toHaveBeenCalledTimes(calls);
    await user.click(screen.getByRole('button', { name: tr('common.create_worker_account') }));
    await waitFor(() =>
      expect(
        SmartSiteManagementClient.prototype.createContractorWorkerAccount,
      ).toHaveBeenCalledWith('representative-token', 'own-contractor', {
        siteId: 'site-a',
        displayName: 'Nguyễn Văn QA',
        username: 'workerqa',
      }),
    );
  },
);
it('displays creation errors and permits a corrected retry', async () => {
  vi.mocked(
    SmartSiteManagementClient.prototype.createContractorWorkerAccount,
  ).mockRejectedValueOnce(new Error('Username already exists'));
  mount();
  const user = await fill();
  await user.click(screen.getByRole('button', { name: 'Create Worker account' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Username already exists')).toBeTruthy();
  await user.clear(screen.getByLabelText('Username'));
  await user.type(screen.getByLabelText('Username'), 'Worker002');
  await user.click(screen.getByRole('button', { name: 'Create Worker account' }));
  await screen.findByText(/Account worker001 and Worker profile created/);
});
it('does not enable creation without an active scoped Contractor', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.contractorWorkerAccountOptions).mockResolvedValue({
    contractors: [],
  });
  mount();
  await screen.findByText(/No active contractor participation/);
  expect(screen.queryByRole('button', { name: 'Create Worker account' })).toBeNull();
});
it('denies Worker accounts before loading Sites or contractor options', async () => {
  session.user!.roleAssignments = [{ role: 'WORKER', siteId: 'site-a' }];
  mount();
  expect(screen.getByRole('alert').textContent).toMatch(/requires a Contractor Representative/);
  expect(SmartSiteManagementClient.prototype.listSites).not.toHaveBeenCalled();
  expect(SmartSiteManagementClient.prototype.contractorWorkerAccountOptions).not.toHaveBeenCalled();
});
it('switching Sites clears credentials and reloads the scoped contractors', async () => {
  mount();
  const user = await fill();
  await user.selectOptions(screen.getByLabelText('Site'), 'site-b');
  await waitFor(() =>
    expect(SmartSiteManagementClient.prototype.contractorWorkerAccountOptions).toHaveBeenCalledWith(
      'representative-token',
      'site-b',
    ),
  );
  expect(screen.queryByLabelText(/Temporary password/)).toBeNull();
  expect((screen.getByLabelText('Full name') as HTMLInputElement).value).toBe('');
});
it('shows unavailable Contractor data with retry instead of allowing creation', async () => {
  vi.mocked(
    SmartSiteManagementClient.prototype.contractorWorkerAccountOptions,
  ).mockRejectedValueOnce(new Error('Unavailable'));
  mount();
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Create Worker account' })).toBeNull();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('heading', { name: 'Create Worker account' });
});

function rosterWorker(id: string, contractorId = 'own-contractor'): WorkerResponse {
  return {
    id,
    siteId: 'site-a',
    contractorId,
    userId: `${id}-account`,
    externalId: id,
    displayName: `${id} name`,
    isActive: true,
    createdAt: '2026-10-09T00:00:00Z',
  };
}

it('loads every roster page and shows only workers of the selected Contractor, including suspended workers', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listWorkers)
    .mockResolvedValueOnce({
      items: [rosterWorker('W001'), rosterWorker('OTHER', 'other-contractor')],
      total: 3,
    })
    .mockResolvedValueOnce({
      items: [{ ...rosterWorker('W002'), isActive: false, userId: null }],
      total: 3,
    });
  mount();
  await screen.findByText('W002 name');
  expect(screen.getByText('W001 name')).toBeTruthy();
  expect(screen.queryByText('OTHER name')).toBeNull();
  expect(screen.getByText('Suspended')).toBeTruthy();
  expect(screen.getByText('No login account linked')).toBeTruthy();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Search workers by code or name'), 'w002');
  expect(screen.queryByText('W001 name')).toBeNull();
  expect(screen.getByText('W002 name')).toBeTruthy();
  await user.clear(screen.getByLabelText('Search workers by code or name'));
  await user.type(screen.getByLabelText('Search workers by code or name'), 'missing');
  expect(screen.getByText('No workers match your search.')).toBeTruthy();
});

it('refreshes the roster after account creation', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listWorkers)
    .mockResolvedValueOnce({ items: [], total: 0 })
    .mockResolvedValue({ items: [rosterWorker('W001')], total: 1 });
  mount();
  const user = await fill();
  await screen.findByText('No workers belong to this Contractor at this Site yet.');
  await user.click(screen.getByRole('button', { name: 'Create Worker account' }));
  await screen.findByText('W001 name');
});

it('retries unavailable worker data and reloads the roster when switching Sites', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listWorkers)
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValue({ items: [rosterWorker('W001')], total: 1 });
  mount();
  await screen.findByText(/Could not load workers/);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('W001 name');
  await userEvent.setup().selectOptions(screen.getByLabelText('Site'), 'site-b');
  await waitFor(() =>
    expect(SmartSiteManagementClient.prototype.listWorkers).toHaveBeenCalledWith(
      'representative-token',
      'site-b',
      expect.objectContaining({ offset: 0 }),
    ),
  );
});

it('edits and suspends a worker with its original snapshot, then refreshes the roster', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listWorkers)
    .mockResolvedValueOnce({ items: [rosterWorker('W001')], total: 1 })
    .mockResolvedValue({
      items: [{ ...rosterWorker('W001'), displayName: 'Corrected Worker', isActive: false }],
      total: 1,
    });
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Manage W001 name' }));
  expect(screen.queryByLabelText('Edit Worker code')).toBeNull();
  await user.clear(screen.getByLabelText('Edit full name'));
  await user.type(screen.getByLabelText('Edit full name'), 'Corrected Worker');
  await user.selectOptions(screen.getByLabelText('Worker status'), 'suspended');
  await user.click(screen.getByRole('button', { name: 'Save Worker profile' }));
  await screen.findByText('Corrected Worker');
  expect(screen.getByText('Suspended')).toBeTruthy();
  expect(SmartSiteManagementClient.prototype.updateContractorWorker).toHaveBeenCalledWith(
    'representative-token',
    'site-a',
    'own-contractor',
    'W001',
    {
      externalId: 'W001',
      displayName: 'Corrected Worker',
      isActive: false,
      expectedSnapshot: { externalId: 'W001', displayName: 'W001 name', isActive: true },
    },
  );
  expect(screen.queryByLabelText('Worker status')).toBeNull();
});

it('retains edits on failure and can reload a stale profile before retrying', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listWorkers).mockResolvedValue({
    items: [rosterWorker('W001')],
    total: 1,
  });
  vi.mocked(SmartSiteManagementClient.prototype.updateContractorWorker).mockRejectedValueOnce(
    new Error('Worker profile changed. Reload it before editing again.'),
  );
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Manage W001 name' }));
  await user.selectOptions(screen.getByLabelText('Worker status'), 'suspended');
  await user.click(screen.getByRole('button', { name: 'Save Worker profile' }));
  await screen.findByText(/Worker profile changed/);
  expect((screen.getByLabelText('Worker status') as HTMLSelectElement).value).toBe('suspended');
  await user.click(screen.getByRole('button', { name: 'Reload Worker' }));
  expect(screen.queryByLabelText('Worker status')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Manage W001 name' }));
  expect((screen.getByLabelText('Worker status') as HTMLSelectElement).value).toBe('active');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(SmartSiteManagementClient.prototype.updateContractorWorker).toHaveBeenCalledTimes(1);
});
