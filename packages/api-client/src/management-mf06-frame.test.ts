import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient } from './index';

const BASE_URL = 'http://localhost:3000';
const VALID_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SmartSiteManagementClient.getMf06AssessmentFrame', () => {
  it('requests exact encoded path and query with Bearer auth, no-store, redirect error, and signal forwarding', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(VALID_JPEG, { headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetchMock);

    const callerController = new AbortController();
    const client = new SmartSiteManagementClient(BASE_URL);
    const blob = await client.getMf06AssessmentFrame(
      'secret-bearer-token',
      'site/a?b#1',
      'assessment/c&d#2',
      'req/1?x=2&y=3',
      'evt/4#z&w=5',
      { signal: callerController.signal },
    );

    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(VALID_JPEG);
    expect(blob.type).toBe('image/jpeg');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [requestedUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestedUrl).toBe(
      `${BASE_URL}/api/v1/sites/site%2Fa%3Fb%231/mf06-assessments/assessment%2Fc%26d%232/frame?requestId=req%2F1%3Fx%3D2%26y%3D3&eventId=evt%2F4%23z%26w%3D5`,
    );
    expect(requestedUrl).not.toContain('secret-bearer-token');
    expect(init).toMatchObject({
      headers: {
        Accept: 'image/jpeg',
        Authorization: 'Bearer secret-bearer-token',
      },
      cache: 'no-store',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
  });

  it('rejects with cancelled ApiError when caller AbortSignal is aborted', async () => {
    const preAborted = new AbortController();
    preAborted.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const client = new SmartSiteManagementClient(BASE_URL);
    await expect(
      client.getMf06AssessmentFrame(
        'token-1',
        '33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '44444444-4444-4444-8444-444444444444',
        { signal: preAborted.signal },
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves HTTP 403 Forbidden error envelope via ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            success: false,
            statusCode: 403,
            code: 'FORBIDDEN',
            message: 'Forbidden',
            requestId: 'req-frame-err-1',
            timestamp: '2026-10-21T12:00:00.000Z',
            path: '/api/v1/error',
          },
          { status: 403 },
        ),
      ),
    );

    const client = new SmartSiteManagementClient(BASE_URL);
    const forbiddenErr = await client
      .getMf06AssessmentFrame(
        'token-1',
        '33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '44444444-4444-4444-8444-444444444444',
      )
      .catch((error: unknown) => error);

    expect(forbiddenErr).toBeInstanceOf(ApiError);
    expect(forbiddenErr).toMatchObject({
      code: 'http',
      status: 403,
      message: 'Forbidden',
      backendError: expect.objectContaining({
        code: 'FORBIDDEN',
        statusCode: 403,
      }),
    });
  });
});
