// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient, type SiteResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import type { SharedSession } from '../../types/shared-session';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PpeMonitoringView } from './PpeMonitoringView';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NEW_CAMERA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const site = (id: string, name: string): SiteResponse => ({
  id,
  code: name,
  name,
  createdAt: '2026-10-12T00:00:00Z',
});
const camera = (id = NEW_CAMERA, siteId = SITE_A): CameraResponse => ({
  id,
  siteId,
  code: 'NEW-01',
  name: 'New entrance',
  externalId: 'provisioned-camera-01',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-10-12T00:00:00Z',
});
let queries: QueryClient, session: SharedSession;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
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
  const trigger = await screen.findByRole('button', { name: 'Register camera' });
  await user.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'Register camera' });
  return { user, trigger, dialog };
}
async function fill(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.type(within(dialog).getByRole('textbox', { name: 'Camera code' }), 'NEW-01');
  await user.type(within(dialog).getByRole('textbox', { name: 'Camera name' }), 'New entrance');
  await user.type(
    within(dialog).getByRole('textbox', { name: 'Source ID' }),
    'provisioned-camera-01',
  );
}
beforeEach(() => {
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
  queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  session = {
    accessToken: 'current-token',
    sessionScope: 'current-session',
    user: {
      id: 'admin',
      displayName: 'Administrator',
      // Registration and the selected preview-list refresh exercise separate capabilities.
      roleAssignments: [SITE_A, SITE_B].flatMap((siteId) => [
        { role: 'SITE_MANAGER' as const, siteId },
        { role: 'SAFETY_OFFICER' as const, siteId },
      ]),
    },
    onSignOut: vi.fn(),
  };
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [site(SITE_A, 'Site A'), site(SITE_B, 'Site B')],
    total: 2,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview').mockRejectedValue(
    new ApiError('http', 'AI paused', 503),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'createCamera').mockResolvedValue(camera());
});
afterEach(() => {
  cleanup();
  queries.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('registers camera metadata from a no-camera Site and refreshes the exact selected list without AI', async () => {
  const list = vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras);
  const create = vi
    .mocked(SmartSiteManagementClient.prototype.createCamera)
    .mockImplementation(async () => {
      list.mockResolvedValue({ items: [camera()], total: 1 });
      return camera();
    });
  mount();
  const { user, dialog } = await open();
  await fill(user, dialog);
  await user.click(within(dialog).getByRole('button', { name: 'Register camera' }));
  await screen.findByRole('option', { name: 'NEW-01 · New entrance' });
  expect(create).toHaveBeenCalledWith('current-token', SITE_A, {
    code: 'NEW-01',
    name: 'New entrance',
    externalId: 'provisioned-camera-01',
  });
  expect(list.mock.calls.every((call) => call[1] === SITE_A)).toBe(true);
  expect(SmartSiteManagementClient.prototype.getCameraPreview).not.toHaveBeenCalled();
  expect(screen.queryByText(/stream connected/i)).toBeNull();
});

it('preserves the currently selected camera after registration refresh', async () => {
  const old = camera('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  old.code = 'OLD-01';
  old.name = 'Existing entrance';
  const list = vi
    .mocked(SmartSiteManagementClient.prototype.listPreviewCameras)
    .mockResolvedValue({ items: [old], total: 1 });
  vi.mocked(SmartSiteManagementClient.prototype.createCamera).mockImplementation(async () => {
    list.mockResolvedValue({ items: [old, camera()], total: 2 });
    return camera();
  });
  mount();
  await screen.findByRole('option', { name: 'OLD-01 · Existing entrance' });
  const { user, dialog } = await open();
  await fill(user, dialog);
  await user.click(within(dialog).getByRole('button', { name: 'Register camera' }));
  await screen.findByRole('option', { name: 'NEW-01 · New entrance' });
  expect((screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement).value).toBe(
    old.id,
  );
});

it('limits the entry point to scoped Site Manager and settled authorized Sites', async () => {
  session = {
    ...session,
    user: { ...session.user, roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: SITE_A }] },
  };
  mount();
  await screen.findByRole('option', { name: 'Site A · Site A' });
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
  expect(SmartSiteManagementClient.prototype.createCamera).not.toHaveBeenCalled();
});

it('keeps a dirty draft on Escape and asks before discarding the rounded dialog', async () => {
  mount();
  const { user, dialog, trigger } = await open();
  await user.type(within(dialog).getByRole('textbox', { name: 'Camera code' }), 'DRAFT');
  await user.keyboard('{Escape}');
  expect(screen.getByRole('dialog', { name: 'Register camera' })).toBe(dialog);
  await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
  expect(
    (within(dialog).getByRole('textbox', { name: 'Camera code' }) as HTMLInputElement).value,
  ).toBe('DRAFT');
  await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
  await user.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Register camera' })).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

it('blocks close/Escape while a create is pending and never duplicates the command', async () => {
  const pending = deferred<CameraResponse>();
  const create = vi
    .mocked(SmartSiteManagementClient.prototype.createCamera)
    .mockReturnValue(pending.promise);
  mount();
  const { user, dialog } = await open();
  await fill(user, dialog);
  await user.click(within(dialog).getByRole('button', { name: 'Register camera' }));
  await screen.findByRole('button', { name: 'Registering…' });
  expect(
    (within(dialog).getByRole('button', { name: 'Close dialog' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await user.keyboard('{Escape}');
  expect(screen.getByRole('dialog', { name: 'Register camera' })).toBe(dialog);
  expect(create).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(camera()));
});

it('closes on automatic Site fallback and suppresses late success from the former Site', async () => {
  const pending = deferred<CameraResponse>();
  vi.mocked(SmartSiteManagementClient.prototype.createCamera).mockReturnValue(pending.promise);
  const list = vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras);
  mount();
  const { user, dialog } = await open();
  await fill(user, dialog);
  await user.click(within(dialog).getByRole('button', { name: 'Register camera' }));
  vi.mocked(SmartSiteManagementClient.prototype.listSites).mockResolvedValue({
    items: [site(SITE_B, 'Site B')],
    total: 1,
  });
  await act(async () => {
    await queries.invalidateQueries({
      predicate: (q) => q.queryKey[0] === 'ppe-monitoring' && q.queryKey.includes('sites'),
    });
  });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Register camera' })).toBeNull());
  await waitFor(() =>
    expect((screen.getByRole('combobox', { name: 'Site' }) as HTMLSelectElement).value).toBe(
      SITE_B,
    ),
  );
  const calls = list.mock.calls.length;
  await act(async () => pending.resolve(camera()));
  expect(list).toHaveBeenCalledTimes(calls);
  expect(screen.queryByRole('option', { name: 'NEW-01 · New entrance' })).toBeNull();
});

it('token rotation closes the old form and ignores its late401', async () => {
  const pending = deferred<CameraResponse>();
  vi.mocked(SmartSiteManagementClient.prototype.createCamera).mockReturnValue(pending.promise);
  const view = mount();
  const { user, dialog } = await open();
  await fill(user, dialog);
  await user.click(within(dialog).getByRole('button', { name: 'Register camera' }));
  view.changeSession({ ...session, accessToken: 'new-token' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Register camera' })).toBeNull());
  await act(async () => pending.reject(new ApiError('http', 'private old error', 401)));
  expect(session.onSignOut).not.toHaveBeenCalled();
  expect(await screen.findByRole('button', { name: 'Register camera' })).toBeTruthy();
});

it('current create401 expires the session once and does not leave a usable registration trigger', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.createCamera).mockRejectedValue(
    new ApiError('http', 'private credential error', 401),
  );
  mount();
  const { user, dialog } = await open();
  await fill(user, dialog);
  await user.click(within(dialog).getByRole('button', { name: 'Register camera' }));
  await waitFor(() => expect(session.onSignOut).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('dialog', { name: 'Register camera' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
});

it('Site base metadata failure removes an open draft rather than allowing a stale create', async () => {
  mount();
  const { user, dialog } = await open();
  await user.type(within(dialog).getByRole('textbox', { name: 'Camera code' }), 'DRAFT');
  vi.mocked(SmartSiteManagementClient.prototype.listSites).mockRejectedValue(
    new ApiError('http', 'private failed refresh', 503),
  );
  await act(async () => {
    await queries.invalidateQueries({
      predicate: (q) => q.queryKey[0] === 'ppe-monitoring' && q.queryKey.includes('sites'),
    });
  });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Register camera' })).toBeNull());
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
  expect(SmartSiteManagementClient.prototype.createCamera).not.toHaveBeenCalled();
});

it('failure keeps editable draft and does not claim a created camera or update its list', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.createCamera).mockRejectedValue(
    new ApiError('http', 'private server details', 409),
  );
  const list = vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras);
  mount();
  const { user, dialog } = await open();
  await fill(user, dialog);
  const calls = list.mock.calls.length;
  await user.click(within(dialog).getByRole('button', { name: 'Register camera' }));
  await within(dialog).findByRole('alert');
  expect(
    (within(dialog).getByRole('textbox', { name: 'Camera code' }) as HTMLInputElement).value,
  ).toBe('NEW-01');
  expect(list).toHaveBeenCalledTimes(calls);
  expect(dialog.textContent).not.toContain('private server details');
});

it('requires resolving discard confirmation before submitting or opening a second confirmation', async () => {
  mount();
  const { user, dialog } = await open();
  await fill(user, dialog);
  await user.keyboard('{Escape}');
  expect(within(dialog).getByRole('button', { name: 'Register camera' }).matches(':disabled')).toBe(
    true,
  );
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(within(dialog).getAllByText('Discard unsaved camera changes?')).toHaveLength(1);
  expect(SmartSiteManagementClient.prototype.createCamera).not.toHaveBeenCalled();
});

it('returns focus to the edited field when keeping a draft after Escape', async () => {
  mount();
  const { user, dialog } = await open();
  const field = within(dialog).getByRole('textbox', { name: 'Camera code' });
  await user.type(field, 'DRAFT');
  await user.keyboard('{Escape}');
  const keepEditing = within(dialog).getByRole('button', { name: 'Keep editing' });
  act(() => keepEditing.focus());
  await user.keyboard('{Escape}');
  await user.click(keepEditing);
  expect(document.activeElement).toBe(field);
  expect((field as HTMLInputElement).value).toBe('DRAFT');
});

it('announces a saved registration even when the new camera is outside the loaded page', async () => {
  const old = camera('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  old.code = 'OLD-01';
  old.name = 'Existing entrance';
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mockResolvedValue({
    items: [old],
    total: 21,
  });
  mount();
  const { user, dialog } = await open();
  await fill(user, dialog);
  await user.click(within(dialog).getByRole('button', { name: 'Register camera' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Register camera' })).toBeNull());
  expect(
    screen
      .getAllByRole('status')
      .some((element) => /camera metadata registered/i.test(element.textContent ?? '')),
  ).toBe(true);
  expect((screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement).value).toBe(
    old.id,
  );
  expect(SmartSiteManagementClient.prototype.getCameraPreview).not.toHaveBeenCalled();
});

it('revokes camera registration after an existing metadata request expires the session', async () => {
  mount();
  const { user, dialog } = await open();
  await user.type(within(dialog).getByRole('textbox', { name: 'Camera code' }), 'DRAFT');
  vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mockRejectedValue(
    new ApiError('http', 'private expired metadata', 401),
  );
  await act(async () => {
    await queries.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'ppe-monitoring' && query.queryKey.includes('cameras'),
    });
  });
  await waitFor(() => expect(session.onSignOut).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('dialog', { name: 'Register camera' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
  expect(SmartSiteManagementClient.prototype.createCamera).not.toHaveBeenCalled();
});

it('closes registration on Site Manager role loss and ignores the old pending success', async () => {
  const pending = deferred<CameraResponse>();
  vi.mocked(SmartSiteManagementClient.prototype.createCamera).mockReturnValue(pending.promise);
  const view = mount();
  const { user, dialog } = await open();
  await fill(user, dialog);
  await user.click(within(dialog).getByRole('button', { name: 'Register camera' }));
  view.changeSession({
    ...session,
    user: { ...session.user, roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: SITE_A }] },
  });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Register camera' })).toBeNull());
  const list = vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras);
  const calls = list.mock.calls.length;
  await act(async () => pending.resolve(camera()));
  expect(list).toHaveBeenCalledTimes(calls);
  expect(screen.queryByRole('button', { name: 'Register camera' })).toBeNull();
  expect(screen.queryByText(/camera metadata registered/i)).toBeNull();
});

it('uses one discard decision when Cancel is followed by Escape', async () => {
  mount();
  const { user, dialog } = await open();
  await user.type(within(dialog).getByRole('textbox', { name: 'Camera code' }), 'DRAFT');
  const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
  await user.click(cancel);
  expect(within(dialog).getAllByText('Discard unsaved camera changes?')).toHaveLength(1);
  await user.keyboard('{Escape}');
  expect(within(dialog).queryByText('Discard unsaved camera changes?')).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Register camera' })).toBe(dialog);
  expect(
    (within(dialog).getByRole('textbox', { name: 'Camera code' }) as HTMLInputElement).value,
  ).toBe('DRAFT');
  expect(document.activeElement).toBe(cancel);
  expect(SmartSiteManagementClient.prototype.createCamera).not.toHaveBeenCalled();
});
