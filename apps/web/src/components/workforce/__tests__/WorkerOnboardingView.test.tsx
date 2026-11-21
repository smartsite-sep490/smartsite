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
import { translate as tr } from '../../../i18n';
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
  URL.createObjectURL = vi.fn(() => 'blob:synthetic-document');
  URL.revokeObjectURL = vi.fn();
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
  vi.spyOn(SmartSiteManagementClient.prototype, 'checkDocumentImageQuality').mockResolvedValue({
    status: 'ACCEPTED',
    reason: 'IMAGE_ACCEPTED',
    ocr: { status: 'READ', issuedOn: '2026-10-18', expiresOn: '2027-10-18', warnings: [] },
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'submitWorkerDocuments').mockResolvedValue({
    requestId: 'request',
    version: 2,
    documentIds: ['document'],
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'workerCompliance').mockResolvedValue({
    version: 1,
    safetyCardRequired: true,
    workerId: 'worker-1',
    contractorId: 'own-contractor',
    displayName: 'Synthetic Worker',
    externalId: 'W001',
    nationalId: null,
    phoneNumber: null,
    gender: null,
    address: null,
    identityImages: [],
    status: 'NOT_REQUIRED',
    submissionStatus: 'NOT_SUBMITTED',
    needsSupplement: true,
    documents: [],
    missingKinds: [],
    expiringKinds: [],
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
  await fillDocuments(user);
  return user;
}
async function fillDocuments(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText(tr('documents.safetyCardRequired')), 'true');
  await user.type(screen.getByLabelText(tr('documents.nationalId')), '000000000001');
  await user.type(screen.getByLabelText(tr('documents.phoneNumber')), '0900000001');
  await user.selectOptions(screen.getByLabelText(tr('documents.gender')), 'MALE');
  await user.type(screen.getByLabelText(tr('documents.address')), 'Synthetic address');
  for (const kind of ['FRONT', 'BACK', 'SAFETY_CARD', 'HEALTH_CERTIFICATE', 'PERSONAL_INSURANCE'])
    await user.upload(
      screen.getByLabelText(tr(`documents.${kind}`)),
      new File(['synthetic'], `${kind}.jpg`, { type: 'image/jpeg' }),
    );
  await waitFor(() =>
    expect(SmartSiteManagementClient.prototype.checkDocumentImageQuality).toHaveBeenCalledTimes(5),
  );
}
it('submits the selected dates and files as one bundle after account creation', async () => {
  mount();
  const user = await fill();
  await user.click(screen.getByRole('button', { name: tr('documents.sendBundle') }));
  await waitFor(() =>
    expect(SmartSiteManagementClient.prototype.submitWorkerDocuments).toHaveBeenCalledTimes(1),
  );
  expect(SmartSiteManagementClient.prototype.createContractorWorkerAccount).toHaveBeenCalledTimes(
    1,
  );
  const [, site, worker, input, files] = vi.mocked(
    SmartSiteManagementClient.prototype.submitWorkerDocuments,
  ).mock.calls[0]!;
  expect(site).toBe('site-a');
  expect(worker).toBe('worker-1');
  expect(input.safetyCardRequired).toBe(true);
  expect(input.documents.HEALTH_CERTIFICATE).toEqual({ submittedIssuedOn: '2026-10-18' });
  expect(Object.keys(files)).toHaveLength(5);
});
it('retries a failed bundle without creating another Worker account', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.submitWorkerDocuments).mockRejectedValueOnce(
    new Error('Synthetic interruption'),
  );
  mount();
  const user = await fill();
  await user.click(screen.getByRole('button', { name: tr('documents.sendBundle') }));
  await screen.findByText(tr('errors.unexpected'));
  await user.click(screen.getByRole('button', { name: tr('documents.sendBundle') }));
  await waitFor(() =>
    expect(SmartSiteManagementClient.prototype.submitWorkerDocuments).toHaveBeenCalledTimes(2),
  );
  const attempts = vi.mocked(SmartSiteManagementClient.prototype.submitWorkerDocuments).mock.calls;
  expect(attempts[1]![3].requestId).toBe(attempts[0]![3].requestId);
  expect(attempts[1]![3].expectedVersion).toBe(attempts[0]![3].expectedVersion);
  expect(SmartSiteManagementClient.prototype.createContractorWorkerAccount).toHaveBeenCalledTimes(
    1,
  );
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
