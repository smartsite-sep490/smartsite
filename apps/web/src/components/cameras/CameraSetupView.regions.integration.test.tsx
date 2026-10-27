// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { changeUiLanguage } from '../../i18n/runtime';
import { CameraSetupView } from './CameraSetupView';

const mocks = vi.hoisted(() => ({ client: null as SmartSiteManagementClient | null }));
vi.mock('../../features/auth/auth-session', () => ({ useManagementClient: () => mocks.client }));
const site = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'SITE',
  name: 'Synthetic Site',
  createdAt: '2026-10-17T00:00:00Z',
};
const zone = {
  id: '22222222-2222-4222-8222-222222222222',
  siteId: site.id,
  code: 'AREA',
  name: 'Work area',
  type: 'HAZARDOUS' as const,
  restrictionPolicy: 'NONE' as const,
  requiredPpe: ['HARD_HAT'],
  configurationLocked: false,
  createdAt: site.createdAt,
};
const camera = {
  id: '33333333-3333-4333-8333-333333333333',
  siteId: site.id,
  code: 'GATE',
  name: 'Gate camera',
  externalId: 'synthetic-camera',
  status: 'ACTIVE' as const,
  configurationVersion: 1,
  createdAt: site.createdAt,
};
let cache: QueryClient;
beforeEach(() => {
  changeUiLanguage('en');
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network in DOM journey')));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mocks.client = new SmartSiteManagementClient('https://api.example.test');
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [site],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({
    items: [camera],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
    items: [zone],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraApplicationStatus').mockResolvedValue({
    siteId: site.id,
    cameraId: camera.id,
    desiredRevision: camera.configurationVersion,
    reportedRevision: null,
    applicationState: 'UNCONFIRMED',
    viewValidity: 'UNCONFIRMED',
    observedAt: new Date(site.createdAt).toISOString(),
    lastReceiptAt: null,
    reasonCode: 'NO_APPLICATION_RECEIPT',
  });
  for (const method of [
    'getCameraPreview',
    'getCameraConfigurationImage',
    'getCameraConfigurationReference',
    'streamCameraVideo',
    'readRecordedCameraVideo',
    'getMf05DemoStatus',
    'applyMf05DemoRegion',
  ] as const) {
    vi.spyOn(SmartSiteManagementClient.prototype, method);
  }
});
afterEach(() => {
  cleanup();
  cache.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function mount() {
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <CameraSetupView
          apiUrl="https://api.example.test"
          sharedSession={{
            accessToken: 'synthetic-token',
            sessionScope: 'setup-session',
            user: {
              id: 'manager',
              displayName: 'Manager',
              roleAssignments: [{ role: 'SITE_MANAGER', siteId: site.id }],
            },
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function expectNoMediaWork() {
  for (const method of [
    'getCameraPreview',
    'getCameraConfigurationImage',
    'getCameraConfigurationReference',
    'streamCameraVideo',
    'readRecordedCameraVideo',
    'getMf05DemoStatus',
    'applyMf05DemoRegion',
  ] as const) {
    expect(SmartSiteManagementClient.prototype[method]).not.toHaveBeenCalled();
  }
  expect(fetch).not.toHaveBeenCalled();
}

it('opens the actual policy writer without mounting the Region writer or camera queries again', async () => {
  mount();
  await screen.findByText(camera.name);
  fireEvent.click(screen.getByRole('button', { name: 'Configure PPE by Zone' }));
  const dialog = screen.getByRole('dialog', { name: 'Zone PPE configuration' });
  expect(await within(dialog).findByText(zone.name)).toBeTruthy();
  expect(within(dialog).getByRole('textbox', { name: 'Zone Code' })).toBeTruthy();
  expect(within(dialog).queryByRole('combobox', { name: 'Select Camera' })).toBeNull();
  expect(SmartSiteManagementClient.prototype.listCameras).toHaveBeenCalledOnce();
  expect(SmartSiteManagementClient.prototype.listRegions).not.toHaveBeenCalled();
  expectNoMediaWork();
});

it('opens the existing Region writer with metadata only and requires explicit configuration-image action while AI is paused', async () => {
  mount();
  await screen.findByText(camera.name);
  fireEvent.click(screen.getByRole('button', { name: 'Link observation regions' }));
  const dialog = screen.getByRole('dialog', { name: 'Link Zone to Camera Region' });
  const draw = await within(dialog).findByRole('button', { name: /Start Drawing Region/i });
  expect(
    within(dialog).getAllByRole('heading', { name: 'Link Zone to Camera Region' }),
  ).toHaveLength(1);
  expect(
    within(dialog).getAllByRole('region', { name: 'Link Zone to Camera Region' }),
  ).toHaveLength(1);
  expect(draw).toHaveProperty('disabled', true);
  expect(within(dialog).getByRole('button', { name: /Get configuration image/i })).toBeTruthy();
  expect(within(dialog).queryByRole('textbox', { name: 'Zone Code' })).toBeNull();
  expect(SmartSiteManagementClient.prototype.listZones).toHaveBeenCalledOnce();
  expectNoMediaWork();
});
