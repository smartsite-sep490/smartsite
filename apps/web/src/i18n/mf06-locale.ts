import { useTranslation } from 'react-i18next';
import { useCallback } from 'react';
import { uiLanguage, type UiLanguage } from './index';
import { SAFETY_NAMESPACE } from './runtime';
import { MF06_EN } from './mf06-copy';
import './mf06-copy';

export type Locale = UiLanguage;
export type TranslationKey = keyof typeof MF06_EN;

/** Bounded compatibility for retained MF06 views; no second locale provider or catalog. */
export function useLocale() {
  const { t: translate } = useTranslation(SAFETY_NAMESPACE);
  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => translate(key, params),
    [translate],
  );
  return { locale: uiLanguage(), t };
}
