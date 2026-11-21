import { afterEach, expect, it, vi } from 'vitest';
import { cameraSourceClient, SourceSetupError } from '../src/camera-source';
const id = '11111111-1111-4111-8111-111111111111';
const command = { commandId: id, expectedRevision: 4, expectedConfigurationVersion: 12 };
const result = {
  state: 'STARTED',
  commandId: id,
  sourceRevision: 4,
  currentGenerationId: id,
  configurationVersion: 12,
  viewRevision: 7,
  bundleSha256: 'a'.repeat(64),
};
afterEach(() => vi.unstubAllGlobals());
it('posts only the public resume command and validates the configuration-bound startup result', async () => {
  const request = vi.fn<typeof fetch>(async () => Response.json(result));
  vi.stubGlobal('fetch', request);
  expect(
    await cameraSourceClient.resume!(
      'https://api.example.test',
      'token',
      'site',
      'camera',
      'edge',
      command,
      new AbortController().signal,
    ),
  ).toEqual(result);
  expect(request.mock.calls[0]?.[0]).toBe(
    'https://api.example.test/api/v1/sites/site/cameras/camera/source-hosts/edge/resume',
  );
  expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual(command);
});
it('rejects wrong revision, hash or running-source-only response without retrying', async () => {
  for (const changed of [
    { configurationVersion: 13 },
    { sourceRevision: 5 },
    { bundleSha256: 'wrong' },
    { state: 'RUNNING' },
  ]) {
    const request = vi.fn<typeof fetch>(async () => Response.json({ ...result, ...changed }));
    vi.stubGlobal('fetch', request);
    await expect(
      cameraSourceClient.resume!(
        'https://api.example.test',
        'token',
        'site',
        'camera',
        'edge',
        command,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(SourceSetupError);
    expect(request).toHaveBeenCalledTimes(1);
  }
});
