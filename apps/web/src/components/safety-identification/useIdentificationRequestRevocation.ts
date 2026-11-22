import { useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import {
  formatIdentificationError,
  type IdentificationWorkspaceCopy,
} from './IdentificationWorkspaceCopy';
import {
  isAbortOrCancel,
  revocationKey,
  sameId,
  type IdentificationSiteScope,
  type ManagementClient,
} from './IdentificationWorkspaceScope';

export interface ScopedRevokedRequest {
  epoch: number;
  siteId: string;
  requestId: string;
  message: string;
}

interface ScopedRevokedReloadInFlight {
  opId: string;
  epoch: number;
  siteId: string;
  requestId: string;
}

export interface IdentificationRevocationParams {
  client: ManagementClient;
  accessToken: string;
  queryClient: QueryClient;
  copy: IdentificationWorkspaceCopy;
  scope: IdentificationSiteScope;
}

export interface IdentificationRequestRevocationResult {
  activeRevocation: ScopedRevokedRequest | null;
  detailStaleTime: number;
  isReloadingSelectedRevoked: boolean;
  clearRecentlyReloadedKey: () => void;
  clearRevocationForRequest: (epoch: number, siteId: string, requestId: string) => void;
  revokeRequestOnHardDenial: (
    epoch: number,
    siteId: string,
    requestId: string,
    message: string,
  ) => void;
  reloadRevokedRequest: (
    targetRequestId: string,
    siteQueueDenied: boolean,
    onClearDetailFeedback: (epoch: number, requestId: string) => void,
  ) => Promise<void>;
}

export function useIdentificationRequestRevocation({
  client,
  accessToken,
  queryClient,
  copy,
  scope,
}: IdentificationRevocationParams): IdentificationRequestRevocationResult {
  const [trackedEpoch, setTrackedEpoch] = useState(scope.siteEpoch);
  const [revokedRequests, setRevokedRequests] = useState<Record<string, ScopedRevokedRequest>>({});
  const [reloadingRevoked, setReloadingRevoked] = useState<ScopedRevokedReloadInFlight | null>(
    null,
  );
  const [recentlyReloadedRequestKey, setRecentlyReloadedRequestKey] = useState<string | null>(null);

  if (trackedEpoch !== scope.siteEpoch) {
    setTrackedEpoch(scope.siteEpoch);
    setRevokedRequests({});
    setReloadingRevoked(null);
    setRecentlyReloadedRequestKey(null);
  }

  const selectedRevocationKey = scope.selectedRequestId
    ? revocationKey(scope.siteEpoch, scope.selectedSiteId, scope.selectedRequestId)
    : null;

  const activeRevocation: ScopedRevokedRequest | null =
    selectedRevocationKey !== null ? (revokedRequests[selectedRevocationKey] ?? null) : null;

  const detailStaleTime =
    selectedRevocationKey !== null && recentlyReloadedRequestKey === selectedRevocationKey
      ? 5_000
      : 0;

  const isReloadingSelectedRevoked = Boolean(
    reloadingRevoked &&
    reloadingRevoked.epoch === scope.siteEpoch &&
    sameId(reloadingRevoked.siteId, scope.selectedSiteId) &&
    scope.selectedRequestId !== null &&
    sameId(reloadingRevoked.requestId, scope.selectedRequestId),
  );

  function clearRecentlyReloadedKey() {
    setRecentlyReloadedRequestKey(null);
  }

  function clearRevocationForRequest(epoch: number, siteId: string, requestId: string) {
    const revKey = revocationKey(epoch, siteId, requestId);
    setRevokedRequests((prev) => {
      if (!(revKey in prev)) return prev;
      const next = { ...prev };
      delete next[revKey];
      return next;
    });
  }

  function revokeRequestOnHardDenial(
    epoch: number,
    siteId: string,
    requestId: string,
    message: string,
  ) {
    const revKey = revocationKey(epoch, siteId, requestId);
    void queryClient.cancelQueries({
      queryKey: [...scope.queryPrefix, 'site', siteId, 'detail', requestId],
    });
    queryClient.removeQueries({
      queryKey: [...scope.queryPrefix, 'site', siteId, 'detail', requestId],
    });
    void queryClient.cancelQueries({
      queryKey: [...scope.queryPrefix, 'site', siteId, 'history', requestId],
    });
    queryClient.removeQueries({
      queryKey: [...scope.queryPrefix, 'site', siteId, 'history', requestId],
    });
    const isRetrospectiveForRequest = (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[0] === scope.queryPrefix[0] &&
      query.queryKey[1] === scope.queryPrefix[1] &&
      query.queryKey[2] === scope.queryPrefix[2] &&
      query.queryKey[3] === 'site' &&
      sameId(String(query.queryKey[4] ?? ''), siteId) &&
      (query.queryKey[5] === 'zone-reassessments' ||
        query.queryKey[5] === 'zone-reassessment-options') &&
      sameId(String(query.queryKey[7] ?? ''), requestId);
    void queryClient.cancelQueries({ predicate: isRetrospectiveForRequest });
    queryClient.removeQueries({ predicate: isRetrospectiveForRequest });
    setRecentlyReloadedRequestKey((prev) => (prev === revKey ? null : prev));
    setRevokedRequests((prev) => ({
      ...prev,
      [revKey]: {
        epoch,
        siteId,
        requestId,
        message,
      },
    }));
  }

  async function reloadRevokedRequest(
    targetRequestId: string,
    siteQueueDenied: boolean,
    onClearDetailFeedback: (epoch: number, requestId: string) => void,
  ) {
    if (!targetRequestId || siteQueueDenied) return;
    if (
      reloadingRevoked &&
      reloadingRevoked.epoch === scope.siteEpoch &&
      sameId(reloadingRevoked.siteId, scope.selectedSiteId) &&
      sameId(reloadingRevoked.requestId, targetRequestId)
    ) {
      return;
    }

    const capturedEpoch = scope.siteEpoch;
    const capturedGen = scope.mutationGenerationRef.current;
    const capturedSite = scope.selectedSiteId;
    const revKey = revocationKey(capturedEpoch, capturedSite, targetRequestId);
    const opId = crypto.randomUUID();

    const controller = new AbortController();
    scope.mutationControllersRef.current.add(controller);
    setReloadingRevoked({
      opId,
      epoch: capturedEpoch,
      siteId: capturedSite,
      requestId: targetRequestId,
    });

    try {
      const fresh = await client.getSafetyIdentificationRequest(
        accessToken,
        capturedSite,
        targetRequestId,
        { signal: controller.signal },
      );

      if (!scope.isCurrentSiteMutation(controller, capturedGen, capturedEpoch, capturedSite)) {
        return;
      }

      if (!fresh || !sameId(fresh.id, targetRequestId) || !sameId(fresh.siteId, capturedSite)) {
        return;
      }

      queryClient.setQueryData(
        [...scope.queryPrefix, 'site', capturedSite, 'detail', targetRequestId],
        fresh,
      );
      setRecentlyReloadedRequestKey(revKey);
      onClearDetailFeedback(capturedEpoch, targetRequestId);
      clearRevocationForRequest(capturedEpoch, capturedSite, targetRequestId);
    } catch (error) {
      if (!scope.aliveRef.current || isAbortOrCancel(error)) return;
      scope.guardUnauthorized(error);
      if (!scope.isCurrentSiteMutation(controller, capturedGen, capturedEpoch, capturedSite)) {
        return;
      }
      const formatted = formatIdentificationError(error, copy);
      setRevokedRequests((prev) => ({
        ...prev,
        [revKey]: {
          epoch: capturedEpoch,
          siteId: capturedSite,
          requestId: targetRequestId,
          message: formatted,
        },
      }));
    } finally {
      scope.mutationControllersRef.current.delete(controller);
      if (scope.aliveRef.current) {
        setReloadingRevoked((prev) => (prev?.opId === opId ? null : prev));
      }
    }
  }

  return {
    activeRevocation,
    detailStaleTime,
    isReloadingSelectedRevoked,
    clearRecentlyReloadedKey,
    clearRevocationForRequest,
    revokeRequestOnHardDenial,
    reloadRevokedRequest,
  };
}
