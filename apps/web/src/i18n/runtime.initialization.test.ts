// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('vi-VN');
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['vi-VN']);
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it('initialization migrates a valid legacy preference before browser detection', async () => {
  localStorage.setItem('smartsite.locale', 'en');
  const runtime = await import('./runtime');
  expect(runtime.uiLanguage()).toBe('en');
  expect(localStorage.getItem('smartsite-language')).toBe('en');
  expect(localStorage.getItem('smartsite.locale')).toBe('en');
});

it('initialization preserves valid canonical preference over legacy and browser preference', async () => {
  localStorage.setItem('smartsite-language', 'en');
  localStorage.setItem('smartsite.locale', 'vi');
  const runtime = await import('./runtime');
  expect(runtime.uiLanguage()).toBe('en');
  expect(localStorage.getItem('smartsite.locale')).toBe('vi');
});

it('invalid canonical preference does not block supported navigator language', async () => {
  localStorage.setItem('smartsite-language', 'invalid-lang');
  const runtime = await import('./runtime');
  expect(runtime.uiLanguage()).toBe('vi');
  expect(document.documentElement.lang).toBe('vi');
});

it('initialization survives a blocked localStorage getter with navigator fallback', async () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('Blocked storage', 'SecurityError');
  });
  const runtime = await import('./runtime');
  expect(runtime.uiLanguage()).toBe('vi');
  expect(document.documentElement.lang).toBe('vi');
});

it('initialization survives localStorage reads failing after the capability probe succeeds', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Blocked read', 'SecurityError');
  });
  const runtime = await import('./runtime');
  expect(runtime.uiLanguage()).toBe('vi');
  expect(document.documentElement.lang).toBe('vi');
});
