// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import { changeUiLanguage } from '../../i18n/runtime';
import type { SharedSession } from '../../types/shared-session';
import { PpeDialog } from '../ppe/PpeDialog';
import { CameraSetupView } from './CameraSetupView';

const mocks = vi.hoisted(() => ({
  listSites: vi.fn(),
  listCameras: vi.fn(),
  client: {} as Record<string, unknown>,
}));

vi.mock('../../features/auth/auth-session', () => ({ useManagementClient: () => mocks.client }));
vi.mock('./CameraRegistrationDialog', () => ({
  CameraRegistrationDialog: (props: { open: boolean; onClose: () => void }) => (
    <PpeDialog open={props.open} onClose={props.onClose} title="Register camera">
      <button type="button" onClick={props.onClose}>
        Cancel register
      </button>
    </PpeDialog>
  ),
}));
vi.mock('./CameraManagementDialog', () => ({
  CameraManagementDialog: (props: { open: boolean; onClose: () => void }) => (
    <PpeDialog open={props.open} onClose={props.onClose} title="Manage camera">
      <button type="button" onClick={props.onClose}>
        Close manage
      </button>
    </PpeDialog>
  ),
}));
vi.mock('../ppe/ZonePpeSetupDialog', () => ({
  ZonePpeSetupDialog: (props: { section?: string; onClose: () => void }) => (
    <PpeDialog open onClose={props.onClose} title={`Dialog ${props.section ?? 'all'}`}>
      <button type="button" onClick={props.onClose}>
        Close setup
      </button>
    </PpeDialog>
  ),
}));

const siteOne = { id: 'site-1', code: 'S1', name: 'North Site', createdAt: '2026-10-16T00:00:00Z' };
const siteTwo = { id: 'site-2', code: 'S2', name: 'South Site', createdAt: '2026-10-16T00:00:00Z' };
const camOne = {
  id: 'cam-1',
  siteId: siteOne.id,
  code: 'C1',
  name: 'Gate camera',
  externalId: 'alias-1',
  status: 'ACTIVE' as const,
  configurationVersion: 1,
  createdAt: siteOne.createdAt,
};
const camTwo = {
  ...camOne,
  id: 'cam-2',
  code: 'C2',
  name: 'Crane camera',
  externalId: 'alias-2',
};

const session: SharedSession = {
  accessToken: 'token-1',
  sessionScope: 'scope-1',
  user: {
    id: 'manager-1',
    displayName: 'Manager',
    roleAssignments: [
      { role: 'SITE_MANAGER', siteId: siteOne.id },
      { role: 'SITE_MANAGER', siteId: siteTwo.id },
    ],
  },
};

function mountView(entry = '/camera-setup') {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  let navigate!: ReturnType<typeof useNavigate>;
  function RoutedSetup() {
    navigate = useNavigate();
    return <CameraSetupView apiUrl="http://localhost:3000" sharedSession={session} />;
  }
  const view = render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[entry]}>
        <RoutedSetup />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, cache, navigate: (to: string) => navigate(to) };
}

describe('CameraSetupView dialog focus return and scope revocation', () => {
  beforeEach(() => {
    changeUiLanguage('en');
    mocks.listSites.mockReset().mockResolvedValue({ items: [siteOne, siteTwo], total: 2 });
    mocks.listCameras.mockReset().mockResolvedValue({ items: [camOne], total: 1 });
    mocks.client = {
      listSites: mocks.listSites,
      listCameras: mocks.listCameras,
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('returns PpeDialog focus to the invoking trigger across register, zones, manage, and paginated regions actions', async () => {
    mocks.listCameras.mockImplementation((_token, _siteId, options: { offset: number }) =>
      Promise.resolve(
        options.offset === 0 ? { items: [camOne], total: 2 } : { items: [camTwo], total: 2 },
      ),
    );
    mountView();

    await screen.findByRole('heading', { name: camOne.name });

    const registerBtn = screen.getByRole('button', { name: 'Register camera' });
    fireEvent.click(registerBtn);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(registerBtn));

    const zonesBtn = screen.getByRole('button', { name: 'Configure PPE by Zone' });
    fireEvent.click(zonesBtn);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(zonesBtn));

    fireEvent.click(screen.getByRole('button', { name: 'Load more cameras' }));
    const rowTwo = (await screen.findByRole('heading', { name: camTwo.name })).closest('li')!;

    const regionsBtn = within(rowTwo).getByRole('button', { name: 'Link observation regions' });
    fireEvent.click(regionsBtn);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(regionsBtn));
    expect(rowTwo.getAttribute('aria-current')).toBe('true');

    const manageBtn = within(rowTwo).getByRole('button', { name: `Manage ${camTwo.name}` });
    fireEvent.click(manageBtn);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(manageBtn));
  });

  it('permanently revokes open dialog state on catalog baseError and disconnects cross-Site trigger focus on Site change', async () => {
    const { cache, navigate } = mountView();
    await screen.findByRole('heading', { name: camOne.name });

    fireEvent.click(screen.getByRole('button', { name: `Manage ${camOne.name}` }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    mocks.listCameras.mockRejectedValueOnce(new ApiError('http', 'Server error', 500));
    await act(() => cache.refetchQueries({ queryKey: ['camera-setup'] }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    mocks.listCameras.mockResolvedValue({ items: [camOne], total: 1 });
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { name: camOne.name });
    expect(screen.queryByRole('dialog')).toBeNull();

    const siteSelect = screen.getByRole('combobox', { name: 'Site' });
    const siteOneRegisterBtn = screen.getByRole('button', { name: 'Register camera' });
    fireEvent.click(siteOneRegisterBtn);
    expect(screen.getByRole('dialog')).toBeTruthy();

    act(() => navigate(`/camera-setup?siteId=${siteTwo.id}`));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(siteSelect.isConnected).toBe(true);
    expect((siteSelect as HTMLSelectElement).value).toBe(siteTwo.id);
    expect(siteOneRegisterBtn.isConnected).toBe(false);
    const siteTwoRegisterBtn = screen.getByRole('button', { name: 'Register camera' });
    expect(siteTwoRegisterBtn).not.toBe(siteOneRegisterBtn);
    expect(document.activeElement).not.toBe(siteTwoRegisterBtn);
  });
});
