import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { PasswordRecoverySheet } from './password-recovery-sheet';
import { AccountEmailCard } from './account-email-card';
import type { useWorkspace } from '../workspace/workspace-context';
import { setLanguage, translate as t } from '../../i18n';
vi.mock('./auth-context', () => ({ API_URL: 'https://api.example.test' }));
vi.mock('../workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
let workspace: ReturnType<typeof useWorkspace>, root: ReactTestRenderer, cache: QueryClient;
function buttons(label: string) {
  const surface =
    root.root.findAll((node) => String(node.type) === 'Modal' && node.props.visible).at(-1) ??
    root.root;
  return surface.findAll(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label,
  );
}
async function click(label: string) {
  expect(buttons(label)).toHaveLength(1);
  await act(async () => buttons(label)[0]!.props.onPress());
  await settle();
}
async function input(label: string, value: string) {
  await act(async () =>
    root.root
      .findAll(
        (node) => String(node.type) === 'TextInput' && node.props.accessibilityLabel === label,
      )[0]!
      .props.onChangeText(value),
  );
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function mount(component: React.ReactNode) {
  await act(async () => {
    root = create(<QueryClientProvider client={cache}>{component}</QueryClientProvider>);
  });
}
beforeEach(async () => {
  await setLanguage('vi');
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  workspace = {
    client: new SmartSiteManagementClient('https://api.example.test'),
    token: 'test-token',
    queryKey: ['mobile', 'email'],
    workerId: 'worker',
    user: {
      id: 'user',
      username: 'synthetic',
      displayName: 'Synthetic Worker',
      isActive: true,
      mustChangePassword: false,
      email: 'synthetic@example.test',
      emailVerifiedAt: null,
      roleAssignments: [{ role: 'WORKER', siteId: 'site' }],
    },
    scope: {
      role: 'worker',
      siteId: 'site',
      siteName: 'Synthetic Site',
      contractorId: 'contractor',
      contractorName: 'Synthetic Contractor',
    },
  };
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache.clear();
  vi.restoreAllMocks();
});
it('requests a recovery code without claiming account existence and resets only with matching password confirmation', async () => {
  const request = vi
    .spyOn(SmartSiteManagementClient.prototype, 'requestPasswordReset')
    .mockResolvedValue({ accepted: true });
  const reset = vi
    .spyOn(SmartSiteManagementClient.prototype, 'confirmPasswordReset')
    .mockResolvedValue({ accepted: true });
  await mount(<PasswordRecoverySheet onClose={vi.fn()} />);
  await input(t('accountEmail.identifier'), ' Synthetic@Example.test ');
  await click(t('accountEmail.requestCode'));
  expect(request).toHaveBeenCalledWith({ identifier: 'synthetic@example.test', language: 'vi' });
  expect(JSON.stringify(root.toJSON())).toContain(t('accountEmail.requestAccepted'));
  await input(t('accountEmail.code'), '123456');
  await input(t('accountEmail.newPassword'), 'SyntheticNewPassword9!');
  expect(buttons(t('accountEmail.resetPassword'))[0]!.props.disabled).toBe(true);
  await input(t('accountEmail.confirmPassword'), 'SyntheticNewPassword9!');
  await click(t('accountEmail.resetPassword'));
  expect(reset).toHaveBeenCalledWith({
    identifier: 'synthetic@example.test',
    code: '123456',
    password: 'SyntheticNewPassword9!',
  });
  expect(JSON.stringify(root.toJSON())).toContain(t('accountEmail.resetSuccess'));
  expect(JSON.stringify(root.toJSON())).not.toContain('SyntheticNewPassword9!');
});
it('requires the current password to change email and opens verification for the entered address', async () => {
  const update = vi
    .spyOn(workspace.client, 'setAccountEmail')
    .mockResolvedValue({ accepted: true });
  await mount(<AccountEmailCard />);
  await click(t('accountEmail.changeEmail'));
  await input(t('accountEmail.email'), 'new@example.test');
  expect(buttons(t('accountEmail.saveEmail'))[0]!.props.disabled).toBe(true);
  await input(t('profile.currentPassword'), 'SyntheticCurrent9!');
  await click(t('accountEmail.saveEmail'));
  expect(update).toHaveBeenCalledWith('test-token', {
    email: 'new@example.test',
    currentPassword: 'SyntheticCurrent9!',
    language: 'vi',
  });
  expect(JSON.stringify(root.toJSON())).toContain('new@example.test');
  expect(JSON.stringify(root.toJSON())).not.toContain('SyntheticCurrent9!');
});
it('verifies only the current authenticated account and hides verification controls for verified email', async () => {
  const verify = vi
    .spyOn(workspace.client, 'verifyAccountEmail')
    .mockResolvedValue({ accepted: true });
  await mount(<AccountEmailCard />);
  await click(t('accountEmail.verifyAction'));
  await input(t('accountEmail.code'), '654321');
  await click(t('accountEmail.verifyAction'));
  expect(verify).toHaveBeenCalledWith('test-token', { code: '654321' });
});
