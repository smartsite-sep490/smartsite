// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, type LoginResponse } from '@smartsite/api-client';
import i18n from '../../i18n';
import { SAFETY_TOUR_STORAGE_KEY } from '../safety/safetyTaskTourModel';
import { PpeMonitorWorkspace } from './PpeMonitorWorkspace';

const state = vi.hoisted(() => ({ sites: vi.fn(), cameras: vi.fn(), assessments: vi.fn() }));
const client = {
  listSites: state.sites,
  listPreviewCameras: state.cameras,
  listMf06Assessments: state.assessments,
};
vi.mock('../../features/auth/auth-session', () => ({ useManagementClient: () => client }));
vi.mock('./FocusedCameraMedia', () => ({
  FocusedCameraMedia: (p: { camera: { id: string } }) => (
    <div data-testid="focus">{p.camera.id}</div>
  ),
}));
vi.mock('./FourSourceWall', () => ({
  FourSourceWall: (p: { selectedCameraId: string }) => (
    <div data-testid="wall">{p.selectedCameraId}</div>
  ),
}));

const siteA = '11111111-1111-4111-8111-111111111111';
const siteB = '33333333-3333-4333-8333-333333333333';
const cameraA = {
  id: '22222222-2222-4222-8222-222222222222',
  siteId: siteA,
  status: 'ACTIVE',
  name: 'Tapo',
  code: 'C1',
  externalId: 'tapo',
  configurationVersion: 1,
  createdAt: '2026-11-04T00:00:00Z',
};
const cameraB = {
  ...cameraA,
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Gate Cam',
  code: 'C2',
};

const session = (
  token = 'first',
  role: LoginResponse['user']['roleAssignments'][number]['role'] = 'SAFETY_OFFICER',
  siteIds: string[] = [siteA],
): Pick<LoginResponse, 'accessToken' | 'user'> => ({
  accessToken: token,
  user: {
    id: 'officer-1',
    username: 'officer',
    displayName: 'Safety Officer',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: siteIds.map((siteId) => ({ role, siteId })),
  },
});

let query: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={query}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  window.localStorage.clear();
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.sites
    .mockReset()
    .mockResolvedValue({ items: [{ id: siteA, name: 'Site A', code: 'A' }], total: 1 });
  state.cameras.mockReset().mockResolvedValue({ items: [cameraA], total: 1 });
  state.assessments.mockReset().mockResolvedValue({ items: [], total: 0, offset: 0, limit: 20 });
});

afterEach(() => {
  cleanup();
  query.clear();
});

it('shows first-use invitation, walks through all 5 accurate monitor steps, persists v2 completion, and replays without extra API calls', async () => {
  render(<PpeMonitorWorkspace apiUrl="https://backend.example" session={session()} aiPaused />, {
    wrapper,
  });

  const invite = await screen.findByTestId('safety-task-tour-invitation');
  expect(invite).toBeTruthy();
  expect(screen.getByTestId('safety-task-tour-trigger').textContent).toBe('Guided help');

  fireEvent.click(screen.getByTestId('safety-task-tour-invitation-start'));

  const tour = await screen.findByTestId('safety-task-tour');
  expect(tour.getAttribute('data-tour-step')).toBe('monitor-site-scope');
  expect(tour.textContent).toContain('Step 1 of 5');
  expect(tour.textContent).toContain('Select Site Scope');

  fireEvent.click(screen.getByTestId('safety-task-tour-next'));
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
    'monitor-camera-select',
  );
  expect(screen.getByTestId('safety-task-tour').textContent).toContain('Choose an Enabled Camera');

  fireEvent.click(screen.getByTestId('safety-task-tour-next'));
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
    'monitor-focus-toggle',
  );
  expect(screen.getByTestId('safety-task-tour').textContent).toContain(
    'Switch Focus or Camera Grid',
  );

  fireEvent.click(screen.getByTestId('safety-task-tour-next'));
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
    'monitor-fullscreen',
  );
  expect(screen.getByTestId('safety-task-tour').textContent).toContain(
    'Fullscreen only expands the current view and does not switch between Focus and Camera grid.',
  );

  fireEvent.click(screen.getByTestId('safety-task-tour-next'));
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
    'monitor-safety-records',
  );
  expect(screen.getByTestId('safety-task-tour').textContent).toContain('Open Safety Records');

  fireEvent.click(screen.getByTestId('safety-task-tour-done'));
  expect(screen.queryByTestId('safety-task-tour')).toBeNull();
  expect(screen.queryByTestId('safety-task-tour-invitation')).toBeNull();
  expect(screen.getByTestId('safety-task-tour-trigger').textContent).toBe('Replay guide');

  const stored = JSON.parse(window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY) ?? '{}') as Record<
    string,
    { status: string; tourVersion: number }
  >;
  expect(stored['officer-1:monitor:v2']).toEqual({ status: 'COMPLETED', tourVersion: 2 });
  expect(JSON.stringify(stored)).not.toContain('first');

  fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
  expect((await screen.findByTestId('safety-task-tour')).getAttribute('data-tour-step')).toBe(
    'monitor-site-scope',
  );
  expect(state.sites).toHaveBeenCalledTimes(1);
  expect(state.cameras).toHaveBeenCalledTimes(1);
});

it('resets and closes an open tour on camera, observationMode, Site, or credential changes', async () => {
  state.sites.mockResolvedValue({
    items: [
      { id: siteA, name: 'Site A', code: 'A' },
      { id: siteB, name: 'Site B', code: 'B' },
    ],
    total: 2,
  });
  state.cameras.mockImplementation(async (_token: string, siteId: string) => ({
    items:
      siteId === siteA ? [cameraA, cameraB] : [{ ...cameraA, id: 'cam-site-b', siteId: siteB }],
    total: siteId === siteA ? 2 : 1,
  }));

  const view = render(
    <PpeMonitorWorkspace
      apiUrl="https://backend.example"
      session={session('first', 'SAFETY_OFFICER', [siteA, siteB])}
      aiPaused
    />,
    { wrapper },
  );

  await screen.findByTestId('safety-task-tour-invitation');
  fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
  expect(await screen.findByTestId('safety-task-tour')).toBeTruthy();

  const cameraSelect = document.querySelector<HTMLSelectElement>(
    '[data-tour-anchor="monitor-camera-select"]',
  )!;
  fireEvent.change(cameraSelect, { target: { value: cameraB.id } });
  expect(screen.queryByTestId('safety-task-tour')).toBeNull();

  fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
  expect(await screen.findByTestId('safety-task-tour')).toBeTruthy();

  view.rerender(
    <PpeMonitorWorkspace
      apiUrl="https://backend.example"
      session={session('first', 'SAFETY_OFFICER', [siteA, siteB])}
      observationMode="zone"
      aiPaused
    />,
  );
  await waitFor(() => expect(screen.queryByTestId('safety-task-tour')).toBeNull());
  expect(await screen.findByTestId('safety-task-tour-trigger')).toBeTruthy();

  fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
  expect(await screen.findByTestId('safety-task-tour')).toBeTruthy();

  const siteSelect = document.querySelector<HTMLSelectElement>(
    '[data-tour-anchor="monitor-site-scope"]',
  )!;
  fireEvent.change(siteSelect, { target: { value: siteB } });
  await waitFor(() => expect(screen.queryByTestId('safety-task-tour')).toBeNull());

  await screen.findByTestId('safety-task-tour-trigger');
  fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
  expect(await screen.findByTestId('safety-task-tour')).toBeTruthy();

  state.sites.mockImplementation(() => new Promise(() => {}));
  view.rerender(
    <PpeMonitorWorkspace
      apiUrl="https://backend.example"
      session={session('second', 'SAFETY_OFFICER', [siteA, siteB])}
      observationMode="zone"
      aiPaused
    />,
  );
  expect(screen.queryByTestId('safety-task-tour')).toBeNull();
  expect(screen.queryByTestId('safety-task-tour-trigger')).toBeNull();
});

it('withholds the tutorial when access is denied or metadata fails, and skips unavailable camera steps on empty/partial pages', async () => {
  const denied = render(
    <PpeMonitorWorkspace
      apiUrl="https://backend.example"
      session={session('mgr', 'SITE_MANAGER')}
      aiPaused
    />,
    { wrapper },
  );
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByTestId('safety-task-tour-trigger')).toBeNull();
  expect(screen.queryByTestId('safety-task-tour-invitation')).toBeNull();
  denied.unmount();

  state.cameras.mockRejectedValueOnce(new ApiError('http', 'Server error', 500));
  const errored = render(
    <PpeMonitorWorkspace apiUrl="https://backend.example" session={session()} aiPaused />,
    { wrapper },
  );
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  expect(screen.queryByTestId('safety-task-tour-trigger')).toBeNull();
  expect(screen.queryByTestId('safety-task-tour-invitation')).toBeNull();
  errored.unmount();

  const inactivePage = Array.from({ length: 20 }, (_, i) => ({
    ...cameraA,
    id: `inactive-${i}`,
    status: 'INACTIVE',
  }));
  state.cameras.mockResolvedValueOnce({ items: inactivePage, total: 21 });
  render(<PpeMonitorWorkspace apiUrl="https://backend.example" session={session()} aiPaused />, {
    wrapper,
  });

  expect(
    await screen.findByText('More cameras may be on later pages.', { exact: false }),
  ).toBeTruthy();
  await screen.findByTestId('safety-task-tour-invitation');
  fireEvent.click(screen.getByTestId('safety-task-tour-invitation-start'));

  const tour = await screen.findByTestId('safety-task-tour');
  expect(tour.getAttribute('data-tour-step')).toBe('monitor-site-scope');
  expect(tour.textContent).toContain('Step 1 of 2');

  fireEvent.click(screen.getByTestId('safety-task-tour-next'));
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
    'monitor-safety-records',
  );
  expect(screen.getByTestId('safety-task-tour').textContent).toContain('Step 2 of 2');
});

it.each([403, 500])(
  'closes an open guide when camera metadata refetch fails with %s',
  async (status) => {
    render(<PpeMonitorWorkspace apiUrl="https://backend.example" session={session()} aiPaused />, {
      wrapper,
    });
    fireEvent.click(await screen.findByTestId('safety-task-tour-invitation-start'));
    expect(await screen.findByTestId('safety-task-tour')).toBeTruthy();
    state.cameras.mockRejectedValueOnce(new ApiError('http', 'Metadata unavailable', status));
    await act(async () => {
      await query.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey[0] === 'ppe-monitor-pages' && queryKey[2] === `cameras:${siteA}`,
      });
    });
    await waitFor(() => expect(screen.queryByTestId('safety-task-tour')).toBeNull());
    expect(screen.queryByTestId('safety-task-tour-trigger')).toBeNull();
  },
);

it('offers an exit inside its fullscreen target and restores the original control', async () => {
  let fullscreenElement: Element | null = null;
  const change = () => document.dispatchEvent(new Event('fullscreenchange'));
  const exit = vi.fn(async () => {
    fullscreenElement = null;
    change();
  });
  const overrides: [object, string, PropertyDescriptor][] = [
    [document, 'fullscreenElement', { get: () => fullscreenElement }],
    [document, 'exitFullscreen', { value: exit }],
    [
      HTMLElement.prototype,
      'requestFullscreen',
      {
        value: async function (this: HTMLElement) {
          fullscreenElement = this;
          change();
        },
      },
    ],
  ];
  const restore = overrides.map(([target, key, descriptor]) => {
    const original = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { ...descriptor, configurable: true });
    return () => {
      if (original) Object.defineProperty(target, key, original);
      else Reflect.deleteProperty(target, key);
    };
  });
  try {
    render(<PpeMonitorWorkspace apiUrl="https://backend.example" session={session()} aiPaused />, {
      wrapper,
    });
    const enter = await screen.findByRole('button', { name: 'Fullscreen', exact: true });
    fireEvent.click(enter);
    const leave = await screen.findByRole('button', { name: 'Exit fullscreen', exact: true });
    expect(document.fullscreenElement?.contains(leave)).toBe(true);
    exit.mockRejectedValueOnce(new Error('browser refused'));
    fireEvent.click(leave);
    const error = await screen.findByRole('alert');
    expect(document.fullscreenElement?.contains(error)).toBe(true);
    expect(screen.getByRole('button', { name: 'Exit fullscreen', exact: true })).toBe(leave);

    fireEvent.click(leave);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Exit fullscreen' })).toBeNull(),
    );
    await waitFor(() => expect(document.activeElement).toBe(enter));
    expect(exit).toHaveBeenCalledTimes(2);

    fireEvent.click(enter);
    const leaveAgain = await screen.findByRole('button', { name: 'Exit fullscreen', exact: true });
    let rejectExit: (reason: Error) => void = () => {
      throw new Error('Expected an outstanding exit request');
    };
    exit.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectExit = reject;
        }),
    );
    fireEvent.click(leaveAgain);
    fullscreenElement = null;
    act(change);
    await act(async () => rejectExit(new Error('late exit rejection')));
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Exit fullscreen' })).toBeNull(),
    );
    await waitFor(() => expect(document.activeElement).toBe(enter));
    fullscreenElement = document.body;
    act(change);
    expect(screen.queryByRole('button', { name: 'Exit fullscreen' })).toBeNull();
    expect(exit).toHaveBeenCalledTimes(3);
  } finally {
    restore.forEach((reset) => reset());
  }
});
