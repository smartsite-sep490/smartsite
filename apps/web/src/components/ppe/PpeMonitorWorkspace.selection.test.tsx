// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoginResponse } from '@smartsite/api-client';
import { PpeMonitorWorkspace } from './PpeMonitorWorkspace';

const state = vi.hoisted(() => {
  const sites = vi.fn();
  const cameras = vi.fn();
  return {
    sites,
    cameras,
    client: {
      listSites: sites,
      listCameras: cameras,
      listPreviewCameras: cameras,
    },
  };
});

vi.mock('../../features/auth/auth-session', () => ({
  useManagementClient: () => state.client,
}));

vi.mock('./FocusedCameraMedia', () => ({
  FocusedCameraMedia: (p: { camera: { id: string } }) => (
    <div data-testid="focused-camera">{p.camera.id}</div>
  ),
}));

vi.mock('./FourSourceWall', () => ({
  FourSourceWall: (p: {
    selectedCameraId: string;
    onSelectCamera: (id: string) => void;
    onEnlargeCamera: (id: string) => void;
  }) => (
    <div>
      <div data-testid="wall-selected">{p.selectedCameraId}</div>
      <button
        type="button"
        data-testid="wall-enlarge-cam-2"
        onClick={() => p.onEnlargeCamera('cam-2')}
      >
        Enlarge CAM-2
      </button>
    </div>
  ),
  FourSourceWallTile: () => null,
}));

vi.mock('./MonitorEvidenceDrawer', () => ({
  MonitorEvidenceDrawer: () => null,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

const SITE_A = { id: 'site-a', name: 'Site Alpha', code: 'ALPHA' };
const SITE_B = { id: 'site-b', name: 'Site Beta', code: 'BETA' };
const CAM_1 = {
  type: 'ZONE' as const,
  gateId: null,
  id: 'cam-1',
  siteId: 'site-a',
  status: 'ACTIVE',
  name: 'Old Demo Camera',
  code: 'LAPTOP-DEMO',
  externalId: 'demo-1',
  configurationVersion: 1,
  createdAt: '2026-11-04T00:00:00Z',
};
const CAM_2 = {
  type: 'ZONE' as const,
  gateId: null,
  id: 'cam-2',
  siteId: 'site-a',
  status: 'ACTIVE',
  name: 'Laptop Setup Camera',
  code: 'LAPTOP-SETUP',
  externalId: 'setup-2',
  configurationVersion: 1,
  createdAt: '2026-11-05T00:00:00Z',
};
const CAM_B1 = {
  type: 'ZONE' as const,
  gateId: null,
  id: 'cam-b1',
  siteId: 'site-b',
  status: 'ACTIVE',
  name: 'Beta Yard Camera',
  code: 'BETA-1',
  externalId: 'beta-1',
  configurationVersion: 1,
  createdAt: '2026-11-05T00:00:00Z',
};

const session = {
  accessToken: 'token-1',
  user: {
    id: 'manager-1',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [
      { role: 'SITE_MANAGER', siteId: 'site-a' },
      { role: 'SITE_MANAGER', siteId: 'site-b' },
    ],
  },
} as unknown as Pick<LoginResponse, 'accessToken' | 'user'>;

describe('PpeMonitorWorkspace URL selection persistence', () => {
  let query: QueryClient;

  beforeEach(() => {
    query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    state.sites.mockReset().mockResolvedValue({ items: [SITE_A, SITE_B], total: 2 });
    state.cameras.mockReset().mockImplementation(async (_token: string, siteId: string) => {
      if (siteId === 'site-b') {
        return { items: [CAM_B1], total: 1 };
      }
      return { items: [CAM_1, CAM_2], total: 2 };
    });
  });

  afterEach(() => {
    cleanup();
    query.clear();
  });

  it('syncs siteId and cameraId to the URL without breaking focus layout, and clears cameraId when switching sites', async () => {
    render(
      <QueryClientProvider client={query}>
        <MemoryRouter initialEntries={['/ppe']}>
          <PpeMonitorWorkspace apiUrl="https://backend.example" session={session} aiPaused />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('wall-selected')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: /camera/i }), {
      target: { value: 'cam-2' },
    });
    expect(screen.getByTestId('wall-selected').textContent).toBe('cam-2');
    expect(screen.getByTestId('location-probe').textContent).toBe(
      '/ppe?siteId=site-a&cameraId=cam-2',
    );

    // Enlarging from grid keeps focus mode active even as URL search matches selected camera.
    fireEvent.click(screen.getByTestId('wall-enlarge-cam-2'));
    expect(screen.getByTestId('focused-camera').textContent).toBe('cam-2');
    expect(screen.getByTestId('location-probe').textContent).toBe(
      '/ppe?siteId=site-a&cameraId=cam-2',
    );

    // Switching sites drops the previous site's cameraId from the URL.
    fireEvent.change(screen.getByRole('combobox', { name: /site/i }), {
      target: { value: 'site-b' },
    });
    expect(await screen.findByTestId('focused-camera')).toBeTruthy();
    expect(screen.getByTestId('focused-camera').textContent).toBe('cam-b1');
    expect(screen.getByTestId('location-probe').textContent).toBe('/ppe?siteId=site-b');
  });
});
