// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
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
let sessionScope: string | undefined;
let currentUserError: Error | null;
let refetchCurrentUser: ReturnType<typeof vi.fn>;

vi.mock('../../../features/auth/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../features/auth/auth-session')>()),
  useAuth: () => ({ accessToken: 'synthetic-token', sessionScope }),
  useCurrentUser: () => ({
    data: currentUserError ? undefined : user,
    isPending: false,
    isLoading: false,
    isError: Boolean(currentUserError),
    error: currentUserError,
    refetch: refetchCurrentUser,
  }),
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
      ocr: { status: 'READ', issuedOn: '2026-10-17', expiresOn: '2028-10-17', warnings: [] },
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
  sessionScope = 'session-scope-1';
  currentUserError = null;
  refetchCurrentUser = vi.fn().mockResolvedValue(undefined);
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

function mount(initialUrl = '/worker-documents') {
  return render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <WorkerDocumentsView apiUrl="https://api.example.test" />
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
      submissionStatus: undefined,
      needsSupplement: undefined,
    }),
  );
  fireEvent.change(screen.getByLabelText(tr('documents.submissionFilter')), {
    target: { value: 'PENDING_REVIEW' },
  });
  fireEvent.click(screen.getByLabelText(tr('documents.onlyNeedsSupplement')));
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith(
      'synthetic-token',
      'site-a',
      expect.objectContaining({
        offset: 0,
        submissionStatus: 'PENDING_REVIEW',
        needsSupplement: true,
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
  await screen.findByRole('heading', { name: tr('documents.title') });
  await screen.findByRole('heading', { name: tr('documents.reviewQueue') });
  expect(await screen.findByText(/Nguyễn Văn An/)).toBeTruthy();
  expect(await screen.findByText(/card\.jpg/)).toBeTruthy();
  expect(screen.getByRole('button', { name: tr('documents.approve') })).toBeTruthy();
});

it('Worker role opens their own document panel directly', async () => {
  user = {
    id: 'user-worker',
    username: 'worker01',
    displayName: 'Nguyễn Văn Worker',
    roleAssignments: [{ role: 'WORKER', siteId: 'site-a' }],
    isActive: true,
    mustChangePassword: false,
  };
  vi.spyOn(SmartSiteManagementClient.prototype, 'myContractorTeam').mockResolvedValue({
    workerId: 'worker-1',
    displayName: 'Nguyễn Văn Worker',
    membershipId: null,
    teamId: 'team-1',
    teamName: 'Synthetic team',
    zones: [],
  });

  mount('/worker-documents?siteId=site-a');
  await screen.findByRole('heading', { name: tr('documents.title') });
  expect(screen.queryByRole('heading', { name: tr('documents.reviewQueue') })).toBeNull();
  expect(await screen.findByText(/card\.jpg/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: tr('documents.approve') })).toBeNull();
});

it('isolates query keys and child document scope by auth sessionScope across same-user sessions', async () => {
  const listSites = vi.mocked(SmartSiteManagementClient.prototype.listSites);
  const listQueue = vi.mocked(SmartSiteManagementClient.prototype.listWorkerCompliance);

  sessionScope = 'scope-alpha';
  const view = render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={['/worker-documents?siteId=site-a']}>
        <WorkerDocumentsView apiUrl="https://api.example.test" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await screen.findByText(/Nguyễn Văn An/);
  expect(
    cache.getQueryData([
      'worker-document-sites',
      'https://api.example.test',
      'scope-alpha',
      'user-safety',
    ]),
  ).toBeTruthy();
  expect(
    cache.getQueryData([
      'worker-document-queue',
      'https://api.example.test:scope-alpha:user-safety',
      'site-a',
      0,
      '',
      '',
      false,
    ]),
  ).toBeTruthy();
  expect(listSites).toHaveBeenCalledTimes(1);
  expect(listQueue).toHaveBeenCalledTimes(1);

  sessionScope = 'scope-beta';
  view.rerender(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={['/worker-documents?siteId=site-a']}>
        <WorkerDocumentsView apiUrl="https://api.example.test" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await waitFor(() => expect(listSites).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(listQueue).toHaveBeenCalledTimes(2));
  expect(
    cache.getQueryData([
      'worker-document-sites',
      'https://api.example.test',
      'scope-beta',
      'user-safety',
    ]),
  ).toBeTruthy();
  expect(
    cache.getQueryData([
      'worker-document-queue',
      'https://api.example.test:scope-beta:user-safety',
      'site-a',
      0,
      '',
      '',
      false,
    ]),
  ).toBeTruthy();
});

it('updates selected site and initialWorkerId when URL query params change in-place', async () => {
  user = {
    id: 'user-safety',
    username: 'safety',
    displayName: 'Safety Officer',
    roleAssignments: [
      { role: 'SAFETY_OFFICER', siteId: 'site-a' },
      { role: 'SAFETY_OFFICER', siteId: 'site-b' },
    ],
    isActive: true,
    mustChangePassword: false,
  };
  vi.mocked(SmartSiteManagementClient.prototype.listSites).mockResolvedValue({
    items: [
      {
        id: 'site-a',
        code: 'site-a',
        name: 'Công trường Alpha',
        createdAt: '2026-10-09T00:00:00Z',
      },
      {
        id: 'site-b',
        code: 'site-b',
        name: 'Công trường Beta',
        createdAt: '2026-10-09T00:00:00Z',
      },
    ],
    total: 2,
  });

  const worker2: WorkerComplianceResponse = {
    ...compliance,
    workerId: 'worker-2',
    displayName: 'Trần Thị Bình',
    externalId: 'W002',
  };
  const worker3: WorkerComplianceResponse = {
    ...compliance,
    workerId: 'worker-3',
    displayName: 'Lê Văn Cường',
    externalId: 'W003',
  };

  vi.mocked(SmartSiteManagementClient.prototype.listWorkerCompliance).mockImplementation(
    async (_token, siteId) => ({
      items: siteId === 'site-b' ? [worker2, worker3] : [compliance],
      total: siteId === 'site-b' ? 2 : 1,
    }),
  );
  const getDetail = vi
    .mocked(SmartSiteManagementClient.prototype.workerCompliance)
    .mockImplementation(async (_token, _siteId, workerId) => {
      if (workerId === 'worker-2') return worker2;
      if (workerId === 'worker-3') return worker3;
      return compliance;
    });

  function DeepLinkHarness() {
    const navigate = useNavigate();
    return (
      <>
        <button
          type="button"
          onClick={() =>
            navigate('/worker-documents?siteId=site-b&workerId=worker-2&tab=documents')
          }
        >
          jump-site-b-worker-2
        </button>
        <button
          type="button"
          onClick={() =>
            navigate('/worker-documents?siteId=site-b&workerId=worker-3&tab=documents')
          }
        >
          jump-site-b-worker-3
        </button>
        <WorkerDocumentsView apiUrl="https://api.example.test" />
      </>
    );
  }

  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter
        initialEntries={['/worker-documents?siteId=site-a&workerId=worker-1&tab=documents']}
      >
        <DeepLinkHarness />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await waitFor(() =>
    expect(getDetail).toHaveBeenCalledWith('synthetic-token', 'site-a', 'worker-1'),
  );
  expect((screen.getByLabelText(tr('common.site_fa7955')) as HTMLSelectElement).value).toBe(
    'site-a',
  );

  fireEvent.click(screen.getByRole('button', { name: 'jump-site-b-worker-2' }));
  await waitFor(() =>
    expect(getDetail).toHaveBeenCalledWith('synthetic-token', 'site-b', 'worker-2'),
  );
  expect((screen.getByLabelText(tr('common.site_fa7955')) as HTMLSelectElement).value).toBe(
    'site-b',
  );
  const worker2Heading = await screen.findByRole('heading', { name: 'Trần Thị Bình' });
  expect(within(worker2Heading.parentElement!).getByText('W002')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'jump-site-b-worker-3' }));
  await waitFor(() =>
    expect(getDetail).toHaveBeenCalledWith('synthetic-token', 'site-b', 'worker-3'),
  );
  const worker3Heading = await screen.findByRole('heading', { name: 'Lê Văn Cường' });
  expect(within(worker3Heading.parentElement!).getByText('W003')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Trần Thị Bình' })).toBeNull();
});

it('renders safe generic error in both EN and VI without leaking SQL or connection strings and retries only the relevant failed query', async () => {
  const listSites = vi.mocked(SmartSiteManagementClient.prototype.listSites);
  const myTeam = vi.spyOn(SmartSiteManagementClient.prototype, 'myContractorTeam');

  await i18n.changeLanguage('en');
  listSites.mockRejectedValueOnce(
    new Error('SELECT * FROM workers; postgres://admin:secret@db.internal:5432/smartsite'),
  );
  mount('/worker-documents?siteId=site-a');

  const enAlert = await screen.findByRole('alert');
  expect(within(enAlert).getByText(tr('errors.unexpected'))).toBeTruthy();
  expect(screen.queryByText(/SELECT \* FROM|postgres:\/\//)).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: tr('common.retry') }));
  await screen.findByText(/Nguyễn Văn An/);
  expect(listSites).toHaveBeenCalledTimes(2);
  expect(refetchCurrentUser).not.toHaveBeenCalled();
  expect(myTeam).not.toHaveBeenCalled();

  cleanup();
  cache.clear();
  await i18n.changeLanguage('vi');
  user = {
    id: 'user-worker',
    username: 'worker01',
    displayName: 'Nguyễn Văn Worker',
    roleAssignments: [{ role: 'WORKER', siteId: 'site-a' }],
    isActive: true,
    mustChangePassword: false,
  };
  myTeam
    .mockRejectedValueOnce(
      new Error(
        'SELECT * FROM contractor_teams; postgres://admin:secret@db.internal:5432/smartsite',
      ),
    )
    .mockResolvedValue({
      workerId: 'worker-1',
      displayName: 'Nguyễn Văn Worker',
      membershipId: null,
      teamId: 'team-1',
      teamName: 'Synthetic team',
      zones: [],
    });

  mount('/worker-documents?siteId=site-a');
  const viAlert = await screen.findByRole('alert');
  expect(within(viAlert).getByText(tr('errors.unexpected'))).toBeTruthy();
  expect(screen.queryByText(/SELECT \* FROM|postgres:\/\//)).toBeNull();

  listSites.mockClear();
  fireEvent.click(screen.getByRole('button', { name: tr('common.retry') }));
  expect(await screen.findByText(/card\.jpg/)).toBeTruthy();
  expect(myTeam).toHaveBeenCalledTimes(2);
  expect(listSites).not.toHaveBeenCalled();
  expect(refetchCurrentUser).not.toHaveBeenCalled();
});
