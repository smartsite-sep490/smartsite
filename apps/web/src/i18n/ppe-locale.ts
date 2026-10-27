import {
  useLocale as useBaseLocale,
  type Locale,
  type LocaleContextValue,
  type TranslationKey,
} from './locale-context';
import { registerPpeCatalog, type PpeTranslationKey } from './ppe-catalog';

registerPpeCatalog();

export function useLocale(): LocaleContextValue {
  registerPpeCatalog();
  return useBaseLocale();
}

export type { Locale, LocaleContextValue, PpeTranslationKey, TranslationKey };
