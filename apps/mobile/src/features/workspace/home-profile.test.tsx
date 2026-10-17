import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { useWorkspace } from './workspace-context';
import { ProfileScreen } from './home-profile';

vi.mock('../auth/auth-context', () => ({ useAuth: () => ({ session: {} }) }));
vi.mock('./workspace-context', () => ({ useWorkspace: () => workspace }));
let workspace: ReturnType<typeof useWorkspace>;
let root: ReactTestRenderer;
let cache: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache?.clear();
  vi.restoreAllMocks();
});

it('shows the Worker account without face enrollment controls or face API requests', async () => {
  const client = new SmartSiteManagementClient('https://api.example.test');
  vi.spyOn(client, 'listWorkers').mockResolvedValue({
    items: [
      {
        id: 'worker-a',
        userId: 'user-a',
        siteId: 'site-a',
        contractorId: 'contractor-a',
        externalId: 'W000001',
        displayName: 'Synthetic Worker',
        isActive: true,
        createdAt: '',
      },
    ],
    total: 1,
  });
  const face = vi
    .spyOn(client, 'getFaceProfile')
    .mockRejectedValue(new Error('Worker cannot read face management'));
  const enroll = vi.spyOn(client, 'startFaceEnrollment');
  workspace = {
    client,
    token: 'token',
    workerId: 'worker-a',
    queryKey: ['mobile', 'worker-profile'],
    user: {
      id: 'user-a',
      username: 'synthetic-worker',
      displayName: 'Synthetic Worker',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'WORKER', siteId: 'site-a' }],
    },
    scope: {
      role: 'worker',
      siteId: 'site-a',
      siteName: 'Synthetic Site',
      contractorId: '',
      contractorName: '',
    },
  };
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <ProfileScreen onScopeChange={() => {}} />
      </QueryClientProvider>,
    );
  });
  for (
    let attempt = 0;
    !JSON.stringify(root.toJSON()).includes('W000001') && attempt < 80;
    attempt++
  )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  expect(JSON.stringify(root.toJSON())).toContain('W000001');
  const labels = root.root
    .findAll((n) => String(n.type) === 'Pressable')
    .map((n) => n.props.accessibilityLabel);
  expect(labels).toContain('Đổi mật khẩu và đăng nhập lại');
  expect(labels).toContain('Đăng xuất');
  expect(labels.some((label: string) => /khuôn mặt|đăng ký|thu hồi/i.test(label))).toBe(false);
  expect(face).not.toHaveBeenCalled();
  expect(enroll).not.toHaveBeenCalled();
});
