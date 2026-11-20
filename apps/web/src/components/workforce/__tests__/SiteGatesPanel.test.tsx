// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { SiteGatesPanel } from '../components/SiteGatesPanel';
import { gateFixture, mockGateCatalog } from '../../access/test-gate-catalog';
let cache: QueryClient;
beforeEach(mockGateCatalog);
afterEach(() => {
  cleanup();
  cache?.clear();
  vi.restoreAllMocks();
});
function show(canManage = true) {
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cache}>
      <SiteGatesPanel
        client={new SmartSiteManagementClient('https://synthetic.test')}
        apiUrl="https://synthetic.test"
        token="synthetic-token"
        siteId="site-1"
        sessionScope="manager"
        canManage={canManage}
      />
    </QueryClientProvider>,
  );
}
it('lets a scoped manager create a Gate and change status without editing its code', async () => {
  const gate = gateFixture('site-1')[0]!;
  const create = vi
    .spyOn(SmartSiteManagementClient.prototype, 'createSiteGate')
    .mockResolvedValue(gate);
  const update = vi
    .spyOn(SmartSiteManagementClient.prototype, 'updateSiteGate')
    .mockResolvedValue({ ...gate, status: 'INACTIVE' });
  show();
  await screen.findByText(gate.name);
  expect(screen.queryByLabelText('Gate code')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Create gate' }));
  fireEvent.change(screen.getByLabelText('Gate name'), { target: { value: 'New gate' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create gate' }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith('synthetic-token', 'site-1', {
      name: 'New gate',
    }),
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0]!);
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith('synthetic-token', 'site-1', gate.id, {
      status: 'INACTIVE',
    }),
  );
});
it('shows authored Gate names to observers and hides all configuration actions', async () => {
  show(false);
  expect(await screen.findByText(gateFixture('site-1')[0]!.name)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Create gate' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull();
});
it('shows empty catalogs without inventing a Gate', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'listAllSiteGates').mockResolvedValue({
    items: [],
    total: 0,
  });
  show();
  expect(await screen.findByText(/Create your first gate/)).toBeTruthy();
  expect(screen.queryByText(/Synthetic entrance/)).toBeNull();
});

it('preserves the name when creation fails and lets the manager retry', async () => {
  const create = vi
    .spyOn(SmartSiteManagementClient.prototype, 'createSiteGate')
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce({ ...gateFixture('site-1')[0]!, name: 'Main entrance' });
  show();
  await screen.findByText(gateFixture('site-1')[0]!.name);
  fireEvent.click(screen.getByRole('button', { name: 'Create gate' }));
  fireEvent.change(screen.getByLabelText('Gate name'), { target: { value: 'Main entrance' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create gate' }));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('Gate name') as HTMLInputElement).value).toBe('Main entrance');
  fireEvent.click(screen.getByRole('button', { name: 'Create gate' }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect((screen.getByLabelText('Gate name') as HTMLInputElement).value).toBe(''),
  );
  expect(await screen.findByText(/Created gate.*Main entrance/)).toBeTruthy();
});

it('does not submit a whitespace-only name', async () => {
  const create = vi.spyOn(SmartSiteManagementClient.prototype, 'createSiteGate');
  show();
  await screen.findByText(gateFixture('site-1')[0]!.name);
  fireEvent.click(screen.getByRole('button', { name: 'Create gate' }));
  fireEvent.change(screen.getByLabelText('Gate name'), { target: { value: '   ' } });
  expect((screen.getByRole('button', { name: 'Create gate' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(create).not.toHaveBeenCalled();
});

it('renames a gate without changing its code and lets the manager cancel another edit', async () => {
  const gate = gateFixture('site-1')[0]!;
  const update = vi
    .spyOn(SmartSiteManagementClient.prototype, 'updateSiteGate')
    .mockResolvedValue({ ...gate, name: 'East entrance' });
  show();
  await screen.findByText(gate.name);
  fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0]!);
  fireEvent.change(screen.getByLabelText('New gate name'), { target: { value: 'East entrance' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith('synthetic-token', 'site-1', gate.id, {
      name: 'East entrance',
    }),
  );
  await waitFor(() => expect(screen.queryByLabelText('New gate name')).toBeNull());
  expect(screen.getByText(gate.code)).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0]!);
  fireEvent.change(screen.getByLabelText('New gate name'), { target: { value: 'Unsaved name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByLabelText('New gate name')).toBeNull();
  expect(update).toHaveBeenCalledTimes(1);
});
