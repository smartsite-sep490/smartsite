import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApiError,
  SmartSiteManagementClient,
  type WorkerComplianceResponse,
} from '@smartsite/api-client';
import type { useWorkspace } from './workspace-context';
import { ProfileScreen } from './home-profile';
import { translate as t, setLanguage } from '../../i18n';
import { Button } from '../shared/ui';
import { SingleDocumentAttachment } from '../shared/uploads';

const { logout } = vi.hoisted(() => ({ logout: vi.fn(async () => {}) }));
vi.mock('../auth/auth-context', () => ({ useAuth: () => ({ session: { logout } }) }));
vi.mock('./workspace-context', () => ({ useWorkspace: () => workspace }));
vi.mock('../shared/uploads', () => ({
  Attachments: () => null,
  EvidenceButton: () => null,
  SingleDocumentAttachment: () => null,
}));
let workspace: ReturnType<typeof useWorkspace>;
let root: ReactTestRenderer;
let cache: QueryClient;

const ownProfile: WorkerComplianceResponse = {
  workerId: 'worker',
  contractorId: 'contractor',
  externalId: 'W000001',
  displayName: 'Synthetic Worker',
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

async function waitForFaceStatus(status: string) {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const labels = root.root
      .findAll((node) => String(node.type) === 'Pressable')
      .map((node) => node.props.accessibilityLabel);
    expect(labels).toContain(`${t('profileFace.title')}: ${t(`profileFace.${status}`)}`);
  });
}

async function mountFaceStatus() {
  const client = new SmartSiteManagementClient('https://api.example.test');
  vi.spyOn(client, 'myWorkerCompliance').mockResolvedValue(ownProfile);
  workspace = {
    client,
    token: 'token',
    workerId: 'worker',
    queryKey: ['mobile', 'face-status'],
    user: {
      id: 'user',
      username: 'synthetic',
      displayName: 'Synthetic Worker',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [],
    },
    scope: {
      role: 'worker',
      siteId: 'site',
      siteName: 'Site',
      contractorId: '',
      contractorName: '',
    },
  };
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <ProfileScreen onScopeChange={vi.fn()} />
      </QueryClientProvider>,
    );
  });
  await waitForFaceStatus('ACTIVE');
}
beforeEach(() => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'myWorkerFaceStatus').mockResolvedValue({
    status: 'NOT_ENROLLED',
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache?.clear();
  vi.restoreAllMocks();
  logout.mockClear();
  await setLanguage('vi');
});

it.each(['vi', 'en'] as const)(
  'shows real face states independently of an active account in %s',
  async (language) => {
    await setLanguage(language);
    const status = vi.mocked(SmartSiteManagementClient.prototype.myWorkerFaceStatus);
    status.mockResolvedValue({ status: 'ACTIVE' });
    await mountFaceStatus();
    for (const value of [
      'ACTIVE',
      'NOT_ENROLLED',
      'REVOKED',
      'NEEDS_REENROLL',
      'DELETED',
    ] as const) {
      status.mockResolvedValue({ status: value });
      await act(async () => {
        await cache.invalidateQueries({ queryKey: ['mobile', 'face-status', 'own-face-status'] });
      });
      await waitForFaceStatus(value);
      expect(JSON.stringify(root.toJSON())).toContain(t(`profileFace.${value}`));
    }
    status.mockRejectedValue(new Error('synthetic unavailable'));
    await act(async () => {
      await cache.invalidateQueries({ queryKey: ['mobile', 'face-status', 'own-face-status'] });
    });
    await waitForFaceStatus('unavailable');
    expect(JSON.stringify(root.toJSON())).toContain(t('profileFace.unavailable'));
    expect(JSON.stringify(root.toJSON())).not.toContain(t('profileFace.DELETED'));
    const retry = root.root.findAll(
      (n) =>
        String(n.type) === 'Pressable' &&
        n.props.accessibilityLabel === `${t('profileFace.title')}: ${t('profileFace.unavailable')}`,
    )[0]!;
    status.mockResolvedValue({ status: 'ACTIVE' });
    await act(async () => {
      retry.props.onPress();
    });
    await waitForFaceStatus('ACTIVE');
    expect(JSON.stringify(root.toJSON())).toContain(t('profileFace.ACTIVE'));
  },
);

it.each(['worker', 'contractor'] as const)(
  'requires confirmation before signing out the %s and hides device notification settings',
  async (role) => {
    const client = new SmartSiteManagementClient('https://api.example.test');
    vi.spyOn(client, 'myWorkerCompliance').mockRejectedValue(
      new ApiError('http', 'Not found', 404),
    );
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
    if (role === 'contractor') expect(client.myWorkerFaceStatus).not.toHaveBeenCalled();
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

it('edits own identity despite unavailable contractor access and only reads the face status', async () => {
  const client = new SmartSiteManagementClient('https://api.example.test');
  const ownFace = Promise.withResolvers<{ status: 'NOT_ENROLLED' }>();
  vi.mocked(client.myWorkerFaceStatus).mockReturnValue(ownFace.promise);
  const directory = vi.spyOn(client, 'listWorkers').mockRejectedValue(new Error('Inactive worker'));
  const team = vi
    .spyOn(client, 'myContractorTeam')
    .mockRejectedValue(new Error('Inactive contractor participation'));
  const face = vi
    .spyOn(client, 'getFaceProfile')
    .mockRejectedValue(new Error('Worker cannot read face management'));
  const enroll = vi.spyOn(client, 'startFaceEnrollment');
  const updateIdentity = vi
    .spyOn(client, 'updateMyWorkerIdentity')
    .mockResolvedValue({ version: 1 });
  const personal = vi.spyOn(client, 'myWorkerCompliance').mockResolvedValue({
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
    !(
      JSON.stringify(root.toJSON()).includes('W000001') &&
      JSON.stringify(root.toJSON()).includes(t('profileFace.NOT_ENROLLED'))
    ) && attempt < 80;
    attempt++
  )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  const jsonStr = JSON.stringify(root.toJSON());
  expect(jsonStr).toContain('W000001');
  expect(jsonStr).toContain('Synthetic Site');
  expect(jsonStr).toContain(t('profileFace.loading'));
  expect(jsonStr).not.toContain(t('profileFace.NOT_ENROLLED'));
  ownFace.resolve({ status: 'NOT_ENROLLED' });
  await waitForFaceStatus('NOT_ENROLLED');
  const pressables = root.root.findAll((n) => String(n.type) === 'Pressable');
  const labels = pressables.map((n) => n.props.accessibilityLabel);
  expect(labels).toContain('Đổi mật khẩu và đăng nhập lại');
  expect(labels).toContain('Đăng xuất');
  expect(labels).toContain(`${t('profileFace.title')}: ${t('profileFace.NOT_ENROLLED')}`);
  expect(client.myWorkerFaceStatus).toHaveBeenCalledWith('token', 'site-a');
  expect(face).not.toHaveBeenCalled();
  expect(enroll).not.toHaveBeenCalled();
  expect(personal).toHaveBeenCalledWith(
    'token',
    'site-a',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(directory).not.toHaveBeenCalled();
  expect(team).not.toHaveBeenCalled();
  await act(async () =>
    pressables
      .find((n) => n.props.accessibilityLabel === t('profile.personalInfo'))!
      .props.onPress(),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  for (const value of ['000000000001', '0900000000', 'Synthetic address', t('documents.MALE')])
    expect(JSON.stringify(root.toJSON())).toContain(value);
  const sides = root.root.findAllByType(SingleDocumentAttachment);
  expect(sides.map((node) => node.props.label)).toEqual([
    t('documents.FRONT'),
    t('documents.BACK'),
  ]);
  const front = { uri: 'file:///front.jpg', name: 'front.jpg', type: 'image/jpeg' };
  const back = { uri: 'file:///back.png', name: 'back.png', type: 'image/png' };
  const save = () =>
    root.root
      .findAllByType(Button)
      .find((node) => node.props.label === t('onboarding.saveIdentity'))!;
  expect(save().props.disabled).toBe(true);
  await act(async () => sides[0]!.props.onChange(front));
  expect(save().props.disabled).toBe(true);
  await act(async () => sides[1]!.props.onChange(back));
  expect(save().props.disabled).toBe(false);
  await act(async () => save().props.onPress());
  await vi.waitFor(() =>
    expect(updateIdentity).toHaveBeenCalledWith(
      'token',
      'site-a',
      {
        expectedVersion: 0,
        nationalId: '000000000001',
        phoneNumber: '0900000000',
        gender: 'MALE',
        address: 'Synthetic address',
      },
      { FRONT: front, BACK: back },
    ),
  );
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
  vi.spyOn(client, 'myWorkerCompliance').mockResolvedValue({
    ...ownProfile,
    workerId: 'worker-b',
    contractorId: 'contractor-b',
    externalId: 'W000002',
    displayName: 'Multi Site Worker',
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
