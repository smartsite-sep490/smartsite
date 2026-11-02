import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, type RequestOptions } from '../src/index';

const siteId = '11111111-1111-4111-8111-111111111111';
const cameraId = '22222222-2222-4222-8222-222222222222';
const page = { items: [], total: 0 };
const cases = [
  {
    name: 'zones',
    path: `/sites/${siteId}/zones`,
    load: (client: SmartSiteManagementClient, options?: RequestOptions) =>
      client.listZones('metadata-token', siteId, { offset: 20, limit: 20 }, options),
    legacy: (client: SmartSiteManagementClient) =>
      client.listZones('metadata-token', siteId, { offset: 20, limit: 20 }),
  },
  {
    name: 'cameras',
    path: `/sites/${siteId}/cameras`,
    load: (client: SmartSiteManagementClient, options?: RequestOptions) =>
      client.listCameras('metadata-token', siteId, { offset: 20, limit: 20 }, options),
    legacy: (client: SmartSiteManagementClient) =>
      client.listCameras('metadata-token', siteId, { offset: 20, limit: 20 }),
  },
  {
    name: 'regions',
    path: `/sites/${siteId}/cameras/${cameraId}/regions`,
    load: (client: SmartSiteManagementClient, options?: RequestOptions) =>
      client.listRegions('metadata-token', siteId, cameraId, { offset: 20, limit: 20 }, options),
    legacy: (client: SmartSiteManagementClient) =>
      client.listRegions('metadata-token', siteId, cameraId, { offset: 20, limit: 20 }),
  },
];

afterEach(() => vi.unstubAllGlobals());

describe.each(cases)('$name metadata transport cancellation', ({ path, load, legacy }) => {
  it('preserves the legacy pagination URL, method and credential header without request options', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(page));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SmartSiteManagementClient('https://api.example.test');

    await expect(legacy(client)).resolves.toEqual(page);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(`https://api.example.test/api/v1${path}`);
    expect([...parsed.searchParams.entries()].sort()).toEqual([
      ['limit', '20'],
      ['offset', '20'],
    ]);
    expect(init).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer metadata-token' }),
    });
  });

  it('rejects a pre-aborted scope before issuing a fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(page));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(
      load(new SmartSiteManagementClient('https://api.example.test'), {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancels an in-flight fetch and rejects a late successful response after the scope aborts', async () => {
    let resolveFetch!: (response: Response) => void;
    let markStarted!: () => void;
    let transportSignal: AbortSignal | null | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        transportSignal = init.signal;
        markStarted();
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        });
      }),
    );
    const controller = new AbortController();
    const outcome = load(new SmartSiteManagementClient('https://api.example.test'), {
      signal: controller.signal,
    }).then(
      (value) => ({ kind: 'success', value }),
      (error: unknown) => ({ kind: 'error', error }),
    );
    await started;
    controller.abort();
    resolveFetch(Response.json(page));

    expect(await outcome).toMatchObject({ kind: 'error', error: { code: 'cancelled' } });
    expect(transportSignal?.aborted).toBe(true);
  });
});
