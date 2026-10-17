// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import '../cameras/camera-setup-catalog';
import { CameraSetupWorkflow } from '../cameras/CameraSetupWorkflow';
import { ZonePpeSetupDialog } from './ZonePpeSetupDialog';

vi.mock('./ZonePpeCameraRegionPanel', () => ({
  ZonePpeCameraRegionPanel: () => <div>Region configuration</div>,
}));

const baseProps = {
  canManageZones: true,
  canManageRegions: true,
  apiUrl: 'http://localhost:3000',
  token: 'token-one',
  sessionScope: 'session-one',
  credentialId: 1,
  siteId: 'site-one',
  siteName: 'North Site',
  onClose: () => {},
};

let queryClient: QueryClient;

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network in DOM test')));
  window.localStorage.clear();
  await i18n.changeLanguage('en');
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
    items: [],
    total: 0,
  });
});

afterEach(async () => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('Zone task copy and workflow landmark alignment', () => {
  it('describes zones-only dialog scope without promising camera regions while keeping legacy all description', async () => {
    const view = render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeSetupDialog {...baseProps} section="zones" />
      </QueryClientProvider>,
    );

    const zonesDialog = screen.getByRole('dialog', { name: 'Zone PPE configuration' });
    expect(zonesDialog.textContent).toContain('North Site');
    expect(zonesDialog.textContent).not.toMatch(/camera regions/i);

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    const viZonesDialog = screen.getByRole('dialog', { name: 'Cấu hình PPE Khu vực' });
    expect(viZonesDialog.textContent).toContain('North Site');
    expect(viZonesDialog.textContent).not.toMatch(/vùng quan sát camera/i);

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ZonePpeSetupDialog {...baseProps} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Define requirements and camera regions for North Site.')).toBeTruthy();
  });

  it('shows truthful zone creation feedback without referencing nonexistent Zone Settings or AI activation claims', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'createZone').mockResolvedValue({
      id: 'zone-1',
      siteId: 'site-one',
      code: 'ZONE-A',
      name: 'Assembly Area',
      type: 'HAZARDOUS',
      restrictionPolicy: 'NONE',
      requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
      configurationLocked: false,
      createdAt: '2026-10-17T00:00:00Z',
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeSetupDialog {...baseProps} section="zones" />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Zone Code' }), {
      target: { value: 'ZONE-A' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Zone Name' }), {
      target: { value: 'Assembly Area' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Zone PPE' }));

    const status = (await screen.findByText(/Zone "ZONE-A" created successfully/)).closest(
      '[role="status"]',
    )!;
    expect(status.textContent).toContain('Zone "ZONE-A" created successfully.');
    expect(status.textContent).toMatch(/observation region/i);
    expect(status.textContent).not.toMatch(/Zone Settings/i);
    expect(status.textContent).not.toMatch(/AI monitoring can apply/i);

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    const viStatus = screen
      .getByText(/Đã tạo khu vực "ZONE-A" thành công/)
      .closest('[role="status"]')!;
    expect(viStatus.textContent).toContain('Đã tạo khu vực "ZONE-A" thành công.');
    expect(viStatus.textContent).toMatch(/vùng quan sát/i);
    expect(viStatus.textContent).not.toMatch(/Thiết lập Khu vực/i);
    expect(viStatus.textContent).not.toMatch(/áp dụng giám sát AI/i);
  });

  it('aligns the CameraSetupWorkflow section landmark label with its visible workflowTitle heading', async () => {
    render(
      <CameraSetupWorkflow canWriteZones canReadZones={false} canManageCameras open={vi.fn()} />,
    );

    const region = screen.getByRole('region', { name: 'Setup steps' });
    expect(within(region).getByRole('heading', { name: 'Setup steps' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Areas & PPE' })).toBeNull();

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    const viRegion = screen.getByRole('region', { name: 'Thứ tự thiết lập' });
    expect(within(viRegion).getByRole('heading', { name: 'Thứ tự thiết lập' })).toBeTruthy();
  });
});
