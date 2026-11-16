// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import i18n from '../../i18n';
import { CameraPpePolicyPanel, type CameraPpeContext } from './CameraPpePolicyPanel';

afterEach(cleanup);

it('replays the original initialization when the server committed but the response was lost', async () => {
  await i18n.changeLanguage('en');
  const cameraId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const setupKey = ['setup-test'];
  const cache = new QueryClient();
  const read = vi.fn<CameraPpeContext['client']['readSavedPpePolicy']>().mockResolvedValue({
    cameraId,
    regionId: null,
    configurationVersion: 4,
    savedRevision: null,
    policy: null,
  });
  const initialize = vi
    .fn<CameraPpeContext['client']['initializePpePolicy']>()
    .mockRejectedValueOnce(new ApiError('network', 'Response lost'))
    .mockImplementation(async (_token, _site, _camera, command) => ({
      cameraId,
      commandId: command.commandId,
      configurationVersion: 5,
      viewRevision: 1,
      bundleSha256: 'a'.repeat(64),
      replayed: true,
    }));
  const update = vi.fn<CameraPpeContext['client']['updateCameraPpePolicy']>();
  const client = {
    readSavedPpePolicy: read,
    listRegions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    initializePpePolicy: initialize,
    updateCameraPpePolicy: update,
    updateRegionPpePolicy: vi.fn(),
    activateRegionWithPpePolicy: vi.fn(),
  };
  render(
    <QueryClientProvider client={cache}>
      <CameraPpePolicyPanel
        context={{ client, token: 'test', siteId: 'site-test', setupKey, onUnauthorized: vi.fn() }}
        cameraId={cameraId}
        canWrite
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Camera PPE policy' }));
  fireEvent.change(await screen.findByLabelText('Policy mode'), { target: { value: 'EXPLICIT' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'GLOVES' }));
  fireEvent.click(screen.getByRole('button', { name: 'Initialize PPE policies' }));
  await screen.findByRole('alert');
  read.mockResolvedValue({
    cameraId,
    regionId: null,
    configurationVersion: 5,
    savedRevision: 5,
    policy: { mode: 'EXPLICIT', requiredPpe: ['GLOVES'] },
  });
  await cache.invalidateQueries({ queryKey: setupKey });
  fireEvent.click(await screen.findByRole('button', { name: 'Save PPE policy' }));
  await waitFor(() => expect(initialize).toHaveBeenCalledTimes(2));
  expect(initialize.mock.calls[1]).toEqual(initialize.mock.calls[0]);
  expect(update).not.toHaveBeenCalled();
  await screen.findByText('Saved revision 5. Check worker status separately.');
});
