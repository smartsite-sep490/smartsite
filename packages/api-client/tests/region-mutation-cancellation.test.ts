import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, type RequestOptions } from '../src/index';

const client = new SmartSiteManagementClient('https://api.example.test');
const input = {
  expectedConfigurationVersion: 3,
  polygon: {
    coordinates: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
  },
};
const methods = [
  [
    'create',
    (options: RequestOptions) =>
      client.createRegion('token', 'site', 'camera', { ...input, zoneId: 'zone' }, options),
  ],
  [
    'update',
    (options: RequestOptions) =>
      client.updatePolygon('token', 'site', 'camera', 'region', input, options),
  ],
] as const;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each(methods)(
  '%s does not send a request after its caller has already aborted',
  async (_name, invoke) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const caller = new AbortController();
    caller.abort();
    await expect(invoke({ signal: caller.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it.each(methods)('%s cancels a held transport when its editor is closed', async (_name, invoke) => {
  let transportSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      transportSignal = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    }),
  );
  const caller = new AbortController();
  const pending = invoke({ signal: caller.signal });
  const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  caller.abort();
  await rejected;
  expect(transportSignal?.aborted).toBe(true);
});
