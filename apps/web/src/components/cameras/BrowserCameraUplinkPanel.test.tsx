// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BrowserCameraUplinkClient,
  CameraSourceClient,
  SourceHost,
} from '@smartsite/api-client';
import type { BrowserCameraUplinkStatusResponse } from '@smartsite/contracts/browser-camera-uplink';
import { BrowserCameraUplinkError } from '@smartsite/api-client';
import i18n from '../../i18n';
import { CameraSourceSetupPanel } from './CameraSourceSetupPanel';
import { useBrowserCameraUplink } from './useBrowserCameraUplink';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SITE_ID = '99999999-9999-4999-8999-999999999999';
const CAMERA_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_CAMERA_ID = '88888888-8888-4888-8888-888888888888';
const LEASE_ID = '33333333-3333-4333-8333-333333333333';
const SAMPLE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function makeHost(browserCameraSupported = false): SourceHost {
  return {
    id: 'host-a',
    label: 'Site Edge A',
    available: true,
    capabilities: {
      sourceKinds: ['WEBCAM', 'RTSP', 'VIDEO'],
      webcams: [{ id: 'webcam0', label: 'USB Cam 0' }],
      videos: [{ id: 'demo1', label: 'Demo clip' }],
      browserCameraSupported,
      applySupported: true,
      configurationResumeSupported: false,
      sourceRevision: 1,
    },
  };
}

function makeStatusResponse(
  supported: boolean,
  overrides: Partial<BrowserCameraUplinkStatusResponse> = {},
): BrowserCameraUplinkStatusResponse {
  return {
    schemaVersion: '1.0.0',
    supported,
    siteId: SITE_ID,
    cameraId: CAMERA_ID,
    state: 'IDLE',
    activeLeaseId: null,
    ownedByCurrentUser: false,
    lastSequence: null,
    lastFrameCapturedAt: null,
    leaseExpiresAt: null,
    width: null,
    height: null,
    ...overrides,
  };
}

function makeFakeStream() {
  const listeners = new Map<string, Set<() => void>>();
  const track = {
    stop: vi.fn(),
    getSettings: () => ({ deviceId: 'local-cam-1' }),
    addEventListener: vi.fn((event: string, cb: () => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(cb);
      listeners.set(event, set);
    }),
    removeEventListener: vi.fn((event: string, cb: () => void) => {
      listeners.get(event)?.delete(cb);
    }),
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return {
    stream,
    track,
    triggerEnded: () => {
      listeners.get('ended')?.forEach((cb) => cb());
    },
  };
}

function makeStartResponse(overrides: Partial<{ recommendedIntervalMs: number }> = {}) {
  return {
    schemaVersion: '1.0.0' as const,
    leaseId: LEASE_ID,
    siteId: SITE_ID,
    cameraId: CAMERA_ID,
    state: 'ACTIVE' as const,
    leaseExpiresAt: '2026-11-26T12:00:15.000Z',
    maxFrameBytes: 130_000,
    maxWidth: 640,
    maxHeight: 480,
    recommendedIntervalMs: overrides.recommendedIntervalMs ?? 667,
  };
}

function renderPanel(options: {
  browserCameraSupported: boolean;
  hostBrowserCapability?: boolean;
  hosts?: SourceHost[];
  cameraStatus?: 'ACTIVE' | 'INACTIVE';
  uplinkClient?: BrowserCameraUplinkClient;
  onUnauthorized?: () => void;
  onOpenRegions?: () => void;
  encodeFrame?: () => Promise<{ width: number; height: number; jpegBytes: Uint8Array }>;
  queryClient?: QueryClient;
  setupKey?: readonly unknown[];
  siteId?: string;
  cameraId?: string;
}) {
  const queryClient =
    options.queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const targetSiteId = options.siteId ?? SITE_ID;
  const targetCameraId = options.cameraId ?? CAMERA_ID;
  const sourceClient: CameraSourceClient = {
    hosts: vi
      .fn()
      .mockResolvedValue(options.hosts ?? [makeHost(options.hostBrowserCapability ?? false)]),
    probe: vi.fn(),
  };
  const resolvedUplinkClient: BrowserCameraUplinkClient = options.uplinkClient ?? {
    status: vi.fn().mockResolvedValue(
      makeStatusResponse(options.browserCameraSupported, {
        siteId: targetSiteId,
        cameraId: targetCameraId,
      }),
    ),
    start: vi.fn(),
    uploadFrame: vi.fn(),
    stop: vi.fn(),
  };
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <CameraSourceSetupPanel
          apiUrl="https://api.example.test"
          token="test-token"
          siteId={targetSiteId}
          camera={{
            id: targetCameraId,
            name: 'Cổng chính A',
            configurationVersion: 1,
            status: options.cameraStatus ?? 'ACTIVE',
          }}
          setupKey={options.setupKey ?? ['camera-setup']}
          canWrite={true}
          onUnauthorized={options.onUnauthorized ?? vi.fn()}
          onOpenRegions={options.onOpenRegions}
          client={sourceClient}
          browserUplinkClient={resolvedUplinkClient}
          browserUplinkFrameEncoder={options.encodeFrame}
        />
      </QueryClientProvider>,
    ),
  };
}

describe('CameraSourceSetupPanel capability-gated browser camera uplink', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('vi');
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await i18n.changeLanguage('vi');
  });

  it('stays strictly unavailable and never calls getUserMedia when scoped browser-uplink status reports supported=false even if host caps claim true', async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
    });
    const uplinkClient: BrowserCameraUplinkClient = {
      status: vi.fn().mockResolvedValue(makeStatusResponse(false)),
      start: vi.fn(),
      uploadFrame: vi.fn(),
      stop: vi.fn(),
    };

    renderPanel({
      browserCameraSupported: false,
      hostBrowserCapability: true,
      uplinkClient,
    });
    const browserRadio = await screen.findByRole('radio', { name: /Camera trên máy này/i });
    fireEvent.click(browserRadio);

    await waitFor(() => {
      expect(uplinkClient.status).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('camera-source-browser-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('camera-source-browser-uplink')).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(uplinkClient.start).not.toHaveBeenCalled();
  });

  it('streams frames via Backend lease without AI-machine selector when scoped browser-uplink status reports supported=true and cleans up on pagehide', async () => {
    const fake = makeFakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(fake.stream);
    const enumerateDevices = vi.fn().mockResolvedValue([
      { kind: 'videoinput', deviceId: 'local-cam-1', label: 'Laptop HD Webcam' },
      { kind: 'videoinput', deviceId: 'local-cam-2', label: 'External USB Cam' },
    ]);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia, enumerateDevices },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();

    const uplinkClient: BrowserCameraUplinkClient = {
      status: vi.fn().mockResolvedValue(makeStatusResponse(true)),
      start: vi.fn().mockResolvedValue(makeStartResponse()),
      uploadFrame: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        leaseId: LEASE_ID,
        sequence: 1,
        acceptedAt: '2026-11-26T12:00:00.100Z',
        leaseExpiresAt: '2026-11-26T12:00:10.100Z',
        width: 640,
        height: 480,
        byteLength: SAMPLE_JPEG.byteLength,
      }),
      stop: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        leaseId: LEASE_ID,
        state: 'STOPPED',
        stoppedAt: '2026-11-26T12:00:05.000Z',
      }),
    };
    const onOpenRegions = vi.fn();

    renderPanel({
      browserCameraSupported: true,
      uplinkClient,
      onOpenRegions,
      encodeFrame: vi.fn().mockResolvedValue({
        width: 640,
        height: 480,
        jpegBytes: SAMPLE_JPEG,
      }),
    });

    const browserRadio = await screen.findByRole('radio', { name: /Camera trên máy này/i });
    fireEvent.click(browserRadio);

    // Must not request permission until explicit user click, and must not show host selector.
    expect(screen.getByTestId('camera-source-browser-uplink')).toBeTruthy();
    expect(screen.queryByTestId('camera-source-connection-details')).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('browser-uplink-start-btn'));

    await waitFor(() => {
      expect(uplinkClient.start).toHaveBeenCalledTimes(1);
      expect(uplinkClient.uploadFrame).toHaveBeenCalledTimes(1);
    });

    // Status pill honestly says browser feed uploading, never claiming AI LIVE.
    expect(
      screen.getByTestId('camera-source-connection-status').getAttribute('data-connection-status'),
    ).toBe('browser-uploading');
    expect(screen.getByTestId('browser-uplink-honest-note')).toBeTruthy();
    expect(screen.getByTestId('browser-uplink-regions-btn')).toBeTruthy();
    fireEvent.click(screen.getByTestId('browser-uplink-regions-btn'));
    expect(onOpenRegions).toHaveBeenCalledTimes(1);

    // pagehide must stop tracks and send keepalive stop immediately.
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });

    await waitFor(() => {
      expect(fake.track.stop).toHaveBeenCalled();
      expect(uplinkClient.stop).toHaveBeenCalledWith(
        'https://api.example.test',
        'test-token',
        SITE_ID,
        CAMERA_ID,
        { leaseId: LEASE_ID, reason: 'PAGE_HIDDEN' },
        { keepalive: true },
      );
    });
  });

  it('releases webcam tracks and surfaces honest conflict on 409 LEASE_HELD, and revokes on 401', async () => {
    const fake = makeFakeStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(fake.stream),
        enumerateDevices: vi.fn().mockResolvedValue([]),
      },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();

    const onUnauthorized = vi.fn();
    const uplinkClient: BrowserCameraUplinkClient = {
      status: vi.fn().mockResolvedValue(makeStatusResponse(true)),
      start: vi
        .fn()
        .mockRejectedValueOnce(new BrowserCameraUplinkError(409, 'LEASE_HELD'))
        .mockRejectedValueOnce(new BrowserCameraUplinkError(401, 'UNAUTHORIZED')),
      uploadFrame: vi.fn(),
      stop: vi.fn(),
    };

    renderPanel({
      browserCameraSupported: true,
      uplinkClient,
      onUnauthorized,
    });

    fireEvent.click(await screen.findByRole('radio', { name: /Camera trên máy này/i }));
    fireEvent.click(screen.getByTestId('browser-uplink-start-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('browser-uplink-lease-held')).toBeTruthy();
    });
    expect(fake.track.stop).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();

    // Second attempt receives 401 -> stops tracks and revokes session.
    fireEvent.click(screen.getByTestId('browser-uplink-start-btn'));
    await waitFor(() => {
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });
    expect(fake.track.stop).toHaveBeenCalledTimes(2);
  });

  it('blocks browser uplink start when camera is INACTIVE and stops stream on track ended or source switch', async () => {
    const fake = makeFakeStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(fake.stream),
        enumerateDevices: vi.fn().mockResolvedValue([]),
      },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();

    const uplinkClient: BrowserCameraUplinkClient = {
      status: vi.fn().mockResolvedValue(makeStatusResponse(true)),
      start: vi.fn().mockResolvedValue(makeStartResponse()),
      uploadFrame: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        leaseId: LEASE_ID,
        sequence: 1,
        acceptedAt: '2026-11-26T12:00:00.100Z',
        leaseExpiresAt: '2026-11-26T12:00:10.100Z',
        width: 640,
        height: 480,
        byteLength: SAMPLE_JPEG.byteLength,
      }),
      stop: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        leaseId: LEASE_ID,
        state: 'STOPPED',
        stoppedAt: '2026-11-26T12:00:05.000Z',
      }),
    };

    const inactiveRender = renderPanel({
      browserCameraSupported: true,
      cameraStatus: 'INACTIVE',
      uplinkClient,
    });
    fireEvent.click(await screen.findByRole('radio', { name: /Camera trên máy này/i }));
    expect(screen.getByTestId('browser-uplink-inactive-notice')).toBeTruthy();
    expect((screen.getByTestId('browser-uplink-start-btn') as HTMLButtonElement).disabled).toBe(
      true,
    );
    inactiveRender.unmount();

    // Active camera -> start -> hardware disconnect triggers TRACK_ENDED teardown
    renderPanel({
      browserCameraSupported: true,
      cameraStatus: 'ACTIVE',
      uplinkClient,
      encodeFrame: vi.fn().mockResolvedValue({
        width: 640,
        height: 480,
        jpegBytes: SAMPLE_JPEG,
      }),
    });
    fireEvent.click(await screen.findByRole('radio', { name: /Camera trên máy này/i }));
    fireEvent.click(screen.getByTestId('browser-uplink-start-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('browser-uplink-stop-btn')).toBeTruthy();
    });

    await act(async () => {
      fake.triggerEnded();
    });
    await waitFor(() => {
      expect(screen.getByTestId('browser-uplink-error')).toBeTruthy();
      expect(uplinkClient.stop).toHaveBeenCalledWith(
        'https://api.example.test',
        'test-token',
        SITE_ID,
        CAMERA_ID,
        { leaseId: LEASE_ID, reason: 'TRACK_ENDED' },
        { keepalive: true },
      );
    });

    // Restart then switch radio to RTSP -> sends SOURCE_SWITCHED stop
    fireEvent.click(screen.getByTestId('browser-uplink-start-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('browser-uplink-stop-btn')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('radio', { name: /Camera IP \/ RTSP/i }));
    await waitFor(() => {
      expect(uplinkClient.stop).toHaveBeenCalledWith(
        'https://api.example.test',
        'test-token',
        SITE_ID,
        CAMERA_ID,
        { leaseId: LEASE_ID, reason: 'SOURCE_SWITCHED' },
        { keepalive: false },
      );
    });
  });

  it('drops overlapping frame ticks when previous upload is still in flight (bounded 1-in-flight backpressure)', async () => {
    vi.useFakeTimers();
    try {
      const fake = makeFakeStream();
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: vi.fn().mockResolvedValue(fake.stream),
          enumerateDevices: vi.fn().mockResolvedValue([]),
        },
      });
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();

      let resolveFirstUpload!: (value: {
        schemaVersion: '1.0.0';
        leaseId: string;
        sequence: number;
        acceptedAt: string;
        leaseExpiresAt: string;
        width: number;
        height: number;
        byteLength: number;
      }) => void;
      const uploadFrame = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFirstUpload = resolve;
          }),
      );
      const uplinkClient: BrowserCameraUplinkClient = {
        status: vi.fn().mockResolvedValue(makeStatusResponse(true)),
        start: vi.fn().mockResolvedValue(makeStartResponse({ recommendedIntervalMs: 500 })),
        uploadFrame,
        stop: vi.fn().mockResolvedValue({
          schemaVersion: '1.0.0',
          leaseId: LEASE_ID,
          state: 'STOPPED',
          stoppedAt: '2026-11-26T12:00:05.000Z',
        }),
      };

      renderPanel({
        browserCameraSupported: true,
        uplinkClient,
        encodeFrame: vi.fn().mockResolvedValue({
          width: 640,
          height: 480,
          jpegBytes: SAMPLE_JPEG,
        }),
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      fireEvent.click(screen.getByRole('radio', { name: /Camera trên máy này/i }));
      await act(async () => {
        fireEvent.click(screen.getByTestId('browser-uplink-start-btn'));
        await vi.advanceTimersByTimeAsync(10);
      });

      expect(uploadFrame).toHaveBeenCalledTimes(1);

      // Two interval ticks while upload #1 is still pending must NOT queue parallel uploads.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      expect(uploadFrame).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('browser-uplink-telemetry').textContent).toContain('2');

      // Resolving upload #1 allows next tick to proceed cleanly.
      await act(async () => {
        resolveFirstUpload({
          schemaVersion: '1.0.0',
          leaseId: LEASE_ID,
          sequence: 1,
          acceptedAt: '2026-11-26T12:00:01.000Z',
          leaseExpiresAt: '2026-11-26T12:00:11.000Z',
          width: 640,
          height: 480,
          byteLength: SAMPLE_JPEG.byteLength,
        });
        await vi.advanceTimersByTimeAsync(550);
      });
      expect(uploadFrame).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('immediately stops capture, timer, and lease when scoped capability, write permission, or camera active state is lost mid-stream', async () => {
    const fake = makeFakeStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(fake.stream),
        enumerateDevices: vi.fn().mockResolvedValue([]),
      },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();

    const encodeFrame = vi.fn().mockResolvedValue({
      width: 640,
      height: 480,
      jpegBytes: SAMPLE_JPEG,
    });
    const receipt = {
      schemaVersion: '1.0.0' as const,
      leaseId: LEASE_ID,
      sequence: 1,
      acceptedAt: '2026-11-26T12:00:00.100Z',
      leaseExpiresAt: '2026-11-26T12:00:10.100Z',
      width: 640,
      height: 480,
      byteLength: SAMPLE_JPEG.byteLength,
    };
    const statusFn = vi
      .fn<BrowserCameraUplinkClient['status']>()
      .mockResolvedValueOnce(makeStatusResponse(true))
      .mockResolvedValueOnce(makeStatusResponse(false))
      .mockResolvedValueOnce(makeStatusResponse(true))
      .mockRejectedValueOnce(new BrowserCameraUplinkError(503, 'HTTP_ERROR'));
    const uplinkClient: BrowserCameraUplinkClient = {
      status: statusFn,
      start: vi.fn().mockResolvedValue(makeStartResponse()),
      uploadFrame: vi.fn().mockResolvedValue(receipt),
      stop: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        leaseId: LEASE_ID,
        state: 'STOPPED',
        stoppedAt: '2026-11-26T12:00:05.000Z',
      }),
    };

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const hostsFn = vi.fn<CameraSourceClient['hosts']>().mockResolvedValue([makeHost(false)]);

    const view = render(
      <QueryClientProvider client={queryClient}>
        <CameraSourceSetupPanel
          apiUrl="https://api.example.test"
          token="test-token"
          siteId={SITE_ID}
          camera={{ id: CAMERA_ID, name: 'Cam 1', configurationVersion: 1, status: 'ACTIVE' }}
          setupKey={['cap-loss']}
          canWrite={true}
          onUnauthorized={vi.fn()}
          client={{ hosts: hostsFn, probe: vi.fn() }}
          browserUplinkClient={uplinkClient}
          browserUplinkFrameEncoder={encodeFrame}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('radio', { name: /Camera trên máy này/i }));
    fireEvent.click(await screen.findByTestId('browser-uplink-start-btn'));
    await waitFor(() => expect(uplinkClient.uploadFrame).toHaveBeenCalledTimes(1));

    // 1) Scoped browser-uplink status turns false mid-stream -> stops tracks and releases lease immediately.
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ['cap-loss', 'camera-browser-uplink-status', SITE_ID, CAMERA_ID],
      });
    });
    await waitFor(() => {
      expect(fake.track.stop).toHaveBeenCalledTimes(1);
      expect(uplinkClient.stop).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('camera-source-browser-unavailable')).toBeTruthy();

    // 2) Restore scoped capability, restart, then camera becomes INACTIVE -> tears down active stream + lease.
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ['cap-loss', 'camera-browser-uplink-status', SITE_ID, CAMERA_ID],
      });
    });
    await waitFor(() => expect(screen.getByTestId('browser-uplink-start-btn')).toBeTruthy());
    fireEvent.click(screen.getByTestId('browser-uplink-start-btn'));
    await waitFor(() => expect(uplinkClient.uploadFrame).toHaveBeenCalledTimes(2));

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <CameraSourceSetupPanel
          apiUrl="https://api.example.test"
          token="test-token"
          siteId={SITE_ID}
          camera={{ id: CAMERA_ID, name: 'Cam 1', configurationVersion: 1, status: 'INACTIVE' }}
          setupKey={['cap-loss']}
          canWrite={true}
          onUnauthorized={vi.fn()}
          client={{ hosts: hostsFn, probe: vi.fn() }}
          browserUplinkClient={uplinkClient}
          browserUplinkFrameEncoder={encodeFrame}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(fake.track.stop).toHaveBeenCalledTimes(2);
      expect(uplinkClient.stop).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId('browser-uplink-inactive-notice')).toBeTruthy();

    // 3) Re-activate camera, restart, then lose canWrite permission -> stops tracks + calls AUTH_REVOKED stop.
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <CameraSourceSetupPanel
          apiUrl="https://api.example.test"
          token="test-token"
          siteId={SITE_ID}
          camera={{ id: CAMERA_ID, name: 'Cam 1', configurationVersion: 1, status: 'ACTIVE' }}
          setupKey={['cap-loss']}
          canWrite={true}
          onUnauthorized={vi.fn()}
          client={{ hosts: hostsFn, probe: vi.fn() }}
          browserUplinkClient={uplinkClient}
          browserUplinkFrameEncoder={encodeFrame}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId('browser-uplink-start-btn'));
    await waitFor(() => expect(uplinkClient.uploadFrame).toHaveBeenCalledTimes(3));

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <CameraSourceSetupPanel
          apiUrl="https://api.example.test"
          token="test-token"
          siteId={SITE_ID}
          camera={{ id: CAMERA_ID, name: 'Cam 1', configurationVersion: 1, status: 'ACTIVE' }}
          setupKey={['cap-loss']}
          canWrite={false}
          onUnauthorized={vi.fn()}
          client={{ hosts: hostsFn, probe: vi.fn() }}
          browserUplinkClient={uplinkClient}
          browserUplinkFrameEncoder={encodeFrame}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(fake.track.stop).toHaveBeenCalledTimes(3);
      expect(uplinkClient.stop).toHaveBeenCalledTimes(3);
      expect(uplinkClient.stop).toHaveBeenLastCalledWith(
        'https://api.example.test',
        'test-token',
        SITE_ID,
        CAMERA_ID,
        { leaseId: LEASE_ID, reason: 'AUTH_REVOKED' },
        { keepalive: false },
      );
    });

    // 4) Restore write, restart, then scoped status query fails (isError with retained data) -> stops tracks + lease.
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <CameraSourceSetupPanel
          apiUrl="https://api.example.test"
          token="test-token"
          siteId={SITE_ID}
          camera={{ id: CAMERA_ID, name: 'Cam 1', configurationVersion: 1, status: 'ACTIVE' }}
          setupKey={['cap-loss']}
          canWrite={true}
          onUnauthorized={vi.fn()}
          client={{ hosts: hostsFn, probe: vi.fn() }}
          browserUplinkClient={uplinkClient}
          browserUplinkFrameEncoder={encodeFrame}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId('browser-uplink-start-btn'));
    await waitFor(() => expect(uplinkClient.uploadFrame).toHaveBeenCalledTimes(4));

    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ['cap-loss', 'camera-browser-uplink-status', SITE_ID, CAMERA_ID],
      });
    });
    await waitFor(() => {
      expect(fake.track.stop).toHaveBeenCalledTimes(4);
      expect(uplinkClient.stop).toHaveBeenCalledTimes(4);
    });
    expect(screen.getByTestId('camera-source-browser-unavailable')).toBeTruthy();
  });

  it('prevents stale in-flight finally from clearing new generation lock and guards concurrent or cancelled start()', async () => {
    vi.useFakeTimers();
    try {
      const stream1 = makeFakeStream();
      const stream2 = makeFakeStream();
      const stream3 = makeFakeStream();
      let resolveGums: Array<(stream: MediaStream) => void> = [];
      const getUserMedia = vi.fn().mockImplementation(
        () =>
          new Promise<MediaStream>((resolve) => {
            resolveGums.push(resolve);
          }),
      );
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
      });

      const fakeVideo = {
        play: vi.fn().mockResolvedValue(undefined),
        srcObject: null as MediaStream | null,
      } as unknown as HTMLVideoElement;

      let resolveGen1Encode!: (frame: {
        width: number;
        height: number;
        jpegBytes: Uint8Array;
      }) => void;
      let encodeCall = 0;
      const frameEncoder = vi.fn().mockImplementation(() => {
        encodeCall += 1;
        if (encodeCall === 1) {
          return new Promise((resolve) => {
            resolveGen1Encode = resolve;
          });
        }
        return Promise.resolve({ width: 640, height: 480, jpegBytes: SAMPLE_JPEG });
      });

      let resolveGen2Upload!: (receipt: {
        schemaVersion: '1.0.0';
        leaseId: string;
        sequence: number;
        acceptedAt: string;
        leaseExpiresAt: string;
        width: number;
        height: number;
        byteLength: number;
      }) => void;
      const uploadFrame = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveGen2Upload = resolve;
          }),
      );

      const LEASE_2 = '44444444-4444-4444-8444-444444444444';
      const uplinkClient: BrowserCameraUplinkClient = {
        status: vi.fn(),
        start: vi
          .fn()
          .mockResolvedValueOnce(makeStartResponse({ recommendedIntervalMs: 500 }))
          .mockResolvedValueOnce({
            ...makeStartResponse({ recommendedIntervalMs: 500 }),
            leaseId: LEASE_2,
          }),
        uploadFrame,
        stop: vi.fn().mockResolvedValue({
          schemaVersion: '1.0.0',
          leaseId: LEASE_ID,
          state: 'STOPPED',
          stoppedAt: '2026-11-26T12:00:05.000Z',
        }),
      };

      const { result } = renderHook(() =>
        useBrowserCameraUplink({
          apiUrl: 'https://api.example.test',
          token: 'test-token',
          siteId: SITE_ID,
          cameraId: CAMERA_ID,
          supported: true,
          canWrite: true,
          cameraInactive: false,
          onRevoked: vi.fn(),
          client: uplinkClient,
          frameEncoder,
        }),
      );
      result.current.videoRef.current = fakeVideo;

      // 1) Concurrent double-start before getUserMedia settles: superseded stream1 must release immediately.
      let p1!: Promise<void>;
      let p2!: Promise<void>;
      await act(async () => {
        p1 = result.current.start();
        p2 = result.current.start();
        await vi.advanceTimersByTimeAsync(1);
      });
      await act(async () => {
        resolveGums[0]?.(stream1.stream);
        resolveGums[1]?.(stream2.stream);
        await Promise.all([p1, p2]);
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(stream1.track.stop).toHaveBeenCalledTimes(1);
      expect(uplinkClient.start).toHaveBeenCalledTimes(1);
      // Gen 1 frameEncoder is still hanging on tick #1 (`encodeCall === 1`).
      expect(frameEncoder).toHaveBeenCalledTimes(1);

      // 2) Stop gen 1 and restart gen 2; gen 2 upload #1 is pending.
      await act(async () => {
        await result.current.stop('USER_STOPPED', false);
        const p3 = result.current.start();
        await vi.advanceTimersByTimeAsync(1);
        resolveGums[2]?.(stream3.stream);
        await p3;
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(uploadFrame).toHaveBeenCalledTimes(1);

      // Now stale gen 1 encoder resolves while gen 2 upload is STILL in flight: must NOT clear gen 2's inFlight lock.
      await act(async () => {
        resolveGen1Encode({ width: 640, height: 480, jpegBytes: SAMPLE_JPEG });
        await vi.advanceTimersByTimeAsync(550);
      });
      expect(uploadFrame).toHaveBeenCalledTimes(1);
      expect(result.current.framesDropped).toBe(1);

      // Resolving gen 2 upload allows next tick cleanly.
      await act(async () => {
        resolveGen2Upload({
          schemaVersion: '1.0.0',
          leaseId: LEASE_2,
          sequence: 1,
          acceptedAt: '2026-11-26T12:00:01.000Z',
          leaseExpiresAt: '2026-11-26T12:00:11.000Z',
          width: 640,
          height: 480,
          byteLength: SAMPLE_JPEG.byteLength,
        });
        await vi.advanceTimersByTimeAsync(550);
      });
      expect(uploadFrame).toHaveBeenCalledTimes(2);

      // 3) Calling stop('SOURCE_SWITCHED') while getUserMedia is pending in 'starting' cancels startup cleanly.
      resolveGums = [];
      await act(async () => {
        await result.current.stop('USER_STOPPED', false);
      });
      const stream4 = makeFakeStream();
      let p4!: Promise<void>;
      await act(async () => {
        p4 = result.current.start();
        await vi.advanceTimersByTimeAsync(1);
        await result.current.stop('SOURCE_SWITCHED', false);
        resolveGums[0]?.(stream4.stream);
        await p4;
      });
      expect(stream4.track.stop).toHaveBeenCalledTimes(1);
      expect(uplinkClient.start).toHaveBeenCalledTimes(2);
      expect(result.current.phase).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers transient 429 RATE_LIMITED banner on next accepted frame and tears down cleanly when token scope changes', async () => {
    vi.useFakeTimers();
    try {
      const fake = makeFakeStream();
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: vi.fn().mockResolvedValue(fake.stream),
          enumerateDevices: vi.fn().mockResolvedValue([]),
        },
      });
      const fakeVideo = {
        play: vi.fn().mockResolvedValue(undefined),
        srcObject: null as MediaStream | null,
      } as unknown as HTMLVideoElement;

      const uplinkClient: BrowserCameraUplinkClient = {
        status: vi.fn(),
        start: vi.fn().mockResolvedValue(makeStartResponse({ recommendedIntervalMs: 500 })),
        uploadFrame: vi
          .fn()
          .mockRejectedValueOnce(new BrowserCameraUplinkError(429, 'RATE_LIMITED'))
          .mockResolvedValue({
            schemaVersion: '1.0.0',
            leaseId: LEASE_ID,
            sequence: 2,
            acceptedAt: '2026-11-26T12:00:01.000Z',
            leaseExpiresAt: '2026-11-26T12:00:11.000Z',
            width: 640,
            height: 480,
            byteLength: SAMPLE_JPEG.byteLength,
          }),
        stop: vi.fn().mockResolvedValue({
          schemaVersion: '1.0.0',
          leaseId: LEASE_ID,
          state: 'STOPPED',
          stoppedAt: '2026-11-26T12:00:05.000Z',
        }),
      };

      const { result, rerender } = renderHook(
        ({ token }: { token: string }) =>
          useBrowserCameraUplink({
            apiUrl: 'https://api.example.test',
            token,
            siteId: SITE_ID,
            cameraId: CAMERA_ID,
            supported: true,
            canWrite: true,
            cameraInactive: false,
            onRevoked: vi.fn(),
            client: uplinkClient,
            frameEncoder: vi.fn().mockResolvedValue({
              width: 640,
              height: 480,
              jpegBytes: SAMPLE_JPEG,
            }),
          }),
        { initialProps: { token: 'token-1' } },
      );
      result.current.videoRef.current = fakeVideo;

      await act(async () => {
        await result.current.start();
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current.issue).toBe('RATE_LIMITED');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(550);
      });
      expect(result.current.issue).toBeNull();
      expect(result.current.framesUploaded).toBe(2);

      // Token replacement while mounted stops old stream + lease and resets phase out of 'uploading'.
      rerender({ token: 'token-2' });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(fake.track.stop).toHaveBeenCalledTimes(1);
      expect(fakeVideo.srcObject).toBeNull();
      expect(uplinkClient.stop).toHaveBeenCalledWith(
        'https://api.example.test',
        'token-1',
        SITE_ID,
        CAMERA_ID,
        { leaseId: LEASE_ID, reason: 'SOURCE_SWITCHED' },
        { keepalive: true },
      );
      expect(result.current.phase).toBe('stopped');
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes source picker and browser webcam action with zero or offline physical hosts without calling getUserMedia until click, while preserving physical prerequisite states', async () => {
    const fake = makeFakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(fake.stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();

    const uplinkClient: BrowserCameraUplinkClient = {
      status: vi.fn().mockResolvedValue(makeStatusResponse(true)),
      start: vi.fn().mockResolvedValue(makeStartResponse()),
      uploadFrame: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        leaseId: LEASE_ID,
        sequence: 1,
        acceptedAt: '2026-11-26T12:00:00.100Z',
        leaseExpiresAt: '2026-11-26T12:00:10.000Z',
        width: 640,
        height: 480,
        byteLength: SAMPLE_JPEG.byteLength,
      }),
      stop: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        leaseId: LEASE_ID,
        state: 'STOPPED',
        stoppedAt: '2026-11-26T12:00:05.000Z',
      }),
    };

    // Case 1: Zero physical hosts (hosts: []) -> exposes browser webcam action immediately, ZERO getUserMedia until click
    const emptyHostView = renderPanel({
      browserCameraSupported: true,
      hosts: [],
      uplinkClient,
      encodeFrame: vi.fn().mockResolvedValue({
        width: 640,
        height: 480,
        jpegBytes: SAMPLE_JPEG,
      }),
    });

    const startBtn = await screen.findByTestId('browser-uplink-start-btn');
    expect(startBtn).toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.queryByTestId('camera-source-host-prerequisite')).toBeNull();

    // Switching to physical WEBCAM preserves the empty-host prerequisite state cleanly
    fireEvent.click(screen.getByRole('radio', { name: /Camera USB đã kết nối/i }));
    const emptyGate = await screen.findByTestId('camera-source-host-prerequisite');
    expect(emptyGate.getAttribute('data-host-state')).toBe('empty');
    expect(screen.queryByTestId('camera-source-browser-uplink')).toBeNull();

    // Switching back to BROWSER and clicking Start actually acquires webcam & uploads frame
    fireEvent.click(screen.getByRole('radio', { name: /Camera trên máy này/i }));
    expect(getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('browser-uplink-start-btn'));
    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(uplinkClient.start).toHaveBeenCalledTimes(1);
      expect(uplinkClient.uploadFrame).toHaveBeenCalledTimes(1);
    });
    emptyHostView.unmount();

    // Case 2: All physical hosts offline/agent-unavailable -> browser webcam action stays exposed while physical source preserves agent-unavailable prerequisite
    getUserMedia.mockClear();
    renderPanel({
      browserCameraSupported: true,
      hosts: [
        {
          id: 'edge-off',
          label: 'Site Edge Box',
          available: false,
          reason: 'AGENT_UNAVAILABLE',
        },
      ],
      uplinkClient,
    });
    expect(await screen.findByTestId('browser-uplink-start-btn')).toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: /Camera IP \/ RTSP/i }));
    const offlineGate = await screen.findByTestId('camera-source-host-prerequisite');
    expect(offlineGate.getAttribute('data-host-state')).toBe('agent-unavailable');
  });

  it('fails closed on 401/403/404, mismatched scope payload, aborted scope switch, and retained stale status error', async () => {
    const fake = makeFakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(fake.stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();

    // 1. 404 from browser-uplink status -> fails closed without calling onUnauthorized; no-host gate stays shown
    const onUnauthorized404 = vi.fn();
    const view404 = renderPanel({
      browserCameraSupported: false,
      hosts: [],
      onUnauthorized: onUnauthorized404,
      uplinkClient: {
        status: vi.fn().mockRejectedValue(new BrowserCameraUplinkError(404, 'LEASE_NOT_FOUND')),
        start: vi.fn(),
        uploadFrame: vi.fn(),
        stop: vi.fn(),
      },
    });
    const emptyGate = await screen.findByTestId('camera-source-host-prerequisite');
    expect(emptyGate.getAttribute('data-host-state')).toBe('empty');
    expect(screen.queryByTestId('browser-uplink-start-btn')).toBeNull();
    expect(onUnauthorized404).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    view404.unmount();

    // 2. 403 and 401 from browser-uplink status (even with 200 empty hosts) -> fails closed, revokes & calls onUnauthorized once
    for (const statusCode of [403, 401] as const) {
      const onUnauthorized = vi.fn();
      const viewDenied = renderPanel({
        browserCameraSupported: false,
        hosts: [],
        onUnauthorized,
        setupKey: [`denied-${statusCode}`],
        uplinkClient: {
          status: vi
            .fn()
            .mockRejectedValue(
              new BrowserCameraUplinkError(
                statusCode,
                statusCode === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
              ),
            ),
          start: vi.fn(),
          uploadFrame: vi.fn(),
          stop: vi.fn(),
        },
      });
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toMatch(/không còn quyền thiết lập camera|no longer permits/i);
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('radio')).toBeNull();
      expect(screen.queryByTestId('browser-uplink-start-btn')).toBeNull();
      viewDenied.unmount();
    }

    // 3. Mismatched siteId/cameraId in status payload -> fails closed
    const viewMismatch = renderPanel({
      browserCameraSupported: true,
      hosts: [],
      setupKey: ['scope-mismatch'],
      uplinkClient: {
        status: vi
          .fn()
          .mockResolvedValue(
            makeStatusResponse(true, { siteId: OTHER_SITE_ID, cameraId: OTHER_CAMERA_ID }),
          ),
        start: vi.fn(),
        uploadFrame: vi.fn(),
        stop: vi.fn(),
      },
    });
    const mismatchGate = await screen.findByTestId('camera-source-host-prerequisite');
    expect(mismatchGate.getAttribute('data-host-state')).toBe('empty');
    expect(screen.queryByTestId('browser-uplink-start-btn')).toBeNull();
    viewMismatch.unmount();

    // 4. Scope replacement aborts in-flight status() AbortSignal and ignores stale supported=true response
    let resolveStaleStatus!: (val: BrowserCameraUplinkStatusResponse) => void;
    let firstSignal: AbortSignal | undefined;
    const statusSpy = vi.fn<BrowserCameraUplinkClient['status']>(
      (_api, _tok, _site, camId, signal) => {
        if (camId === CAMERA_ID) {
          firstSignal = signal;
          return new Promise<BrowserCameraUplinkStatusResponse>((resolve) => {
            resolveStaleStatus = resolve;
          });
        }
        return Promise.resolve(makeStatusResponse(false, { cameraId: camId }));
      },
    );
    const scopeClient: BrowserCameraUplinkClient = {
      status: statusSpy,
      start: vi.fn(),
      uploadFrame: vi.fn(),
      stop: vi.fn(),
    };
    const scopeQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sourceClient: CameraSourceClient = {
      hosts: vi.fn().mockResolvedValue([]),
      probe: vi.fn(),
    };
    const scopeView = render(
      <QueryClientProvider client={scopeQueryClient}>
        <CameraSourceSetupPanel
          apiUrl="https://api.example.test"
          token="test-token"
          siteId={SITE_ID}
          camera={{ id: CAMERA_ID, name: 'Cam 1', configurationVersion: 1, status: 'ACTIVE' }}
          setupKey={['scope-abort-1']}
          canWrite={true}
          onUnauthorized={vi.fn()}
          client={sourceClient}
          browserUplinkClient={scopeClient}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(statusSpy).toHaveBeenCalledTimes(1));
    expect(firstSignal?.aborted).toBe(false);

    scopeView.rerender(
      <QueryClientProvider client={scopeQueryClient}>
        <CameraSourceSetupPanel
          apiUrl="https://api.example.test"
          token="test-token"
          siteId={SITE_ID}
          camera={{ id: OTHER_CAMERA_ID, name: 'Cam 2', configurationVersion: 1, status: 'ACTIVE' }}
          setupKey={['scope-abort-2']}
          canWrite={true}
          onUnauthorized={vi.fn()}
          client={sourceClient}
          browserUplinkClient={scopeClient}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(firstSignal?.aborted).toBe(true));
    resolveStaleStatus(makeStatusResponse(true, { cameraId: CAMERA_ID }));
    await screen.findByTestId('camera-source-host-prerequisite');
    expect(screen.queryByTestId('browser-uplink-start-btn')).toBeNull();
    scopeView.unmount();

    // 5. Retained-data stale error on background refetch fails closed and stops active webcam tracks
    const staleQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const staleUplinkClient: BrowserCameraUplinkClient = {
      status: vi
        .fn()
        .mockResolvedValueOnce(makeStatusResponse(true))
        .mockRejectedValueOnce(new BrowserCameraUplinkError(503, 'HTTP_ERROR')),
      start: vi.fn().mockResolvedValue(makeStartResponse()),
      uploadFrame: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        leaseId: LEASE_ID,
        sequence: 1,
        acceptedAt: '2026-11-26T12:00:00.100Z',
        leaseExpiresAt: '2026-11-26T12:00:10.100Z',
        width: 640,
        height: 480,
        byteLength: SAMPLE_JPEG.byteLength,
      }),
      stop: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        leaseId: LEASE_ID,
        state: 'STOPPED',
        stoppedAt: '2026-11-26T12:00:05.000Z',
      }),
    };
    renderPanel({
      browserCameraSupported: true,
      hosts: [],
      queryClient: staleQueryClient,
      setupKey: ['stale-refetch-scope'],
      uplinkClient: staleUplinkClient,
      encodeFrame: vi.fn().mockResolvedValue({
        width: 640,
        height: 480,
        jpegBytes: SAMPLE_JPEG,
      }),
    });
    fireEvent.click(await screen.findByTestId('browser-uplink-start-btn'));
    await waitFor(() => expect(screen.getByTestId('browser-uplink-stop-btn')).toBeTruthy());

    await act(async () => {
      await staleQueryClient.refetchQueries({
        queryKey: ['stale-refetch-scope', 'camera-browser-uplink-status', SITE_ID, CAMERA_ID],
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('camera-source-browser-uplink')).toBeNull();
      expect(fake.track.stop).toHaveBeenCalled();
      expect(staleUplinkClient.stop).toHaveBeenCalledWith(
        'https://api.example.test',
        'test-token',
        SITE_ID,
        CAMERA_ID,
        { leaseId: LEASE_ID, reason: 'SOURCE_SWITCHED' },
        { keepalive: false },
      );
    });
    expect(screen.getByTestId('camera-source-host-prerequisite')).toBeTruthy();
  });
});
