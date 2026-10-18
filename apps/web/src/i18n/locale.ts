export {
  CATALOGS,
  DEFAULT_PROVIDER_LOCALE,
  isSupportedLocale,
  LOCALE_STORAGE_KEY,
  STANDALONE_FALLBACK_LOCALE,
  translateKey,
  useLocale,
  type Locale,
  type LocaleContextValue,
  type TranslationCatalog,
  type TranslationKey,
} from './locale-context';

export { LocaleProvider, type LocaleProviderProps } from './LocaleProvider';
export { LocaleSwitcher, type LocaleSwitcherProps } from './locale-switcher';
