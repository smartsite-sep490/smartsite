import { registerFeatureSafetyCatalog } from './runtime';

export type FeatureLocale = 'vi' | 'en';

export interface FeatureCatalogPair<K extends string = string> {
  readonly en: Readonly<Record<K, string>>;
  readonly vi: Readonly<Record<K, string>>;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const enFeatureCatalog = new Map<string, string>();
const viFeatureCatalog = new Map<string, string>();

function isPlainDictionary(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || value === Object.prototype) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

/**
 * Registers a trusted static EN/VI feature translation dictionary pair.
 * Validates that EN and VI have identical own string keys before mutating the registry.
 */
export function registerFeatureCatalog<K extends string>(catalogs: FeatureCatalogPair<K>): void {
  if (
    !isPlainDictionary(catalogs) ||
    !isPlainDictionary(catalogs.en) ||
    !isPlainDictionary(catalogs.vi)
  ) {
    throw new Error('Feature catalog registration requires plain EN and VI dictionary objects.');
  }

  const enDict = catalogs.en as Record<string, unknown>;
  const viDict = catalogs.vi as Record<string, unknown>;
  const enKeys = Object.keys(enDict);
  const viKeys = Object.keys(viDict);

  if (enKeys.length !== viKeys.length) {
    throw new Error(
      `Feature catalog key count mismatch: EN has ${enKeys.length} keys, VI has ${viKeys.length} keys.`,
    );
  }

  for (const key of viKeys) {
    if (!key || FORBIDDEN_KEYS.has(key) || !Object.prototype.hasOwnProperty.call(enDict, key)) {
      throw new Error(`Feature catalog registration failed: mismatched or unsafe key "${key}".`);
    }
  }

  for (const key of enKeys) {
    if (
      !key ||
      FORBIDDEN_KEYS.has(key) ||
      !Object.prototype.hasOwnProperty.call(enDict, key) ||
      !Object.prototype.hasOwnProperty.call(viDict, key) ||
      typeof enDict[key] !== 'string' ||
      typeof viDict[key] !== 'string'
    ) {
      throw new Error(`Feature catalog registration failed: invalid EN/VI entry for key "${key}".`);
    }
  }

  for (const key of enKeys) {
    enFeatureCatalog.set(key, enDict[key] as string);
    viFeatureCatalog.set(key, viDict[key] as string);
  }

  registerFeatureSafetyCatalog(
    enDict as Record<string, string>,
    viDict as Record<string, string>,
  );
}

/**
 * Looks up a registered feature translation without prototype chain traversal.
 */
export function lookupFeatureTranslation(locale: FeatureLocale, key: string): string | undefined {
  if (typeof key !== 'string' || !key || FORBIDDEN_KEYS.has(key)) {
    return undefined;
  }
  const primary = locale === 'vi' ? viFeatureCatalog : enFeatureCatalog;
  return primary.get(key);
}

export function hasRegisteredFeatureKey(key: string): boolean {
  if (typeof key !== 'string' || !key || FORBIDDEN_KEYS.has(key)) {
    return false;
  }
  return enFeatureCatalog.has(key) && viFeatureCatalog.has(key);
}
