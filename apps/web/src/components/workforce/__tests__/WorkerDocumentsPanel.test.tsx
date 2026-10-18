// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  expect((screen.getByLabelText(tr('documents.expiresOn')) as HTMLInputElement).value).toBe(
    '2028-10-17',
  );
  await user.type(screen.getByLabelText(tr('documents.note')), 'Original checked');
  expect(approve.disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: tr('documents.view') }));
  await screen.findByRole('dialog', { name: tr('documents.view') });
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
it('lets Representatives enter a missing expiry on pending documents without review permission', async () => {
  const save = vi
    .spyOn(client, 'updateWorkerDocumentExpiry')
    .mockResolvedValue({ ...doc, submittedExpiresOn: '2027-10-18', version: 4 });
  mount(false, true);
  const user = userEvent.setup();
  const field = await screen.findByLabelText(tr('documents.submittedExpiresOn'));
  await user.type(field, '2027-10-18');
  await user.click(screen.getByRole('button', { name: tr('documents.saveSubmittedExpiry') }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith('token', 'site', 'worker', 'document', {
      expectedVersion: 3,
      submittedExpiresOn: '2027-10-18',
    }),
  );
  expect(client.reviewWorkerDocument).not.toHaveBeenCalled();
});
it('prefills the Representative date when OCR cannot determine expiry and still requires confirmation', async () => {
  const profile = await client.workerCompliance('token', 'site', 'worker');
  vi.mocked(client.workerCompliance).mockResolvedValue({
    ...profile,
    documents: [{ ...doc, submittedExpiresOn: '2027-10-18', ocr: { ...doc.ocr, expiresOn: null } }],
  });
  mount(true);
  const expiry = (await screen.findByLabelText(tr('documents.expiresOn'))) as HTMLInputElement;
  expect(expiry.value).toBe('2027-10-18');
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
  const expiry = (await screen.findByLabelText(tr('documents.expiresOn'))) as HTMLInputElement;
  expect(expiry.readOnly).toBe(true);
  expect(expiry.value).toBe('2027-10-18');
  const issued = screen.getByLabelText(tr('documents.issuedOn'));
  await user.clear(issued);
  await user.type(issued, '2026-10-17');
  expect(expiry.value).toBe('2027-10-17');
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
