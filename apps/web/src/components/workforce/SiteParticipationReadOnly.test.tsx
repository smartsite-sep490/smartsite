// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { SiteOperationsSetupView } from './components/SiteOperationsSetupView';
import { gateFixture, mockGateCatalog } from '../access/test-gate-catalog';

vi.mock('../../features/auth/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/auth/auth-session')>()),
  useAuth: () => ({ accessToken: 'manager-token' }),
  useCurrentUser: () => ({
    data: { id: 'manager', roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'site' }] },
  }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('creates a GATE camera without a source address', async () => {
  mockGateCatalog();
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [{ id: 'site', code: 'SITE', name: 'Site', createdAt: '2026-01-01T00:00:00Z' }],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'accessSetup').mockResolvedValue({
    canReviewAssignments: true,
    canGrantContractorZones: true,
    canGrantWorkerZones: false,
    participations: [],
    zones: [],
    workers: [],
    assignments: [],
    contractorPermissions: [],
    workerPermissions: [],
  });
  const create = vi
    .spyOn(SmartSiteManagementClient.prototype, 'createCamera')
    .mockResolvedValue({} as never);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cache}>
      <SiteOperationsSetupView apiUrl="https://api.example.test" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Create camera' })[0]!);
  fireEvent.change(screen.getByLabelText('Camera purpose'), { target: { value: 'GATE' } });
  const gate = gateFixture('site')[0]!;
  await screen.findByRole('option', { name: gate.name });
  fireEvent.change(screen.getByRole('combobox', { name: 'Site gates' }), {
    target: { value: gate.id },
  });
  fireEvent.change(screen.getByLabelText('Camera code'), { target: { value: 'FACE' } });
  fireEvent.change(screen.getByLabelText('Camera name'), { target: { value: 'Gate webcam' } });
  expect(screen.queryByLabelText('Camera RTSP/source ID')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Create camera' }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith('manager-token', 'site', {
      type: 'GATE',
      gateId: gate.id,
      code: 'FACE',
      name: 'Gate webcam',
    }),
  );
  cache.clear();
});
it('shows existing participation without a separate Add participation action or contractor lookup', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [{ id: 'site', code: 'SITE', name: 'Site', createdAt: '2026-01-01T00:00:00Z' }],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({
    items: [],
    total: 0,
  });
  const lookup = vi
    .spyOn(SmartSiteManagementClient.prototype, 'contractorParticipationOptions')
    .mockResolvedValue({ items: [] });
  vi.spyOn(SmartSiteManagementClient.prototype, 'accessSetup').mockResolvedValue({
    canReviewAssignments: true,
    canGrantContractorZones: true,
    canGrantWorkerZones: false,
    participations: [
      {
        id: 'participation',
        contractorId: 'contractor',
        name: 'Existing contractor',
        validFrom: '2026-01-01T00:00:00Z',
        validUntil: null,
      },
    ],
    zones: [],
    workers: [],
    assignments: [],
    contractorPermissions: [],
    workerPermissions: [],
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cache}>
      <SiteOperationsSetupView apiUrl="https://api.example.test" participationOnly />
    </QueryClientProvider>,
  );
  await screen.findByText('Existing contractor');
  expect(screen.queryByRole('button', { name: /Add participation/i })).toBeNull();
  expect(lookup).not.toHaveBeenCalled();
  cache.clear();
});
