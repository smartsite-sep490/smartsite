// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import type { CameraApplicationStatus } from '@smartsite/contracts/camera-application-status';
import type { CameraResponse } from '@smartsite/contracts/management';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import {
  CameraApplicationStatusSummary,
  type CameraApplicationStatusContext,
} from './CameraApplicationStatusSummary';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAMERA: CameraResponse = {
  type: 'ZONE',
  gateId: null,
  id: '00000000-0000-4000-8000-000000000101',
  siteId: SITE_ID,
  externalId: 'avr-laptop-demo',
  code: 'CAM-101',
  name: 'North Crane',
  status: 'ACTIVE',
  configurationVersion: 6,
  createdAt: '2026-11-01T00:00:00.000Z',
};

function renderSummary(
  status: CameraApplicationStatus | Error,
  options: { compact?: boolean; onUnauthorized?: () => void } = {},
) {
  const getCameraApplicationStatus =
    status instanceof Error ? vi.fn().mockRejectedValue(status) : vi.fn().mockResolvedValue(status);
  const context: CameraApplicationStatusContext = {
    setupKey: ['camera-app-status-test'],
    token: 'token-valid',
    siteId: SITE_ID,
    client: { getCameraApplicationStatus },
    enabled: true,
    onUnauthorized: options.onUnauthorized ?? vi.fn(),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CameraApplicationStatusSummary
        camera={CAMERA}
        context={context}
        compact={options.compact ?? false}
      />
    </QueryClientProvider>,
  );
  return { getCameraApplicationStatus };
}

describe('CameraApplicationStatusSummary plain-language status & technical details', () => {
  beforeEach(async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows plain EN/VI copy for PENDING and moves desired/reported versions, raw reason code, and timestamps inside collapsed Technical details while keeping actionable guidance outside', async () => {
    const nowIso = new Date().toISOString();
    renderSummary(
      {
        siteId: SITE_ID,
        cameraId: CAMERA.id,
        desiredRevision: 6,
        reportedRevision: 5,
        applicationState: 'PENDING',
        viewValidity: 'UNCONFIRMED',
        reasonCode: 'DESIRED_CONFIGURATION_PENDING',
        lastReceiptAt: nowIso,
        observedAt: nowIso,
      },
      { compact: true },
    );

    const statusBox = await screen.findByTestId('camera-application-status');
    await waitFor(() => {
      expect(statusBox.getAttribute('data-application-state')).toBe('PENDING');
    });

    const primary = within(statusBox).getByTestId('camera-application-primary-status');
    expect(primary.textContent).toBe('Saved · Waiting for AI application');
    expect(primary.textContent).not.toMatch(/Worker|v5|v6|DESIRED_CONFIGURATION_PENDING/);

    const compactHint = within(statusBox).getByTestId('camera-view-validity-warning');
    expect(compactHint.textContent).toContain(
      'Keep the camera fixed; review the region after changing its angle.',
    );
    expect(compactHint.className).toContain('text-slate-600');
    expect(compactHint.className).not.toContain('text-amber-900');

    const guidance = within(statusBox).getByTestId('camera-application-reason-guidance');
    expect(guidance.textContent).toContain('AI is still using an earlier saved configuration.');
    expect(guidance.textContent).not.toContain('DESIRED_CONFIGURATION_PENDING');

    const details = within(statusBox).getByTestId(
      'camera-application-technical-details',
    ) as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByText('Technical details')).toBeTruthy();
    expect(within(details).getByText('Saved version: v6 · AI reported: v5')).toBeTruthy();
    expect(within(details).getByText('Reason code: DESIRED_CONFIGURATION_PENDING')).toBeTruthy();
    expect(within(details).getByText(/Observed:/)).toBeTruthy();
    expect(
      within(details).getByText(
        'Configuration receipt does not prove live video or model accuracy.',
      ),
    ).toBeTruthy();

    await i18n.changeLanguage('vi');
    await waitFor(() => {
      expect(primary.textContent).toBe('Đã lưu · Đang chờ áp dụng');
    });
    expect(compactHint.textContent).toContain(
      'Giữ camera cố định; kiểm tra lại vùng sau khi đổi góc.',
    );
    expect(within(details).getByText('Chi tiết kỹ thuật')).toBeTruthy();
    expect(
      within(details).getByText('Phiên bản đã lưu: v6 · Máy xử lý camera báo cáo: v5'),
    ).toBeTruthy();
    expect(within(details).getByText('Mã lý do: DESIRED_CONFIGURATION_PENDING')).toBeTruthy();
  });

  it('uses honest plain copy for LOADED and renders UNCONFIRMED view validity as a neutral slate reminder in EN and VI', async () => {
    const nowIso = new Date().toISOString();
    renderSummary({
      siteId: SITE_ID,
      cameraId: CAMERA.id,
      desiredRevision: 6,
      reportedRevision: 6,
      applicationState: 'LOADED',
      viewValidity: 'UNCONFIRMED',
      reasonCode: null,
      lastReceiptAt: nowIso,
      observedAt: nowIso,
    });

    const statusBox = await screen.findByTestId('camera-application-status');
    await waitFor(() => {
      expect(statusBox.getAttribute('data-application-state')).toBe('LOADED');
    });
    expect(statusBox.getAttribute('data-view-validity')).toBe('UNCONFIRMED');

    const primary = within(statusBox).getByTestId('camera-application-primary-status');
    expect(primary.textContent).toBe('AI has received the configuration');
    expect(primary.textContent).not.toMatch(/Ready|Live|Monitoring|Accurate|Worker|v6/i);
    expect(screen.queryByTestId('camera-application-reason-guidance')).toBeNull();

    const angleHint = within(statusBox).getByTestId('camera-view-validity-warning');
    expect(angleHint.textContent).toContain(
      'Keep the camera fixed; review the region after changing its angle.',
    );
    expect(angleHint.textContent).not.toMatch(/Verified|Confirmed|Live|Ready/i);
    expect(angleHint.className).toContain('text-slate-600');
    expect(angleHint.className).not.toContain('text-amber-900');
    const hintDot = angleHint.querySelector('span[aria-hidden="true"]');
    expect(hintDot?.className).toContain('bg-slate-400');
    expect(hintDot?.className).not.toContain('bg-amber-600');

    const details = within(statusBox).getByTestId(
      'camera-application-technical-details',
    ) as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByText('Saved version: v6 · AI reported: v6')).toBeTruthy();

    await i18n.changeLanguage('vi');
    await waitFor(() => {
      expect(primary.textContent).toBe('Đã nhận cấu hình');
    });
    expect(primary.textContent).not.toMatch(/Sẵn sàng|Đang giám sát|Worker|v6/i);
    expect(angleHint.textContent).toContain(
      'Giữ camera cố định; kiểm tra lại vùng sau khi đổi góc.',
    );
    expect(angleHint.textContent).not.toMatch(/Đã xác nhận|Đang giám sát|Sẵn sàng/i);
  });

  it('preserves STALE and REJECTED state distinctions and unavailable/refresh error handling', async () => {
    const nowIso = new Date().toISOString();
    renderSummary({
      siteId: SITE_ID,
      cameraId: CAMERA.id,
      desiredRevision: 6,
      reportedRevision: 6,
      applicationState: 'REJECTED',
      viewValidity: 'UNCONFIRMED',
      reasonCode: 'CONFIGURATION_NOT_ISSUED',
      lastReceiptAt: nowIso,
      observedAt: nowIso,
    });

    const rejectedBox = await screen.findByTestId('camera-application-status');
    await waitFor(() => {
      expect(rejectedBox.getAttribute('data-application-state')).toBe('REJECTED');
    });
    expect(within(rejectedBox).getByTestId('camera-application-primary-status').textContent).toBe(
      'Saved · AI could not apply configuration',
    );
    expect(
      within(rejectedBox).getByTestId('camera-application-reason-guidance').textContent,
    ).not.toContain('CONFIGURATION_NOT_ISSUED');
    expect(
      within(within(rejectedBox).getByTestId('camera-application-technical-details')).getByText(
        'Reason code: CONFIGURATION_NOT_ISSUED',
      ),
    ).toBeTruthy();

    cleanup();

    const oldIso = new Date(Date.now() - 120_000).toISOString();
    renderSummary({
      siteId: SITE_ID,
      cameraId: CAMERA.id,
      desiredRevision: 6,
      reportedRevision: 6,
      applicationState: 'STALE',
      viewValidity: 'NEEDS_REVALIDATION',
      reasonCode: 'APPLICATION_RECEIPT_STALE',
      lastReceiptAt: oldIso,
      observedAt: nowIso,
    });
    const staleBox = await screen.findByTestId('camera-application-status');
    await waitFor(() => {
      expect(staleBox.getAttribute('data-application-state')).toBe('STALE');
    });
    expect(within(staleBox).getByTestId('camera-application-primary-status').textContent).toBe(
      'Saved · Unable to confirm',
    );
    const revalidationWarning = within(staleBox).getByTestId('camera-view-validity-warning');
    expect(revalidationWarning.textContent).toContain('Needs camera angle review');
    expect(revalidationWarning.className).toContain('text-amber-900');
    expect(revalidationWarning.className).not.toContain('text-slate-600');
    expect(revalidationWarning.querySelector('span[aria-hidden="true"]')?.className).toContain(
      'bg-amber-600',
    );
    await i18n.changeLanguage('vi');
    await waitFor(() => {
      expect(revalidationWarning.textContent).toContain('Cần kiểm tra lại góc camera');
    });
    await i18n.changeLanguage('en');
    await waitFor(() => {
      expect(revalidationWarning.textContent).toContain('Needs camera angle review');
    });
    expect(
      within(staleBox).getByTestId('camera-application-reason-guidance').textContent,
    ).toContain('over 60 seconds old');
    expect(
      within(staleBox).getByTestId('camera-application-reason-guidance').textContent,
    ).not.toContain('APPLICATION_RECEIPT_STALE');
    expect(
      within(within(staleBox).getByTestId('camera-application-technical-details')).getByText(
        'Reason code: APPLICATION_RECEIPT_STALE',
      ),
    ).toBeTruthy();

    cleanup();

    renderSummary({
      siteId: SITE_ID,
      cameraId: CAMERA.id,
      desiredRevision: 6,
      reportedRevision: null,
      applicationState: 'UNCONFIRMED',
      viewValidity: 'UNAVAILABLE',
      reasonCode: 'VIEW_UNAVAILABLE',
      lastReceiptAt: null,
      observedAt: nowIso,
    });
    const unavailableViewBox = await screen.findByTestId('camera-application-status');
    await waitFor(() => {
      expect(unavailableViewBox.getAttribute('data-view-validity')).toBe('UNAVAILABLE');
    });
    const unavailableWarning = within(unavailableViewBox).getByTestId(
      'camera-view-validity-warning',
    );
    expect(unavailableWarning.textContent).toContain('Camera angle reference unavailable');
    expect(unavailableWarning.className).toContain('text-amber-900');
    expect(unavailableWarning.className).not.toContain('text-slate-600');
    expect(unavailableWarning.querySelector('span[aria-hidden="true"]')?.className).toContain(
      'bg-amber-600',
    );
    await i18n.changeLanguage('vi');
    await waitFor(() => {
      expect(unavailableWarning.textContent).toContain('Chưa có ảnh góc nhìn camera');
    });
    await i18n.changeLanguage('en');

    cleanup();

    const onUnauthorized = vi.fn();
    const { getCameraApplicationStatus } = renderSummary(
      new ApiError('http', 'Server error', 503),
      {
        onUnauthorized,
      },
    );
    const unavailableBox = await screen.findByTestId('camera-application-status');
    await waitFor(() => {
      expect(unavailableBox.textContent).toContain(
        'Could not confirm whether AI has received the configuration.',
      );
    });
    expect(unavailableBox.getAttribute('data-application-state')).toBe('UNAVAILABLE');
    expect(unavailableBox.textContent).toContain('Saved · Unable to confirm');
    expect(
      within(within(unavailableBox).getByTestId('camera-application-technical-details')).getByText(
        'Saved version: v6',
      ),
    ).toBeTruthy();
    fireEvent.click(within(unavailableBox).getByRole('button', { name: 'Refresh status' }));
    await waitFor(() => {
      expect(getCameraApplicationStatus).toHaveBeenCalledTimes(2);
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
