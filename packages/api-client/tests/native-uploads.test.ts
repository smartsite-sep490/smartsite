import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';

afterEach(() => vi.unstubAllGlobals());
it('uploads URI-backed mobile evidence using append-only native FormData and bearer auth', async () => {
  class NativeForm {
    parts: [string, unknown][] = [];
    append(name: string, value: unknown) {
      this.parts.push([name, value]);
    }
  }
  vi.stubGlobal('FormData', NativeForm);
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    Response.json({}),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test');
  const file = { uri: 'file:///synthetic.jpg', name: 'synthetic.jpg', type: 'image/jpeg' };
  await client.submitSafetyChecklist(
    'token',
    'site',
    'checklist',
    { commandId: 'cmd', expectedVersion: 1, results: [] },
    [file],
  );
  await client.incidentCommand(
    'token',
    'site',
    'incident',
    'submit',
    { commandId: 'cmd', expectedVersion: 1, resultDescription: 'Repaired' },
    'action',
    file,
  );
  await client.checkFaceEnrollmentQuality('token', 'worker', file, 'left');
  await client.uploadFaceEnrollmentSample('token', 'session', file);
  for (const [, init] of fetch.mock.calls) {
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token' });
    expect(init.headers).not.toHaveProperty('Content-Type');
    expect((init.body as unknown as NativeForm).parts.some(([, value]) => value === file)).toBe(
      true,
    );
  }
  expect((fetch.mock.calls[2]![1].body as unknown as NativeForm).parts).toContainEqual([
    'target',
    'left',
  ]);
});
it('combines query and session cancellation without AbortSignal.any or DOMException globals', async () => {
  const session = new AbortController(),
    query = new AbortController();
  vi.stubGlobal('AbortSignal', class {});
  vi.stubGlobal('DOMException', undefined);
  const start = Promise.withResolvers<void>();
  const fetch = vi.fn(async () => {
    start.resolve();
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test', {
    signal: session.signal,
    getAccessToken: () => 'token',
    refreshAccessToken: async () => 'token',
    onUnauthorized: () => {},
  });
  const pending = client.listSites('token', undefined, { signal: query.signal });
  await start.promise;
  query.abort();
  await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
});
