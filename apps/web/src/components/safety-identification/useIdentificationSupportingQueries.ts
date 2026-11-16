import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  SafetyIdentificationHistoryPage,
  SafetyIdentificationRequest,
} from '@smartsite/contracts/safety-identification';
import type { SafetyEpisodeSummary } from '@smartsite/contracts';
import type { NamedCandidate } from './SafetyIdentificationForms';
import {
  formatIdentificationError,
  type IdentificationWorkspaceCopy,
} from './IdentificationWorkspaceCopy';
import type { WorkerCandidateOption } from './SafetyIdentificationDetailPanel';
import {
  HISTORY_PAGE_SIZE,
  sameId,
  type IdentificationSiteScope,
  type ManagementClient,
} from './IdentificationWorkspaceScope';
import type { ScopedRevokedRequest } from './useIdentificationRequestRevocation';

export interface IdentificationSupportingQueriesParams {
  client: ManagementClient;
  accessToken: string;
  currentUserId: string;
  initialEpisodeId?: string;
  activeRequest: SafetyIdentificationRequest | null;
  detailHasError: boolean;
  queueAvailable: boolean;
  siteQueueDenied: boolean;
  activeRevocation: ScopedRevokedRequest | null;
  copy: IdentificationWorkspaceCopy;
  scope: IdentificationSiteScope;
}

export interface IdentificationSupportingQueriesResult {
  eligibleAssignee: NamedCandidate | null;
  assigneeLoading: boolean;
  assigneeError: unknown;
  assigneeHasError: boolean;
  refetchAssignee: () => Promise<{ isError: boolean }>;
  shouldLoadEpisodes: boolean;
  episodesPending: boolean;
  episodeOptions: readonly SafetyEpisodeSummary[];
  historyPage: SafetyIdentificationHistoryPage | undefined;
  historyFetching: boolean;
  historyError: string | null;
  refetchHistory: () => Promise<{ isError: boolean }>;
  workerCandidates: readonly WorkerCandidateOption[];
  contractorCandidates: readonly NamedCandidate[];
  candidatesLoading: boolean;
  candidatesError: string | null;
}

export function useIdentificationSupportingQueries({
  client,
  accessToken,
  currentUserId,
  initialEpisodeId,
  activeRequest,
  detailHasError,
  queueAvailable,
  siteQueueDenied,
  activeRevocation,
  copy,
  scope,
}: IdentificationSupportingQueriesParams): IdentificationSupportingQueriesResult {
  const {
    queryPrefix,
    selectedSiteId,
    selectedRequestId,
    historyOffset,
    isCreateOpen,
    isOfficer,
    isManager,
    runGuardedQuery,
  } = scope;

  const needsOfficerAssignee =
    isOfficer &&
    queueAvailable &&
    !siteQueueDenied &&
    (isCreateOpen ||
      (activeRequest !== null &&
        (activeRequest.status === 'OPEN' || activeRequest.status === 'RESPONDED')));

  const assigneeQuery = useQuery({
    queryKey: [...queryPrefix, 'site', selectedSiteId, 'assignee'],
    queryFn: ({ signal }) =>
      runGuardedQuery(() =>
        client.getSafetyIdentificationAssignee(accessToken, selectedSiteId, { signal }),
      ),
    enabled: Boolean(selectedSiteId && needsOfficerAssignee),
    refetchOnWindowFocus: false,
    retry: false,
  });

  const eligibleAssignee: NamedCandidate | null = useMemo(() => {
    if (!isOfficer || !queueAvailable || assigneeQuery.isError || siteQueueDenied) return null;
    const raw = assigneeQuery.data?.assignee;
    if (!raw || !raw.id) return null;
    return { id: raw.id, displayName: raw.displayName };
  }, [
    assigneeQuery.data?.assignee,
    assigneeQuery.isError,
    isOfficer,
    queueAvailable,
    siteQueueDenied,
  ]);

  const shouldLoadEpisodes =
    isOfficer &&
    isCreateOpen &&
    queueAvailable &&
    !siteQueueDenied &&
    !initialEpisodeId?.trim() &&
    typeof client.listSafetyEpisodes === 'function';

  const episodesQuery = useQuery({
    queryKey: [...queryPrefix, 'site', selectedSiteId, 'episodes'],
    queryFn: ({ signal }) =>
      runGuardedQuery(async () => {
        const page = await client.listSafetyEpisodes(
          accessToken,
          selectedSiteId,
          { offset: 0, limit: 20 },
          { signal },
        );
        return page && Array.isArray(page.items) ? page.items : [];
      }),
    enabled: Boolean(selectedSiteId && shouldLoadEpisodes),
    refetchOnWindowFocus: false,
    retry: false,
  });

  const episodeOptions = useMemo(() => {
    if (episodesQuery.isError || siteQueueDenied) return [];
    return episodesQuery.data ?? [];
  }, [episodesQuery.data, episodesQuery.isError, siteQueueDenied]);

  const historyQuery = useQuery({
    queryKey: [...queryPrefix, 'site', selectedSiteId, 'history', selectedRequestId, historyOffset],
    queryFn: ({ signal }) =>
      runGuardedQuery(() =>
        client.listSafetyIdentificationHistory(
          accessToken,
          selectedSiteId,
          selectedRequestId!,
          { offset: historyOffset, limit: HISTORY_PAGE_SIZE },
          { signal },
        ),
      ),
    enabled: Boolean(
      isOfficer &&
      selectedSiteId &&
      selectedRequestId &&
      !detailHasError &&
      !siteQueueDenied &&
      activeRevocation === null,
    ),
    refetchOnWindowFocus: false,
    retry: false,
  });

  const canManagerRespondActive =
    isManager &&
    activeRequest !== null &&
    activeRequest.status === 'OPEN' &&
    sameId(activeRequest.assignedTo, currentUserId) &&
    !sameId(activeRequest.requestedBy, currentUserId);

  const workersQuery = useQuery({
    queryKey: [...queryPrefix, 'site', selectedSiteId, 'workers'],
    queryFn: () =>
      runGuardedQuery(async () => {
        if (typeof client.listWorkers !== 'function') {
          return [];
        }
        const page = await client.listWorkers(accessToken, selectedSiteId, {
          offset: 0,
          limit: 100,
        });
        return page && Array.isArray(page.items) ? page.items : [];
      }),
    enabled: Boolean(selectedSiteId && canManagerRespondActive),
    refetchOnWindowFocus: false,
    retry: false,
  });

  const contractorsQuery = useQuery({
    queryKey: [...queryPrefix, 'site', selectedSiteId, 'contractors'],
    queryFn: () =>
      runGuardedQuery(async () => {
        if (typeof client.managerOverview === 'function') {
          const overview = await client.managerOverview(accessToken, selectedSiteId, {
            offset: 0,
            limit: 100,
          });
          const items = overview?.contractors?.items;
          return Array.isArray(items) ? items : [];
        }
        if (typeof client.listContractors === 'function') {
          const page = await client.listContractors(accessToken, selectedSiteId, {
            offset: 0,
            limit: 100,
          });
          return page && Array.isArray(page.items) ? page.items : [];
        }
        return [];
      }),
    enabled: Boolean(selectedSiteId && canManagerRespondActive),
    refetchOnWindowFocus: false,
    retry: false,
  });

  const workerCandidates = useMemo<readonly WorkerCandidateOption[]>(() => {
    if (workersQuery.isError || detailHasError || siteQueueDenied || activeRevocation !== null) {
      return [];
    }
    const raw = workersQuery.data ?? [];
    return raw
      .filter(
        (worker) =>
          worker.isActive !== false && (!worker.siteId || sameId(worker.siteId, selectedSiteId)),
      )
      .map((worker) => ({
        id: worker.id,
        displayName: worker.externalId
          ? `${worker.displayName} (${worker.externalId})`
          : worker.displayName,
        contractorId: worker.contractorId ?? null,
      }));
  }, [
    activeRevocation,
    detailHasError,
    selectedSiteId,
    siteQueueDenied,
    workersQuery.data,
    workersQuery.isError,
  ]);

  const contractorCandidates = useMemo<readonly NamedCandidate[]>(() => {
    if (
      contractorsQuery.isError ||
      detailHasError ||
      siteQueueDenied ||
      activeRevocation !== null
    ) {
      return [];
    }
    const raw = contractorsQuery.data ?? [];
    return raw.map((contractor) => ({
      id: contractor.id,
      displayName: contractor.code ? `${contractor.name} (${contractor.code})` : contractor.name,
    }));
  }, [
    activeRevocation,
    contractorsQuery.data,
    contractorsQuery.isError,
    detailHasError,
    siteQueueDenied,
  ]);

  const candidatesError = useMemo(() => {
    const err = workersQuery.error ?? contractorsQuery.error;
    return err ? formatIdentificationError(err, copy) : null;
  }, [contractorsQuery.error, copy, workersQuery.error]);

  return {
    eligibleAssignee,
    assigneeLoading: assigneeQuery.isPending || assigneeQuery.isFetching,
    assigneeError: assigneeQuery.error,
    assigneeHasError: assigneeQuery.isError,
    refetchAssignee: () => assigneeQuery.refetch(),
    shouldLoadEpisodes,
    episodesPending: episodesQuery.isPending,
    episodeOptions,
    historyPage: isOfficer && !historyQuery.isError ? historyQuery.data : undefined,
    historyFetching: isOfficer ? historyQuery.isFetching : false,
    historyError:
      isOfficer && historyQuery.error ? formatIdentificationError(historyQuery.error, copy) : null,
    refetchHistory: () => historyQuery.refetch(),
    workerCandidates,
    contractorCandidates,
    candidatesLoading: workersQuery.isPending || contractorsQuery.isPending,
    candidatesError,
  };
}
