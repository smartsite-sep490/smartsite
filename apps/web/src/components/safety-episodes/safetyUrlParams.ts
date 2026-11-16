const SAFE_QUERY_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const SAFE_UUID_RE = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const SAFE_FRAME_KEY_RE = /^(?:event|tracked):[a-z0-9][a-z0-9._:-]{0,191}$/i;
const SAFE_SAME_APP_INCIDENTS_HREF_RE = /^\/incidents(?:\?[A-Za-z0-9%=&._:+-]*)?$/;

export function sanitizeSafetyQueryId(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed.includes('..') || !SAFE_QUERY_ID_RE.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function sanitizeSafetyUuid(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  return SAFE_UUID_RE.test(trimmed) ? trimmed : undefined;
}

export function sanitizeSafetyFrameKey(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (
    !trimmed ||
    trimmed.length > 200 ||
    trimmed.includes('..') ||
    !SAFE_FRAME_KEY_RE.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}

export function sanitizeSameAppIncidentsHref(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  return SAFE_SAME_APP_INCIDENTS_HREF_RE.test(trimmed) ? trimmed : undefined;
}

/**
 * Avoids a permanent hardcoded false switch: C02 route entry stays wired by default while
 * Backend PR #223 SAFETY_IDENTIFICATION_ENABLED governs live availability via scoped read responses.
 */
export function isSafetyIdentificationRouteEnabled(override?: boolean): boolean {
  if (typeof override === 'boolean') {
    return override;
  }
  return import.meta.env.VITE_SMARTSITE_ENABLE_C02_IDENTIFICATION !== 'false';
}

export function sameSafetyId(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = left?.trim().toLowerCase() ?? '';
  const b = right?.trim().toLowerCase() ?? '';
  return Boolean(a) && a === b;
}

export function uniqueCanonicalIds(ids: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of ids) {
    const trimmed = raw?.trim() ?? '';
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

export function matchCanonicalId(
  allowedIds: readonly string[],
  candidate: string | null | undefined,
): string | undefined {
  const safe = sanitizeSafetyQueryId(candidate);
  if (!safe) return undefined;
  const key = safe.toLowerCase();
  return allowedIds.find((id) => id.trim().toLowerCase() === key);
}
