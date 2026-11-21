import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient, type WorkerComplianceResponse } from '@smartsite/api-client';
import type { useWorkspace } from '../workspace/workspace-context';
import { WorkerDocuments } from './worker-documents';
import { translate as t, setLanguage } from '../../i18n';
import { Button } from '../shared/ui';
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

it('keeps Worker originals read-only and allows Representative expiry suggestions on pending documents', async () => {
  const check = { status: 'MISMATCH' as const, detectedNationalIds: ['000000000099'] };
  const profile: WorkerComplianceResponse = {
    workerId: 'worker',
    contractorId: 'contractor',
    displayName: 'Synthetic Worker',
    externalId: 'W001',
    nationalId: '000000000001',
    phoneNumber: '0900000001',
    gender: 'MALE',
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
  const upload = vi.spyOn(client, 'uploadWorkerDocument');
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
  const click = async (label: string) =>
    act(async () => {
      root.root
        .findAll((n) => String(n.type) === 'Pressable' && n.props.accessibilityLabel === label)[0]!
        .props.onPress();
    });
  await click(t('documents.SAFETY_CARD'));
  expect(JSON.stringify(root.toJSON())).toContain(t('documents.identityMismatch'));
  expect(root.root.findAllByType(Attachments)).toHaveLength(0);
  expect(upload).not.toHaveBeenCalled();
  const quality = vi.spyOn(client, 'checkWorkerDocumentDates').mockResolvedValue({
    quality: { status: 'ACCEPTED', reason: 'IMAGE_ACCEPTED' },
    ocr: profile.documents[0]!.ocr,
    dateCheck: {
      status: 'NO_REFERENCE',
      field: 'EXPIRES_ON',
      submittedDate: null,
      detectedDate: '2030-10-27',
    },
  });
  upload.mockResolvedValue({ ...profile.documents[0]!, id: 'pending-renewal' });
  const identity = vi.spyOn(client, 'uploadWorkerIdentityImage');
  await act(async () =>
    root.update(
      <QueryClientProvider client={cache}>
        <WorkerDocuments workerId="worker" canSubmitDocuments />
      </QueryClientProvider>,
    ),
  );
  await click(t('documentUi.submitNew'));
  const pickers = root.root.findAllByType(Attachments);
  expect(pickers).toHaveLength(1);
  expect(pickers[0]!.props.disabled).toBe(false);
  const declaredDate = root.root
    .findAllByType(CalendarDateField)
    .find((node) => node.props.label === t('documents.declaredExpiresOn'))!;
  const file = { uri: 'file:///synthetic-renewal.jpg', name: 'renewal.jpg', type: 'image/jpeg' };
  await act(async () => {
    await pickers[0]!.props.validateFile(file);
  });
  await act(async () => pickers[0]!.props.onChange([file]));
  expect(declaredDate.props.value).toBe('2030-10-27');
  expect(quality).toHaveBeenCalledWith(
    'synthetic-token',
    'site',
    'worker',
    'SAFETY_CARD',
    file,
    {},
  );
  const submit = root.root
    .findAllByType(Button)
    .find((node) => node.props.label === t('documents.submitForReview') && !node.props.disabled)!;
  expect(JSON.stringify(root.toJSON())).toContain(t('documents.dateMatch'));
  expect(upload).not.toHaveBeenCalled();
  await act(async () => declaredDate.props.onChange('2031-10-27'));
  expect(submit.props.disabled).toBe(true);
  quality.mockResolvedValue({
    quality: { status: 'ACCEPTED', reason: 'IMAGE_ACCEPTED' },
    ocr: { status: 'UNREADABLE', issuedOn: null, expiresOn: null, warnings: [] },
    dateCheck: {
      status: 'UNAVAILABLE',
      field: 'EXPIRES_ON',
      submittedDate: '2031-10-27',
      detectedDate: null,
    },
  });
  const recheck = root.root
    .findAllByType(Button)
    .find((node) => node.props.label === t('documents.dateRecheck'))!;
  await act(async () => {
    await recheck.props.onPress();
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(submit.props.disabled).toBe(false);
  expect(JSON.stringify(root.toJSON())).toContain(t('documents.dateUnavailable'));
  await act(async () => submit.props.onPress());
  expect(quality).toHaveBeenCalledWith('synthetic-token', 'site', 'worker', 'SAFETY_CARD', file, {
    submittedExpiresOn: '2031-10-27',
  });
  expect(upload).toHaveBeenCalledWith('synthetic-token', 'site', 'worker', 'SAFETY_CARD', file, {
    submittedExpiresOn: '2031-10-27',
  });
  expect(identity).not.toHaveBeenCalled();
  workspace = { ...workspace, scope: { ...workspace.scope, role: 'contractor' } };
  const save = vi
    .spyOn(client, 'updateWorkerDocumentExpiry')
    .mockResolvedValue({ ...profile.documents[0]!, submittedExpiresOn: '2027-10-18', version: 2 });
  await act(async () =>
    root.update(
      <QueryClientProvider client={cache}>
        <WorkerDocuments workerId="worker" canUpload />
      </QueryClientProvider>,
    ),
  );
  await click(t('documentUi.editDeclaredDate'));
  const field = root.root
    .findAllByType(CalendarDateField)
    .find((node) => node.props.label === t('documents.submittedExpiresOn'))!;
  await act(async () => field.props.onChange('2027-10-18'));
  await act(async () => {
    await setLanguage('en');
  });
  const translatedField = root.root
    .findAllByType(CalendarDateField)
    .find((node) => node.props.label === t('documents.submittedExpiresOn'))!;
  expect(translatedField.props.value).toBe('2027-10-18');
  expect(JSON.stringify(root.toJSON())).toContain('Synthetic Worker');
  const button = root.root
    .findAllByType(Button)
    .find((node) => node.props.label === t('documents.saveSubmittedExpiry'))!;
  await act(async () => button.props.onPress());
  expect(save).toHaveBeenCalledWith('synthetic-token', 'site', 'worker', 'document', {
    expectedVersion: 1,
    submittedExpiresOn: '2027-10-18',
  });
});
