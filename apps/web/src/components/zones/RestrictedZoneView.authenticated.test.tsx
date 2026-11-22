// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

it('renders full-width authenticated workspace without fake Admin banner or duplicate Sign-out, with 40px controls and role-aware camera-setup handoff', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const onNavigate = vi.fn();
  const officerSession = {
    accessToken: 'local-officer',
    user: {
      id: 'officer-1',
      username: 'demo.safety',
      displayName: 'Cán bộ an toàn demo',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [
        { role: 'SAFETY_OFFICER', siteId },
        { role: 'ADMIN', siteId: null },
      ],
    },
  } as Pick<LoginResponse, 'accessToken' | 'user'>;

  const { rerender, unmount } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RestrictedZoneView
          apiUrl="http://api.invalid"
          authenticatedSession={officerSession}
          onNavigate={onNavigate}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  try {
    await screen.findByTestId('authenticated-zone-camera');
    const root = screen.getByTestId('restricted-zone-fullwidth-workspace');
    expect(root.className).toContain('w-full');
    expect(root.className).not.toContain('max-w-[1202px]');
    expect(root.className).not.toContain('mx-auto');

    // Never claim Global Admin session, internal backend jargon, or render duplicate inline Sign-out button
    expect(screen.queryByText(/Admin Session Active|PHIÊN QUẢN TRỊ VIÊN/i)).toBeNull();
    expect(
      screen.queryByText(/Global Admin role verified|quyền quản trị viên hệ thống/i),
    ).toBeNull();
    expect(screen.queryByText(/Backend evaluation required|Cần backend xét quyền/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Sign out|Đăng xuất/i })).toBeNull();

    // Real 24px h1 + unified single-row 40px selects + fullscreen toggle + role-gated /camera-setup link
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    const selects = document.querySelectorAll('select');
    expect(selects.length).toBe(3);
    for (const select of selects) {
      const visibleControl = select.parentElement!;
      expect(visibleControl.querySelector('[data-select-value]')).toBeTruthy();
      expect(visibleControl.className).toContain('h-10');
      expect(visibleControl.className).toContain('min-h-10');
      expect(visibleControl.className).toContain('text-sm');
    }
    expect(screen.getByTestId('zones-fullscreen-toggle')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Camera setup|Thiết lập camera/i })).toBeNull();

    // Site Manager sees scoped /camera-setup handoff link
    const managerSession = {
      accessToken: 'local-manager',
      user: {
        id: 'manager-1',
        username: 'demo.manager',
        displayName: 'Quản lý công trường demo',
        isActive: true,
        mustChangePassword: false,
        roleAssignments: [{ role: 'SITE_MANAGER', siteId }],
      },
    } as Pick<LoginResponse, 'accessToken' | 'user'>;

    rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RestrictedZoneView
            apiUrl="http://api.invalid"
            authenticatedSession={managerSession}
            onNavigate={onNavigate}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      const setupLink = screen.getByRole('link', { name: /Camera setup|Thiết lập camera/i });
      expect(setupLink.getAttribute('href')).toContain(`/camera-setup?siteId=${siteId}`);
    });
  } finally {
    unmount();
    client.clear();
  }
});
