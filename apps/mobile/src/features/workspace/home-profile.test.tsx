import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { useWorkspace } from './workspace-context';
import { ProfileScreen } from './home-profile';
import { translate as t } from '../../i18n';

const { logout } = vi.hoisted(() => ({ logout: vi.fn(async () => {}) }));
vi.mock('../auth/auth-context', () => ({ useAuth: () => ({ session: { logout } }) }));
vi.mock('./workspace-context', () => ({ useWorkspace: () => workspace }));
vi.mock('../shared/uploads', () => ({ Attachments: () => null, EvidenceButton: () => null }));
let workspace: ReturnType<typeof useWorkspace>;
let root: ReactTestRenderer;
let cache: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache?.clear();
  vi.restoreAllMocks();
  logout.mockClear();
});

it.each(['worker', 'contractor'] as const)(
  'requires confirmation before signing out the %s and hides device notification settings',
  async (role) => {
    const client = new SmartSiteManagementClient('https://api.example.test');
    vi.spyOn(client, 'listWorkers').mockResolvedValue({ items: [], total: 0 });
    workspace = {
      client,
      token: 'token',
      workerId: '',
      queryKey: ['mobile', 'profile-confirmation', role],
      user: {
        id: 'user',
        username: 'synthetic-user',
        displayName: 'Synthetic User',
        isActive: true,
        mustChangePassword: false,
        roleAssignments: [],
      },
      scope: {
        role,
        siteId: 'site',
        siteName: 'Synthetic Site',
        contractorId: role === 'contractor' ? 'contractor' : '',
        contractorName: role === 'contractor' ? 'Synthetic Contractor' : '',
      },
    };
    cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const switchScope = vi.fn();
    await act(async () => {
      root = create(
        <QueryClientProvider client={cache}>
          <ProfileScreen onScopeChange={switchScope} />
        </QueryClientProvider>,
      );
    });
    const press = async (label: string) => {
      const button = root.root
        .findAll(
          (node) =>
            String(node.type) === 'Pressable' &&
            node.props.accessibilityRole === 'button' &&
            node.props.accessibilityLabel === label,
        )
        .at(-1)!;
      expect(button).toBeDefined();
      await act(async () => button.props.onPress());
    };
    expect(JSON.stringify(root.toJSON())).not.toContain(t('push.title'));
    await press(t('profile.siteLocation'));
    expect(switchScope).toHaveBeenCalledTimes(1);
    expect(
      root.root.findAll(
        (n) =>
          String(n.type) === 'Pressable' && n.props.accessibilityLabel === t('scope.switchScope'),
      ),
    ).toHaveLength(0);
    await press(t('profile.personalInfo'));
    expect(JSON.stringify(root.toJSON())).toContain(t('workforce.username'));
    expect(JSON.stringify(root.toJSON())).toContain(t('accountEmail.email'));
    expect(JSON.stringify(root.toJSON())).not.toContain(t('documents.FRONT'));
    await press(t('common.close'));
    await press(t('common.logout'));
    expect(JSON.stringify(root.toJSON())).toContain(t('profile.logoutConfirmMessage'));
    expect(logout).not.toHaveBeenCalled();
    await press(t('common.cancel'));
    expect(JSON.stringify(root.toJSON())).not.toContain(t('profile.logoutConfirmMessage'));
    expect(logout).not.toHaveBeenCalled();
    await press(t('common.logout'));
    await press(t('common.logout'));
    expect(logout).toHaveBeenCalledTimes(1);
  },
);

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
  const personal = vi.spyOn(client, 'workerCompliance').mockResolvedValue({
    workerId: 'worker-a',
    contractorId: 'contractor-a',
    externalId: 'W000001',
    displayName: 'Synthetic Worker',
    nationalId: '000000000001',
    phoneNumber: '0900000000',
    gender: 'MALE',
    address: 'Synthetic address',
    identityImages: [],
    documents: [],
    missingKinds: [],
    expiringKinds: [],
    status: 'PENDING',
    submissionStatus: 'NOT_SUBMITTED',
    needsSupplement: false,
  });
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
  expect(personal).not.toHaveBeenCalled();
  await act(async () =>
    pressables
      .find((n) => n.props.accessibilityLabel === t('profile.personalInfo'))!
      .props.onPress(),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  expect(personal).toHaveBeenCalledWith('token', 'site-a', 'worker-a');
  for (const value of ['000000000001', '0900000000', 'Synthetic address', t('documents.MALE')])
    expect(JSON.stringify(root.toJSON())).toContain(value);
  expect(JSON.stringify(root.toJSON())).not.toContain(t('documents.FRONT'));
  await act(async () =>
    root.root
      .findAll(
        (n) => String(n.type) === 'Pressable' && n.props.accessibilityLabel === t('common.close'),
      )
      .at(-1)!
      .props.onPress(),
  );

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

it('uses the existing site row to switch scope without an extra menu item for multi-scope users', async () => {
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
    (n) => n.props.accessibilityLabel === t('profile.siteLocation'),
  );
  expect(switchScopeBtn).toBeDefined();
  await act(async () => {
    switchScopeBtn!.props.onPress();
  });
  expect(onScopeChange).toHaveBeenCalled();
});
