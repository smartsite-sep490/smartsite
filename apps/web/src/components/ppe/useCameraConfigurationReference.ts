import {
  ApiError,
  CONFIGURATION_REFERENCE_LIFETIME_MS,
  SmartSiteManagementClient,
  type CameraConfigurationImageResponse,
} from '@smartsite/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  executeConfigurationReferenceFetch,
  getEffectiveExpiryMs,
  isAbortError,
  releaseImageElement,
  resolveConfigurationReferenceScope,
  toSafeApiError,
  type ConfigurationReferenceScopeInput,
} from './cameraConfigurationReferenceHelpers';

export type UseCameraConfigurationReferenceOptions = ConfigurationReferenceScopeInput & {
  client?: SmartSiteManagementClient;
};

export type CameraConfigurationReference = CameraConfigurationImageResponse & {
  image: HTMLImageElement;
};

export interface UseCameraConfigurationReferenceResult {
  reference: CameraConfigurationReference | null;
  isLoading: boolean;
  error: ApiError | null;
  request: () => Promise<void>;
}

interface ScopedDecodedReference {
  scopeKey: string;
  reference: CameraConfigurationReference;
  expiresAtMs: number;
}

interface InFlightReferenceRequest {
  scopeKey: string;
  controller: AbortController;
  promise: Promise<void>;
}

export function useCameraConfigurationReference(
  options: UseCameraConfigurationReferenceOptions,
): UseCameraConfigurationReferenceResult {
  const { apiUrl, token, sessionScope, credentialId, siteId, cameraId, cameraExternalId, enabled } =
    options;
  const queryClient = useQueryClient();
  const normalizedApiUrl = apiUrl.trim().replace(/\/+$/, '');
  const managementClient = useMemo(
    () => options.client ?? new SmartSiteManagementClient(normalizedApiUrl),
    [normalizedApiUrl, options.client],
  );
  // A replacement client owns a different credential lifetime, even if the
  // caller reuses its token/scope fields. Never share its reference cache.
  const scopeOwner = useMemo<object>(() => ({ managementClient }), [managementClient]);

  const scope = useMemo(
    () =>
      resolveConfigurationReferenceScope(scopeOwner, {
        apiUrl,
        token,
        sessionScope,
        credentialId,
        siteId,
        cameraId,
        cameraExternalId,
        enabled,
      }),
    [
      apiUrl,
      cameraExternalId,
      cameraId,
      credentialId,
      enabled,
      scopeOwner,
      sessionScope,
      siteId,
      token,
    ],
  );

  const {
    trimmedToken,
    normalizedSiteId,
    normalizedCameraId,
    trimmedExternalId,
    isScopeReady,
    activeScopeKey,
  } = scope;
  const queryKey = useMemo(
    () => JSON.parse(activeScopeKey) as readonly (string | number)[],
    [activeScopeKey],
  );

  const [decodedState, setDecodedState] = useState<ScopedDecodedReference | null>(null);
  const [errorState, setErrorState] = useState<ApiError | null>(null);
  const [isLoadingState, setIsLoadingState] = useState(false);

  const decodedRef = useRef<ScopedDecodedReference | null>(null);
  const inFlightRef = useRef<InFlightReferenceRequest | null>(null);
  const generationRef = useRef(0);
  const activeScopeKeyRef = useRef(activeScopeKey);
  const isScopeReadyRef = useRef(isScopeReady);

  const releaseDecodedRef = useCallback(() => {
    if (decodedRef.current) {
      releaseImageElement(decodedRef.current.reference.image);
      decodedRef.current = null;
    }
  }, []);

  const clearRefsAndAbort = useCallback(() => {
    generationRef.current += 1;
    if (inFlightRef.current) {
      inFlightRef.current.controller.abort();
      inFlightRef.current = null;
    }
    releaseDecodedRef();
  }, [releaseDecodedRef]);

  const stateResetKey = `${activeScopeKey}|${isScopeReady ? '1' : '0'}`;
  const [trackedResetKey, setTrackedResetKey] = useState(stateResetKey);
  if (trackedResetKey !== stateResetKey) {
    setTrackedResetKey(stateResetKey);
    setDecodedState(null);
    setErrorState(null);
    setIsLoadingState(false);
  }

  const query = useQuery<CameraConfigurationImageResponse | null, ApiError>({
    queryKey,
    queryFn: async () => null,
    enabled: false,
    retry: false,
    staleTime: 0,
    gcTime: CONFIGURATION_REFERENCE_LIFETIME_MS,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  useLayoutEffect(() => {
    activeScopeKeyRef.current = activeScopeKey;
    isScopeReadyRef.current = isScopeReady;
    const currentKey = queryKey;

    if (!isScopeReady) {
      clearRefsAndAbort();
      queryClient.setQueryData(currentKey, null);
    }

    return () => {
      clearRefsAndAbort();
      void queryClient.cancelQueries({ queryKey: currentKey, exact: true });
      queryClient.setQueryData(currentKey, null);
    };
  }, [activeScopeKey, clearRefsAndAbort, isScopeReady, queryClient, queryKey]);

  // Recheck before paint on every commit, including after a suspended browser timer.
  useLayoutEffect(() => {
    if (!decodedState || decodedState.scopeKey !== activeScopeKey || !isScopeReady) return;
    const expire = () => {
      if (decodedRef.current?.reference === decodedState.reference) {
        releaseDecodedRef();
      }
      setDecodedState(null);
      queryClient.setQueryData(queryKey, null);
    };
    const remainingMs = decodedState.expiresAtMs - Date.now();
    if (remainingMs <= 0) return expire();
    const timer = setTimeout(expire, remainingMs);

    return () => clearTimeout(timer);
  });

  const request = useCallback((): Promise<void> => {
    if (!isScopeReady) {
      if (enabled) {
        setErrorState(toSafeApiError(null));
      }
      return Promise.resolve();
    }

    const existing = inFlightRef.current;
    if (existing && existing.scopeKey === activeScopeKey && !existing.controller.signal.aborted) {
      return existing.promise;
    }

    const requestScopeKey = activeScopeKey;
    const requestQueryKey = queryKey;
    const requestGeneration = ++generationRef.current;
    const controller = new AbortController();
    const isSuperseded = () =>
      !isScopeReadyRef.current ||
      activeScopeKeyRef.current !== requestScopeKey ||
      generationRef.current !== requestGeneration;
    const isStale = () => controller.signal.aborted || isSuperseded();

    setIsLoadingState(true);
    setErrorState(null);

    const workPromise = (async () => {
      let decodedImage: HTMLImageElement | null = null;
      try {
        const verifiedResponse = await queryClient.fetchQuery({
          queryKey: requestQueryKey,
          staleTime: 0,
          retry: false,
          queryFn: ({ signal }) =>
            executeConfigurationReferenceFetch({
              client: managementClient,
              token: trimmedToken,
              siteId: siteId.trim(),
              cameraId: cameraId.trim(),
              normalizedSiteId,
              normalizedCameraId,
              trimmedExternalId,
              controller,
              querySignal: signal,
              isStale,
              onDecodedImage: (image) => {
                decodedImage = image;
              },
            }),
        });

        if (isStale() || !decodedImage) {
          releaseImageElement(decodedImage);
          queryClient.setQueryData(requestQueryKey, null);
          return;
        }

        releaseDecodedRef();
        const nextDecoded: ScopedDecodedReference = {
          scopeKey: requestScopeKey,
          reference: { ...verifiedResponse, image: decodedImage },
          expiresAtMs: getEffectiveExpiryMs(verifiedResponse),
        };
        decodedRef.current = nextDecoded;
        setDecodedState(nextDecoded);
        setErrorState(null);
      } catch (err) {
        releaseImageElement(decodedImage);
        queryClient.setQueryData(requestQueryKey, null);
        if (isAbortError(err) || isStale()) return;

        releaseDecodedRef();
        setDecodedState(null);
        setErrorState(toSafeApiError(err));
      } finally {
        if (inFlightRef.current?.controller === controller) inFlightRef.current = null;
        if (!isSuperseded()) setIsLoadingState(false);
      }
    })();

    const runPromise = new Promise<void>((resolve) => {
      const onAbort = () => resolve();
      if (controller.signal.aborted) {
        resolve();
        return;
      }
      controller.signal.addEventListener('abort', onAbort, { once: true });
      void workPromise.finally(() => {
        controller.signal.removeEventListener('abort', onAbort);
        resolve();
      });
    });

    inFlightRef.current = { scopeKey: requestScopeKey, controller, promise: runPromise };
    return runPromise;
  }, [
    activeScopeKey,
    cameraId,
    enabled,
    isScopeReady,
    managementClient,
    normalizedCameraId,
    normalizedSiteId,
    queryClient,
    queryKey,
    releaseDecodedRef,
    siteId,
    trimmedExternalId,
    trimmedToken,
  ]);

  const isCurrentValid =
    isScopeReady &&
    query.data != null &&
    decodedState !== null &&
    decodedState.scopeKey === activeScopeKey &&
    errorState === null;

  return {
    reference: isCurrentValid ? decodedState.reference : null,
    isLoading: isScopeReady ? isLoadingState : false,
    error: isScopeReady ? errorState : null,
    request,
  };
}
