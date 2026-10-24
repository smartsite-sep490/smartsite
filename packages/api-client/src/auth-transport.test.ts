import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from './management';
import { registerSessionCredential, unregisterSessionCredential } from './session-expiry';

const calls = [
  ['login', (client: SmartSiteManagementClient) => client.login('synthetic', 'Synthetic1!')],
  ['refresh', (client: SmartSiteManagementClient) => client.refresh('WEB')],
  ['logout', (client: SmartSiteManagementClient) => client.logout()],
  ['profile', (client: SmartSiteManagementClient) => client.me('synthetic-token')],
] as const;

const protectedCalls = [
  ['metadata', (client: SmartSiteManagementClient, token: string) => client.listSites(token)],
  [
    'multipart',
    (client: SmartSiteManagementClient, token: string) =>
      client.uploadFaceEnrollmentSample(token, 'synthetic-session', new Blob(['fixture-only'])),
  ],
  [
    'raw-stream',
    (client: SmartSiteManagementClient, token: string) =>
      client.streamCameraVideo(token, 'synthetic-site', 'synthetic-camera', () => {}),
  ],
  [
    'recorded-video',
    (client: SmartSiteManagementClient, token: string) =>
      client.readRecordedCameraVideo(token, 'synthetic-site', 'synthetic-camera'),
  ],
] as const;

it.each(['raw-stream', 'recorded-video'] as const)(
  '%s ignores a late401 after the caller cancels',
  async (kind) => {
    const token = 'synthetic-cancelled-media-token',
      scope = 'opaque-cancelled-media-scope';
    const dispatchEvent = vi.fn();
    const controller = new AbortController();
    let respond!: (response: Response) => void;
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            respond = resolve;
          }),
      ),
    );
    registerSessionCredential(token, scope);
    try {
      const client = new SmartSiteManagementClient('http://localhost:3000');
      const pending =
        kind === 'raw-stream'
          ? client.streamCameraVideo(token, 'synthetic-site', 'synthetic-camera', () => {}, {
              signal: controller.signal,
            })
          : client.readRecordedCameraVideo(token, 'synthetic-site', 'synthetic-camera', {
              signal: controller.signal,
            });
      const outcome = pending.catch((error: unknown) => error);
      controller.abort();
      respond(new Response('', { status: 401 }));
      await expect(outcome).resolves.toMatchObject({ code: 'cancelled' });
      expect(dispatchEvent).not.toHaveBeenCalled();
    } finally {
      unregisterSessionCredential(token, scope);
    }
  },
);

it.each(['raw-stream', 'recorded-video'] as const)(
  '%s ignores a late401 after its connection deadline',
  async (kind) => {
    vi.useFakeTimers();
    const token = 'synthetic-deadline-media-token',
      scope = 'opaque-deadline-media-scope';
    const dispatchEvent = vi.fn();
    let respond!: (response: Response) => void;
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            respond = resolve;
          }),
      ),
    );
    registerSessionCredential(token, scope);
    try {
      const client = new SmartSiteManagementClient('http://localhost:3000');
      const pending =
        kind === 'raw-stream'
          ? client.streamCameraVideo(token, 'synthetic-site', 'synthetic-camera', () => {}, {
              timeoutMs: 1000,
            })
          : client.readRecordedCameraVideo(token, 'synthetic-site', 'synthetic-camera', {
              timeoutMs: 1000,
            });
      const outcome = pending.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1000);
      respond(new Response('', { status: 401 }));
      await expect(outcome).resolves.toMatchObject({ code: 'timeout' });
      expect(dispatchEvent).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      unregisterSessionCredential(token, scope);
    }
  },
);

it.each(protectedCalls)(
  '%s expires a matching session even when401 has no JSON body',
  async (_name, call) => {
    const token = 'synthetic-empty-error-token',
      scope = 'opaque-error-session';
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    registerSessionCredential(token, scope);
    try {
      await expect(
        call(new SmartSiteManagementClient('http://localhost:3000'), token),
      ).rejects.toMatchObject({ code: 'http', status: 401 });
      expect(dispatchEvent).toHaveBeenCalledOnce();
      expect((dispatchEvent.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
        sessionScopes: [scope],
      });
    } finally {
      unregisterSessionCredential(token, scope);
    }
  },
);

it.each(protectedCalls)(
  '%s401 carries only the scope captured before token reuse',
  async (_name, call) => {
    const token = 'synthetic-protected-token';
    const oldScope = 'opaque-old-session';
    const newScope = 'opaque-new-session';
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    let respond!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            respond = resolve;
          }),
      ),
    );
    registerSessionCredential(token, oldScope);
    try {
      const pending = call(new SmartSiteManagementClient('http://localhost:3000'), token);
      const outcome = pending.catch((error: unknown) => error);
      unregisterSessionCredential(token, oldScope);
      registerSessionCredential(token, newScope);
      respond(Response.json({ message: 'Unauthorized' }, { status: 401 }));
      await expect(outcome).resolves.toMatchObject({ code: 'http', status: 401 });
      expect(dispatchEvent).toHaveBeenCalledOnce();
      const event = dispatchEvent.mock.calls[0]?.[0] as CustomEvent;
      expect(event.detail).toEqual({ sessionScopes: [oldScope] });
      expect(JSON.stringify(event.detail)).not.toContain(token);
    } finally {
      unregisterSessionCredential(token, oldScope);
      unregisterSessionCredential(token, newScope);
    }
  },
);

it.each(protectedCalls)('%s401 still identifies the current session', async (_name, call) => {
  const token = 'synthetic-current-protected-token';
  const scope = 'opaque-current-session';
  const dispatchEvent = vi.fn();
  vi.stubGlobal('window', { dispatchEvent });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ message: 'Unauthorized' }, { status: 401 })),
  );
  registerSessionCredential(token, scope);
  try {
    await expect(
      call(new SmartSiteManagementClient('http://localhost:3000'), token),
    ).rejects.toMatchObject({ status: 401 });
    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect((dispatchEvent.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      sessionScopes: [scope],
    });
  } finally {
    unregisterSessionCredential(token, scope);
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each(['timeout', 'cancel'] as const)(
  'multipart %s settles even if the fetch adapter ignores abort',
  async (mode) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetch);
    const settled = vi.fn();
    const options = mode === 'timeout' ? { timeoutMs: 1000 } : { signal: controller.signal };
    void new SmartSiteManagementClient('http://localhost:3000')
      .safetyTaskCommand(
        'synthetic-token',
        'synthetic-site',
        'synthetic-task',
        'submit',
        {
          commandId: '62c8fb53-3205-420e-a7bf-24d4a20199af',
          expectedVersion: 1,
          resultDescription: 'Synthetic transport cancellation fixture',
        },
        undefined,
        options,
      )
      .then(settled, settled);
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(1000);
    else {
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(settled).toHaveBeenCalledWith(
      expect.objectContaining({ code: mode === 'timeout' ? 'timeout' : 'cancelled' }),
    );
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    const submitted = fetch.mock.calls[0]?.[1]?.body as FormData;
    expect(submitted.get('commandId')).toBe('62c8fb53-3205-420e-a7bf-24d4a20199af');
    expect(submitted.get('resultDescription')).toBe('Synthetic transport cancellation fixture');
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('profile refresh bypasses a cached account snapshot', async () => {
  const oldProfile = { roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'old-site' }] };
  const currentProfile = {
    roleAssignments: [{ role: 'SECURITY_OFFICER', siteId: 'current-site' }],
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) =>
    Response.json(init?.cache === 'no-store' ? currentProfile : oldProfile),
  );
  vi.stubGlobal('fetch', fetch);
  const profile = await new SmartSiteManagementClient('http://localhost:3000').me(
    'synthetic-token',
  );
  expect(profile).toEqual(currentProfile);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]?.[1]?.cache).toBe('no-store');
});

it.each(calls)(
  '%s rejects401 without globally expiring a potentially newer session',
  async (_name, call) => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ message: 'Unauthorized' }, { status: 401 })),
    );
    await expect(
      call(new SmartSiteManagementClient('http://localhost:3000')),
    ).rejects.toMatchObject({ code: 'http', status: 401 });
    expect(dispatchEvent).not.toHaveBeenCalled();
  },
);

it.each(calls)(
  '%s cannot wait forever for response headers, including an adapter ignoring abort',
  async (_name, call) => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetch);
    const settled = vi.fn();
    void call(new SmartSiteManagementClient('http://localhost:3000')).then(settled, settled);
    await vi.advanceTimersByTimeAsync(9999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ code: 'timeout' }));
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it.each(calls)(
  '%s deadline also covers a JSON body parser that ignores abort',
  async (_name, call) => {
    vi.useFakeTimers();
    const response = new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    vi.spyOn(response, 'json').mockImplementation(() => new Promise(() => {}));
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetch);
    const settled = vi.fn();
    void call(new SmartSiteManagementClient('http://localhost:3000')).then(settled, settled);
    await vi.advanceTimersByTimeAsync(10000);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ code: 'timeout' }));
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  },
);
