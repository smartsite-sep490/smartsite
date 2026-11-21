import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cameraSourceClient,
  SourceSetupError,
  type CameraSourceClient,
  type SourceHost,
} from '@smartsite/api-client';
import type { SourceConfigurationResumeCommand } from '@smartsite/contracts';

export interface CameraSourceResumeControllerOptions {
  apiUrl: string;
  token: string;
  siteId: string;
  camera: { id: string; name: string; configurationVersion?: number } | null;
  setupKey: readonly unknown[];
  canWrite: boolean;
  enabled: boolean;
  onUnauthorized: () => void;
  client?: CameraSourceClient;
}

export interface CameraSourceResumeController {
  hosts: ReturnType<typeof useQuery<SourceHost[]>>;
  hostAccessDenied: boolean;
  availableHosts: SourceHost[];
  hostId: string;
  host: SourceHost | undefined;
  caps: SourceHost['capabilities'] | undefined;
  selectHostId: (nextHostId: string) => void;
  resuming: ReturnType<typeof useMutation<unknown, unknown, void>>;
  revoked: boolean;
  markRevoked: () => void;
  sourceBusy: boolean;
  setSourceBusy: (busy: boolean) => void;
  refreshingCaps: boolean;
  refreshHosts: () => Promise<void>;
  onSourceApplied: () => void;
  canResume: boolean;
  triggerResume: () => void;
}

export function useCameraSourceResumeController({
  apiUrl,
  token,
  siteId,
  camera,
  setupKey,
  canWrite,
  enabled,
  onUnauthorized,
  client = cameraSourceClient,
}: CameraSourceResumeControllerOptions): CameraSourceResumeController {
  const cache = useQueryClient();
  const cameraId = camera?.id ?? '';
  const configVersion = camera?.configurationVersion;
  const scopeKey = JSON.stringify([setupKey, siteId, cameraId]);

  const [hostState, setHostState] = useState<{ scope: string; id: string | null }>({
    scope: scopeKey,
    id: null,
  });
  const [revokedScope, setRevokedScope] = useState<string | null>(null);
  const [sourceBusyState, setSourceBusyState] = useState<{ scope: string; busy: boolean }>({
    scope: scopeKey,
    busy: false,
  });
  const [capsRefreshState, setCapsRefreshState] = useState<{
    scope: string;
    status: 'idle' | 'refreshing' | 'failed';
  }>({ scope: scopeKey, status: 'idle' });

  const selectedHostId = hostState.scope === scopeKey ? hostState.id : null;
  const revoked = revokedScope === scopeKey;
  const sourceBusy = sourceBusyState.scope === scopeKey ? sourceBusyState.busy : false;
  const refreshingCaps = capsRefreshState.scope === scopeKey && capsRefreshState.status !== 'idle';

  const sourceBusyRef = useRef(false);
  const refreshingCapsRef = useRef(false);
  const capsRefreshSeqRef = useRef(0);
  const activeScopeRef = useRef(scopeKey);
  const resumeAbortRef = useRef<AbortController | null>(null);
  const resumeCommand = useRef<SourceConfigurationResumeCommand | undefined>(undefined);
  const resumeScope = useRef<{ scope: string; hostId: string; version: number | undefined }>({
    scope: scopeKey,
    hostId: '',
    version: configVersion,
  });
  const authFailureScopeRef = useRef<string | null>(null);

  const hosts = useQuery({
    queryKey: [...setupKey, 'camera-source-hosts', siteId, cameraId],
    retry: false,
    enabled: Boolean(enabled && siteId && cameraId && !revoked),
    queryFn: ({ signal }) => client.hosts(apiUrl, token, siteId, cameraId, signal),
  });

  const hostAccessDenied =
    hosts.error instanceof SourceSetupError && [401, 403].includes(hosts.error.status);

  useEffect(() => {
    if (hostAccessDenied && authFailureScopeRef.current !== scopeKey) {
      authFailureScopeRef.current = scopeKey;
      resumeAbortRef.current?.abort();
      onUnauthorized();
    }
  }, [hostAccessDenied, onUnauthorized, scopeKey]);

  const availableHosts = hosts.data?.filter((h) => h.available) ?? [];
  const hostId =
    selectedHostId !== null
      ? selectedHostId
      : availableHosts.length === 1
        ? availableHosts[0]!.id
        : '';
  const host = hosts.data?.find((h) => h.id === hostId);
  const caps = host?.capabilities;

  const resuming = useMutation({
    mutationFn: async () => {
      if (
        !enabled ||
        !client.resume ||
        !cameraId ||
        caps?.configurationResumeSupported !== true ||
        configVersion === undefined ||
        !canWrite ||
        revoked ||
        !hostId ||
        hosts.isError ||
        sourceBusyRef.current ||
        refreshingCapsRef.current
      ) {
        throw new SourceSetupError(409);
      }
      const command = resumeCommand.current ?? {
        commandId: crypto.randomUUID(),
        expectedRevision: caps.sourceRevision ?? 0,
        expectedConfigurationVersion: configVersion,
      };
      resumeCommand.current = command;
      const controller = new AbortController();
      resumeAbortRef.current = controller;
      return client.resume(apiUrl, token, siteId, cameraId, hostId, command, controller.signal);
    },
    retry: false,
    onSuccess: () => {
      if (activeScopeRef.current !== scopeKey) return;
      void hosts.refetch();
    },
    onError: (e) => {
      if (activeScopeRef.current !== scopeKey) return;
      if (e instanceof SourceSetupError && [401, 403].includes(e.status)) {
        setRevokedScope(scopeKey);
        onUnauthorized();
      }
    },
  });

  const { isPending: resumePending, reset: resetResume } = resuming;
  const { refetch: refetchHosts } = hosts;

  useEffect(() => {
    activeScopeRef.current = scopeKey;
    sourceBusyRef.current = sourceBusy;
    refreshingCapsRef.current = refreshingCaps;
  }, [scopeKey, sourceBusy, refreshingCaps]);

  useEffect(() => {
    return () => {
      resumeAbortRef.current?.abort();
    };
  }, [scopeKey]);

  useEffect(() => {
    if (resumePending && resumeScope.current.scope === scopeKey) return;
    if (
      resumeScope.current.scope !== scopeKey ||
      resumeScope.current.hostId !== hostId ||
      resumeScope.current.version !== configVersion
    ) {
      if (resumeScope.current.scope !== scopeKey) {
        resumeAbortRef.current?.abort();
      }
      resetResume();
      resumeCommand.current = undefined;
      resumeScope.current = { scope: scopeKey, hostId, version: configVersion };
    }
  }, [scopeKey, hostId, configVersion, resumePending, resetResume]);

  useEffect(() => {
    if (!resuming.isSuccess || !siteId || !cameraId) return;
    // Only application receipts: refetching a reference image could retire the view.
    const refresh = () =>
      void cache.invalidateQueries({
        predicate: (q) =>
          q.queryKey.includes('application-status') &&
          q.queryKey.includes(siteId) &&
          q.queryKey.includes(cameraId),
      });
    refresh();
    const timer = setInterval(refresh, 2000);
    const deadline = setTimeout(() => clearInterval(timer), 30000);
    return () => {
      clearInterval(timer);
      clearTimeout(deadline);
    };
  }, [resuming.isSuccess, cache, siteId, cameraId]);

  const selectHostId = useCallback(
    (nextHostId: string) => {
      setHostState({ scope: scopeKey, id: nextHostId });
    },
    [scopeKey],
  );

  const markRevoked = useCallback(() => {
    setRevokedScope(scopeKey);
  }, [scopeKey]);

  const setSourceBusy = useCallback(
    (busy: boolean) => {
      sourceBusyRef.current = busy;
      setSourceBusyState({ scope: scopeKey, busy });
    },
    [scopeKey],
  );

  const refreshHosts = useCallback(async () => {
    const seq = ++capsRefreshSeqRef.current;
    refreshingCapsRef.current = true;
    setCapsRefreshState({ scope: scopeKey, status: 'refreshing' });
    try {
      const next = await refetchHosts({ cancelRefetch: true });
      if (capsRefreshSeqRef.current !== seq || activeScopeRef.current !== scopeKey) return;
      if (next.isError) {
        refreshingCapsRef.current = true;
        setCapsRefreshState({ scope: scopeKey, status: 'failed' });
        return;
      }
      refreshingCapsRef.current = false;
      setCapsRefreshState({ scope: scopeKey, status: 'idle' });
    } catch {
      if (capsRefreshSeqRef.current !== seq || activeScopeRef.current !== scopeKey) return;
      refreshingCapsRef.current = true;
      setCapsRefreshState({ scope: scopeKey, status: 'failed' });
    }
  }, [scopeKey, refetchHosts]);

  const onSourceApplied = useCallback(() => {
    resumeAbortRef.current?.abort();
    resumeCommand.current = undefined;
    resetResume();
    resumeScope.current = { scope: scopeKey, hostId, version: configVersion };
    void refreshHosts();
  }, [scopeKey, hostId, configVersion, resetResume, refreshHosts]);

  const canResume = Boolean(
    enabled &&
    canWrite &&
    !revoked &&
    !hostAccessDenied &&
    !hosts.isError &&
    !sourceBusy &&
    !refreshingCaps &&
    !resuming.isPending &&
    !resuming.isSuccess &&
    client.resume &&
    host?.available &&
    caps?.configurationResumeSupported === true &&
    configVersion !== undefined,
  );

  const triggerResume = useCallback(() => {
    if (
      sourceBusyRef.current ||
      refreshingCapsRef.current ||
      hosts.isError ||
      resuming.isPending ||
      resuming.isSuccess
    ) {
      return;
    }
    resuming.mutate();
  }, [hosts.isError, resuming]);

  return {
    hosts,
    hostAccessDenied,
    availableHosts,
    hostId,
    host,
    caps,
    selectHostId,
    resuming,
    revoked,
    markRevoked,
    sourceBusy,
    setSourceBusy,
    refreshingCaps,
    refreshHosts,
    onSourceApplied,
    canResume,
    triggerResume,
  };
}
