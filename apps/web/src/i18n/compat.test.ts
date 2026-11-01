import { describe, expect, it } from 'vitest';
import {
  convertCatalogToI18next,
  convertSafetyTemplateToI18next,
  LANGUAGE_STORAGE_KEY,
  LEGACY_LOCALE_STORAGE_KEY,
  migrateLegacyLocaleStorage,
  readSafeStorageLocale,
  resolveInitialLanguage,
  writeSafeStorageLocale,
  type StorageLike,
} from './compat';

function createMemoryStorage(initialEntries: Record<string, string> = {}): {
  storage: StorageLike;
  snapshot: () => Record<string, string>;
  readKeys: string[];
  writtenKeys: Array<{ key: string; value: string }>;
} {
  const store = new Map<string, string>(Object.entries(initialEntries));
  const readKeys: string[] = [];
  const writtenKeys: Array<{ key: string; value: string }> = [];

  return {
    storage: {
      getItem(key: string): string | null {
        readKeys.push(key);
        return store.has(key) ? (store.get(key) ?? null) : null;
      },
      setItem(key: string, value: string): void {
        writtenKeys.push({ key, value });
        store.set(key, String(value));
      },
    },
    snapshot: () => Object.fromEntries(store.entries()),
    readKeys,
    writtenKeys,
  };
}

describe('i18n single-runtime storage precedence and template compatibility helpers', () => {
  it('prefers valid canonical smartsite-language over legacy smartsite.locale without deleting legacy key', () => {
    const enWins = createMemoryStorage({
      [LANGUAGE_STORAGE_KEY]: 'en',
      [LEGACY_LOCALE_STORAGE_KEY]: 'vi',
    });

    expect(migrateLegacyLocaleStorage(enWins.storage)).toBe('en');
    expect(enWins.snapshot()).toEqual({
      [LANGUAGE_STORAGE_KEY]: 'en',
      [LEGACY_LOCALE_STORAGE_KEY]: 'vi',
    });
    expect(enWins.writtenKeys).toEqual([]);

    const viWins = createMemoryStorage({
      [LANGUAGE_STORAGE_KEY]: 'vi',
      [LEGACY_LOCALE_STORAGE_KEY]: 'en',
    });

    expect(migrateLegacyLocaleStorage(viWins.storage)).toBe('vi');
    expect(viWins.snapshot()).toEqual({
      [LANGUAGE_STORAGE_KEY]: 'vi',
      [LEGACY_LOCALE_STORAGE_KEY]: 'en',
    });
    expect(viWins.writtenKeys).toEqual([]);
  });

  it('migrates valid legacy smartsite.locale into canonical smartsite-language when canonical is absent or invalid and preserves legacy key', () => {
    const whenCanonicalMissing = createMemoryStorage({
      [LEGACY_LOCALE_STORAGE_KEY]: 'vi',
    });

    expect(migrateLegacyLocaleStorage(whenCanonicalMissing.storage)).toBe('vi');
    expect(whenCanonicalMissing.snapshot()).toEqual({
      [LANGUAGE_STORAGE_KEY]: 'vi',
      [LEGACY_LOCALE_STORAGE_KEY]: 'vi',
    });

    const whenCanonicalInvalid = createMemoryStorage({
      [LANGUAGE_STORAGE_KEY]: 'unsupported-locale',
      [LEGACY_LOCALE_STORAGE_KEY]: 'en',
    });

    expect(migrateLegacyLocaleStorage(whenCanonicalInvalid.storage)).toBe('en');
    expect(whenCanonicalInvalid.snapshot()).toEqual({
      [LANGUAGE_STORAGE_KEY]: 'en',
      [LEGACY_LOCALE_STORAGE_KEY]: 'en',
    });
  });

  it('ignores invalid stored values and falls back to navigator language then English', () => {
    const invalidBoth = createMemoryStorage({
      [LANGUAGE_STORAGE_KEY]: 'fr',
      [LEGACY_LOCALE_STORAGE_KEY]: 'de',
    });

    expect(migrateLegacyLocaleStorage(invalidBoth.storage)).toBeNull();
    expect(
      resolveInitialLanguage({
        storage: invalidBoth.storage,
        navigatorLanguages: ['vi-VN', 'en-US'],
      }),
    ).toBe('vi');
    expect(
      resolveInitialLanguage({
        storage: invalidBoth.storage,
        navigatorLanguages: ['fr-FR', 'ja-JP'],
      }),
    ).toBe('en');

    expect(writeSafeStorageLocale(LANGUAGE_STORAGE_KEY, 'fr', invalidBoth.storage)).toBe(false);
    expect(invalidBoth.writtenKeys).toEqual([]);
  });

  it('handles storage SecurityError gracefully and never reads, modifies, or leaks auth/session keys', () => {
    const secretToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret-payload';
    const memory = createMemoryStorage({
      'smartsite.auth.token': secretToken,
      access_token: secretToken,
      [LEGACY_LOCALE_STORAGE_KEY]: 'vi',
    });

    expect(migrateLegacyLocaleStorage(memory.storage)).toBe('vi');
    expect(memory.readKeys).toEqual([LANGUAGE_STORAGE_KEY, LEGACY_LOCALE_STORAGE_KEY]);
    expect(memory.readKeys).not.toContain('smartsite.auth.token');
    expect(memory.readKeys).not.toContain('access_token');
    expect(memory.snapshot()['smartsite.auth.token']).toBe(secretToken);
    expect(memory.snapshot().access_token).toBe(secretToken);

    const throwingStorage: StorageLike = {
      getItem(): string | null {
        throw new Error(`SecurityError: blocked storage access (${secretToken})`);
      },
      setItem(): void {
        throw new Error(`SecurityError: blocked storage write (${secretToken})`);
      },
    };

    expect(readSafeStorageLocale(LANGUAGE_STORAGE_KEY, throwingStorage)).toBeNull();
    expect(writeSafeStorageLocale(LANGUAGE_STORAGE_KEY, 'vi', throwingStorage)).toBe(false);
    expect(migrateLegacyLocaleStorage(throwingStorage)).toBeNull();
    expect(
      resolveInitialLanguage({
        storage: throwingStorage,
        navigatorLanguages: ['en-GB'],
      }),
    ).toBe('en');
  });

  it('converts only single-brace {word} Safety tokens to {{word}} while leaving existing {{word}} and non-word braces unmodified', () => {
    expect(convertSafetyTemplateToI18next('Points: {count} / 32')).toBe('Points: {{count}} / 32');
    expect(convertSafetyTemplateToI18next('Số điểm: {count} / 32')).toBe('Số điểm: {{count}} / 32');
    expect(convertSafetyTemplateToI18next('{{count}} thành viên')).toBe('{{count}} thành viên');
    expect(
      convertSafetyTemplateToI18next('Zone {zone_id} has {{count}} alerts in {siteName}'),
    ).toBe('Zone {{zone_id}} has {{count}} alerts in {{siteName}}');
    expect(convertSafetyTemplateToI18next('Keep {} and {not-a-word} and {{{triple}}} intact')).toBe(
      'Keep {} and {not-a-word} and {{{triple}}} intact',
    );

    const once = convertSafetyTemplateToI18next('Points: {count} / 32');
    expect(convertSafetyTemplateToI18next(once)).toBe(once);

    const lockedCoreKeys = new Set(['auth.login']);
    const convertedBundle = convertCatalogToI18next(
      {
        'auth.login': 'Overridden {user}',
        'regionSetup.drawer.pointsCount': 'Points: {count} / 32',
        'already.i18next': 'Total: {{total}}',
      },
      lockedCoreKeys,
    );

    expect(convertedBundle).toEqual({
      'regionSetup.drawer.pointsCount': 'Points: {{count}} / 32',
      'already.i18next': 'Total: {{total}}',
    });
  });
});
