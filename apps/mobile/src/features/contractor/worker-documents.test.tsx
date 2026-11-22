import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient, type WorkerComplianceResponse } from '@smartsite/api-client';
import type { useWorkspace } from '../workspace/workspace-context';
import { WorkerDocuments } from './worker-documents';
import { translate as t, setLanguage } from '../../i18n';
import { Pressable } from 'react-native';
import { Button, Choice, Disclosure } from '../shared/ui';
import { WorkerDocumentBundleForm } from './worker-document-bundle-form';
import { CalendarDateField } from '../shared/calendar-date-field';
import { Attachments } from '../shared/uploads';

vi.mock('../workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
vi.mock('../shared/uploads', () => ({ Attachments: () => null, EvidenceButton: () => null }));
let workspace: ReturnType<typeof useWorkspace>;
let root: ReactTestRenderer;
let cache: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache?.clear();
  vi.restoreAllMocks();
  await setLanguage('vi');
});

it('keeps Worker documents read-only and exposes a single bundle form to Representatives', async () => {
  const check = { status: 'MISMATCH' as const, detectedNationalIds: ['000000000099'] };
  const profile: WorkerComplianceResponse = {
    workerId: 'worker',
    contractorId: 'contractor',
    displayName: 'Synthetic Worker',
    externalId: 'W001',
    nationalId: '000000000001',
    phoneNumber: '0900000001',
    gender: null,
    address: 'Synthetic address',
    status: 'PENDING',
    submissionStatus: 'PENDING_REVIEW',
    needsSupplement: true,
    missingKinds: ['HEALTH_CERTIFICATE', 'PERSONAL_INSURANCE'],
    expiringKinds: [],
    identityImages: [
      {
        id: 'identity',
        side: 'FRONT',
        originalName: 'synthetic-id.jpg',
        mediaType: 'image/jpeg',
        uploadedAt: '2026-10-17T00:00:00Z',
        identityCheck: check,
      },
    ],
    documents: [
      {
        id: 'document',
        workerId: 'worker',
        kind: 'SAFETY_CARD',
        status: 'PENDING',
        originalName: 'synthetic-card.jpg',
        mediaType: 'image/jpeg',
        size: 100,
        ocr: {
          status: 'READ',
          issuedOn: null,
          expiresOn: null,
          warnings: [],
          nationalIds: ['000000000099'],
        },
        issuedOn: null,
        expiresOn: null,
        uploadedAt: '2026-10-17T00:00:00Z',
        reviewedAt: null,
        reviewNote: null,
        version: 1,
        identityCheck: check,
      },
    ],
  };
  const client = new SmartSiteManagementClient('https://api.example.test');
  vi.spyOn(client, 'workerCompliance').mockResolvedValue(profile);
  const submit = vi.spyOn(client, 'submitWorkerDocuments');
  workspace = {
    client,
    token: 'synthetic-token',
    workerId: 'worker',
    queryKey: ['mobile', 'synthetic-worker-documents'],
    scope: {
      role: 'worker',
      siteId: 'site',
      siteName: 'Synthetic site',
      contractorId: '',
      contractorName: '',
    },
    user: {
      id: 'worker-user',
      username: 'worker',
      displayName: 'Synthetic Worker',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'WORKER', siteId: 'site' }],
    },
  };
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <WorkerDocuments workerId="worker" />
      </QueryClientProvider>,
    );
  });
  for (
    let i = 0;
    i < 20 && !JSON.stringify(root.toJSON()).includes(t('documents.identityMismatch'));
    i++
  )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  expect(root.root.findAllByType(Attachments)).toHaveLength(0);
  expect(
    root.root.findAllByType(Button).some((node) => node.props.label === t('documents.bundleTitle')),
  ).toBe(false);
  await act(async () => {
    root.update(
      <QueryClientProvider client={cache}>
        <WorkerDocuments workerId="worker" canUpload />
      </QueryClientProvider>,
    );
  });
  const open = root.root
    .findAllByType(Button)
    .find((node) => node.props.label === t('documents.bundleTitle'))!;
  await act(async () => open.props.onPress());
  expect(root.root.findByType(WorkerDocumentBundleForm).props.profile.workerId).toBe('worker');
  expect(submit).not.toHaveBeenCalled();

  const identitySection = root.root
    .findAllByType(Disclosure)
    .find((node) => node.props.title === t('documents.identityHeading'))!;
  await act(async () => identitySection.findByType(Pressable).props.onPress());
  expect(
    identitySection
      .findAllByType(Choice)
      .find((node) => node.props.label === t('documents.gender'))!.props.value,
  ).toBe('');
  const checkDates = vi.spyOn(client, 'checkWorkerDocumentDates').mockResolvedValue({
    quality: { status: 'RETAKE', reason: 'IMAGE_BLURRY' },
    ocr: { status: 'READ', issuedOn: null, expiresOn: '2099-01-01', warnings: [], nationalIds: [] },
    dateCheck: {
      status: 'NO_REFERENCE',
      field: 'EXPIRES_ON',
      submittedDate: null,
      detectedDate: '2099-01-01',
    },
  });
  submit.mockResolvedValue({ requestId: 'synthetic', version: 2, documentIds: ['new-card'] });
  const analyze = vi.spyOn(client, 'analyzeWorkerDocument');
  const cardSection = root.root
    .findAllByType(Disclosure)
    .find((node) => node.props.title === t('documents.SAFETY_CARD'))!;
  await act(async () => cardSection.findByType(Pressable).props.onPress());
  const picker = cardSection.findByType(Attachments);
  const file = { uri: 'file:///synthetic.png', name: 'synthetic.png', type: 'image/png' };
  await act(async () => {
    await picker.props.validateFile(file);
    picker.props.onChange([file]);
  });
  const dates = root.root.findAllByType(CalendarDateField);
  await act(async () => dates[0]!.props.onChange('2099-01-02'));
  expect(checkDates).toHaveBeenCalledTimes(1);
  const send = root.root
    .findAllByType(Button)
    .find((node) => node.props.label === t('documents.sendBundle'))!;
  await act(async () => send.props.onPress());
  for (let attempt = 0; attempt < 20 && !submit.mock.calls.length; attempt++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit.mock.calls[0]?.[3].documents).toEqual({
    SAFETY_CARD: { submittedExpiresOn: '2099-01-02' },
  });
  expect(analyze).not.toHaveBeenCalled();
});
