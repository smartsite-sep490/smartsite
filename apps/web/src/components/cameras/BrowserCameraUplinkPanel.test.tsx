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
import { BrowserCameraUplinkError } from '@smartsite/api-client';
import i18n from '../../i18n';
import { CameraSourceSetupPanel } from './CameraSourceSetupPanel';
import { useBrowserCameraUplink } from './useBrowserCameraUplink';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAMERA_ID = '22222222-2222-4222-8222-222222222222';
const LEASE_ID = '33333333-3333-4333-8333-333333333333';
const SAMPLE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function makeHost(browserCameraSupported: boolean): SourceHost {
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
  cameraStatus?: 'ACTIVE' | 'INACTIVE';
  uplinkClient?: BrowserCameraUplinkClient;
  onUnauthorized?: () => void;
  onOpenRegions?: () => void;
  encodeFrame?: () => Promise<{ width: number; height: number; jpegBytes: Uint8Array }>;
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const sourceClient: CameraSourceClient = {
    hosts: vi.fn().mockResolvedValue([makeHost(options.browserCameraSupported)]),
    probe: vi.fn(),
  };
  return render(
    <QueryClientProvider client={queryClient}>
      <CameraSourceSetupPanel
        apiUrl="https://api.example.test"
        token="test-token"
        siteId={SITE_ID}
        camera={{
          id: CAMERA_ID,
          name: 'Cổng chính A',
          configurationVersion: 1,
          status: options.cameraStatus ?? 'ACTIVE',
        }}
        setupKey={['camera-setup']}
        canWrite={true}
        onUnauthorized={options.onUnauthorized ?? vi.fn()}
        onOpenRegions={options.onOpenRegions}
        client={sourceClient}
        browserUplinkClient={options.uplinkClient}
        browserUplinkFrameEncoder={options.encodeFrame}
      />
    </QueryClientProvider>,
  );
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

  it('stays strictly unavailable and never calls getUserMedia when browserCameraSupported is false', async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
    });
    const uplinkClient: BrowserCameraUplinkClient = {
      status: vi.fn(),
      start: vi.fn(),
      uploadFrame: vi.fn(),
      stop: vi.fn(),
    };

    renderPanel({ browserCameraSupported: false, uplinkClient });
    const browserRadio = await screen.findByRole('radio', { name: /Camera trên máy này/i });
    fireEvent.click(browserRadio);

    expect(screen.getByTestId('camera-source-browser-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('camera-source-browser-uplink')).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(uplinkClient.start).not.toHaveBeenCalled();
    expect(uplinkClient.status).not.toHaveBeenCalled();
  });

  it('streams frames via Backend lease without AI-machine selector when browserCameraSupported is true and cleans up on pagehide', async () => {
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
      status: vi.fn(),
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
      status: vi.fn(),
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
      status: vi.fn(),
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
        status: vi.fn(),
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

  it('immediately stops capture, timer, and lease when capability, write permission, or camera active state is lost mid-stream', async () => {
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
    const uplinkClient: BrowserCameraUplinkClient = {
      status: vi.fn(),
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
    const hostsFn = vi
      .fn<CameraSourceClient['hosts']>()
      .mockResolvedValueOnce([makeHost(true)])
      .mockResolvedValueOnce([makeHost(false)])
      .mockResolvedValueOnce([makeHost(true)])
      .mockRejectedValueOnce(new Error('network down'));

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
    fireEvent.click(screen.getByTestId('browser-uplink-start-btn'));
    await waitFor(() => expect(uplinkClient.uploadFrame).toHaveBeenCalledTimes(1));

    // 1) Capability turns false mid-stream -> stops tracks and releases lease immediately.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['cap-loss'] });
    });
    await waitFor(() => {
      expect(fake.track.stop).toHaveBeenCalledTimes(1);
      expect(uplinkClient.stop).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('camera-source-browser-unavailable')).toBeTruthy();

    // 2) Restore capability, restart, then camera becomes INACTIVE -> tears down active stream + lease.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['cap-loss'] });
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

    // 4) Restore write, restart, then hosts query fails (hosts.isError with retained data) -> stops tracks + lease.
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
      await queryClient.invalidateQueries({ queryKey: ['cap-loss'] });
    });
    await waitFor(() => {
      expect(fake.track.stop).toHaveBeenCalledTimes(4);
      expect(uplinkClient.stop).toHaveBeenCalledTimes(4);
    });
    expect(
      screen.getByTestId('camera-source-host-prerequisite').getAttribute('data-host-state'),
    ).toBe('error');
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
});
