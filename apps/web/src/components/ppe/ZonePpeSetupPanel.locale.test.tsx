// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient, type ZoneResponse } from '@smartsite/api-client';
import { LocaleProvider, useLocale } from '../../i18n/locale';
import { ZonePpeSetupPanel } from './ZonePpeSetupPanel';

function LocaleToggle() {
  const { locale, setLocale } = useLocale();
  return (
    <div>
      <span data-testid="active-locale">{locale}</span>
      <button type="button" onClick={() => setLocale('vi')}>
        switch-vi
      </button>
      <button type="button" onClick={() => setLocale('en')}>
        switch-en
      </button>
    </div>
  );
}

const sampleZone: ZoneResponse = {
  id: '00000000-0000-4000-8000-000000000701',
  siteId: 'site-alpha',
  code: 'ZONE-HAZ-01',
  name: 'Khu vực giàn giáo A',
  type: 'HAZARDOUS',
  restrictionPolicy: 'NONE',
  requiredPpe: ['HARD_HAT', 'SAFETY_VEST', 'GLOVES'],
  configurationLocked: true,
  createdAt: '2026-10-14T06:00:00.000Z',
};

describe('ZonePpeSetupPanel localization (vi/en)', () => {
  let queryClient: QueryClient;
  const mockOnClose = vi.fn();

  beforeEach(() => {
    window.localStorage.clear();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({
      items: [],
      total: 0,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mockOnClose.mockClear();
    window.localStorage.clear();
  });

  it('renders settled zone list, PPE item badges, and form chrome in Vietnamese and switches to English without refetching', async () => {
    const listZonesSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listZones')
      .mockResolvedValue({
        items: [sampleZone],
        total: 1,
      });

    render(
      <LocaleProvider defaultLocale="vi">
        <QueryClientProvider client={queryClient}>
          <LocaleToggle />
          <ZonePpeSetupPanel
            apiUrl="http://localhost:3000"
            token="test-token"
            sessionScope="test-scope"
            credentialId={1}
            siteId="site-alpha"
            siteName="Công trường Alpha"
            onClose={mockOnClose}
          />
        </QueryClientProvider>
      </LocaleProvider>,
    );

    expect(await screen.findByText('Cấu hình PPE theo Khu vực')).toBeDefined();
    expect(await screen.findByText('Các khu vực đã cấu hình cho công trường này')).toBeDefined();
    expect(await screen.findByText('ZONE-HAZ-01')).toBeDefined();
    expect(screen.getByText('Khu vực giàn giáo A')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Đổi tên ZONE-HAZ-01' })).toBeDefined();

    fireEvent.click(screen.getByText('switch-en'));

    expect(await screen.findByText('Configure PPE by Zone')).toBeDefined();
    expect(await screen.findByText('Configured Zones for this Site')).toBeDefined();
    expect(screen.getByText('ZONE-HAZ-01')).toBeDefined();
    expect(screen.getByText('Khu vực giàn giáo A')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Rename ZONE-HAZ-01' })).toBeDefined();
    expect(listZonesSpy).toHaveBeenCalledTimes(1);
  });

  it('localizes create form validation and PPE selection errors across vi and en while preserving draft inputs', async () => {
    const listZonesSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listZones')
      .mockResolvedValue({
        items: [],
        total: 0,
      });
    const createZoneSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createZone');

    render(
      <LocaleProvider defaultLocale="vi">
        <QueryClientProvider client={queryClient}>
          <LocaleToggle />
          <ZonePpeSetupPanel
            apiUrl="http://localhost:3000"
            token="test-token"
            sessionScope="test-scope"
            credentialId={1}
            siteId="site-alpha"
            siteName="Công trường Alpha"
            onClose={mockOnClose}
          />
        </QueryClientProvider>
      </LocaleProvider>,
    );

    await screen.findByText('Cấu hình PPE theo Khu vực');

    // Submit with empty code
    fireEvent.click(screen.getByRole('button', { name: 'Lưu PPE Khu vực' }));
    expect(await screen.findByText('Mã khu vực là bắt buộc.')).toBeDefined();

    // Fill code, submit with empty name
    const codeInput = screen.getByLabelText('Mã khu vực') as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: 'ZONE-DRAFT-02' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu PPE Khu vực' }));
    expect(await screen.findByText('Tên khu vực là bắt buộc.')).toBeDefined();

    // Fill name, uncheck both default core PPE items, submit
    const nameInput = screen.getByLabelText('Tên khu vực') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Khu vực hàn điện' } });
    fireEvent.click(document.getElementById('ppe-item-hard-hat')!);
    fireEvent.click(document.getElementById('ppe-item-safety-vest')!);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu PPE Khu vực' }));

    expect(await screen.findByText('Phải chọn ít nhất một hạng mục PPE.')).toBeDefined();

    // Switch locale to English: draft inputs and active PPE validation error must be retained
    fireEvent.click(screen.getByText('switch-en'));

    expect(await screen.findByText('At least one PPE item must be selected.')).toBeDefined();
    expect((screen.getByLabelText('Zone Code') as HTMLInputElement).value).toBe('ZONE-DRAFT-02');
    expect((screen.getByLabelText('Zone Name') as HTMLInputElement).value).toBe('Khu vực hàn điện');
    expect(listZonesSpy).toHaveBeenCalledTimes(1);
    expect(createZoneSpy).not.toHaveBeenCalled();
  });

  it('retains open inline rename draft, zone identifiers, and validation error across locale switch with zero extra requests', async () => {
    const listZonesSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listZones')
      .mockResolvedValue({
        items: [sampleZone],
        total: 1,
      });
    const renameZoneSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'renameZone');

    render(
      <LocaleProvider defaultLocale="vi">
        <QueryClientProvider client={queryClient}>
          <LocaleToggle />
          <ZonePpeSetupPanel
            apiUrl="http://localhost:3000"
            token="test-token"
            sessionScope="test-scope"
            credentialId={1}
            siteId="site-alpha"
            siteName="Công trường Alpha"
            onClose={mockOnClose}
          />
        </QueryClientProvider>
      </LocaleProvider>,
    );

    const renameBtn = await screen.findByRole('button', { name: 'Đổi tên ZONE-HAZ-01' });
    fireEvent.click(renameBtn);

    expect(await screen.findByText('Đã khóa chính sách · Có thể đổi tên')).toBeDefined();
    const renameInput = screen.getByLabelText('Tên khu vực mới') as HTMLInputElement;
    expect(renameInput.value).toBe('Khu vực giàn giáo A');

    // Trigger empty rename validation error in Vietnamese
    fireEvent.change(renameInput, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu tên' }));
    expect(await screen.findByText('Tên khu vực là bắt buộc.')).toBeDefined();

    // Type a new rename draft, then switch locale to English
    fireEvent.change(renameInput, { target: { value: 'Khu vực cẩu tháp B (Bản nháp)' } });
    fireEvent.click(screen.getByText('switch-en'));

    expect(await screen.findByText('Policy locked · Name editable')).toBeDefined();
    const renameInputEn = screen.getByLabelText('New zone name') as HTMLInputElement;
    expect(renameInputEn.value).toBe('Khu vực cẩu tháp B (Bản nháp)');
    expect(screen.getByText('ZONE-HAZ-01')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel rename' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Save name' })).toBeDefined();
    expect(listZonesSpy).toHaveBeenCalledTimes(1);
    expect(renameZoneSpy).not.toHaveBeenCalled();
  });

  it('localizes create conflict (409) and success feedback in Vietnamese and English without leaking raw server text', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
      items: [sampleZone],
      total: 1,
    });
    const createZoneSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createZone')
      .mockRejectedValueOnce(
        new ApiError('http', 'raw-db-unique-constraint-idx_zones_site_code', 409),
      )
      .mockResolvedValueOnce({
        id: '00000000-0000-4000-8000-000000000705',
        siteId: 'site-alpha',
        code: 'ZONE-NEW-05',
        name: 'Khu vực kho vật tư',
        type: 'HAZARDOUS',
        restrictionPolicy: 'NONE',
        requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
        configurationLocked: false,
        createdAt: '2026-10-14T06:10:00.000Z',
      });

    render(
      <LocaleProvider defaultLocale="vi">
        <QueryClientProvider client={queryClient}>
          <LocaleToggle />
          <ZonePpeSetupPanel
            apiUrl="http://localhost:3000"
            token="test-token"
            sessionScope="test-scope"
            credentialId={1}
            siteId="site-alpha"
            siteName="Công trường Alpha"
            onClose={mockOnClose}
          />
        </QueryClientProvider>
      </LocaleProvider>,
    );

    await screen.findByText('Cấu hình PPE theo Khu vực');
    fireEvent.change(screen.getByLabelText('Mã khu vực'), { target: { value: 'ZONE-NEW-05' } });
    fireEvent.change(screen.getByLabelText('Tên khu vực'), {
      target: { value: 'Khu vực kho vật tư' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu PPE Khu vực' }));

    expect(await screen.findByText('Mã khu vực này đã tồn tại trong công trường.')).toBeDefined();
    expect(screen.queryByText('raw-db-unique-constraint-idx_zones_site_code')).toBeNull();

    // Switch to English and verify conflict banner retranslates
    fireEvent.click(screen.getByText('switch-en'));
    expect(
      await screen.findByText('A zone with this code already exists for this site.'),
    ).toBeDefined();

    // Switch back to Vietnamese and submit successfully
    fireEvent.click(screen.getByText('switch-vi'));
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu PPE Khu vực' }));

    await waitFor(() => {
      expect(createZoneSpy).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText(/Đã tạo khu vực "ZONE-NEW-05" thành công/i)).toBeDefined();
  });

  it('renders safe localized 403 access errors for zone list, create, and rename without leaking raw diagnostics', async () => {
    const listZonesSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listZones')
      .mockRejectedValueOnce(new ApiError('http', 'private-zone-list-guard-403', 403))
      .mockResolvedValue({
        items: [sampleZone],
        total: 1,
      });
    vi.spyOn(SmartSiteManagementClient.prototype, 'createZone').mockRejectedValue(
      new ApiError('http', 'private-create-guard-403', 403),
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'renameZone').mockRejectedValue(
      new ApiError('http', 'private-rename-guard-403', 403),
    );

    const { unmount } = render(
      <LocaleProvider defaultLocale="vi">
        <QueryClientProvider client={queryClient}>
          <LocaleToggle />
          <ZonePpeSetupPanel
            apiUrl="http://localhost:3000"
            token="test-token"
            sessionScope="test-scope"
            credentialId={1}
            siteId="site-alpha"
            siteName="Công trường Alpha"
            onClose={mockOnClose}
          />
        </QueryClientProvider>
      </LocaleProvider>,
    );

    expect(
      await screen.findByText(
        'Không thể tải danh sách khu vực đã cấu hình cho công trường này. Quyền truy cập bị từ chối hoặc phiên đã hết hạn.',
      ),
    ).toBeDefined();
    expect(screen.queryByText('private-zone-list-guard-403')).toBeNull();

    fireEvent.click(screen.getByText('switch-en'));
    expect(
      await screen.findByText(
        'Could not load configured zones for this site. Access denied or session expired.',
      ),
    ).toBeDefined();

    unmount();
    window.localStorage.clear();

    // Mount with fresh scope to test create and rename 403 safe errors
    render(
      <LocaleProvider defaultLocale="vi">
        <QueryClientProvider client={queryClient}>
          <LocaleToggle />
          <ZonePpeSetupPanel
            apiUrl="http://localhost:3000"
            token="test-token-2"
            sessionScope="test-scope-2"
            credentialId={2}
            siteId="site-alpha"
            siteName="Công trường Alpha"
            onClose={mockOnClose}
          />
        </QueryClientProvider>
      </LocaleProvider>,
    );

    const renameBtn = await screen.findByRole('button', { name: 'Đổi tên ZONE-HAZ-01' });
    expect(listZonesSpy).toHaveBeenCalledTimes(2);

    // Trigger 403 on create
    fireEvent.change(screen.getByLabelText('Mã khu vực'), { target: { value: 'ZONE-403' } });
    fireEvent.change(screen.getByLabelText('Tên khu vực'), { target: { value: 'Khu vực 403' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu PPE Khu vực' }));

    expect(await screen.findByText('Bạn không có quyền thực hiện thao tác này.')).toBeDefined();
    expect(screen.queryByText('private-create-guard-403')).toBeNull();

    // Trigger 403 on rename
    fireEvent.click(renameBtn);
    const renameInput = await screen.findByLabelText('Tên khu vực mới');
    fireEvent.change(renameInput, { target: { value: 'Tên mới 403' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu tên' }));

    await waitFor(() => {
      expect(screen.getAllByText('Bạn không có quyền thực hiện thao tác này.')).toHaveLength(2);
    });
    expect(screen.queryByText('private-rename-guard-403')).toBeNull();

    // Switch to English: both create and rename 403 banners retranslate in place
    fireEvent.click(screen.getByText('switch-en'));
    expect(
      await screen.findAllByText('You do not have permission to perform this action.'),
    ).toHaveLength(2);
  });
});
