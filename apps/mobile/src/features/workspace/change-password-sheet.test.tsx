import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
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

async function passwordForm(current: string, next: string, confirm = next) {
  const client = new SmartSiteManagementClient('https://api.example.test');
  const change = vi.spyOn(client, 'changePassword').mockResolvedValue(undefined);
  workspace = { client, token: 'token', scope: { role: 'worker' } } as ReturnType<
    typeof useWorkspace
  >;
  cache = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <ChangePasswordModal visible onClose={vi.fn()} />
      </QueryClientProvider>,
    );
  });
  const input = (label: string) =>
    root.root.findAll(
      (n) => String(n.type) === 'TextInput' && n.props.accessibilityLabel === label,
    )[0]!;
  await act(async () => {
    input(t('profile.currentPassword')).props.onChangeText(current);
    input(t('profile.newPassword')).props.onChangeText(next);
    input(t('profile.confirmNewPassword')).props.onChangeText(confirm);
  });
  const submit = async () => {
    await act(async () =>
      root.root
        .findAll(
          (n) =>
            String(n.type) === 'Pressable' &&
            n.props.accessibilityLabel === t('profile.submitPasswordChange'),
        )[0]!
        .props.onPress(),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  };
  return { change, input, submit };
}

it.each([
  ['password1!', 'profile.passwordUppercaseRule'],
  ['Password!!', 'profile.passwordNumberRule'],
  ['Password12', 'profile.passwordSpecialRule'],
  ['Ab1!', 'profile.passwordLengthRule'],
  ['Ab1!' + 'x'.repeat(125), 'profile.passwordLengthRule'],
  ['Pass1!\nxx', 'profile.passwordCharactersRule'],
])(
  'explains the exact unmet rule for %s and does not send an invalid change',
  async (password, message) => {
    const { change, input, submit } = await passwordForm('OriginalPassword1!', password);
    await submit();
    expect(change).not.toHaveBeenCalled();
    expect(input(t('profile.newPassword')).props.accessibilityHint).toContain(t(message));
    expect(JSON.stringify(root.toJSON())).not.toContain('Validation failed');
  },
);

it('identifies missing fields instead of silently disabling password submission', async () => {
  const { change, input, submit } = await passwordForm('', '', '');
  await submit();
  expect(change).not.toHaveBeenCalled();
  expect(input(t('profile.currentPassword')).props.accessibilityHint).toContain(
    t('profile.currentPasswordRequired'),
  );
});

it('maps a server validation issue to its password field instead of showing Validation failed', async () => {
  const { change, input, submit } = await passwordForm('OriginalPassword1!', 'ValidPassword1!');
  change.mockRejectedValue(
    new ApiError('http', 'Validation failed', 400, {
      success: false,
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      requestId: 'synthetic',
      timestamp: '2026-11-23T00:00:00Z',
      path: '/api/v1/auth/change-password',
      issues: [{ path: '/newPassword', code: 'INVALID_VALUE', message: 'Invalid value' }],
    }),
  );
  await submit();
  expect(input(t('profile.newPassword')).props.accessibilityHint).toContain(
    t('profile.passwordServerRejected'),
  );
  expect(JSON.stringify(root.toJSON())).not.toContain('Validation failed');
  expect(afterPasswordChange).not.toHaveBeenCalled();
});

it('identifies the incorrect current password and keeps the form available to retry', async () => {
  const { change, input, submit } = await passwordForm('IncorrectPassword1!', 'ValidPassword1!');
  change.mockRejectedValue(new ApiError('http', 'Unauthorized', 401));
  await submit();
  expect(input(t('profile.currentPassword')).props.accessibilityHint).toContain(
    t('accountEmail.currentPasswordError'),
  );
  expect(input(t('profile.newPassword')).props.value).toBe('ValidPassword1!');
  expect(afterPasswordChange).not.toHaveBeenCalled();
});

it('accepts the real Backend policy without adding a lowercase-letter requirement', async () => {
  const { change, submit } = await passwordForm('OriginalPassword1!', 'ABCDEFG1!');
  await submit();
  expect(change).toHaveBeenCalledWith('token', 'OriginalPassword1!', 'ABCDEFG1!');
  expect(afterPasswordChange).toHaveBeenCalledOnce();
});
