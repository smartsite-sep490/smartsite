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
    expect(onOpenSetup).toHaveBeenCalledWith({ siteId: 'site-alpha' });

    expect(listSitesSpy).not.toHaveBeenCalled();
    expect(listCamerasSpy).not.toHaveBeenCalled();
    expect(listPreviewCamerasSpy).not.toHaveBeenCalled();
    expect(listRegionsSpy).not.toHaveBeenCalled();
    expect(previewState.options?.enabled).toBe(false);
    expect(scopedSiteManagerSession.onSignOut).not.toHaveBeenCalled();
  });

  it('forwards matching initialSelection site and camera for a multi-site Site Manager and omits guessed site when initialSelection is absent', () => {
    const onOpenSetup = vi.fn();
    const multiSiteManager = makeSession([
      { role: 'SITE_MANAGER', siteId: 'site-alpha' },
      { role: 'SITE_MANAGER', siteId: 'site-beta' },
    ]);

    const { rerenderProps } = mountView({
      sharedSession: multiSiteManager,
      initialSelection: { siteId: 'site-beta', cameraId: 'cam-2' },
      onOpenSetup,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Camera setup' }));
    expect(onOpenSetup).toHaveBeenLastCalledWith({ siteId: 'site-beta', cameraId: 'cam-2' });

    rerenderProps({
      sharedSession: multiSiteManager,
      onOpenSetup,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Camera setup' }));
    expect(onOpenSetup).toHaveBeenLastCalledWith();
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
    expect(onOpenSetup).toHaveBeenCalledWith({ siteId: 'site-alpha' });
  });

  it('preserves non-first linked siteId and cameraId when returning from Camera setup and scopes MF06 assessment reads to that site', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [
        { id: 'site-1', code: 'SITE-1', name: 'Alpha', createdAt: '2026-10-01T00:00:00Z' },
        { id: 'site-2', code: 'SITE-2', name: 'Beta', createdAt: '2026-10-01T00:00:00Z' },
      ],
      total: 2,
    });
    const listPreviewCamerasSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras')
      .mockResolvedValue({
        items: [
          {
            id: 'cam-1',
            siteId: 'site-2',
            externalId: 'ext-1',
            code: 'CAM-1',
            name: 'North Gate',
            configurationVersion: 1,
            status: 'ACTIVE',
            createdAt: '2026-10-01T00:00:00Z',
          },
          {
            id: 'cam-2',
            siteId: 'site-2',
            externalId: 'ext-2',
            code: 'CAM-2',
            name: 'South Crane',
            configurationVersion: 2,
            status: 'ACTIVE',
            createdAt: '2026-10-01T00:00:00Z',
          },
        ],
        total: 2,
      });
    const listAssessmentsSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listMf06Assessments')
      .mockResolvedValue({ items: [], total: 0, offset: 0, limit: 20 });

    mountView({
      sharedSession: makeSession([{ role: 'ADMIN', siteId: null }]),
      initialSelection: { siteId: 'site-2', cameraId: 'cam-2' },
      onOpenSetup: vi.fn(),
    });

    await screen.findByRole('option', { name: 'CAM-2 · South Crane (v2)' });
    expect((screen.getByLabelText('Site') as HTMLSelectElement).value).toBe('site-2');
    expect((screen.getByLabelText('Camera') as HTMLSelectElement).value).toBe('cam-2');
    expect(screen.getByRole('link', { name: 'Camera setup' }).getAttribute('href')).toBe(
      '/camera-setup?siteId=site-2&cameraId=cam-2',
    );
    expect(listPreviewCamerasSpy).toHaveBeenCalledWith(
      'scoped-session-token',
      'site-2',
      expect.any(Object),
      expect.any(Object),
    );
    expect(listPreviewCamerasSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      'site-1',
      expect.anything(),
      expect.anything(),
    );
    expect(listAssessmentsSpy).toHaveBeenCalledWith(
      'scoped-session-token',
      'site-2',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('holds linked camera selection across pages without starting first-camera preview until Load more cameras resolves it', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [{ id: 'site-1', code: 'SITE-1', name: 'Alpha', createdAt: '2026-10-01T00:00:00Z' }],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras')
      .mockResolvedValueOnce({
        items: [
          {
            id: 'cam-1',
            siteId: 'site-1',
            externalId: 'ext-1',
            code: 'CAM-1',
            name: 'First Camera',
            configurationVersion: 1,
            status: 'ACTIVE',
            createdAt: '2026-10-01T00:00:00Z',
          },
        ],
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'cam-2',
            siteId: 'site-1',
            externalId: 'ext-2',
            code: 'CAM-2',
            name: 'Second Camera',
            configurationVersion: 3,
            status: 'ACTIVE',
            createdAt: '2026-10-01T00:00:00Z',
          },
        ],
        total: 2,
      });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listMf06Assessments').mockResolvedValue({
      items: [],
      total: 0,
      offset: 0,
      limit: 20,
    });

    mountView({
      sharedSession: makeSession([{ role: 'ADMIN', siteId: null }]),
      initialSelection: { siteId: 'site-1', cameraId: 'cam-2' },
    });

    const loadMoreBtn = await screen.findByRole('button', { name: 'Load more cameras' });
    const cameraSelect = screen.getByLabelText('Camera') as HTMLSelectElement;
    expect(cameraSelect.value).toBe('');
    expect(previewState.options?.enabled).toBe(false);
    expect(
      screen.getByText(
        'The linked selection is not in the loaded list. Load more or choose an available item.',
      ),
    ).toBeTruthy();

    fireEvent.click(loadMoreBtn);
    await screen.findByRole('option', { name: 'CAM-2 · Second Camera (v3)' });
    expect(cameraSelect.value).toBe('cam-2');
    expect(previewState.options?.enabled).toBe(true);
  });

  it('holds linked site selection across pages without querying first-site cameras or assessments until Load more sites resolves it', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites')
      .mockResolvedValueOnce({
        items: [{ id: 'site-1', code: 'SITE-1', name: 'Alpha', createdAt: '2026-10-01T00:00:00Z' }],
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'site-2', code: 'SITE-2', name: 'Beta', createdAt: '2026-10-01T00:00:00Z' }],
        total: 2,
      });
    const listPreviewCamerasSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras')
      .mockResolvedValue({
        items: [
          {
            id: 'cam-2',
            siteId: 'site-2',
            externalId: 'ext-2',
            code: 'CAM-2',
            name: 'Beta Camera',
            configurationVersion: 1,
            status: 'ACTIVE',
            createdAt: '2026-10-01T00:00:00Z',
          },
        ],
        total: 1,
      });
    const listAssessmentsSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listMf06Assessments')
      .mockResolvedValue({
        items: [],
        total: 0,
        offset: 0,
        limit: 20,
      });

    mountView({
      sharedSession: makeSession([{ role: 'ADMIN', siteId: null }]),
      initialSelection: { siteId: 'site-2', cameraId: 'cam-2' },
    });

    const loadMoreSitesBtn = await screen.findByRole('button', { name: 'Load more sites' });
    const siteSelect = screen.getByLabelText('Site') as HTMLSelectElement;
    expect(siteSelect.value).toBe('');
    expect(listPreviewCamerasSpy).not.toHaveBeenCalled();
    expect(listAssessmentsSpy).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'The linked selection is not in the loaded list. Load more or choose an available item.',
      ),
    ).toBeTruthy();

    fireEvent.click(loadMoreSitesBtn);
    await screen.findByRole('option', { name: 'CAM-2 · Beta Camera (v1)' });
    expect(siteSelect.value).toBe('site-2');
    expect((screen.getByLabelText('Camera') as HTMLSelectElement).value).toBe('cam-2');
    expect(listPreviewCamerasSpy).toHaveBeenCalledWith(
      'scoped-session-token',
      'site-2',
      expect.any(Object),
      expect.any(Object),
    );
    expect(listAssessmentsSpy).toHaveBeenCalledWith(
      'scoped-session-token',
      'site-2',
      expect.any(Object),
      expect.any(Object),
    );
  });
});
