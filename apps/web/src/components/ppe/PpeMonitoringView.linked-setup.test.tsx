// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { SharedSession } from '../../types/shared-session';
import { PpeMonitoringView } from './PpeMonitoringView';
const site = (n: number) => ({
  id: `site-${n}`,
  code: `S${n}`,
  name: `Site ${n}`,
  createdAt: '2026-10-16T00:00:00Z',
});
const camera = (n: number, siteId = 'site-1') => ({
  id: `camera-${n}`,
  siteId,
  code: `C${n}`,
  name: `Camera ${n}`,
  externalId: `camera-${n}`,
  status: 'ACTIVE' as const,
  configurationVersion: 1,
  createdAt: '2026-10-16T00:00:00Z',
});
const session: SharedSession = {
  accessToken: 'token',
  sessionScope: 'scope',
  user: { id: 'admin', displayName: 'Admin', roleAssignments: [{ role: 'ADMIN', siteId: null }] },
};
function mount(initialSelection: { siteId?: string; cameraId?: string }) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PpeMonitoringView
        sharedSession={session}
        initialSelection={initialSelection}
        onOpenSetup={vi.fn()}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [site(1)],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockImplementation(
    async (_t, s) => ({ items: [camera(1, s)], total: 1 }),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview').mockRejectedValue(
    new Error('No AI'),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it('waits for the linked later-page Site instead of opening the first Site', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listSites)
    .mockResolvedValueOnce({ items: Array.from({ length: 20 }, (_, n) => site(n + 1)), total: 21 })
    .mockResolvedValueOnce({ items: [site(21)], total: 21 });
  mount({ siteId: 'site-21' });
  const more = await screen.findByRole('button', { name: 'Load more sites' });
  expect((screen.getByRole('combobox', { name: 'Site' }) as HTMLSelectElement).value).toBe('');
  expect(SmartSiteManagementClient.prototype.listPreviewCameras).not.toHaveBeenCalled();
  fireEvent.click(more);
  await waitFor(() =>
    expect((screen.getByRole('combobox', { name: 'Site' }) as HTMLSelectElement).value).toBe(
      'site-21',
    ),
  );
  expect(
    vi
      .mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
      .mock.calls.every((c) => c[1] === 'site-21'),
  ).toBe(true);
});
it('waits for a linked later-page camera rather than silently selecting another camera', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
    .mockResolvedValueOnce({
      items: Array.from({ length: 20 }, (_, n) => camera(n + 1)),
      total: 21,
    })
    .mockResolvedValueOnce({ items: [camera(21)], total: 21 });
  mount({ siteId: 'site-1', cameraId: 'camera-21' });
  const more = await screen.findByRole('button', { name: 'Load more cameras' });
  expect((screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement).value).toBe('');
  fireEvent.click(more);
  await waitFor(() =>
    expect((screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement).value).toBe(
      'camera-21',
    ),
  );
  expect(SmartSiteManagementClient.prototype.getCameraPreview).not.toHaveBeenCalled();
});
it('does not substitute another Site for an unavailable linked Site', async () => {
  mount({ siteId: 'missing-site' });
  await screen.findByRole('option', { name: 'S1 · Site 1' });
  expect((screen.getByRole('combobox', { name: 'Site' }) as HTMLSelectElement).value).toBe('');
  expect(SmartSiteManagementClient.prototype.listPreviewCameras).not.toHaveBeenCalled();
});
