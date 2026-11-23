import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApiError,
  SmartSiteManagementClient,
  type NativeUploadFile,
  type WorkerComplianceResponse,
} from '@smartsite/api-client';
import type { useWorkspace } from '../../features/workspace/workspace-context';
import { Choice } from '../../features/shared/ui';
import { CreateWorkerModal } from './CreateWorkerModal';
import { translate as t } from '../../i18n';

vi.mock('../../features/workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
vi.mock('../../features/shared/uploads', () => ({
  Attachments: (props: Record<string, unknown>) => createElement('Attachments', props),
}));
vi.mock('../../features/shared/ui', async (original) => ({
  ...(await original<typeof import('../../features/shared/ui')>()),
  Disclosure: ({ children }: { children: ReactNode }) => children,
}));
let workspace: ReturnType<typeof useWorkspace>;
let root: ReactTestRenderer;
let cache: QueryClient;
let onSuccess = vi.fn<() => void>();
let onClose = vi.fn<() => void>();
beforeEach(() => {
  const client = new SmartSiteManagementClient('https://api.example.test');
  vi.spyOn(client, 'checkDocumentImageQuality').mockResolvedValue({
    status: 'ACCEPTED',
    reason: 'IMAGE_ACCEPTED',
    ocr: {
      status: 'READ',
      issuedOn: '2026-11-21',
      expiresOn: '2031-11-21',
      nationalIds: ['000000000001'],
      warnings: [],
    },
  });
  vi.spyOn(client, 'createContractorWorkerAccount').mockResolvedValue({
    account: {
      id: 'user-a',
      username: 'synthetic.worker',
      displayName: 'Synthetic Worker',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'WORKER', siteId: 'site-a' }],
    },
    worker: {
      id: 'worker-a',
      userId: 'user-a',
      siteId: 'site-a',
      contractorId: 'contractor-a',
      externalId: 'W001',
      displayName: 'Synthetic Worker',
      isActive: true,
      createdAt: '',
    },
    emailDelivery: 'QUEUED',
  });
  vi.spyOn(client, 'workerCompliance').mockResolvedValue({
    workerId: 'worker-a',
    version: 1,
  } as WorkerComplianceResponse);
  vi.spyOn(client, 'submitWorkerDocuments').mockResolvedValue({
    requestId: 'request',
    version: 2,
    documentIds: ['doc-a'],
  });
  workspace = {
    client,
    token: 'token',
    queryKey: ['mobile', 'create-worker'],
    workerId: '',
    user: {
      id: 'representative-a',
      username: 'representative',
      displayName: 'Representative',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-a' }],
    },
    scope: {
      role: 'contractor',
      siteId: 'site-a',
      contractorId: 'contractor-a',
      siteName: 'Site A',
      contractorName: 'Contractor A',
    },
  };
  cache = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  onSuccess = vi.fn();
  onClose = vi.fn();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache.clear();
  vi.restoreAllMocks();
});
async function renderForm() {
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <CreateWorkerModal visible onSuccess={onSuccess} onClose={onClose} />
      </QueryClientProvider>,
    );
  });
}
const button = () =>
  root.root.findAll(
    (n) =>
      String(n.type) === 'Pressable' && n.props.accessibilityLabel === t('documents.sendBundle'),
  )[0]!;
async function fillForm(safetyCardRequired = true) {
  await act(async () => {
    const values: [string, string][] = [
      [t('workforce.fullName'), 'Synthetic Worker'],
      [t('workforce.username'), 'synthetic.worker'],
      [t('accountEmail.email'), 'worker@example.test'],
      [t('documents.nationalId'), '000000000001'],
      [t('documents.phoneNumber'), '0900000001'],
      [t('documents.address'), 'Synthetic address'],
    ];
    for (const [label, value] of values)
      root.root
        .findAll((n) => String(n.type) === 'TextInput' && n.props.accessibilityLabel === label)[0]!
        .props.onChangeText(value);
    root.root
      .findAllByType(Choice)
      .find((n) => n.props.label === t('documents.gender'))!
      .props.onChange('MALE');
    root.root
      .findAllByType(Choice)
      .find((n) => n.props.label === t('documents.safetyCardRequired'))!
      .props.onChange(String(safetyCardRequired));
  });
  for (let index = 0; index < 5; index++) {
    if (index === 2 && !safetyCardRequired) continue;
    const file: NativeUploadFile = {
      uri: `file:///synthetic-cache/${index}.jpg`,
      name: `${index}.jpg`,
      type: 'image/jpeg',
    };
    await act(async () => {
      const attachment = root.root.findAll((n) => String(n.type) === 'Attachments')[index]!;
      await attachment.props.validateFile(file);
      attachment.props.onChange([file]);
    });
  }
}

it('checks the five attachments, applies OCR dates and submits one scoped document bundle', async () => {
  await renderForm();
  await fillForm();
  await act(async () => button().props.onPress());
  expect(workspace.client.checkDocumentImageQuality).toHaveBeenCalledTimes(5);
  expect(workspace.client.createContractorWorkerAccount).toHaveBeenCalledWith(
    'token',
    'contractor-a',
    expect.objectContaining({ siteId: 'site-a', email: 'worker@example.test' }),
  );
  expect(workspace.client.submitWorkerDocuments).toHaveBeenCalledWith(
    'token',
    'site-a',
    'worker-a',
    expect.objectContaining({
      expectedVersion: 1,
      safetyCardRequired: true,
      documents: {
        SAFETY_CARD: { submittedExpiresOn: '2031-11-21' },
        HEALTH_CERTIFICATE: { submittedIssuedOn: '2026-11-21' },
        PERSONAL_INSURANCE: { submittedExpiresOn: '2031-11-21' },
      },
    }),
    expect.objectContaining({ FRONT: expect.any(Object), BACK: expect.any(Object) }),
  );
  expect(onSuccess).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});

it('retries a failed bundle with the same account and request ID without reporting success early', async () => {
  vi.mocked(workspace.client.submitWorkerDocuments).mockRejectedValueOnce(
    new ApiError('network', 'Upload interrupted'),
  );
  await renderForm();
  await fillForm();
  await act(async () => button().props.onPress());
  expect(onSuccess).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(JSON.stringify(root.toJSON())).toContain(t('documents.accountPending'));
  await act(async () => button().props.onPress());
  expect(workspace.client.createContractorWorkerAccount).toHaveBeenCalledOnce();
  const calls = vi.mocked(workspace.client.submitWorkerDocuments).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[0]![3].requestId).toBe(calls[1]![3].requestId);
  expect(calls[0]![4]).toEqual(calls[1]![4]);
  expect(onSuccess).toHaveBeenCalledOnce();
});

it('permits an explicitly optional safety card without dropping health or insurance', async () => {
  await renderForm();
  await fillForm(false);
  await act(async () => button().props.onPress());
  const input = vi.mocked(workspace.client.submitWorkerDocuments).mock.calls[0]![3];
  expect(input.safetyCardRequired).toBe(false);
  expect(input.documents.SAFETY_CARD).toBeUndefined();
  expect(input.documents.HEALTH_CERTIFICATE).toBeDefined();
  expect(input.documents.PERSONAL_INSURANCE).toBeDefined();
});

it('allows replacing an identity attachment after an interrupted bundle while keeping the created account', async () => {
  vi.mocked(workspace.client.submitWorkerDocuments).mockRejectedValueOnce(
    new ApiError('network', 'Upload interrupted'),
  );
  await renderForm();
  await fillForm();
  await act(async () => button().props.onPress());
  expect(JSON.stringify(root.toJSON())).toContain(t('auth.networkError'));
  const attachment = root.root.findAll((n) => String(n.type) === 'Attachments')[0]!;
  expect(attachment.props.disabled).toBe(false);
  let container = attachment.parent;
  while (container && container.props.pointerEvents === undefined) container = container.parent;
  expect(container?.props.pointerEvents).toBe('auto');
  const replacement: NativeUploadFile = {
    uri: 'file:///synthetic-cache/front-retaken.jpg',
    name: 'front-retaken.jpg',
    type: 'image/jpeg',
  };
  await act(async () => {
    await attachment.props.validateFile(replacement);
    attachment.props.onChange([replacement]);
  });
  await act(async () => button().props.onPress());
  const attempts = vi.mocked(workspace.client.submitWorkerDocuments).mock.calls;
  expect(workspace.client.createContractorWorkerAccount).toHaveBeenCalledOnce();
  expect(attempts[1]![4].FRONT).toEqual(replacement);
  expect(attempts[1]![3].requestId).not.toBe(attempts[0]![3].requestId);
  expect(onSuccess).toHaveBeenCalledOnce();
});

it('does not create an account from an incomplete draft', async () => {
  await renderForm();
  await act(async () => button().props.onPress());
  expect(workspace.client.createContractorWorkerAccount).not.toHaveBeenCalled();
  expect(workspace.client.submitWorkerDocuments).not.toHaveBeenCalled();
  expect(onSuccess).not.toHaveBeenCalled();
});
