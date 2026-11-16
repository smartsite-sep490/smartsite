import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SafetyIdentificationRequest } from '@smartsite/contracts/safety-identification';
import type { IdentificationWorkspaceCopy } from './IdentificationWorkspaceCopy';
import {
  isHardDenial,
  isIdentificationFeatureUnavailable,
  QUEUE_PAGE_SIZE,
  sameId,
  type IdentificationSiteScope,
  type ManagementClient,
} from './IdentificationWorkspaceScope';
import type { ScopedRevokedRequest } from './useIdentificationRequestRevocation';
import {
  useIdentificationSupportingQueries,
  type IdentificationSupportingQueriesResult,
} from './useIdentificationSupportingQueries';

export interface IdentificationWorkspaceQueriesParams {
  client: ManagementClient;
  accessToken: string;
  currentUserId: string;
  initialEpisodeId?: string;
  activeRevocation: ScopedRevokedRequest | null;
  detailStaleTime: number;
  copy: IdentificationWorkspaceCopy;
  scope: IdentificationSiteScope;
}

export interface IdentificationWorkspaceQueriesResult extends IdentificationSupportingQueriesResult {
  siteLabelsById: ReadonlyMap<string, string>;
  queueItems: readonly SafetyIdentificationRequest[];
  queueTotal: number;
  queueLoading: boolean;
  queueFetching: boolean;
  queueError: unknown;
  queueHasError: boolean;
  queueAvailable: boolean;
  siteQueueUnavailable: boolean;
  siteQueueDenied: boolean;
  refetchQueue: () => Promise<{ isError: boolean }>;
  activeRequest: SafetyIdentificationRequest | null;
  detailPending: boolean;
  detailFetching: boolean;
  detailError: unknown;
  detailHasError: boolean;
  refetchDetail: () => Promise<{ isError: boolean }>;
}

export function useIdentificationWorkspaceQueries({
  client,
  accessToken,
  currentUserId,
  initialEpisodeId,
  activeRevocation,
  detailStaleTime,
  copy,
  scope,
}: IdentificationWorkspaceQueriesParams): IdentificationWorkspaceQueriesResult {
  const {
    queryPrefix,
    selectedSiteId,
    statusFilter,
    queueOffset,
    selectedRequestId,
    guardUnauthorized,
    runGuardedQuery,
  } = scope;

  const sitesMetadataQuery = useQuery({
    queryKey: [...queryPrefix, 'sites-metadata'],
    queryFn: async ({ signal }) => {
      if (typeof client.listSites !== 'function') {
        return { items: [] };
      }
      try {
        const result = await client.listSites(accessToken, { offset: 0, limit: 100 }, { signal });
        return result && Array.isArray(result.items) ? result : { items: [] };
      } catch (error) {
        guardUnauthorized(error);
        return { items: [] };
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  const siteLabelsById = useMemo(() => {
    const map = new Map<string, string>();
    if (sitesMetadataQuery.isError) return map;
    for (const site of sitesMetadataQuery.data?.items ?? []) {
      map.set(site.id.toLowerCase(), site.code ? `${site.name} (${site.code})` : site.name);
    }
    return map;
  }, [sitesMetadataQuery.data?.items, sitesMetadataQuery.isError]);

  const queueQuery = useQuery({
    queryKey: [...queryPrefix, 'site', selectedSiteId, 'queue', statusFilter, queueOffset],
    queryFn: ({ signal }) =>
      runGuardedQuery(() =>
        client.listSafetyIdentificationRequests(
          accessToken,
          selectedSiteId,
          {
            offset: queueOffset,
            limit: QUEUE_PAGE_SIZE,
            ...(statusFilter === 'ALL' ? {} : { status: statusFilter }),
          },
          { signal },
        ),
      ),
    enabled: Boolean(selectedSiteId),
    refetchOnWindowFocus: false,
    retry: false,
  });

  const queueAvailable = queueQuery.isSuccess && !queueQuery.isError;
  const siteQueueUnavailable =
    queueQuery.isError && isIdentificationFeatureUnavailable(queueQuery.error);
  const siteQueueDenied =
    queueQuery.isError && (isHardDenial(queueQuery.error) || siteQueueUnavailable);

  const detailQuery = useQuery({
    queryKey: [...queryPrefix, 'site', selectedSiteId, 'detail', selectedRequestId],
    queryFn: ({ signal }) =>
      runGuardedQuery(() =>
        client.getSafetyIdentificationRequest(accessToken, selectedSiteId, selectedRequestId!, {
          signal,
        }),
      ),
    enabled: Boolean(
      selectedSiteId && selectedRequestId && !siteQueueDenied && activeRevocation === null,
    ),
    staleTime: detailStaleTime,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const queueItems = useMemo(() => {
    if (queueQuery.isError) return [];
    return (queueQuery.data?.items ?? []).filter((item) => sameId(item.siteId, selectedSiteId));
  }, [queueQuery.data?.items, queueQuery.isError, selectedSiteId]);

  const queueTotal = queueQuery.isError ? 0 : (queueQuery.data?.total ?? 0);

  const activeRequest: SafetyIdentificationRequest | null = useMemo(() => {
    if (
      !selectedRequestId ||
      activeRevocation !== null ||
      detailQuery.isError ||
      queueQuery.isError
    ) {
      return null;
    }
    const fromDetail = detailQuery.data;
    if (
      fromDetail &&
      sameId(fromDetail.id, selectedRequestId) &&
      sameId(fromDetail.siteId, selectedSiteId)
    ) {
      return fromDetail;
    }
    return null;
  }, [
    activeRevocation,
    detailQuery.data,
    detailQuery.isError,
    queueQuery.isError,
    selectedRequestId,
    selectedSiteId,
  ]);

  const supporting = useIdentificationSupportingQueries({
    client,
    accessToken,
    currentUserId,
    initialEpisodeId,
    activeRequest,
    detailHasError: detailQuery.isError,
    queueAvailable,
    siteQueueDenied,
    activeRevocation,
    copy,
    scope,
  });

  return {
    siteLabelsById,
    queueItems,
    queueTotal,
    queueLoading: queueQuery.isPending,
    queueFetching: queueQuery.isFetching,
    queueError: queueQuery.error,
    queueHasError: queueQuery.isError,
    queueAvailable,
    siteQueueUnavailable,
    siteQueueDenied,
    refetchQueue: () => queueQuery.refetch(),
    activeRequest,
    detailPending: detailQuery.isPending,
    detailFetching: detailQuery.isFetching,
    detailError: detailQuery.error,
    detailHasError: detailQuery.isError,
    refetchDetail: () => detailQuery.refetch(),
    ...supporting,
  };
}
