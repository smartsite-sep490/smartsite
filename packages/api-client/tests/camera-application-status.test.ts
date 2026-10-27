import { getEventListeners } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  MAX_CAMERA_APPLICATION_STATUS_RESPONSE_BYTES,
  SmartSiteManagementClient,
  type CameraApplicationStatus,
} from '../src/index';

const siteId = '11111111-aaaa-4111-8111-11111111111a';
const otherSiteId = '99999999-cccc-4999-8999-99999999999c';
const cameraId = '22222222-bbbb-4222-8222-22222222222b';
const otherCameraId = '88888888-dddd-4888-8888-88888888888d';

function createApplicationStatusFixture(
  overrides: Record<string, unknown> = {},
): CameraApplicationStatus {
  return {
    cameraId,
    siteId,
    desiredRevision: 4,
    reportedRevision: 4,
    applicationState: 'LOADED',
    observedAt: '2026-10-27T05:00:02.000Z',
    lastReceiptAt: '2026-10-27T05:00:01.000Z',
    viewValidity: 'UNCONFIRMED',
    reasonCode: null,
    ...overrides,
  } as CameraApplicationStatus;
}

const jsonResponse = (payload: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('SmartSiteManagementClient.getCameraApplicationStatus', () => {
  it('calls GET /sites/:siteId/cameras/:cameraId/application-status with no-store, error redirect, and case-insensitive scope matching', async () => {
    const loadedFixture = createApplicationStatusFixture();
    const unconfirmedFixture = createApplicationStatusFixture({
      reportedRevision: null,
      applicationState: 'UNCONFIRMED',
      lastReceiptAt: null,
      viewValidity: 'NEEDS_REVALIDATION',
      reasonCode: 'MISSING_ACTIVE_RECEIPT',
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(loadedFixture))
      .mockResolvedValueOnce(jsonResponse(unconfirmedFixture));
    vi.stubGlobal('fetch', fetchMock);

    const client = new SmartSiteManagementClient('https://api.example.test/');
    const upperSite = siteId.toUpperCase();
    const upperCamera = cameraId.toUpperCase();
    const result = await client.getCameraApplicationStatus('status-token', upperSite, upperCamera);

    expect(result).toEqual(loadedFixture);
    expect(MAX_CAMERA_APPLICATION_STATUS_RESPONSE_BYTES).toBe(4096);

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      `https://api.example.test/api/v1/sites/${encodeURIComponent(upperSite)}/cameras/${encodeURIComponent(upperCamera)}/application-status`,
    );
    expect(calledUrl).not.toContain('?');
    expect(calledInit).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      headers: expect.objectContaining({
        Accept: 'application/json',
        Authorization: 'Bearer status-token',
      }),
    });

    const second = await client.getCameraApplicationStatus('status-token', siteId, cameraId);
    expect(second).toEqual(unconfirmedFixture);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['foreign-site-scope', createApplicationStatusFixture({ siteId: otherSiteId })],
    ['foreign-camera-scope', createApplicationStatusFixture({ cameraId: otherCameraId })],
    ['uppercase-wire-siteId', createApplicationStatusFixture({ siteId: siteId.toUpperCase() })],
    [
      'uppercase-wire-cameraId',
      createApplicationStatusFixture({ cameraId: cameraId.toUpperCase() }),
    ],
    ['unknown-extra-field', { ...createApplicationStatusFixture(), extra: true }],
    ['invalid-applicationState', createApplicationStatusFixture({ applicationState: 'APPLIED' })],
    ['invalid-viewValidity', createApplicationStatusFixture({ viewValidity: 'CONFIRMED' })],
    [
      'loaded-with-mismatched-revision',
      createApplicationStatusFixture({ desiredRevision: 4, reportedRevision: 3 }),
    ],
    [
      'loaded-with-non-null-reasonCode',
      createApplicationStatusFixture({ reasonCode: 'UNEXPECTED_REASON' }),
    ],
    [
      'loaded-with-degraded-viewValidity',
      createApplicationStatusFixture({ viewValidity: 'NEEDS_REVALIDATION' }),
    ],
    [
      'unconfirmed-with-reportedRevision',
      createApplicationStatusFixture({ applicationState: 'UNCONFIRMED', reportedRevision: 4 }),
    ],
    [
      'invalid-reasonCode-format',
      createApplicationStatusFixture({
        applicationState: 'REJECTED',
        reasonCode: 'lowercase_reason',
      }),
    ],
  ])(
    'rejects wrong-scope or malformed payload (%s) with ApiError invalid-response',
    async (_label, payload) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(payload)));
      const client = new SmartSiteManagementClient('https://api.example.test');
      const promise = client.getCameraApplicationStatus('status-token', siteId, cameraId);
      await expect(promise).rejects.toBeInstanceOf(ApiError);
      await expect(promise).rejects.toMatchObject({ code: 'invalid-response' });
    },
  );

  it('enforces the 4096-byte response bound on Content-Length and chunked streams before response.json()', async () => {
    const client = new SmartSiteManagementClient('https://api.example.test');

    for (const badContentLength of ['4097', '8192', 'invalid']) {
      const pullSpy = vi.fn();
      const cancelSpy = vi.fn();
      const jsonSpy = vi.fn(() => {
        throw new Error('response.json() must not run on oversized application-status payload');
      });
      const response = new Response(
        new ReadableStream<Uint8Array>({ pull: pullSpy, cancel: cancelSpy }, { highWaterMark: 0 }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Content-Length': badContentLength },
        },
      );
      response.json = jsonSpy as typeof response.json;
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

      await expect(
        client.getCameraApplicationStatus('status-token', siteId, cameraId),
      ).rejects.toMatchObject({ code: 'invalid-response' });
      expect(jsonSpy).not.toHaveBeenCalled();
      expect(pullSpy).not.toHaveBeenCalled();
      expect(cancelSpy).toHaveBeenCalled();
    }

    let pullCount = 0;
    const cancelSpy = vi.fn();
    const chunks = [new Uint8Array(3000).fill(0x20), new Uint8Array(1097).fill(0x20)];
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const next = chunks[pullCount++];
          if (next) controller.enqueue(next);
          else controller.close();
        },
        cancel: cancelSpy,
      },
      { highWaterMark: 0 },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(
      client.getCameraApplicationStatus('status-token', siteId, cameraId),
    ).rejects.toMatchObject({ code: 'invalid-response' });
    expect(pullCount).toBe(2);
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('preserves caller signal and timeoutMs options with a 3000ms default timeout', async () => {
    const client = new SmartSiteManagementClient('https://api.example.test');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      client.getCameraApplicationStatus('status-token', siteId, cameraId, {
        signal: preAborted.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => undefined));
    const duringFetch = new AbortController();
    const stalled = client.getCameraApplicationStatus('status-token', siteId, cameraId, {
      signal: duringFetch.signal,
    });
    duringFetch.abort();
    await expect(stalled).rejects.toMatchObject({ code: 'cancelled' });
    expect(getEventListeners(duringFetch.signal, 'abort')).toEqual([]);

    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));

    let defaultSettled = false;
    const defaultPending = client.getCameraApplicationStatus('status-token', siteId, cameraId);
    const defaultAssertion = expect(defaultPending).rejects.toMatchObject({ code: 'timeout' });
    void defaultPending.then(
      () => (defaultSettled = true),
      () => (defaultSettled = true),
    );

    await vi.advanceTimersByTimeAsync(2999);
    expect(defaultSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await defaultAssertion;

    const customPending = client.getCameraApplicationStatus('status-token', siteId, cameraId, {
      timeoutMs: 1200,
    });
    const customAssertion = expect(customPending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1201);
    await customAssertion;

    vi.useRealTimers();
    fetchMock.mockClear();

    for (const timeoutMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
      await expect(
        client.getCameraApplicationStatus('status-token', siteId, cameraId, { timeoutMs }),
      ).rejects.toThrow(RangeError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
