// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  ApiError,
  type AccountResponse,
  type WorkerComplianceResponse,
} from '@smartsite/api-client';
import { WorkerDocumentsView } from '../components/WorkerDocumentsView';
import i18n, { translate as tr } from '../../../i18n';

let cache: QueryClient;
let user: AccountResponse;

vi.mock('../../../features/auth/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../features/auth/auth-session')>()),
  useAuth: () => ({ accessToken: 'synthetic-token' }),
  useCurrentUser: () => ({ data: user, isLoading: false, isError: false }),
}));

const compliance: WorkerComplianceResponse = {
  workerId: 'worker-1',
  contractorId: 'contractor-1',
  displayName: 'Nguyễn Văn An',
  externalId: 'W001',
  nationalId: '000000000001',
  phoneNumber: '0900000001',
  gender: 'MALE',
  address: 'Synthetic address',
  identityImages: [],
  status: 'PENDING',
  submissionStatus: 'PENDING_REVIEW',
  needsSupplement: true,
  documents: [
    {
      id: 'doc-1',
      workerId: 'worker-1',
      kind: 'SAFETY_CARD',
      status: 'PENDING',
      originalName: 'card.jpg',
      mediaType: 'image/jpeg',
      size: 100,
      issuedOn: null,
      expiresOn: null,
      uploadedAt: '2026-10-17T00:00:00Z',
      reviewedAt: null,
      reviewNote: null,
      version: 1,
    },
  ],
  missingKinds: ['HEALTH_CERTIFICATE', 'PERSONAL_INSURANCE'],
  expiringKinds: [],
};

beforeEach(async () => {
  await i18n.changeLanguage('vi');
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  user = {
    id: 'user-safety',
    username: 'safety',
    displayName: 'Safety Officer',
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-a' }],
    isActive: true,
    mustChangePassword: false,
  };

  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [
      {
        id: 'site-a',
        code: 'site-a',
        name: 'Công trường Alpha',
        createdAt: '2026-10-09T00:00:00Z',
      },
    ],
    total: 1,
  });

  vi.spyOn(SmartSiteManagementClient.prototype, 'listWorkerCompliance').mockResolvedValue({
    items: [compliance],
    total: 1,
  });

  vi.spyOn(SmartSiteManagementClient.prototype, 'workerCompliance').mockResolvedValue(compliance);
});

afterEach(() => {
  cleanup();
  cache.clear();
  vi.restoreAllMocks();
});

function DocumentRouteProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="document-url">{location.search}</output>
      <button onClick={() => navigate(-1)}>Back to previous document site</button>
    </>
  );
}

function mount(initialUrl = '/worker-documents', probe = false) {
  return render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <WorkerDocumentsView apiUrl="https://api.example.test" />
        {probe && <DocumentRouteProbe />}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('shows a safe request error and retries document prerequisites', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listSites).mockRejectedValueOnce(
    new ApiError('invalid-response', 'PRIVATE_INVALID_JSON', 502),
  );
  mount();
  expect((await screen.findByRole('alert')).textContent).toContain(tr('errors.unavailable'));
  expect(document.body.textContent).not.toContain('PRIVATE_INVALID_JSON');
  fireEvent.click(screen.getByRole('button', { name: tr('common.retry') }));
  await screen.findByText(/Nguyễn Văn An/);
});

it('refreshes the selected document detail without exposing any analysis control to Safety', async () => {
  mount('/worker-documents?siteId=site-a&workerId=worker-1&tab=documents');
  await screen.findByText('card.jpg');
  vi.mocked(SmartSiteManagementClient.prototype.workerCompliance).mockResolvedValue({
    ...compliance,
    documents: [
      {
        ...compliance.documents[0]!,
        originalName: 'replacement.jpg',
        aiAnalysis: { status: 'UNAVAILABLE' },
      },
    ],
  });
  fireEvent.click(screen.getByRole('button', { name: tr('documents.refresh') }));
  await screen.findByText('replacement.jpg');
  expect(screen.queryByText(tr('documents.aiUnavailable'))).toBeNull();
  expect(screen.queryByRole('button', { name: tr('documents.aiRun') })).toBeNull();
});

it('searches and filters the whole queue through the API and resets pagination', async () => {
  const list = vi.mocked(SmartSiteManagementClient.prototype.listWorkerCompliance);
  list.mockResolvedValue({ items: [compliance], total: 42 });
  mount('/worker-documents?siteId=site-a');
  await screen.findByText(/Nguyễn Văn An/);
  fireEvent.click(screen.getByRole('button', { name: tr('documents.next') }));
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith(
      'synthetic-token',
      'site-a',
      expect.objectContaining({ offset: 20 }),
    ),
  );
  list.mockResolvedValue({
    items: [{ ...compliance, displayName: 'Worker outside first page' }],
    total: 1,
  });
  fireEvent.change(screen.getByLabelText(tr('documents.search')), { target: { value: 'outside' } });
  await screen.findByText(/Worker outside first page/);
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith('synthetic-token', 'site-a', {
      offset: 0,
      limit: 20,
      search: 'outside',
      submissionStatus: 'PENDING_REVIEW',
    }),
  );
  fireEvent.change(screen.getByLabelText(tr('documents.submissionFilter')), {
    target: { value: 'REVIEWED' },
  });
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith(
      'synthetic-token',
      'site-a',
      expect.objectContaining({
        offset: 0,
        submissionStatus: 'REVIEWED',
        search: 'outside',
      }),
    ),
  );
});

it('shows submission separately from the supplement tag, including partially submitted profiles', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listWorkerCompliance).mockResolvedValue({
    items: [
      { ...compliance, displayName: 'Never submitted', submissionStatus: 'NOT_SUBMITTED' },
      { ...compliance, workerId: 'worker-2', displayName: 'Partly submitted' },
      {
        ...compliance,
        workerId: 'worker-3',
        displayName: 'Ready for review',
        status: 'ACTIVE',
        needsSupplement: false,
      },
    ],
    total: 3,
  });
  mount('/worker-documents?siteId=site-a');
  const missing = await screen.findByRole('button', { name: /Never submitted/ });
  expect(within(missing).getByText(tr('documents.NOT_SUBMITTED'))).toBeTruthy();
  expect(within(missing).getByText(tr('documents.needsSupplement'))).toBeTruthy();
  const partial = screen.getByRole('button', { name: /Partly submitted/ });
  expect(within(partial).getByText(tr('documents.PENDING_REVIEW'))).toBeTruthy();
  expect(within(partial).getByText(tr('documents.needsSupplement'))).toBeTruthy();
  const ready = screen.getByRole('button', { name: /Ready for review/ });
  expect(within(ready).getByText(tr('documents.PENDING_REVIEW'))).toBeTruthy();
  expect(within(ready).queryByText(tr('documents.needsSupplement'))).toBeNull();
  expect(screen.queryByText(tr('documents.ACTIVE'))).toBeNull();
});

it('Safety Officer opens review queue and pre-selects the worker from notification query params', async () => {
  mount('/worker-documents?siteId=site-a&workerId=worker-1&tab=documents');
  await screen.findByRole('heading', { name: tr('documents.workspaceTitle') });
  expect(screen.queryByRole('heading', { name: tr('documents.title') })).toBeNull();
  expect((screen.getByLabelText(tr('common.site_fa7955')) as HTMLSelectElement).value).toBe(
    'site-a',
  );
  expect(await screen.findByText(/Nguyễn Văn An/)).toBeTruthy();
  expect(await screen.findByText(/card\.jpg/)).toBeTruthy();
  expect(screen.getByRole('button', { name: tr('documents.approve') })).toBeTruthy();
});

it('Worker can edit personal information without an active contractor team', async () => {
  user = {
    id: 'user-worker',
    username: 'worker01',
    displayName: 'Nguyễn Văn Worker',
    roleAssignments: [{ role: 'WORKER', siteId: 'site-a' }],
    isActive: true,
    mustChangePassword: false,
  };
  const team = vi.spyOn(SmartSiteManagementClient.prototype, 'myContractorTeam');
  const self = vi
    .spyOn(SmartSiteManagementClient.prototype, 'myWorkerCompliance')
    .mockResolvedValue(compliance);

  mount('/worker-documents?siteId=site-a');
  await screen.findByText(/card\.jpg/);
  expect(screen.queryByRole('heading', { name: tr('documents.title') })).toBeNull();
  expect((screen.getByLabelText(tr('common.site_fa7955')) as HTMLSelectElement).value).toBe(
    'site-a',
  );
  expect(screen.queryByRole('heading', { name: tr('documents.reviewQueue') })).toBeNull();
  expect(await screen.findByText(/card\.jpg/)).toBeTruthy();
  expect(self).toHaveBeenCalledWith('synthetic-token', 'site-a');
  expect(team).not.toHaveBeenCalled();
  expect(
    screen.queryByLabelText(`${tr('documents.upload')} — ${tr('documents.SAFETY_CARD')}`),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: tr('documents.sendBundle') })).toBeNull();
  fireEvent.click(screen.getByText(tr('documents.personalDetails')));
  expect(screen.getByRole('button', { name: tr('workerIntake.editIdentity') })).toBeTruthy();
  expect(screen.queryByRole('button', { name: tr('documents.approve') })).toBeNull();
});

it('does not open another site when a legacy document link requests an unavailable site', async () => {
  mount('/worker-documents?siteId=other-site&workerId=worker-1');
  expect((await screen.findByRole('alert')).textContent).toContain(tr('safetyUi.siteUnavailable'));
  expect(SmartSiteManagementClient.prototype.listWorkerCompliance).not.toHaveBeenCalled();
  expect(SmartSiteManagementClient.prototype.workerCompliance).not.toHaveBeenCalled();
});

it('opens a rep record, filters expiring certificates and enrolls the selected worker in context', async () => {
  user.roleAssignments = [{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-a' }];
  vi.spyOn(SmartSiteManagementClient.prototype, 'listWorkers').mockResolvedValue({
    items: [
      {
        id: 'worker-1',
        siteId: 'site-a',
        contractorId: 'contractor-1',
        userId: 'worker-account',
        externalId: 'W001',
        displayName: compliance.displayName,
        isActive: true,
        createdAt: '',
      },
    ],
    total: 1,
  });
  const face = vi
    .spyOn(SmartSiteManagementClient.prototype, 'getFaceProfile')
    .mockResolvedValue(null as never);
  mount('/worker-documents?siteId=site-a');
  await screen.findByRole('heading', { name: tr('workerIntake.recordTitle') });
  fireEvent.change(screen.getByRole('combobox', { name: tr('documents.submissionFilter') }), {
    target: { value: 'expiring' },
  });
  await waitFor(() =>
    expect(SmartSiteManagementClient.prototype.listWorkerCompliance).toHaveBeenLastCalledWith(
      'synthetic-token',
      'site-a',
      expect.objectContaining({ expiringOnly: true }),
    ),
  );
  fireEvent.click(await screen.findByRole('button', { name: /Nguyễn Văn An/ }));
  await screen.findByText('card.jpg');
  fireEvent.click(screen.getByRole('button', { name: tr('workerIntake.face') }));
  await waitFor(() => expect(face).toHaveBeenCalledWith('synthetic-token', 'worker-1'));
  expect(
    screen.queryByLabelText(tr('worker_enrollment_view.existing_worker_profile_account_optional')),
  ).toBeNull();
});

it('keeps the new Safety header while switching sites through URL history', async () => {
  user.roleAssignments.push({ role: 'SAFETY_OFFICER', siteId: 'site-b' });
  vi.mocked(SmartSiteManagementClient.prototype.listSites).mockResolvedValue({
    items: ['site-a', 'site-b'].map((id) => ({ id, code: id, name: id, createdAt: '' })),
    total: 2,
  });
  mount('/worker-documents?siteId=site-a&workerId=worker-1', true);
  await screen.findByText('card.jpg');
  expect(screen.getByRole('heading', { name: tr('documents.workspaceTitle') })).toBeTruthy();
  fireEvent.change(screen.getByLabelText(tr('common.site_fa7955')), {
    target: { value: 'site-b' },
  });
  await waitFor(() =>
    expect(screen.getByTestId('document-url').textContent).toBe('?siteId=site-b'),
  );
  await waitFor(() =>
    expect(SmartSiteManagementClient.prototype.listWorkerCompliance).toHaveBeenLastCalledWith(
      'synthetic-token',
      'site-b',
      expect.any(Object),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Back to previous document site' }));
  await waitFor(() =>
    expect(screen.getByTestId('document-url').textContent).toBe('?siteId=site-a&workerId=worker-1'),
  );
  expect((screen.getByLabelText(tr('common.site_fa7955')) as HTMLSelectElement).value).toBe(
    'site-a',
  );
  expect(await screen.findByText('card.jpg')).toBeTruthy();
});
