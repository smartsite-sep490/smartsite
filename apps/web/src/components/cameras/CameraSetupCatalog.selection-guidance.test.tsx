// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranslation } from 'react-i18next';
import type { Page } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import { changeUiLanguage, SAFETY_NAMESPACE } from '../../i18n/runtime';
import { deriveZonePpeCapabilities } from '../ppe/zone-ppe-scope';
import './camera-setup-catalog';
import { CameraSetupCatalog } from './CameraSetupCatalog';
import { useSetupCatalog } from './useSetupCatalog';

const SITE_ID = 'site-1';

const activeCamera: CameraResponse = {
  id: 'cam-active-1',
  siteId: SITE_ID,
  code: 'C1',
  name: 'Gate camera',
  externalId: 'private-source-alias-1',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-10-16T00:00:00Z',
};

const secondActiveCamera: CameraResponse = {
  ...activeCamera,
  id: 'cam-active-2',
  code: 'C2',
  name: 'North_Crane_Telemetry_Stream_Identifier_Without_Spaces_0002',
  externalId: 'private-source-alias-2',
  status: 'ACTIVE',
  configurationVersion: 1,
};

const inactiveCamera: CameraResponse = {
  ...activeCamera,
  id: 'cam-inactive-3',
  code: 'C3',
  name: 'Perimeter camera',
  externalId: 'private-source-alias-3',
  status: 'INACTIVE',
  configurationVersion: 2,
};

type RoleUser = {
  roleAssignments: ReadonlyArray<{ role: string; siteId: string | null }>;
  mustChangePassword?: boolean;
};

const managerUser: RoleUser = { roleAssignments: [{ role: 'SITE_MANAGER', siteId: SITE_ID }] };
const activeClients: QueryClient[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type HarnessProps = {
  user?: RoleUser | null;
  siteId?: string;
  requestedCameraId?: string | null;
  load: (offset: number, signal: AbortSignal) => Promise<Page<CameraResponse>>;
  open: (kind: 'register' | 'manage' | 'zones' | 'regions', cameraId?: string) => void;
};

function CatalogHarness({
  user = managerUser,
  siteId = SITE_ID,
  requestedCameraId = null,
  load,
  open,
}: HarnessProps) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const capabilities = deriveZonePpeCapabilities(user, siteId);
  const canReadCameras = Boolean(
    user &&
    !user.mustChangePassword &&
    siteId &&
    user.roleAssignments.some(
      ({ role, siteId: assignedSiteId }) =>
        (role === 'ADMIN' && assignedSiteId === null) ||
        (assignedSiteId === siteId && ['SITE_MANAGER', 'SAFETY_OFFICER'].includes(role)),
    ),
  );
  const cameras = useSetupCatalog<CameraResponse>(
    ['camera-setup-catalog-guidance', siteId],
    canReadCameras,
    load,
  );
  const rows = cameras.rows.filter((row) => row.siteId === siteId);
  const errorKey =
    cameras.status === 403 || cameras.status === 404
      ? 'cameraSetup.forbidden'
      : 'cameraSetup.error';
  return (
    <CameraSetupCatalog
      capabilities={capabilities}
      canReadCameras={canReadCameras}
      cameras={cameras}
      rows={rows}
      requestedCameraId={requestedCameraId}
      cameraError={cameras.error ? <div role="alert">{t(errorKey)}</div> : null}
      open={open}
    />
  );
}

function mountCatalog(
  options?: Partial<Pick<HarnessProps, 'user' | 'siteId' | 'requestedCameraId' | 'load'>>,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  activeClients.push(client);
  const load =
    options?.load ??
    vi.fn().mockResolvedValue({
      items: [activeCamera, secondActiveCamera, inactiveCamera],
      total: 3,
    });
  const open =
    vi.fn<(kind: 'register' | 'manage' | 'zones' | 'regions', cameraId?: string) => void>();
  const view = render(
    <QueryClientProvider client={client}>
      <CatalogHarness {...options} load={load} open={open} />
    </QueryClientProvider>,
  );
  return { ...view, client, load, open };
}

describe('CameraSetupCatalog selection and setup guidance regressions', () => {
  beforeEach(() => changeUiLanguage('en'));
  afterEach(() => {
    cleanup();
    activeClients.splice(0).forEach((client) => client.clear());
    vi.restoreAllMocks();
    changeUiLanguage('en');
  });

  it('marks the requested camera row as current and links row actions to camera name and inactive prerequisite guidance via aria-describedby in EN and VI', async () => {
    mountCatalog({ requestedCameraId: secondActiveCamera.id });

    const firstHeading = await screen.findByRole('heading', { name: activeCamera.name });
    const secondHeading = screen.getByRole('heading', { name: secondActiveCamera.name });
    const inactiveHeading = screen.getByRole('heading', { name: inactiveCamera.name });

    expect(secondHeading.className).toContain('[overflow-wrap:anywhere]');

    const firstRow = firstHeading.closest('li')!;
    const secondRow = secondHeading.closest('li')!;
    const inactiveRow = inactiveHeading.closest('li')!;

    expect(firstRow.getAttribute('aria-current')).toBeNull();
    expect(secondRow.getAttribute('aria-current')).toBe('true');
    expect(inactiveRow.getAttribute('aria-current')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    expect(firstRow.getAttribute('aria-labelledby')).toBe(firstHeading.id);
    expect(secondRow.getAttribute('aria-labelledby')).toBe(secondHeading.id);
    expect(inactiveRow.getAttribute('aria-labelledby')).toBe(inactiveHeading.id);

    const firstRegionsButton = within(firstRow).getByRole('button', {
      name: 'Link observation regions',
    });
    const secondRegionsButton = within(secondRow).getByRole('button', {
      name: 'Link observation regions',
    });
    expect(firstRegionsButton.getAttribute('aria-describedby')).toBe(firstHeading.id);
    expect(secondRegionsButton.getAttribute('aria-describedby')).toBe(secondHeading.id);

    const firstManageButton = within(firstRow).getByRole('button', {
      name: `Manage ${activeCamera.name}`,
    });
    expect(firstManageButton.getAttribute('aria-describedby')).toBeNull();

    const inactiveHint = within(inactiveRow).getByText(
      'Enable this camera in Manage before linking observation regions.',
    );
    const inactiveManageButton = within(inactiveRow).getByRole('button', {
      name: `Manage ${inactiveCamera.name}`,
    });
    expect(inactiveHint.id).toBeTruthy();
    expect(inactiveManageButton.getAttribute('aria-describedby')).toBe(inactiveHint.id);

    await act(async () => changeUiLanguage('vi'));
    const viSecondRegionsButton = within(secondRow).getByRole('button', {
      name: 'Gắn vùng quan sát',
    });
    expect(viSecondRegionsButton.getAttribute('aria-describedby')).toBe(secondHeading.id);
    const viInactiveHint = within(inactiveRow).getByText(
      'Bật camera này trong Quản lý trước khi gắn vùng quan sát.',
    );
    const viInactiveManageButton = within(inactiveRow).getByRole('button', {
      name: `Quản lý ${inactiveCamera.name}`,
    });
    expect(viInactiveManageButton.getAttribute('aria-describedby')).toBe(viInactiveHint.id);
  });

  it('omits empty camera list markup when zero rows are shown and suppresses competing status notices during next-page fetch, next-page error, or linked-camera search', async () => {
    const pendingPage = deferred<Page<CameraResponse>>();
    const pendingView = mountCatalog({ load: vi.fn(() => pendingPage.promise) });
    expect(screen.getByRole('status').textContent).toBe('Loading configuration…');
    expect(pendingView.container.querySelector('ul')).toBeNull();
    pendingView.unmount();

    const baseErrorView = mountCatalog({
      load: vi.fn().mockRejectedValue(new Error('initial failure')),
    });
    await screen.findByRole('alert');
    expect(baseErrorView.container.querySelector('ul')).toBeNull();
    baseErrorView.unmount();

    const emptyView = mountCatalog({
      load: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    });
    await screen.findByText('No cameras registered.');
    expect(emptyView.container.querySelector('ul')).toBeNull();
    expect(screen.queryByText('0 shown · 0 returned by the catalog')).toBeNull();
    emptyView.unmount();

    const foreignRow: CameraResponse = {
      ...activeCamera,
      id: 'cam-foreign-1',
      siteId: 'site-other',
    };
    const secondPage = deferred<Page<CameraResponse>>();
    const load = vi
      .fn<(offset: number, signal: AbortSignal) => Promise<Page<CameraResponse>>>()
      .mockResolvedValueOnce({ items: [foreignRow], total: 2 })
      .mockImplementationOnce(() => secondPage.promise);

    const partialLinkedView = mountCatalog({
      requestedCameraId: 'cam-on-page-2',
      load,
    });

    await screen.findByText(
      'The linked camera is not on the loaded pages. Load more cameras to look for it.',
    );
    expect(partialLinkedView.container.querySelector('ul')).toBeNull();
    expect(
      screen.queryByText('No matching cameras on the loaded pages. More pages are available.'),
    ).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Load more cameras' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Load more cameras' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    expect(screen.queryByRole('status')).toBeNull();

    await act(async () => {
      secondPage.reject(new Error('transient next page failure'));
    });

    await screen.findByRole('alert');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
