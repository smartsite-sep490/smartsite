import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient, type WorkerComplianceResponse } from '@smartsite/api-client';
import type { useWorkspace } from '../workspace/workspace-context';
import { WorkerDocuments } from './worker-documents';
import { translate as t } from '../../i18n';
import { Field, Button } from '../shared/ui';

vi.mock('../workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
vi.mock('../shared/uploads', () => ({ Attachments: () => null, EvidenceButton: () => null }));
let workspace: ReturnType<typeof useWorkspace>;
let root: ReactTestRenderer;
let cache: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache?.clear();
  vi.restoreAllMocks();
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
  const text = JSON.stringify(root.toJSON());
  expect(text.split(t('documents.identityMismatch')).length - 1).toBe(2);
  expect(text).toContain('000000000099');
  expect(text).not.toContain(t('documents.identityAdvisory'));
  expect(text).toContain(t('documents.identityMismatch'));
  expect(upload).not.toHaveBeenCalled();
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
  const field = root.root
    .findAllByType(Field)
    .find((node) => node.props.label === `${t('documents.submittedExpiresOn')} (YYYY-MM-DD)`)!;
  await act(async () => field.props.onChangeText('2027-10-18'));
  const button = root.root
    .findAllByType(Button)
    .find((node) => node.props.label === t('documents.saveSubmittedExpiry'))!;
  await act(async () => button.props.onPress());
  expect(save).toHaveBeenCalledWith('synthetic-token', 'site', 'worker', 'document', {
    expectedVersion: 1,
    submittedExpiresOn: '2027-10-18',
  });
});
