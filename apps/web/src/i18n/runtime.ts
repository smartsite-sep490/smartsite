import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import vi from './locales/vi.json';
import {
  convertCatalogToI18next,
  isSupportedUiLanguage,
  LANGUAGE_STORAGE_KEY,
  LEGACY_LOCALE_STORAGE_KEY,
  migrateLegacyLocaleStorage,
  readSafeStorageLocale,
  SAFETY_NAMESPACE,
  writeSafeStorageLocale,
  type UiLanguage,
} from './compat';

export { LANGUAGE_STORAGE_KEY, SAFETY_NAMESPACE, type UiLanguage };

// Migrate valid legacy `smartsite.locale` only when canonical `smartsite-language` is absent/invalid.
migrateLegacyLocaleStorage();

// Guard storage reads and writes from the first initialization, before detection runs.
const languageDetector = new LanguageDetector();
languageDetector.addDetector({
  name: 'safeLocalStorage',
  lookup: () => readSafeStorageLocale(LANGUAGE_STORAGE_KEY) ?? undefined,
  cacheUserLanguage: (language: string) => {
    if (isSupportedUiLanguage(language)) {
      writeSafeStorageLocale(LANGUAGE_STORAGE_KEY, language);
    }
  },
});

void i18n
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: en, [SAFETY_NAMESPACE]: {} },
      vi: { common: vi, [SAFETY_NAMESPACE]: {} },
    },
    supportedLngs: ['en', 'vi'],
    fallbackLng: 'en',
    load: 'languageOnly',
    defaultNS: 'common',
    ns: ['common', SAFETY_NAMESPACE],
    keySeparator: false,
    initAsync: false,
    detection: {
      order: ['safeLocalStorage', 'navigator'],
      caches: ['safeLocalStorage'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

export function uiLanguage(): UiLanguage {
  return (i18n.resolvedLanguage ?? i18n.language)?.startsWith('vi') ? 'vi' : 'en';
}

export function uiLocale(): 'en-GB' | 'vi-VN' {
  return uiLanguage() === 'vi' ? 'vi-VN' : 'en-GB';
}

/** Utilities evaluate the current locale when called; React views subscribe with useTranslation. */
export function translate(key: string, values?: Record<string, unknown>): string {
  return i18n.t(key, values);
}

function synchronizeDocument(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = uiLanguage();
    document.title = translate('app.documentTitle');
  }
}

synchronizeDocument();
i18n.on('languageChanged', synchronizeDocument);

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
