// @vitest-environment jsdom
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, it, expect, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { WorkerEnrollmentView } from './WorkerEnrollmentView';

vi.mock('./gateCameraSession', () => ({
  GateCameraSession: class {
    async start() {}
    stop() {}
  },
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('requires personal confirmation before capture and allows an existing Worker without an account', async () => {
  const user = userEvent.setup();
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listWorkers').mockResolvedValue({
    items: [
      {
        id: 'worker-1',
        siteId: 'site-1',
        contractorId: 'contractor-1',
        userId: null,
        externalId: 'W-1',
        displayName: 'Synthetic Worker',
        isActive: true,
        createdAt: new Date().toISOString(),
      },
    ],
    total: 1,
  });
  const accounts = vi.spyOn(SmartSiteManagementClient.prototype, 'listUsers');
  vi.spyOn(SmartSiteManagementClient.prototype, 'getFaceProfile').mockResolvedValue(null as never);
  const start = vi
    .spyOn(SmartSiteManagementClient.prototype, 'startFaceEnrollment')
    .mockResolvedValue({
      id: 'session-1',
      workerId: 'worker-1',
      consentToken: 'c'.repeat(64),
      consentVersion: 'v1.0-2026',
      status: 'PENDING',
      acceptedSampleCount: 0,
      startedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
  const confirm = vi
    .spyOn(SmartSiteManagementClient.prototype, 'confirmWorkerFaceConsent')
    .mockResolvedValue({} as never);
  const quality = vi.spyOn(SmartSiteManagementClient.prototype, 'checkFaceEnrollmentQuality');
  render(
    <QueryClientProvider client={cache}>
      <WorkerEnrollmentView
        apiUrl="https://api.example.test"
        token="synthetic-token"
        siteId="site-1"
        sessionScope="rep-1"
        canManageAccounts={false}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole('option', { name: /Synthetic Worker/ });
  await user.selectOptions(
    screen.getByLabelText('Existing Worker profile (account optional)'),
    'worker-1',
  );
  const begin = screen.getByRole('button', { name: /Begin Guided Face Captures/ });
  expect((begin as HTMLButtonElement).disabled).toBe(true);
  expect(start).not.toHaveBeenCalled();
  expect(quality).not.toHaveBeenCalled();
  expect(accounts).not.toHaveBeenCalled();
  await user.click(await screen.findByLabelText(/Worker confirmation: I am Synthetic Worker/));
  await waitFor(() => expect((begin as HTMLButtonElement).disabled).toBe(false));
  await user.click(begin);
  await waitFor(() => expect(confirm).toHaveBeenCalledWith('session-1', 'c'.repeat(64)));
  expect(start).toHaveBeenCalledWith('synthetic-token', 'worker-1', 'v1.0-2026');
  expect(quality).not.toHaveBeenCalled();
  cache.clear();
});
