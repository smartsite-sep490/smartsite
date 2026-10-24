import { lazy } from 'react';
import { ensureCommonCatalogs } from './runtime';

export async function loadWithCommonCatalogs<T>(loadModule: () => Promise<T>): Promise<T> {
  await ensureCommonCatalogs();
  return loadModule();
}

export const lazyWithCommonCatalogs: typeof lazy = (loadModule) =>
  lazy(() => loadWithCommonCatalogs(loadModule));
