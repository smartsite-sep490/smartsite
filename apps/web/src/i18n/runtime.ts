// Share Main's initialized instance; never initialize or replace its common catalog.
import i18n from './index';
import {
  convertCatalogToI18next,
  isSupportedUiLanguage,
  LANGUAGE_STORAGE_KEY,
  LEGACY_LOCALE_STORAGE_KEY,
  readSafeStorageLocale,
  SAFETY_NAMESPACE,
  writeSafeStorageLocale,
  type UiLanguage,
} from './compat';
import { uiLanguage } from './index';
export { LANGUAGE_STORAGE_KEY, SAFETY_NAMESPACE, type UiLanguage };
export { uiLanguage, uiLocale, translate } from './index';
export function subscribeLanguageChange(listener: () => void): () => void {
  i18n.on('languageChanged', listener);
  return () => {
    i18n.off('languageChanged', listener);
  };
}

export function changeUiLanguage(nextLocale: unknown, mirrorStorageKey?: string): void {
  if (!isSupportedUiLanguage(nextLocale)) {
    return;
  }
  writeSafeStorageLocale(LANGUAGE_STORAGE_KEY, nextLocale);
  if (mirrorStorageKey && mirrorStorageKey !== LANGUAGE_STORAGE_KEY) {
    writeSafeStorageLocale(mirrorStorageKey, nextLocale);
  }
  try {
    void i18n.changeLanguage(nextLocale);
  } catch {
    // Ensure storage/detector errors never break language state transitions.
  }
}

export function syncRuntimeLanguageForProvider(options?: {
  defaultLocale?: unknown;
  storageKey?: string;
}): UiLanguage {
  const canonical = readSafeStorageLocale(LANGUAGE_STORAGE_KEY);
  if (canonical !== null) {
    if (uiLanguage() !== canonical) {
      try {
        void i18n.changeLanguage(canonical);
      } catch {
        // Ignore detector cache errors.
      }
    }
    return canonical;
  }

  const legacyKey = options?.storageKey ?? LEGACY_LOCALE_STORAGE_KEY;
  const legacy = readSafeStorageLocale(legacyKey);
  if (legacy !== null) {
    writeSafeStorageLocale(LANGUAGE_STORAGE_KEY, legacy);
    if (uiLanguage() !== legacy) {
      try {
        void i18n.changeLanguage(legacy);
      } catch {
        // Ignore detector cache errors.
      }
    }
    return legacy;
  }

  if (options?.defaultLocale !== undefined && isSupportedUiLanguage(options.defaultLocale)) {
    if (uiLanguage() !== options.defaultLocale) {
      try {
        void i18n.changeLanguage(options.defaultLocale);
      } catch {
        // Ignore detector cache errors.
      }
    }
    return options.defaultLocale;
  }

  return uiLanguage();
}

const lockedCoreSafetyKeys = new Set<string>();

export function registerCoreSafetyCatalog(
  enCatalog: Readonly<Record<string, string>>,
  viCatalog: Readonly<Record<string, string>>,
): void {
  for (const key of Object.keys(enCatalog)) {
    if (Object.prototype.hasOwnProperty.call(enCatalog, key)) {
      lockedCoreSafetyKeys.add(key);
    }
  }
  const convertedEn = convertCatalogToI18next(enCatalog);
  const convertedVi = convertCatalogToI18next(viCatalog);
  i18n.addResources('en', SAFETY_NAMESPACE, convertedEn);
  i18n.addResources('vi', SAFETY_NAMESPACE, convertedVi);
}

export function registerFeatureSafetyCatalog(
  enCatalog: Readonly<Record<string, string>>,
  viCatalog: Readonly<Record<string, string>>,
): void {
  const convertedEn = convertCatalogToI18next(enCatalog, lockedCoreSafetyKeys);
  const convertedVi = convertCatalogToI18next(viCatalog, lockedCoreSafetyKeys);
  i18n.addResources('en', SAFETY_NAMESPACE, convertedEn);
  i18n.addResources('vi', SAFETY_NAMESPACE, convertedVi);
}

export function translateSafetyNamespaceKey(
  locale: UiLanguage,
  key: string,
  params?: Record<string, string | number>,
): string {
  const activeLocale: UiLanguage = isSupportedUiLanguage(locale) ? locale : 'en';
  if (!params) {
    return i18n.t(key, {
      ns: SAFETY_NAMESPACE,
      lng: activeLocale,
      fallbackLng: 'en',
    });
  }
  return i18n.t(key, {
    ns: SAFETY_NAMESPACE,
    lng: activeLocale,
    fallbackLng: 'en',
    // Legacy Safety values are interpolation data, never i18next control options.
    replace: params,
  });
}

export default i18n;
