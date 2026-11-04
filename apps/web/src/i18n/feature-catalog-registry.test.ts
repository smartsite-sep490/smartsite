import { describe, expect, it } from 'vitest';
import i18n from './index';
import { hasRegisteredFeatureKey, registerFeatureCatalog } from './feature-catalog-registry';
import { SAFETY_NAMESPACE } from './runtime';

describe('scoped camera feature catalogs on Main i18next', () => {
  it('preserves Main resources and interpolates camera copy in both languages', () => {
    const before = JSON.stringify(i18n.getResourceBundle('en', 'common'));
    registerFeatureCatalog({
      en: { 'camera.test.count': 'Loaded {count}' },
      vi: { 'camera.test.count': 'Đã tải {count}' },
    });
    expect(i18n.t('camera.test.count', { ns: SAFETY_NAMESPACE, lng: 'en', count: 2 })).toBe(
      'Loaded 2',
    );
    expect(i18n.t('camera.test.count', { ns: SAFETY_NAMESPACE, lng: 'vi', count: 2 })).toBe(
      'Đã tải 2',
    );
    expect(JSON.stringify(i18n.getResourceBundle('en', 'common'))).toBe(before);
    expect(hasRegisteredFeatureKey('camera.test.count')).toBe(true);
  });

  it('refuses mismatched or unsafe entries before registering any of them', () => {
    expect(() =>
      registerFeatureCatalog({ en: { 'camera.test.invalid': 'x' }, vi: {} } as never),
    ).toThrow();
    expect(hasRegisteredFeatureKey('camera.test.invalid')).toBe(false);
    const unsafe = JSON.parse('{"constructor":"x"}');
    expect(() => registerFeatureCatalog({ en: unsafe, vi: unsafe })).toThrow();
    expect(hasRegisteredFeatureKey('constructor')).toBe(false);
  });
});
