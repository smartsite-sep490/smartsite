import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@smartsite/api-client';
import { setLanguage, translate } from '../../i18n';
import { CreateWorkerModal } from './CreateWorkerModal';
import { ScheduleAssignModal } from './ScheduleAssignModal';
import { WorkerRequestModal } from './WorkerRequestModal';

vi.mock('react-native', async (original) => ({
  ...(await original<typeof import('react-native')>()),
  KeyboardAvoidingView: 'KeyboardAvoidingView',
}));
vi.mock('../../features/shared/uploads', () => ({ Attachments: () => null }));
vi.mock('../../features/contractor/worker-documents', () => ({
  documentKinds: ['SAFETY_CARD', 'HEALTH_CERTIFICATE', 'PERSONAL_INSURANCE'],
}));
vi.mock('../../features/workspace/workspace-context', () => ({
  useWorkspace: () => ({
    scope: { siteId: 'site', contractorId: 'contractor' },
    queryKey: ['test'],
    token: 'synthetic',
    client: {
      listShifts: async () => ({ items: [], total: 0 }),
      listWorkerSchedules: async () => ({ items: [], total: 0 }),
    },
  }),
}));
vi.mock('../../features/workspace/use-scoped-workers', () => ({
  useScopedWorkers: () => ({ data: [] }),
}));
vi.mock('../../features/shared/data', async (original) => ({
  ...(await original<typeof import('../../features/shared/data')>()),
  useCommand: () => ({
    error: requestError,
    isPending: false,
    mutateAsync: (operation: () => Promise<unknown>) => operation(),
  }),
}));
let requestError: ApiError | undefined;
let root: ReactTestRenderer;
let cache: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache?.clear();
  await setLanguage('vi');
});

for (const Modal of [CreateWorkerModal, ScheduleAssignModal, WorkerRequestModal]) {
  it.each(['network', 'timeout'] as const)(
    `${Modal.name} safely renders %s request failures and changes locale`,
    async (code) => {
      requestError = new ApiError(code, 'private transport detail');
      cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      await act(async () => {
        root = create(
          <QueryClientProvider client={cache}>
            <Modal visible onClose={() => {}} />
          </QueryClientProvider>,
        );
      });
      const key = code === 'network' ? 'auth.networkError' : 'common.requestTimeout';
      expect(JSON.stringify(root.toJSON())).toContain(translate(key));
      expect(JSON.stringify(root.toJSON())).not.toContain('private transport detail');
      await act(async () => {
        await setLanguage('en');
      });
      expect(JSON.stringify(root.toJSON())).toContain(translate(key));
    },
  );
}

for (const Modal of [ScheduleAssignModal, WorkerRequestModal]) {
  it(`${Modal.name} retains actionable local selection validation across languages`, async () => {
    requestError = undefined;
    cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root = create(
        <QueryClientProvider client={cache}>
          <Modal visible onClose={() => {}} />
        </QueryClientProvider>,
      );
    });
    if (Modal === WorkerRequestModal)
      await act(async () => {
        root.root
          .findAll((node) => String(node.type) === 'TextInput')[0]!
          .props.onChangeText('Synthetic reason');
      });
    const button =
      Modal === WorkerRequestModal ? 'requests.submitRequest' : 'contractorHome.assignSchedule';
    await act(async () => {
      await root.root
        .findAll(
          (node) =>
            String(node.type) === 'Pressable' &&
            node.props.accessibilityLabel === translate(button),
        )[0]!
        .props.onPress();
    });
    expect(JSON.stringify(root.toJSON())).toContain(
      translate('validation.required', { label: translate('schedule.shift') }),
    );
    await act(async () => {
      await setLanguage('en');
    });
    expect(JSON.stringify(root.toJSON())).toContain(
      translate('validation.required', { label: translate('schedule.shift') }),
    );
  });
}
