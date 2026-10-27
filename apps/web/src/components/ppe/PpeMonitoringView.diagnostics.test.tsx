// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import i18n from '../../i18n';
import type { SharedSession } from '../../types/shared-session';
import type { CameraPreviewModelObjects, RealtimePreview } from '../cameras/realtimePreview';
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

vi.mock('./Mf05DemoControlPanel', () => ({
  Mf05DemoControlPanel: () => <div data-testid="mf05-demo-control-panel" />,
}));

const session: SharedSession = {
  accessToken: 'synthetic-token',
  sessionScope: 'synthetic-scope',
  user: {
    id: 'synthetic-admin',
    displayName: 'Synthetic Admin',
    roleAssignments: [{ role: 'ADMIN', siteId: null }],
  },
};

function createDecodedPreviewWithModelObjects(): DecodedPreview {
  const modelObjects: CameraPreviewModelObjects = {
    modelFamily: 'yolo11s',
    experimental: true,
    scope: 'OBJECT_DETECTION_ONLY',
    artifactId: 'model-unified8-weights-v1',
    artifactSha256: 'a'.repeat(64),
    detections: [
      {
        classId: 0,
        className: 'Person',
        confidence: 0.96,
        boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
      },
    ],
  };
  const frame: RealtimePreview = {
    sessionId: '33333333-3333-3333-3333-333333333333',
    sequenceNumber: '100',
    cameraExternalId: 'synthetic-camera',
    capturedAt: '2026-10-18T00:00:00Z',
    width: 640,
    height: 480,
    imageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    zonePolygons: [],
    detections: [],
    zoneDetections: [],
    modelObjects,
  };
  return { frame, image: new Image() };
}

function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <PpeMonitoringView sharedSession={session} />
    </QueryClientProvider>,
  );
}

describe('PpeMonitoringView secondary diagnostics drawer', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
    previewState.preview = createDecodedPreviewWithModelObjects();
    previewState.status = 'LIVE';
    previewState.sourceKind = 'LIVE';

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [
        { id: 'site-1', code: 'S1', name: 'Synthetic Site', createdAt: '2026-10-18T00:00:00Z' },
      ],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
      items: [
        {
          id: 'camera-1',
          siteId: 'site-1',
          code: 'C1',
          name: 'Synthetic Camera',
          externalId: 'synthetic-camera',
          status: 'ACTIVE',
          configurationVersion: 1,
          createdAt: '2026-10-18T00:00:00Z',
        },
      ],
      total: 1,
    });
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('starts collapsed in enabled mode and reveals controlled detector content only on explicit toggle', async () => {
    mount();
    await screen.findByRole('option', { name: 'C1 · Synthetic Camera' });

    const toggle = screen.getByTestId('toggle-diagnostics-drawer');
    const controlsId = toggle.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(controlsId!)).toBeNull();
    expect(screen.queryByTestId('experimental-objects-section')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const controlledPanel = document.getElementById(controlsId!);
    expect(controlledPanel).not.toBeNull();
    expect(within(controlledPanel!).getByTestId('experimental-objects-section')).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(controlsId!)).toBeNull();
  });

  it('starts collapsed in AI-paused mode and toggles controlled panel via aria-controls', async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    vi.stubEnv('VITE_MF05_DEMO_CONTROLS', 'true');
    mount();
    await screen.findByRole('option', { name: 'C1 · Synthetic Camera' });

    const toggle = screen.getByTestId('toggle-diagnostics-drawer');
    const controlsId = toggle.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(controlsId!)).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const controlledPanel = document.getElementById(controlsId!);
    expect(controlledPanel).not.toBeNull();
    expect(within(controlledPanel!).getByTestId('mf05-demo-control-panel')).toBeTruthy();
  });

  it('renders exact EN and VI spec title and subtitle without stale Zone Setup wording', async () => {
    mount();
    await screen.findByRole('option', { name: 'C1 · Synthetic Camera' });

    const drawer = screen.getByTestId('secondary-diagnostics-drawer');
    expect(within(drawer).getByRole('heading', { name: 'Technical diagnostics' })).toBeTruthy();
    expect(
      within(drawer).getByText('Experimental detector output and demo controls.'),
    ).toBeTruthy();
    expect(drawer.textContent).not.toMatch(/zone setup/i);

    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    expect(within(drawer).getByRole('heading', { name: 'Chẩn đoán kỹ thuật' })).toBeTruthy();
    expect(within(drawer).getByText('Kết quả nhận diện thử nghiệm và công cụ demo.')).toBeTruthy();
    expect(drawer.textContent).not.toMatch(/thiết lập khu vực/i);
  });
});
