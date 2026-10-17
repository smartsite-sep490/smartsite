import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient, useQuery, type QueryClient } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  ApiError,
  type Mf06AssessmentResponse,
} from '@smartsite/api-client';
import { PpeDialog } from './PpeDialog';
import {
  validateAssessmentBinding,
  areUuidsEqual,
  type AssessmentTargetContext,
} from './mf06AssessmentDetailBinding';
import { useTranslation } from 'react-i18next';
import { IconClock, IconCheck, IconX, IconAlertTriangle } from '../icons';
import {
  MF06_BINDING_REASON_KEYS,
  registerMf06BindingCatalog,
} from '../../i18n/mf06-binding-catalog';
import { useLocale, type Locale, type TranslationKey } from '../../i18n/ppe-locale';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';

export interface Mf06AssessmentDetailDialogProps {
  open: boolean;
  onClose: () => void;
  target: AssessmentTargetContext | null;
  token: string | null;
  siteId: string | null;
  credentialId: string;
  apiUrl?: string;
  client?: SmartSiteManagementClient;
  onUnauthorized?: () => void;
  onAccessError?: (
    error: ApiError,
    scope: { token: string | null; siteId: string | null; credentialId: string; apiUrl: string },
  ) => void;
}

interface HardErrorLatch {
  token: string | null;
  siteId: string | null;
  credentialId: string;
  queryClient: QueryClient;
  apiUrl: string;
  client: SmartSiteManagementClient;
  status: 401 | 403 | 404;
  assessmentId: string | null;
  error: ApiError;
}

const OUTCOME_CONFIG: Record<
  Mf06AssessmentResponse['outcome'],
  { labelKey: TranslationKey; badgeClass: string; icon: typeof IconCheck }
> = {
  ALLOWED: {
    labelKey: 'mf06.detail.outcome.ALLOWED',
    badgeClass:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
    icon: IconCheck,
  },
  DENIED: {
    labelKey: 'mf06.detail.outcome.DENIED',
    badgeClass:
      'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
    icon: IconX,
  },
  UNAVAILABLE: {
    labelKey: 'mf06.detail.outcome.UNAVAILABLE',
    badgeClass:
      'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
    icon: IconAlertTriangle,
  },
};

const REASON_CODE_KEYS: Record<Mf06AssessmentResponse['reasonCode'], TranslationKey> = {
  AUTHORIZED: 'mf06.detail.reason.AUTHORIZED',
  POLICY_NONE: 'mf06.detail.reason.POLICY_NONE',
  UNAUTHORIZED: 'mf06.detail.reason.UNAUTHORIZED',
  POLICY_PROHIBITED: 'mf06.detail.reason.POLICY_PROHIBITED',
  INVALID_BINDING: 'mf06.detail.reason.INVALID_BINDING',
  IDENTITY_UNAVAILABLE: 'mf06.detail.reason.IDENTITY_UNAVAILABLE',
  MEDIA_UNAVAILABLE: 'mf06.detail.reason.MEDIA_UNAVAILABLE',
  PROFILE_REVOKED: 'mf06.detail.reason.PROFILE_REVOKED',
  AUTHORITY_UNAVAILABLE: 'mf06.detail.reason.AUTHORITY_UNAVAILABLE',
  SERVICE_DISABLED: 'mf06.detail.reason.SERVICE_DISABLED',
  ABORTED: 'mf06.detail.reason.ABORTED',
};

const PURPOSE_KEYS: Record<Mf06AssessmentResponse['purpose'], TranslationKey> = {
  INITIAL_OBSERVATION_ASSESSMENT: 'mf06.detail.purpose.INITIAL_OBSERVATION_ASSESSMENT',
  RETROSPECTIVE_REVIEW: 'mf06.detail.purpose.RETROSPECTIVE_REVIEW',
};

function formatIsoDisplay(isoString: string, locale: Locale): string {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    return date.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return isoString;
  }
}

function getErrorMessage(error: unknown, t: (key: TranslationKey) => string): string {
  if (error instanceof ApiError && typeof error.status === 'number') {
    if (error.status === 401) {
      return t('mf06.detail.error.401');
    }
    if (error.status === 403) {
      return t('mf06.detail.error.403');
    }
    if (error.status === 404) {
      return t('mf06.detail.error.404');
    }
    if (error.status === 503) {
      return t('mf06.detail.error.503');
    }
  }
  return t('mf06.detail.error.default');
}

const tokenIdentities = new WeakMap<QueryClient, Map<string, number>>();
const clientIdentities = new WeakMap<SmartSiteManagementClient, number>();
let nextIdentity = 1;

function getOpaqueTokenNonce(queryClient: QueryClient, token: string | null): number | 'none' {
  if (!token) return 'none';
  let tokens = tokenIdentities.get(queryClient);
  if (!tokens) {
    tokens = new Map();
    tokenIdentities.set(queryClient, tokens);
  }
  let id = tokens.get(token);
  if (id === undefined) {
    id = nextIdentity++;
    tokens.set(token, id);
  }
  return id;
}

function getClientNonce(client: SmartSiteManagementClient): number {
  let id = clientIdentities.get(client);
  if (id === undefined) {
    id = nextIdentity++;
    clientIdentities.set(client, id);
  }
  return id;
}

export function Mf06AssessmentDetailDialog({
  open,
  onClose,
  target,
  token,
  siteId,
  credentialId,
  apiUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ||
    'http://localhost:3000',
  client: injectedClient,
  onUnauthorized,
  onAccessError,
}: Mf06AssessmentDetailDialogProps) {
  registerMf06BindingCatalog();
  const { locale, t } = useLocale();
  const { t: translateBindingReason } = useTranslation(SAFETY_NAMESPACE);
  const queryClient = useQueryClient();
  const managementClient = useMemo(
    () => injectedClient ?? new SmartSiteManagementClient(apiUrl),
    [injectedClient, apiUrl],
  );

  const tokenNonce = useMemo(() => getOpaqueTokenNonce(queryClient, token), [queryClient, token]);
  const clientNonce = useMemo(() => getClientNonce(managementClient), [managementClient]);

  interface OpenScopeSnapshot {
    token: string | null;
    siteId: string | null;
    credentialId: string;
    apiUrl: string;
    clientNonce: number;
    targetAssessmentId: string | null;
  }

  const [activeScope, setActiveScope] = useState<OpenScopeSnapshot | null>(() =>
    open
      ? {
          token,
          siteId,
          credentialId,
          apiUrl,
          clientNonce,
          targetAssessmentId: target?.assessmentId ?? null,
        }
      : null,
  );

  // When dialog is closed, reset active scope snapshot synchronously during render
  if (!open && activeScope !== null) {
    setActiveScope(null);
  } else if (open && activeScope === null) {
    // First render frame when opening: capture the initial scope of this open session
    setActiveScope({
      token,
      siteId,
      credentialId,
      apiUrl,
      clientNonce,
      targetAssessmentId: target?.assessmentId ?? null,
    });
  }

  // Same-render dismissal if parent scope changes while dialog is open
  const isScopeStale = Boolean(
    open &&
    activeScope !== null &&
    (activeScope.token !== token ||
      activeScope.siteId !== siteId ||
      activeScope.credentialId !== credentialId ||
      activeScope.apiUrl !== apiUrl ||
      activeScope.clientNonce !== clientNonce ||
      activeScope.targetAssessmentId !== (target?.assessmentId ?? null)),
  );

  const assessmentId = target?.assessmentId ?? null;
  const isEnabled = Boolean(open && !isScopeStale && token && siteId && assessmentId);

  // Exact mf06-assessments prefix ensures parent removeSessionQueries and credential rotation sweeps this cache
  const detailQueryKey = useMemo(
    () => [
      'mf06-assessments',
      apiUrl,
      clientNonce,
      siteId,
      credentialId,
      tokenNonce,
      'detail',
      assessmentId,
    ],
    [apiUrl, clientNonce, siteId, credentialId, tokenNonce, assessmentId],
  );

  const handleClose = useCallback(() => {
    void queryClient.cancelQueries({ queryKey: detailQueryKey, exact: true });
    onClose();
  }, [queryClient, detailQueryKey, onClose]);

  // Cancel query when closed or scope becomes stale
  useEffect(() => {
    if (!open || isScopeStale) {
      void queryClient.cancelQueries({ queryKey: detailQueryKey, exact: true });
      if (isScopeStale) {
        onClose();
      }
    }
  }, [open, isScopeStale, queryClient, detailQueryKey, onClose]);

  // Cancel query on unmount
  useEffect(() => {
    return () => {
      void queryClient.cancelQueries({ queryKey: detailQueryKey, exact: true });
    };
  }, [queryClient, detailQueryKey]);

  const [hardErrorLatch, setHardErrorLatch] = useState<HardErrorLatch | null>(null);

  const isLatchMatchingCurrentScope = Boolean(
    hardErrorLatch &&
    hardErrorLatch.token === token &&
    hardErrorLatch.siteId === siteId &&
    hardErrorLatch.credentialId === credentialId &&
    hardErrorLatch.queryClient === queryClient &&
    hardErrorLatch.apiUrl === apiUrl &&
    hardErrorLatch.client === managementClient &&
    (hardErrorLatch.status !== 404 || hardErrorLatch.assessmentId === assessmentId),
  );

  const activeHardError = isLatchMatchingCurrentScope ? hardErrorLatch : null;
  if (hardErrorLatch && !isLatchMatchingCurrentScope) {
    setHardErrorLatch(null);
  }

  const isQueryEnabled = isEnabled && !activeHardError;

  const { data, error, isLoading, isFetching, refetch } = useQuery<Mf06AssessmentResponse, Error>({
    queryKey: detailQueryKey,
    queryFn: async ({ signal }) => {
      if (!token || !siteId || !assessmentId) {
        throw new Error('Authentication token, site ID, and assessment ID required.');
      }
      if (activeHardError) {
        throw activeHardError.error;
      }
      return managementClient.getMf06Assessment(token, siteId, assessmentId, { signal });
    },
    enabled: isQueryEnabled,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const effectiveError = activeHardError ? activeHardError.error : error;
  const effectiveErrorStatus =
    effectiveError instanceof ApiError ? effectiveError.status : undefined;
  const isHardError =
    Boolean(activeHardError) ||
    effectiveErrorStatus === 401 ||
    effectiveErrorStatus === 403 ||
    effectiveErrorStatus === 404;

  if (
    error instanceof ApiError &&
    (error.status === 401 || error.status === 403 || error.status === 404) &&
    !isLatchMatchingCurrentScope
  ) {
    setHardErrorLatch({
      token,
      siteId,
      credentialId,
      queryClient,
      apiUrl,
      client: managementClient,
      status: error.status,
      assessmentId,
      error,
    });
  }

  // Clear query cache on 401/403/404 access failures to never leave authorized-looking rows in cache
  useEffect(() => {
    const errorToCheck = activeHardError?.error ?? error;
    const status = errorToCheck instanceof ApiError ? errorToCheck.status : undefined;
    if (status === 401 || status === 403 || status === 404) {
      void queryClient.cancelQueries({ queryKey: detailQueryKey, exact: true });
      queryClient.removeQueries({ queryKey: detailQueryKey, exact: true });
    }
  }, [error, activeHardError, queryClient, detailQueryKey]);

  // Access error effect: propagates to parent callback or invokes standalone onUnauthorized
  const notifiedAccessErrorRef = useRef<string | null>(null);
  useEffect(() => {
    const errorToCheck = activeHardError?.error ?? error;
    if (!(errorToCheck instanceof ApiError)) {
      notifiedAccessErrorRef.current = null;
      return;
    }

    const status = errorToCheck.status;
    if (status !== 401 && status !== 403) {
      notifiedAccessErrorRef.current = null;
      return;
    }

    // Late old-scope errors must not affect new scope
    if (
      !open ||
      isScopeStale ||
      !activeScope ||
      activeScope.token !== token ||
      activeScope.siteId !== siteId ||
      activeScope.credentialId !== credentialId ||
      activeScope.apiUrl !== apiUrl ||
      activeScope.clientNonce !== clientNonce
    ) {
      return;
    }

    const errorEventKey = `${apiUrl}:${clientNonce}:${siteId}:${credentialId}:${tokenNonce}:${status}:${target?.assessmentId}`;
    if (notifiedAccessErrorRef.current === errorEventKey) {
      return;
    }
    notifiedAccessErrorRef.current = errorEventKey;

    if (onAccessError) {
      onAccessError(errorToCheck, { token, siteId, credentialId, apiUrl });
    } else if (status === 401) {
      // Standalone mode: single onUnauthorized
      onUnauthorized?.();
    }
  }, [
    error,
    activeHardError,
    activeScope,
    open,
    isScopeStale,
    token,
    siteId,
    credentialId,
    apiUrl,
    clientNonce,
    tokenNonce,
    target,
    onAccessError,
    onUnauthorized,
  ]);

  // Validation against original target context
  const validationError = useMemo(() => {
    if (!data || !target || isHardError || isScopeStale) return null;
    return validateAssessmentBinding(data, target);
  }, [data, target, isHardError, isScopeStale]);

  // Strictly check that loaded data matches target context to prevent any stale record flash
  const isRecordMatchingTarget = Boolean(
    data &&
    target &&
    areUuidsEqual(data.assessmentId, target.assessmentId) &&
    areUuidsEqual(data.siteId, target.siteId) &&
    validationError === null,
  );

  // Same-render stale hide
  const record: Mf06AssessmentResponse | null = useMemo(() => {
    if (!open || isScopeStale || isHardError || effectiveError || !isRecordMatchingTarget) {
      return null;
    }
    return data ?? null;
  }, [open, isScopeStale, isHardError, effectiveError, isRecordMatchingTarget, data]);

  const handleManualRetry = useCallback(() => {
    if (isHardError || isFetching) return;
    void refetch();
  }, [isHardError, isFetching, refetch]);

  if (!open || !target || isScopeStale) {
    return null;
  }

  const outcomeMeta = record ? OUTCOME_CONFIG[record.outcome] : null;
  const reasonKey = record ? REASON_CODE_KEYS[record.reasonCode] : undefined;
  const reasonLabel = record ? (reasonKey ? t(reasonKey) : record.reasonCode) : null;
  const purposeKey = record ? PURPOSE_KEYS[record.purpose] : undefined;
  const purposeLabel = record ? (purposeKey ? t(purposeKey) : record.purpose) : null;
  const OutcomeIcon = outcomeMeta?.icon;

  return (
    <PpeDialog open={open} onClose={handleClose} title={t('mf06.detail.title')} wide>
      <div className="space-y-4 text-xs">
        {/* Technical Safety Observation Disclaimer */}
        <div className="rounded-xl border border-amber-200/90 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/25 px-4 py-3 space-y-1.5 text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2 font-semibold text-xs">
            <IconAlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>{t('mf06.detail.disclaimerTitle')}</span>
          </div>
          <p className="leading-relaxed text-[11px] text-amber-800 dark:text-amber-300">
            {t('mf06.detail.disclaimerBody')}
          </p>
        </div>

        {/* Loading State */}
        {isLoading && !effectiveError && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-center py-8 space-x-2 text-sm text-zinc-500 dark:text-zinc-400"
          >
            <IconClock className="w-5 h-5 animate-spin" />
            <span>{t('mf06.detail.loading')}</span>
          </div>
        )}

        {/* Access / Network Error State */}
        {effectiveError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 p-4 space-y-2.5 text-rose-700 dark:text-rose-300"
          >
            <div className="flex items-center gap-2 font-medium">
              <IconAlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{getErrorMessage(effectiveError, t)}</span>
            </div>
            {!isHardError && (
              <button
                type="button"
                onClick={handleManualRetry}
                disabled={isFetching}
                className="px-3 py-1.5 bg-rose-600 text-white rounded-md text-xs font-medium hover:bg-rose-700 transition cursor-pointer disabled:opacity-50"
              >
                {t('mf06.detail.retry')}
              </button>
            )}
          </div>
        )}

        {/* Validation Failure / Context Mismatch State */}
        {validationError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 p-4 space-y-1 text-rose-700 dark:text-rose-300"
          >
            <div className="flex items-center gap-2 font-medium">
              <IconAlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>
                {t('mf06.detail.validationMismatch', {
                  reason: translateBindingReason(MF06_BINDING_REASON_KEYS[validationError]),
                })}
              </span>
            </div>
          </div>
        )}

        {/* Successful Settled Assessment Record */}
        {record && outcomeMeta && OutcomeIcon && (
          <div className="space-y-4">
            {/* Outcome & Reason Code Badges */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/90 dark:border-zinc-700/80 rounded-xl">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${outcomeMeta.badgeClass}`}
                >
                  <OutcomeIcon className="w-3.5 h-3.5 shrink-0" />
                  {t(outcomeMeta.labelKey)}
                </span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-zinc-200/80 dark:bg-zinc-700/70 text-zinc-800 dark:text-zinc-200">
                  {reasonLabel}
                </span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                  {purposeLabel}
                </span>
              </div>
              <span className="text-[11px] font-mono tabular-nums px-2 py-0.5 rounded bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 border border-zinc-200/70 dark:border-zinc-700/70">
                v{record.evaluatorVersion}
              </span>
            </div>

            {/* Timestamps */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white dark:bg-zinc-800/60 rounded-xl p-3.5 border border-zinc-200/80 dark:border-zinc-700/60">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500 font-medium">
                  {t('mf06.detail.field.captured')}
                </span>{' '}
                <div className="font-mono tabular-nums text-[11px] text-zinc-800 dark:text-zinc-200 space-y-0.5">
                  <time dateTime={record.capturedAt} className="block">
                    {record.capturedAt}
                  </time>
                  <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
                    {formatIsoDisplay(record.capturedAt, locale)}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1 sm:border-l sm:border-zinc-100 sm:dark:border-zinc-700/60 sm:pl-3">
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500 font-medium">
                  {t('mf06.detail.field.assessed')}
                </span>{' '}
                <div className="font-mono tabular-nums text-[11px] text-zinc-800 dark:text-zinc-200 space-y-0.5">
                  <time dateTime={record.assessedAt} className="block">
                    {record.assessedAt}
                  </time>
                  <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
                    {formatIsoDisplay(record.assessedAt, locale)}
                  </div>
                </div>
              </div>
            </div>

            {/* Identifiers & Provenance (NO private fields/tokens/URIs) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-[11px] font-mono tabular-nums text-zinc-700 dark:text-zinc-300 bg-zinc-50/70 dark:bg-zinc-900/40 px-3.5 py-3 rounded-xl border border-zinc-200/70 dark:border-zinc-800">
              <div className="flex flex-col gap-0.5 break-all">
                <span className="font-sans text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                  {t('mf06.detail.field.assessmentId')}
                </span>{' '}
                <span>{record.assessmentId}</span>
              </div>
              <div className="flex flex-col gap-0.5 break-all">
                <span className="font-sans text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                  {t('mf06.detail.field.requestId')}
                </span>{' '}
                <span>{record.requestId}</span>
              </div>
              <div className="flex flex-col gap-0.5 break-all">
                <span className="font-sans text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                  {t('mf06.detail.field.eventId')}
                </span>{' '}
                <span>{record.eventId}</span>
              </div>
              <div className="flex flex-col gap-0.5 break-all">
                <span className="font-sans text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                  {t('mf06.detail.field.cameraId')}
                </span>{' '}
                <span>{record.cameraId}</span>
              </div>
              <div className="flex flex-col gap-0.5 break-all">
                <span className="font-sans text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                  {t('mf06.detail.field.zoneId')}
                </span>{' '}
                <span>{record.zoneId}</span>
              </div>
              <div className="flex flex-col gap-0.5 break-all">
                <span className="font-sans text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                  {t('mf06.detail.field.provenance')}
                </span>{' '}
                <span>{record.provenance}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </PpeDialog>
  );
}
