// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScopedCameraMedia } from './useScopedCameraMedia';

function visibility(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
}

describe('raw camera retry boundaries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility(false);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    visibility(false);
  });

  const scope = {
    token: 'test-token',
    sessionScope: 'test-session',
    siteId: 'site-a',
    cameraId: 'camera-a',
    cameraExternalId: 'CAM-A',
    isLive: true,
  };

  it.each([401, 403])(
    'retains a %i denial through manual retry, visibility and enable changes',
    async (status) => {
      const client = new SmartSiteManagementClient('http://localhost:3000');
      const stream = vi
        .spyOn(client, 'streamCameraVideo')
        .mockRejectedValue(new ApiError('http', 'Access denied', status));
      const { result, rerender } = renderHook(
        ({ enabled }) => useScopedCameraMedia({ ...scope, client, enabled }),
        { initialProps: { enabled: true } },
      );
      await act(async () => {});
      expect(result.current.status).toBe('HALTED');
      act(() => result.current.retry());
      await act(async () => {});
      visibility(true);
      visibility(false);
      rerender({ enabled: false });
      rerender({ enabled: true });
      await act(async () => vi.advanceTimersByTimeAsync(5000));
      expect(stream).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe('HALTED');
      expect(result.current.errorStatus).toBe(status);
      expect(result.current.image).toBeNull();
    },
  );

  it('preserves Retry-After through manual retry and hidden/shown changes', async () => {
    const client = new SmartSiteManagementClient('http://localhost:3000');
    const stream = vi
      .spyOn(client, 'streamCameraVideo')
      .mockRejectedValueOnce(new ApiError('http', 'Rate limited', 429, undefined, 10))
      .mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useScopedCameraMedia({ ...scope, client }));
    await act(async () => {});
    act(() => result.current.retry());
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    visibility(true);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    visibility(false);
    expect(result.current.errorStatus).toBe(429);
    await act(async () => vi.advanceTimersByTimeAsync(5999));
    expect(stream).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(stream).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('CONNECTING');
  });

  it('resumes once after a deadline elapsed while hidden', async () => {
    const client = new SmartSiteManagementClient('http://localhost:3000');
    const stream = vi
      .spyOn(client, 'streamCameraVideo')
      .mockRejectedValueOnce(new ApiError('http', 'Rate limited', 429, undefined, 3))
      .mockImplementation(() => new Promise(() => {}));
    renderHook(() => useScopedCameraMedia({ ...scope, client }));
    await act(async () => {});
    visibility(true);
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(stream).toHaveBeenCalledTimes(1);
    visibility(false);
    expect(stream).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it('allows new credentials after a denial and clears old error while connecting', async () => {
    const client = new SmartSiteManagementClient('http://localhost:3000');
    const stream = vi
      .spyOn(client, 'streamCameraVideo')
      .mockRejectedValueOnce(new ApiError('http', 'Access denied', 403))
      .mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook(
      ({ token }) => useScopedCameraMedia({ ...scope, client, token }),
      { initialProps: { token: scope.token } },
    );
    await act(async () => {});
    rerender({ token: 'replacement-token' });
    expect(stream).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('CONNECTING');
    expect(result.current.errorStatus).toBeNull();
  });

  it('does not restart an already connecting stream on repeated retry clicks', () => {
    const client = new SmartSiteManagementClient('http://localhost:3000');
    const stream = vi
      .spyOn(client, 'streamCameraVideo')
      .mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useScopedCameraMedia({ ...scope, client }));
    act(() => result.current.retry());
    act(() => result.current.retry());
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
