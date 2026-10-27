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

  it('aligns the CameraSetupWorkflow compact toolbar and default-closed help details with its workflowTitle list label', async () => {
    render(
      <CameraSetupWorkflow canWriteZones canReadZones={false} canManageCameras open={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: 'Register camera' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Configure PPE by Zone' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Link observation regions' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Areas & PPE' })).toBeNull();

    const helpSummary = screen.getByText('Setup guide').closest('summary');
    const helpDetails = helpSummary?.parentElement;
    if (!(helpDetails instanceof HTMLDetailsElement) || !helpSummary) {
      throw new Error('Expected native details/summary for setup help.');
    }
    expect(helpDetails.open).toBe(false);
    fireEvent.click(helpSummary);
    expect(helpDetails.open).toBe(true);

    const stepList = within(helpDetails).getByRole('list', { name: 'Four-stage setup reference' });
    expect(within(stepList).getAllByRole('listitem')).toHaveLength(4);
    expect(within(helpDetails).queryByRole('button')).toBeNull();

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(helpDetails.open).toBe(true);
    expect(screen.getByText('Hướng dẫn thiết lập').closest('summary')).toBe(helpSummary);
    expect(
      within(helpDetails).getByRole('list', { name: 'Tham chiếu 4 bước thiết lập' }),
    ).toBeTruthy();
  });
});
