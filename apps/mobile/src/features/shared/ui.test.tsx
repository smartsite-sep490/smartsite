import { afterEach, expect, it } from 'vitest';
import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Field, QueryState } from './ui';
let root: ReactTestRenderer;
let cache: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache?.clear();
});
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
