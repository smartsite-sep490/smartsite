import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { ChangePasswordModal } from './home-profile';
import type { useWorkspace } from './workspace-context';
import { translate as t } from '../../i18n';

const { afterPasswordChange } = vi.hoisted(() => ({ afterPasswordChange: vi.fn(async () => {}) }));
vi.mock('../auth/auth-context', () => ({ useAuth: () => ({ session: { afterPasswordChange } }) }));
vi.mock('./workspace-context', () => ({ useWorkspace: () => workspace }));
vi.mock('../shared/uploads', () => ({ Attachments: () => null, EvidenceButton: () => null }));
let workspace: ReturnType<typeof useWorkspace>;
let root: ReactTestRenderer;
let cache: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache?.clear();
  vi.restoreAllMocks();
  afterPasswordChange.mockClear();
});

it.each(['worker', 'contractor'] as const)(
  'keeps password fields scrollable and submission reachable for %s',
  async (role) => {
    const client = new SmartSiteManagementClient('https://api.example.test');
    const change = vi.spyOn(client, 'changePassword').mockResolvedValue(undefined);
    workspace = { client, token: 'token', scope: { role } } as ReturnType<typeof useWorkspace>;
    cache = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const close = vi.fn();
    await act(async () => {
      root = create(
        <QueryClientProvider client={cache}>
          <ChangePasswordModal visible onClose={close} />
        </QueryClientProvider>,
      );
    });
    const input = (label: string) =>
      root.root.findAll(
        (n) => String(n.type) === 'TextInput' && n.props.accessibilityLabel === label,
      )[0]!;
    const button = () =>
      root.root.findAll(
        (n) =>
          String(n.type) === 'Pressable' &&
          n.props.accessibilityLabel === t('profile.submitPasswordChange'),
      )[0]!;
    const fields = root.root.findAll((n) => String(n.type) === 'TextInput');
    expect(fields).toHaveLength(3);
    expect(fields.every((n) => n.props.secureTextEntry && n.props.autoCorrect === false)).toBe(
      true,
    );
    const scrolling = root.root.findAll((n) => String(n.type) === 'ScrollView')[0]!;
    expect(scrolling.props.keyboardShouldPersistTaps).toBe('handled');
    expect(root.root.findAll((n) => String(n.type) === 'KeyboardAvoidingView')).toHaveLength(1);
    await act(async () => {
      input(t('profile.currentPassword')).props.onChangeText('SyntheticOld1!');
      input(t('profile.newPassword')).props.onChangeText('SyntheticNew1!');
      input(t('profile.confirmNewPassword')).props.onChangeText('Mismatch1!');
    });
    await act(async () => button().props.onPress());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(change).not.toHaveBeenCalled();
    expect(JSON.stringify(root.toJSON())).toContain(t('profile.passwordMismatch'));
    await act(async () =>
      input(t('profile.confirmNewPassword')).props.onChangeText('SyntheticNew1!'),
    );
    await act(async () => button().props.onPress());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(change).toHaveBeenCalledWith('token', 'SyntheticOld1!', 'SyntheticNew1!');
    expect(afterPasswordChange).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(
      root.root.findAll((n) => String(n.type) === 'TextInput').every((n) => n.props.value === ''),
    ).toBe(true);
  },
);
