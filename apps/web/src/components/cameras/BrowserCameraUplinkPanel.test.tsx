// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BrowserCameraUplinkClient,
  CameraSourceClient,
  SourceHost,
} from '@smartsite/api-client';
import { BrowserCameraUplinkError } from '@smartsite/api-client';
import i18n from '../../i18n';
import { CameraSourceSetupPanel } from './CameraSourceSetupPanel';

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
});
