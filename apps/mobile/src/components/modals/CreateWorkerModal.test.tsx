import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateWorkerModal } from './CreateWorkerModal';
import { Button, Field } from '../../features/shared/ui';
import { CalendarDateField } from '../../features/shared/calendar-date-field';
import { EvidenceButton, SingleDocumentAttachment } from '../../features/shared/uploads';
import type { WorkerOnboardingDraft } from '@smartsite/api-client';
import { translate as t } from '../../i18n';

vi.mock('../../features/workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
vi.mock('../../features/shared/uploads', () => ({
  EvidenceButton: () => null,
  SingleDocumentAttachment: () => null,
}));
const client = {
  saveWorkerOnboardingDraft: vi.fn(async () => ({})),
};
const workspace = {
  client,
  token: 'session',
  scope: { siteId: 'site', contractorId: 'contractor' },
};
let root: ReactTestRenderer;
let cache: QueryClient;
afterEach(async () => {
  await act(async () => root?.unmount());
  cache?.clear();
  vi.clearAllMocks();
});

it('persists partial details and a file without a date, then resets the form for another worker', async () => {
  const onSuccess = vi.fn();
  const onClose = vi.fn();
  cache = new QueryClient();
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <CreateWorkerModal visible onSuccess={onSuccess} onClose={onClose} />
      </QueryClientProvider>,
    );
  });
  const field = (label: string) =>
    root.root.findAllByType(Field).find((node) => node.props.label === label)!;
  const file = { uri: 'file:///health.jpg', name: 'health.jpg', type: 'image/jpeg' };
  await act(async () => {
    field(t('workforce.fullName')).props.onChangeText('First Worker');
    root.root
      .findAllByType(SingleDocumentAttachment)
      .find((node) => node.props.label === t('documents.HEALTH_CERTIFICATE'))!
      .props.onChange(file);
  });
  const save = root.root
    .findAllByType(Button)
    .find((node) => node.props.label === t('onboarding.saveAndAdd'))!;
  expect(save.props.disabled).toBe(false);
  await act(async () => save.props.onPress());
  await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  expect(onClose).not.toHaveBeenCalled();
  expect(client.saveWorkerOnboardingDraft).toHaveBeenCalledWith(
    'session',
    'site',
    'contractor',
    expect.any(String),
    expect.objectContaining({
      expectedVersion: 0,
      displayName: 'First Worker',
      email: '',
      username: '',
      safetyCardRequired: null,
      documents: { HEALTH_CERTIFICATE: {} },
    }),
    { HEALTH_CERTIFICATE: file },
  );
  expect(field(t('workforce.fullName')).props.value).toBe('');
  expect(
    root.root.findAllByType(Field).some((node) => node.props.label === t('documents.nationalId')),
  ).toBe(false);
});

it('saves a declared date before attaching its certificate', async () => {
  cache = new QueryClient();
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <CreateWorkerModal visible onClose={vi.fn()} />
      </QueryClientProvider>,
    );
  });
  const healthDate = root.root
    .findAllByType(CalendarDateField)
    .find((node) => node.props.label === t('documents.declaredIssuedOn'));
  expect(healthDate).toBeDefined();
  await act(async () => healthDate!.props.onChange('2026-11-26'));
  const save = root.root
    .findAllByType(Button)
    .find((node) => node.props.label === t('onboarding.saveDraft'))!;
  expect(save.props.disabled).toBe(false);
  await act(async () => save.props.onPress());
  expect(client.saveWorkerOnboardingDraft).toHaveBeenCalledWith(
    'session',
    'site',
    'contractor',
    expect.any(String),
    expect.objectContaining({
      documents: { HEALTH_CERTIFICATE: { submittedIssuedOn: '2026-11-26' } },
    }),
    {},
  );
});

it('reopens and clears a date-only draft without exposing a file preview', async () => {
  const draft: WorkerOnboardingDraft = {
    id: 'draft',
    version: 2,
    displayName: '',
    username: '',
    email: '',
    safetyCardRequired: null,
    documents: { HEALTH_CERTIFICATE: { submittedIssuedOn: '2026-11-26' } },
    workerId: null,
    workerCode: null,
    workerVersion: null,
    canProvision: false,
    canSubmit: false,
    missingKinds: ['HEALTH_CERTIFICATE'],
    submissionStatus: 'NOT_SUBMITTED',
  };
  cache = new QueryClient();
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <CreateWorkerModal visible draft={draft} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
  });
  expect(root.root.findAllByType(EvidenceButton)).toHaveLength(0);
  const button = (label: string) =>
    root.root.findAllByType(Button).find((node) => node.props.label === label)!;
  await act(async () =>
    button(t('onboarding.clearDate', { label: t('documents.HEALTH_CERTIFICATE') })).props.onPress(),
  );
  await act(async () => button(t('onboarding.saveDraft')).props.onPress());
  expect(client.saveWorkerOnboardingDraft).toHaveBeenCalledWith(
    'session',
    'site',
    'contractor',
    'draft',
    expect.objectContaining({ expectedVersion: 2, documents: { HEALTH_CERTIFICATE: {} } }),
    {},
  );
});

it('saves both declared insurance dates before the original is attached', async () => {
  cache = new QueryClient();
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <CreateWorkerModal visible onClose={vi.fn()} />
      </QueryClientProvider>,
    );
  });
  const date = (label: string) =>
    root.root.findAllByType(CalendarDateField).find((node) => node.props.label === label)!;
  await act(async () => {
    date(t('documents.coverageStartsOn')).props.onChange('2026-11-25');
    date(t('documents.declaredExpiresOn')).props.onChange('2027-11-25');
  });
  await act(async () =>
    root.root
      .findAllByType(Button)
      .find((node) => node.props.label === t('onboarding.saveDraft'))!
      .props.onPress(),
  );
  expect(client.saveWorkerOnboardingDraft).toHaveBeenCalledWith(
    'session',
    'site',
    'contractor',
    expect.any(String),
    expect.objectContaining({
      documents: {
        PERSONAL_INSURANCE: { submittedIssuedOn: '2026-11-25', submittedExpiresOn: '2027-11-25' },
      },
    }),
    {},
  );
});
