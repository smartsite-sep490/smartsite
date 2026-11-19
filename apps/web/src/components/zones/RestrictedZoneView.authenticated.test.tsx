// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { RestrictedZoneView } from './RestrictedZoneView';
import type { LoginResponse } from '@smartsite/api-client';

const siteId = '11111111-1111-4111-8111-111111111111';
const cameraId = '22222222-2222-4222-8222-222222222222';
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
vi.mock('../ppe/FocusedCameraMedia', () => ({
  FocusedCameraMedia: ({
    siteId,
    camera,
    observationMode,
  }: {
    siteId: string;
    camera: { id: string };
    observationMode: string;
  }) => (
    <div data-testid="authenticated-zone-camera">
      {siteId}:{camera.id}:{observationMode}
    </div>
  ),
}));
vi.mock('../../features/auth/auth-session', () => ({
  useManagementClient: () => ({
    listSites: async () => ({
      items: [{ id: siteId, code: 'LOCAL', name: 'Local Site' }],
      total: 1,
    }),
    listCameras: async () => ({
      items: [
        {
          id: cameraId,
          siteId,
          code: 'LAPTOP',
          name: 'Laptop',
          externalId: 'camera-a',
          status: 'ACTIVE',
          configurationVersion: 2,
        },
      ],
      total: 1,
    }),
    listRegions: async () => ({ items: [], total: 0 }),
    listZones: async () => ({ items: [], total: 0 }),
  }),
}));
afterEach(cleanup);

it('uses authenticated scoped media when opening /zones from the menu without deep-link parameters', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const session = {
    accessToken: 'local-officer',
    user: {
      id: 'officer-1',
      username: 'officer',
      displayName: 'Officer',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'SAFETY_OFFICER', siteId }],
    },
  } as Pick<LoginResponse, 'accessToken' | 'user'>;
  const { container, unmount } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RestrictedZoneView apiUrl="http://api.invalid" authenticatedSession={session} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  try {
    expect((await screen.findByTestId('authenticated-zone-camera')).textContent).toBe(
      `${siteId}:${cameraId}:zone`,
    );
    expect(
      container.querySelector('video[src="/assets/hazard_restricted_zone_test.mp4"]'),
    ).toBeNull();
  } finally {
    unmount();
    client.clear();
  }
});
