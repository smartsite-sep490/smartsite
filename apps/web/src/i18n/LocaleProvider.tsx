import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  getSharedTranslator,
  isSupportedLocale,
  LOCALE_STORAGE_KEY,
  LocaleContext,
  setSharedRuntimeLocale,
  type Locale,
  type LocaleContextValue,
} from './locale-context';
import {
  changeUiLanguage,
  subscribeLanguageChange,
  syncRuntimeLanguageForProvider,
  uiLanguage,
} from './runtime';

export interface LocaleProviderProps {
  children: ReactNode;
  defaultLocale?: Locale;
  storageKey?: string;
}

export function LocaleProvider({
  children,
  defaultLocale,
  storageKey = LOCALE_STORAGE_KEY,
}: LocaleProviderProps) {
  const initializedRef = useRef(false);
  useLayoutEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    syncRuntimeLanguageForProvider({ defaultLocale, storageKey });
  }, [defaultLocale, storageKey]);

  const locale = useSyncExternalStore(subscribeLanguageChange, uiLanguage, uiLanguage);

  const customSetLocale = useCallback(
    (nextLocale: Locale) => {
      if (!isSupportedLocale(nextLocale)) {
        return;
      }
      changeUiLanguage(nextLocale, storageKey);
    },
    [storageKey],
  );

  const setLocale = storageKey === LOCALE_STORAGE_KEY ? setSharedRuntimeLocale : customSetLocale;

  const t = getSharedTranslator(locale);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t,
    }),
    [locale, setLocale, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
