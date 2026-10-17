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

const zone = {
  id: 'zone-one',
  siteId: 'site-one',
  code: 'GROUND',
  name: 'Ground work',
  type: 'HAZARDOUS' as const,
  restrictionPolicy: 'NONE' as const,
  requiredPpe: ['GLOVES'],
  configurationLocked: false,
  createdAt: '2026-10-10T00:00:00Z',
};

let client: QueryClient;

function Harness({ siteId = 'site-one', token = 'token-one' }) {
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={client}>
      <button type="button" onClick={() => setOpen(true)}>
        Configure zone
      </button>
      {open && (
        <ZonePpeSetupDialog
          canManageZones
          canManageRegions
          apiUrl="http://localhost:3000"
          token={token}
          sessionScope="session-one"
          credentialId={1}
          siteId={siteId}
          siteName={siteId}
          onClose={() => setOpen(false)}
        />
      )}
    </QueryClientProvider>
  );
}

const form = () => screen.getByRole('dialog', { name: 'Zone PPE configuration' });
const confirm = () => screen.getByRole('dialog', { name: 'Discard unsaved Zone changes?' });

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network in DOM test')));
  window.localStorage.clear();
  await i18n.changeLanguage('en');
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
    items: [zone],
    total: 1,
  });
});

afterEach(async () => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('Zone create form local clear action', () => {
  it('resets dirty create fields and PPE to the saved baseline, keeps the dialog/Zone/Region open, focuses Zone Code, and does not call createZone', async () => {
    const createSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createZone');
    render(<Harness />);
    await screen.findByText('Ground work');

    const codeInput = screen.getByRole('textbox', { name: 'Zone Code' }) as HTMLInputElement;
    const nameInput = screen.getByRole('textbox', { name: 'Zone Name' }) as HTMLInputElement;
    const hardHat = screen.getByRole('checkbox', { name: /Hard Hat/ }) as HTMLInputElement;
    const safetyVest = screen.getByRole('checkbox', { name: /Safety Vest/ }) as HTMLInputElement;
    const gloves = screen.getByRole('checkbox', { name: /Gloves/ }) as HTMLInputElement;

    fireEvent.change(codeInput, { target: { value: 'ASSEMBLY' } });
    fireEvent.change(nameInput, { target: { value: 'Assembly ground' } });
    fireEvent.click(hardHat);
    fireEvent.click(gloves);
    expect(hardHat.checked).toBe(false);
    expect(gloves.checked).toBe(true);

    const clearButton = within(form()).getByRole('button', { name: 'Clear form' });
    fireEvent.click(clearButton);

    expect(codeInput.value).toBe('');
    expect(nameInput.value).toBe('');
    expect(hardHat.checked).toBe(true);
    expect(safetyVest.checked).toBe(true);
    expect(gloves.checked).toBe(false);
    expect(document.activeElement).toBe(codeInput);
    expect(form()).toBeTruthy();
    expect(screen.getByText('Ground work')).toBeTruthy();
    expect(screen.getByText('Region configuration')).toBeTruthy();
    expect(createSpy).not.toHaveBeenCalled();

    fireEvent.click(within(form()).getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('preserves an active inline rename draft when clearing the create form and still protects the rename draft on close', async () => {
    const createSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createZone');
    const renameSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'renameZone');
    render(<Harness />);

    fireEvent.click(await screen.findByRole('button', { name: 'Rename GROUND' }));
    const renameInput = screen.getByRole('textbox', { name: 'New zone name' }) as HTMLInputElement;
    fireEvent.change(renameInput, { target: { value: 'Renamed ground work' } });

    const codeInput = screen.getByRole('textbox', { name: 'Zone Code' }) as HTMLInputElement;
    const nameInput = screen.getByRole('textbox', { name: 'Zone Name' }) as HTMLInputElement;
    const gloves = screen.getByRole('checkbox', { name: /Gloves/ }) as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: 'ASSEMBLY' } });
    fireEvent.change(nameInput, { target: { value: 'Temporary create draft' } });
    fireEvent.click(gloves);

    fireEvent.click(within(form()).getByRole('button', { name: 'Clear form' }));

    expect(codeInput.value).toBe('');
    expect(nameInput.value).toBe('');
    expect(gloves.checked).toBe(false);
    expect(document.activeElement).toBe(codeInput);
    expect(renameInput.value).toBe('Renamed ground work');
    expect(createSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();

    fireEvent.click(within(form()).getByRole('button', { name: 'Close dialog' }));
    expect(confirm()).toBeTruthy();
    fireEvent.click(within(confirm()).getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByRole('textbox', { name: 'New zone name' }) as HTMLInputElement).value).toBe(
      'Renamed ground work',
    );
  });

  it('disables Clear form while createZone or renameZone is pending', async () => {
    let resolveCreate!: (value: typeof zone) => void;
    let resolveRename!: (value: typeof zone) => void;
    vi.spyOn(SmartSiteManagementClient.prototype, 'createZone').mockImplementation(
      () =>
        new Promise((done) => {
          resolveCreate = done;
        }),
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'renameZone').mockImplementation(
      () =>
        new Promise((done) => {
          resolveRename = done;
        }),
    );

    render(<Harness />);
    await screen.findByText('Ground work');

    const codeInput = screen.getByRole('textbox', { name: 'Zone Code' }) as HTMLInputElement;
    const nameInput = screen.getByRole('textbox', { name: 'Zone Name' }) as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: 'ASSEMBLY' } });
    fireEvent.change(nameInput, { target: { value: 'Assembly ground' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Zone PPE' }));
    await waitFor(() => expect(resolveCreate).toBeTypeOf('function'));

    const clearDuringCreate = within(form()).getByRole('button', {
      name: 'Clear form',
    }) as HTMLButtonElement;
    expect(clearDuringCreate.disabled).toBe(true);
    fireEvent.click(clearDuringCreate);
    expect(codeInput.value).toBe('ASSEMBLY');

    resolveCreate({ ...zone, id: 'zone-two', code: 'ASSEMBLY', name: 'Assembly ground' });
    await screen.findByText(/created successfully/);

    fireEvent.change(codeInput, { target: { value: 'NEXT_DRAFT' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Rename GROUND' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New zone name' }), {
      target: { value: 'Ground work updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(resolveRename).toBeTypeOf('function'));

    const clearDuringRename = within(form()).getByRole('button', {
      name: 'Clear form',
    }) as HTMLButtonElement;
    expect(clearDuringRename.disabled).toBe(true);
    fireEvent.click(clearDuringRename);
    expect(codeInput.value).toBe('NEXT_DRAFT');

    resolveRename({ ...zone, name: 'Ground work updated' });
    await waitFor(() => expect(client.isMutating()).toBe(0));
  });

  it('clears validation and rejected create server errors and restores focus to Zone Code', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'createZone').mockRejectedValue(
      new ApiError('http', 'PRIVATE_TRACE', 409),
    );
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Save Zone PPE' }));
    expect(await screen.findByText(/Zone Code is required/i)).toBeTruthy();

    const codeInput = screen.getByRole('textbox', { name: 'Zone Code' }) as HTMLInputElement;
    const nameInput = screen.getByRole('textbox', { name: 'Zone Name' }) as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: 'ASSEMBLY' } });
    fireEvent.change(nameInput, { target: { value: 'Assembly ground' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Zone PPE' }));
    await screen.findByText(/already exists/);

    fireEvent.click(within(form()).getByRole('button', { name: 'Clear form' }));

    expect(codeInput.value).toBe('');
    expect(nameInput.value).toBe('');
    expect(screen.queryByText(/already exists/)).toBeNull();
    expect(screen.queryByText(/Zone Code is required/i)).toBeNull();
    expect(document.activeElement).toBe(codeInput);

    fireEvent.click(within(form()).getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('localizes Clear form as Xóa nháp across EN and VI without spontaneous draft loss', async () => {
    render(<Harness />);
    const codeInput = screen.getByRole('textbox', { name: 'Zone Code' }) as HTMLInputElement;
    const nameInput = screen.getByRole('textbox', { name: 'Zone Name' }) as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: 'ASSEMBLY' } });
    fireEvent.change(nameInput, { target: { value: 'Assembly ground' } });

    expect(within(form()).getByRole('button', { name: 'Clear form' })).toBeTruthy();

    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    const viForm = screen.getByRole('dialog', { name: 'Cấu hình PPE Khu vực' });
    const viCodeInput = within(viForm).getByRole('textbox', {
      name: 'Mã khu vực',
    }) as HTMLInputElement;
    const viNameInput = within(viForm).getByRole('textbox', {
      name: 'Tên khu vực',
    }) as HTMLInputElement;
    expect(viCodeInput.value).toBe('ASSEMBLY');
    expect(viNameInput.value).toBe('Assembly ground');

    const viClearButton = within(viForm).getByRole('button', { name: 'Xóa nháp' });
    fireEvent.click(viClearButton);

    expect(viCodeInput.value).toBe('');
    expect(viNameInput.value).toBe('');
    expect(document.activeElement).toBe(viCodeInput);
  });
});
