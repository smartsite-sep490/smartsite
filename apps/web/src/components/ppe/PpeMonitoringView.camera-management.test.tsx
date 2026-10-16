// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient, type SiteResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import type { SharedSession } from '../../types/shared-session';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PpeMonitoringView } from './PpeMonitoringView';

const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_SITE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAMERA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const camera: CameraResponse = {
  id: CAMERA,
  siteId: SITE,
  code: 'LAPTOP-01',
  name: 'Entrance camera',
  externalId: 'source-01',
  status: 'ACTIVE',
  configurationVersion: 3,
  createdAt: '2026-10-13T00:00:00Z',
};
const sites: SiteResponse[] = [SITE, OTHER_SITE].map((id, i) => ({
  id,
  code: `SITE-${i + 1}`,
  name: `Site ${i + 1}`,
  createdAt: camera.createdAt,
}));
let queries: QueryClient, session: SharedSession;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function mount() {
  const element = (value: SharedSession | null = session) => (
    <QueryClientProvider client={queries}>
      <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={value} />
    </QueryClientProvider>
  );
  const view = render(element());
  return { ...view, changeSession: (value: SharedSession | null) => view.rerender(element(value)) };
}
async function open() {
  const user = userEvent.setup();
  const trigger = await screen.findByRole('button', { name: 'Manage camera' });
  await user.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'Manage camera' });
  return { user, trigger, dialog };
}
beforeEach(() => {
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
  queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  session = {
    accessToken: 'token-current',
    sessionScope: 'session-current',
    user: { id: 'admin', displayName: 'Admin', roleAssignments: [{ role: 'ADMIN', siteId: null }] },
    onSignOut: vi.fn(),
  };
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: sites,
    total: 2,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockImplementation(
    async (_token, siteId) => ({
      items: siteId === SITE ? [{ ...camera }] : [],
      total: siteId === SITE ? 1 : 0,
    }),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview').mockRejectedValue(
    new ApiError('http', 'Paused', 503),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'renameCamera').mockResolvedValue({
    ...camera,
    name: 'New entrance',
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'setCameraStatus').mockResolvedValue({
    ...camera,
    status: 'INACTIVE',
    configurationVersion: 4,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockResolvedValue({ ...camera });
});
afterEach(() => {
  cleanup();
  queries.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('renames the selected camera through the existing client without changing source or selection', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.renameCamera).mockImplementation(async () => {
    vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mockResolvedValue({
      items: [{ ...camera, name: 'New entrance' }],
      total: 1,
    });
    return { ...camera, name: 'New entrance' };
  });
  mount();
  const { user, dialog } = await open();
  const name = within(dialog).getByRole('textbox', { name: 'Camera name' });
  await user.clear(name);
  await user.type(name, 'New entrance');
  await user.click(within(dialog).getByRole('button', { name: 'Save name' }));
  await waitFor(() =>
    expect(SmartSiteManagementClient.prototype.renameCamera).toHaveBeenCalledWith(
      'token-current',
      SITE,
      CAMERA,
      'New entrance',
    ),
  );
  await waitFor(() =>
    expect(
      Array.from((screen.getByLabelText('Camera') as HTMLSelectElement).options).some(
        (o) => o.textContent === 'LAPTOP-01 · New entrance',
      ),
    ).toBe(true),
  );
  expect((screen.getByLabelText('Camera') as HTMLSelectElement).value).toBe(CAMERA);
  expect(SmartSiteManagementClient.prototype.setCameraStatus).not.toHaveBeenCalled();
  expect(SmartSiteManagementClient.prototype.getCameraPreview).not.toHaveBeenCalled();
});

it('requires confirmation and sends the exact loaded configuration version for deactivation', async () => {
  mount();
  const { user, dialog } = await open();
  await user.click(within(dialog).getByRole('button', { name: 'Deactivate camera' }));
  expect(SmartSiteManagementClient.prototype.setCameraStatus).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: 'Confirm deactivation' }));
  await waitFor(() =>
    expect(SmartSiteManagementClient.prototype.setCameraStatus).toHaveBeenCalledWith(
      'token-current',
      SITE,
      CAMERA,
      { status: 'INACTIVE', expectedConfigurationVersion: 3 },
    ),
  );
  expect(SmartSiteManagementClient.prototype.getCameraPreview).not.toHaveBeenCalled();
});

it('keeps the draft on conflict and blocks status retry until refreshed metadata is reviewed', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.setCameraStatus).mockRejectedValue(
    new ApiError('http', 'SQL secret', 409),
  );
  mount();
  const { user, dialog } = await open();
  const name = within(dialog).getByRole('textbox', { name: 'Camera name' });
  await user.clear(name);
  await user.type(name, 'Unsaved name');
  await user.click(within(dialog).getByRole('button', { name: 'Deactivate camera' }));
  await user.click(within(dialog).getByRole('button', { name: 'Confirm deactivation' }));
  expect((await within(dialog).findByRole('alert')).textContent).toMatch(/refresh/i);
  expect(within(dialog).getByRole('alert').textContent).not.toMatch(/SQL|secret/);
  expect((name as HTMLInputElement).value).toBe('Unsaved name');
  expect(
    (within(dialog).getByRole('button', { name: 'Deactivate camera' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it('does not expose management to Safety Officer or a settled empty camera list', async () => {
  session = {
    ...session,
    user: { ...session.user, roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: SITE }] },
  };
  const view = mount();
  await screen.findByRole('option', { name: 'LAPTOP-01 · Entrance camera' });
  expect(screen.queryByRole('button', { name: 'Manage camera' })).toBeNull();
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mockResolvedValue({
    items: [],
    total: 0,
  });
  session = {
    ...session,
    user: { ...session.user, roleAssignments: [{ role: 'ADMIN', siteId: null }] },
  };
  view.changeSession({
    ...session,
    accessToken: 'different-token',
    sessionScope: 'different-session',
  });
  await screen.findByText(/no cameras available in this site scope/i);
  expect(screen.queryByRole('button', { name: 'Manage camera' })).toBeNull();
});

it('uses the existing dirty-dialog decision and returns focus after cancellation', async () => {
  mount();
  const { user, trigger, dialog } = await open();
  await user.type(within(dialog).getByRole('textbox', { name: 'Camera name' }), ' draft');
  await user.keyboard('{Escape}');
  await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
  expect(
    (within(dialog).getByRole('textbox', { name: 'Camera name' }) as HTMLInputElement).value,
  ).toContain('draft');
  await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
  await user.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
  expect(screen.queryByRole('dialog', { name: 'Manage camera' })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('suppresses a late old-token 401 after logout instead of touching the new session', async () => {
  const pending = deferred<CameraResponse>();
  vi.mocked(SmartSiteManagementClient.prototype.renameCamera).mockReturnValue(pending.promise);
  const view = mount();
  const { user, dialog } = await open();
  await user.type(within(dialog).getByRole('textbox', { name: 'Camera name' }), ' changed');
  await user.click(within(dialog).getByRole('button', { name: 'Save name' }));
  view.changeSession({ ...session, accessToken: 'token-new', sessionScope: 'session-new' });
  await act(async () => pending.reject(new ApiError('http', 'Expired', 401)));
  expect(session.onSignOut).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog', { name: 'Manage camera' })).toBeNull();
});

it('allows activation of an inactive camera and confirms the revision without starting AI', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mockResolvedValue({
    items: [{ ...camera, status: 'INACTIVE' }],
    total: 1,
  });
  vi.mocked(SmartSiteManagementClient.prototype.setCameraStatus).mockResolvedValue({
    ...camera,
    configurationVersion: 4,
  });
  mount();
  const { user, dialog } = await open();
  await user.click(within(dialog).getByRole('button', { name: 'Activate camera' }));
  expect(SmartSiteManagementClient.prototype.setCameraStatus).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: 'Confirm activation' }));
  await waitFor(() =>
    expect(SmartSiteManagementClient.prototype.setCameraStatus).toHaveBeenCalledWith(
      'token-current',
      SITE,
      CAMERA,
      { status: 'ACTIVE', expectedConfigurationVersion: 3 },
    ),
  );
  expect(SmartSiteManagementClient.prototype.getCameraPreview).not.toHaveBeenCalled();
});

it('blocks duplicate status commands and dismissal while the request is pending', async () => {
  const pending = deferred<CameraResponse>();
  const change = vi
    .mocked(SmartSiteManagementClient.prototype.setCameraStatus)
    .mockReturnValue(pending.promise);
  mount();
  const { user, dialog } = await open();
  await user.click(within(dialog).getByRole('button', { name: 'Deactivate camera' }));
  const confirm = within(dialog).getByRole('button', { name: 'Confirm deactivation' });
  await user.dblClick(confirm);
  await user.keyboard('{Escape}');
  expect(screen.getByRole('dialog', { name: 'Manage camera' })).toBe(dialog);
  expect(
    (within(dialog).getByRole('button', { name: 'Close dialog' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(change).toHaveBeenCalledTimes(1);
  await act(async () =>
    pending.resolve({ ...camera, status: 'INACTIVE', configurationVersion: 4 }),
  );
});

it.each([401, 403, 404])(
  'blocks further commands after HTTP %s with safe scoped session semantics',
  async (status) => {
    vi.mocked(SmartSiteManagementClient.prototype.renameCamera).mockRejectedValue(
      new ApiError('http', 'password SQL rtsp://secret', status),
    );
    mount();
    const { user, dialog } = await open();
    await user.type(within(dialog).getByRole('textbox', { name: 'Camera name' }), ' changed');
    await user.click(within(dialog).getByRole('button', { name: 'Save name' }));
    await waitFor(() => {
      if (status === 401) expect(session.onSignOut).toHaveBeenCalledTimes(1);
      else expect(within(dialog).getByRole('alert').textContent).not.toMatch(/password|SQL|rtsp/);
    });
    expect(session.onSignOut).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    expect(SmartSiteManagementClient.prototype.renameCamera).toHaveBeenCalledTimes(1);
  },
);

it('recovers uncertain status only by explicit scoped refresh, preserving the separate name draft', async () => {
  const change = vi
    .mocked(SmartSiteManagementClient.prototype.setCameraStatus)
    .mockRejectedValueOnce(new TypeError('private connection URL'))
    .mockResolvedValueOnce({ ...camera, status: 'INACTIVE', configurationVersion: 9 });
  const refresh = vi
    .mocked(SmartSiteManagementClient.prototype.getCamera)
    .mockResolvedValue({ ...camera, configurationVersion: 8 });
  mount();
  const { user, dialog } = await open();
  await user.type(within(dialog).getByRole('textbox', { name: 'Camera name' }), ' draft');
  await user.click(within(dialog).getByRole('button', { name: 'Deactivate camera' }));
  await user.click(within(dialog).getByRole('button', { name: 'Confirm deactivation' }));
  await within(dialog).findByRole('alert');
  expect(change).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: 'Refresh camera' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledWith('token-current', SITE, CAMERA));
  expect(
    (within(dialog).getByRole('textbox', { name: 'Camera name' }) as HTMLInputElement).value,
  ).toBe('Entrance camera draft');
  await user.click(within(dialog).getByRole('button', { name: 'Deactivate camera' }));
  await user.click(within(dialog).getByRole('button', { name: 'Confirm deactivation' }));
  await waitFor(() =>
    expect(change).toHaveBeenLastCalledWith('token-current', SITE, CAMERA, {
      status: 'INACTIVE',
      expectedConfigurationVersion: 8,
    }),
  );
});

it.each([
  { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
  { siteId: OTHER_SITE },
  { externalId: 'wrong-source' },
  { code: 'WRONG-CODE' },
  { configurationVersion: 0 },
])('rejects a mismatched rename response %j without publishing metadata', async (patch) => {
  const list = vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras);
  vi.mocked(SmartSiteManagementClient.prototype.renameCamera).mockResolvedValue({
    ...camera,
    name: 'Entrance camera changed',
    ...patch,
  });
  mount();
  const { user, dialog } = await open();
  const count = list.mock.calls.length;
  await user.type(within(dialog).getByRole('textbox', { name: 'Camera name' }), ' changed');
  await user.click(within(dialog).getByRole('button', { name: 'Save name' }));
  await within(dialog).findByRole('alert');
  expect(list).toHaveBeenCalledTimes(count);
  expect(
    (within(dialog).getByRole('textbox', { name: 'Camera name' }) as HTMLInputElement).value,
  ).toBe('Entrance camera changed');
});

it('does not accept a toggled status with the old version as a completed update', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.setCameraStatus).mockResolvedValue({
    ...camera,
    status: 'INACTIVE',
  });
  mount();
  const { user, dialog } = await open();
  await user.click(within(dialog).getByRole('button', { name: 'Deactivate camera' }));
  await user.click(within(dialog).getByRole('button', { name: 'Confirm deactivation' }));
  await within(dialog).findByRole('alert');
  expect(
    Array.from((screen.getByLabelText('Camera') as HTMLSelectElement).options).some(
      (o) => o.textContent === 'LAPTOP-01 · Entrance camera',
    ),
  ).toBe(true);
});

it('closes camera management immediately on Site change and suppresses the old response', async () => {
  const pending = deferred<CameraResponse>();
  vi.mocked(SmartSiteManagementClient.prototype.renameCamera).mockReturnValue(pending.promise);
  mount();
  const { user, dialog } = await open();
  await user.type(within(dialog).getByRole('textbox', { name: 'Camera name' }), ' changed');
  await user.click(within(dialog).getByRole('button', { name: 'Save name' }));
  // A programmatic scope switch can happen during pending work despite modal inertness.
  const select = screen.getByLabelText('Site');
  fireEvent.change(select, { target: { value: OTHER_SITE } });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Manage camera' })).toBeNull());
  await act(async () => pending.resolve({ ...camera, name: 'Entrance camera changed' }));
  expect(screen.queryByRole('option', { name: 'LAPTOP-01 · Entrance camera changed' })).toBeNull();
});

it('removes the dialog when the Admin role is lost, with no additional mutation', async () => {
  const view = mount();
  await open();
  view.changeSession({
    ...session,
    user: { ...session.user, roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: SITE }] },
  });
  expect(screen.queryByRole('dialog', { name: 'Manage camera' })).toBeNull();
  expect(SmartSiteManagementClient.prototype.renameCamera).not.toHaveBeenCalled();
  expect(SmartSiteManagementClient.prototype.setCameraStatus).not.toHaveBeenCalled();
});

it('invalidates existing region metadata keyed by its opaque token nonce after a status revision', async () => {
  const target = [
    'ppe-monitoring',
    'http://localhost:3000',
    'session-current',
    73,
    SITE,
    'cameras',
    CAMERA,
    'regions',
    'pages',
  ];
  const cameraList = [
    'ppe-monitoring',
    'http://localhost:3000',
    'session-current',
    73,
    SITE,
    'cameras-for-region',
    'pages',
  ];
  const unrelated = [
    'ppe-monitoring',
    'http://localhost:3000',
    'session-current',
    73,
    OTHER_SITE,
    'cameras-for-region',
    'pages',
  ];
  for (const key of [target, cameraList, unrelated]) {
    queries.setQueryDefaults(key, { gcTime: Infinity });
    queries.setQueryData(key, { pages: [{ items: [], total: 0 }], pageParams: [0] });
  }
  mount();
  const { user, dialog } = await open();
  await user.click(within(dialog).getByRole('button', { name: 'Deactivate camera' }));
  await user.click(within(dialog).getByRole('button', { name: 'Confirm deactivation' }));
  await waitFor(() => expect(queries.getQueryState(target)?.isInvalidated).toBe(true));
  expect(queries.getQueryState(cameraList)?.isInvalidated).toBe(true);
  expect(queries.getQueryState(unrelated)?.isInvalidated).toBe(false);
});

it('does not request an AI preview for inactive metadata even in a synthetic enabled-monitoring fixture', async () => {
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mockResolvedValue({
    items: [{ ...camera, status: 'INACTIVE' }],
    total: 1,
  });
  mount();
  await screen.findByRole('button', { name: 'Manage camera' });
  expect(SmartSiteManagementClient.prototype.getCameraPreview).not.toHaveBeenCalled();
});

it('does not advertise active wall polling when every listed camera is inactive', async () => {
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mockResolvedValue({
    items: [{ ...camera, status: 'INACTIVE' }],
    total: 1,
  });
  mount();
  await screen.findByRole('button', { name: 'Manage camera' });
  await userEvent.setup().click(screen.getByTestId('toggle-view-wall'));
  expect(screen.queryByTitle('Polling active (1s wall / 500ms focused)')).toBeNull();
  expect(SmartSiteManagementClient.prototype.getCameraPreview).not.toHaveBeenCalled();
});
