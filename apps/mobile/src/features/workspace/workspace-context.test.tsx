import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient, type WorkerComplianceResponse } from '@smartsite/api-client';
import { useWorkspace, WorkspaceProvider } from './workspace-context';

const { adapter } = vi.hoisted(() => ({
  adapter: vi.fn(() => ({ signal: new AbortController().signal })),
}));
vi.mock('../auth/auth-context', () => ({
  API_URL: 'https://api.example.test',
  useAuth: () => ({ session: { adapter }, epoch: 1, token: 'session' }),
}));

const profile: WorkerComplianceResponse = {
  workerId: 'linked-worker',
  contractorId: 'contractor',
  displayName: 'Synthetic Worker',
  externalId: 'W001',
  nationalId: null,
  phoneNumber: null,
  gender: null,
  address: null,
  identityImages: [],
  documents: [],
  missingKinds: [],
  expiringKinds: [],
  status: 'PENDING',
  submissionStatus: 'NOT_SUBMITTED',
  needsSupplement: false,
};

let root: ReactTestRenderer;
let cache: QueryClient;
afterEach(async () => {
  await act(async () => root?.unmount());
  cache?.clear();
  vi.restoreAllMocks();
});

function WorkerWorkspace() {
  const { workerId, workerDocumentStatus } = useWorkspace();
  return <Text>{[workerId, workerDocumentStatus].join(' ')}</Text>;
}

it('opens the linked worker workspace without team access and retains it during a failed status refresh', async () => {
  const self = vi.spyOn(SmartSiteManagementClient.prototype, 'myWorkerCompliance');
  self.mockResolvedValue(profile);
  const team = vi.spyOn(SmartSiteManagementClient.prototype, 'myContractorTeam');
  team.mockRejectedValue(new Error('Participation is unavailable'));
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <WorkspaceProvider
          scope={{
            role: 'worker',
            siteId: 'site',
            siteName: 'Site',
            contractorId: '',
            contractorName: '',
          }}
          user={{
            id: 'worker-account',
            username: 'worker',
            displayName: 'Synthetic Worker',
            isActive: true,
            mustChangePassword: false,
            roleAssignments: [{ role: 'WORKER', siteId: 'site' }],
          }}
          onScopeChange={vi.fn()}
        >
          <WorkerWorkspace />
        </WorkspaceProvider>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(JSON.stringify(root.toJSON())).toContain('linked-worker PENDING'));
  expect(team).not.toHaveBeenCalled();
  expect(self).toHaveBeenCalledWith('session', 'site', expect.anything());
  self.mockRejectedValue(new Error('Synthetic network interruption'));
  await act(async () => {
    await cache.invalidateQueries({ queryKey: ['mobile'] });
  });
  expect(self).toHaveBeenCalledTimes(2);
  await vi.waitFor(() => {
    const screen = JSON.stringify(root.toJSON());
    expect(screen).toContain('Synthetic network interruption');
    expect(screen).toContain('linked-worker PENDING');
  });
});
