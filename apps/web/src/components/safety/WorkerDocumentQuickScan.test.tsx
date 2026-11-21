// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApiError,
  SmartSiteManagementClient,
  type WorkerComplianceResponse,
  type WorkerDocumentResponse,
} from '@smartsite/api-client';
import { WorkerDocumentQuickScan, WorkerDocumentAiStatus } from './WorkerDocumentQuickScan';
import i18n, { translate as tr } from '../../i18n';

let cache: QueryClient;
let client: SmartSiteManagementClient;
const document = (id: string): WorkerDocumentResponse => ({
  id,
  workerId: 'worker',
  kind: 'SAFETY_CARD',
  status: 'PENDING',
  originalName: id + '.png',
  mediaType: 'image/png',
  size: 1,
  ocr: { status: 'UNAVAILABLE', issuedOn: null, expiresOn: null, warnings: [] },
  issuedOn: null,
  expiresOn: null,
  submittedExpiresOn: '2099-01-01',
  uploadedAt: '2026-11-01T00:00:00Z',
  reviewedAt: null,
  reviewNote: null,
  version: 1,
});
const profile: WorkerComplianceResponse = {
  workerId: 'worker',
  contractorId: 'contractor',
  displayName: 'Synthetic Worker',
  externalId: 'W001',
  nationalId: null,
  phoneNumber: null,
  gender: null,
  address: null,
  identityImages: [],
  status: 'PENDING',
  submissionStatus: 'PENDING_REVIEW',
  needsSupplement: false,
  documents: [document('a'), document('b'), document('c')],
  missingKinds: [],
  expiringKinds: [],
};
beforeEach(async () => {
  await i18n.changeLanguage('vi');
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client = new SmartSiteManagementClient('https://api.example.test');
  vi.spyOn(client, 'workerCompliance').mockResolvedValue({
    ...profile,
    documents: profile.documents.map((doc) => ({
      ...doc,
      aiAnalysis: {
        status: 'COMPLETE',
        detectedKind: 'SAFETY_CARD',
        issuedOn: '2026-11-01',
        expiresOn: '2099-01-01',
        nationalId: null,
        kindMismatch: false,
        dateCheck: {
          status: 'MATCH',
          field: 'EXPIRES_ON',
          submittedDate: '2099-01-01',
          detectedDate: '2099-01-01',
        },
        identityCheck: 'NOT_DETECTED',
      },
    })),
  });
});
afterEach(() => {
  cleanup();
  cache.clear();
  vi.restoreAllMocks();
});
function mount(profiles = [profile]) {
  return render(
    <QueryClientProvider client={cache}>
      <WorkerDocumentQuickScan
        client={client}
        token="token"
        siteId="site"
        profiles={profiles}
        onUpdated={() => {}}
      />
    </QueryClientProvider>,
  );
}
it('scans only selected pending documents, sequentially, without reopening originals', async () => {
  let active = 0,
    max = 0;
  const scan = vi.spyOn(client, 'analyzeWorkerDocument').mockImplementation(async () => {
    max = Math.max(max, ++active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
  });
  const completed = {
    ...profile.documents[0]!,
    aiAnalysis: (await client.workerCompliance('token', 'site', 'worker')).documents[0]!.aiAnalysis,
  };
  mount([
    {
      ...profile,
      documents: [
        completed,
        profile.documents[1]!,
        { ...profile.documents[2]!, status: 'APPROVED' },
      ],
    },
  ]);
  await userEvent.setup().click(screen.getByRole('button', { name: tr('documents.quickScan') }));
  await waitFor(() => expect(scan).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: tr('documents.quickScan') }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect(scan).toHaveBeenCalledWith('token', 'site', 'worker', 'b');
  expect(max).toBe(1);
});
it('stop finishes the current document and never starts the next', async () => {
  let release!: () => void;
  const scan = vi.spyOn(client, 'analyzeWorkerDocument').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: tr('documents.quickScan') }));
  await waitFor(() => expect(scan).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole('button', { name: tr('documents.stopScan') }));
  release();
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: tr('documents.stopScan') })).toBeNull(),
  );
  expect(scan).toHaveBeenCalledTimes(1);
});
it('leaving the queue prevents later requests and stored results remain server owned', async () => {
  let release!: () => void;
  const scan = vi.spyOn(client, 'analyzeWorkerDocument').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const view = mount();
  await userEvent.setup().click(screen.getByRole('button', { name: tr('documents.quickScan') }));
  await waitFor(() => expect(scan).toHaveBeenCalledTimes(1));
  view.unmount();
  release();
  await new Promise((resolve) => setTimeout(resolve, 15));
  expect(scan).toHaveBeenCalledTimes(1);
});
it('attention label still shows the unresolved document count', () => {
  render(
    <WorkerDocumentAiStatus
      profile={{
        ...profile,
        aiSummary: { status: 'ATTENTION', pending: 3, complete: 1, unresolved: 2 },
      }}
    />,
  );
  expect(screen.getByText(tr('documents.aiStatus.ATTENTION'), { exact: false })).toBeTruthy();
  expect(screen.getByText(new RegExp(tr('documents.scanUnresolved', { count: 2 })))).toBeTruthy();
});

it.each([
  ['logout', new ApiError('http', 'Synthetic logout', 401)],
  ['lost permission', new ApiError('http', 'Synthetic denial', 403)],
  ['timeout', new ApiError('timeout', 'Synthetic timeout')],
  ['network loss', new ApiError('network', 'Synthetic network loss')],
] as const)('skips changed documents and stops later scans after %s', async (_label, error) => {
  const scan = vi
    .spyOn(client, 'analyzeWorkerDocument')
    .mockRejectedValueOnce(new ApiError('http', 'Synthetic document already reviewed', 409))
    .mockRejectedValueOnce(error)
    .mockResolvedValue(undefined);
  mount();
  await userEvent.setup().click(screen.getByRole('button', { name: tr('documents.quickScan') }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: tr('documents.stopScan') })).toBeNull(),
  );
  expect(scan).toHaveBeenCalledTimes(2);
  expect(
    screen.getByText(
      tr('documents.scanProgress', { done: 2, total: 3, success: 0, failed: 1, skipped: 1 }),
    ),
  ).toBeTruthy();
});
