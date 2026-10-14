// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient, type ZoneResponse } from '@smartsite/api-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZonePpeSetupPanel } from './ZonePpeSetupPanel';

vi.mock('./ZonePpeCameraRegionPanel', () => ({
  ZonePpeCameraRegionPanel: ({ zones }: { zones: ZoneResponse[] }) =>
    <select aria-label="Region zone options">{zones.map(zone => <option key={zone.id} value={zone.id}>{zone.code}</option>)}</select>,
}));

const makeZone = (index: number, siteId = 'site-one'): ZoneResponse => ({
  id: `${siteId}-zone-${index}`, siteId, code: `Z-${index.toString().padStart(2, '0')}`,
  name: `Work area ${index}`, type: 'HAZARDOUS', restrictionPolicy: 'NONE',
  requiredPpe: ['HARD_HAT'], configurationLocked: true, createdAt: '2026-10-08T00:00:00Z',
});
const firstPage = Array.from({ length: 20 }, (_, index) => makeZone(index + 1));
const props = { apiUrl: 'http://localhost:3000', token: 'token-one', credentialId: 1, sessionScope: 'session-one', siteId: 'site-one', siteName: 'Site one', onClose: vi.fn() };
let queryClient: QueryClient;
function mount() {
  const element = (next = {}) => <QueryClientProvider client={queryClient}><ZonePpeSetupPanel {...props} {...next} /></QueryClientProvider>;
  const view = render(element());
  return { ...view, changeScope: (next: Partial<typeof props>) => view.rerender(element(next)) };
}
beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); });

describe('explicit scoped Zone pagination', () => {
  it('loads later pages only on request and makes all loaded zones available for region selection', async () => {
    const list = vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockImplementation(async (_token, _site, options) => {
      const offset = options?.offset ?? 0;
      return { items: Array.from({ length: Math.min(20, 41 - offset) }, (_, index) => makeZone(offset + index + 1)), total: 41 };
    });
    mount();
    const more = await screen.findByRole('button', { name: 'Load more zones' });
    expect(list).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Rename Z-21' })).toBeNull();
    fireEvent.click(more);
    expect(await screen.findByRole('button', { name: 'Rename Z-21' })).toBeTruthy();
    expect(list).toHaveBeenLastCalledWith('token-one', 'site-one', { offset: 20, limit: 20 }, { signal: expect.any(AbortSignal) });
    expect((screen.getByRole('combobox', { name: 'Region zone options' }) as HTMLSelectElement).options.length).toBe(40);
    fireEvent.click(screen.getByRole('button', { name: 'Load more zones' }));
    expect(await screen.findByRole('button', { name: 'Rename Z-41' })).toBeTruthy();
    expect(list).toHaveBeenLastCalledWith('token-one', 'site-one', { offset: 40, limit: 20 }, { signal: expect.any(AbortSignal) });
    expect(screen.queryByRole('button', { name: 'Load more zones' })).toBeNull();
    expect((screen.getByRole('combobox', { name: 'Region zone options' }) as HTMLSelectElement).options.length).toBe(41);
  });

  it('retains a rename draft and selected region zone while appending another page', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValueOnce({ items: firstPage, total: 21 })
      .mockResolvedValueOnce({ items: [makeZone(21)], total: 21 });
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Rename Z-01' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New zone name' }), { target: { value: 'Unsaved name' } });
    const selector = screen.getByRole('combobox', { name: 'Region zone options' }) as HTMLSelectElement;
    fireEvent.change(selector, { target: { value: makeZone(12).id } });
    fireEvent.click(screen.getByRole('button', { name: 'Load more zones' }));
    await screen.findByRole('button', { name: 'Rename Z-21' });
    expect((screen.getByRole('textbox', { name: 'New zone name' }) as HTMLInputElement).value).toBe('Unsaved name');
    expect(selector.value).toBe(makeZone(12).id);
  });

  it('keeps already loaded metadata and the draft on a transient next-page failure and retries that page', async () => {
    const list = vi.spyOn(SmartSiteManagementClient.prototype, 'listZones')
      .mockResolvedValueOnce({ items: firstPage, total: 21 })
      .mockRejectedValueOnce(new ApiError('http', 'SECRET_TRACE', 503))
      .mockResolvedValueOnce({ items: [makeZone(21)], total: 21 });
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Rename Z-01' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New zone name' }), { target: { value: 'Keep my draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load more zones' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry loading more zones' }));
    expect(await screen.findByRole('button', { name: 'Rename Z-21' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'New zone name' }) as HTMLInputElement).value).toBe('Keep my draft');
    expect(list.mock.calls.map(call => call[2]?.offset)).toEqual([0, 20, 20]);
    expect(screen.queryByText('SECRET_TRACE')).toBeNull();
  });

  it.each([401, 403, 404])('revokes loaded zone actions and region metadata on a next-page %i response', async (status) => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValueOnce({ items: firstPage, total: 21 })
      .mockRejectedValueOnce(new ApiError('http', 'SECRET_SCOPE_TRACE', status));
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Load more zones' }));
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Rename Z-01' })).toBeNull());
    expect(screen.queryByRole('combobox', { name: 'Region zone options' })).toBeNull();
    expect(screen.queryByText('SECRET_SCOPE_TRACE')).toBeNull();
  });

  it('does not append an old pending page after a Site/credential change', async () => {
    let resolve!: (page: { items: ZoneResponse[]; total: number }) => void;
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockImplementation(async (_token, site, options) => {
      if (site === 'site-two') return { items: [makeZone(99, site)], total: 1 };
      if (options?.offset) return new Promise(done => { resolve = done; });
      return { items: firstPage, total: 21 };
    });
    const view = mount(); fireEvent.click(await screen.findByRole('button', { name: 'Load more zones' }));
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    view.changeScope({ siteId: 'site-two', token: 'token-two', credentialId: 2 });
    await screen.findByRole('button', { name: 'Rename Z-99' });
    resolve({ items: [makeZone(21)], total: 21 });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(screen.queryByRole('button', { name: 'Rename Z-21' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename Z-01' })).toBeNull();
  });

  it('does not issue duplicate requests while the next page is pending', async () => {
    let resolve!: (page: { items: ZoneResponse[]; total: number }) => void;
    const list = vi.spyOn(SmartSiteManagementClient.prototype, 'listZones')
      .mockRejectedValue(new Error('Unexpected extra fixture request'))
      .mockResolvedValueOnce({ items: firstPage, total: 21 })
      .mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    mount(); const more = await screen.findByRole('button', { name: 'Load more zones' });
    fireEvent.click(more); fireEvent.click(more);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect((screen.getByRole('button', { name: /Loading more zones/i }) as HTMLButtonElement).disabled).toBe(true);
    resolve({ items: [makeZone(21)], total: 21 });
    expect(await screen.findByRole('button', { name: 'Rename Z-21' })).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('reports a non-progressing page as a failure rather than claiming the remaining zones were loaded', async () => {
    const list = vi.spyOn(SmartSiteManagementClient.prototype, 'listZones')
      .mockResolvedValueOnce({ items: firstPage, total: 21 })
      .mockResolvedValueOnce({ items: [], total: 21 })
      .mockResolvedValueOnce({ items: [makeZone(21)], total: 21 });
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Load more zones' }));
    const retry = await screen.findByRole('button', { name: /Retry loading (more )?zones/i });
    expect(screen.queryByRole('button', { name: 'Rename Z-21' })).toBeNull();
    fireEvent.click(retry);
    expect(await screen.findByRole('button', { name: 'Rename Z-21' })).toBeTruthy();
    expect(list.mock.calls.at(-1)?.[2]?.offset).toBe(20);
  });

  it('deduplicates an overlapping row without duplicate actions when offset pages shift', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones')
      .mockResolvedValueOnce({ items: firstPage, total: 22 })
      .mockResolvedValueOnce({ items: [makeZone(20), makeZone(21)], total: 22 });
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Load more zones' }));
    expect(await screen.findByRole('button', { name: 'Rename Z-21' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Rename Z-20' })).toHaveLength(1);
    expect((screen.getByRole('combobox', { name: 'Region zone options' }) as HTMLSelectElement).options.length).toBe(21);
  });

  it('does not expose cached zones when the token changes even if a caller reuses its credential ID', async () => {
    let resolve!: (page: { items: ZoneResponse[]; total: number }) => void;
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockImplementation(async (token) => {
      if (token === 'token-two') return new Promise(done => { resolve = done; });
      return { items: firstPage, total: 20 };
    });
    const view = mount(); await screen.findByRole('button', { name: 'Rename Z-01' });
    view.changeScope({ token: 'token-two' });
    expect(screen.queryByRole('button', { name: 'Rename Z-01' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Region zone options' })).toBeNull();
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    resolve({ items: [makeZone(99)], total: 1 });
    expect(await screen.findByRole('button', { name: 'Rename Z-99' })).toBeTruthy();
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map(query => query.queryKey))).not.toContain('token-');
  });

  it('does not misclassify a failed first-page refresh as a next-page failure', async () => {
    const list = vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({ items: firstPage, total: 20 });
    mount(); await screen.findByRole('button', { name: 'Rename Z-01' });
    list.mockRejectedValue(new ApiError('http', 'SECRET_REFRESH_TRACE', 503));
    await queryClient.invalidateQueries({ queryKey: ['ppe-monitoring', props.apiUrl, props.sessionScope, props.credentialId, props.siteId, 'zones'] });
    expect(await screen.findByRole('button', { name: 'Retry loading zones' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry loading more zones' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename Z-01' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Region zone options' })).toBeNull();
  });

  it.each([-1, 1.5])('rejects an invalid page total %s instead of claiming an empty site', async (total) => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({ items: [], total });
    mount();
    expect(await screen.findByRole('button', { name: 'Retry loading zones' })).toBeTruthy();
    expect(screen.queryByText('No zones configured for this site yet.')).toBeNull();
  });
});
