// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraResponse, RoleAssignmentResponse } from '@smartsite/contracts/management';
import i18n from '../../i18n';
import type { SharedSession } from '../../types/shared-session';
import type { RealtimePreview } from '../cameras/realtimePreview';
import type { DecodedPreview } from '../cameras/useRealtimePreview';
import { PpeMonitoringView } from './PpeMonitoringView';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const previewState = vi.hoisted(() => ({
  preview: null as DecodedPreview | null,
  status: 'LIVE' as 'LIVE' | 'REPLAY' | 'UNAVAILABLE' | 'CONNECTING',
  sourceKind: 'LIVE' as 'LIVE' | 'REPLAY' | null,
}));

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: () => ({
    preview: previewState.preview,
    status: previewState.status,
    sourceKind: previewState.sourceKind,
    error: null,
    errorStatus: null,
    isError: false,
    isLoading: false,
    isPolling: Boolean(previewState.preview),
    retry: vi.fn(),
    cameraExternalId: previewState.preview?.frame.cameraExternalId ?? null,
    capturedAt: previewState.preview?.frame.capturedAt ?? null,
  }),
}));

function makeSession(
  tag: string,
  displayName: string,
  roleAssignments: RoleAssignmentResponse[],
): SharedSession {
  return {
    accessToken: `synthetic-${tag}-token`,
    sessionScope: `synthetic-${tag}-scope`,
    user: { id: `user-${tag}`, displayName, roleAssignments },
  };
}

function makeCamera(
  id: string,
  siteId: string,
  code: string,
  name: string,
  externalId: string,
): CameraResponse {
  return {
    id,
    siteId,
    code,
    name,
    externalId,
    status: 'ACTIVE',
    configurationVersion: 1,
    createdAt: '2026-10-18T00:00:00Z',
  };
}

const adminSession = makeSession('admin', 'Synthetic Admin', [{ role: 'ADMIN', siteId: null }]);
const safetyOnlySession = makeSession('safety', 'Safety Officer Only', [
  { role: 'SAFETY_OFFICER', siteId: 'site-1' },
]);
const dualRoleSession = makeSession('dual', 'Safety Officer & Site Manager', [
  { role: 'SAFETY_OFFICER', siteId: 'site-1' },
  { role: 'SITE_MANAGER', siteId: 'site-1' },
  { role: 'SAFETY_OFFICER', siteId: 'site-2' },
]);

function createDecodedPreview(cameraExternalId = 'synthetic-camera-1'): DecodedPreview {
  const frame: RealtimePreview = {
    sessionId: '33333333-3333-3333-3333-333333333333',
    sequenceNumber: '101',
    cameraExternalId,
    capturedAt: '2026-10-18T00:00:00Z',
    width: 640,
    height: 480,
    imageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    zonePolygons: [],
    detections: [],
    zoneDetections: [],
  };
  return { frame, image: new Image() };
}

function expectBefore(first: Element, second: Element) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
}

function mountView(
  session: SharedSession = adminSession,
  onOpenSetup?: (context: { siteId: string; cameraId?: string }) => void,
) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <PpeMonitoringView sharedSession={session} onOpenSetup={onOpenSetup} />
    </QueryClientProvider>,
  );
}

describe('PpeMonitoringView toolbar task groups', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
    previewState.preview = createDecodedPreview();
    previewState.status = 'LIVE';
    previewState.sourceKind = 'LIVE';

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [
        { id: 'site-1', code: 'S1', name: 'Site One', createdAt: '2026-10-18T00:00:00Z' },
        { id: 'site-2', code: 'S2', name: 'Site Two', createdAt: '2026-10-18T00:00:00Z' },
      ],
      total: 2,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockImplementation(
      async (_token, siteId) => ({
        items:
          siteId === 'site-2'
            ? [makeCamera('camera-3', 'site-2', 'C3', 'Camera Three', 'synthetic-camera-3')]
            : [
                makeCamera('camera-1', 'site-1', 'C1', 'Camera One', 'synthetic-camera-1'),
                makeCamera('camera-2', 'site-1', 'C2', 'Camera Two', 'synthetic-camera-2'),
              ],
        total: siteId === 'site-2' ? 1 : 2,
      }),
    );
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('removes duplicate bottom switch-to-wall button while keeping canonical view mode transitions and quick camera focus', async () => {
    mountView(adminSession, vi.fn());
    await screen.findByRole('option', { name: 'C1 · Camera One' });

    expect(screen.queryByTestId('switch-to-wall-toolbar-btn')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Switch to 4-source wall view' })).toBeNull();

    const viewGroup = screen.getByRole('group', { name: 'Monitoring view mode' });
    const singleBtn = within(viewGroup).getByTestId('toggle-view-single');
    const wallBtn = within(viewGroup).getByTestId('toggle-view-wall');
    expect(singleBtn.getAttribute('aria-pressed')).toBe('true');
    expect(wallBtn.getAttribute('aria-pressed')).toBe('false');

    const chip2 = screen.getByTestId('camera-chip-camera-2');
    fireEvent.click(chip2);
    await waitFor(() => expect(chip2.getAttribute('aria-pressed')).toBe('true'));
    expect((screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement).value).toBe(
      'camera-2',
    );

    fireEvent.click(wallBtn);
    expect(await screen.findByTestId('four-source-wall-grid')).toBeTruthy();
    expect(wallBtn.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(singleBtn);
    expect(singleBtn.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('four-source-wall-grid')).toBeNull();
  });

  it('deduplicates focused cadence pill in top viewing bar while retaining viewport mode caption and enabled wall summary', async () => {
    mountView(adminSession, vi.fn());
    await screen.findByRole('option', { name: 'C1 · Camera One' });

    expect(screen.queryByText('Monitoring Cadence: 500ms (focused)')).toBeNull();
    expect(screen.getByText('AI snapshot polling: 500ms')).toBeTruthy();

    fireEvent.click(screen.getByTestId('toggle-view-wall'));
    expect(await screen.findByText('Wall Monitoring: Up to 4 Feeds')).toBeTruthy();
  });

  it('renders routed Camera setup inside named Configuration region after Monitoring scope in native DOM order and passes scoped site/camera to onOpenSetup', async () => {
    const onOpenSetup = vi.fn();
    mountView(adminSession, onOpenSetup);
    await screen.findByRole('option', { name: 'C1 · Camera One' });

    const scopeRegions = screen.getAllByRole('region', { name: 'Monitoring scope' });
    const configRegions = screen.getAllByRole('region', { name: 'Configuration' });
    expect(scopeRegions).toHaveLength(1);
    expect(configRegions).toHaveLength(1);

    const scopeRegion = scopeRegions[0]!;
    const configRegion = configRegions[0]!;
    const siteSelect = within(scopeRegion).getByRole('combobox', { name: 'Site' });
    const cameraSelect = within(scopeRegion).getByRole('combobox', { name: 'Camera' });
    const setupBtn = within(configRegion).getByRole('button', { name: 'Camera setup' });
    const singleBtn = screen.getByTestId('toggle-view-single');

    expect(
      within(configRegion).queryByRole('button', { name: 'Configure PPE by Zone' }),
    ).toBeNull();
    expectBefore(siteSelect, cameraSelect);
    expectBefore(cameraSelect, setupBtn);
    expectBefore(setupBtn, singleBtn);
    for (const el of [siteSelect, cameraSelect, setupBtn, singleBtn]) {
      expect(el.tabIndex).toBeLessThanOrEqual(0);
    }

    fireEvent.click(setupBtn);
    expect(onOpenSetup).toHaveBeenLastCalledWith({ siteId: 'site-1', cameraId: 'camera-1' });

    fireEvent.change(cameraSelect, { target: { value: 'camera-2' } });
    fireEvent.click(setupBtn);
    expect(onOpenSetup).toHaveBeenLastCalledWith({ siteId: 'site-1', cameraId: 'camera-2' });
  });

  it('preserves setup capability for scoped dual-role Safety Officer + Site Manager on managed site while hiding setup for Safety Officer-only scope', async () => {
    const onOpenSetup = vi.fn();
    const { unmount } = mountView(safetyOnlySession, onOpenSetup);
    await screen.findByRole('option', { name: 'C1 · Camera One' });

    expect(screen.queryByRole('button', { name: 'Camera setup' })).toBeNull();
    unmount();

    mountView(dualRoleSession, onOpenSetup);
    await screen.findByRole('option', { name: 'C1 · Camera One' });

    const configRegion = screen.getByRole('region', { name: 'Configuration' });
    const setupBtn = within(configRegion).getByRole('button', { name: 'Camera setup' });
    fireEvent.click(setupBtn);
    expect(onOpenSetup).toHaveBeenCalledWith({ siteId: 'site-1', cameraId: 'camera-1' });

    fireEvent.change(screen.getByRole('combobox', { name: 'Site' }), {
      target: { value: 'site-2' },
    });
    await screen.findByRole('option', { name: 'C3 · Camera Three' });
    expect(screen.queryByRole('button', { name: 'Camera setup' })).toBeNull();
  });
});
