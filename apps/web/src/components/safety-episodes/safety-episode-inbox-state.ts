import { ApiError, type SmartSiteManagementClient } from '@smartsite/api-client';
import type {
  SafetyEpisodeInboxItem,
  SafetyEpisodeInboxPage,
  SafetyEpisodeReadResponse,
} from '@smartsite/contracts/safety-episodes';

export type SafetyEpisodeInboxClient = Pick<
  SmartSiteManagementClient,
  'listSafetyEpisodeInbox' | 'readSafetyEpisodeInbox'
>;

export interface SafetyEpisodeInboxSiteOption {
  id: string;
  name: string;
}

export interface SafetyEpisodeInboxWorkspaceProps {
  client: SafetyEpisodeInboxClient;
  token: string;
  scopeKey: string;
  apiUrl: string;
  sites: readonly SafetyEpisodeInboxSiteOption[];
  onOpenEpisode(item: SafetyEpisodeInboxItem): void;
  onHardDenied?: () => void;
}

export interface NormalizedSiteOption {
  key: string;
  id: string;
  name: string;
}

export interface InboxScopeSnapshot {
  client: SafetyEpisodeInboxClient;
  token: string;
  scopeKey: string;
  apiUrl: string;
  sortedSiteIdsKey: string;
  generation: number;
}

export interface DerivedInboxCollection {
  authorizedItems: SafetyEpisodeInboxItem[];
  recipientIndexMap: Map<string, number>;
  groupedBySite: Map<string, SafetyEpisodeInboxItem[]>;
  allowedSiteMap: Map<string, NormalizedSiteOption>;
  rawReturnedCount: number;
  serverTotal: number;
  serverUnreadCount: number;
  hasMore: boolean;
}

export const INBOX_PAGE_LIMIT = 20;

export const isForbiddenError = (error: unknown): boolean =>
  error instanceof ApiError && error.status !== undefined && [401, 403, 404].includes(error.status);

export const formatInboxTimestamp = (value: string, locale: string): string => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString(locale) : value;
};

export function normalizeAuthorizedSites(
  sites: readonly SafetyEpisodeInboxSiteOption[],
): NormalizedSiteOption[] {
  const seen = new Set<string>();
  const result: NormalizedSiteOption[] = [];
  for (const site of sites) {
    const trimmedId = site.id.trim();
    const key = trimmedId.toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({
      key,
      id: trimmedId,
      name: site.name.trim() || trimmedId,
    });
  }
  return result;
}

export function buildSortedSiteIdsKey(sites: readonly NormalizedSiteOption[]): string {
  return sites
    .map((site) => site.key)
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .join(',');
}

export function computeNextInboxOffset(
  lastPage: SafetyEpisodeInboxPage,
  allPages: readonly SafetyEpisodeInboxPage[],
): number | undefined {
  if (lastPage.items.length === 0) {
    return undefined;
  }
  const rawReturnedCount = allPages.reduce((sum, page) => sum + page.items.length, 0);
  if (rawReturnedCount >= lastPage.total) {
    return undefined;
  }
  return rawReturnedCount;
}

export function deriveAuthorizedInboxCollection({
  loadedPages,
  allowedSites,
  effectiveSiteKey,
  readStatus,
  acknowledgedReads,
  hasNextPage,
}: {
  loadedPages: readonly SafetyEpisodeInboxPage[];
  allowedSites: readonly NormalizedSiteOption[];
  effectiveSiteKey: string | null;
  readStatus: 'ALL' | 'UNREAD';
  acknowledgedReads: Readonly<Record<string, SafetyEpisodeReadResponse>>;
  hasNextPage: boolean;
}): DerivedInboxCollection {
  const allowedSiteMap = new Map<string, NormalizedSiteOption>();
  for (const site of allowedSites) {
    allowedSiteMap.set(site.key, site);
  }

  const lastPage = loadedPages.at(-1);
  const rawReturnedCount = loadedPages.reduce((sum, page) => sum + page.items.length, 0);
  const serverTotal = lastPage?.total ?? 0;
  const serverUnreadCount = lastPage?.unreadCount ?? 0;
  const hasMore = Boolean(
    lastPage && lastPage.items.length > 0 && rawReturnedCount < lastPage.total && hasNextPage,
  );

  const authorizedItems: SafetyEpisodeInboxItem[] = [];
  const recipientIndexMap = new Map<string, number>();

  for (const page of loadedPages) {
    for (const rawItem of page.items) {
      const siteKey = rawItem.episode.siteId.toLowerCase();
      if (!allowedSiteMap.has(siteKey)) {
        continue;
      }
      if (effectiveSiteKey !== null && siteKey !== effectiveSiteKey) {
        continue;
      }
      const recipientKey = rawItem.id.toLowerCase();
      const ack = acknowledgedReads[recipientKey];
      const isSameRevisionAck = Boolean(
        ack && ack.contentRevision === rawItem.episode.contentRevision,
      );
      const effectiveSeenRevision =
        isSameRevisionAck && ack
          ? Math.max(rawItem.seenRevision, ack.seenRevision)
          : rawItem.seenRevision;
      const effectiveUnread = isSameRevisionAck
        ? effectiveSeenRevision < rawItem.episode.contentRevision
        : rawItem.unread;

      if (readStatus === 'UNREAD' && !effectiveUnread) {
        continue;
      }

      const mergedItem: SafetyEpisodeInboxItem =
        effectiveSeenRevision !== rawItem.seenRevision || effectiveUnread !== rawItem.unread
          ? {
              ...rawItem,
              seenRevision: effectiveSeenRevision,
              unread: effectiveUnread,
            }
          : rawItem;

      const existingIdx = recipientIndexMap.get(recipientKey);
      if (existingIdx === undefined) {
        recipientIndexMap.set(recipientKey, authorizedItems.length);
        authorizedItems.push(mergedItem);
      } else {
        const previous = authorizedItems[existingIdx];
        if (
          previous &&
          (mergedItem.episode.contentRevision > previous.episode.contentRevision ||
            (mergedItem.episode.contentRevision === previous.episode.contentRevision &&
              mergedItem.seenRevision >= previous.seenRevision))
        ) {
          authorizedItems[existingIdx] = mergedItem;
        }
      }
    }
  }

  const groupedBySite = new Map<string, SafetyEpisodeInboxItem[]>();
  for (const item of authorizedItems) {
    const siteKey = item.episode.siteId.toLowerCase();
    const list = groupedBySite.get(siteKey);
    if (list) {
      list.push(item);
    } else {
      groupedBySite.set(siteKey, [item]);
    }
  }

  return {
    authorizedItems,
    recipientIndexMap,
    groupedBySite,
    allowedSiteMap,
    rawReturnedCount,
    serverTotal,
    serverUnreadCount,
    hasMore,
  };
}
