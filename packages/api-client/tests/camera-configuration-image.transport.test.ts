import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';
const siteId = '11111111-1111-4111-8111-111111111111';
const cameraId = '22222222-2222-4222-8222-222222222222';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('configuration image bounded transport regressions', () => {
  it('closes the discarded 401 stream when a session refresh retries a bounded image read', async () => {
    const cancel = vi.fn(),
      refreshAccessToken = vi.fn(async () => 'new');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic source unavailable' },
          { status: 503 },
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    const onUnauthorized = vi.fn();
    const client = new SmartSiteManagementClient('https://api.example.test', {
      getAccessToken: () => 'old',
      refreshAccessToken,
      onUnauthorized,
      signal: new AbortController().signal,
    });
    await expect(client.getCameraConfigurationImage('old', siteId, cameraId)).rejects.toMatchObject(
      { code: 'http', status: 503 },
    );
    expect(refreshAccessToken).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
  it('refuses a non-JSON MIME before consuming body and never falls back to an unbounded text reader', async () => {
    const client = new SmartSiteManagementClient('https://api.example.test');
    const cancel = vi.fn();
    const pull = vi.fn();
    const response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
      headers: { 'Content-Type': 'text/html' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(
      client.getCameraConfigurationImage('token', siteId, cameraId, { timeoutMs: 30 }),
    ).rejects.toMatchObject({ code: 'invalid-response' });
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    const text = vi.fn(async () => 'private-sentinel');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body: null,
        text,
      }),
    );
    await expect(
      client.getCameraConfigurationImage('token', siteId, cameraId),
    ).rejects.toMatchObject({ code: 'invalid-response' });
    expect(text).not.toHaveBeenCalled();
  });

  it('bounds unsuccessful bodies too while retaining stable HTTP status and Retry-After', async () => {
    const client = new SmartSiteManagementClient('https://api.example.test');
    const cancel = vi.fn();
    const pull = vi.fn();
    const response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '1500001',
        'Retry-After': '7',
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(
      client.getCameraConfigurationImage('token', siteId, cameraId, { timeoutMs: 30 }),
    ).rejects.toMatchObject({ code: 'http', status: 503, retryAfterSeconds: 7 });
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });

  it('cancels a late response body when fetch ignores caller cancellation', async () => {
    const client = new SmartSiteManagementClient('https://api.example.test');
    let release!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const caller = new AbortController();
    const pending = client.getCameraConfigurationImage('token', siteId, cameraId, {
      signal: caller.signal,
    });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    caller.abort();
    await rejected;
    const cancel = vi.fn();
    release(new Response(new ReadableStream({ cancel }, { highWaterMark: 0 })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalled();
  });
});
