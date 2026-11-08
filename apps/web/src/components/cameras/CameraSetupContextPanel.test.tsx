// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraApplicationStatus } from '@smartsite/contracts/camera-application-status';
import type { CameraResponse } from '@smartsite/contracts/management';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import './camera-setup-catalog-copy';
import type { CameraApplicationStatusContext } from './CameraApplicationStatusSummary';
import {
  CameraSetupContextBar,
  CameraSetupRowMetadata,
  CameraSetupStageCards,
} from './CameraSetupContextPanel';

const SITE_ID = '11111111-1111-4111-8111-111111111111';

const ACTIVE_CAMERA: CameraResponse = {
  id: '00000000-0000-4000-8000-000000000101',
  siteId: SITE_ID,
  externalId: 'rtsp-cam-101',
  code: 'CAM-101',
  name: 'North Crane',
  status: 'ACTIVE',
  configurationVersion: 3,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const INACTIVE_CAMERA: CameraResponse = {
  id: '00000000-0000-4000-8000-000000000102',
  siteId: SITE_ID,
  externalId: 'rtsp-cam-102',
  code: 'CAM-102',
  name: 'South Gate',
  status: 'INACTIVE',
  configurationVersion: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
};

describe('CameraSetupContextPanel saved configuration vs worker-applied status', () => {
  beforeEach(async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders four-stage setup reference and per-row saved configuration metadata', () => {
    render(
      <div>
        <CameraSetupStageCards />
        <CameraSetupRowMetadata row={ACTIVE_CAMERA} isEnabled={true} />
      </div>,
    );

    const disclosure = screen.getByTestId('camera-setup-stages-disclosure');
    const stageList = within(disclosure).getByRole('list', {
      name: /Four-stage setup reference/i,
    });
    expect(within(stageList).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('Enabled')).toBeTruthy();
    expect(screen.getByText('CAM-101')).toBeTruthy();
    expect(screen.getByText('Saved config version')).toBeTruthy();
    expect(screen.getByText('v3')).toBeTruthy();
  });

  it('clearly distinguishes saved-only metadata from worker-applied status in EN and VI for manager and read-only scopes without unavailable actions', async () => {
    const open = vi.fn();
    const { rerender } = render(
      <CameraSetupContextBar
        siteCode="SITE-01"
        siteName="North Yard"
        rows={[ACTIVE_CAMERA, INACTIVE_CAMERA]}
        selectedCamera={ACTIVE_CAMERA}
        canManageCameras={true}
        canOpenMonitoring={false}
        open={open}
      />,
    );

    expect(screen.getByText('SITE-01 · North Yard')).toBeTruthy();
    expect(screen.getByText('1 enabled · 1 disabled')).toBeTruthy();
    expect(
      screen.getByText(
        'Catalog status (Enabled/Disabled) and vN reflect saved configuration only, not worker application or live video. Check the selected camera status summary for worker receipts and Regions for reference-frame status.',
      ),
    ).toBeTruthy();

    const selectedRegion = screen.getByRole('region', { name: 'Selected camera' });
    expect(selectedRegion.getAttribute('data-tour-anchor')).toBe('camera-setup-save');
    expect(within(selectedRegion).getByText('CAM-101 · North Crane')).toBeTruthy();

    const savedSummary = within(selectedRegion).getByTestId('camera-saved-config-summary');
    expect(savedSummary.getAttribute('data-application-state')).toBe('SAVED_METADATA_ONLY');
    expect(
      screen.getAllByText('Saved config version v3; worker application status unavailable.'),
    ).toHaveLength(1);
    expect(
      within(savedSummary).getByText(
        'Saved status is Enabled in configuration only (not worker-applied or ready). Open Regions to review reference-frame status or Manage for source details.',
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId('camera-application-status')).toBeNull();

    const regionsBtn = within(selectedRegion).getByRole('button', {
      name: 'Edit observation regions (CAM-101)',
    });
    const manageBtn = within(selectedRegion).getByRole('button', {
      name: 'Edit camera settings (CAM-101)',
    });
    fireEvent.click(regionsBtn);
    expect(open).toHaveBeenCalledWith('regions', ACTIVE_CAMERA.id, regionsBtn);
    fireEvent.click(manageBtn);
    expect(open).toHaveBeenCalledWith('manage', ACTIVE_CAMERA.id, manageBtn);

    // Read-only English active camera: no Manage/Regions buttons and no instruction to open them
    rerender(
      <CameraSetupContextBar
        siteCode="SITE-01"
        siteName="North Yard"
        rows={[ACTIVE_CAMERA, INACTIVE_CAMERA]}
        selectedCamera={ACTIVE_CAMERA}
        canManageCameras={false}
        canOpenMonitoring={true}
        open={open}
      />,
    );

    expect(
      screen.getByText(
        'Catalog status (Enabled/Disabled) and vN reflect saved configuration only, not worker application or live video. Check the selected camera status summary for worker receipts and reference-frame validity.',
      ),
    ).toBeTruthy();
    const readOnlyActiveSummary = within(
      screen.getByRole('region', { name: 'Selected camera' }),
    ).getByTestId('camera-saved-config-summary');
    expect(
      within(readOnlyActiveSummary).getByText(
        'Saved status is Enabled in configuration only (not worker-applied or ready). Check the camera status summary when available for worker receipts and reference-frame validity.',
      ),
    ).toBeTruthy();
    expect(readOnlyActiveSummary.textContent).not.toMatch(/Open Regions|Open Manage/i);

    await i18n.changeLanguage('vi');
    rerender(
      <CameraSetupContextBar
        siteCode="SITE-01"
        siteName="North Yard"
        rows={[ACTIVE_CAMERA, INACTIVE_CAMERA]}
        selectedCamera={INACTIVE_CAMERA}
        canManageCameras={false}
        canOpenMonitoring={true}
        open={open}
      />,
    );

    expect(
      screen.getByText(
        'Trạng thái danh mục (Đang bật/Đang tắt) và vN chỉ phản ánh cấu hình đã lưu, không đồng nghĩa worker đã áp dụng hay có video trực tiếp. Xem tóm tắt trạng thái ở camera đang chọn để kiểm tra biên nhận worker và độ hợp lệ của khung tham chiếu.',
      ),
    ).toBeTruthy();

    const viSelectedRegion = screen.getByRole('region', { name: 'Camera đang chọn' });
    const viSavedSummary = within(viSelectedRegion).getByTestId('camera-saved-config-summary');
    expect(
      screen.getAllByText(
        'Phiên bản cấu hình đã lưu v1; chưa có trạng thái áp dụng của worker.',
      ),
    ).toHaveLength(1);
    expect(
      within(viSavedSummary).getByText(
        'Trạng thái đã lưu chỉ cho biết Đang tắt trong cấu hình. Xem tóm tắt trạng thái camera khi khả dụng để kiểm tra biên nhận worker; việc bật camera thuộc quyền Quản lý công trường.',
      ),
    ).toBeTruthy();
    expect(viSavedSummary.textContent).not.toMatch(/Mở Quản lý|Mở Vùng quan sát/i);
    expect(within(viSelectedRegion).queryByRole('button')).toBeNull();
  });

  it('renders live worker-applied status summary when statusContext is provided while keeping saved-vs-applied disclosure distinct', async () => {
    const nowIso = new Date().toISOString();
    const getCameraApplicationStatus = vi.fn().mockResolvedValue({
      siteId: SITE_ID,
      cameraId: ACTIVE_CAMERA.id,
      desiredRevision: 3,
      reportedRevision: 3,
      applicationState: 'LOADED',
      viewValidity: 'UNCONFIRMED',
      reasonCode: null,
      lastReceiptAt: nowIso,
      observedAt: nowIso,
    } satisfies CameraApplicationStatus);

    const statusContext: CameraApplicationStatusContext = {
      setupKey: ['camera-setup-test'],
      token: 'token-valid',
      siteId: SITE_ID,
      client: { getCameraApplicationStatus },
      enabled: true,
      onUnauthorized: vi.fn(),
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CameraSetupContextBar
          siteCode="SITE-01"
          siteName="North Yard"
          rows={[ACTIVE_CAMERA]}
          selectedCamera={ACTIVE_CAMERA}
          canManageCameras={true}
          canOpenMonitoring={false}
          open={vi.fn()}
          statusContext={statusContext}
        />
      </QueryClientProvider>,
    );

    const appStatus = await screen.findByTestId('camera-application-status');
    await waitFor(() => {
      expect(appStatus.getAttribute('data-application-state')).toBe('LOADED');
    });
    expect(within(appStatus).getByText('Saved v3 · Worker reported: v3')).toBeTruthy();
    expect(within(appStatus).getByText('Worker loaded v3')).toBeTruthy();
    expect(screen.queryByTestId('camera-saved-config-summary')).toBeNull();
    expect(
      screen.getByText(
        'Catalog status (Enabled/Disabled) and vN reflect saved configuration only, not worker application or live video. Check the selected camera status summary for worker receipts and Regions for reference-frame status.',
      ),
    ).toBeTruthy();
  });
});
