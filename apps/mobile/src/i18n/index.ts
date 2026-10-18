import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import * as SecureStore from 'expo-secure-store';
import vi from './locales/vi.json';
import en from './locales/en.json';

export const MOBILE_LANGUAGE_KEY = 'smartsite-mobile-language';
export type UiLanguage = 'vi' | 'en';

void i18n.use(initReactI18next).init({
  resources: {
    vi: { translation: vi },
    en: { translation: en },
  },
  lng: 'vi',
  fallbackLng: 'vi',
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
});

export function uiLanguage(): UiLanguage {
  return (i18n.resolvedLanguage ?? i18n.language)?.startsWith('en') ? 'en' : 'vi';
}

export async function initSavedLanguage(): Promise<UiLanguage> {
  try {
    const saved = await SecureStore.getItemAsync(MOBILE_LANGUAGE_KEY);
    if (saved === 'vi' || saved === 'en') {
      await i18n.changeLanguage(saved);
      return saved;
    }
  } catch {
    // SecureStore may not be available in all test or web contexts
  }
  return 'vi';
}

export async function setLanguage(lang: UiLanguage): Promise<void> {
  await i18n.changeLanguage(lang);
  try {
    await SecureStore.setItemAsync(MOBILE_LANGUAGE_KEY, lang);
  } catch {
    // SecureStore fallback
  }
}

export function translate(key: string, values?: Record<string, unknown>): string {
  return i18n.t(key, values);
}

export { useTranslation };
export default i18n;
