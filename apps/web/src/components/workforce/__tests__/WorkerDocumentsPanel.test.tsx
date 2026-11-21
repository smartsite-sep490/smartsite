// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  type WorkerComplianceResponse,
  type WorkerDocumentResponse,
} from '@smartsite/api-client';
import { WorkerDocumentsPanel } from '../components/WorkerDocumentsPanel';
import i18n, { translate as tr } from '../../../i18n';
let cache: QueryClient;
let client: SmartSiteManagementClient;
const doc: WorkerDocumentResponse = {
  id: 'document',
  workerId: 'worker',
  kind: 'SAFETY_CARD',
  status: 'PENDING',
  originalName: 'synthetic-card.jpg',
  mediaType: 'image/jpeg',
  size: 123,
  ocr: {
    status: 'READ',
    issuedOn: '2026-10-17',
    expiresOn: '2028-10-17',
    warnings: ['OFFICER_MUST_CONFIRM_DATES'],
  },
  issuedOn: null,
  expiresOn: null,
  uploadedAt: '2026-10-17T00:00:00Z',
  reviewedAt: null,
  reviewNote: null,
  version: 3,
};
beforeEach(async () => {
  await i18n.changeLanguage('vi');
  URL.createObjectURL = vi.fn(() => 'blob:synthetic-card');
  URL.revokeObjectURL = vi.fn();
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client = new SmartSiteManagementClient('https://api.example.test');
  const profile: WorkerComplianceResponse = {
    workerId: 'worker',
    contractorId: 'contractor',
    displayName: 'Synthetic Worker',
    externalId: 'W001',
    nationalId: '000000000001',
    phoneNumber: '0900000001',
    gender: 'MALE',
    address: 'Synthetic address',
    identityImages: [],
    status: 'PENDING',
    submissionStatus: 'PENDING_REVIEW',
    needsSupplement: true,
    documents: [doc],
    missingKinds: ['SAFETY_CARD', 'HEALTH_CERTIFICATE', 'PERSONAL_INSURANCE'],
    expiringKinds: [],
  };
  vi.spyOn(client, 'workerCompliance').mockResolvedValue(profile);
  vi.spyOn(client, 'reviewWorkerDocument').mockResolvedValue({
    ...doc,
    status: 'APPROVED',
    issuedOn: '2026-10-17',
    expiresOn: '2028-10-17',
    version: 4,
  });
  vi.spyOn(client, 'workerDocumentFile').mockResolvedValue(
    new Blob(['synthetic'], { type: 'image/jpeg' }),
  );
});
afterEach(() => {
  cleanup();
  cache.clear();
  vi.restoreAllMocks();
});
it('completed documents start collapsed instead of using a test-only expanded layout', async () => {
  const profile = await client.workerCompliance('token', 'site', 'worker');
  vi.mocked(client.workerCompliance).mockResolvedValue({
    ...profile,
    documents: [{ ...doc, status: 'APPROVED' }],
  });
  mount(true);
  await screen.findByRole('heading', { name: /Synthetic Worker/ });
  expect(screen.queryByText(doc.originalName)).toBeNull();
});
it('opens pending documents and respects a manual collapse after refresh', async () => {
  mount(true);
  await screen.findByText(doc.originalName);
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: new RegExp(tr('documents.SAFETY_CARD')) }));
  expect(screen.queryByText(doc.originalName)).toBeNull();
  const calls = vi.mocked(client.workerCompliance).mock.calls.length;
  await cache.invalidateQueries();
  expect(vi.mocked(client.workerCompliance).mock.calls.length).toBeGreaterThan(calls);
  expect(screen.queryByText(doc.originalName)).toBeNull();
});
it('shows the citizen ID warning to Safety without blocking explicit approval', async () => {
  const profile = await client.workerCompliance('token', 'site', 'worker');
  vi.mocked(client.workerCompliance).mockResolvedValue({
    ...profile,
    documents: [
      { ...doc, identityCheck: { status: 'MISMATCH', detectedNationalIds: ['000000000099'] } },
    ],
  });
  mount(true);
  const user = userEvent.setup();
  await screen.findByText(tr('documents.identityMismatch'));
  expect(
    screen.getByText(
      tr('documents.identityValues', { expected: '000000000001', detected: '000000000099' }),
    ),
  ).toBeTruthy();
  await user.click(screen.getByRole('button', { name: tr('documents.view') }));
  await user.click(await screen.findByRole('button', { name: tr('common.close_dialog') }));
  await user.type(screen.getByLabelText(tr('documents.note')), 'Original checked despite warning');
  await user.click(screen.getByLabelText(tr('documents.confirm')));
  const approve = screen.getByRole('button', {
    name: tr('documents.approve'),
  }) as HTMLButtonElement;
  expect(approve.disabled).toBe(false);
  await user.click(approve);
  await waitFor(() => expect(client.reviewWorkerDocument).toHaveBeenCalled());
});
it('shows mismatched ID warnings on originals to the read-only Worker too', async () => {
  const profile = await client.workerCompliance('token', 'site', 'worker');
  vi.mocked(client.workerCompliance).mockResolvedValue({
    ...profile,
    documents: [
      { ...doc, identityCheck: { status: 'MISMATCH', detectedNationalIds: ['000000000099'] } },
    ],
    identityImages: [
      {
        id: 'id-front',
        side: 'FRONT',
        mediaType: 'image/jpeg',
        originalName: 'synthetic-id.jpg',
        uploadedAt: '2026-10-17T00:00:00Z',
        identityCheck: { status: 'MISMATCH', detectedNationalIds: ['000000000099'] },
      },
    ],
  });
  mount(false);
  await screen.findAllByText(tr('documents.identityMismatch'));
  expect(screen.getAllByText(tr('documents.identityMismatch')).length).toBe(2);
  expect(screen.queryByRole('button', { name: tr('documents.approve') })).toBeNull();
});
function mount(canReview: boolean, canUpload = false) {
  render(
    <QueryClientProvider client={cache}>
      <WorkerDocumentsPanel
        client={client}
        token="token"
        siteId="site"
        workerId="worker"
        scope="synthetic-reviewer"
        canReview={canReview}
        canUpload={canUpload}
      />
    </QueryClientProvider>,
  );
}
it('prefills OCR suggestions but requires explicit original/date confirmation before Safety approval', async () => {
  mount(true);
  const user = userEvent.setup();
  await screen.findByText(/synthetic-card.jpg/);
  const approve = screen.getByRole('button', {
    name: tr('documents.approve'),
  }) as HTMLButtonElement;
  expect(approve.disabled).toBe(true);
  expect(screen.getByLabelText(tr('documents.expiresOn')).textContent).toContain('17/10/2028');
  await user.type(screen.getByLabelText(tr('documents.note')), 'Original checked');
  expect(approve.disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: tr('documents.view') }));
  await screen.findByRole('dialog', { name: tr('documents.view') });
  await user.keyboard('{Escape}');
  expect(client.workerDocumentFile).toHaveBeenCalledWith('token', 'site', 'worker', 'document');
  await user.click(screen.getByLabelText(tr('documents.confirm')));
  await user.click(approve);
  await waitFor(() =>
    expect(client.reviewWorkerDocument).toHaveBeenCalledWith(
      'token',
      'site',
      'worker',
      'document',
      {
        expectedVersion: 3,
        approve: true,
        issuedOn: '2026-10-17',
        expiresOn: '2028-10-17',
        reviewNote: 'Original checked',
      },
    ),
  );
});
it('read-only Worker documents expose originals and status without review or upload controls', async () => {
  mount(false);
  await screen.findByText(/synthetic-card.jpg/);
  expect(screen.queryByRole('button', { name: tr('documents.approve') })).toBeNull();
  expect(screen.queryByLabelText(tr('documents.note'))).toBeNull();
  expect(screen.queryByText(tr('documents.upload'))).toBeNull();
  expect(screen.getByRole('button', { name: tr('documents.view') })).toBeTruthy();
});
it('prefills the Representative date when OCR cannot determine expiry and still requires confirmation', async () => {
  const profile = await client.workerCompliance('token', 'site', 'worker');
  vi.mocked(client.workerCompliance).mockResolvedValue({
    ...profile,
    documents: [{ ...doc, submittedExpiresOn: '2027-10-18', ocr: { ...doc.ocr, expiresOn: null } }],
  });
  mount(true);
  const expiry = await screen.findByLabelText(tr('documents.expiresOn'));
  expect(expiry.textContent).toContain('18/10/2027');
  expect(
    (screen.getByRole('button', { name: tr('documents.approve') }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(`${tr('documents.submittedExpiryLabel')}: 2027-10-18`)).toBeTruthy();
});
it('health review uses only the confirmed issue date, with a read-only one-year expiry', async () => {
  const profile = await client.workerCompliance('token', 'site', 'worker');
  vi.mocked(client.workerCompliance).mockResolvedValue({
    ...profile,
    documents: [
      {
        ...doc,
        kind: 'HEALTH_CERTIFICATE',
        ocr: { ...doc.ocr, issuedOn: '2026-10-18', expiresOn: '2026-11-01' },
      },
    ],
  });
  mount(true);
  const user = userEvent.setup();
  const expiry = await screen.findByLabelText(tr('documents.expiresOn'));
  expect(expiry.tagName).toBe('OUTPUT');
  expect(expiry.textContent).toBe('18/10/2027');
  await chooseCalendarDate(tr('documents.issuedOn'), '2026-10-17');
  expect(expiry.textContent).toBe('17/10/2027');
  await user.type(screen.getByLabelText(tr('documents.note')), 'Original date checked');
  await user.click(screen.getByLabelText(tr('documents.confirm')));
  await user.click(screen.getByRole('button', { name: tr('documents.approve') }));
  await waitFor(() =>
    expect(client.reviewWorkerDocument).toHaveBeenCalledWith(
      'token',
      'site',
      'worker',
      'document',
      {
        expectedVersion: 3,
        approve: true,
        issuedOn: '2026-10-17',
        reviewNote: 'Original date checked',
      },
    ),
  );
});
it('Safety hides citizen ID OCR controls and keeps the mismatch warning concise', async () => {
  const profile = await client.workerCompliance('token', 'site', 'worker');
  vi.mocked(client.workerCompliance).mockResolvedValue({
    ...profile,
    identityImages: [
      {
        id: 'front',
        side: 'FRONT',
        mediaType: 'image/jpeg',
        originalName: 'synthetic.jpg',
        uploadedAt: doc.uploadedAt,
        identityCheck: { status: 'MISMATCH', detectedNationalIds: ['000000000099'] },
      },
    ],
  });
  mount(true);
  await screen.findByText(tr('documents.identityMismatch'));
  expect(screen.queryByText(tr('documents.identityAdvisory'))).toBeNull();
  expect(screen.getAllByRole('button', { name: tr('documents.ocr') })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: tr('documents.view') })).toHaveLength(2);
});

it('Representative has one bundle submission form and Workers have no write controls', async () => {
  mount(false, true);
  await screen.findByRole('button', { name: tr('documents.sendBundle') });
  expect(screen.getByLabelText(tr('documents.safetyCardRequired'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: tr('documents.submitForReview') })).toBeNull();
});
it('opening an original never calls OpenAI or displays an AI trigger inside the preview', async () => {
  const analyze = vi.spyOn(client, 'analyzeWorkerDocument');
  mount(true);
  await screen.findByText(doc.originalName);
  await userEvent.setup().click(screen.getByRole('button', { name: tr('documents.view') }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByRole('button', { name: tr('documents.aiRun') })).toBeNull();
  expect(analyze).not.toHaveBeenCalled();
});
async function chooseCalendarDate(label: string, date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(label));
  await user.selectOptions(
    screen.getByRole('combobox', { name: tr('calendar.year') }),
    String(year),
  );
  await user.selectOptions(
    screen.getByRole('combobox', { name: tr('calendar.month') }),
    String((month ?? 1) - 1),
  );
  await user.click(screen.getByRole('button', { name: new RegExp(`${day}.*${year}`) }));
}

it('never invents gender when a Representative corrects a legacy identity profile', async () => {
  const current = await client.workerCompliance('token', 'site', 'worker');
  vi.mocked(client.workerCompliance).mockResolvedValue({ ...current, gender: null });
  const submit = vi
    .spyOn(client, 'submitWorkerDocuments')
    .mockResolvedValue({ requestId: 'test', version: 2, documentIds: [] });
  mount(false, true);
  await screen.findByRole('button', { name: tr('documents.sendBundle') });
  const user = userEvent.setup();
  await user.click(document.querySelector('form summary')!);
  expect((screen.getByLabelText(tr('documents.gender')) as HTMLSelectElement).value).toBe('');
  await user.clear(screen.getByLabelText(tr('documents.phoneNumber')));
  await user.type(screen.getByLabelText(tr('documents.phoneNumber')), '0900000009');
  await user.click(screen.getByRole('button', { name: tr('documents.sendBundle') }));
  await screen.findByText(tr('documents.required'));
  expect(submit).not.toHaveBeenCalled();
});
