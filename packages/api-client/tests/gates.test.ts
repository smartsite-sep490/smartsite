import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';
const siteId = '11111111-1111-4111-8111-111111111111';
const gate = {
  id: '22222222-2222-4222-8222-222222222222',
  siteId,
  code: 'MAIN',
  name: 'Authored main gate',
  status: 'ACTIVE',
};
afterEach(() => vi.unstubAllGlobals());
it('creates a gate with only a name and returns the server-generated code', async () => {
  const response = { ...gate, code: 'GATE-12ABCDEF3456' };
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(response)));
  vi.stubGlobal('fetch', fetch);
  const created = await new SmartSiteManagementClient('https://synthetic.test').createSiteGate(
    'synthetic-token',
    siteId,
    { name: gate.name },
  );
  expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({ name: gate.name });
  expect(created.code).toBe('GATE-12ABCDEF3456');
});
it('loads every catalog page with Site scope and status, without fixed gate codes', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ items: [gate], total: 2 })))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [{ ...gate, id: '33333333-3333-4333-8333-333333333333' }],
          total: 2,
        }),
      ),
    );
  vi.stubGlobal('fetch', fetch);
  const result = await new SmartSiteManagementClient('https://synthetic.test').listAllSiteGates(
    'synthetic-token',
    siteId,
    'ACTIVE',
  );
  expect(result.items).toHaveLength(2);
  expect(fetch.mock.calls[1]?.[0]).toContain('offset=1&limit=100&status=ACTIVE');
});
it('rejects a catalog returned for another Site', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [{ ...gate, siteId: 'other-site' }], total: 1 })),
    ),
  );
  await expect(
    new SmartSiteManagementClient('https://synthetic.test').listAllSiteGates(
      'synthetic-token',
      siteId,
    ),
  ).rejects.toMatchObject({ code: 'invalid-response' });
});
it('sends the registered source UUID with FACE presence and verification multipart', async () => {
  const fetch = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://synthetic.test'),
    frame = new Blob(['synthetic'], { type: 'image/jpeg' });
  await client.observeGateFace(
    'synthetic-token',
    siteId,
    gate.id,
    'session-id',
    frame,
    'camera-source',
  );
  await client.verifyFaceGate('synthetic-token', siteId, gate.id, frame, 'OUT', 'camera-source');
  for (const call of fetch.mock.calls as unknown as Array<[string, RequestInit]>)
    expect((call[1].body as FormData).get('sourceCameraId')).toBe('camera-source');
});
it('uses a public Gate catalog without an authorization header or Camera fields', async () => {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ items: [{ id: gate.id, code: gate.code, name: gate.name }] })),
  );
  vi.stubGlobal('fetch', fetch);
  await new SmartSiteManagementClient('https://synthetic.test').listVisitorGates(siteId);
  expect(fetch.mock.calls[0]?.[0]).toContain('/visitor-registration/sites/' + siteId + '/gates');
  expect(
    (fetch.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1].headers,
  ).not.toHaveProperty('Authorization');
});
it('rejects registered sources outside the selected Gate', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [{ ...gate, gateId: '33333333-3333-4333-8333-333333333333' }],
          }),
        ),
    ),
  );
  await expect(
    new SmartSiteManagementClient('https://synthetic.test').listGateSources(
      'synthetic-token',
      siteId,
      gate.id,
    ),
  ).rejects.toMatchObject({ code: 'invalid-response' });
});
it('rejects malformed public Gate IDs and drops unrequested response fields', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ ...gate, id: 'legacy-gate' }] })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ ...gate, cameraSecret: 'synthetic' }] })),
      ),
  );
  const client = new SmartSiteManagementClient('https://synthetic.test');
  await expect(client.listVisitorGates(siteId)).rejects.toMatchObject({ code: 'invalid-response' });
  expect(await client.listVisitorGates(siteId)).toEqual({
    items: [{ id: gate.id, code: gate.code, name: gate.name }],
  });
});
