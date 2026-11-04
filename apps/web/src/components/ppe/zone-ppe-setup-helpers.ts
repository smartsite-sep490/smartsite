import { ApiError, type ZoneResponse } from '@smartsite/api-client';
import type { ZonePpeSetupCopyKey } from './zone-ppe-setup-copy';

export function formatPpeLabel(item: string, t: (key: ZonePpeSetupCopyKey) => string): string {
  switch (item) {
    case 'HARD_HAT':
      return t('zoneSetup.ppe.HARD_HAT');
    case 'SAFETY_VEST':
      return t('zoneSetup.ppe.SAFETY_VEST');
    case 'GLOVES':
      return t('zoneSetup.ppe.GLOVES');
    case 'BOOTS':
      return t('zoneSetup.ppe.BOOTS');
    case 'GOGGLES':
      return t('zoneSetup.ppe.GOGGLES');
    default:
      return item;
  }
}

// Match the server's Unicode boundary; valid supplementary characters remain allowed.
export function hasControlOrSurrogate(value: string): boolean {
  return /[\p{Cc}\p{Cs}]/u.test(value);
}

export function isAuthOrScopeError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof ApiError) {
    return error.status === 401 || error.status === 403 || error.status === 404;
  }
  if (typeof error === 'object' && 'status' in error) {
    const s = (error as { status: unknown }).status;
    return s === 401 || s === 403 || s === 404;
  }
  return false;
}

export function validateZonePage(
  page: { items: ZoneResponse[]; total: number },
  pageParam: number,
): { items: ZoneResponse[]; total: number } {
  if (
    !page ||
    !Array.isArray(page.items) ||
    !Number.isSafeInteger(page.total) ||
    page.total < 0 ||
    page.items.length > 20
  ) {
    throw new ApiError('invalid-response', 'Zone list response is invalid.');
  }
  if (
    Array.isArray(page?.items) &&
    page.items.length === 0 &&
    typeof page.total === 'number' &&
    pageParam < page.total
  ) {
    throw new ApiError('invalid-response', 'Zone list response did not advance.');
  }
  return page;
}

export function getNextZonePageOffset(
  lastPage: { items: ZoneResponse[]; total: number } | undefined,
  _allPages: ReadonlyArray<{ items: ZoneResponse[]; total: number }>,
  lastPageParam: unknown,
): number | undefined {
  if (!lastPage || typeof lastPage.total !== 'number' || !Array.isArray(lastPage.items)) {
    return undefined;
  }
  if (lastPage.items.length === 0) {
    return undefined;
  }
  const currentOffset = typeof lastPageParam === 'number' ? lastPageParam : 0;
  const nextOffset = currentOffset + lastPage.items.length;
  return nextOffset < lastPage.total ? nextOffset : undefined;
}

export function dedupeScopedZones(
  rawPages: ReadonlyArray<{ items: ZoneResponse[]; total: number }> | undefined,
  siteId: string,
): { allZones: ZoneResponse[]; serverTotal: number } {
  if (!rawPages || rawPages.length === 0) {
    return { allZones: [], serverTotal: 0 };
  }
  const seenIds = new Set<string>();
  const list: ZoneResponse[] = [];
  let total = 0;
  for (const page of rawPages) {
    if (typeof page?.total === 'number') {
      total = page.total;
    }
    if (Array.isArray(page?.items)) {
      for (const zone of page.items) {
        if (zone && zone.id && !seenIds.has(zone.id) && zone.siteId === siteId) {
          seenIds.add(zone.id);
          list.push(zone);
        }
      }
    }
  }
  return { allZones: list, serverTotal: total };
}

export function mapCreateServerErrorKey(err: unknown): ZonePpeSetupCopyKey {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'zoneSetup.error.401';
    if (err.status === 403) return 'zoneSetup.error.403';
    if (err.status === 409) return 'zoneSetup.create.error.409';
  }
  return 'zoneSetup.create.error.default';
}

export function mapRenameServerErrorKey(err: unknown): ZonePpeSetupCopyKey {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'zoneSetup.error.401';
    if (err.status === 403) return 'zoneSetup.error.403';
    if (err.status === 409) return 'zoneSetup.rename.error.409';
  }
  return 'zoneSetup.rename.error.default';
}
