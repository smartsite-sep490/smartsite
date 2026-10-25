import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  SmartSiteManagementClient,
  type Mf06AssessmentResponse,
} from '@smartsite/api-client';
import { IconAlertTriangle, IconClock } from '../icons';
import { useLocale } from '../../i18n/locale';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import {
  registerMf06EvidenceCatalog,
  type Mf06EvidenceTranslationKey,
} from '../../i18n/mf06-evidence-catalog';

export interface Mf06AssessmentFrameProps {
  client: SmartSiteManagementClient;
  assessment: Mf06AssessmentResponse;
  token: string;
  credentialId: string;
  onError?: (error: ApiError) => void;
}

type FrameScope = readonly [
  SmartSiteManagementClient,
  string,
  string,
  string,
  string,
  string,
  string,
];

interface ScopedFrameState {
  scope: FrameScope;
  status: 'loaded' | 'error';
  objectUrl: string | null;
  error: ApiError | null;
  revoke: () => void;
}

const sameScope = (a: FrameScope, b: FrameScope) => a.every((v, i) => v === b[i]);
const noop = () => {};

function resolveErrorKey(error: ApiError | null): Mf06EvidenceTranslationKey {
  if (error?.status === 401) return 'mf06.evidence.sessionExpired';
  if (error?.status === 403) return 'mf06.evidence.denied';
  if (error?.status === 404) return 'mf06.evidence.notFound';
  return 'mf06.evidence.unavailable';
}

export function Mf06AssessmentFrame({
  client,
  assessment,
  token,
  credentialId,
  onError,
}: Mf06AssessmentFrameProps) {
  registerMf06EvidenceCatalog();
  const { locale } = useLocale();
  const { t } = useTranslation(SAFETY_NAMESPACE);

  const { siteId, assessmentId, requestId, eventId, capturedAt } = assessment;
  const currentScope: FrameScope = [
    client,
    token,
    credentialId,
    siteId,
    assessmentId,
    requestId,
    eventId,
  ];

  const [state, setState] = useState<ScopedFrameState | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const latestScopeRef = useRef<FrameScope>(currentScope);
  const onErrorRef = useRef(onError);
  const notifiedAccessRef = useRef<{ scope: FrameScope; status: number } | null>(null);

  useLayoutEffect(() => {
    latestScopeRef.current = currentScope;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    const effectScope: FrameScope = [
      client,
      token,
      credentialId,
      siteId,
      assessmentId,
      requestId,
      eventId,
    ];
    let active = true;
    let allocatedUrl: string | null = null;
    const controller = new AbortController();
    const revokeUrl = () => {
      if (!allocatedUrl) return;
      const targetUrl = allocatedUrl;
      allocatedUrl = null;
      try {
        URL.revokeObjectURL(targetUrl);
      } catch {
        // Ignore revocation errors.
      }
    };

    void Promise.resolve()
      .then(() => {
        if (
          [token, credentialId, siteId, assessmentId, requestId, eventId].some((v) => !v.trim())
        ) {
          throw new ApiError('invalid-response', 'Invalid frame scope.');
        }
        return client.getMf06AssessmentFrame(token, siteId, assessmentId, requestId, eventId, {
          signal: controller.signal,
        });
      })
      .then((blob) => {
        if (!active || controller.signal.aborted) return;
        try {
          allocatedUrl = URL.createObjectURL(blob);
        } catch {
          allocatedUrl = null;
        }
        if (!allocatedUrl) {
          setState({
            scope: effectScope,
            status: 'error',
            objectUrl: null,
            error: new ApiError('invalid-response', 'Unable to allocate frame URL.'),
            revoke: noop,
          });
          return;
        }
        if (!active || controller.signal.aborted) {
          revokeUrl();
          return;
        }
        setState({
          scope: effectScope,
          status: 'loaded',
          objectUrl: allocatedUrl,
          error: null,
          revoke: revokeUrl,
        });
      })
      .catch((err: unknown) => {
        revokeUrl();
        if (!active || controller.signal.aborted) return;
        const apiError =
          err instanceof ApiError ? err : new ApiError('network', 'Failed to load frame.');
        setState({
          scope: effectScope,
          status: 'error',
          objectUrl: null,
          error: apiError,
          revoke: noop,
        });
        if (apiError.status === 401 || apiError.status === 403) {
          const prev = notifiedAccessRef.current;
          if (!prev || !sameScope(prev.scope, effectScope) || prev.status !== apiError.status) {
            notifiedAccessRef.current = { scope: effectScope, status: apiError.status };
            onErrorRef.current?.(apiError);
          }
        }
      });

    return () => {
      active = false;
      controller.abort();
      revokeUrl();
    };
  }, [client, token, credentialId, siteId, assessmentId, requestId, eventId, retryNonce]);

  const activeState = state && sameScope(state.scope, currentScope) ? state : null;
  const errorStatus = activeState?.error?.status;
  const isNotFound = activeState?.status === 'error' && errorStatus === 404;
  const isAccessDenied = errorStatus === 401 || errorStatus === 403;

  return (
    <figure className="rounded-xl border border-zinc-200/80 bg-white p-3.5 space-y-2.5 text-xs">
      <div className="space-y-0.5">
        <div className="text-[11px] font-semibold text-zinc-800">{t('mf06.evidence.title', { lng: locale })}</div>
        <figcaption className="text-[11px] leading-relaxed text-zinc-500">
          {t('mf06.evidence.caption', { lng: locale })}
        </figcaption>
      </div>
      {!activeState && (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="flex items-center justify-center gap-2 py-6 text-xs text-zinc-500"
        >
          <IconClock className="w-4 h-4 animate-spin shrink-0" />
          <span>{t('mf06.evidence.loading', { lng: locale })}</span>
        </div>
      )}
      {isNotFound && (
        <div
          role="status"
          className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs text-zinc-500"
        >
          {t('mf06.evidence.notFound', { lng: locale })}
        </div>
      )}
      {activeState?.status === 'error' && !isNotFound && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"
        >
          <div className="flex items-center gap-2 font-medium">
            <IconAlertTriangle className="w-4 h-4 shrink-0" />
            <span>{t(resolveErrorKey(activeState.error), { lng: locale })}</span>
          </div>
          {!isAccessDenied && (
            <button
              type="button"
              onClick={() => {
                setState(null);
                setRetryNonce((n) => n + 1);
              }}
              className="px-2.5 py-1 bg-rose-600 text-white rounded-md text-xs font-medium hover:bg-rose-700 transition cursor-pointer"
            >
              {t('mf06.evidence.retry', { lng: locale })}
            </button>
          )}
        </div>
      )}
      {activeState?.status === 'loaded' && activeState.objectUrl && (
        <div className="flex items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
          <img
            src={activeState.objectUrl}
            alt={t('mf06.evidence.alt', { capturedAt, lng: locale })}
            onError={() => {
              activeState.revoke();
              if (!sameScope(latestScopeRef.current, activeState.scope)) return;
              setState((prev) =>
                prev &&
                prev.objectUrl === activeState.objectUrl &&
                sameScope(prev.scope, activeState.scope)
                  ? {
                      scope: activeState.scope,
                      status: 'error',
                      objectUrl: null,
                      error: new ApiError('invalid-response', 'Unreadable observation frame.'),
                      revoke: noop,
                    }
                  : prev,
              );
            }}
            className="max-h-72 w-auto object-contain"
          />
        </div>
      )}
    </figure>
  );
}
