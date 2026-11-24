// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PPE_FAMILY_CATALOG, PPE_ITEMS } from '@smartsite/contracts/ppe-items';
import i18n from '../../i18n';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { CameraPpePolicyPanel, type CameraPpeContext } from './CameraPpePolicyPanel';
import { ZonePpeCreateForm } from '../ppe/ZonePpeCreateForm';
import { registerZonePpeSetupCopy, type ZonePpeSetupCopyKey } from '../ppe/zone-ppe-setup-copy';
import { CANONICAL_PPE_ITEMS } from '../ppe/zone-ppe-setup-types';

registerZonePpeSetupCopy();

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});

describe('Slice 2: Canonical 8-family PPE_FAMILY_CATALOG UI in Camera PPE policy and Zone PPE setup', () => {
  it('binds CANONICAL_PPE_ITEMS directly to contract PPE_ITEMS without duplicating enum arrays', () => {
    expect(CANONICAL_PPE_ITEMS).toBe(PPE_ITEMS);
    expect(PPE_FAMILY_CATALOG).toHaveLength(8);
    expect(PPE_FAMILY_CATALOG.filter((entry) => entry.policySelectable).map((e) => e.item)).toEqual(
      [...PPE_ITEMS],
    );
    expect(
      PPE_FAMILY_CATALOG.filter((entry) => !entry.policySelectable).map((e) => e.item),
    ).toEqual(['MASK', 'FULL_BODY_HARNESS', 'LANYARD_HOOK']);
  });

  it('renders all 8 canonical PPE families honestly in CameraPpePolicyPanel (5 selectable, 3 non-selectable with contract-driven EN/VI reasons)', async () => {
    await i18n.changeLanguage('en');
    const cameraId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
    const updateCameraPpePolicy = vi
      .fn<CameraPpeContext['client']['updateCameraPpePolicy']>()
      .mockImplementation(async (_token, _site, _cam, command) => ({
        cameraId,
        commandId: command.commandId,
        configurationVersion: 6,
        viewRevision: 1,
        bundleSha256: 'd'.repeat(64),
        replayed: false,
      }));
    const client: CameraPpeContext['client'] = {
      readSavedPpePolicy: vi.fn().mockResolvedValue({
        cameraId,
        regionId: null,
        configurationVersion: 5,
        savedRevision: 3,
        policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT', 'SAFETY_VEST'] },
      }),
      listRegions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      initializePpePolicy: vi.fn(),
      updateCameraPpePolicy,
      updateRegionPpePolicy: vi.fn(),
      activateRegionWithPpePolicy: vi.fn(),
    };

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CameraPpePolicyPanel
          cameraId={cameraId}
          canWrite
          expandSignal={1}
          context={{
            client,
            token: 'token-slice2',
            siteId: 'site-slice2',
            setupKey: ['slice2-catalog'],
            onUnauthorized: vi.fn(),
          }}
        />
      </QueryClientProvider>,
    );

    const selectableGroup = await screen.findByRole('group', { name: 'Required PPE items' });
    expect(within(selectableGroup).getAllByRole('checkbox')).toHaveLength(PPE_ITEMS.length);

    const unsupportedSection = screen.getByTestId('ppe-catalog-not-selectable');
    expect(within(unsupportedSection).queryAllByRole('checkbox')).toHaveLength(0);
    expect(unsupportedSection.textContent).toMatch(/3 of 8 PPE types/i);
    expect(unsupportedSection.textContent).not.toMatch(
      /FULL_BODY_HARNESS|LANYARD_HOOK|\bMASK\b|contract|safety boundary/i,
    );

    const maskRow = unsupportedSection.querySelector('[data-ppe-family="MASK"]') as HTMLElement;
    const harnessRow = unsupportedSection.querySelector(
      '[data-ppe-family="FULL_BODY_HARNESS"]',
    ) as HTMLElement;
    const hookRow = unsupportedSection.querySelector(
      '[data-ppe-family="LANYARD_HOOK"]',
    ) as HTMLElement;

    expect(maskRow).toBeTruthy();
    expect(harnessRow).toBeTruthy();
    expect(hookRow).toBeTruthy();

    expect(maskRow.getAttribute('data-unsupported-reason')).toBe('NOT_IN_POLICY_CONTRACT');
    expect(maskRow.textContent).toMatch(/Mask/i);
    expect(maskRow.textContent).toMatch(/Not configurable yet/i);
    expect(maskRow.textContent).toMatch(/required monitoring rule yet/i);

    expect(harnessRow.getAttribute('data-unsupported-reason')).toBe('PRESENT_ONLY_SAFETY_BOUNDARY');
    expect(harnessRow.textContent).toMatch(/Full-body harness/i);
    expect(harnessRow.textContent).toMatch(/Presence only/i);
    expect(harnessRow.textContent).toMatch(/does not confirm proper wearing or tie-off/i);

    expect(hookRow.getAttribute('data-unsupported-reason')).toBe('PRESENT_ONLY_SAFETY_BOUNDARY');
    expect(hookRow.textContent).toMatch(/Lanyard hook/i);
    expect(hookRow.textContent).toMatch(/Presence only/i);

    const boundaryNote = screen.getByTestId('ppe-catalog-boundary-note');
    expect(boundaryNote.textContent).toMatch(/8 PPE types/i);
    expect(boundaryNote.textContent).toMatch(/5 can be selected/i);
    expect(boundaryNote.textContent).toMatch(/does not mean the AI model is running or verified/i);

    // Switch to Vietnamese and verify plain user language (zero contract/boundary jargon)
    await i18n.changeLanguage('vi');
    await waitFor(() => {
      const viUnsupported = screen.getByTestId('ppe-catalog-not-selectable');
      expect(viUnsupported.textContent).toMatch(/3 \/ 8 loại PPE/i);
      expect(viUnsupported.textContent).toMatch(/Khẩu trang/i);
      expect(viUnsupported.textContent).toMatch(/Dây đai an toàn toàn thân/i);
      expect(viUnsupported.textContent).toMatch(/Móc dây an toàn/i);
      expect(viUnsupported.textContent).toMatch(/Chưa hỗ trợ cấu hình/i);
      expect(viUnsupported.textContent).toMatch(
        /Chỉ ghi nhận trang bị; không xác nhận đeo hoặc móc đúng/i,
      );
      expect(viUnsupported.textContent).not.toMatch(
        /FULL_BODY_HARNESS|LANYARD_HOOK|\bMASK\b|hợp đồng|ranh giới|cứu sinh/i,
      );
    });

    // Save policy submits strictly canonical selectable PPE_ITEMS
    await i18n.changeLanguage('en');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Boots' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save PPE policy' }));
    await waitFor(() => expect(updateCameraPpePolicy).toHaveBeenCalledTimes(1));
    expect(updateCameraPpePolicy.mock.calls[0]?.[3]?.policy).toEqual({
      mode: 'EXPLICIT',
      requiredPpe: ['BOOTS', 'HARD_HAT', 'SAFETY_VEST'],
    });
  });

  it('renders all 8 canonical PPE families in ZonePpeCreateForm from PPE_FAMILY_CATALOG (5 selectable checkboxes, 3 read-only non-selectable entries with distinct reasons in EN/VI)', async () => {
    await i18n.changeLanguage('en');
    const onTogglePpe = vi.fn();
    const renderForm = () => {
      const translate = (key: ZonePpeSetupCopyKey, params?: Record<string, string | number>) =>
        String(i18n.t(key, { ns: SAFETY_NAMESPACE, ...params }));
      return render(
        <ZonePpeCreateForm
          canManageZones
          zoneCode="ZONE-HIGH-01"
          zoneName="Roof Edge"
          selectedPpe={['HARD_HAT']}
          codeError={null}
          nameError={null}
          ppeError={null}
          serverError={null}
          successFeedback={null}
          isCreatingZone={false}
          saving={false}
          zoneCodeInputRef={{ current: null }}
          zoneNameInputRef={{ current: null }}
          firstPpeInputRef={{ current: null }}
          t={translate}
          onZoneCodeChange={vi.fn()}
          onZoneNameChange={vi.fn()}
          onTogglePpe={onTogglePpe}
          onClearCreateForm={vi.fn()}
          onSubmit={vi.fn((e) => e.preventDefault())}
        />,
      );
    };

    const { rerender } = renderForm();

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(PPE_ITEMS.length);
    fireEvent.click(screen.getByRole('checkbox', { name: /Safety Vest/i }));
    expect(onTogglePpe).toHaveBeenCalledWith('SAFETY_VEST');

    const unsupportedBox = screen.getByTestId('zone-ppe-catalog-not-selectable');
    expect(within(unsupportedBox).queryAllByRole('checkbox')).toHaveLength(0);
    expect(unsupportedBox.textContent).not.toMatch(
      /FULL_BODY_HARNESS|LANYARD_HOOK|\bMASK\b|contract|safety boundary/i,
    );

    const maskItem = unsupportedBox.querySelector('[data-ppe-family="MASK"]') as HTMLElement;
    const harnessItem = unsupportedBox.querySelector(
      '[data-ppe-family="FULL_BODY_HARNESS"]',
    ) as HTMLElement;
    const hookItem = unsupportedBox.querySelector(
      '[data-ppe-family="LANYARD_HOOK"]',
    ) as HTMLElement;

    expect(maskItem).toBeTruthy();
    expect(harnessItem).toBeTruthy();
    expect(hookItem).toBeTruthy();

    expect(maskItem.textContent).toMatch(/Mask/i);
    expect(maskItem.textContent).toMatch(/required monitoring rule yet/i);
    expect(harnessItem.textContent).toMatch(/Full-body harness/i);
    expect(harnessItem.textContent).toMatch(/Presence only/i);
    expect(hookItem.textContent).toMatch(/Lanyard hook/i);
    expect(hookItem.textContent).toMatch(/Presence only/i);

    await i18n.changeLanguage('vi');
    const viTranslate = (key: ZonePpeSetupCopyKey, params?: Record<string, string | number>) =>
      String(i18n.t(key, { ns: SAFETY_NAMESPACE, ...params }));
    rerender(
      <ZonePpeCreateForm
        canManageZones
        zoneCode="ZONE-HIGH-01"
        zoneName="Roof Edge"
        selectedPpe={['HARD_HAT']}
        codeError={null}
        nameError={null}
        ppeError={null}
        serverError={null}
        successFeedback={null}
        isCreatingZone={false}
        saving={false}
        zoneCodeInputRef={{ current: null }}
        zoneNameInputRef={{ current: null }}
        firstPpeInputRef={{ current: null }}
        t={viTranslate}
        onZoneCodeChange={vi.fn()}
        onZoneNameChange={vi.fn()}
        onTogglePpe={onTogglePpe}
        onClearCreateForm={vi.fn()}
        onSubmit={vi.fn((e) => e.preventDefault())}
      />,
    );

    const viUnsupportedBox = screen.getByTestId('zone-ppe-catalog-not-selectable');
    expect(viUnsupportedBox.textContent).toMatch(/Khẩu trang/i);
    expect(viUnsupportedBox.textContent).toMatch(/Dây đai an toàn toàn thân/i);
    expect(viUnsupportedBox.textContent).toMatch(/Móc dây an toàn/i);
    expect(viUnsupportedBox.textContent).toMatch(/Chỉ ghi nhận trang bị/i);
    expect(viUnsupportedBox.textContent).not.toMatch(/hợp đồng|ranh giới|cứu sinh/i);
  });
});
