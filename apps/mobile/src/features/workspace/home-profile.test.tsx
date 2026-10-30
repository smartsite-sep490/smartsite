import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { useWorkspace } from './workspace-context';
import { ProfileScreen } from './home-profile';

vi.mock('../auth/auth-context', () => ({ useAuth: () => ({ session: {} }) }));
vi.mock('./workspace-context', () => ({ useWorkspace: () => workspace }));
vi.mock('../shared/uploads', () => ({ Attachments: () => null, EvidenceButton: () => null }));
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
    canSwitchScope: false,
  };
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const onScopeChange = vi.fn();
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <ProfileScreen onScopeChange={onScopeChange} />
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
  const jsonStr = JSON.stringify(root.toJSON());
  expect(jsonStr).toContain('W000001');
  expect(jsonStr).toContain('Synthetic Site');
  const pressables = root.root.findAll((n) => String(n.type) === 'Pressable');
  const labels = pressables.map((n) => n.props.accessibilityLabel);
  expect(labels).toContain('Đổi mật khẩu và đăng nhập lại');
  expect(labels).toContain('Đăng xuất');
  expect(labels.some((label: string) => /khuôn mặt|đăng ký|thu hồi/i.test(label))).toBe(false);
  expect(face).not.toHaveBeenCalled();
  expect(enroll).not.toHaveBeenCalled();

  // Single-site worker must NOT have switch scope button
  const switchScopeBtn = pressables.find(
    (n) =>
      n.props.accessibilityLabel === 'Đổi công trường / vai trò được cấp' ||
      n.props.accessibilityLabel === 'Switch site / assigned role',
  );
  expect(switchScopeBtn).toBeUndefined();

  // Documents card is present and opens documents screen
  const docCard = pressables.find(
    (n) =>
      n.props.accessibilityLabel === 'Hồ sơ giấy tờ công nhân' ||
      n.props.accessibilityLabel === 'Worker documents',
  );
  expect(docCard).toBeDefined();
  await act(async () => {
    docCard!.props.onPress();
  });
  expect(JSON.stringify(root.toJSON())).toContain('Hồ sơ giấy tờ công nhân');
});

it('shows switch scope button when canSwitchScope is true for multi-scope user', async () => {
  const client = new SmartSiteManagementClient('https://api.example.test');
  vi.spyOn(client, 'listWorkers').mockResolvedValue({
    items: [
      {
        id: 'worker-b',
        userId: 'user-b',
        siteId: 'site-b',
        contractorId: 'contractor-b',
        externalId: 'W000002',
        displayName: 'Multi Site Worker',
        isActive: true,
        createdAt: '',
      },
    ],
    total: 1,
  });
  workspace = {
    client,
    token: 'token',
    workerId: 'worker-b',
    queryKey: ['mobile', 'worker-profile-multi'],
    user: {
      id: 'user-b',
      username: 'multi-site-worker',
      displayName: 'Multi Site Worker',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [
        { role: 'WORKER', siteId: 'site-b' },
        { role: 'WORKER', siteId: 'site-c' },
      ],
    },
    scope: {
      role: 'worker',
      siteId: 'site-b',
      siteName: 'Alpha Site',
      contractorId: '',
      contractorName: '',
    },
    canSwitchScope: true,
  };
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const onScopeChange = vi.fn();
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <ProfileScreen onScopeChange={onScopeChange} />
      </QueryClientProvider>,
    );
  });
  for (
    let attempt = 0;
    !JSON.stringify(root.toJSON()).includes('W000002') && attempt < 80;
    attempt++
  )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  expect(JSON.stringify(root.toJSON())).toContain('W000002');
  const pressables = root.root.findAll((n) => String(n.type) === 'Pressable');
  const switchScopeBtn = pressables.find(
    (n) =>
      n.props.accessibilityLabel === 'Đổi công trường / vai trò được cấp' ||
      n.props.accessibilityLabel === 'Switch site / assigned role',
  );
  expect(switchScopeBtn).toBeDefined();
  await act(async () => {
    switchScopeBtn!.props.onPress();
  });
  expect(onScopeChange).toHaveBeenCalled();
});
