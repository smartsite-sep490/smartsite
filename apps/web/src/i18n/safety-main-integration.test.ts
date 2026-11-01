// @vitest-environment jsdom
import { expect, it } from 'vitest';
import mainI18n from './index';
import safetyI18n, {
  changeUiLanguage,
  registerCoreSafetyCatalog,
  registerFeatureSafetyCatalog,
  translateSafetyNamespaceKey,
} from './runtime';

it('registers isolated Safety resources on the existing Main language instance', async () => {
  const original = structuredClone(mainI18n.getResourceBundle('en', 'common'));
  const originalVi = structuredClone(mainI18n.getResourceBundle('vi', 'common'));
  expect(safetyI18n).toBe(mainI18n);
  registerCoreSafetyCatalog(
    { 'integration.core': 'Core {count}' },
    { 'integration.core': 'Gốc {count}' },
  );
  registerFeatureSafetyCatalog(
    { 'integration.core': 'Override', 'integration.feature': 'Camera {name}' },
    { 'integration.core': 'Ghi đè', 'integration.feature': 'Máy ảnh {name}' },
  );
  expect(translateSafetyNamespaceKey('vi', 'integration.core', { count: 2 })).toBe('Gốc 2');
  expect(translateSafetyNamespaceKey('en', 'integration.feature', { name: 'Tapo' })).toBe(
    'Camera Tapo',
  );
  changeUiLanguage('vi');
  expect(mainI18n.resolvedLanguage).toBe('vi');
  await mainI18n.changeLanguage('en');
  expect(safetyI18n.resolvedLanguage).toBe('en');
  expect(mainI18n.getResourceBundle('en', 'common')).toEqual(original);
  expect(mainI18n.getResourceBundle('vi', 'common')).toEqual(originalVi);
});
