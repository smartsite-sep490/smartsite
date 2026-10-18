// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from './locales/en.json';
import viCatalog from './locales/vi.json';

beforeEach(() => {
  // No React render in this file: exercise a fresh production runtime initialization.
  vi.resetModules();
  localStorage.clear();
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-GB']);
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it('starts with boot strings only, then installs both complete canonical catalogs through the page gate', async () => {
  const runtime = await import('./runtime');
  const i18n = runtime.default;
  expect(Object.keys(i18n.getResourceBundle('en', 'common'))).toHaveLength(41);
  expect(i18n.exists('notifications.absent_message')).toBe(false);
  expect(runtime.translate('common.loading')).toBe(en['common.loading']);
  expect(document.title).toBe(en['app.documentTitle']);

  await runtime.ensureCommonCatalogs();

  expect(i18n.getResourceBundle('en', 'common')).toEqual(en);
  expect(i18n.getResourceBundle('vi', 'common')).toEqual(viCatalog);
  expect(runtime.translate('notifications.absent_message')).toBe(
    en['notifications.absent_message'],
  );
  const boot = (await import('./boot-catalogs.json')).default;
  expect(Object.keys(boot.en)).toHaveLength(41);
});

it('retains the latest selected language and Safety resources when common catalogs finish loading', async () => {
  const runtime = await import('./runtime');
  runtime.registerCoreSafetyCatalog(
    { 'fixture.safety': 'Safety {count}' },
    { 'fixture.safety': 'An toàn {count}' },
  );
  let complete = false;
  const pending = runtime.ensureCommonCatalogs().then(() => {
    complete = true;
  });
  expect(complete).toBe(false);
  runtime.changeUiLanguage('vi');
  expect(runtime.uiLanguage()).toBe('vi');

  await pending;

  expect(runtime.uiLanguage()).toBe('vi');
  expect(document.documentElement.lang).toBe('vi');
  expect(document.title).toBe(viCatalog['app.documentTitle']);
  expect(runtime.translate('notifications.absent_message')).toBe(
    viCatalog['notifications.absent_message'],
  );
  expect(runtime.translateSafetyNamespaceKey('vi', 'fixture.safety', { count: 2 })).toBe(
    'An toàn 2',
  );
  runtime.changeUiLanguage('en');
  expect(runtime.translate('notifications.absent_message')).toBe(
    en['notifications.absent_message'],
  );
});

it('preserves browser-language fallback with blocked storage before and after the real common load', async () => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('vi-VN');
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['vi-VN']);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Blocked storage', 'SecurityError');
  });
  const runtime = await import('./runtime');
  expect(runtime.uiLanguage()).toBe('vi');
  expect(runtime.translate('common.loading')).toBe(viCatalog['common.loading']);
  await runtime.ensureCommonCatalogs();
  expect(runtime.uiLanguage()).toBe('vi');
  expect(runtime.translate('notifications.absent_message')).toBe(
    viCatalog['notifications.absent_message'],
  );
});
