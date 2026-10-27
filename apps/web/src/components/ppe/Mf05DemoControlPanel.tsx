import React, { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient, ApiError, type Mf05DemoStatus } from '@smartsite/api-client';
import {
  IconCheck,
  IconAlertTriangle,
  IconCamera,
  IconShield,
  IconRadio,
  IconClock,
} from '../icons';
import { useLocale, type TranslationKey } from '../../i18n/ppe-locale';
import { downloadMf05EvidenceExport } from './mf05EvidenceExport';

export type { Mf05DemoStatus };

const identities = new WeakMap<QueryClient, Map<string, number>>();
const clientIds = new WeakMap<SmartSiteManagementClient, number>();
let nextIdentity = 1;

function opaqueCredential(client: QueryClient, token: string) {
  let tokens = identities.get(client);
  if (!tokens) {
    tokens = new Map();
    identities.set(client, tokens);
  }
  let id = tokens.get(token);
  if (id === undefined) {
    id = nextIdentity++;
    tokens.set(token, id);
  }
  return id;
}

function getMutationErrorMessage(
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
  status?: number,
): string {
  switch (status) {
    case 400:
      return t('mf05Demo.mutationError.400');
    case 401:
      return t('mf05Demo.mutationError.401');
    case 403:
      return t('mf05Demo.mutationError.403');
    case 409:
      return t('mf05Demo.mutationError.409');
    case 503:
      return t('mf05Demo.mutationError.503');
    default:
      return status
        ? t('mf05Demo.mutationError.httpStatus', { status })
        : t('mf05Demo.mutationError.default');
  }
}

export interface Mf05DemoControlPanelProps {
  apiUrl: string;
  token: string;
  sessionScope: string;
  credentialId?: number;
  siteId: string;
  cameraId: string;
  canApply: boolean;
  onApplyingChange?: (applying: boolean) => void;
}

export function Mf05DemoControlPanel({
  apiUrl,
  token,
  sessionScope,
  credentialId,
  siteId,
  cameraId,
  canApply,
  onApplyingChange,
}: Mf05DemoControlPanelProps) {
  const { t } = useLocale();
  // Gating condition: Explicit VITE_MF05_DEMO_CONTROLS === 'true' required.
  // Gating is evaluated after hooks to comply with React hook rules.
  const isEnabled = import.meta.env.VITE_MF05_DEMO_CONTROLS === 'true';

  const queryClient = useQueryClient();
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const authId = useMemo(() => opaqueCredential(queryClient, token), [queryClient, token]);
  const clientId = useMemo(() => {
    if (!clientIds.has(client)) clientIds.set(client, nextIdentity++);
    return clientIds.get(client)!;
  }, [client]);

  // Track active scope to isolate token rotation, session, site, and camera
  const currentScopeKey = `${apiUrl}:${sessionScope}:${credentialId ?? authId}:${authId}:${clientId}:${siteId}:${cameraId}`;
  const prevScopeKeyRef = useRef(currentScopeKey);
  const currentScopeRef = useRef(currentScopeKey);

  // Update currentScopeRef inside useLayoutEffect for async callback guards (not in render)
  useLayoutEffect(() => {
    currentScopeRef.current = currentScopeKey;
  }, [currentScopeKey]);

  // Derived scoped selection instead of effect setState
  const [userSelection, setUserSelection] = useState<{ scope: string; regionId: string } | null>(
    null,
  );

  // State for requested revision instead of reading refs during render
  const [requestedRevisionState, setRequestedRevisionState] = useState<{
    scope: string;
    revision: { regionId: string; expectedConfigurationVersion: number };
  } | null>(null);

  const activeApplyAbortControllerRef = useRef<AbortController | null>(null);

  // Abort in-flight apply on scope/token rotation
  useEffect(() => {
    if (prevScopeKeyRef.current !== currentScopeKey) {
      prevScopeKeyRef.current = currentScopeKey;
      activeApplyAbortControllerRef.current?.abort();
      activeApplyAbortControllerRef.current = null;
    }
  }, [currentScopeKey]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeApplyAbortControllerRef.current?.abort();
      activeApplyAbortControllerRef.current = null;
    };
  }, []);

  // Isolated query key including client, opaque session scope, credential identity, site, and camera
  const queryKey = useMemo(
    () => ['mf05-demo-status', apiUrl, clientId, sessionScope, authId, siteId, cameraId],
    [apiUrl, clientId, sessionScope, authId, siteId, cameraId],
  );

  const {
    data: status,
    error,
    isLoading,
  } = useQuery<Mf05DemoStatus, ApiError>({
    queryKey,
    queryFn: async ({ signal }) => {
      return await client.getMf05DemoStatus(token, siteId, cameraId, { signal });
    },
    refetchInterval: (query) => {
      if (!isEnabled) return false;
      const err = query.state.error;
      if (err instanceof ApiError) {
        // No retry or poll on 401, 403, or 404 (using ApiError.status only)
        if (err.status === 401 || err.status === 403 || err.status === 404) {
          return false;
        }
      }
      return 3000;
    },
    enabled: Boolean(isEnabled && apiUrl && token && siteId && cameraId),
    retry: false,
    gcTime: 0,
  });

  const apiError = error instanceof ApiError ? error : null;
  const errorStatus = apiError?.status;

  // Derived active region selection: use user choice for current scope, or fallback to status
  const defaultRegionId =
    status?.selectedRegionId ?? status?.loadedRegionId ?? status?.regions[0]?.id ?? '';

  const selectedRegionId =
    userSelection?.scope === currentScopeKey ? userSelection.regionId : defaultRegionId;

  // Apply mutation with stale response suppression
  const applyMutation = useMutation({
    mutationFn: async (input: { regionId: string; expectedConfigurationVersion: number }) => {
      const controller = new AbortController();
      activeApplyAbortControllerRef.current = controller;
      return await client.applyMf05DemoRegion(token, siteId, cameraId, input, {
        signal: controller.signal,
      });
    },
    onMutate: (input) => {
      setRequestedRevisionState({ scope: currentScopeKey, revision: input });
      return { scope: currentScopeKey, queryKey };
    },
    onSuccess: (updatedStatus, _input, context) => {
      activeApplyAbortControllerRef.current = null;
      // Suppress stale apply result if scope/camera changed while request was in-flight
      if (currentScopeRef.current !== context?.scope) {
        return;
      }
      // Immediately set query data with returned status to prevent stale READY from restoring old pixels
      queryClient.setQueryData(context.queryKey, updatedStatus);
    },
    onError: (_error, _input, context) => {
      activeApplyAbortControllerRef.current = null;
      if (currentScopeRef.current !== context?.scope) {
        return;
      }
      setRequestedRevisionState(null);
    },
  });

  const applyError = applyMutation.error;
  const applyApiError = applyError instanceof ApiError ? applyError : null;
  const applyStatus = applyApiError?.status;

  // Determine applying status using state (no refs accessed during render)
  const requestedRevision =
    requestedRevisionState?.scope === currentScopeKey ? requestedRevisionState.revision : null;

  const isWaitingForRequestedRevision =
    requestedRevision !== null &&
    (status?.loadedRegionId !== requestedRevision.regionId ||
      status?.loadedConfigurationVersion !== requestedRevision.expectedConfigurationVersion);

  const isApplying =
    applyMutation.isPending || status?.state === 'APPLYING' || isWaitingForRequestedRevision;

  // Notify parent component of applying transition
  useEffect(() => {
    if (isEnabled) {
      onApplyingChange?.(isApplying);
    }
  }, [isApplying, onApplyingChange, isEnabled]);

  // ── Render Guards (Evaluated after all hooks) ──

  if (!isEnabled) {
    return null;
  }

  // 404 indicates diagnostic controls unavailable for this camera -> hide
  if (errorStatus === 404) {
    return null;
  }

  // 401 / 403 access error -> display banner without logging out
  if (errorStatus === 401 || errorStatus === 403) {
    return (
      <div className="mb-4 rounded-md border border-amber-200 bg-[#FBF3DB] p-4 text-amber-900">
        <div className="flex items-center gap-2 font-medium">
          <IconAlertTriangle className="h-5 w-5 text-amber-700" />
          <span>{t('mf05Demo.accessErrorTitle', { status: errorStatus })}</span>
        </div>
        <p className="mt-1 text-sm text-amber-800">{t('mf05Demo.accessErrorDesc')}</p>
      </div>
    );
  }

  if (isLoading && !status) {
    return (
      <div className="rounded-md border border-[#EAEAEA] bg-white p-4 text-[#6B6B6B] text-sm">
        <div className="flex items-center gap-2">
          <IconClock className="h-4 w-4 animate-spin text-[#6B6B6B]" />
          <span>{t('mf05Demo.loading')}</span>
        </div>
      </div>
    );
  }

  // Suppress rendering if data belongs to a different site/camera scope
  if (!status || status.siteId !== siteId || status.cameraId !== cameraId) {
    return null;
  }

  // Exact applied state check: only true if state is READY and loaded region matches selected
  const isFullyApplied =
    status.state === 'READY' &&
    status.loadedRegionId !== null &&
    status.loadedRegionId === selectedRegionId &&
    status.loadedConfigurationVersion === status.configurationVersion;

  const handleApply = () => {
    if (!canApply || !selectedRegionId || isApplying) return;
    applyMutation.mutate({
      regionId: selectedRegionId,
      expectedConfigurationVersion: status.configurationVersion,
    });
  };

  // While isApplying, show 0 current candidates and suppress old evidence image (hide oldphase data)
  const visibleCandidates = isApplying ? [] : status.candidates;
  const summaryText = isApplying
    ? t('mf05Demo.candidatesSummaryApplying')
    : t('mf05Demo.candidatesSummaryCount', { count: visibleCandidates.length });

  const evidenceFrame = isApplying ? null : status.evidenceFrame;
  const hasEvidenceImage = Boolean(!isApplying && status.evidenceImageDataUrl);

  const isEvidenceIdentityAvailable = Boolean(
    hasEvidenceImage &&
    evidenceFrame &&
    typeof evidenceFrame.eventId === 'string' &&
    evidenceFrame.eventId.length > 0 &&
    typeof evidenceFrame.capturedAt === 'string' &&
    evidenceFrame.capturedAt.length > 0 &&
    evidenceFrame.frameDimensions &&
    typeof evidenceFrame.frameDimensions.width === 'number' &&
    evidenceFrame.frameDimensions.width > 0 &&
    typeof evidenceFrame.frameDimensions.height === 'number' &&
    evidenceFrame.frameDimensions.height > 0 &&
    Array.isArray(evidenceFrame.targets) &&
    evidenceFrame.targets.length > 0 &&
    evidenceFrame.targets.every((target) =>
      status.candidates.some(
        (c) =>
          c.eventId === evidenceFrame.eventId &&
          c.capturedAt === evidenceFrame.capturedAt &&
          c.trackId === target.trackId &&
          c.ppeItem === target.ppeItem &&
          c.regionId === target.regionId &&
          c.geometryVersion === target.geometryVersion,
      ),
    ),
  );

  return (
    <div className="mb-6 rounded-2xl border border-slate-200/80 bg-white p-6 text-slate-800 min-w-0 w-full max-w-full shadow-sm">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4 min-w-0 w-full max-w-full">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <IconShield className="h-5 w-5 text-slate-900 flex-shrink-0" />
            <h3 className="text-base font-semibold tracking-wide text-slate-900">
              {t('mf05Demo.heading')}
            </h3>
          </div>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] text-slate-600 flex-shrink-0">
            {t('mf05Demo.badgeLocalDiagnostic')}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Source kind badge */}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold flex-shrink-0 ${
              status.sourceKind === 'LIVE'
                ? 'bg-[#EDF3EC] text-[#346538] border border-[#C5DDC6]'
                : 'bg-[#FBF3DB] text-[#956400] border border-[#F3E5A6]'
            }`}
          >
            <IconRadio className="h-3.5 w-3.5" />
            {status.sourceKind}
          </span>

          {/* Operational state badge */}
          {status.state === 'APPLYING' || isApplying ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#FBF3DB] px-2.5 py-0.5 text-xs font-medium text-[#956400] border border-[#F3E5A6] flex-shrink-0">
              <IconClock className="h-3.5 w-3.5 animate-spin" />
              {t('mf05Demo.stateApplying')}
            </span>
          ) : isFullyApplied ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#EDF3EC] px-2.5 py-0.5 text-xs font-medium text-[#346538] border border-[#C5DDC6] flex-shrink-0">
              <IconCheck className="h-3.5 w-3.5" />
              {t('mf05Demo.stateActiveApplied')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#F8FAFC] px-2.5 py-0.5 text-xs font-medium text-slate-600 border border-slate-200/80 flex-shrink-0">
              {t('mf05Demo.statePendingApply')}
            </span>
          )}
        </div>
      </div>

      {/* ── Revisions & Metadata Grid (Visible near top) ── */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 min-w-0">
        <div className="rounded-xl border border-slate-200/70 bg-[#F8FAFC] p-3 min-w-0">
          <span className="block text-xs font-medium text-slate-500">
            {t('mf05Demo.savedConfigLabel')}
          </span>
          <span className="text-sm font-semibold text-slate-900 truncate block mt-0.5">
            {t('mf05Demo.savedRevValue', { version: status.configurationVersion })}
          </span>
        </div>
        <div className="rounded-xl border border-slate-200/70 bg-[#F8FAFC] p-3 min-w-0">
          <span className="block text-xs font-medium text-slate-500">
            {t('mf05Demo.loadedConfigLabel')}
          </span>
          <span className="text-sm font-semibold text-slate-900 truncate block mt-0.5">
            {t('mf05Demo.loadedRevValue', {
              version: status.loadedConfigurationVersion ?? t('mf05Demo.none'),
            })}
          </span>
        </div>
        <div className="rounded-xl border border-slate-200/70 bg-[#F8FAFC] p-3 min-w-0">
          <span className="block text-xs font-medium text-slate-500">
            {t('mf05Demo.loadedGeometryLabel')}
          </span>
          <span className="text-sm font-semibold text-slate-900 truncate block mt-0.5">
            {t('mf05Demo.loadedGeomValue', {
              version: status.loadedGeometryVersion ?? t('mf05Demo.none'),
            })}
          </span>
        </div>
        <div className="rounded-xl border border-slate-200/70 bg-[#F8FAFC] p-3 min-w-0">
          <span className="block text-xs font-medium text-slate-500">
            {t('mf05Demo.activeLoadedRegionLabel')}
          </span>
          <span className="truncate text-xs font-mono font-medium text-slate-900 block mt-0.5">
            {status.loadedRegionId ?? t('mf05Demo.none')}
          </span>
        </div>
      </div>

      {/* ── Region Selection & Apply Action (Visible near top) ── */}
      <div className="mt-5 rounded-2xl border border-slate-200/70 bg-[#F8FAFC] p-4 min-w-0 w-full max-w-full">
        <label
          htmlFor="mf05-region-select"
          className="block text-xs font-semibold uppercase tracking-wider text-slate-500"
        >
          {t('mf05Demo.activeSavedRegionLabel')}
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center min-w-0 w-full max-w-full">
          <select
            id="mf05-region-select"
            value={selectedRegionId}
            onChange={(e) => {
              setUserSelection({ scope: currentScopeKey, regionId: e.target.value });
            }}
            disabled={status.regions.length === 0 || isApplying}
            className="w-full sm:flex-1 min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs sm:text-sm text-slate-800 focus:border-slate-900 focus:ring-1 focus:ring-slate-900 focus:outline-none disabled:opacity-50 truncate"
          >
            {status.regions.length === 0 ? (
              <option value="">{t('mf05Demo.noSavedRegions')}</option>
            ) : (
              status.regions.map((reg) => (
                <option key={reg.id} value={reg.id}>
                  {reg.zoneCode} (v{reg.geometryVersion}) — [{reg.requiredPpe.join(', ')}]
                </option>
              ))
            )}
          </select>

          <button
            type="button"
            onClick={handleApply}
            disabled={!canApply || !selectedRegionId || isApplying || status.regions.length === 0}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs sm:text-sm font-semibold transition-colors flex-shrink-0 ${
              canApply && selectedRegionId && !isApplying && status.regions.length > 0
                ? 'bg-[#0F172A] text-white hover:bg-slate-800 active:bg-black cursor-pointer shadow-xs'
                : 'cursor-not-allowed bg-slate-100 text-slate-400'
            }`}
          >
            {isApplying ? (
              <>
                <IconClock className="h-4 w-4 animate-spin" />
                <span>{t('mf05Demo.stateApplying')}</span>
              </>
            ) : (
              <>
                <IconCheck className="h-4 w-4" />
                <span>{t('mf05Demo.applySavedRegionBtn')}</span>
              </>
            )}
          </button>
        </div>

        {!canApply && (
          <p className="mt-1.5 text-xs text-amber-800">{t('mf05Demo.adminPermissionRequired')}</p>
        )}

        {/* Mutation Error Alert with safe explanations (role="alert", no fake saved success) */}
        {applyMutation.isError && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-red-200 bg-[#FDEBEC] p-3 text-xs text-red-900 min-w-0"
          >
            <div className="flex items-center gap-2 font-medium text-red-800">
              <IconAlertTriangle className="h-4 w-4 text-red-700" />
              <span>{t('mf05Demo.failedToApplyTitle')}</span>
            </div>
            <p className="mt-1 text-red-800">{getMutationErrorMessage(t, applyStatus)}</p>
          </div>
        )}
      </div>

      {/* ── Collapsible Candidate & Evidence Section (<details> default collapsed) ── */}
      <details className="mt-5 border-t border-slate-200/80 pt-4 group min-w-0">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-800 hover:text-slate-900 select-none min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate">{summaryText}</span>
            {isApplying && (
              <span className="rounded-full bg-[#FBF3DB] px-2 py-0.5 text-[11px] font-medium text-[#956400] border border-[#F3E5A6] flex-shrink-0">
                {t('mf05Demo.applyingBadge')}
              </span>
            )}
          </div>
          <span className="text-xs text-slate-500 transition-transform group-open:rotate-180 flex-shrink-0 ml-2">
            ▼
          </span>
        </summary>

        <div className="mt-4 space-y-5 min-w-0">
          {/* Candidates subsection */}
          <div className="min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2 min-w-0 w-full">
              <h4 className="text-sm font-semibold text-slate-800 min-w-0 break-words">
                {t('mf05Demo.candidatesHeading')}
              </h4>
              <span className="text-xs text-slate-500 font-mono flex-shrink-0 self-start sm:self-auto">
                {t('mf05Demo.candidatesCount', { count: visibleCandidates.length })}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">{t('mf05Demo.candidatesDisclaimer')}</p>

            {visibleCandidates.length === 0 ? (
              <div className="mt-3 rounded-xl border border-slate-200/70 bg-[#F8FAFC] p-3 text-center text-xs text-slate-500">
                {t('mf05Demo.noConfirmedCandidate')}
              </div>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 min-w-0">
                {visibleCandidates.map((cand) => {
                  const compositeKey = `${cand.eventId}:${cand.trackId}:${cand.ppeItem}:${cand.regionId}:${cand.geometryVersion}`;
                  const candidateTestId = `candidate-${cand.eventId}-${cand.trackId}-${cand.ppeItem}-${cand.regionId}-${cand.geometryVersion}`;
                  return (
                    <div
                      key={compositeKey}
                      data-testid={candidateTestId}
                      className="rounded-xl border border-slate-200/70 bg-[#F8FAFC] p-3 text-xs min-w-0"
                    >
                      <div className="flex items-center justify-between text-slate-800 font-medium gap-2 min-w-0">
                        <span className="font-mono text-slate-900 font-semibold truncate break-all">
                          {cand.eventId}
                        </span>
                        <span className="rounded-lg bg-slate-200/60 px-2 py-0.5 text-xs font-semibold text-slate-700 flex-shrink-0">
                          {cand.ppeItem}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-2 gap-y-1 text-slate-500 text-[11px] min-w-0 w-full">
                        <div className="min-w-0 break-words break-all">
                          <span className="text-slate-500">{t('mf05Demo.fieldSubtype')}</span>{' '}
                          <span className="text-slate-800 break-words break-all">
                            {cand.candidateSubtype}
                          </span>
                        </div>
                        <div className="min-w-0 break-words break-all">
                          <span className="text-slate-500">{t('mf05Demo.fieldTrack')}</span>{' '}
                          <span className="text-slate-800 font-mono break-all">{cand.trackId}</span>
                        </div>
                        <div className="min-w-0 break-words break-all">
                          <span className="text-slate-500">{t('mf05Demo.fieldGeom')}</span>{' '}
                          <span className="text-slate-800 font-mono break-all">
                            v{cand.geometryVersion}
                          </span>
                        </div>
                        <div className="min-w-0 break-words break-all">
                          <span className="text-slate-500">{t('mf06.detail.field.captured')}</span>{' '}
                          <span className="text-slate-800 font-mono break-all">
                            {cand.capturedAt ? cand.capturedAt.slice(11, 19) : 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Latest Evidence Image subsection */}
          <div className="border-t border-slate-200/80 pt-4 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
              <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2 min-w-0">
                <IconCamera className="h-4 w-4 text-slate-500 flex-shrink-0" />
                <span className="truncate">{t('mf05Demo.latestEvidenceHeading')}</span>
              </h4>
              {!isApplying && isEvidenceIdentityAvailable && evidenceFrame && (
                <button
                  type="button"
                  onClick={() => downloadMf05EvidenceExport(status)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer flex-shrink-0 shadow-xs"
                >
                  {t('mf05Demo.downloadEvidenceBtn')}
                </button>
              )}
            </div>
            <div className="mt-2 min-w-0">
              {isApplying || !status.evidenceImageDataUrl ? (
                <div className="rounded-xl border border-slate-200/70 bg-[#F8FAFC] p-4 text-center text-xs text-slate-500">
                  {t('mf05Demo.noEvidenceImage')}
                </div>
              ) : !isEvidenceIdentityAvailable || !evidenceFrame ? (
                <div className="rounded-xl border border-amber-200 bg-[#FBF3DB] p-4 text-center text-xs text-amber-800">
                  {t('mf05Demo.evidenceIdentityUnavailable')}
                </div>
              ) : (
                <div className="space-y-3 min-w-0">
                  <div
                    className="relative mx-auto overflow-hidden rounded-xl border border-slate-800 bg-black"
                    style={{
                      maxWidth: '100%',
                      width: `${evidenceFrame.frameDimensions.width}px`,
                      aspectRatio: `${evidenceFrame.frameDimensions.width} / ${evidenceFrame.frameDimensions.height}`,
                    }}
                  >
                    <img
                      src={status.evidenceImageDataUrl}
                      alt={t('mf05Demo.latestEvidenceAlt')}
                      className="h-full w-full object-contain"
                    />
                    <svg
                      aria-label={t('mf05Demo.evidenceBoxOverlayAria')}
                      viewBox={`0 0 ${evidenceFrame.frameDimensions.width} ${evidenceFrame.frameDimensions.height}`}
                      className="absolute inset-0 h-full w-full pointer-events-none"
                    >
                      {evidenceFrame.targets.map((target, idx) => (
                        <React.Fragment
                          key={`${target.trackId}-${target.ppeItem}-${target.regionId}-${idx}`}
                        >
                          {target.personBox && (
                            <rect
                              data-testid={`evidence-box-person-${target.trackId}`}
                              x={target.personBox.x1 * evidenceFrame.frameDimensions.width}
                              y={target.personBox.y1 * evidenceFrame.frameDimensions.height}
                              width={
                                (target.personBox.x2 - target.personBox.x1) *
                                evidenceFrame.frameDimensions.width
                              }
                              height={
                                (target.personBox.y2 - target.personBox.y1) *
                                evidenceFrame.frameDimensions.height
                              }
                              fill="none"
                              stroke="#f59e0b"
                              strokeWidth="2"
                              strokeDasharray="4 2"
                            />
                          )}
                          {target.ppeBox && (
                            <rect
                              data-testid={`evidence-box-ppe-${target.trackId}`}
                              x={target.ppeBox.x1 * evidenceFrame.frameDimensions.width}
                              y={target.ppeBox.y1 * evidenceFrame.frameDimensions.height}
                              width={
                                (target.ppeBox.x2 - target.ppeBox.x1) *
                                evidenceFrame.frameDimensions.width
                              }
                              height={
                                (target.ppeBox.y2 - target.ppeBox.y1) *
                                evidenceFrame.frameDimensions.height
                              }
                              fill="none"
                              stroke="#10b981"
                              strokeWidth="2"
                            />
                          )}
                        </React.Fragment>
                      ))}
                    </svg>
                  </div>

                  {/* Technical target metadata */}
                  <div
                    data-testid="evidence-target-metadata"
                    className="space-y-2 rounded-xl border border-slate-200/70 bg-[#F8FAFC] p-3 text-xs min-w-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-2 text-[11px] text-slate-500 min-w-0">
                      <div className="min-w-0">
                        <span className="text-slate-500">{t('mf05Demo.fieldEvent')}</span>{' '}
                        <span className="font-mono text-slate-900 font-semibold break-all">
                          {evidenceFrame.eventId}
                        </span>
                      </div>
                      <div className="flex-shrink-0">
                        <span className="text-slate-500">{t('mf06.detail.field.captured')}</span>{' '}
                        <span className="font-mono text-slate-900">
                          {evidenceFrame.capturedAt
                            ? evidenceFrame.capturedAt.slice(11, 19)
                            : 'N/A'}
                        </span>
                      </div>
                      <div className="flex-shrink-0">
                        <span className="text-slate-500">{t('mf05Demo.fieldDimensions')}</span>{' '}
                        <span className="font-mono text-slate-900">
                          {evidenceFrame.frameDimensions.width} ×{' '}
                          {evidenceFrame.frameDimensions.height}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-1 min-w-0">
                      {evidenceFrame.targets.map((target, idx) => (
                        <div
                          key={`${target.trackId}-${target.ppeItem}-${idx}`}
                          data-testid={`evidence-target-${target.trackId}-${target.ppeItem}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white border border-slate-200/80 px-2.5 py-1.5 text-slate-800 min-w-0 shadow-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-semibold text-slate-900 font-mono flex-shrink-0">
                              {t('mf05Demo.targetTrack', { id: target.trackId })}
                            </span>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 flex-shrink-0">
                              {target.ppeItem}
                            </span>
                          </div>
                          <div className="font-mono text-[11px] text-slate-500 break-all">
                            {t('mf05Demo.targetRegionVersion', {
                              regionId: target.regionId,
                              version: target.geometryVersion,
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
