import { ApiError, type LoginResponse } from '@smartsite/api-client';
import type { SafetyEpisodeSummary } from '@smartsite/contracts';
import { uiLocale } from '../../i18n';

export interface AuthorizedSiteRole {
  siteId: string;
  isOfficer: boolean;
  isManager: boolean;
}

export const QUEUE_PAGE_SIZE = 20;
export const HISTORY_PAGE_SIZE = 10;

export const WORKSPACE_SELECT_CLASS =
  'h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-900 outline-none transition-colors hover:border-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:cursor-not-allowed disabled:bg-slate-100';

export function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function revocationKey(epoch: number, siteId: string, requestId: string): string {
  return `${epoch}:${siteId.trim().toLowerCase()}:${requestId.trim().toLowerCase()}`;
}

export function isAbortOrCancel(error: unknown): boolean {
  if (error instanceof ApiError && error.code === 'cancelled') return true;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  return error instanceof Error && error.name === 'AbortError';
}

export function isHardDenial(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status !== undefined &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  );
}

export function isIdentificationFeatureUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 503);
}

export function isIdentificationAccessDenied(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

export function isIdentificationUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function deriveAuthorizedSites(
  roleAssignments: LoginResponse['user']['roleAssignments'] | undefined,
): AuthorizedSiteRole[] {
  const byLowerId = new Map<string, AuthorizedSiteRole>();
  for (const assignment of roleAssignments ?? []) {
    if (assignment.role !== 'SAFETY_OFFICER' && assignment.role !== 'SITE_MANAGER') {
      continue;
    }
    const trimmedSiteId = assignment.siteId?.trim();
    if (!trimmedSiteId) {
      continue;
    }
    const key = trimmedSiteId.toLowerCase();
    const existing = byLowerId.get(key) ?? {
      siteId: trimmedSiteId,
      isOfficer: false,
      isManager: false,
    };
    if (assignment.role === 'SAFETY_OFFICER') existing.isOfficer = true;
    if (assignment.role === 'SITE_MANAGER') existing.isManager = true;
    byLowerId.set(key, existing);
  }
  return [...byLowerId.values()];
}

export function resolveInitialSite(
  authorizedSites: readonly AuthorizedSiteRole[],
  requestedSiteId?: string,
): string {
  const trimmed = requestedSiteId?.trim();
  if (trimmed) {
    const matched = authorizedSites.find((entry) => sameId(entry.siteId, trimmed));
    if (matched) return matched.siteId;
  }
  return authorizedSites[0]?.siteId ?? '';
}

export function formatShortTimestamp(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleString(uiLocale());
}

export function formatEpisodeOptionLabel(episode: SafetyEpisodeSummary): string {
  const observed = formatShortTimestamp(episode.lastObservedAt);
  return `${observed} · ${episode.findingCount} findings (${episode.id.slice(0, 8)})`;
}
