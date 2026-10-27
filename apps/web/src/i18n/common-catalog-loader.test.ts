import { describe, expect, it, vi } from 'vitest';
import { createCommonCatalogLoader } from './common-catalog-loader';

type CommonCatalogs = {
  en: Record<string, string>;
  vi: Record<string, string>;
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const sampleCatalogs: CommonCatalogs = {
  en: { 'common.loading': 'Loading...', 'common.retry': 'Retry' },
  vi: { 'common.loading': 'Đang tải...', 'common.retry': 'Thử lại' },
};

describe('createCommonCatalogLoader', () => {
  it('shares the same in-flight promise across concurrent callers and applies catalogs only after load resolves', async () => {
    const deferred = createDeferred<CommonCatalogs>();
    const load = vi.fn(() => deferred.promise);
    const events: string[] = [];
    const apply = vi.fn((catalogs: CommonCatalogs) => {
      events.push(`apply:${catalogs.en['common.loading']}:${catalogs.vi['common.loading']}`);
    });

    const ensureCommonCatalogs = createCommonCatalogLoader(load, apply);

    const firstCall = ensureCommonCatalogs().then(() => {
      events.push('firstResolved');
    });
    const secondCall = ensureCommonCatalogs();

    expect(load).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();

    // Concurrent calls while pending must return the exact same underlying promise
    const pendingA = ensureCommonCatalogs();
    const pendingB = ensureCommonCatalogs();
    expect(pendingA).toBe(pendingB);
    expect(secondCall).toBe(pendingA);
    expect(load).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();

    deferred.resolve(sampleCatalogs);
    await Promise.all([firstCall, secondCall, pendingA, pendingB]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(sampleCatalogs);
    expect(events).toEqual(['apply:Loading...:Đang tải...', 'firstResolved']);
  });

  it('caches a completed load so subsequent calls neither re-fetch nor re-apply catalogs', async () => {
    const load = vi.fn(async () => sampleCatalogs);
    const apply = vi.fn();

    const ensureCommonCatalogs = createCommonCatalogLoader(load, apply);

    await ensureCommonCatalogs();
    expect(load).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(sampleCatalogs);

    await ensureCommonCatalogs();
    await ensureCommonCatalogs();

    expect(load).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('does not apply catalogs when load rejects and permits a subsequent call to retry and succeed', async () => {
    const firstAttempt = createDeferred<CommonCatalogs>();
    const secondAttempt = createDeferred<CommonCatalogs>();
    const load = vi
      .fn<() => Promise<CommonCatalogs>>()
      .mockReturnValueOnce(firstAttempt.promise)
      .mockReturnValueOnce(secondAttempt.promise);
    const apply = vi.fn();

    const ensureCommonCatalogs = createCommonCatalogLoader(load, apply);

    const callA = ensureCommonCatalogs();
    const callB = ensureCommonCatalogs();
    expect(callA).toBe(callB);
    expect(load).toHaveBeenCalledTimes(1);

    const networkFailure = new Error('catalog-chunk-fetch-failed');
    firstAttempt.reject(networkFailure);

    await expect(callA).rejects.toThrow('catalog-chunk-fetch-failed');
    await expect(callB).rejects.toThrow('catalog-chunk-fetch-failed');
    expect(apply).not.toHaveBeenCalled();

    const retryCall = ensureCommonCatalogs();
    expect(retryCall).not.toBe(callA);
    expect(load).toHaveBeenCalledTimes(2);
    expect(apply).not.toHaveBeenCalled();

    secondAttempt.resolve(sampleCatalogs);
    await retryCall;

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(sampleCatalogs);
  });

  it('rejects and clears cached state when apply throws so a later call can retry cleanly', async () => {
    const secondCatalogs: CommonCatalogs = {
      en: { 'common.loading': 'Loading v2...' },
      vi: { 'common.loading': 'Đang tải v2...' },
    };
    const load = vi
      .fn<() => Promise<CommonCatalogs>>()
      .mockResolvedValueOnce(sampleCatalogs)
      .mockResolvedValueOnce(secondCatalogs);
    const applyError = new Error('i18n-resource-bundle-registration-failed');
    const apply = vi
      .fn<(catalogs: CommonCatalogs) => void>()
      .mockImplementationOnce(() => {
        throw applyError;
      })
      .mockImplementationOnce(() => {});

    const ensureCommonCatalogs = createCommonCatalogLoader(load, apply);

    await expect(ensureCommonCatalogs()).rejects.toThrow(
      'i18n-resource-bundle-registration-failed',
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenNthCalledWith(1, sampleCatalogs);

    await ensureCommonCatalogs();
    expect(load).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(2, secondCatalogs);

    await ensureCommonCatalogs();
    expect(load).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
