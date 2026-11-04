import i18n from './index';
import { SAFETY_NAMESPACE } from './runtime';

const registered = new Set<string>();
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);

/** Only trusted static paired feature dictionaries; never replace Main's common resources. */
export function registerFeatureCatalog<K extends string>(catalogs: {
  en: Readonly<Record<K, string>>;
  vi: Readonly<Record<K, string>>;
}): void {
  const en = Object.keys(catalogs.en) as K[];
  const vi = Object.keys(catalogs.vi);
  if (
    en.length !== vi.length ||
    en.some(
      (key) =>
        !key ||
        unsafe.has(key) ||
        !Object.hasOwn(catalogs.vi, key) ||
        typeof catalogs.en[key] !== 'string' ||
        typeof catalogs.vi[key] !== 'string',
    )
  ) {
    throw new Error('Feature catalog requires matching safe EN/VI string entries.');
  }
  const convert = (entries: Readonly<Record<K, string>>) =>
    Object.fromEntries(en.map((key) => [key, entries[key].replace(/\{(\w+)\}/g, '{{$1}}')]));
  i18n.addResources('en', SAFETY_NAMESPACE, convert(catalogs.en));
  i18n.addResources('vi', SAFETY_NAMESPACE, convert(catalogs.vi));
  en.forEach((key) => registered.add(key));
}

export function hasRegisteredFeatureKey(key: string): boolean {
  return !unsafe.has(key) && registered.has(key);
}
