// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import {
  SmartSiteManagementClient,
  type WorkerComplianceResponse,
  type WorkerDocumentResponse,
  type WorkerOnboardingDraft,
} from '@smartsite/api-client';
import { WorkerOnboardingView } from '../components/WorkerOnboardingView';
import i18n, { translate as tr } from '../../../i18n';

vi.mock('../../../features/auth/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../features/auth/auth-session')>()),
  useAuth: () => ({ accessToken: 'representative-token' }),
  useCurrentUser: () => ({
    data: {
      id: 'representative',
      mustChangePassword: false,
      roleAssignments: [{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-a' }],
    },
    isPending: false,
    isError: false,
  }),
}));

const baseRow: WorkerOnboardingDraft = {
  id: 'draft-1',
  version: 1,
  displayName: 'First Worker',
  username: 'first',
  email: 'first@example.test',
  safetyCardRequired: false,
  documents: {},
  workerId: null,
  workerCode: null,
  workerVersion: null,
  canProvision: true,
  canSubmit: false,
  missingKinds: [],
  submissionStatus: 'NOT_SUBMITTED',
};

let cache: QueryClient;
beforeEach(async () => {
  await i18n.changeLanguage('en');
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    total: 2,
    items: ['site-a', 'other-site'].map((id) => ({ id, code: id, name: id, createdAt: '' })),
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'contractorWorkerAccountOptions').mockResolvedValue(
    { contractors: [{ id: 'contractor', name: 'Test Contractor' }] },
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'listWorkerOnboardingDrafts').mockResolvedValue({
    items: [],
  });
});
afterEach(() => {
  cleanup();
  cache.clear();
  vi.restoreAllMocks();
});
function mount() {
  return render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <WorkerOnboardingView apiUrl="https://api.example.test" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('saves an incomplete intake without creating an account or requesting CCCD', async () => {
  const save = vi
    .spyOn(SmartSiteManagementClient.prototype, 'saveWorkerOnboardingDraft')
    .mockResolvedValue({ ...baseRow, canProvision: false, missingKinds: ['HEALTH_CERTIFICATE'] });
  const provision = vi.spyOn(SmartSiteManagementClient.prototype, 'provisionWorkerOnboardingBatch');
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: tr('workerIntake.add') }));
  await user.type(screen.getByLabelText(tr('common.full_name')), 'First Worker');
  const attachment = new File(['sample'], 'health.png', { type: 'image/png' });
  await user.upload(screen.getByLabelText(tr('documents.HEALTH_CERTIFICATE')), attachment);
  expect(screen.queryByLabelText(tr('documents.nationalId'))).toBeNull();
  await user.click(screen.getByRole('button', { name: tr('workerIntake.saveNext') }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      'representative-token',
      'site-a',
      'contractor',
      expect.any(String),
      expect.objectContaining({
        expectedVersion: 0,
        displayName: 'First Worker',
        username: '',
        email: '',
        documents: { HEALTH_CERTIFICATE: {} },
      }),
      { HEALTH_CERTIFICATE: attachment },
    ),
  );
  expect(provision).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.getByLabelText(tr('common.full_name'))).toHaveProperty('value', ''),
  );
});

it('opens the selected draft in a keyboard-accessible drawer and keeps the site in the roster link', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listWorkerOnboardingDrafts).mockResolvedValue({
    items: [baseRow],
  });
  mount();
  const user = userEvent.setup();
  const rosterLink = await screen.findByRole('link', { name: tr('workerIntake.recordTitle') });
  expect(rosterLink.getAttribute('href')).toBe('/worker-documents?siteId=site-a');
  const edit = await screen.findByRole('button', { name: tr('workerIntake.edit') });
  await user.click(edit);
  const drawer = screen.getByRole('dialog', { name: tr('workerIntake.edit') });
  expect(document.activeElement).toBe(within(drawer).getByLabelText(tr('common.full_name')));
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(edit);
});

it('preserves the insurance start date when an optional draft expiry is cleared', async () => {
  const row: WorkerOnboardingDraft = {
    ...baseRow,
    documents: {
      PERSONAL_INSURANCE: { submittedIssuedOn: '2026-11-10', submittedExpiresOn: '2027-11-09' },
    },
  };
  vi.mocked(SmartSiteManagementClient.prototype.listWorkerOnboardingDrafts).mockResolvedValue({
    items: [row],
  });
  const save = vi
    .spyOn(SmartSiteManagementClient.prototype, 'saveWorkerOnboardingDraft')
    .mockResolvedValue(row);
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: tr('workerIntake.edit') }));
  const form = within(screen.getByRole('dialog', { name: tr('workerIntake.edit') }));
  const start = form.getByRole('button', { name: tr('documents.coverageStartsOn') });
  const expiry = form.getByRole('button', { name: tr('documents.expiresOn') });
  expect(start.textContent).toContain('10/11/2026');
  expect(expiry.textContent).toContain('09/11/2027');
  await user.click(within(expiry).getByRole('button', { name: tr('common.clear') }));
  await user.click(form.getByRole('button', { name: tr('workerIntake.save') }));
  await waitFor(() =>
    expect(save.mock.calls[0]?.[4].documents).toEqual({
      PERSONAL_INSURANCE: { submittedIssuedOn: '2026-11-10', submittedExpiresOn: undefined },
    }),
  );
});

it('summarizes document alerts, unclear findings and unavailable analysis while keeping sending enabled', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listWorkerOnboardingDrafts).mockResolvedValue({
    items: [
      {
        ...baseRow,
        workerId: 'worker-1',
        workerVersion: 3,
        canProvision: false,
        canSubmit: true,
      },
    ],
  });
  const issue: NonNullable<WorkerDocumentResponse['aiAnalysis']> = {
    status: 'COMPLETE',
    detectedKind: 'HEALTH_CERTIFICATE',
    issuedOn: '2026-10-01',
    expiresOn: null,
    kindMismatch: false,
    dateCheck: {
      status: 'MISMATCH',
      field: 'ISSUED_ON',
      submittedDate: '2026-11-01',
      detectedDate: '2026-10-01',
    },
    validity: 'CURRENT',
  };
  const certificate: WorkerDocumentResponse = {
    id: 'certificate',
    workerId: 'worker-1',
    kind: 'HEALTH_CERTIFICATE',
    originalName: 'certificate.png',
    status: 'DRAFT',
    version: 1,
    mediaType: 'image/png',
    size: 10,
    issuedOn: null,
    expiresOn: null,
    uploadedAt: '',
    reviewedAt: null,
    reviewNote: null,
  };
  const documents: WorkerDocumentResponse[] = [
    { ...certificate, aiAnalysis: issue },
    {
      ...certificate,
      id: 'insurance',
      kind: 'PERSONAL_INSURANCE',
      aiAnalysis: {
        ...issue,
        detectedKind: null,
        dateCheck: { ...issue.dateCheck, status: 'UNAVAILABLE' },
      },
    },
    { ...certificate, id: 'card', kind: 'SAFETY_CARD' },
  ];
  vi.spyOn(SmartSiteManagementClient.prototype, 'workerCompliance').mockResolvedValue({
    documents,
  } as WorkerComplianceResponse);
  const analyze = vi
    .spyOn(SmartSiteManagementClient.prototype, 'analyzeWorkerDocument')
    .mockRejectedValue(new Error('Analysis unavailable'));
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('checkbox', { name: tr('documents.selectPage') }));
  await user.click(screen.getByRole('button', { name: tr('documents.aiAnalysis') }));
  expect(await screen.findByText(tr('workerIntake.aiAttentionCount', { count: 1 }))).toBeTruthy();
  expect(screen.getByText(tr('workerIntake.aiInsufficientCount', { count: 1 }))).toBeTruthy();
  expect(screen.getByText(tr('workerIntake.aiUnavailableCount', { count: 1 }))).toBeTruthy();
  await user.click(screen.getByRole('checkbox', { name: tr('documents.selectPage') }));
  const result = screen.getByText(tr('workerIntake.aiViewResults'));
  await user.click(result);
  expect(result.closest('details')).toHaveProperty('open', true);
  const report = within(screen.getByRole('region', { name: tr('workerIntake.aiViewResults') }));
  expect(report.getByRole('heading', { name: 'First Worker' })).toBeTruthy();
  expect(report.getByRole('heading', { name: tr('documents.HEALTH_CERTIFICATE') })).toBeTruthy();
  expect(report.getByText(tr('documents.aiDiscrepancy'))).toBeTruthy();
  expect(report.getByText(/2026-11-01.*2026-10-01/, { selector: 'span' })).toBeTruthy();
  expect(report.getByText(tr('documents.aiUnavailable'))).toBeTruthy();
  expect(analyze).toHaveBeenCalledExactlyOnceWith(
    'representative-token',
    'site-a',
    'worker-1',
    'card',
  );
  await user.click(screen.getByRole('checkbox', { name: tr('documents.selectPage') }));
  expect(
    screen.getByRole('button', { name: tr('workerIntake.sendCount', { count: 1 }) }),
  ).toHaveProperty('disabled', false);
});

it('creates selected ready rows one batch at a time and shows each row result', async () => {
  const rows = [baseRow, { ...baseRow, id: 'draft-2', displayName: 'Second Worker' }];
  vi.mocked(SmartSiteManagementClient.prototype.listWorkerOnboardingDrafts).mockResolvedValue({
    items: rows,
  });
  const provision = vi
    .spyOn(SmartSiteManagementClient.prototype, 'provisionWorkerOnboardingBatch')
    .mockResolvedValue({
      items: [
        { id: 'draft-1', status: 'SUCCEEDED', workerId: 'worker-1' },
        { id: 'draft-2', status: 'FAILED', error: { code: 'CONFLICT', message: 'Already used' } },
      ],
    });
  mount();
  const user = userEvent.setup();
  await screen.findByText('First Worker');
  await user.click(screen.getByRole('checkbox', { name: tr('documents.selectPage') }));
  await user.click(
    screen.getByRole('button', { name: tr('workerIntake.provisionCount', { count: 2 }) }),
  );
  await waitFor(() =>
    expect(provision).toHaveBeenCalledWith('representative-token', 'site-a', 'contractor', [
      { id: 'draft-1', version: 1 },
      { id: 'draft-2', version: 1 },
    ]),
  );
  const failed = screen.getByRole('row', { name: /Second Worker/ });
  expect(within(failed).getByText(tr('errors.conflict'))).toBeTruthy();
  expect(within(failed).getByRole('checkbox')).toHaveProperty('checked', true);
  expect(
    within(screen.getByRole('row', { name: /First Worker/ })).getByRole('checkbox'),
  ).toHaveProperty('checked', false);
});

it('sends the provisioned worker IDs and current document revisions together', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listWorkerOnboardingDrafts).mockResolvedValue({
    items: [
      {
        ...baseRow,
        workerId: 'worker-1',
        workerCode: 'W000001',
        workerVersion: 3,
        canProvision: false,
        canSubmit: true,
      },
    ],
  });
  const send = vi
    .spyOn(SmartSiteManagementClient.prototype, 'sendWorkerDocumentsBatch')
    .mockResolvedValue({ items: [{ id: 'worker-1', status: 'SUCCEEDED', workerId: 'worker-1' }] });
  mount();
  const user = userEvent.setup();
  await screen.findByText('First Worker');
  await user.click(screen.getByRole('checkbox', { name: tr('documents.selectPage') }));
  await user.click(
    screen.getByRole('button', { name: tr('workerIntake.sendCount', { count: 1 }) }),
  );
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith('representative-token', 'site-a', 'contractor', [
      { id: 'worker-1', version: 3 },
    ]),
  );
});
