export const LANGUAGE_STORAGE_KEY = 'smartsite-language';
export const LEGACY_LOCALE_STORAGE_KEY = 'smartsite.locale';
export const SAFETY_NAMESPACE = 'safety';

export type UiLanguage = 'en' | 'vi';

export interface StorageReaderLike {
  getItem(key: string): string | null;
}

export interface StorageWriterLike {
  setItem(key: string, value: string): void;
}

export type StorageLike = StorageReaderLike & StorageWriterLike;

const FORBIDDEN_CATALOG_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SINGLE_WORD_TOKEN_PATTERN = /\{(\w+)\}/g;

export function isForbiddenCatalogKey(key: string): boolean {
  return FORBIDDEN_CATALOG_KEYS.has(key);
}

export function isSupportedUiLanguage(value: unknown): value is UiLanguage {
  return value === 'en' || value === 'vi';
}

function getDefaultBrowserStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Safely reads a validated language code ('en' | 'vi') from a single storage key.
 * Bounded to the requested key only; never reads or logs auth tokens or unrelated keys.
 */
export function readSafeStorageLocale(
  storageKey: string,
  storage?: StorageReaderLike | null,
): UiLanguage | null {
  if (typeof storageKey !== 'string' || !storageKey) {
    return null;
  }
  const targetStorage = storage === undefined ? getDefaultBrowserStorage() : storage;
  if (!targetStorage) {
    return null;
  }
  try {
    const raw = targetStorage.getItem(storageKey);
    return isSupportedUiLanguage(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Safely persists a validated language code ('en' | 'vi') to a single storage key.
 * Gracefully ignores invalid language codes and storage SecurityError/QuotaExceededError.
 */
export function writeSafeStorageLocale(
  storageKey: string,
  locale: unknown,
  storage?: StorageWriterLike | null,
): boolean {
  if (typeof storageKey !== 'string' || !storageKey || !isSupportedUiLanguage(locale)) {
    return false;
  }
  const targetStorage = storage === undefined ? getDefaultBrowserStorage() : storage;
  if (!targetStorage) {
    return false;
  }
  try {
    targetStorage.setItem(storageKey, locale);
    return true;
  } catch {
    return false;
  }
}

/**
 * Enforces canonical storage precedence (`smartsite-language`) over legacy Safety storage
 * (`smartsite.locale`). If canonical storage is absent or invalid and legacy storage holds
 * a valid `'vi'` or `'en'`, copies the legacy value to canonical storage without deleting
 * the legacy key.
 */
export function migrateLegacyLocaleStorage(
  storage?: StorageLike | null,
  legacyStorageKey: string = LEGACY_LOCALE_STORAGE_KEY,
): UiLanguage | null {
  const targetStorage = storage === undefined ? getDefaultBrowserStorage() : storage;
  const canonical = readSafeStorageLocale(LANGUAGE_STORAGE_KEY, targetStorage);
  if (canonical !== null) {
    return canonical;
  }

  const legacy = readSafeStorageLocale(legacyStorageKey, targetStorage);
  if (legacy !== null) {
    writeSafeStorageLocale(LANGUAGE_STORAGE_KEY, legacy, targetStorage);
    return legacy;
  }

  return null;
}

/**
 * Resolves the active language using the single-runtime precedence contract:
 * 1. Valid canonical `smartsite-language`
 * 2. Valid legacy `smartsite.locale` (migrated to canonical without deleting old key)
 * 3. Browser navigator language (`vi*` -> `'vi'`, `en*` -> `'en'`)
 * 4. Fallback `'en'`
 */
export function resolveInitialLanguage(options?: {
  storage?: StorageLike | null;
  legacyStorageKey?: string;
  navigatorLanguages?: readonly string[] | null;
  fallback?: UiLanguage;
}): UiLanguage {
  const persisted = migrateLegacyLocaleStorage(options?.storage, options?.legacyStorageKey);
  if (persisted !== null) {
    return persisted;
  }

  const navCandidates: readonly string[] =
    options?.navigatorLanguages !== undefined
      ? (options.navigatorLanguages ?? [])
      : typeof navigator !== 'undefined'
        ? Array.isArray(navigator.languages) && navigator.languages.length > 0
          ? navigator.languages
          : typeof navigator.language === 'string'
            ? [navigator.language]
            : []
        : [];

  for (const candidate of navCandidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const normalized = candidate.trim().toLowerCase();
    if (normalized.startsWith('vi')) {
      return 'vi';
    }
    if (normalized.startsWith('en')) {
      return 'en';
    }
  }

  return options?.fallback && isSupportedUiLanguage(options.fallback) ? options.fallback : 'en';
}

/**
 * Converts single-brace Safety interpolation tokens `{word}` into i18next `{{word}}`
 * tokens while leaving existing `{{word}}` tokens and non-word braces unmodified.
 */
export function convertSafetyTemplateToI18next(template: string): string {
  if (typeof template !== 'string' || !template.includes('{')) {
    return template;
  }
  return template.replace(
    SINGLE_WORD_TOKEN_PATTERN,
    (match, token: string, offset: number, source: string) => {
      const prevChar = offset > 0 ? source[offset - 1] : '';
      const nextIndex = offset + match.length;
      const nextChar = nextIndex < source.length ? source[nextIndex] : '';
      if (prevChar === '{' || nextChar === '}') {
        return match;
      }
      return `{{${token}}}`;
    },
  );
}

/**
 * Converts a plain Safety catalog dictionary into an i18next resource bundle
 * with `{word}` tokens normalized to `{{word}}`.
 */
export function convertCatalogToI18next(
  catalog: Readonly<Record<string, string>>,
  excludedKeys?: ReadonlySet<string>,
): Record<string, string> {
  const converted: Record<string, string> = {};
  for (const key of Object.keys(catalog)) {
    if (
      !key ||
      isForbiddenCatalogKey(key) ||
      (excludedKeys !== undefined && excludedKeys.has(key)) ||
      !Object.prototype.hasOwnProperty.call(catalog, key)
    ) {
      continue;
    }
    const value = catalog[key];
    if (typeof value === 'string') {
      converted[key] = convertSafetyTemplateToI18next(value);
    }
  }
  return converted;
}
