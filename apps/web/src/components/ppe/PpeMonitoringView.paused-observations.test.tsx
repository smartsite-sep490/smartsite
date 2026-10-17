// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { SharedSession } from '../../types/shared-session';
import { PpeMonitoringView } from './PpeMonitoringView';

const session: SharedSession = {
  accessToken: 'synthetic-token',
  sessionScope: 'synthetic-scope',
  user: {
    id: 'synthetic-admin',
    displayName: 'Synthetic Admin',
    roleAssignments: [{ role: 'ADMIN', siteId: null }],
  },
};

function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PpeMonitoringView sharedSession={session} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [
      { id: 'site-1', code: 'S1', name: 'Synthetic Site', createdAt: '2026-10-18T00:00:00Z' },
    ],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
    items: [
      {
        id: 'camera-1',
        siteId: 'site-1',
        code: 'C1',
        name: 'Synthetic Camera',
        externalId: 'synthetic-camera',
        status: 'ACTIVE',
        configurationVersion: 1,
        createdAt: '2026-10-18T00:00:00Z',
      },
    ],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview').mockRejectedValue(
    new Error('Synthetic unavailable preview'),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('shows paused observations instead of a replay table while AI work is paused', async () => {
  mount();
  await screen.findByRole('option', { name: 'C1 · Synthetic Camera' });
  expect(screen.getByRole('heading', { name: 'AI observations paused' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'PPE Replay Observations' })).toBeNull();
  expect(SmartSiteManagementClient.prototype.getCameraPreview).not.toHaveBeenCalled();
});

it('keeps the existing replay fallback when AI is enabled but no preview is available', async () => {
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
  mount();
  await waitFor(() =>
    expect(SmartSiteManagementClient.prototype.getCameraPreview).toHaveBeenCalled(),
  );
  expect(screen.getByRole('heading', { name: 'PPE Replay Observations' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'AI observations paused' })).toBeNull();
});
