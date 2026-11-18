import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import { IconAlertTriangle, IconCheck, IconClock, IconRefresh, IconShield } from '../icons';
import { Alert, AlertDescription, Badge, Button, Card } from '../ui';
import {
  DETAIL_FIELD_CLASS,
  formatIdentificationDateTime,
} from './safetyIdentificationDetailShared';
import { isHardDenial, type IdentificationQueryPrefix } from './IdentificationWorkspaceScope';
import {
  RETROSPECTIVE_LABELS,
  RETROSPECTIVE_PAGE_SIZE,
  RETROSPECTIVE_POLL_INTERVAL_MS,
  isActiveRetrospectiveStatus,
  resolveRetrospectiveVerdict,
  retrospectiveBadgeVariant,
  retrospectiveStateHint,
  safeRetrospectivePlaceLabel,
} from './SafetyIdentificationRetrospectiveCopy';

function subscribeDocumentVisibility(onStoreChange: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  document.addEventListener('visibilitychange', onStoreChange);
  return () => document.removeEventListener('visibilitychange', onStoreChange);
}

function readDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export interface SafetyIdentificationRetrospectiveHistoryProps {
  client: SmartSiteManagementClient;
  accessToken: string;
  scopeKey: string;
  queryPrefix: IdentificationQueryPrefix;
  runGuardedQuery: <T>(work: () => Promise<T>) => Promise<T>;
  siteId: string;
  caseId: string;
  episodeId: string;
  caseVersion: number;
  vietnamese: boolean;
}

export function SafetyIdentificationRetrospectiveHistory({
  client,
  accessToken,
  scopeKey,
  queryPrefix,
  runGuardedQuery,
  siteId,
  caseId,
  episodeId,
  caseVersion,
  vietnamese,
}: SafetyIdentificationRetrospectiveHistoryProps) {
  const copy = vietnamese ? RETROSPECTIVE_LABELS.vi : RETROSPECTIVE_LABELS.en;
  const panelId = useId();
  const selectId = useId();
  const isVisible = useSyncExternalStore(
    subscribeDocumentVisibility,
    readDocumentVisible,
    () => true,
  );
  const scopeIdentity = `${scopeKey}:${siteId.trim().toLowerCase()}:${caseId.trim().toLowerCase()}:${caseVersion}`;

  const [trackedScopeIdentity, setTrackedScopeIdentity] = useState(scopeIdentity);
  const [expanded, setExpanded] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selection, setSelection] = useState<{
    initialRequestId: string;
    commandId: string;
  } | null>(null);
  const [showQueuedBanner, setShowQueuedBanner] = useState(false);
  const [latchedDeniedScope, setLatchedDeniedScope] = useState<string | null>(null);

  const submittingRef = useRef(false);
  const mountedScopeRef = useRef(scopeIdentity);
  const wasVisibleRef = useRef(isVisible);

  if (trackedScopeIdentity !== scopeIdentity) {
    setTrackedScopeIdentity(scopeIdentity);
    setExpanded(false);
    setOffset(0);
    setSelection(null);
    setShowQueuedBanner(false);
    setLatchedDeniedScope(null);
  }

  const queryClient = useQueryClient();
  const historyKey = useMemo(
    () => [...queryPrefix, 'site', siteId, 'zone-reassessments', scopeKey, caseId] as const,
    [caseId, queryPrefix, scopeKey, siteId],
  );
  const optionsKey = useMemo(
    () =>
      [
        ...queryPrefix,
        'site',
        siteId,
        'zone-reassessment-options',
        scopeKey,
        caseId,
        caseVersion,
      ] as const,
    [caseId, caseVersion, queryPrefix, scopeKey, siteId],
  );

  const isScopeLatchedDenied = latchedDeniedScope === scopeIdentity;

  const query = useQuery({
    queryKey: [...historyKey, offset],
    queryFn: ({ signal }) =>
      runGuardedQuery(() =>
        client.listSafetyIdentificationRetrospectiveAssessments(
          accessToken,
          siteId,
          caseId,
          { offset, limit: RETROSPECTIVE_PAGE_SIZE },
          { signal },
        ),
      ),
    enabled: expanded && !isScopeLatchedDenied,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
    refetchInterval: (currentQuery) => {
      if (!expanded || isScopeLatchedDenied || !isVisible) return false;
      if (currentQuery.state.status === 'error') return false;
      const items = currentQuery.state.data?.items;
      if (!Array.isArray(items)) return false;
      return items.some((item) => isActiveRetrospectiveStatus(item.status))
        ? RETROSPECTIVE_POLL_INTERVAL_MS
        : false;
    },
  });

  const options = useQuery({
    queryKey: optionsKey,
    queryFn: ({ signal }) =>
      runGuardedQuery(() =>
        client.listSafetyIdentificationRetrospectiveOptions(accessToken, siteId, caseId, {
          signal,
        }),
      ),
    enabled: expanded && !isScopeLatchedDenied,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const submit = useMutation({
    mutationFn: async (entry: NonNullable<typeof selection>) => {
      const capturedScope = scopeIdentity;
      try {
        await runGuardedQuery(() =>
          client.requestSafetyIdentificationRetrospectiveAssessment(accessToken, siteId, caseId, {
            ...entry,
            episodeId,
            identificationVersion: caseVersion,
          }),
        );
        return { capturedScope };
      } finally {
        submittingRef.current = false;
      }
    },
    onSuccess: async ({ capturedScope }) => {
      if (mountedScopeRef.current !== capturedScope) return;
      setSelection(null);
      setOffset(0);
      setShowQueuedBanner(true);
      await Promise.all([
        options.refetch(),
        queryClient.invalidateQueries({ queryKey: historyKey }),
      ]);
    },
    onError: () => {
      if (mountedScopeRef.current !== scopeIdentity) return;
      setShowQueuedBanner(false);
    },
  });

  const hasFreshHardDenial =
    isHardDenial(query.error) || isHardDenial(options.error) || isHardDenial(submit.error);

  if (hasFreshHardDenial && !isScopeLatchedDenied) {
    setLatchedDeniedScope(scopeIdentity);
    setSelection(null);
    setShowQueuedBanner(false);
  }

  const denied = isScopeLatchedDenied || hasFreshHardDenial;

  useEffect(() => {
    mountedScopeRef.current = scopeIdentity;
    submittingRef.current = false;
    return () => {
      mountedScopeRef.current = '';
      submittingRef.current = false;
    };
  }, [scopeIdentity]);

  useEffect(() => {
    if (!denied) return;
    submittingRef.current = false;
    void queryClient.cancelQueries({ queryKey: historyKey });
    queryClient.removeQueries({ queryKey: historyKey });
    void queryClient.cancelQueries({ queryKey: optionsKey });
    queryClient.removeQueries({ queryKey: optionsKey });
  }, [denied, historyKey, optionsKey, queryClient]);

  const page = query.isError || denied ? undefined : query.data;
  const hasActiveJobs = Boolean(
    page?.items.some((item) => isActiveRetrospectiveStatus(item.status)),
  );
  const refetchHistory = query.refetch;

  useEffect(() => {
    const becameVisible = !wasVisibleRef.current && isVisible;
    wasVisibleRef.current = isVisible;
    if (becameVisible && expanded && !denied && hasActiveJobs) {
      void refetchHistory();
    }
  }, [denied, expanded, hasActiveJobs, isVisible, refetchHistory]);

  const candidates =
    !denied &&
    !options.isError &&
    options.data?.episodeId === episodeId &&
    options.data.identificationVersion === caseVersion
      ? options.data.items
      : [];
  const selected = candidates.find((item) => item.initialRequestId === selection?.initialRequestId);

  const displayQueuedBanner =
    showQueuedBanner &&
    !denied &&
    !submit.isError &&
    (!page || page.items.length === 0 || hasActiveJobs);

  function handleRefresh() {
    if (denied) {
      submit.reset();
      queryClient.removeQueries({ queryKey: historyKey });
      queryClient.removeQueries({ queryKey: optionsKey });
      setLatchedDeniedScope(null);
      return;
    }
    void query.refetch();
    void options.refetch();
  }

  return (
    <div className="min-w-0 space-y-2.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        leftIcon={<IconShield className="w-3.5 h-3.5 text-slate-600" />}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        onClick={() => setExpanded((open) => !open)}
      >
        {expanded ? copy.hide : copy.show}
      </Button>

      {expanded && (
        <Card id={panelId} role="region" aria-label={copy.title} className="min-w-0 space-y-3.5">
          <div className="flex flex-wrap items-start justify-between gap-2.5 border-b border-slate-100 pb-3">
            <div className="min-w-0 space-y-0.5">
              <h3 className="text-sm font-bold text-[#071A2B]">{copy.title}</h3>
              <p className="text-xs text-slate-500 leading-relaxed">{copy.subtitle}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              leftIcon={<IconRefresh className="w-3.5 h-3.5" />}
              disabled={query.isFetching || options.isFetching || submit.isPending}
              onClick={handleRefresh}
            >
              {copy.refresh}
            </Button>
          </div>

          {!denied && candidates.length > 0 && (
            <form
              className="space-y-2.5 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (
                  !selection ||
                  !selected ||
                  submittingRef.current ||
                  submit.isPending ||
                  options.isFetching ||
                  denied
                ) {
                  return;
                }
                submittingRef.current = true;
                setShowQueuedBanner(false);
                submit.mutate(selection);
              }}
            >
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-1">
                  <label htmlFor={selectId} className="block text-xs font-bold text-[#071A2B]">
                    {copy.entry}
                  </label>
                  <select
                    id={selectId}
                    className={`${DETAIL_FIELD_CLASS} bg-white py-2 text-xs`}
                    value={selected?.initialRequestId ?? ''}
                    disabled={submit.isPending}
                    onChange={(event) => {
                      submit.reset();
                      setShowQueuedBanner(false);
                      const initialRequestId = event.target.value;
                      setSelection(
                        initialRequestId
                          ? { initialRequestId, commandId: crypto.randomUUID() }
                          : null,
                      );
                    }}
                  >
                    <option value="">{copy.choose}</option>
                    {candidates.map((item) => (
                      <option key={item.initialRequestId} value={item.initialRequestId}>
                        {safeRetrospectivePlaceLabel(item.zoneName, copy.zone)} ·{' '}
                        {safeRetrospectivePlaceLabel(item.cameraName, copy.camera)} ·{' '}
                        {formatIdentificationDateTime(item.capturedAt)}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  className="w-full sm:w-auto shrink-0"
                  disabled={!selected || options.isFetching || submit.isPending}
                  isLoading={submit.isPending}
                >
                  {copy.request}
                </Button>
              </div>
            </form>
          )}

          {denied && (
            <Alert variant="destructive">
              <IconAlertTriangle className="w-4 h-4" />
              <AlertDescription className="space-y-1">
                <p className="font-semibold text-rose-900">{copy.failed}</p>
                <p>{copy.deniedNotice}</p>
              </AlertDescription>
            </Alert>
          )}

          {!denied && options.isError && (
            <Alert variant="destructive">
              <IconAlertTriangle className="w-4 h-4" />
              <AlertDescription>{copy.optionsError}</AlertDescription>
            </Alert>
          )}

          {!denied && options.isSuccess && !candidates.length && (
            <p className="text-xs text-slate-600">{copy.noOptions}</p>
          )}

          {!denied && submit.isError && (
            <Alert variant="destructive">
              <IconAlertTriangle className="w-4 h-4" />
              <AlertDescription>{copy.submitError}</AlertDescription>
            </Alert>
          )}

          {displayQueuedBanner && (
            <Alert variant="success">
              <IconCheck className="w-4 h-4" />
              <AlertDescription role="status">{copy.queued}</AlertDescription>
            </Alert>
          )}

          {!denied && hasActiveJobs && isVisible && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 rounded-xl border border-blue-200/80 bg-blue-50/60 px-3 py-2 text-xs font-medium text-blue-900"
            >
              <IconClock className="w-3.5 h-3.5 shrink-0 text-blue-600" />
              <span className="min-w-0 break-words">{copy.autoUpdating}</span>
            </div>
          )}

          {!denied && query.isPending && (
            <p role="status" className="text-xs font-medium text-slate-600">
              {copy.loading}
            </p>
          )}

          {!denied && query.isError && (
            <Alert variant="destructive">
              <IconAlertTriangle className="w-4 h-4" />
              <AlertDescription>{copy.failed}</AlertDescription>
            </Alert>
          )}

          {!denied && page?.total === 0 && <p className="text-xs text-slate-600">{copy.empty}</p>}

          {!denied && page && page.items.length > 0 && (
            <ul className="space-y-2.5">
              {page.items.map((item) => {
                const hint = retrospectiveStateHint(item.status, copy);
                const zoneLabel = safeRetrospectivePlaceLabel(item.zoneName, copy.zone);
                const cameraLabel = safeRetrospectivePlaceLabel(item.cameraName, copy.camera);
                return (
                  <li
                    key={item.requestId}
                    className="min-w-0 space-y-2.5 rounded-xl border border-slate-200/90 bg-slate-50/40 p-3.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 break-words text-sm font-bold text-[#071A2B]">
                        {zoneLabel} · {cameraLabel}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-slate-500">
                          {copy.reassessment}:
                        </span>
                        <Badge variant={retrospectiveBadgeVariant(item)} dot>
                          {resolveRetrospectiveVerdict(item, copy)}
                        </Badge>
                      </div>
                    </div>

                    {hint && (
                      <p className="text-xs text-slate-600 leading-relaxed break-words">{hint}</p>
                    )}

                    <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                      <div className="min-w-0 rounded-lg border border-slate-200/70 bg-white px-2.5 py-2">
                        <dt className="font-semibold text-slate-500">{copy.capture}</dt>
                        <dd className="mt-0.5 font-medium text-slate-800 tabular-nums break-words">
                          <time dateTime={item.capturedAt}>
                            {formatIdentificationDateTime(item.capturedAt)}
                          </time>
                        </dd>
                      </div>
                      <div className="min-w-0 rounded-lg border border-slate-200/70 bg-white px-2.5 py-2">
                        <dt className="font-semibold text-slate-500">{copy.original}</dt>
                        <dd className="mt-0.5 font-semibold text-[#071A2B] break-words">
                          {item.originalOutcome
                            ? copy.status[item.originalOutcome]
                            : copy.noOriginal}
                        </dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ul>
          )}

          {!denied && page && (offset > 0 || page.total > RETROSPECTIVE_PAGE_SIZE) && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-xs font-medium text-slate-500 tabular-nums">
                {copy.showingRange(
                  offset + 1,
                  Math.min(offset + page.items.length, page.total),
                  page.total,
                )}
              </span>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={offset === 0 || query.isFetching}
                  onClick={() => setOffset(Math.max(0, offset - RETROSPECTIVE_PAGE_SIZE))}
                >
                  {copy.previous}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={offset + RETROSPECTIVE_PAGE_SIZE >= page.total || query.isFetching}
                  onClick={() => setOffset(offset + RETROSPECTIVE_PAGE_SIZE)}
                >
                  {copy.next}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
