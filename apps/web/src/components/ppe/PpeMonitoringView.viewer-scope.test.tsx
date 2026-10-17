// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import type { SharedSession } from '../../types/shared-session';
import { PpeMonitoringView } from './PpeMonitoringView';
import type { FourSourceWallProps, ScopedWallSnapshot } from './FourSourceWall';

let wallProps: FourSourceWallProps | undefined;
vi.mock('./FourSourceWall', () => ({
  FourSourceWall: (props: FourSourceWallProps) => {
    wallProps = props;
    return null;
  },
}));

const sites = [1, 2].map((n) => ({
  id: `site-${n}`,
  code: `S${n}`,
  name: `Site ${n}`,
  createdAt: '2026-10-17T00:00:00Z',
}));
const camera = {
  id: 'camera-1',
  siteId: 'site-1',
  code: 'C1',
  name: 'Camera One',
  externalId: 'source-1',
  status: 'ACTIVE' as const,
  configurationVersion: 1,
  createdAt: '2026-10-17T00:00:00Z',
};
const manager: SharedSession = {
  accessToken: 'token',
  sessionScope: 'scope',
  user: {
    id: 'operator',
    displayName: 'Operator',
    roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'site-1' }],
  },
};
const officer: SharedSession = {
  ...manager,
  user: { ...manager.user, roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-1' }] },
};
const guidance = 'This account does not have camera monitoring access to this site.';

function mount(session: SharedSession) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenSetup = vi.fn();
  const view = (next: SharedSession) => (
    <QueryClientProvider client={queryClient}>
      <PpeMonitoringView sharedSession={next} onOpenSetup={onOpenSetup} />
    </QueryClientProvider>
  );
  const result = render(view(session));
  return { onOpenSetup, changeSession: (next: SharedSession) => result.rerender(view(next)) };
}
beforeEach(() => {
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: sites,
    total: 2,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
    items: [camera],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview').mockRejectedValue(
    new Error('AI paused'),
  );
});
afterEach(() => {
  cleanup();
  wallProps = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('guides a Site Manager to setup without requesting a forbidden preview list', async () => {
  const { onOpenSetup } = mount(manager);
  await screen.findByRole('option', { name: 'S1 · Site 1' });
  expect(SmartSiteManagementClient.prototype.listPreviewCameras).not.toHaveBeenCalled();
  expect(await screen.findByText(guidance)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Camera setup' }));
  expect(onOpenSetup).toHaveBeenCalledWith({ siteId: 'site-1', cameraId: undefined });
  expect(screen.queryByRole('button', { name: 'Retry cameras' })).toBeNull();
});

it('uses the selected Site when a manager also has a viewing role at another Site', async () => {
  mount({
    ...manager,
    user: {
      ...manager.user,
      roleAssignments: [
        ...manager.user.roleAssignments,
        { role: 'SAFETY_OFFICER', siteId: 'site-2' },
      ],
    },
  });
  await screen.findByRole('option', { name: 'S1 · Site 1' });
  expect(SmartSiteManagementClient.prototype.listPreviewCameras).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox', { name: 'Site' }), { target: { value: 'site-2' } });
  await waitFor(() =>
    expect(SmartSiteManagementClient.prototype.listPreviewCameras).toHaveBeenCalled(),
  );
  expect(
    vi
      .mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
      .mock.calls.every((c) => c[1] === 'site-2'),
  ).toBe(true);
  expect(screen.queryByText(guidance)).toBeNull();
});

it.each([
  officer,
  {
    ...manager,
    user: { ...manager.user, roleAssignments: [{ role: 'ADMIN' as const, siteId: null }] },
  },
])('keeps monitoring metadata available to an authorized viewer', async (session) => {
  mount(session);
  expect(await screen.findByRole('option', { name: 'C1 · Camera One' })).toBeTruthy();
  expect(SmartSiteManagementClient.prototype.listPreviewCameras).toHaveBeenCalled();
  expect(screen.queryByText(guidance)).toBeNull();
  expect(SmartSiteManagementClient.prototype.getCameraPreview).not.toHaveBeenCalled();
});

it('hides cached camera metadata immediately when the same session loses its viewing role', async () => {
  const { changeSession } = mount(officer);
  await screen.findByRole('option', { name: 'C1 · Camera One' });
  changeSession(manager);
  expect(screen.queryByRole('option', { name: 'C1 · Camera One' })).toBeNull();
  expect(await screen.findByText(guidance)).toBeTruthy();
});

it('does not expose a late camera page after the session loses its viewing role', async () => {
  let resolvePage!: (page: { items: (typeof camera)[]; total: number }) => void;
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mockReturnValue(
    new Promise((resolve) => {
      resolvePage = resolve;
    }),
  );
  const { changeSession } = mount(officer);
  await waitFor(() =>
    expect(SmartSiteManagementClient.prototype.listPreviewCameras).toHaveBeenCalled(),
  );
  changeSession(manager);
  resolvePage({ items: [camera], total: 1 });
  expect(await screen.findByText(guidance)).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'C1 · Camera One' })).toBeNull();
  expect(screen.queryByText('Loading cameras…')).toBeNull();
  expect(screen.queryByText('No cameras available in this site scope.')).toBeNull();
});

it.each([401, 403])(
  'preserves late HTTP%s session semantics after the viewing role is removed',
  async (status) => {
    let rejectPage!: (error: Error) => void;
    vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectPage = reject;
      }),
    );
    const onSignOut = vi.fn();
    const { changeSession } = mount({ ...officer, onSignOut });
    await waitFor(() =>
      expect(SmartSiteManagementClient.prototype.listPreviewCameras).toHaveBeenCalled(),
    );
    changeSession({ ...manager, onSignOut });
    rejectPage(new ApiError('http', 'Unavailable', status, undefined));
    await screen.findByText(guidance);
    if (status === 401) await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
    else expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retry cameras' })).toBeNull();
  },
);

it('still propagates a current wall 401 after role loss while rejecting an old credential callback', async () => {
  const onSignOut = vi.fn();
  const { changeSession } = mount({ ...officer, onSignOut });
  await screen.findByRole('option', { name: 'C1 · Camera One' });
  fireEvent.click(screen.getByTestId('toggle-view-wall'));
  await waitFor(() => expect(wallProps).toBeDefined());
  changeSession({ ...manager, onSignOut });
  const props = wallProps!;
  const snapshot: ScopedWallSnapshot = {
    scope: {
      apiUrl: props.apiUrl,
      client: props.client,
      token: props.token,
      credentialId: props.credentialId,
      sessionScope: props.sessionScope,
      siteId: props.siteId,
      cameraId: camera.id,
    },
    preview: null,
    status: 'UNAVAILABLE',
    sourceKind: null,
    capturedAt: null,
    errorStatus: 401,
    receivedAt: Date.now(),
  };
  act(() =>
    props.onTilePreviewUpdate?.({ ...snapshot, scope: { ...snapshot.scope, token: 'old-token' } }),
  );
  expect(onSignOut).not.toHaveBeenCalled();
  act(() => props.onTilePreviewUpdate?.(snapshot));
  expect(onSignOut).toHaveBeenCalledTimes(1);
});
