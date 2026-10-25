import { afterEach, expect, it } from 'vitest';
import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ApiError } from '@smartsite/api-client';
import { Field, QueryState, ErrorNotice, errorMessage } from './ui';
import { setLanguage, translate } from '../../i18n';
let root: ReactTestRenderer;
let cache: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache?.clear();
  await setLanguage('vi');
});

it.each(['en', 'vi'] as const)('formats request failures safely in %s', async (language) => {
  await setLanguage(language);
  expect(errorMessage(new ApiError('http', 'private', 401), 'login')).toBe(
    translate('auth.invalidCredentials'),
  );
  expect(errorMessage(new ApiError('http', 'private', 401))).toBe(translate('auth.sessionExpired'));
  for (const [status, key] of [
    [400, 'common.requestValidation'],
    [403, 'auth.permissionDenied'],
    [404, 'common.requestMissing'],
    [409, 'auth.conflictError'],
    [429, 'common.requestRateLimit'],
    [500, 'common.serviceUnavailable'],
  ] as const)
    expect(errorMessage(new ApiError('http', 'private technical detail', status))).toBe(
      translate(key),
    );
  expect(errorMessage(new ApiError('http', 'private', 429, undefined, 15))).toBe(
    translate('common.requestRateLimitDelay', { seconds: 15 }),
  );
  expect(errorMessage(new ApiError('network', 'private'))).toBe(translate('auth.networkError'));
  expect(errorMessage(new ApiError('timeout', 'private'))).toBe(translate('common.requestTimeout'));
  for (const raw of [
    'Backend returned invalid JSON.',
    'Backend returned an invalid evidence type.',
  ])
    expect(errorMessage(new ApiError('invalid-response', raw))).toBe(
      translate('common.serviceUnavailable'),
    );
  expect(errorMessage(new Error('Unexpected internal exception'))).toBe(
    translate('common.unexpectedError'),
  );
  expect(errorMessage(new Error(translate('documents.required')))).toBe(
    translate('documents.required'),
  );
  expect(errorMessage(new ApiError('http', translate('documents.required'), 400))).toBe(
    translate('documents.required'),
  );
  expect(errorMessage(new ApiError('http', translate('documents.required'), 500))).toBe(
    translate('common.serviceUnavailable'),
  );
});

it('translates a stored validation error when the language changes', async () => {
  const error = new Error(
    translate('validation.required', { label: translate('workforce.fullName') }),
  );
  await act(async () => {
    root = create(<ErrorNotice error={error} context="login" />);
  });
  await act(async () => {
    await setLanguage('en');
  });
  expect(JSON.stringify(root.toJSON())).toContain(
    translate('validation.required', { label: translate('workforce.fullName') }),
  );
  expect(JSON.stringify(root.toJSON())).not.toContain('bắt buộc');
});

it.each(['en', 'vi'] as const)(
  'keeps HTTP failure meaning when the error body is malformed in %s',
  async (language) => {
    await setLanguage(language);
    const malformed = (status: number, retryAfterSeconds?: number) =>
      new ApiError(
        'invalid-response',
        'Backend returned invalid JSON.',
        status,
        undefined,
        retryAfterSeconds,
      );
    expect(errorMessage(malformed(401), 'login')).toBe(translate('auth.invalidCredentials'));
    expect(errorMessage(malformed(401))).toBe(translate('auth.sessionExpired'));
    for (const [status, key] of [
      [400, 'common.requestValidation'],
      [403, 'auth.permissionDenied'],
      [404, 'common.requestMissing'],
      [409, 'auth.conflictError'],
      [429, 'common.requestRateLimit'],
      [500, 'common.serviceUnavailable'],
    ] as const)
      expect(errorMessage(malformed(status))).toBe(translate(key));
    expect(errorMessage(malformed(429, 17))).toBe(
      translate('common.requestRateLimitDelay', { seconds: 17 }),
    );
    expect(errorMessage(malformed(200))).toBe(translate('common.serviceUnavailable'));
  },
);

it.each(['en', 'vi'] as const)(
  'uses user-facing unavailable configuration copy in %s',
  async (language) => {
    await setLanguage(language);
    expect(translate('auth.configHint')).not.toMatch(/EXPO_|\.env|10\.0\.2\.2|Metro/);
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
