import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserCameraUplinkClient, BrowserCameraUplinkError } from './browser-camera-uplink';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAMERA_ID = '22222222-2222-4222-8222-222222222222';
const LEASE_ID = '33333333-3333-4333-8333-333333333333';
const SAMPLE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

describe('browserCameraUplinkClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts a browser uplink lease with Bearer auth and parses strict start response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        schemaVersion: '1.0.0',
        leaseId: LEASE_ID,
        siteId: SITE_ID,
        cameraId: CAMERA_ID,
        state: 'ACTIVE',
        leaseExpiresAt: '2026-11-26T12:00:15.000Z',
        maxFrameBytes: 130_000,
        maxWidth: 640,
        maxHeight: 480,
        recommendedIntervalMs: 667,
      }),
    );

    const started = await browserCameraUplinkClient.start(
      'https://api.example.test/',
      'secret-jwt-token',
      SITE_ID,
      CAMERA_ID,
      { clientSessionId: 'tab-1', deviceLabel: 'Laptop Cam', targetIntervalMs: 667 },
      new AbortController().signal,
    );

    expect(started.leaseId).toBe(LEASE_ID);
    expect(started.maxFrameBytes).toBe(130_000);
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://api.example.test/api/v1/sites/${SITE_ID}/cameras/${CAMERA_ID}/browser-uplink/start`,
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-jwt-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('maps 409 LEASE_HELD and 401/403 auth failures to structured BrowserCameraUplinkError without leaking raw body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ code: 'LEASE_HELD', message: 'secret-internal-detail' }, 409),
    );
    await expect(
      browserCameraUplinkClient.start(
        'https://api.example.test',
        'tok',
        SITE_ID,
        CAMERA_ID,
        { clientSessionId: 'tab-1' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      name: 'BrowserCameraUplinkError',
      status: 409,
      code: 'LEASE_HELD',
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<html>unauthorized secret</html>', {
        status: 401,
        headers: { 'content-type': 'text/html' },
      }),
    );
    await expect(
      browserCameraUplinkClient.status(
        'https://api.example.test',
        'tok',
        SITE_ID,
        CAMERA_ID,
        new AbortController().signal,
      ),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof BrowserCameraUplinkError &&
        err.status === 401 &&
        err.code === 'UNAUTHORIZED' &&
        !err.message.includes('secret'),
    );
  });

  it('uploads raw image/jpeg bytes with X-Uplink-* headers and blocks invalid or oversized frames before fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(
      browserCameraUplinkClient.uploadFrame(
        'https://api.example.test',
        'tok',
        SITE_ID,
        CAMERA_ID,
        {
          leaseId: LEASE_ID,
          sequence: 1,
          capturedAt: '2026-11-26T12:00:00.000Z',
          width: 640,
          height: 480,
          jpegBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), // PNG, not JPEG
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 415, code: 'INVALID_MEDIA_TYPE' });
    expect(fetchSpy).not.toHaveBeenCalled();

    const oversized = new Uint8Array(256_001);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;
    await expect(
      browserCameraUplinkClient.uploadFrame(
        'https://api.example.test',
        'tok',
        SITE_ID,
        CAMERA_ID,
        {
          leaseId: LEASE_ID,
          sequence: 1,
          capturedAt: '2026-11-26T12:00:00.000Z',
          width: 640,
          height: 480,
          jpegBytes: oversized,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 413, code: 'FRAME_TOO_LARGE' });
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        schemaVersion: '1.0.0',
        leaseId: LEASE_ID,
        sequence: 7,
        acceptedAt: '2026-11-26T12:00:00.100Z',
        leaseExpiresAt: '2026-11-26T12:00:10.100Z',
        width: 640,
        height: 480,
        byteLength: SAMPLE_JPEG.byteLength,
      }),
    );

    const receipt = await browserCameraUplinkClient.uploadFrame(
      'https://api.example.test',
      'tok',
      SITE_ID,
      CAMERA_ID,
      {
        leaseId: LEASE_ID,
        sequence: 7,
        capturedAt: '2026-11-26T12:00:00.000Z',
        width: 640,
        height: 480,
        jpegBytes: SAMPLE_JPEG,
      },
      new AbortController().signal,
    );

    expect(receipt.sequence).toBe(7);
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://api.example.test/api/v1/sites/${SITE_ID}/cameras/${CAMERA_ID}/browser-uplink/frames`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok',
          'Content-Type': 'image/jpeg',
          'X-Uplink-Lease-Id': LEASE_ID,
          'X-Uplink-Sequence': '7',
          'X-Uplink-Captured-At': '2026-11-26T12:00:00.000Z',
          'X-Uplink-Width': '640',
          'X-Uplink-Height': '480',
        }),
      }),
    );
  });

  it('sends stop with keepalive: true and Authorization header for reliable pagehide cleanup', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        schemaVersion: '1.0.0',
        leaseId: LEASE_ID,
        state: 'STOPPED',
        stoppedAt: '2026-11-26T12:01:00.000Z',
      }),
    );

    const stopped = await browserCameraUplinkClient.stop(
      'https://api.example.test',
      'tok-keepalive',
      SITE_ID,
      CAMERA_ID,
      { leaseId: LEASE_ID, reason: 'PAGE_HIDDEN' },
      { keepalive: true },
    );

    expect(stopped?.state).toBe('STOPPED');
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://api.example.test/api/v1/sites/${SITE_ID}/cameras/${CAMERA_ID}/browser-uplink/stop`,
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok-keepalive',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });
});
