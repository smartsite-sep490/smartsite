// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CameraResponse } from '@smartsite/contracts/management';
import { changeUiLanguage } from '../../i18n/runtime';
import './camera-setup-catalog';
import { CameraSetupContextBar, CameraSetupRowMetadata } from './CameraSetupContextPanel';
import { CameraSetupWorkflow } from './CameraSetupWorkflow';

const baseCamera: CameraResponse = {
  id: 'cam-1',
  siteId: 'site-1',
  code: 'C1',
  name: 'North Gate Camera',
  externalId: 'rtsp-source-private-id',
  status: 'ACTIVE',
  configurationVersion: 3,
  createdAt: '2026-10-20T00:00:00Z',
};

beforeEach(() => {
  changeUiLanguage('en');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps the four-step setup explanation inside a single un-nested setup guide disclosure with plain EN/VI copy', async () => {
  const { container } = render(
    <CameraSetupWorkflow
      canWriteZones={false}
      canReadZones={false}
      canManageCameras={false}
      open={vi.fn()}
    />,
  );

  const disclosures = container.querySelectorAll('details');
  expect(disclosures).toHaveLength(1);
  const helpDisclosure = disclosures[0] as HTMLDetailsElement;
  expect(helpDisclosure.open).toBe(false);
  expect(helpDisclosure.querySelector('details')).toBeNull();
  expect(container.querySelector('.lg\\:grid-cols-4')).toBeNull();

  const summaryText = screen.getByText('Setup guide');
  const summary = summaryText.closest('summary');
  expect(summary).toBeTruthy();

  fireEvent.click(summary!);
  expect(helpDisclosure.open).toBe(true);

  const listsInDisclosure = within(helpDisclosure).getAllByRole('list');
  expect(listsInDisclosure).toHaveLength(1);

  const stageSection = within(helpDisclosure).getByTestId('camera-setup-stages-disclosure');
  const stageList = within(stageSection).getByRole('list', {
    name: 'Four-stage setup reference',
  });
  expect(stageList.tagName).toBe('OL');
  expect(within(stageList).getAllByRole('listitem')).toHaveLength(4);
  expect(within(stageList).getByText('Stage 1 · Per-Zone PPE Policy')).toBeTruthy();
  expect(within(stageList).getByText('Stage 2 · Camera & Source ID')).toBeTruthy();
  expect(within(stageList).getByText('Stage 3 · Reference Image')).toBeTruthy();
  expect(within(stageList).getByText('Stage 4 · Observation Regions')).toBeTruthy();
  expect(
    within(stageList).getByText(/Registration does not verify a live connection/i),
  ).toBeTruthy();
  expect(within(stageList).getByText(/Saving stores the configuration version only/i)).toBeTruthy();

  expect(stageList.textContent).not.toMatch(/0\.\.1|externalId|worker/i);
  expect(stageList.textContent).not.toMatch(/worker applied|camera moved|online/i);

  await act(async () => {
    await changeUiLanguage('vi');
  });

  expect(screen.getByText('Tham chiếu 4 bước thiết lập')).toBeTruthy();
  expect(within(stageList).getByText('Bước 1 · Chính sách PPE theo khu vực')).toBeTruthy();
  expect(within(stageList).getByText('Bước 4 · Vùng quan sát')).toBeTruthy();
  expect(
    within(stageList).getByText(/Việc đăng ký không xác nhận kết nối trực tiếp/i),
  ).toBeTruthy();
  expect(within(stageList).getByText(/Thao tác lưu chỉ ghi nhận phiên bản cấu hình/i)).toBeTruthy();
  expect(stageList.textContent).not.toMatch(/0\.\.1|externalId|worker/i);
});

it('prioritizes the selected camera task, keeps region edit primary and manage secondary when active, and opens manage when disabled', () => {
  const open = vi.fn();
  const inactiveCamera: CameraResponse = {
    ...baseCamera,
    id: 'cam-2',
    code: 'C2',
    name: 'West Yard Camera',
    status: 'INACTIVE',
    configurationVersion: 5,
  };

  const { rerender } = render(
    <CameraSetupContextBar
      siteCode="S1"
      siteName="North Site"
      rows={[baseCamera, inactiveCamera]}
      selectedCamera={inactiveCamera}
      canManageCameras
      canOpenMonitoring={false}
      open={open}
    />,
  );

  const selectedCard = document.querySelector(
    '[data-tour-anchor="camera-setup-save"]',
  ) as HTMLElement | null;
  expect(selectedCard).toBeTruthy();
  expect(within(selectedCard!).getByText('C2 · West Yard Camera')).toBeTruthy();
  expect(
    within(selectedCard!).queryByRole('button', { name: 'Edit observation regions (C2)' }),
  ).toBeNull();

  const enableManageBtn = within(selectedCard!).getByRole('button', {
    name: 'Open Manage to enable (C2)',
  });
  fireEvent.click(enableManageBtn);
  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith('manage', 'cam-2', enableManageBtn);

  const metadataDisclosure = screen
    .getByText('Configuration & revision details')
    .closest('details') as HTMLDetailsElement | null;
  expect(metadataDisclosure).toBeTruthy();
  expect(metadataDisclosure!.open).toBe(false);
  fireEvent.click(screen.getByText('Configuration & revision details').closest('summary')!);
  expect(metadataDisclosure!.open).toBe(true);
  expect(
    within(metadataDisclosure!).getByText(
      'Saved config version v5; worker application status unavailable.',
    ),
  ).toBeTruthy();

  open.mockClear();
  rerender(
    <CameraSetupContextBar
      siteCode="S1"
      siteName="North Site"
      rows={[baseCamera, inactiveCamera]}
      selectedCamera={baseCamera}
      canManageCameras
      canOpenMonitoring={false}
      open={open}
    />,
  );

  const primaryRegionsBtn = within(selectedCard!).getByRole('button', {
    name: 'Edit observation regions (C1)',
  });
  const secondaryManageBtn = within(selectedCard!).getByRole('button', {
    name: 'Edit camera settings (C1)',
  });
  expect(primaryRegionsBtn.className).toContain('bg-[#0F172A]');
  expect(secondaryManageBtn.className).toContain('bg-white');

  fireEvent.click(primaryRegionsBtn);
  expect(open).toHaveBeenCalledWith('regions', 'cam-1', primaryRegionsBtn);
  fireEvent.click(secondaryManageBtn);
  expect(open).toHaveBeenCalledWith('manage', 'cam-1', secondaryManageBtn);

  rerender(
    <CameraSetupContextBar
      siteCode="S1"
      siteName="North Site"
      rows={[baseCamera, inactiveCamera]}
      selectedCamera={baseCamera}
      canManageCameras={false}
      canOpenMonitoring
      open={open}
    />,
  );
  expect(
    within(selectedCard!).queryByRole('button', { name: 'Edit observation regions (C1)' }),
  ).toBeNull();
  expect(
    within(selectedCard!).queryByRole('button', { name: 'Edit camera settings (C1)' }),
  ).toBeNull();
  expect(
    screen.getByText(
      'Read-only catalog scope: only the assigned Site Manager can register cameras, change status, or edit Zone and region policies.',
    ),
  ).toBeTruthy();
});

it('wraps long Site, camera, and code strings inside min-w-0 containers without saved-as-active wording', () => {
  const open = vi.fn();
  const longCamera: CameraResponse = {
    ...baseCamera,
    code: 'CAM-NORTH-SECTOR-PERIMETER-GATE-01-EXTENDED-CODE',
    name: 'Khu vực cổng bắc công trường trung tâm giám sát cầu trục tháp số 12 với chuỗi tên rất dài',
    configurationVersion: 12,
  };

  const { container } = render(
    <div>
      <CameraSetupContextBar
        siteCode="SITE-NORTH-COMPLEX-2026-EXTENDED"
        siteName="Tổ hợp công trường phía Bắc giai đoạn mở rộng khu vực cầu cảng và kho bãi"
        rows={[longCamera]}
        selectedCamera={longCamera}
        canManageCameras
        canOpenMonitoring
        open={open}
      />
      <CameraSetupRowMetadata row={longCamera} isEnabled />
    </div>,
  );

  const selectedCard = container.querySelector(
    '[data-tour-anchor="camera-setup-save"]',
  ) as HTMLElement;
  expect(selectedCard.className).toContain('min-w-0');

  const identityHeading = screen.getByText(`${longCamera.code} · ${longCamera.name}`);
  expect(identityHeading.className).toContain('min-w-0');
  expect(identityHeading.className).toContain('break-words');
  expect(identityHeading.className).toContain('[overflow-wrap:anywhere]');

  const siteBadge = screen.getByText(/SITE-NORTH-COMPLEX-2026-EXTENDED/);
  expect(siteBadge.className).toContain('min-w-0');
  expect(siteBadge.className).toContain('break-words');
  expect(siteBadge.className).toContain('[overflow-wrap:anywhere]');

  const regionsBtn = screen.getByRole('button', {
    name: `Edit observation regions (${longCamera.code})`,
  });
  expect(regionsBtn.className).toContain('min-w-0');
  expect(regionsBtn.className).toContain('max-w-full');
  expect(regionsBtn.className).toContain('whitespace-normal');

  const rowCode = screen.getByText(longCamera.code);
  expect(rowCode.className).toContain('min-w-0');
  expect(rowCode.className).toContain('break-all');

  expect(container.textContent).not.toContain(longCamera.externalId);
  expect(container.textContent).not.toMatch(
    /worker applied|camera moved|live connected|\bonline\b/i,
  );
});
