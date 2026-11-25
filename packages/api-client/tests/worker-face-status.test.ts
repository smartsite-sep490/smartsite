import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';

afterEach(() => vi.unstubAllGlobals());

it('reads own face status with the selected Site and no Worker or biometric payload', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'ACTIVE' })));
  vi.stubGlobal('fetch', fetchMock);
  const client = new SmartSiteManagementClient('https://api.example.test');
  expect(await client.myWorkerFaceStatus('synthetic-token', 'site/one')).toEqual({
    status: 'ACTIVE',
  });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://api.example.test/api/v1/sites/site%2Fone/workers/me/face-status');
  expect(init.method).toBe('GET');
  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer synthetic-token');
  expect(init.body).toBeUndefined();
});
