// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import { CameraSetupView } from './CameraSetupView';

const mocks = vi.hoisted(() => ({ listSites: vi.fn(), listCameras: vi.fn() }));
vi.mock('../../features/auth/auth-session', () => ({ useManagementClient: () => mocks }));
vi.mock('./CameraRegistrationDialog', () => ({ CameraRegistrationDialog: () => null }));
vi.mock('./CameraManagementDialog', () => ({ CameraManagementDialog: () => null }));
vi.mock('../ppe/ZonePpeSetupDialog', () => ({ ZonePpeSetupDialog: () => null }));
const site = {
  id: 'site-1',
  code: 'S1',
  name: 'Synthetic Site',
  createdAt: '2026-10-18T00:00:00Z',
};
const camera = {
  id: 'cam-1',
  siteId: site.id,
  code: 'C1',
  name: 'Synthetic Camera',
  externalId: 'synthetic-source',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: site.createdAt,
};
const count = '1 shown · 2 returned by the catalog';
const linkedHint =
  'The linked camera is not on the loaded pages. Load more cameras to look for it.';
let cache: QueryClient;

function mount() {
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={['/camera-setup?siteId=site-1&cameraId=cam-2']}>
        <CameraSetupView
          apiUrl="http://localhost:3000"
          sharedSession={{
            accessToken: 'synthetic-token',
            sessionScope: 'synthetic-scope',
            user: {
              id: 'manager-1',
              displayName: 'Synthetic Manager',
              roleAssignments: [{ role: 'SITE_MANAGER', siteId: site.id }],
            },
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.listSites.mockReset().mockResolvedValue({ items: [site], total: 1 });
  mocks.listCameras.mockReset().mockResolvedValueOnce({ items: [camera], total: 2 });
});
afterEach(() => {
  cleanup();
  cache?.clear();
});

it('retains loaded count and linked-camera guidance after a transient next-page failure', async () => {
  mocks.listCameras.mockRejectedValueOnce(new Error('Synthetic network failure'));
  mocks.listCameras.mockResolvedValueOnce({
    items: [{ ...camera, id: 'cam-2', name: 'Linked Camera' }],
    total: 2,
  });
  mount();
  await screen.findByText(count);
  expect(screen.getByText(linkedHint)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Load more cameras' }));
  await screen.findByText('Could not load configuration. Please try again.');
  expect(screen.getByText(camera.name)).toBeTruthy();
  expect(screen.getByText(count)).toBeTruthy();
  expect(screen.queryByText(linkedHint)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Load more cameras' }));
  const linkedCameraHeading = await screen.findByText('Linked Camera');
  expect(linkedCameraHeading.closest('li')?.getAttribute('aria-current')).toBe('true');
  expect(mocks.listCameras.mock.calls.map((call) => call[2].offset)).toEqual([0, 1, 1]);
  expect(screen.queryByText(linkedHint)).toBeNull();
});

it('hides retained camera metadata and guidance when the next-page failure revokes access', async () => {
  mocks.listCameras.mockRejectedValueOnce(new ApiError('http', 'Synthetic denied', 403));
  mount();
  await screen.findByText(count);
  fireEvent.click(screen.getByRole('button', { name: 'Load more cameras' }));
  await screen.findByText('Configuration access is unavailable for this scope.');
  await waitFor(() => expect(screen.queryByText(camera.name)).toBeNull());
  expect(screen.queryByText(count)).toBeNull();
  expect(screen.queryByText(linkedHint)).toBeNull();
});
