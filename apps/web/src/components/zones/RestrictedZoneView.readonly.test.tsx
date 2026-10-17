// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RestrictedZoneView } from './RestrictedZoneView';
import type { SharedSession } from '../../types/shared-session';

const siteId = '22222222-2222-4222-8222-222222222222';
const cameraId = '33333333-3333-4333-8333-333333333333';
const mocks = vi.hoisted(() => ({
  listSites: vi.fn(),
  listPreviewCameras: vi.fn(),
  listRegions: vi.fn(),
  updatePolygon: vi.fn(),
}));
vi.mock('../../features/auth/auth-session', () => ({
  useAuth: () => ({ triggerSessionExpired: vi.fn() }),
  useManagementClient: () => mocks,
}));
vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: () => ({
    preview: null,
    status: 'UNAVAILABLE',
    error: null,
    errorStatus: null,
    sourceKind: null,
    capturedAt: null,
  }),
}));
const caches: QueryClient[] = [];
beforeEach(() => {
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mocks.listSites.mockResolvedValue({
    items: [{ id: siteId, code: 'SITE', name: 'Synthetic Site' }],
    total: 1,
  });
  mocks.listPreviewCameras.mockResolvedValue({
    items: [
      {
        id: cameraId,
        siteId,
        externalId: 'camera',
        code: 'CAM',
        name: 'Gate',
        configurationVersion: 1,
        status: 'ACTIVE',
      },
    ],
    total: 1,
  });
  mocks.listRegions.mockResolvedValue({ items: [], total: 0 });
});
afterEach(() => {
  cleanup();
  for (const cache of caches.splice(0)) cache.clear();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function mount(
  roles: SharedSession['user']['roleAssignments'],
  onOpenSetup?: (context?: { siteId: string; cameraId?: string }) => void,
) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  caches.push(cache);
  render(
    <QueryClientProvider client={cache}>
      <RestrictedZoneView
        onOpenSetup={onOpenSetup}
        sharedSession={{
          accessToken: 'synthetic-token',
          sessionScope: 'synthetic-scope',
          user: { id: 'reviewer', displayName: 'Reviewer', roleAssignments: roles },
        }}
      />
    </QueryClientProvider>,
  );
}
it('keeps authenticated Admin monitoring read-only and routes configuration to existing setup', async () => {
  mount([{ role: 'ADMIN', siteId: null }]);
  await screen.findByRole('option', { name: /Gate/ });
  expect(screen.queryByRole('button', { name: /Edit Zone/i })).toBeNull();
  expect(
    screen.queryByRole('button', { name: /Save to Backend|Save Local Draft|Export Draft/i }),
  ).toBeNull();
  expect(mocks.listRegions).not.toHaveBeenCalled();
  expect(mocks.updatePolygon).not.toHaveBeenCalled();
  const link = await screen.findByRole('link', { name: 'Camera setup' });
  expect(link.getAttribute('href')).toBe(`/camera-setup?siteId=${siteId}&cameraId=${cameraId}`);
});
it('prevents full-page reload on normal click and delegates loaded site and camera IDs to onOpenSetup', async () => {
  const onOpenSetup = vi.fn<(context?: { siteId: string; cameraId?: string }) => void>();
  mount([{ role: 'ADMIN', siteId: null }], onOpenSetup);
  await screen.findByRole('option', { name: /Gate/ });
  const link = await screen.findByRole('link', { name: 'Camera setup' });
  expect(link.getAttribute('href')).toBe(`/camera-setup?siteId=${siteId}&cameraId=${cameraId}`);
  expect(fireEvent.click(link)).toBe(false);
  expect(onOpenSetup).toHaveBeenCalledOnce();
  expect(onOpenSetup).toHaveBeenCalledWith({ siteId, cameraId });
  expect(mocks.listRegions).not.toHaveBeenCalled();
  expect(mocks.updatePolygon).not.toHaveBeenCalled();
});
it('preserves native browser tab navigation on modified click without invoking onOpenSetup', async () => {
  const onOpenSetup = vi.fn<(context?: { siteId: string; cameraId?: string }) => void>();
  mount([{ role: 'ADMIN', siteId: null }], onOpenSetup);
  await screen.findByRole('option', { name: /Gate/ });
  const link = await screen.findByRole('link', { name: 'Camera setup' });
  expect(link.getAttribute('href')).toBe(`/camera-setup?siteId=${siteId}&cameraId=${cameraId}`);
  expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
  expect(fireEvent.click(link, { metaKey: true })).toBe(true);
  expect(fireEvent.click(link, { shiftKey: true })).toBe(true);
  expect(fireEvent.click(link, { altKey: true })).toBe(true);
  expect(fireEvent.click(link, { button: 1 })).toBe(true);
  expect(onOpenSetup).not.toHaveBeenCalled();
});
it('respects a click already cancelled by another handler', async () => {
  const onOpenSetup = vi.fn();
  mount([{ role: 'ADMIN', siteId: null }], onOpenSetup);
  const link = await screen.findByRole('link', { name: 'Camera setup' });
  link.addEventListener('click', (event) => event.preventDefault(), { once: true });
  expect(fireEvent.click(link)).toBe(false);
  expect(onOpenSetup).not.toHaveBeenCalled();
});
it('does not turn scoped Safety monitoring into configuration-write access', async () => {
  mount([{ role: 'SAFETY_OFFICER', siteId }]);
  await screen.findByRole('option', { name: /Gate/ });
  expect(screen.queryByRole('link', { name: 'Camera setup' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Edit Zone/i })).toBeNull();
  expect(mocks.updatePolygon).not.toHaveBeenCalled();
});
it('offers setup only for the selected Site Manager role without granting inference permissions', async () => {
  mount([
    { role: 'SAFETY_OFFICER', siteId },
    { role: 'SITE_MANAGER', siteId },
  ]);
  const link = await screen.findByRole('link', { name: 'Camera setup' });
  expect(new URL(link.getAttribute('href')!, 'http://localhost').searchParams.get('siteId')).toBe(
    siteId,
  );
  expect(screen.queryByRole('button', { name: /Save to Backend/i })).toBeNull();
  expect(mocks.listRegions).not.toHaveBeenCalled();
});
