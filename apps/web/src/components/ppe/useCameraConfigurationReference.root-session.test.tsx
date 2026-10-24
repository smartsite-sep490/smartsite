// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, type ManagementSession } from '@smartsite/api-client';
import { useCameraConfigurationReference } from './useCameraConfigurationReference';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const siteId = '11111111-1111-4111-8111-111111111111';
const cameraId = '22222222-2222-4222-8222-222222222222';
const jpeg = Buffer.from([
  255, 216, 255, 192, 0, 17, 8, 0, 80, 0, 120, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217,
]).toString('base64');

function fixture() {
  const controller = new AbortController();
  let token = 'synthetic-old';
  const session: ManagementSession = {
    signal: controller.signal,
    getAccessToken: vi.fn(() => token),
    refreshAccessToken: vi.fn(async () => (token = 'synthetic-new')),
    onUnauthorized: vi.fn(),
  };
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      naturalWidth = 120;
      naturalHeight = 80;
      decode = async () => undefined;
    },
  );
  const client = new SmartSiteManagementClient('https://api.example.test', session);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const hook = renderHook(
    ({ client }) =>
      useCameraConfigurationReference({
        apiUrl: 'https://api.example.test',
        token: 'synthetic-old',
        sessionScope: 'fixture-session',
        credentialId: 1,
        siteId,
        cameraId,
        cameraExternalId: 'fixture-camera',
        enabled: true,
        client,
      }),
    {
      initialProps: { client },
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: cache }, children),
    },
  );
  return { controller, session, ...hook };
}

function imageResponse() {
  const now = Date.now();
  return Response.json({
    siteId,
    cameraId,
    schemaVersion: 1,
    purpose: 'REGION_CONFIGURATION',
    configurationVersion: 1,
    sourceKind: 'LIVE',
    referenceExpiresAt: new Date(now + 300_000).toISOString(),
    frame: {
      cameraExternalId: 'fixture-camera',
      width: 120,
      height: 80,
      sessionId: '33333333-3333-4333-8333-333333333333',
      sequenceNumber: '1',
      capturedAt: new Date(now).toISOString(),
      imageDataUrl: `data:image/jpeg;base64,${jpeg}`,
      imageSha256: 'a'.repeat(64),
    },
  });
}

it('refreshes through the supplied owning client before decoding the explicit reference', async () => {
  const seen: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const auth = new Headers(init.headers).get('Authorization') ?? '';
      seen.push(auth);
      return auth === 'Bearer synthetic-old' ? Response.json({}, { status: 401 }) : imageResponse();
    }),
  );
  const { result, session } = fixture();
  await act(async () => {
    await result.current.request();
  });
  expect(seen).toEqual(['Bearer synthetic-old', 'Bearer synthetic-new']);
  expect(session.refreshAccessToken).toHaveBeenCalledExactlyOnceWith('synthetic-old');
  expect(result.current.reference?.cameraId).toBe(cameraId);
  expect(result.current.reference?.image.src).toBe(`data:image/jpeg;base64,${jpeg}`);
  expect(session.onUnauthorized).not.toHaveBeenCalled();
});

it('settles a pending reference on owning-session abort without publishing late pixels', async () => {
  let release!: (value: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const { result, controller } = fixture();
  let settled = false;
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.request().finally(() => {
      settled = true;
    });
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  controller.abort();
  try {
    await waitFor(() => expect(settled).toBe(true), { timeout: 250 });
    expect(result.current.reference).toBeNull();
  } finally {
    release(imageResponse());
    await act(async () => {
      await pending;
    });
  }
});

it('clears decoded pixels when the client changes without a token or camera change', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => imageResponse()),
  );
  const { result, rerender } = fixture();
  await act(async () => {
    await result.current.request();
  });
  const image = result.current.reference!.image;
  rerender({ client: new SmartSiteManagementClient('https://api.example.test') });
  expect(result.current.reference).toBeNull();
  expect(image.src).toBe('');
});

it('cancels an old client reference request and ignores a response arriving after replacement', async () => {
  let release!: (value: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const { result, rerender } = fixture();
  let settled = false;
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.request().finally(() => {
      settled = true;
    });
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  rerender({ client: new SmartSiteManagementClient('https://api.example.test') });
  try {
    await waitFor(() => expect(settled).toBe(true), { timeout: 250 });
  } finally {
    release(imageResponse());
    await act(async () => {
      await pending;
    });
  }
  expect(result.current.reference).toBeNull();
});
