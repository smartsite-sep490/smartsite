// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  SmartSiteManagementClient,
  type WorkerComplianceResponse,
  type WorkerDocumentResponse,
} from '@smartsite/api-client';
import { WorkerDocumentsPanel } from '../components/WorkerDocumentsPanel';
import i18n, { translate as tr } from '../../../i18n';

const health: WorkerDocumentResponse = {
  id: 'doc-1',
  workerId: 'worker',
  kind: 'HEALTH_CERTIFICATE',
  status: 'PENDING',
  originalName: 'synthetic-health.jpg',
  mediaType: 'image/jpeg',
  size: 123,
  issuedOn: null,
  expiresOn: null,
  submittedIssuedOn: format(new Date(Date.now() - 7 * 86_400_000), 'yyyy-MM-dd'),
  uploadedAt: '2026-10-17T00:00:00Z',
  reviewedAt: null,
  reviewNote: null,
  version: 3,
};
const base: WorkerComplianceResponse = {
  workerId: 'worker',
  contractorId: 'contractor',
  displayName: 'Synthetic Worker',
  externalId: 'W001',
  version: 4,
  identityVersion: 2,
  safetyCardRequired: false,
  nationalId: null,
  phoneNumber: null,
  gender: null,
  address: null,
  identityImages: [],
  status: 'PENDING',
  submissionStatus: 'PENDING_REVIEW',
  needsSupplement: false,
  documents: [health],
  missingKinds: [],
  expiringKinds: [],
};
let client: SmartSiteManagementClient;
let cache: QueryClient;
beforeEach(async () => {
  await i18n.changeLanguage('en');
  URL.createObjectURL = vi.fn(() => 'blob:synthetic');
  URL.revokeObjectURL = vi.fn();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client = new SmartSiteManagementClient('https://api.example.test');
  vi.spyOn(client, 'workerCompliance').mockResolvedValue(base);
  vi.spyOn(client, 'workerDocumentFile').mockResolvedValue(
    new Blob(['synthetic'], { type: 'image/jpeg' }),
  );
});
afterEach(() => {
  cleanup();
  cache.clear();
  vi.restoreAllMocks();
});
function mount(mode: 'safety' | 'rep' | 'worker') {
  render(
    <QueryClientProvider client={cache}>
      <WorkerDocumentsPanel
        client={client}
        token="token"
        siteId="site"
        workerId="worker"
        scope={mode}
        canReview={mode === 'safety'}
        canUpload={mode === 'rep'}
        canEditIdentity={mode === 'worker'}
      />
    </QueryClientProvider>,
  );
}

it('lets Safety approve declared dates after opening the original', async () => {
  const review = vi
    .spyOn(client, 'reviewWorkerDocument')
    .mockResolvedValue({ ...health, status: 'APPROVED' });
  mount('safety');
  const user = userEvent.setup();
  await screen.findByText(health.originalName);
  expect(screen.queryByRole('button', { name: tr('documents.aiRun') })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: tr('documents.examinationOn') })).toBeNull();
  const approve = screen.getByRole('button', { name: tr('documents.approve') });
  expect(approve).toHaveProperty('disabled', true);
  await user.click(screen.getByRole('button', { name: tr('documents.view') }));
  await user.click(await screen.findByRole('button', { name: tr('common.close_dialog') }));
  await user.click(approve);
  await waitFor(() =>
    expect(review).toHaveBeenCalledWith('token', 'site', 'worker', health.id, {
      expectedVersion: 3,
      approve: true,
      issuedOn: health.submittedIssuedOn,
      reviewNote: '',
    }),
  );
});

it('requires a reason to return a certificate', async () => {
  vi.mocked(client.workerCompliance).mockResolvedValue({
    ...base,
    documents: [{ ...health, submittedIssuedOn: null }],
  });
  const review = vi
    .spyOn(client, 'reviewWorkerDocument')
    .mockResolvedValue({ ...health, status: 'REJECTED' });
  mount('safety');
  const user = userEvent.setup();
  const reject = await screen.findByRole('button', { name: tr('documents.reject') });
  expect(screen.queryByRole('textbox')).toBeNull();
  await user.click(reject);
  const confirm = screen.getByRole('button', { name: tr('documents.confirmReturn') });
  expect(confirm).toHaveProperty('disabled', true);
  await user.type(screen.getByLabelText(tr('documents.returnNote')), 'Page missing');
  await user.click(confirm);
  await waitFor(() =>
    expect(review).toHaveBeenCalledWith('token', 'site', 'worker', health.id, {
      expectedVersion: 3,
      approve: false,
      reviewNote: 'Page missing',
    }),
  );
});

it('lets Safety complete a missing insurance start date before approval', async () => {
  const expiresOn = format(new Date(Date.now() + 30 * 86_400_000), 'yyyy-MM-dd');
  const insurance: WorkerDocumentResponse = {
    ...health,
    kind: 'PERSONAL_INSURANCE',
    submittedIssuedOn: null,
    submittedExpiresOn: expiresOn,
  };
  vi.mocked(client.workerCompliance).mockResolvedValue({ ...base, documents: [insurance] });
  const review = vi
    .spyOn(client, 'reviewWorkerDocument')
    .mockResolvedValue({ ...insurance, status: 'APPROVED' });
  mount('safety');
  const user = userEvent.setup();
  await screen.findByText(tr('documents.reviewDatesRequired'));
  expect(screen.getByText(tr('documents.notRequired'))).toBeTruthy();
  await user.click(screen.getByRole('button', { name: tr('documents.view') }));
  await user.click(await screen.findByRole('button', { name: tr('common.close_dialog') }));
  expect(screen.getByRole('button', { name: tr('documents.approve') })).toHaveProperty(
    'disabled',
    true,
  );
  await user.click(screen.getByRole('button', { name: tr('documents.editReviewDates') }));
  await user.click(screen.getByRole('button', { name: tr('documents.coverageStartsOn') }));
  await user.click(await screen.findByRole('button', { name: /today/i }));
  await user.click(screen.getByRole('button', { name: tr('common.done') }));
  await user.click(screen.getByRole('button', { name: tr('documents.approve') }));
  await waitFor(() =>
    expect(review).toHaveBeenCalledWith('token', 'site', 'worker', insurance.id, {
      expectedVersion: insurance.version,
      approve: true,
      issuedOn: format(new Date(), 'yyyy-MM-dd'),
      expiresOn,
      reviewNote: '',
    }),
  );
});

it('marks optional safety cards without presenting a missing document or review action', async () => {
  const oldCard: WorkerDocumentResponse = {
    ...health,
    id: 'archived-card',
    kind: 'SAFETY_CARD',
    status: 'SUPERSEDED',
    originalName: 'old-safety-card.jpg',
  };
  vi.mocked(client.workerCompliance).mockResolvedValue({ ...base, documents: [health, oldCard] });
  mount('safety');
  const user = userEvent.setup();
  await screen.findByText(health.originalName);
  await user.click(screen.getByRole('button', { name: new RegExp(tr('documents.SAFETY_CARD')) }));
  expect(screen.getByText(tr('documents.notRequired'))).toBeTruthy();
  expect(screen.queryByText(tr('documents.cardNotRequired'))).toBeNull();
  expect(screen.queryByText(tr('documents.noFile'), { selector: 'p' })).toBeNull();
  expect(screen.queryByRole('button', { name: tr('documents.approve') })).toBeNull();
  await user.click(screen.getByText(tr('documents.history')));
  await user.click(screen.getByRole('button', { name: tr('documents.view') }));
  await user.click(await screen.findByRole('button', { name: tr('common.close_dialog') }));
  expect(client.workerDocumentFile).toHaveBeenCalledWith('token', 'site', 'worker', oldCard.id);
  await user.click(screen.getByRole('button', { name: tr('documents.PERSONAL_INSURANCE') }));
  expect(
    screen.getByText(
      tr('documents.requiredFileMissing', { name: tr('documents.PERSONAL_INSURANCE') }),
    ),
  ).toBeTruthy();
});

it('shows actionable AI date discrepancies without rendering legacy identity fields', async () => {
  const declared = '2026-10-17';
  const detected = '2026-10-20';
  const analysis = {
    status: 'COMPLETE' as const,
    detectedKind: health.kind,
    kindMismatch: false,
    issuedOn: detected,
    expiresOn: '2027-10-20',
    dateCheck: {
      field: 'ISSUED_ON' as const,
      status: 'MISMATCH' as const,
      submittedDate: declared,
      detectedDate: detected,
    },
    nationalId: '000000000001',
    identityCheck: 'MISMATCH' as const,
  };
  vi.mocked(client.workerCompliance).mockResolvedValue({
    ...base,
    documents: [{ ...health, status: 'DRAFT', aiAnalysis: analysis }],
  });
  mount('rep');
  const discrepancy = await screen.findByText(tr('documents.aiDiscrepancy'));
  expect(discrepancy.closest('.bg-rose-50')).toBeTruthy();
  expect(screen.getByText(tr('documents.aiAdvisory'))).toBeTruthy();
  expect(
    screen.getByText(tr('documents.aiComparisonValues', { declared, detected }), {
      selector: 'span',
    }),
  ).toBeTruthy();
  expect(screen.queryByText('000000000001')).toBeNull();
  expect(screen.getByText(tr('documents.aiComparisonDetails')).closest('details')?.open).toBe(
    false,
  );
});

it('keeps AI optional and sends the selected worker draft version explicitly', async () => {
  vi.mocked(client.workerCompliance).mockResolvedValue({
    ...base,
    canSubmit: true,
    submissionStatus: 'NOT_SUBMITTED',
    documents: [{ ...health, status: 'DRAFT', aiAnalysis: { status: 'UNAVAILABLE' } }],
  });
  const analyze = vi.spyOn(client, 'analyzeWorkerDocument');
  const send = vi
    .spyOn(client, 'sendWorkerDocumentsBatch')
    .mockResolvedValue({ items: [{ id: 'worker', status: 'SUCCEEDED' }] });
  mount('rep');
  const user = userEvent.setup();
  await screen.findByText(tr('documents.aiUnavailable'));
  await user.click(screen.getByRole('button', { name: tr('workerIntake.send') }));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith('token', 'site', 'contractor', [
      { id: 'worker', version: 4 },
    ]),
  );
  expect(analyze).not.toHaveBeenCalled();
});

it('shows the returned reason beside the file and stages a replacement', async () => {
  const returned = { ...health, status: 'REJECTED' as const, reviewNote: 'Page missing' };
  const approved = {
    ...health,
    id: 'older',
    status: 'APPROVED' as const,
    uploadedAt: '2026-01-01T00:00:00Z',
    expiresOn: '2027-01-01',
  };
  vi.mocked(client.workerCompliance).mockResolvedValue({
    ...base,
    documents: [returned, approved],
  });
  const save = vi.spyOn(client, 'submitWorkerDocuments').mockResolvedValue({
    requestId: 'request',
    version: 5,
    documentIds: ['replacement'],
  });
  mount('rep');
  const user = userEvent.setup();
  await screen.findByText(tr('workerIntake.returnReason', { reason: 'Page missing' }));
  expect(screen.getByText(tr('documents.expiresOn') + ': 2027-01-01')).toBeTruthy();
  await user.click(
    screen.getByRole('button', {
      name: tr('workerIntake.replaceAttachment', { name: tr('documents.HEALTH_CERTIFICATE') }),
    }),
  );
  const replacement = new File(['synthetic'], 'replacement.jpg', { type: 'image/jpeg' });
  await user.upload(screen.getByLabelText(tr('documents.HEALTH_CERTIFICATE')), replacement);
  const date = format(new Date(), 'yyyy-MM-dd');
  await user.click(screen.getByRole('button', { name: tr('documents.submittedIssuedOn') }));
  await user.click(await screen.findByRole('button', { name: /today/i }));
  await user.click(screen.getByRole('button', { name: tr('workerIntake.save') }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      'token',
      'site',
      'worker',
      expect.objectContaining({
        expectedVersion: 4,
        documents: { HEALTH_CERTIFICATE: { submittedIssuedOn: date } },
      }),
      { HEALTH_CERTIFICATE: replacement },
    ),
  );
});

it('lets the worker edit their own identity and preview both files before saving', async () => {
  const update = vi.spyOn(client, 'updateMyWorkerIdentity').mockResolvedValue({ version: 3 });
  mount('worker');
  const user = userEvent.setup();
  await user.click(await screen.findByText(tr('documents.personalDetails')));
  await user.click(screen.getByRole('button', { name: tr('workerIntake.editIdentity') }));
  await user.type(screen.getByLabelText(tr('documents.nationalId')), '000000000001');
  await user.type(screen.getByLabelText(tr('documents.phoneNumber')), '0900000001');
  await user.selectOptions(screen.getByLabelText(tr('documents.gender')), 'MALE');
  await user.type(screen.getByLabelText(tr('documents.address')), 'Synthetic address');
  const front = new File(['synthetic front'], 'front.jpg', { type: 'image/jpeg' });
  const back = new File(['synthetic back'], 'back.jpg', { type: 'image/jpeg' });
  const save = screen.getByRole('button', { name: tr('workerIntake.saveIdentity') });
  await user.upload(screen.getByLabelText(tr('documents.FRONT')), front);
  expect(save).toHaveProperty('disabled', true);
  await user.upload(screen.getByLabelText(tr('documents.BACK')), back);
  expect(screen.getByRole('img', { name: tr('documents.FRONT') })).toBeTruthy();
  expect(screen.getByRole('img', { name: tr('documents.BACK') })).toBeTruthy();
  await user.click(save);
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(
      'token',
      'site',
      {
        expectedVersion: 2,
        nationalId: '000000000001',
        phoneNumber: '0900000001',
        gender: 'MALE',
        address: 'Synthetic address',
      },
      { FRONT: front, BACK: back },
    ),
  );
});
