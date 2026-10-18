import { describe, expect, it } from 'vitest';
import { setLanguage, translate, uiLanguage } from './index';
import vi from './locales/vi.json';
import en from './locales/en.json';

describe('mobile i18n configuration', () => {
  it('defaults to Vietnamese', () => {
    expect(uiLanguage()).toBe('vi');
    expect(translate('header.brand')).toBe('SmartSite');
    expect(translate('common.confirm')).toBe('Xác nhận');
  });

  it('switches smoothly to English and back', async () => {
    await setLanguage('en');
    expect(uiLanguage()).toBe('en');
    expect(translate('common.confirm')).toBe('Confirm');
    expect(translate('tabs.schedule')).toBe('Schedule');

    await setLanguage('vi');
    expect(uiLanguage()).toBe('vi');
    expect(translate('common.confirm')).toBe('Xác nhận');
    expect(translate('tabs.schedule')).toBe('Lịch làm');
  });

  it('has identical top-level keys in both Vietnamese and English catalogs', () => {
    const viKeys = Object.keys(vi).sort();
    const enKeys = Object.keys(en).sort();
    expect(viKeys).toEqual(enKeys);

    for (const section of viKeys) {
      const viSubKeys = Object.keys(
        (vi as Record<string, Record<string, string>>)[section]!,
      ).sort();
      const enSubKeys = Object.keys(
        (en as Record<string, Record<string, string>>)[section]!,
      ).sort();
      expect(enSubKeys).toEqual(viSubKeys);
      for (const key of viSubKeys) {
        const viValue = (vi as Record<string, Record<string, string>>)[section]![key]!;
        const enValue = (en as Record<string, Record<string, string>>)[section]![key]!;
        const variables = (value: string) =>
          [...value.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort();
        expect(viValue.trim(), `${section}.${key}`).not.toBe('');
        expect(enValue.trim(), `${section}.${key}`).not.toBe('');
        expect(variables(viValue), `${section}.${key}`).toEqual(variables(enValue));
      }
    }
  });

  it('interpolates parameters correctly', () => {
    expect(translate('scope.welcome', { name: 'Nguyen Van An' })).toBe('Xin chào, Nguyen Van An');
    expect(translate('attendance.totalHours', { hours: 8 })).toBe('Tổng giờ: 8h');
  });
  it('keeps Vietnamese prose out of the English catalog except the native language name', () => {
    for (const [section, entries] of Object.entries(en)) {
      for (const [key, value] of Object.entries(entries)) {
        if (`${section}.${key}` === 'header.vietnamese') continue;
        expect(value, `${section}.${key}`).not.toMatch(/[ĂăĐđƠơƯưẠ-ỹ]/);
      }
    }
  });
});
