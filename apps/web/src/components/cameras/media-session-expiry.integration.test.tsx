// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { AuthProvider, useAuth } from '../../features/auth/auth-session';
import { useScopedCameraMedia } from './useScopedCameraMedia';
import { useScopedRecordedVideo } from './useScopedRecordedVideo';

const siteId = '11111111-1111-4111-8111-111111111111';
const cameraId = '22222222-2222-4222-8222-222222222222';

describe('media session expiry integration (AuthProvider + camera media hooks)', () => {
  let queryClient: QueryClient;
  let mockClient: SmartSiteManagementClient;
  let createdUrls: string[];
  let revokedUrls: string[];

  const originalImage = globalThis.Image;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );

  beforeEach(() => {
    sessionStorage.clear();
    createdUrls = [];
    revokedUrls = [];

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    mockClient = new SmartSiteManagementClient('http://localhost:3000');

    class MockImage {
      src = '';
      naturalWidth = 640;
      naturalHeight = 480;
      decode() {
        return Promise.resolve();
      }
    }
    globalThis.Image = MockImage as unknown as typeof Image;

    URL.createObjectURL = vi.fn().mockImplementation((blob: Blob) => {
      expect(blob).toBeInstanceOf(Blob);
      const url = `blob:http://localhost:3000/${createdUrls.length + 1}`;
      createdUrls.push(url);
      return url;
    });

    URL.revokeObjectURL = vi.fn().mockImplementation((url: string) => {
      revokedUrls.push(url);
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    globalThis.Image = originalImage;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it.each(['rotation', 'reuse'] as const)(
    'does not expire a newer AuthProvider session when a raw media stream held on old controlled props returns 401 after credential %s',
    async (mode) => {
      const oldToken =
        mode === 'rotation' ? 'synthetic-raw-old-token' : 'synthetic-raw-reused-token';
      const newToken =
        mode === 'rotation' ? 'synthetic-raw-new-token' : 'synthetic-raw-reused-token';

      let rejectStream!: (error: unknown) => void;
      let streamPromise!: Promise<void>;
      let capturedSignal: AbortSignal | undefined;
      const streamSpy = vi
        .spyOn(mockClient, 'streamCameraVideo')
        .mockImplementation((_token, _site, _camera, _onFrame, options) => {
          capturedSignal = options?.signal;
          streamPromise = new Promise<void>((_resolve, reject) => {
            rejectStream = reject;
          });
          return streamPromise;
        });

      const { result, rerender, unmount } = renderHook(
        ({
          controlledToken,
          controlledScope,
        }: {
          controlledToken?: string | null;
          controlledScope?: string | null;
        }) => {
          const auth = useAuth();
          const media = useScopedCameraMedia({
            client: mockClient,
            token: controlledToken !== undefined ? controlledToken : auth.accessToken,
            sessionScope: controlledScope !== undefined ? controlledScope : auth.sessionScope,
            siteId,
            cameraId,
            cameraExternalId: 'CAM-01',
            isLive: true,
            enabled: true,
          });
          return { auth, media };
        },
        {
          wrapper,
          initialProps: {},
        },
      );

      act(() => {
        result.current.auth.setAccessToken(oldToken);
      });

      const oldScope = result.current.auth.sessionScope;
      expect(oldScope).toBeTruthy();
      expect(result.current.media.status).toBe('CONNECTING');
      expect(streamSpy).toHaveBeenCalledTimes(1);
      expect(capturedSignal?.aborted).toBe(false);

      // Keep the raw media hook on the old controlled props while AuthProvider rotates/reuses token scope
      rerender({
        controlledToken: oldToken,
        controlledScope: oldScope,
      });
      expect(streamSpy).toHaveBeenCalledTimes(1);
      expect(capturedSignal?.aborted).toBe(false);

      act(() => {
        result.current.auth.setAccessToken(newToken);
      });

      const newScope = result.current.auth.sessionScope;
      expect(newScope).toBeTruthy();
      expect(newScope).not.toBe(oldScope);
      expect(result.current.auth.accessToken).toBe(newToken);
      expect(result.current.auth.isSessionExpired).toBe(false);
      expect(result.current.media.status).toBe('CONNECTING');
      expect(capturedSignal?.aborted).toBe(false);

      await act(async () => {
        rejectStream(new ApiError('http', 'Unauthorized camera stream', 401));
        await streamPromise.catch(() => undefined);
      });

      expect(result.current.media.status).toBe('HALTED');
      expect(result.current.media.errorStatus).toBe(401);
      expect(result.current.media.image).toBeNull();
      expect(result.current.media.frame).toBeNull();
      expect(result.current.auth.accessToken).toBe(newToken);
      expect(result.current.auth.sessionScope).toBe(newScope);
      expect(result.current.auth.isSessionExpired).toBe(false);

      unmount();
    },
  );

  it('expires the current AuthProvider session when a matching raw media stream returns 401', async () => {
    let rejectStream!: (error: unknown) => void;
    let streamPromise!: Promise<void>;
    const streamSpy = vi.spyOn(mockClient, 'streamCameraVideo').mockImplementation(() => {
      streamPromise = new Promise<void>((_resolve, reject) => {
        rejectStream = reject;
      });
      return streamPromise;
    });

    const { result, rerender, unmount } = renderHook(
      ({
        controlledToken,
        controlledScope,
      }: {
        controlledToken?: string | null;
        controlledScope?: string | null;
      }) => {
        const auth = useAuth();
        const media = useScopedCameraMedia({
          client: mockClient,
          token: controlledToken !== undefined ? controlledToken : auth.accessToken,
          sessionScope: controlledScope !== undefined ? controlledScope : auth.sessionScope,
          siteId,
          cameraId,
          cameraExternalId: 'CAM-01',
          isLive: true,
          enabled: true,
        });
        return { auth, media };
      },
      {
        wrapper,
        initialProps: {},
      },
    );

    const activeToken = 'synthetic-current-raw-token';
    act(() => {
      result.current.auth.setAccessToken(activeToken);
    });

    const activeScope = result.current.auth.sessionScope;
    expect(activeScope).toBeTruthy();
    expect(result.current.media.status).toBe('CONNECTING');
    expect(streamSpy).toHaveBeenCalledTimes(1);

    rerender({
      controlledToken: activeToken,
      controlledScope: activeScope,
    });
    queryClient.setQueryData(['safety-alert-evidence', activeScope], new Blob(['private-fixture']));

    await act(async () => {
      rejectStream(new ApiError('http', 'Unauthorized camera stream', 401));
      await streamPromise.catch(() => undefined);
    });

    expect(result.current.auth.accessToken).toBeNull();
    expect(result.current.auth.sessionScope).toBe('');
    expect(result.current.auth.isSessionExpired).toBe(true);
    expect(queryClient.getQueryData(['safety-alert-evidence', activeScope])).toBeUndefined();
    expect(result.current.media.status).toBe('HALTED');
    expect(result.current.media.errorStatus).toBe(401);
    expect(result.current.media.image).toBeNull();
    expect(result.current.media.frame).toBeNull();

    unmount();
  });

  it('expires the current AuthProvider session, retains no video URL, and halts when a matching recorded video fetch returns 401', async () => {
    let rejectVideo!: (error: unknown) => void;
    let videoPromise!: Promise<Blob>;
    const readSpy = vi.spyOn(mockClient, 'readRecordedCameraVideo').mockImplementation(() => {
      videoPromise = new Promise<Blob>((_resolve, reject) => {
        rejectVideo = reject;
      });
      return videoPromise;
    });

    const { result, rerender, unmount } = renderHook(
      ({
        controlledToken,
        controlledScope,
      }: {
        controlledToken?: string | null;
        controlledScope?: string | null;
      }) => {
        const auth = useAuth();
        const video = useScopedRecordedVideo({
          client: mockClient,
          token: controlledToken !== undefined ? controlledToken : auth.accessToken,
          sessionScope: controlledScope !== undefined ? controlledScope : auth.sessionScope,
          siteId,
          cameraId,
          cameraExternalId: 'core5-recorded-demo',
          isRecorded: true,
          enabled: true,
        });
        return { auth, video };
      },
      {
        wrapper,
        initialProps: {},
      },
    );

    const activeToken = 'synthetic-current-recorded-token';
    act(() => {
      result.current.auth.setAccessToken(activeToken);
    });

    const activeScope = result.current.auth.sessionScope;
    expect(activeScope).toBeTruthy();
    expect(result.current.video.status).toBe('LOADING');
    expect(readSpy).toHaveBeenCalledTimes(1);

    rerender({
      controlledToken: activeToken,
      controlledScope: activeScope,
    });
    queryClient.setQueryData(['safety-alert-evidence', activeScope], new Blob(['private-fixture']));

    await act(async () => {
      rejectVideo(new ApiError('http', 'Unauthorized recorded video access', 401));
      await videoPromise.catch(() => undefined);
    });

    expect(result.current.video.status).toBe('HALTED');
    expect(result.current.video.errorStatus).toBe(401);
    expect(result.current.video.videoUrl).toBeNull();
    expect(createdUrls).toHaveLength(0);

    act(() => {
      result.current.video.retry();
    });
    expect(readSpy).toHaveBeenCalledTimes(1);

    expect(result.current.auth.accessToken).toBeNull();
    expect(result.current.auth.sessionScope).toBe('');
    expect(result.current.auth.isSessionExpired).toBe(true);
    expect(queryClient.getQueryData(['safety-alert-evidence', activeScope])).toBeUndefined();

    unmount();
  });

  it.each(['rotation', 'reuse'] as const)(
    'does not expire a newer AuthProvider session when a recorded video fetch held on old controlled props returns 401 after credential %s',
    async (mode) => {
      const oldToken =
        mode === 'rotation'
          ? 'synthetic-recorded-old-token'
          : 'synthetic-recorded-reused-token';
      const newToken =
        mode === 'rotation'
          ? 'synthetic-recorded-new-token'
          : 'synthetic-recorded-reused-token';

      let rejectVideo!: (error: unknown) => void;
      let videoPromise!: Promise<Blob>;
      let capturedSignal: AbortSignal | undefined;
      const readSpy = vi
        .spyOn(mockClient, 'readRecordedCameraVideo')
        .mockImplementation((_token, _site, _camera, options) => {
          capturedSignal = options?.signal;
          videoPromise = new Promise<Blob>((_resolve, reject) => {
            rejectVideo = reject;
          });
          return videoPromise;
        });

      const { result, rerender, unmount } = renderHook(
        ({
          controlledToken,
          controlledScope,
        }: {
          controlledToken?: string | null;
          controlledScope?: string | null;
        }) => {
          const auth = useAuth();
          const video = useScopedRecordedVideo({
            client: mockClient,
            token: controlledToken !== undefined ? controlledToken : auth.accessToken,
            sessionScope: controlledScope !== undefined ? controlledScope : auth.sessionScope,
            siteId,
            cameraId,
            cameraExternalId: 'core5-recorded-demo',
            isRecorded: true,
            enabled: true,
          });
          return { auth, video };
        },
        {
          wrapper,
          initialProps: {},
        },
      );

      act(() => {
        result.current.auth.setAccessToken(oldToken);
      });

      const oldScope = result.current.auth.sessionScope;
      expect(oldScope).toBeTruthy();
      expect(result.current.video.status).toBe('LOADING');
      expect(readSpy).toHaveBeenCalledTimes(1);
      expect(capturedSignal?.aborted).toBe(false);

      // Keep the recorded video hook on the old controlled props while AuthProvider rotates/reuses token scope
      rerender({
        controlledToken: oldToken,
        controlledScope: oldScope,
      });
      expect(readSpy).toHaveBeenCalledTimes(1);
      expect(capturedSignal?.aborted).toBe(false);

      act(() => {
        result.current.auth.setAccessToken(newToken);
      });

      const newScope = result.current.auth.sessionScope;
      expect(newScope).toBeTruthy();
      expect(newScope).not.toBe(oldScope);
      expect(result.current.auth.accessToken).toBe(newToken);
      expect(result.current.auth.isSessionExpired).toBe(false);
      expect(result.current.video.status).toBe('LOADING');
      expect(capturedSignal?.aborted).toBe(false);

      await act(async () => {
        rejectVideo(new ApiError('http', 'Unauthorized recorded video access', 401));
        await videoPromise.catch(() => undefined);
      });

      expect(result.current.video.status).toBe('HALTED');
      expect(result.current.video.errorStatus).toBe(401);
      expect(result.current.video.videoUrl).toBeNull();
      expect(createdUrls).toHaveLength(0);
      expect(result.current.auth.accessToken).toBe(newToken);
      expect(result.current.auth.sessionScope).toBe(newScope);
      expect(result.current.auth.isSessionExpired).toBe(false);

      unmount();
    },
  );
});
