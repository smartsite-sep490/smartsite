import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const client = new SmartSiteManagementClient('https://api.example.test');
const args = ['token', id(1), id(2)] as const;
const command = {
  commandId: id(3),
  expectedConfigurationVersion: 4,
  policy: { mode: 'EXPLICIT', requiredPpe: ['GLOVES'] },
} as const;
const receipt = {
  commandId: id(3),
  cameraId: id(2),
  configurationVersion: 5,
  viewRevision: 1,
  bundleSha256: 'a'.repeat(64),
  replayed: true,
};
function reply(value: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json(value));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

it('routes each command to its scoped endpoint and preserves replay receipts', async () => {
  const request = reply(receipt);
  expect(await client.initializePpePolicy(...args, { ...command, regionPolicies: [] })).toEqual(
    receipt,
  );
  expect(await client.updateCameraPpePolicy(...args, command)).toEqual(receipt);
  expect(await client.updateRegionPpePolicy(...args, id(4), command)).toEqual(receipt);
  expect(await client.activateRegionWithPpePolicy(...args, id(4), command)).toEqual(receipt);
  const base = `https://api.example.test/api/v1/sites/${id(1)}/cameras/${id(2)}/ppe-policy`;
  expect(request.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
    [base + '/initialize', 'POST'],
    [base, 'PATCH'],
    [base + '/regions/' + id(4), 'PATCH'],
    [base + '/regions/' + id(4) + '/activate', 'POST'],
  ]);
});

it('rejects receipts for a different command, camera, or saved revision', async () => {
  for (const invalid of [
    { ...receipt, commandId: id(9) },
    { ...receipt, cameraId: id(9) },
    { ...receipt, configurationVersion: 4 },
    { ...receipt, bundleSha256: 'invalid' },
  ]) {
    reply(invalid);
    await expect(client.updateCameraPpePolicy(...args, command)).rejects.toMatchObject({
      code: 'invalid-response',
    });
  }
});
