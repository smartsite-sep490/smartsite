// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  hasRegisteredFeatureKey,
  lookupFeatureTranslation,
  registerFeatureCatalog,
} from './feature-catalog-registry';
import { LocaleProvider, translateKey, useLocale as useCoreLocale } from './locale';
import { registerPpeCatalog } from './ppe-catalog';
import { useLocale as usePpeLocale, type TranslationKey } from './ppe-locale';

function SharedContextProbe() {
  const core = useCoreLocale();
  const ppe = usePpeLocale();
  const [draft, setDraft] = useState('keep-draft-01');

  return (
    <div>
      <output data-testid="same-t">{String(core.t === ppe.t)}</output>
      <output data-testid="same-set-locale">{String(core.setLocale === ppe.setLocale)}</output>
      <span data-testid="core-login">{core.t('auth.login')}</span>
      <span data-testid="ppe-title">{ppe.t('ppe.header.title')}</span>
      <span data-testid="region-count">
        {ppe.t('regionSetup.drawer.pointsCount', { count: 4 })}
      </span>
      <input aria-label="probe-draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button type="button" onClick={() => core.setLocale('en')}>
        to-en
      </button>
      <button type="button" onClick={() => ppe.setLocale('vi')}>
        to-vi
      </button>
    </div>
  );
}

describe('feature-catalog-registry and ppe-locale split boundary', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('rejects Date, Map, custom-class instances, and custom-prototype objects while accepting ordinary and null-prototype own-string dictionaries', () => {
    const dateWithOwnKey = Object.assign(new Date(), {
      'test.dateKey': 'Date EN',
    }) as unknown as Record<string, string>;
    expect(() =>
      registerFeatureCatalog({
        en: dateWithOwnKey,
        vi: { 'test.dateKey': 'Date VI' },
      }),
    ).toThrow(/plain EN and VI dictionary objects/i);
    expect(() =>
      registerFeatureCatalog({
        en: { 'test.dateKey': 'Date EN' },
        vi: dateWithOwnKey,
      }),
    ).toThrow(/plain EN and VI dictionary objects/i);
    expect(hasRegisteredFeatureKey('test.dateKey')).toBe(false);

    const mapWithOwnKey = Object.assign(new Map([['test.mapKey', 'Map EN']]), {
      'test.mapKey': 'Map EN',
    }) as unknown as Record<string, string>;
    expect(() =>
      registerFeatureCatalog({
        en: mapWithOwnKey,
        vi: { 'test.mapKey': 'Map VI' },
      }),
    ).toThrow(/plain EN and VI dictionary objects/i);
    expect(hasRegisteredFeatureKey('test.mapKey')).toBe(false);

    class CustomCatalogClass {
      'test.classKey' = 'Class EN';
    }
    expect(() =>
      registerFeatureCatalog({
        en: new CustomCatalogClass() as unknown as Record<string, string>,
        vi: { 'test.classKey': 'Class VI' },
      }),
    ).toThrow(/plain EN and VI dictionary objects/i);
    expect(hasRegisteredFeatureKey('test.classKey')).toBe(false);

    class CustomPairContainer {
      en = { 'test.containerClassKey': 'EN' };
      vi = { 'test.containerClassKey': 'VI' };
    }
    expect(() => registerFeatureCatalog(new CustomPairContainer())).toThrow(
      /plain EN and VI dictionary objects/i,
    );
    expect(hasRegisteredFeatureKey('test.containerClassKey')).toBe(false);

    const customProtoDict = Object.assign(Object.create({ inheritedKey: 'inherited' }), {
      'test.customProtoKey': 'Custom Proto EN',
    }) as Record<string, string>;
    expect(() =>
      registerFeatureCatalog({
        en: customProtoDict,
        vi: { 'test.customProtoKey': 'Custom Proto VI' },
      }),
    ).toThrow(/plain EN and VI dictionary objects/i);
    expect(() =>
      registerFeatureCatalog({
        en: { 'test.customProtoKey': 'Custom Proto EN' },
        vi: customProtoDict,
      }),
    ).toThrow(/plain EN and VI dictionary objects/i);
    expect(hasRegisteredFeatureKey('test.customProtoKey')).toBe(false);

    // Accepts ordinary object literal own-string dictionaries
    registerFeatureCatalog({
      en: { 'test.ordinaryPlainKey': 'Ordinary EN' },
      vi: { 'test.ordinaryPlainKey': 'Thông thường VI' },
    });
    expect(hasRegisteredFeatureKey('test.ordinaryPlainKey')).toBe(true);
    expect(lookupFeatureTranslation('en', 'test.ordinaryPlainKey')).toBe('Ordinary EN');
    expect(lookupFeatureTranslation('vi', 'test.ordinaryPlainKey')).toBe('Thông thường VI');

    // Accepts null-prototype own-string dictionaries
    const nullProtoEn = Object.assign(Object.create(null) as Record<string, string>, {
      'test.nullProtoKey': 'Null Proto EN',
    });
    const nullProtoVi = Object.assign(Object.create(null) as Record<string, string>, {
      'test.nullProtoKey': 'Null Proto VI',
    });
    const nullProtoPair = Object.assign(
      Object.create(null) as { en: Record<string, string>; vi: Record<string, string> },
      { en: nullProtoEn, vi: nullProtoVi },
    );
    registerFeatureCatalog(nullProtoPair);
    expect(hasRegisteredFeatureKey('test.nullProtoKey')).toBe(true);
    expect(lookupFeatureTranslation('en', 'test.nullProtoKey')).toBe('Null Proto EN');
    expect(lookupFeatureTranslation('vi', 'test.nullProtoKey')).toBe('Null Proto VI');
  });

  it('requires matching EN/VI string keys, prevents partial registration of preceding valid keys, and keeps identical repeat registration harmless', () => {
    expect(() =>
      registerFeatureCatalog({
        en: { 'test.onlyEn': 'Only EN' } as Record<string, string>,
        vi: {} as Record<string, string>,
      }),
    ).toThrow(/mismatch/i);
    expect(hasRegisteredFeatureKey('test.onlyEn')).toBe(false);

    expect(() =>
      registerFeatureCatalog({
        en: {
          'test.validBeforeFail': 'Valid EN',
          'test.mismatchedEn': 'Mismatch EN',
        } as Record<string, string>,
        vi: {
          'test.validBeforeFail': 'Valid VI',
          'test.mismatchedVi': 'Mismatch VI',
        } as Record<string, string>,
      }),
    ).toThrow(/mismatched or unsafe key/i);
    expect(hasRegisteredFeatureKey('test.validBeforeFail')).toBe(false);
    expect(lookupFeatureTranslation('en', 'test.validBeforeFail')).toBeUndefined();
    expect(lookupFeatureTranslation('vi', 'test.validBeforeFail')).toBeUndefined();

    // Valid first key followed by non-string value in second key must not partially register first key
    expect(() =>
      registerFeatureCatalog({
        en: {
          'test.precedingValidKey': 'Valid Preceding EN',
          'test.badTypeKey': 123 as unknown as string,
        },
        vi: {
          'test.precedingValidKey': 'Valid Preceding VI',
          'test.badTypeKey': 'Valid VI',
        },
      }),
    ).toThrow(/invalid EN\/VI entry/i);
    expect(hasRegisteredFeatureKey('test.precedingValidKey')).toBe(false);
    expect(lookupFeatureTranslation('en', 'test.precedingValidKey')).toBeUndefined();

    expect(() =>
      registerFeatureCatalog({
        en: { constructor: 'bad' } as Record<string, string>,
        vi: { constructor: 'bad' } as Record<string, string>,
      }),
    ).toThrow(/unsafe key/i);

    // Identical repeat registration stays harmless
    const validPair = {
      en: { 'test.harmlessRepeat': 'Repeat EN' },
      vi: { 'test.harmlessRepeat': 'Lặp lại VI' },
    } as const;
    registerFeatureCatalog(validPair);
    expect(() => registerFeatureCatalog(validPair)).not.toThrow();
    expect(() => registerPpeCatalog()).not.toThrow();
    expect(lookupFeatureTranslation('en', 'test.harmlessRepeat')).toBe('Repeat EN');
    expect(lookupFeatureTranslation('vi', 'test.harmlessRepeat')).toBe('Lặp lại VI');
  });

  it('prevents prototype lookups and ensures core translations always win over feature registrations', () => {
    expect(lookupFeatureTranslation('en', 'toString')).toBeUndefined();
    expect(lookupFeatureTranslation('vi', 'constructor')).toBeUndefined();
    expect(lookupFeatureTranslation('en', '__proto__')).toBeUndefined();
    expect(translateKey('en', 'toString' as unknown as TranslationKey)).toBe('');
    expect(translateKey('vi', 'constructor' as unknown as TranslationKey)).toBe('');

    // Even if a feature dictionary registers a key colliding with a core key, core wins
    registerFeatureCatalog({
      en: { 'auth.login': 'Overridden EN Login' },
      vi: { 'auth.login': 'Overridden VI Login' },
    });

    expect(translateKey('en', 'auth.login')).toBe('Sign in');
    expect(translateKey('vi', 'auth.login')).toBe('Đăng nhập');
  });

  it('shares the exact LocaleProvider context and t reference between core locale and ppe-locale across Provider and standalone renders', () => {
    const { unmount } = render(
      <LocaleProvider defaultLocale="vi">
        <SharedContextProbe />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('same-t').textContent).toBe('true');
    expect(screen.getByTestId('same-set-locale').textContent).toBe('true');
    expect(screen.getByTestId('core-login').textContent).toBe('Đăng nhập');
    expect(screen.getByTestId('ppe-title').textContent).toBe(
      'Giám sát tuân thủ bảo hộ lao động (PPE)',
    );
    expect(screen.getByTestId('region-count').textContent).toBe('Số điểm: 4 / 32');

    const input = screen.getByLabelText('probe-draft') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'unsaved-polygon-draft' } });

    fireEvent.click(screen.getByText('to-en'));

    expect(screen.getByTestId('core-login').textContent).toBe('Sign in');
    expect(screen.getByTestId('ppe-title').textContent).toBe('PPE Compliance Monitoring');
    expect(screen.getByTestId('region-count').textContent).toBe('Points: 4 / 32');
    expect(input.value).toBe('unsaved-polygon-draft');

    unmount();

    // Standalone render without LocaleProvider defaults to English and resolves PPE keys
    render(<SharedContextProbe />);
    expect(screen.getByTestId('core-login').textContent).toBe('Sign in');
    expect(screen.getByTestId('ppe-title').textContent).toBe('PPE Compliance Monitoring');
    expect(screen.getByTestId('region-count').textContent).toBe('Points: 4 / 32');
  });
});
