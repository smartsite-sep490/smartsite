// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { ZonePpeSetupDialog } from './ZonePpeSetupDialog';

vi.mock('./ZonePpeCameraRegionPanel', () => ({
  ZonePpeCameraRegionPanel: () => <div>Region configuration</div>,
}));
const zone = { id: 'zone-one', siteId: 'site-one', code: 'GROUND', name: 'Ground work',
  type: 'HAZARDOUS' as const, restrictionPolicy: 'NONE' as const,
  requiredPpe: ['GLOVES'], configurationLocked: false, createdAt: '2026-10-10T00:00:00Z' };
let client: QueryClient;
function Harness({ siteId = 'site-one', token = 'token-one' }) {
  const [open, setOpen] = useState(true);
  return <QueryClientProvider client={client}>
    <button onClick={() => setOpen(true)}>Configure zone</button>
    {open && <ZonePpeSetupDialog apiUrl="http://localhost:3000" token={token}
      sessionScope="session-one" credentialId={1} siteId={siteId} siteName={siteId}
      onClose={() => setOpen(false)} />}
  </QueryClientProvider>;
}
const form = () => screen.getByRole('dialog', { name: 'Zone PPE configuration' });
const confirm = () => screen.getByRole('dialog', { name: 'Discard unsaved Zone changes?' });
function changeDraft() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Zone Code' }), { target: { value: 'ASSEMBLY' } });
}
beforeEach(async () => {
  window.localStorage.clear();
  await i18n.changeLanguage('en');
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({ items: [zone], total: 1 });
});
afterEach(async () => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  window.localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('Zone form unsaved close boundary', () => {
  it.each(['close', 'backdrop', 'escape', 'cancel'])('retains a create draft on %s until explicitly discarded', (action) => {
    render(<Harness />); changeDraft();
    const parent = form();
    if (action === 'close') fireEvent.click(within(parent).getByRole('button', { name: 'Close dialog' }));
    if (action === 'backdrop') fireEvent.click(screen.getByTestId('ppe-dialog-backdrop'));
    if (action === 'escape') fireEvent.keyDown(screen.getByRole('textbox', { name: 'Zone Code' }), { key: 'Escape' });
    if (action === 'cancel') fireEvent.click(within(parent).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(confirm()).getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByRole('textbox', { name: 'Zone Code' }) as HTMLInputElement).value).toBe('ASSEMBLY');
    fireEvent.click(within(form()).getByRole('button', { name: 'Close dialog' }));
    fireEvent.click(within(confirm()).getByRole('button', { name: 'Discard changes' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Configure zone' }));
    expect((screen.getByRole('textbox', { name: 'Zone Code' }) as HTMLInputElement).value).toBe('');
  });
  it('closes a pristine form without a discard prompt', () => {
    render(<Harness />);
    fireEvent.click(within(form()).getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('protects a PPE-only draft, but changing it back restores a pristine form', () => {
    render(<Harness />);
    const gloves = screen.getByRole('checkbox', { name: /Gloves/ });
    fireEvent.click(gloves);
    fireEvent.click(within(form()).getByRole('button', { name: 'Close dialog' }));
    fireEvent.keyDown(within(confirm()).getByRole('button', { name: 'Keep editing' }), { key: 'Escape' });
    fireEvent.click(gloves);
    fireEvent.click(within(form()).getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('protects a renamed Zone draft when closing the whole form', async () => {
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename GROUND' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New zone name' }), { target: { value: 'Assembly ground' } });
    fireEvent.click(within(form()).getByRole('button', { name: 'Close dialog' }));
    fireEvent.click(within(confirm()).getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByRole('textbox', { name: 'New zone name' }) as HTMLInputElement).value).toBe('Assembly ground');
  });
  it('does not treat opening an unchanged rename as an unsaved edit', async () => {
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename GROUND' }));
    fireEvent.click(within(form()).getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('keeps a rejected create editable and protected from accidental close', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'createZone').mockRejectedValue(new ApiError('http', 'PRIVATE_TRACE', 409));
    render(<Harness />); changeDraft();
    fireEvent.change(screen.getByRole('textbox', { name: 'Zone Name' }), { target: { value: 'Assembly ground' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Zone PPE' }));
    await screen.findByText(/already exists/);
    fireEvent.click(within(form()).getByRole('button', { name: 'Close dialog' }));
    fireEvent.click(within(confirm()).getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByRole('textbox', { name: 'Zone Code' }) as HTMLInputElement).value).toBe('ASSEMBLY');
    expect(screen.queryByText(/PRIVATE_TRACE/)).toBeNull();
  });
  it.each([{ siteId: 'site-two' }, { token: 'token-two' }])('clears the prompt and draft when authorization scope changes: %j', (next) => {
    const view = render(<Harness />); changeDraft();
    fireEvent.click(within(form()).getByRole('button', { name: 'Close dialog' }));
    expect(confirm()).toBeTruthy();
    view.rerender(<Harness {...next} />);
    expect(screen.queryByRole('dialog', { name: 'Discard unsaved Zone changes?' })).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Zone Code' }) as HTMLInputElement).value).toBe('');
  });
  it('blocks closing while saving and treats the accepted PPE selection as saved', async () => {
    let resolve!: (value: typeof zone) => void;
    vi.spyOn(SmartSiteManagementClient.prototype, 'createZone').mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<Harness />); changeDraft();
    fireEvent.change(screen.getByRole('textbox', { name: 'Zone Name' }), { target: { value: 'Assembly ground' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Gloves/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Zone PPE' }));
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(form()).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Discard unsaved Zone changes?' })).toBeNull();
    expect((within(form()).getByRole('button', { name: 'Close dialog' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('ppe-dialog-backdrop'));
    expect(form()).toBeTruthy();
    resolve({ ...zone, code: 'ASSEMBLY', name: 'Assembly ground' });
    await screen.findByText(/created successfully/);
    fireEvent.click(within(form()).getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('does not let an old save response clear a new Site draft', async () => {
    let resolve!: (value: typeof zone) => void;
    vi.spyOn(SmartSiteManagementClient.prototype, 'createZone').mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = render(<Harness />); changeDraft();
    fireEvent.change(screen.getByRole('textbox', { name: 'Zone Name' }), { target: { value: 'Assembly ground' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Zone PPE' }));
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    view.rerender(<Harness siteId="site-two" />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Zone Code' }), { target: { value: 'NEW-SITE-DRAFT' } });
    resolve(zone);
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect((screen.getByRole('textbox', { name: 'Zone Code' }) as HTMLInputElement).value).toBe('NEW-SITE-DRAFT');
    expect(screen.queryByText(/created successfully/)).toBeNull();
    fireEvent.click(within(form()).getByRole('button', { name: 'Close dialog' }));
    expect(confirm()).toBeTruthy();
  });
  it('releases both dialogs and isolation when the authenticated view unmounts', () => {
    const view = render(<Harness />); changeDraft();
    fireEvent.click(within(form()).getByRole('button', { name: 'Close dialog' }));
    expect(confirm()).toBeTruthy();
    view.unmount();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
  it('localizes dialog header, close buttons, and nested discard confirmation across EN -> VI -> EN while preserving dirty draft state', async () => {
    render(<Harness />);
    changeDraft();
    expect(screen.getByText('Define requirements and camera regions for site-one.')).toBeTruthy();
    const outerForm = form();

    fireEvent.click(within(form()).getByRole('button', { name: 'Close dialog' }));
    expect(confirm()).toBeTruthy();
    expect(screen.getByText('Your unsaved Zone fields and name changes will be lost.')).toBeTruthy();

    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    // The parent stays mounted, but the top confirmation makes it inaccessible.
    const viForm = outerForm;
    const viConfirm = screen.getByRole('dialog', { name: 'Hủy các thay đổi Khu vực chưa lưu?' });
    expect(viForm).toBeTruthy();
    expect(within(viForm).getByText('Cấu hình PPE Khu vực')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Cấu hình PPE Khu vực' })).toBeNull();
    expect(viForm.closest('[data-testid="ppe-dialog-backdrop"]')?.parentElement?.hasAttribute('inert')).toBe(true);
    expect(viConfirm).toBeTruthy();
    expect(screen.getByText('Thiết lập yêu cầu bảo hộ và vùng quan sát camera cho site-one.')).toBeTruthy();
    expect(screen.getByText('Các thông tin trường Khu vực và thay đổi tên chưa lưu sẽ bị mất.')).toBeTruthy();
    expect(within(viForm).getByRole('button', { name: 'Đóng hộp thoại', hidden: true })).toBeTruthy();
    expect(within(viConfirm).getByRole('button', { name: 'Đóng hộp thoại' })).toBeTruthy();
    expect(within(viConfirm).getByRole('button', { name: 'Tiếp tục chỉnh sửa' })).toBeTruthy();
    expect(within(viConfirm).getByRole('button', { name: 'Hủy thay đổi' })).toBeTruthy();
    expect((within(viForm).getByRole('textbox', { name: 'Mã khu vực', hidden: true }) as HTMLInputElement).value).toBe('ASSEMBLY');

    await act(async () => {
      await i18n.changeLanguage('en');
    });

    expect(within(outerForm).getByText('Zone PPE configuration')).toBeTruthy();
    expect(confirm()).toBeTruthy();
    expect(screen.getByText('Define requirements and camera regions for site-one.')).toBeTruthy();
    expect(screen.getByText('Your unsaved Zone fields and name changes will be lost.')).toBeTruthy();
    expect(within(outerForm).getByRole('button', { name: 'Close dialog', hidden: true })).toBeTruthy();
    expect(within(confirm()).getByRole('button', { name: 'Close dialog' })).toBeTruthy();
    expect(within(confirm()).getByRole('button', { name: 'Keep editing' })).toBeTruthy();
    expect(within(confirm()).getByRole('button', { name: 'Discard changes' })).toBeTruthy();
    expect((within(outerForm).getByRole('textbox', { name: 'Zone Code', hidden: true }) as HTMLInputElement).value).toBe('ASSEMBLY');

    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Hủy các thay đổi Khu vực chưa lưu?' }))
        .getByRole('button', { name: 'Tiếp tục chỉnh sửa' }),
    );
    expect(screen.queryByRole('dialog', { name: 'Hủy các thay đổi Khu vực chưa lưu?' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Cấu hình PPE Khu vực' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Mã khu vực' }) as HTMLInputElement).value).toBe('ASSEMBLY');

    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Cấu hình PPE Khu vực' }))
        .getByRole('button', { name: 'Đóng hộp thoại' }),
    );
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Hủy các thay đổi Khu vực chưa lưu?' }))
        .getByRole('button', { name: 'Hủy thay đổi' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('keeps closeDisabled and Escape/backdrop save guards active across EN -> VI -> EN while saving', async () => {
    let resolve!: (value: typeof zone) => void;
    vi.spyOn(SmartSiteManagementClient.prototype, 'createZone').mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<Harness />);
    changeDraft();
    fireEvent.change(screen.getByRole('textbox', { name: 'Zone Name' }), { target: { value: 'Assembly ground' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Gloves/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Zone PPE' }));
    await waitFor(() => expect(resolve).toBeTypeOf('function'));

    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    const viForm = screen.getByRole('dialog', { name: 'Cấu hình PPE Khu vực' });
    expect((within(viForm).getByRole('button', { name: 'Đóng hộp thoại' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('ppe-dialog-backdrop'));
    expect(screen.getByRole('dialog', { name: 'Cấu hình PPE Khu vực' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Hủy các thay đổi Khu vực chưa lưu?' })).toBeNull();

    await act(async () => {
      await i18n.changeLanguage('en');
    });

    expect((within(form()).getByRole('button', { name: 'Close dialog' }) as HTMLButtonElement).disabled).toBe(true);
    resolve({ ...zone, code: 'ASSEMBLY', name: 'Assembly ground' });
    await screen.findByText(/created successfully/);
  });
});
