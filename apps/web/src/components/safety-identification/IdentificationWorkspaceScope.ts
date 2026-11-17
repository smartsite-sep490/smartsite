import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError, type LoginResponse } from '@smartsite/api-client';
import type { useManagementClient } from '../../features/auth/auth-session';
import type { StatusFilterValue } from './IdentificationWorkspaceCopy';
import {
  deriveAuthorizedSites,
  formatEpisodeOptionLabel,
  formatShortTimestamp,
  HISTORY_PAGE_SIZE,
  isAbortOrCancel,
  isHardDenial,
  isIdentificationAccessDenied,
  isIdentificationFeatureUnavailable,
  isIdentificationUnauthorized,
  QUEUE_PAGE_SIZE,
  resolveInitialSite,
  revocationKey,
  sameId,
  WORKSPACE_SELECT_CLASS,
  type AuthorizedSiteRole,
} from './IdentificationWorkspaceUtils';

export {
  deriveAuthorizedSites,
  formatEpisodeOptionLabel,
  formatShortTimestamp,
  HISTORY_PAGE_SIZE,
  isAbortOrCancel,
  isHardDenial,
  isIdentificationAccessDenied,
  isIdentificationFeatureUnavailable,
  isIdentificationUnauthorized,
  QUEUE_PAGE_SIZE,
  resolveInitialSite,
  revocationKey,
  sameId,
  WORKSPACE_SELECT_CLASS,
  type AuthorizedSiteRole,
};

export type ManagementClient = ReturnType<typeof useManagementClient>;
export type IdentificationQueryPrefix = readonly [
  'safety-identification-workspace',
  string,
  string,
];

export interface WorkspaceActiveScope {
  epoch: number;
  siteId: string;
  selectedRequestId: string | null;
}

export interface CredentialScopeState {
  scopeNonce: string;
  authorizedSites: readonly AuthorizedSiteRole[];
  hasValidSession: boolean;
}

export interface IdentificationSiteScopeParams {
  scopeNonce: string;
  apiUrl: string;
  authorizedSites: readonly AuthorizedSiteRole[];
  initialSiteId?: string;
  initialEpisodeId?: string;
  onSignOut?: () => void;
  queryClient: QueryClient;
}

export interface IdentificationSiteScope {
  siteEpoch: number;
  selectedSiteId: string;
  statusFilter: StatusFilterValue;
  queueOffset: number;
  selectedRequestId: string | null;
  historyOffset: number;
  isCreateOpen: boolean;
  createEpisodeId: string;
  createFeedbackResetNonce: number;
  isOfficer: boolean;
  isManager: boolean;
  queryPrefix: IdentificationQueryPrefix;
  aliveRef: { current: boolean };
  mutationGenerationRef: { current: number };
  mutationControllersRef: { current: Set<AbortController> };
  activeScopeRef: { current: WorkspaceActiveScope };
  setStatusFilter: Dispatch<SetStateAction<StatusFilterValue>>;
  setQueueOffset: Dispatch<SetStateAction<number>>;
  setSelectedRequestId: Dispatch<SetStateAction<string | null>>;
  setHistoryOffset: Dispatch<SetStateAction<number>>;
  setIsCreateOpen: Dispatch<SetStateAction<boolean>>;
  setCreateEpisodeId: Dispatch<SetStateAction<string>>;
  guardUnauthorized: (error: unknown) => void;
  runGuardedQuery: <T>(work: () => Promise<T>) => Promise<T>;
  isCurrentSiteMutation: (
    controller: AbortController,
    capturedGen: number,
    capturedEpoch: number,
    capturedSiteId: string,
  ) => boolean;
  handleSiteSwitch: (nextSiteId: string) => void;
  handleStatusFilterChange: (nextFilter: StatusFilterValue) => void;
}

export function useCredentialScope(
  apiUrl: string,
  session: Pick<LoginResponse, 'accessToken' | 'user'>,
): CredentialScopeState {
  const rolesSignature = JSON.stringify(session?.user?.roleAssignments ?? []);
  const [credentialScope, setCredentialScope] = useState(() => ({
    apiUrl,
    token: session?.accessToken ?? '',
    userId: session?.user?.id ?? '',
    rolesSignature,
    nonce: crypto.randomUUID(),
  }));

  if (
    credentialScope.apiUrl !== apiUrl ||
    credentialScope.token !== (session?.accessToken ?? '') ||
    credentialScope.userId !== (session?.user?.id ?? '') ||
    credentialScope.rolesSignature !== rolesSignature
  ) {
    setCredentialScope({
      apiUrl,
      token: session?.accessToken ?? '',
      userId: session?.user?.id ?? '',
      rolesSignature,
      nonce: crypto.randomUUID(),
    });
  }

  const authorizedSites = useMemo(
    () => deriveAuthorizedSites(session?.user?.roleAssignments),
    [session?.user?.roleAssignments],
  );

  const hasValidSession =
    Boolean(session?.accessToken?.trim()) &&
    Boolean(session?.user?.id?.trim()) &&
    Boolean(session?.user?.isActive) &&
    !session?.user?.mustChangePassword &&
    authorizedSites.length > 0;

  return {
    scopeNonce: credentialScope.nonce,
    authorizedSites,
    hasValidSession,
  };
}

export function useIdentificationSiteScope({
  scopeNonce,
  apiUrl,
  authorizedSites,
  initialSiteId,
  initialEpisodeId,
  onSignOut,
  queryClient,
}: IdentificationSiteScopeParams): IdentificationSiteScope {
  const aliveRef = useRef(true);
  const signedOutRef = useRef(false);
  const mutationGenerationRef = useRef(0);
  const mutationControllersRef = useRef<Set<AbortController>>(new Set());

  const [siteEpoch, setSiteEpoch] = useState(0);
  const [selectedSiteId, setSelectedSiteId] = useState<string>(() =>
    resolveInitialSite(authorizedSites, initialSiteId),
  );
  const [trackedInitialSiteId, setTrackedInitialSiteId] = useState<string | undefined>(
    initialSiteId,
  );
  const [trackedInitialEpisodeId, setTrackedInitialEpisodeId] = useState<string | undefined>(
    initialEpisodeId,
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('ALL');
  const [queueOffset, setQueueOffset] = useState(0);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [createFeedbackResetNonce, setCreateFeedbackResetNonce] = useState(0);

  const initialTrimmedEpisode = initialEpisodeId?.trim() ?? '';
  const initialRoleForSite = authorizedSites.find((entry) =>
    sameId(entry.siteId, resolveInitialSite(authorizedSites, initialSiteId)),
  );
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(() =>
    Boolean(initialTrimmedEpisode && initialRoleForSite?.isOfficer),
  );
  const [createEpisodeId, setCreateEpisodeId] = useState<string>(initialTrimmedEpisode);

  const activeScopeRef = useRef<WorkspaceActiveScope>({
    epoch: siteEpoch,
    siteId: selectedSiteId,
    selectedRequestId,
  });

  const abortInFlightMutations = useCallback(() => {
    for (const controller of mutationControllersRef.current) {
      controller.abort();
    }
    mutationControllersRef.current.clear();
  }, []);

  function resetSiteState(nextSiteId: string, nextEpisodeCandidate?: string) {
    const nextEpoch = siteEpoch + 1;
    const nextRole = authorizedSites.find((entry) => sameId(entry.siteId, nextSiteId));
    const trimmedEpisode = nextEpisodeCandidate?.trim() ?? '';
    const openCreateForNewSite = Boolean(trimmedEpisode && nextRole?.isOfficer);

    setSiteEpoch(nextEpoch);
    setSelectedSiteId(nextSiteId);
    setSelectedRequestId(null);
    setStatusFilter('ALL');
    setQueueOffset(0);
    setHistoryOffset(0);
    setCreateFeedbackResetNonce((current) => current + 1);
    setCreateEpisodeId(openCreateForNewSite ? trimmedEpisode : '');
    setIsCreateOpen(openCreateForNewSite);
  }

  if (trackedInitialSiteId !== initialSiteId) {
    setTrackedInitialSiteId(initialSiteId);
    setTrackedInitialEpisodeId(initialEpisodeId);
    const nextSite = resolveInitialSite(authorizedSites, initialSiteId);
    if (nextSite && !sameId(nextSite, selectedSiteId)) {
      resetSiteState(nextSite, initialEpisodeId);
    }
  } else if (trackedInitialEpisodeId !== initialEpisodeId) {
    setTrackedInitialEpisodeId(initialEpisodeId);
    const nextEpisode = initialEpisodeId?.trim() ?? '';
    const targetSiteRole = authorizedSites.find((entry) => sameId(entry.siteId, selectedSiteId));
    if (nextEpisode && targetSiteRole?.isOfficer) {
      setCreateEpisodeId(nextEpisode);
      setIsCreateOpen(true);
      setCreateFeedbackResetNonce((current) => current + 1);
    }
  }

  const currentSiteRole = useMemo(
    () =>
      authorizedSites.find((entry) => sameId(entry.siteId, selectedSiteId)) ?? authorizedSites[0]!,
    [authorizedSites, selectedSiteId],
  );

  const queryPrefix = useMemo<IdentificationQueryPrefix>(
    () => ['safety-identification-workspace', apiUrl, scopeNonce] as const,
    [apiUrl, scopeNonce],
  );

  useEffect(() => {
    activeScopeRef.current = {
      epoch: siteEpoch,
      siteId: selectedSiteId,
      selectedRequestId,
    };
  }, [selectedRequestId, selectedSiteId, siteEpoch]);

  useEffect(() => {
    const siteSnapshot = selectedSiteId;
    return () => {
      mutationGenerationRef.current += 1;
      abortInFlightMutations();
      void queryClient.cancelQueries({ queryKey: [...queryPrefix, 'site', siteSnapshot] });
    };
  }, [abortInFlightMutations, queryPrefix, queryClient, selectedSiteId, siteEpoch]);

  useEffect(() => {
    aliveRef.current = true;
    const prefixSnapshot = ['safety-identification-workspace', apiUrl, scopeNonce];
    return () => {
      aliveRef.current = false;
      mutationGenerationRef.current += 1;
      abortInFlightMutations();
      void queryClient.cancelQueries({ queryKey: prefixSnapshot });
      queryClient.removeQueries({ queryKey: prefixSnapshot });
    };
  }, [abortInFlightMutations, apiUrl, queryClient, scopeNonce]);

  const guardUnauthorized = useCallback(
    (error: unknown) => {
      if (
        aliveRef.current &&
        !signedOutRef.current &&
        error instanceof ApiError &&
        error.status === 401
      ) {
        signedOutRef.current = true;
        onSignOut?.();
      }
    },
    [onSignOut],
  );

  const runGuardedQuery = useCallback(
    async <T>(work: () => Promise<T>): Promise<T> => {
      try {
        return await work();
      } catch (error) {
        guardUnauthorized(error);
        throw error;
      }
    },
    [guardUnauthorized],
  );

  function isCurrentSiteMutation(
    controller: AbortController,
    capturedGen: number,
    capturedEpoch: number,
    capturedSiteId: string,
  ): boolean {
    return (
      aliveRef.current &&
      !controller.signal.aborted &&
      mutationGenerationRef.current === capturedGen &&
      activeScopeRef.current.epoch === capturedEpoch &&
      sameId(activeScopeRef.current.siteId, capturedSiteId)
    );
  }

  function handleSiteSwitch(nextSiteId: string) {
    if (sameId(nextSiteId, selectedSiteId)) return;
    mutationGenerationRef.current += 1;
    abortInFlightMutations();
    void queryClient.cancelQueries({ queryKey: [...queryPrefix, 'site', selectedSiteId] });
    resetSiteState(nextSiteId);
  }

  function handleStatusFilterChange(nextFilter: StatusFilterValue) {
    if (nextFilter === statusFilter) return;
    setStatusFilter(nextFilter);
    setQueueOffset(0);
  }

  return {
    siteEpoch,
    selectedSiteId,
    statusFilter,
    queueOffset,
    selectedRequestId,
    historyOffset,
    isCreateOpen,
    createEpisodeId,
    createFeedbackResetNonce,
    isOfficer: currentSiteRole.isOfficer,
    isManager: currentSiteRole.isManager,
    queryPrefix,
    aliveRef,
    mutationGenerationRef,
    mutationControllersRef,
    activeScopeRef,
    setStatusFilter,
    setQueueOffset,
    setSelectedRequestId,
    setHistoryOffset,
    setIsCreateOpen,
    setCreateEpisodeId,
    guardUnauthorized,
    runGuardedQuery,
    isCurrentSiteMutation,
    handleSiteSwitch,
    handleStatusFilterChange,
  };
}
