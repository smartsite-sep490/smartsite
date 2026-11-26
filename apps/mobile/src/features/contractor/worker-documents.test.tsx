import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Pressable, Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WorkerComplianceResponse, WorkerDocumentResponse } from '@smartsite/api-client';
import { WorkerDocuments } from './worker-documents';
import { translate as t } from '../../i18n';
import { Button } from '../shared/ui';
import { CalendarDateField } from '../shared/calendar-date-field';
import { SingleDocumentAttachment } from '../shared/uploads';

vi.mock('../workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
vi.mock('../shared/uploads', () => ({
  SingleDocumentAttachment: () => null,
  EvidenceButton: () => null,
}));

const insurance: WorkerDocumentResponse = {
  id: 'insurance',
  workerId: 'worker',
  kind: 'PERSONAL_INSURANCE',
  status: 'REJECTED',
  originalName: 'insurance.pdf',
  mediaType: 'application/pdf',
  size: 100,
  issuedOn: null,
  expiresOn: null,
  uploadedAt: '2026-10-17T00:00:00Z',
  reviewedAt: null,
  reviewNote: 'Missing confirmation page',
  version: 1,
};
const profile: WorkerComplianceResponse = {
  workerId: 'worker',
  contractorId: 'contractor',
  displayName: 'Synthetic Worker',
  externalId: 'W001',
  nationalId: null,
  phoneNumber: null,
  gender: null,
  address: null,
  status: 'PENDING',
  submissionStatus: 'REVIEWED',
  needsSupplement: true,
  missingKinds: ['PERSONAL_INSURANCE'],
  expiringKinds: [],
  identityImages: [],
  documents: [insurance],
  version: 3,
  safetyCardRequired: false,
};
const client = {
  workerCompliance: vi.fn(),
  submitWorkerDocuments: vi.fn(),
  analyzeWorkerDocument: vi.fn(),
  sendWorkerDocumentsBatch: vi.fn(),
};
const workspace = {
  client,
  token: 'token',
  queryKey: ['mobile', 'documents'],
  scope: { siteId: 'site', contractorId: 'contractor' },
};
let root: ReactTestRenderer;
let cache: QueryClient;
afterEach(async () => {
  await act(async () => root?.unmount());
  cache?.clear();
  vi.resetAllMocks();
});

function button(label: string) {
  return root.root.findAllByType(Button).find((node) => node.props.label === label);
}

async function mount(value: WorkerComplianceResponse, canUpload: boolean) {
  client.workerCompliance.mockResolvedValue(value);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <WorkerDocuments workerId="worker" canUpload={canUpload} />
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(JSON.stringify(root.toJSON())).toContain('Synthetic Worker'));
}

it('shows the Group 3 exemption on the certificate row and its details', async () => {
  await mount(profile, true);
  const row = root.root
    .findAllByType(Pressable)
    .find((node) => node.props.accessibilityLabel === t('documents.SAFETY_CARD'));
  const labels = row?.findAllByType(Text).map((label) => label.props.children);
  expect(labels).toContain(t('documents.notRequired'));
  expect(labels).not.toContain(t('documents.MISSING'));
  await act(async () => row!.props.onPress());
  expect(JSON.stringify(root.toJSON())).toContain(t('documents.notRequired'));
  expect(JSON.stringify(root.toJSON())).not.toContain(t('documents.noFile'));
});

it('offers replacement only to the representative and saves just the rejected document as a draft', async () => {
  client.submitWorkerDocuments.mockResolvedValue({
    requestId: 'command',
    version: 4,
    documentIds: ['replacement'],
  });
  await mount(profile, false);
  expect(button(t('onboarding.replaceFile'))).toBeUndefined();
  await act(async () => {
    root.update(
      <QueryClientProvider client={cache}>
        <WorkerDocuments workerId="worker" canUpload />
      </QueryClientProvider>,
    );
  });
  expect(JSON.stringify(root.toJSON())).toContain('Missing confirmation page');
  await act(async () => button(t('onboarding.replaceFile'))!.props.onPress());
  const file = { uri: 'file:///insurance.pdf', name: 'insurance.pdf', type: 'application/pdf' };
  await act(async () => root.root.findByType(SingleDocumentAttachment).props.onChange(file));
  const date = (label: string) =>
    root.root.findAllByType(CalendarDateField).find((node) => node.props.label === label)!;
  await act(async () => {
    date(t('documents.coverageStartsOn')).props.onChange('2026-10-01');
    date(t('documents.declaredExpiresOn')).props.onChange('2099-01-02');
  });
  await act(async () => button(t('onboarding.saveDocumentDraft'))!.props.onPress());
  await vi.waitFor(() =>
    expect(client.submitWorkerDocuments).toHaveBeenCalledWith(
      'token',
      'site',
      'worker',
      expect.objectContaining({
        expectedVersion: 3,
        safetyCardRequired: false,
        documents: {
          PERSONAL_INSURANCE: { submittedIssuedOn: '2026-10-01', submittedExpiresOn: '2099-01-02' },
        },
      }),
      { PERSONAL_INSURANCE: file },
    ),
  );
  expect(client.sendWorkerDocumentsBatch).not.toHaveBeenCalled();
  expect(client.analyzeWorkerDocument).not.toHaveBeenCalled();
});

it('shows the approved replacement rather than the older rejection on the certificate row', async () => {
  await mount(
    {
      ...profile,
      missingKinds: [],
      documents: [
        insurance,
        {
          ...insurance,
          id: 'replacement',
          status: 'APPROVED',
          expiresOn: '2099-01-02',
          uploadedAt: '2026-10-19T00:00:00Z',
          reviewedAt: '2026-10-20T00:00:00Z',
          reviewNote: null,
        },
      ],
    },
    true,
  );
  const screen = JSON.stringify(root.toJSON());
  expect(screen).not.toContain('Missing confirmation page');
  expect(screen).toContain(t('documents.APPROVED'));
  expect(screen).toContain('2099');
});

it('shows the approved expiry alongside a pending renewal', async () => {
  await mount(
    {
      ...profile,
      missingKinds: [],
      documents: [
        {
          ...insurance,
          status: 'APPROVED',
          expiresOn: '2099-01-02',
          reviewNote: null,
        },
        {
          ...insurance,
          id: 'renewal',
          status: 'PENDING',
          uploadedAt: '2026-10-20T00:00:00Z',
          reviewNote: null,
        },
      ],
    },
    true,
  );
  const screen = JSON.stringify(root.toJSON());
  expect(screen).toContain(t('documents.PENDING'));
  expect(screen).toContain('2099');
});

it('keeps submitting available after optional AI analysis fails', async () => {
  client.analyzeWorkerDocument.mockRejectedValue(new Error('AI unavailable'));
  client.sendWorkerDocumentsBatch.mockResolvedValue({
    items: [{ id: 'worker', status: 'SUCCEEDED' }],
  });
  await mount(
    {
      ...profile,
      canSubmit: true,
      documents: [{ ...insurance, status: 'DRAFT' }],
    },
    true,
  );
  await act(async () => button(t('onboarding.analyze'))!.props.onPress());
  await vi.waitFor(() => expect(JSON.stringify(root.toJSON())).toContain('AI unavailable'));
  const send = button(t('onboarding.send'))!;
  expect(send.props.disabled).toBe(false);
  await act(async () => send.props.onPress());
  await vi.waitFor(() =>
    expect(client.sendWorkerDocumentsBatch).toHaveBeenCalledWith('token', 'site', 'contractor', [
      { id: 'worker', version: 3 },
    ]),
  );
});

it('shows both values when AI detects a different insurance start date', async () => {
  await mount(
    {
      ...profile,
      documents: [
        {
          ...insurance,
          status: 'DRAFT',
          reviewNote: null,
          aiAnalysis: {
            status: 'COMPLETE',
            detectedKind: 'PERSONAL_INSURANCE',
            kindMismatch: false,
            issuedOn: '2090-12-01',
            expiresOn: '2099-01-02',
            validity: 'CURRENT',
            dateCheck: {
              status: 'MATCH',
              field: 'EXPIRES_ON',
              submittedDate: '2099-01-02',
              detectedDate: '2099-01-02',
            },
            startDateCheck: {
              status: 'MISMATCH',
              field: 'ISSUED_ON',
              submittedDate: '2091-01-01',
              detectedDate: '2090-12-01',
            },
          },
        },
      ],
    },
    true,
  );
  const document = root.root
    .findAllByType(Pressable)
    .find((node) => node.props.accessibilityLabel === t('documents.PERSONAL_INSURANCE'));
  await act(async () => document!.props.onPress());
  const screen = JSON.stringify(root.toJSON());
  expect(screen).toContain(t('onboarding.analysisDiscrepancy'));
  expect(screen).toContain(t('documents.coverageStartsOn'));
  expect(screen).toContain('2091');
  expect(screen).toContain('2090');
});
