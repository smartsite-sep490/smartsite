import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import vi from './locales/vi.json';

export const LANGUAGE_STORAGE_KEY = 'smartsite-language';
export type UiLanguage = 'en' | 'vi';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { common: en }, vi: { common: vi } },
    supportedLngs: ['en', 'vi'],
    fallbackLng: 'en',
    load: 'languageOnly',
    defaultNS: 'common',
    keySeparator: false,
    initAsync: false,
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
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
function synchronizeDocument() {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = uiLanguage();
    document.title = translate('app.documentTitle');
  }
}
synchronizeDocument();
i18n.on('languageChanged', synchronizeDocument);
export default i18n;
