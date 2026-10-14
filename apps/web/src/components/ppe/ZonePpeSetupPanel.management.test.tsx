// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZonePpeSetupPanel } from './ZonePpeSetupPanel';

vi.mock('./ZonePpeCameraRegionPanel', () => ({
  ZonePpeCameraRegionPanel: () => <div>Region configuration</div>,
}));

const zone = {
  id: 'zone-one', siteId: 'site-one', code: 'GROUND', name: 'Ground work',
  type: 'HAZARDOUS' as const, restrictionPolicy: 'NONE' as const,
  requiredPpe: ['GLOVES'], configurationLocked: true, createdAt: '2026-10-08T00:00:00Z',
};
const props = {
  apiUrl: 'http://localhost:3000', token: 'token-one', sessionScope: 'session-one',
  credentialId: 1, siteId: 'site-one', siteName: 'Site one', onClose: vi.fn(),
};
let queryClient: QueryClient;
function mount(overrides = {}) {
  const component = (next = {}) => <QueryClientProvider client={queryClient}>
    <ZonePpeSetupPanel {...props} {...overrides} {...next} />
  </QueryClientProvider>;
  const view = render(component());
  return { ...view, changeScope: (next: Partial<typeof props>) => view.rerender(component(next)) };
}
async function editName(value: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Rename GROUND' }));
  const input = screen.getByRole('textbox', { name: 'New zone name' });
  fireEvent.change(input, { target: { value } });
  return input;
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({ items: [zone], total: 1 });
});
afterEach(() => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); });

describe('Zone configuration management without AI', () => {
  it('renames a linked zone using only the existing name API and keeps its policy', async () => {
    const rename = vi.spyOn(SmartSiteManagementClient.prototype, 'renameZone').mockResolvedValue({ ...zone, name: 'Assembly ground' });
    const policy = vi.spyOn(SmartSiteManagementClient.prototype, 'updateZonePolicy');
    const create = vi.spyOn(SmartSiteManagementClient.prototype, 'createZone');
    vi.mocked(SmartSiteManagementClient.prototype.listZones).mockResolvedValueOnce({ items: [zone], total: 1 })
      .mockResolvedValue({ items: [{ ...zone, name: 'Assembly ground' }], total: 1 });
    mount();
    const input = await editName('  Assembly ground  ');
    expect(document.activeElement).toBe(input);
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(rename).toHaveBeenCalledExactlyOnceWith('token-one', 'site-one', 'zone-one', 'Assembly ground'));
    expect(await screen.findByText(/Zone name updated/i)).toBeTruthy();
    expect(await screen.findByText('Assembly ground')).toBeTruthy();
    expect(policy).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(screen.getAllByText('Gloves').length).toBeGreaterThan(0);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Rename GROUND' })));
  });

  it('does not send a rename when cancelled and returns focus to its action', async () => {
    const rename = vi.spyOn(SmartSiteManagementClient.prototype, 'renameZone');
    mount(); await editName('Discard this');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel rename' }));
    expect(screen.queryByRole('textbox', { name: 'New zone name' })).toBeNull();
    expect(rename).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Rename GROUND' }));
  });

  it('links create validation to the invalid input and focuses it', () => {
    const create = vi.spyOn(SmartSiteManagementClient.prototype, 'createZone');
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Save Zone PPE' }));
    const input = screen.getByRole('textbox', { name: 'Zone Code' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
    const errorId = input.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId!)?.textContent).toContain('Zone Code is required');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an empty rename locally, identifies the field and retains the draft', async () => {
    const rename = vi.spyOn(SmartSiteManagementClient.prototype, 'renameZone');
    mount(); const input = await editName('   ');
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(rename).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('alert').textContent).toMatch(/name.*required/i);
  });

  it.each(['Name\u0085with control', 'Name\uD800with surrogate'])('rejects invalid Unicode names without sending them: %j', async (value) => {
    const rename = vi.spyOn(SmartSiteManagementClient.prototype, 'renameZone');
    mount(); const input = await editName(value);
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(rename).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
  });

  it('allows a valid Unicode name and supports submitting from the rename form', async () => {
    const rename = vi.spyOn(SmartSiteManagementClient.prototype, 'renameZone').mockResolvedValue({ ...zone, name: 'Khu vực 🏗️' });
    mount(); const input = await editName('Khu vực 🏗️');
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(rename).toHaveBeenCalledExactlyOnceWith('token-one', 'site-one', 'zone-one', 'Khu vực 🏗️'));
    expect(await screen.findByText(/Zone name updated/i)).toBeTruthy();
  });

  it('Escape cancels only the local rename editor without closing the parent dialog', async () => {
    const close = vi.fn();
    mount({ onClose: close }); const input = await editName('Draft');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'New zone name' })).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Rename GROUND' }));
  });

  it('keeps a failed rename editable with safe error text and allows a real retry', async () => {
    const rename = vi.spyOn(SmartSiteManagementClient.prototype, 'renameZone')
      .mockRejectedValueOnce(new ApiError('http', 'SECRET_DATABASE_TRACE', 500))
      .mockResolvedValueOnce({ ...zone, name: 'New ground' });
    mount(); await editName('New ground');
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect((await screen.findByRole('alert')).textContent).not.toContain('SECRET_DATABASE_TRACE');
    expect(screen.queryByText(/Zone name updated/i)).toBeNull();
    expect((screen.getByRole('textbox', { name: 'New zone name' }) as HTMLInputElement).value).toBe('New ground');
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByText(/Zone name updated/i)).toBeTruthy();
    expect(rename).toHaveBeenCalledTimes(2);
  });

  it.each([{ ...zone, id: 'wrong-zone' }, { ...zone, siteId: 'wrong-site' }])('rejects a rename response for another scope: %j', async (response) => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'renameZone').mockResolvedValue(response);
    mount(); await editName('New ground');
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/unexpected.*(zone|scope)/i);
    expect(screen.queryByText(/Zone name updated/i)).toBeNull();
    expect(screen.getByRole('textbox', { name: 'New zone name' })).toBeTruthy();
  });

  it('suppresses duplicate saves while a rename is pending', async () => {
    let resolve!: (value: typeof zone) => void;
    const rename = vi.spyOn(SmartSiteManagementClient.prototype, 'renameZone').mockReturnValue(new Promise((done) => { resolve = done; }));
    mount(); await editName('New ground');
    const button = screen.getByRole('button', { name: 'Save name' });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(rename).toHaveBeenCalledTimes(1));
    expect((screen.getByRole('button', { name: /Saving name/i }) as HTMLButtonElement).disabled).toBe(true);
    resolve({ ...zone, name: 'New ground' });
    expect(await screen.findByText(/Zone name updated/i)).toBeTruthy();
  });

  it('clears a rename draft and rejects late feedback after credential rotation', async () => {
    let resolve!: (value: typeof zone) => void;
    vi.spyOn(SmartSiteManagementClient.prototype, 'renameZone').mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = mount(); await editName('Old credential draft');
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    view.changeScope({ token: 'token-two', credentialId: 2 });
    expect(screen.queryByRole('textbox', { name: 'New zone name' })).toBeNull();
    resolve({ ...zone, name: 'Old credential draft' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename GROUND' })).toBeTruthy());
    expect(screen.queryByText(/Zone name updated/i)).toBeNull();
    expect(screen.queryByText('Old credential draft')).toBeNull();
  });

  it('clears create and rename drafts immediately when the selected site changes', async () => {
    const view = mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Zone Code' }), { target: { value: 'OLD-SITE' } });
    await editName('Old site name');
    vi.mocked(SmartSiteManagementClient.prototype.listZones).mockResolvedValue({ items: [{ ...zone, id: 'other-zone', siteId: 'site-two', code: 'OTHER' }], total: 1 });
    view.changeScope({ siteId: 'site-two', siteName: 'Site two' });
    expect((screen.getByRole('textbox', { name: 'Zone Code' }) as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('textbox', { name: 'New zone name' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename GROUND' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Rename OTHER' })).toBeTruthy();
  });

  it('removes stale zone actions and region configuration when a refetch is denied', async () => {
    mount();
    await screen.findByRole('button', { name: 'Rename GROUND' });
    expect(screen.getByText('Region configuration')).toBeTruthy();
    vi.mocked(SmartSiteManagementClient.prototype.listZones).mockRejectedValue(new ApiError('http', 'SECRET_AUTH_TRACE', 403));
    await queryClient.invalidateQueries({ queryKey: ['ppe-monitoring', props.apiUrl, props.sessionScope, props.credentialId, props.siteId, 'zones'] });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Rename GROUND' })).toBeNull());
    expect(screen.queryByText('Region configuration')).toBeNull();
    expect(screen.queryByText('SECRET_AUTH_TRACE')).toBeNull();
  });

  it('does not invalidate another session cache after an unmounted rename resolves', async () => {
    let resolve!: (value: typeof zone) => void;
    vi.spyOn(SmartSiteManagementClient.prototype, 'renameZone').mockReturnValue(new Promise((done) => { resolve = done; }));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const view = mount(); await editName('Late update');
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    view.unmount(); resolve({ ...zone, name: 'Late update' });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('retries a failed zone list without reloading or calling a mutation', async () => {
    const list = vi.mocked(SmartSiteManagementClient.prototype.listZones)
      .mockRejectedValueOnce(new ApiError('network', 'SECRET_NETWORK_TRACE'));
    const rename = vi.spyOn(SmartSiteManagementClient.prototype, 'renameZone');
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Retry loading zones' }));
    expect(await screen.findByRole('button', { name: 'Rename GROUND' })).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
    expect(rename).not.toHaveBeenCalled();
    expect(screen.queryByText('SECRET_NETWORK_TRACE')).toBeNull();
  });
});
