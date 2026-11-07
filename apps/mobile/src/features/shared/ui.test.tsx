import { afterEach, expect, it } from 'vitest';
import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ApiError } from '@smartsite/api-client';
import { setLanguage, translate } from '../../i18n';
import { Disclosure, ErrorNotice, Field, QueryState } from './ui';
let root: ReactTestRenderer;
let cache: QueryClient;
it('keeps an in-progress form when its section is collapsed and reopened', async () => {
  function Draft() {
    const [value, setValue] = useState('');
    return <Field label="Draft" value={value} onChangeText={setValue} />;
  }
  await act(async () => {
    root = create(
      <Disclosure title="Section">
        <Draft />
      </Disclosure>,
    );
  });
  const toggle = () =>
    root.root.findAll(
      (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Section',
    )[0]!;
  expect(toggle().props.accessibilityState.expanded).toBe(false);
  await act(async () => toggle().props.onPress());
  await act(async () =>
    root.root
      .findAll((node) => String(node.type) === 'TextInput')[0]!
      .props.onChangeText('Unsaved draft'),
  );
  await act(async () => toggle().props.onPress());
  await act(async () => toggle().props.onPress());
  expect(root.root.findAll((node) => String(node.type) === 'TextInput')[0]!.props.value).toBe(
    'Unsaved draft',
  );
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache?.clear();
  await setLanguage('vi');
});

it.each(['vi', 'en'] as const)(
  'distinguishes invalid login credentials from expired sessions in %s',
  async (language) => {
    await setLanguage(language);
    const unauthorized = new ApiError('http', 'Unauthorized', 401);
    await act(async () => {
      root = create(<ErrorNotice error={unauthorized} context="login" />);
    });
    expect(JSON.stringify(root.toJSON())).toContain(translate('auth.invalidCredentials'));
    expect(JSON.stringify(root.toJSON())).not.toContain(translate('auth.sessionExpired'));

    await act(async () => {
      root.update(<ErrorNotice error={unauthorized} />);
    });
    expect(JSON.stringify(root.toJSON())).toContain(translate('auth.sessionExpired'));

    await act(async () => {
      root.update(<ErrorNotice error={new ApiError('network', 'offline')} context="login" />);
    });
    expect(JSON.stringify(root.toJSON())).toContain(translate('auth.networkError'));

    await act(async () => {
      root.update(<ErrorNotice error={new ApiError('http', 'Forbidden', 403)} context="login" />);
    });
    expect(JSON.stringify(root.toJSON())).toContain(translate('auth.permissionDenied'));
  },
);
it('keeps an entered draft when a background refetch fails and exposes retry', async () => {
  let offline = false;
  function Draft() {
    const [text, setText] = useState('');
    return <Field label="Draft" value={text} onChangeText={setText} />;
  }
  function Screen() {
    const query = useQuery({
      queryKey: ['draft'],
      queryFn: async () => {
        if (offline) throw new Error('offline');
        return { id: 'record' };
      },
    });
    return <QueryState query={query}>{() => <Draft />}</QueryState>;
  }
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <Screen />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  await act(async () => {
    root.root
      .findAll((n) => String(n.type) === 'TextInput')[0]!
      .props.onChangeText('Keep this draft');
  });
  offline = true;
  await act(async () => {
    await cache.invalidateQueries({ queryKey: ['draft'] });
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(root.root.findAll((n) => String(n.type) === 'TextInput')[0]!.props.value).toBe(
    'Keep this draft',
  );
  expect(
    root.root.findAll(
      (n) => String(n.type) === 'Pressable' && n.props.accessibilityLabel === 'Thử lại',
    ),
  ).toHaveLength(1);
});
