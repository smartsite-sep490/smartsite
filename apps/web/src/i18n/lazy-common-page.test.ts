import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const runtimeMocks = vi.hoisted(() => ({
  ensureCommonCatalogs: vi.fn<() => Promise<void>>(),
}));

vi.mock('./runtime', () => ({
  ensureCommonCatalogs: runtimeMocks.ensureCommonCatalogs,
}));

import { loadWithCommonCatalogs } from './lazy-common-page';

describe('loadWithCommonCatalogs catalog-before-page ordering', () => {
  beforeEach(() => {
    runtimeMocks.ensureCommonCatalogs.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not invoke page module factory while ensureCommonCatalogs is pending and resolves exact module object after catalogs finish', async () => {
    const catalogDeferred = createDeferred<void>();
    const moduleDeferred = createDeferred<{ default: () => string }>();
    const events: string[] = [];
    const expectedModule = { default: () => 'DashboardView' };

    runtimeMocks.ensureCommonCatalogs.mockReturnValueOnce(catalogDeferred.promise);
    const pageFactory = vi.fn(() => {
      events.push('pageFactory:called');
      return moduleDeferred.promise;
    });

    const resultPromise = loadWithCommonCatalogs(pageFactory);
    await Promise.resolve();

    expect(runtimeMocks.ensureCommonCatalogs).toHaveBeenCalledTimes(1);
    expect(pageFactory).not.toHaveBeenCalled();
    expect(events).toEqual([]);

    events.push('catalogs:resolved');
    catalogDeferred.resolve();
    await catalogDeferred.promise;
    await Promise.resolve();

    expect(pageFactory).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['catalogs:resolved', 'pageFactory:called']);

    moduleDeferred.resolve(expectedModule);
    const actualModule = await resultPromise;
    expect(actualModule).toBe(expectedModule);
  });

  it('rejects with the exact catalog error and never invokes page module factory when ensureCommonCatalogs rejects', async () => {
    const catalogDeferred = createDeferred<void>();
    const catalogError = new Error('CommonCatalogLoadError: failed to load locale bundle');

    runtimeMocks.ensureCommonCatalogs.mockReturnValueOnce(catalogDeferred.promise);
    const pageFactory = vi.fn(() => Promise.resolve({ default: () => 'UnreachableView' }));

    const resultPromise = loadWithCommonCatalogs(pageFactory);
    const rejectionAssertion = expect(resultPromise).rejects.toBe(catalogError);

    expect(runtimeMocks.ensureCommonCatalogs).toHaveBeenCalledTimes(1);
    expect(pageFactory).not.toHaveBeenCalled();

    catalogDeferred.reject(catalogError);
    await rejectionAssertion;

    expect(pageFactory).not.toHaveBeenCalled();
  });

  it('propagates page module factory rejection only after ensureCommonCatalogs has completed', async () => {
    const catalogDeferred = createDeferred<void>();
    const moduleDeferred = createDeferred<{ default: () => string }>();
    const events: string[] = [];
    const pageError = new Error('PageChunkLoadError: failed to fetch dynamically imported module');

    runtimeMocks.ensureCommonCatalogs.mockImplementationOnce(async () => {
      events.push('ensure:start');
      await catalogDeferred.promise;
      events.push('ensure:done');
    });

    const pageFactory = vi.fn(() => {
      events.push('pageFactory:called');
      return moduleDeferred.promise;
    });

    const resultPromise = loadWithCommonCatalogs(pageFactory);
    const rejectionAssertion = expect(resultPromise).rejects.toBe(pageError);
    await Promise.resolve();

    expect(events).toEqual(['ensure:start']);
    expect(pageFactory).not.toHaveBeenCalled();

    catalogDeferred.resolve();
    await catalogDeferred.promise;
    await Promise.resolve();

    expect(events).toEqual(['ensure:start', 'ensure:done', 'pageFactory:called']);
    expect(pageFactory).toHaveBeenCalledTimes(1);

    moduleDeferred.reject(pageError);
    await rejectionAssertion;
  });
});
