// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import i18n from '../../i18n';
import type { SharedSession } from '../../types/shared-session';
import { RestrictedZoneView, type RestrictedZoneViewProps } from './RestrictedZoneView';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const previewState = vi.hoisted(() => ({
  options: null as { enabled?: boolean } | null,
}));

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: (options?: { enabled?: boolean }) => {
    previewState.options = options ?? null;
    return {
      preview: null,
      status: 'DISCONNECTED' as const,
      sourceKind: null,
      error: null,
      capturedAt: null,
      retry: vi.fn(),
    };
  },
}));

function makeSession(
  roleAssignments: Readonly<SharedSession['user']['roleAssignments']>,
  overrides?: Partial<SharedSession['user']>,
): SharedSession {
  return {
    accessToken: 'scoped-session-token',
    sessionScope: 'scope-zone-handoff',
    user: {
      id: 'user-zone-handoff',
      username: 'operator',
      displayName: 'Site Operator',
      roleAssignments: [...roleAssignments],
      ...overrides,
    },
    onSignOut: vi.fn(),
  };
}

const scopedSiteManagerSession = makeSession([{ role: 'SITE_MANAGER', siteId: 'site-alpha' }]);

const activeClients: QueryClient[] = [];

function mountView(props: RestrictedZoneViewProps) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  activeClients.push(queryClient);
  const ui = (nextProps: RestrictedZoneViewProps) => (
    <QueryClientProvider client={queryClient}>
      <RestrictedZoneView {...nextProps} />
    </QueryClientProvider>
  );
  const view = render(ui(props));
  return {
    ...view,
    queryClient,
    rerenderProps: (nextProps: RestrictedZoneViewProps) => view.rerender(ui(nextProps)),
  };
}

describe('RestrictedZoneView Site Manager Setup Handoff', () => {
  beforeEach(async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
    previewState.options = null;
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    cleanup();
    activeClients.splice(0).forEach((client) => client.clear());
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    previewState.options = null;
    await i18n.changeLanguage('en');
  });

  it('shows the denied observation card with a Camera setup button for a scoped Site Manager when onOpenSetup is supplied and invokes it once without metadata or preview calls', () => {
    const listSitesSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listSites');
    const listCamerasSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras');
    const listPreviewCamerasSpy = vi.spyOn(
      SmartSiteManagementClient.prototype,
      'listPreviewCameras',
    );
    const listRegionsSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions');
    const onOpenSetup = vi.fn();

    mountView({
      sharedSession: scopedSiteManagerSession,
      onOpenSetup,
    });

    expect(screen.getByRole('heading', { name: 'Zone Configuration is restricted' })).toBeTruthy();
    expect(
      screen.getByText(
        'A global Admin role or assigned Site Safety Officer role is required to view restricted zones.',
      ),
    ).toBeTruthy();

    const setupButton = screen.getByRole('button', { name: 'Camera setup' });
    fireEvent.click(setupButton);
    expect(onOpenSetup).toHaveBeenCalledOnce();

    expect(listSitesSpy).not.toHaveBeenCalled();
    expect(listCamerasSpy).not.toHaveBeenCalled();
    expect(listPreviewCamerasSpy).not.toHaveBeenCalled();
    expect(listRegionsSpy).not.toHaveBeenCalled();
    expect(previewState.options?.enabled).toBe(false);
    expect(scopedSiteManagerSession.onSignOut).not.toHaveBeenCalled();
  });

  it('does not render a dead Camera setup button for a scoped Site Manager when onOpenSetup is omitted', () => {
    mountView({
      sharedSession: scopedSiteManagerSession,
    });

    expect(screen.getByRole('heading', { name: 'Zone Configuration is restricted' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Camera setup|Thiết lập camera/i })).toBeNull();
  });

  it.each([
    ['WORKER', [{ role: 'WORKER', siteId: 'site-alpha' }]],
    ['CONTRACTOR_REPRESENTATIVE', [{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-alpha' }]],
    ['SECURITY_OFFICER', [{ role: 'SECURITY_OFFICER', siteId: 'site-alpha' }]],
    ['unscoped SITE_MANAGER', [{ role: 'SITE_MANAGER', siteId: null }]],
  ] as const)(
    'does not offer the Camera setup action to %s even when onOpenSetup is supplied',
    (_label, roles) => {
      const onOpenSetup = vi.fn();
      mountView({
        sharedSession: makeSession(roles),
        onOpenSetup,
      });

      expect(
        screen.getByRole('heading', { name: 'Zone Configuration is restricted' }),
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Camera setup|Thiết lập camera/i })).toBeNull();
      expect(onOpenSetup).not.toHaveBeenCalled();
    },
  );

  it('clears the Camera setup action when the shared session becomes null or requires a password change', () => {
    const onOpenSetup = vi.fn();
    const { rerenderProps } = mountView({
      sharedSession: scopedSiteManagerSession,
      onOpenSetup,
    });

    expect(screen.getByRole('button', { name: 'Camera setup' })).toBeTruthy();

    rerenderProps({
      sharedSession: null,
      onOpenSetup,
    });

    expect(screen.getByRole('heading', { name: 'Session pending or expired' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Camera setup|Thiết lập camera/i })).toBeNull();

    rerenderProps({
      sharedSession: makeSession([{ role: 'SITE_MANAGER', siteId: 'site-alpha' }], {
        mustChangePassword: true,
      }),
      onOpenSetup,
    });

    expect(screen.queryByRole('button', { name: /Camera setup|Thiết lập camera/i })).toBeNull();
  });

  it('translates the denied card and cameraSetup.title handoff button between English and Vietnamese', async () => {
    const onOpenSetup = vi.fn();
    mountView({
      sharedSession: scopedSiteManagerSession,
      onOpenSetup,
    });

    expect(screen.getByRole('heading', { name: 'Zone Configuration is restricted' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Camera setup' })).toBeTruthy();

    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    expect(screen.getByRole('heading', { name: 'Cấu hình Khu vực bị hạn chế' })).toBeTruthy();
    expect(
      screen.getByText(
        'Cần vai trò Quản trị viên toàn hệ thống (Admin) hoặc Cán bộ an toàn tại công trường được phân công để xem khu vực hạn chế.',
      ),
    ).toBeTruthy();

    const viSetupButton = screen.getByRole('button', { name: 'Thiết lập camera' });
    fireEvent.click(viSetupButton);
    expect(onOpenSetup).toHaveBeenCalledOnce();
  });
});
