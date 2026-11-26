import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Pressable } from 'react-native';
import type { WorkerOnboardingDraft } from '@smartsite/api-client';
import { WorkerOnboarding } from './worker-onboarding';
import { Button } from '../shared/ui';
import { translate as t } from '../../i18n';

vi.mock('../workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
vi.mock('../../components/modals/CreateWorkerModal', () => ({ CreateWorkerModal: () => null }));

const ready: WorkerOnboardingDraft = {
  id: 'ready',
  version: 5,
  displayName: 'Worker Ready',
  username: 'ready',
  email: 'ready@example.test',
  safetyCardRequired: null,
  documents: {},
  workerId: null,
  workerCode: null,
  workerVersion: null,
  canProvision: true,
  canSubmit: false,
  missingKinds: [],
  submissionStatus: 'NOT_SUBMITTED',
};
const partial = { ...ready, id: 'partial', version: 2, displayName: 'Worker Changed' };
const client = {
  listWorkerOnboardingDrafts: vi.fn(async () => ({ items: [ready, partial] })),
  provisionWorkerOnboardingBatch: vi.fn(async () => ({
    items: [
      { id: 'ready', status: 'SUCCEEDED', workerId: 'account-worker' },
      {
        id: 'partial',
        status: 'FAILED',
        error: { code: 'CONFLICT', message: 'Changed on server' },
      },
    ],
  })),
};
const workspace = {
  client,
  token: 'token',
  queryKey: ['mobile', 'test'],
  scope: {
    siteId: 'site',
    contractorId: 'contractor',
    siteName: 'Site',
    contractorName: 'Company',
  },
};
let root: ReactTestRenderer;
let cache: QueryClient;
afterEach(async () => {
  await act(async () => root?.unmount());
  cache?.clear();
});

it('reports a missing file rather than a missing date when only the date is saved', async () => {
  client.listWorkerOnboardingDrafts.mockResolvedValueOnce({
    items: [
      {
        ...partial,
        canProvision: false,
        documents: { HEALTH_CERTIFICATE: { submittedIssuedOn: '2026-11-26' } },
        missingKinds: ['HEALTH_CERTIFICATE'],
      },
    ],
  });
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <WorkerOnboarding onOpenWorker={() => undefined} />
      </QueryClientProvider>,
    );
  });
  const certificate = t('documents.HEALTH_CERTIFICATE');
  await vi.waitFor(() => {
    const screen = JSON.stringify(root.toJSON());
    expect(screen).toContain(certificate);
    expect(screen).not.toContain(t('onboarding.missingDate', { document: certificate }));
  });
});

it('sends the selected draft versions in one provision request and renders a failure on its row', async () => {
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <WorkerOnboarding onOpenWorker={() => undefined} />
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() =>
    expect(
      root.root.findAllByType(Pressable).filter((p) => p.props.accessibilityRole === 'checkbox'),
    ).toHaveLength(2),
  );
  const checkboxes = root.root
    .findAllByType(Pressable)
    .filter((p) => p.props.accessibilityRole === 'checkbox');
  await act(async () => checkboxes.forEach((p) => p.props.onPress()));
  const action = root.root
    .findAllByType(Button)
    .find((p) => p.props.label === t('onboarding.provision'))!;
  await act(async () => action.props.onPress());
  await vi.waitFor(() => expect(JSON.stringify(root.toJSON())).toContain('Changed on server'));
  expect(client.provisionWorkerOnboardingBatch).toHaveBeenCalledWith(
    'token',
    'site',
    'contractor',
    [
      { id: 'ready', version: 5 },
      { id: 'partial', version: 2 },
    ],
  );
});
