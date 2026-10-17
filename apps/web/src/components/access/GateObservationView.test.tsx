// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import i18n from '../../i18n';
import { GateObservationView } from './GateObservationView';

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

it('switches populated gate logs both ways without refetching or translating authored names', async () => {
  const list = vi
    .spyOn(SmartSiteManagementClient.prototype, 'listGateAccessLogs')
    .mockResolvedValue({
      items: [
        {
          id: 'qa-log',
          createdAt: '2026-10-16T08:00:00Z',
          gateId: 'gate-north-01',
          direction: 'IN',
          workerId: 'worker',
          userId: 'user',
          workerName: 'Safety overview',
          workerExternalId: 'W000001',
          contractorName: 'QA Contractor',
          username: 'qa.worker',
          method: 'FACE',
          decision: { authorization: 'ALLOWED', reasonCode: 'VALID_ASSIGNMENT' },
        },
      ],
    });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <QueryClientProvider client={cache}>
      <GateObservationView
        apiUrl="https://api.example.test"
        token="synthetic-token"
        siteId="site"
        sessionScope="qa"
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Allowed · Valid assignment')).toBeTruthy();
  const gate = screen.getByRole('combobox') as HTMLSelectElement;
  await act(async () => {
    await i18n.changeLanguage('vi');
  });
  expect(screen.getByRole('option', { name: /Cổng 1 —/ })).toBeTruthy();
  expect(screen.queryByText('ALLOWED')).toBeNull();
  expect(screen.queryByText('VALID_ASSIGNMENT')).toBeNull();
  expect(screen.getByText('Safety overview')).toBeTruthy();
  expect(screen.getByRole('combobox')).toBe(gate);
  expect(gate.value).toBe('gate-north-01');
  expect(list).toHaveBeenCalledTimes(1);
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  expect(screen.getByText('Allowed · Valid assignment')).toBeTruthy();
  expect(screen.getByRole('option', { name: /Gate 1 —/ })).toBeTruthy();
  view.unmount();
  cache.clear();
});
