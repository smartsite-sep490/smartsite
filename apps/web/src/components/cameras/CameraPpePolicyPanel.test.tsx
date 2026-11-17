// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import { parseRegionPpePolicy } from '@smartsite/contracts/camera-ppe-policy';
import i18n from '../../i18n';
import { CameraPpePolicyPanel, PolicyFields, type CameraPpeContext } from './CameraPpePolicyPanel';
import type { PpePolicyDraft } from './camera-ppe-policy-model';

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});

function resolveDescribedByText(element: HTMLElement): string {
  const raw = element.getAttribute('aria-describedby') ?? '';
  const ids = raw
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  for (const id of ids) {
    const node = document.getElementById(id);
    expect(node, `Expected aria-describedby target #${id} to exist in DOM`).not.toBeNull();
  }
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}

it('replays the original initialization when the server committed but the response was lost', async () => {
  await i18n.changeLanguage('en');
  const cameraId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const setupKey = ['setup-test'];
  const cache = new QueryClient();
  const read = vi.fn<CameraPpeContext['client']['readSavedPpePolicy']>().mockResolvedValue({
    cameraId,
    regionId: null,
    configurationVersion: 4,
    savedRevision: null,
    policy: null,
  });
  const initialize = vi
    .fn<CameraPpeContext['client']['initializePpePolicy']>()
    .mockRejectedValueOnce(new ApiError('network', 'Response lost'))
    .mockImplementation(async (_token, _site, _camera, command) => ({
      cameraId,
      commandId: command.commandId,
      configurationVersion: 5,
      viewRevision: 1,
      bundleSha256: 'a'.repeat(64),
      replayed: true,
    }));
  const update = vi.fn<CameraPpeContext['client']['updateCameraPpePolicy']>();
  const client = {
    readSavedPpePolicy: read,
    listRegions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    initializePpePolicy: initialize,
    updateCameraPpePolicy: update,
    updateRegionPpePolicy: vi.fn(),
    activateRegionWithPpePolicy: vi.fn(),
  };
  render(
    <QueryClientProvider client={cache}>
      <CameraPpePolicyPanel
        context={{ client, token: 'test', siteId: 'site-test', setupKey, onUnauthorized: vi.fn() }}
        cameraId={cameraId}
        canWrite
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Camera PPE policy' }));
  fireEvent.change(await screen.findByLabelText('Policy mode'), { target: { value: 'EXPLICIT' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Gloves' }));
  fireEvent.click(screen.getByRole('button', { name: 'Initialize PPE policies' }));
  await screen.findByRole('alert');
  read.mockResolvedValue({
    cameraId,
    regionId: null,
    configurationVersion: 5,
    savedRevision: 5,
    policy: { mode: 'EXPLICIT', requiredPpe: ['GLOVES'] },
  });
  await cache.invalidateQueries({ queryKey: setupKey });
  fireEvent.click(await screen.findByRole('button', { name: 'Save PPE policy' }));
  await waitFor(() => expect(initialize).toHaveBeenCalledTimes(2));
  expect(initialize.mock.calls[1]).toEqual(initialize.mock.calls[0]);
  expect(update).not.toHaveBeenCalled();
  await screen.findByText('Saved revision 5. Check worker status separately.');
});

describe('FE-2 human PPE labels, compact Core/Experimental badges, and field-linked validation', () => {
  it('renders localized human PPE labels with compact Core/Experimental badges and a single concise operational guidance note in EN and VI', async () => {
    await i18n.changeLanguage('en');
    const cameraId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const updateCameraPpePolicy = vi
      .fn<CameraPpeContext['client']['updateCameraPpePolicy']>()
      .mockImplementation(async (_token, _site, _cam, command) => ({
        cameraId,
        commandId: command.commandId,
        configurationVersion: 5,
        viewRevision: 1,
        bundleSha256: 'b'.repeat(64),
        replayed: false,
      }));
    const client: CameraPpeContext['client'] = {
      readSavedPpePolicy: vi.fn().mockResolvedValue({
        cameraId,
        regionId: null,
        configurationVersion: 4,
        savedRevision: 2,
        policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT', 'GLOVES'] },
      }),
      listRegions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      initializePpePolicy: vi.fn(),
      updateCameraPpePolicy,
      updateRegionPpePolicy: vi.fn(),
      activateRegionWithPpePolicy: vi.fn(),
    };

    render(
      <QueryClientProvider client={cache}>
        <CameraPpePolicyPanel
          context={{
            client,
            token: 'token-1',
            siteId: 'site-1',
            setupKey: ['fe2-readiness'],
            onUnauthorized: vi.fn(),
          }}
          cameraId={cameraId}
          canWrite
          expandSignal={1}
        />
      </QueryClientProvider>,
    );

    const hardHatBox = (await screen.findByRole('checkbox', {
      name: 'Hard hat',
    })) as HTMLInputElement;
    const vestBox = screen.getByRole('checkbox', { name: 'Safety vest' }) as HTMLInputElement;
    const glovesBox = screen.getByRole('checkbox', { name: 'Gloves' }) as HTMLInputElement;
    const bootsBox = screen.getByRole('checkbox', { name: 'Boots' }) as HTMLInputElement;
    const gogglesBox = screen.getByRole('checkbox', { name: 'Goggles' }) as HTMLInputElement;

    // Raw enum identifiers are never rendered in primary UI text
    const ppeGroup = screen.getByRole('group', { name: 'Required PPE items' });
    expect(ppeGroup.textContent).not.toMatch(/HARD_HAT|SAFETY_VEST/);

    // Current saved selection (including experimental Gloves) is preserved
    expect(hardHatBox.checked).toBe(true);
    expect(glovesBox.checked).toBe(true);
    expect(vestBox.checked).toBe(false);
    expect(bootsBox.checked).toBe(false);
    expect(gogglesBox.checked).toBe(false);

    // Compact badges only (2 Core, 3 Experimental) without repeated per-item disclaimer prose or internal Hold jargon
    const coreBadges = screen.getAllByText('Core');
    const experimentalBadges = screen.getAllByText('Experimental');
    expect(coreBadges).toHaveLength(2);
    expect(experimentalBadges).toHaveLength(3);
    expect(ppeGroup.textContent).not.toMatch(/Hold|readiness claim|accuracy claim/i);

    // One concise operational guidance note covering baseline vs experimental and camera confirmation
    const guidanceNote = screen.getByTestId('ppe-readiness-guidance');
    expect(guidanceNote.textContent).toMatch(/Hard hat, vest: baseline/i);
    expect(guidanceNote.textContent).toMatch(/gloves, boots, goggles: experimental/i);
    expect(guidanceNote.textContent).toMatch(/Saved changes apply once camera confirms/i);
    expect(guidanceNote.textContent).not.toMatch(/Hold|model readiness claim/i);

    // Accessible descriptions bind each checkbox to its compact badge and the concise guidance note
    expect(resolveDescribedByText(hardHatBox)).toContain('Core');
    expect(resolveDescribedByText(hardHatBox)).toContain(guidanceNote.textContent ?? '');
    expect(resolveDescribedByText(glovesBox)).toContain('Experimental');
    expect(resolveDescribedByText(glovesBox)).toContain(guidanceNote.textContent ?? '');
    resolveDescribedByText(vestBox);
    resolveDescribedByText(bootsBox);
    resolveDescribedByText(gogglesBox);

    // Vietnamese human labels, proper accented badges (Cơ bản / Thử nghiệm), and concise operational note
    await i18n.changeLanguage('vi');
    await waitFor(() => {
      const viHardHat = screen.getByRole('checkbox', { name: 'Mũ bảo hộ' });
      const viGloves = screen.getByRole('checkbox', { name: 'Găng tay' });
      expect(screen.getByRole('checkbox', { name: 'Áo phản quang' })).toBeTruthy();
      expect(screen.getByRole('checkbox', { name: 'Giày bảo hộ' })).toBeTruthy();
      expect(screen.getByRole('checkbox', { name: 'Kính bảo hộ' })).toBeTruthy();
      expect(screen.getAllByText('Cơ bản')).toHaveLength(2);
      expect(screen.getAllByText('Thử nghiệm')).toHaveLength(3);
      expect(resolveDescribedByText(viHardHat)).toContain('Cơ bản');
      expect(resolveDescribedByText(viGloves)).toContain('Thử nghiệm');
      const viGuidance = screen.getByTestId('ppe-readiness-guidance');
      expect(viGuidance.textContent).toMatch(/Mũ, áo: cơ bản/i);
      expect(viGuidance.textContent).toMatch(/găng, giày, kính: thử nghiệm/i);
      expect(viGuidance.textContent).toMatch(/Bản đã lưu chỉ áp dụng sau khi camera xác nhận/i);
      expect(viGuidance.textContent).not.toMatch(/Tạm giữ/i);
    });

    // Switch back to EN, toggle Safety vest by human label, and verify canonical enum payload is preserved
    await i18n.changeLanguage('en');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Safety vest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save PPE policy' }));
    await waitFor(() => expect(updateCameraPpePolicy).toHaveBeenCalledTimes(1));
    expect(updateCameraPpePolicy.mock.calls[0]?.[3]?.policy).toEqual({
      mode: 'EXPLICIT',
      requiredPpe: ['GLOVES', 'HARD_HAT', 'SAFETY_VEST'],
    });
  });

  it('links accessible EN/VI inline validation via aria-describedby when EXPLICIT selection is empty', async () => {
    await i18n.changeLanguage('en');
    const cameraId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const client: CameraPpeContext['client'] = {
      readSavedPpePolicy: vi.fn().mockResolvedValue({
        cameraId,
        regionId: null,
        configurationVersion: 2,
        savedRevision: 1,
        policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
      }),
      listRegions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      initializePpePolicy: vi.fn(),
      updateCameraPpePolicy: vi.fn(),
      updateRegionPpePolicy: vi.fn(),
      activateRegionWithPpePolicy: vi.fn(),
    };

    render(
      <QueryClientProvider client={cache}>
        <CameraPpePolicyPanel
          context={{
            client,
            token: 'token-1',
            siteId: 'site-1',
            setupKey: ['fe2-empty-explicit'],
            onUnauthorized: vi.fn(),
          }}
          cameraId={cameraId}
          canWrite
          expandSignal={1}
        />
      </QueryClientProvider>,
    );

    const hardHatBox = await screen.findByRole('checkbox', { name: 'Hard hat' });
    const saveButton = screen.getByRole('button', { name: 'Save PPE policy' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
    expect(screen.queryByTestId('ppe-policy-explicit-validation')).toBeNull();
    expect(hardHatBox.getAttribute('aria-invalid')).toBeNull();

    // Unchecking the last PPE item locks Save and links inline EN explanation via aria-describedby
    fireEvent.click(hardHatBox);
    expect(saveButton.disabled).toBe(true);
    const validationMsg = screen.getByTestId('ppe-policy-explicit-validation');
    expect(validationMsg.textContent).toMatch(/Select at least one PPE item/i);
    expect(hardHatBox.getAttribute('aria-invalid')).toBe('true');
    expect(resolveDescribedByText(hardHatBox)).toContain(validationMsg.textContent ?? '');

    const ppeGroup = screen.getByRole('group', { name: 'Required PPE items' });
    expect(resolveDescribedByText(ppeGroup)).toContain(validationMsg.textContent ?? '');

    // Vietnamese translation for empty EXPLICIT selection
    await i18n.changeLanguage('vi');
    await waitFor(() => {
      const viHardHatBox = screen.getByRole('checkbox', { name: 'Mũ bảo hộ' });
      const viValidation = screen.getByTestId('ppe-policy-explicit-validation');
      expect(viValidation.textContent).toMatch(/Chọn ít nhất một hạng mục PPE/i);
      expect(resolveDescribedByText(viHardHatBox)).toContain(viValidation.textContent ?? '');
    });

    // Re-selecting an item clears validation, removes aria-invalid, leaves zero dangling IDs, and unlocks Save
    await i18n.changeLanguage('en');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Safety vest' }));
    expect(screen.queryByTestId('ppe-policy-explicit-validation')).toBeNull();
    const updatedHardHatBox = screen.getByRole('checkbox', { name: 'Hard hat' });
    expect(updatedHardHatBox.getAttribute('aria-invalid')).toBeNull();
    resolveDescribedByText(updatedHardHatBox);
    expect(
      (screen.getByRole('button', { name: 'Save PPE policy' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('links accessible EN/VI inline validation via aria-describedby when DISABLED reason is blank or whitespace-only', async () => {
    await i18n.changeLanguage('en');
    const cameraId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const updateCameraPpePolicy = vi
      .fn<CameraPpeContext['client']['updateCameraPpePolicy']>()
      .mockImplementation(async (_token, _site, _cam, command) => ({
        cameraId,
        commandId: command.commandId,
        configurationVersion: 4,
        viewRevision: 1,
        bundleSha256: 'c'.repeat(64),
        replayed: false,
      }));
    const client: CameraPpeContext['client'] = {
      readSavedPpePolicy: vi.fn().mockResolvedValue({
        cameraId,
        regionId: null,
        configurationVersion: 3,
        savedRevision: 1,
        policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
      }),
      listRegions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      initializePpePolicy: vi.fn(),
      updateCameraPpePolicy,
      updateRegionPpePolicy: vi.fn(),
      activateRegionWithPpePolicy: vi.fn(),
    };

    render(
      <QueryClientProvider client={cache}>
        <CameraPpePolicyPanel
          context={{
            client,
            token: 'token-1',
            siteId: 'site-1',
            setupKey: ['fe2-blank-disabled'],
            onUnauthorized: vi.fn(),
          }}
          cameraId={cameraId}
          canWrite
          expandSignal={1}
        />
      </QueryClientProvider>,
    );

    const modeSelect = await screen.findByLabelText('Policy mode');
    fireEvent.change(modeSelect, { target: { value: 'DISABLED' } });

    const reasonInput = screen.getByLabelText('Reason') as HTMLInputElement;
    const saveButton = screen.getByRole('button', { name: 'Save PPE policy' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    expect(reasonInput.getAttribute('aria-invalid')).toBe('true');

    const emptyReasonMsg = screen.getByTestId('ppe-policy-disabled-validation');
    expect(emptyReasonMsg.textContent).toMatch(/Enter a reason for turning off PPE checks/i);
    expect(resolveDescribedByText(reasonInput)).toContain(emptyReasonMsg.textContent ?? '');

    // Whitespace-only input still keeps Save locked and retains inline explanation
    fireEvent.change(reasonInput, { target: { value: '   ' } });
    expect(saveButton.disabled).toBe(true);
    expect(reasonInput.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByTestId('ppe-policy-disabled-validation')).toBeTruthy();

    // Vietnamese translation for blank DISABLED reason
    await i18n.changeLanguage('vi');
    await waitFor(() => {
      const viReasonInput = screen.getByLabelText('Lý do');
      const viReasonMsg = screen.getByTestId('ppe-policy-disabled-validation');
      expect(viReasonMsg.textContent).toMatch(/Nhập lý do tắt kiểm tra PPE/i);
      expect(resolveDescribedByText(viReasonInput)).toContain(viReasonMsg.textContent ?? '');
    });

    // Valid reason clears validation and submits exact trimmed v2 payload without extra keys
    await i18n.changeLanguage('en');
    const enReasonInput = await screen.findByLabelText('Reason');
    fireEvent.change(enReasonInput, { target: { value: '  Scheduled crane maintenance  ' } });
    expect(screen.queryByTestId('ppe-policy-disabled-validation')).toBeNull();
    expect(enReasonInput.getAttribute('aria-invalid')).toBeNull();
    expect(enReasonInput.getAttribute('aria-describedby')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save PPE policy' }));
    await waitFor(() => expect(updateCameraPpePolicy).toHaveBeenCalledTimes(1));
    expect(updateCameraPpePolicy.mock.calls[0]?.[3]?.policy).toEqual({
      mode: 'DISABLED',
      reason: 'Scheduled crane maintenance',
    });
  });

  it('preserves standalone PolicyFields contract compatibility and read-only behavior for ZonePpeCameraRegionDrawer callers', async () => {
    await i18n.changeLanguage('en');
    const states: PpePolicyDraft[] = [];
    function Harness() {
      const [draft, setDraft] = useState<PpePolicyDraft>({ mode: '' });
      return (
        <PolicyFields
          value={draft}
          onChange={(next) => {
            states.push(next);
            setDraft(next);
          }}
          allowInherit
          label="Region PPE policy"
        />
      );
    }

    render(<Harness />);
    const modeSelect = screen.getByLabelText('Policy mode');

    fireEvent.change(modeSelect, { target: { value: 'EXPLICIT' } });
    expect(screen.getByTestId('ppe-policy-explicit-validation')).toBeTruthy();
    expect(screen.getAllByText('Core')).toHaveLength(2);
    expect(screen.getAllByText('Experimental')).toHaveLength(3);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Boots' }));
    expect(screen.queryByTestId('ppe-policy-explicit-validation')).toBeNull();
    expect(parseRegionPpePolicy(states.at(-1))).toEqual({
      mode: 'EXPLICIT',
      requiredPpe: ['BOOTS'],
    });

    fireEvent.change(modeSelect, { target: { value: 'INHERIT' } });
    expect(parseRegionPpePolicy(states.at(-1))).toEqual({ mode: 'INHERIT' });

    fireEvent.change(modeSelect, { target: { value: 'DISABLED' } });
    expect(screen.getByTestId('ppe-policy-disabled-validation')).toBeTruthy();

    // Control characters in reason keep Save locked with field-linked explanation
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Walkway\u0007buffer' },
    });
    expect(parseRegionPpePolicy(states.at(-1))).toBeNull();
    expect(screen.getByTestId('ppe-policy-disabled-validation').textContent).toMatch(
      /without control characters/i,
    );

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Walkway buffer' } });
    expect(screen.queryByTestId('ppe-policy-disabled-validation')).toBeNull();
    expect(parseRegionPpePolicy(states.at(-1))).toEqual({
      mode: 'DISABLED',
      reason: 'Walkway buffer',
    });

    // Read-only mode preserves concise readiness guidance while suppressing edit validation prompts
    cleanup();
    render(
      <PolicyFields
        value={{ mode: 'EXPLICIT', requiredPpe: [] }}
        onChange={vi.fn()}
        allowInherit={false}
        label="Read-only camera policy"
        readOnly
      />,
    );
    expect(screen.getByTestId('ppe-readiness-guidance')).toBeTruthy();
    expect(screen.queryByTestId('ppe-policy-explicit-validation')).toBeNull();
  });
});
