import { useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useInRouterContext } from 'react-router-dom';
import {
  ApiError,
  type CameraResponse,
  type Page,
  type SafetyIdentificationRequest,
} from '@smartsite/api-client';
import { useAuth, useCurrentUser, useManagementClient } from '../../features/auth/auth-session';
import { userErrorMessage } from '../../i18n/messages';
import { getOpaqueTokenNonce } from '../ppe/zone-ppe-scope';
import {
  isSafetyIdentificationRouteEnabled,
  sameSafetyId,
  sanitizeSafetyQueryId,
} from '../safety-episodes/safetyUrlParams';
import {
  buildScopedCameraSetupHref,
  buildScopedIdentificationQueueHref,
  classifyC02TaskError,
  classifyCameraCheckError,
  formatTaskDueTimestamp,
  getManagerSafetyTaskCopy,
  isNonPollingC02Error,
} from './manager-safety-task-copy';

export interface ManagerSafetyTaskPanelProps {
  apiUrl: string;
  siteId: string;
  siteName?: string;
  enableIdentification?: boolean;
}

interface ActiveTaskScopeTracker {
  scopeKey: string;
  queryPrefix: readonly ['manager-safety-tasks', string, string, number, string, string];
  controllers: Set<AbortController>;
  disposed: boolean;
}

const C02_REFRESH_INTERVAL_MS = 30_000;

const ACTION_PRIMARY_CLASS =
  'inline-flex min-w-0 max-w-full items-center justify-center rounded-xl bg-[#041D2E] px-3.5 py-2 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-[#071A2B]/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F66B17]';
const ACTION_SECONDARY_CLASS =
  'inline-flex min-w-0 max-w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-[#041D2E] shadow-2xs transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F66B17] cursor-pointer disabled:opacity-50';

function ScopedActionLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: string;
}) {
  const inRouter = useInRouterContext();
  if (inRouter) {
    return (
      <Link to={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

function disposeTaskScope(queryClient: QueryClient, tracker: ActiveTaskScopeTracker) {
  if (tracker.disposed) return;
  tracker.disposed = true;
  for (const controller of tracker.controllers) {
    controller.abort();
  }
  tracker.controllers.clear();
  queryClient.removeQueries({ queryKey: tracker.queryPrefix });
}

function createScopeController(tracker: ActiveTaskScopeTracker): {
  controller: AbortController;
  release: () => void;
} {
  const controller = new AbortController();
  if (tracker.disposed) {
    controller.abort();
    return { controller, release: () => {} };
  }
  tracker.controllers.add(controller);
  return {
    controller,
    release: () => {
      tracker.controllers.delete(controller);
    },
  };
}

export function ManagerSafetyTaskPanel({
  apiUrl,
  siteId,
  siteName,
  enableIdentification,
}: ManagerSafetyTaskPanelProps) {
  const { accessToken } = useAuth();
  const { data: user } = useCurrentUser(apiUrl);
  const queryClient = useQueryClient();

  const safeSiteId = sanitizeSafetyQueryId(siteId);
  const token = accessToken?.trim() ?? '';
  const userId = user?.id?.trim() ?? '';
  const rolesSignature = JSON.stringify(user?.roleAssignments ?? []);
  const tokenNonce = getOpaqueTokenNonce(queryClient, token);

  const isAssignedSiteManager =
    Boolean(safeSiteId) &&
    Boolean(token) &&
    Boolean(userId) &&
    user?.isActive !== false &&
    !user?.mustChangePassword &&
    Boolean(
      user?.roleAssignments?.some(
        (role) => role.role === 'SITE_MANAGER' && sameSafetyId(role.siteId, safeSiteId),
      ),
    );

  const activeScopeKey =
    safeSiteId && isAssignedSiteManager
      ? `${apiUrl}::${userId}::${tokenNonce}::${rolesSignature}::${safeSiteId}`
      : null;

  const queryPrefix = useMemo(
    () =>
      activeScopeKey && safeSiteId
        ? ([
            'manager-safety-tasks',
            apiUrl,
            userId,
            tokenNonce,
            rolesSignature,
            safeSiteId,
          ] as const)
        : null,
    [activeScopeKey, apiUrl, rolesSignature, safeSiteId, tokenNonce, userId],
  );

  const prevTrackerRef = useRef<ActiveTaskScopeTracker | null>(null);
  const outerMountedRef = useRef(false);

  const currentTracker = useMemo<ActiveTaskScopeTracker | null>(() => {
    if (!activeScopeKey || !queryPrefix) return null;
    return {
      scopeKey: activeScopeKey,
      queryPrefix,
      controllers: new Set(),
      disposed: false,
    };
  }, [activeScopeKey, queryPrefix]);

  // Synchronously abort and purge previous site/session scope on real scope transitions,
  // without disrupting React StrictMode's mount -> simulated cleanup -> remount of the same scope.
  useLayoutEffect(() => {
    const previous = prevTrackerRef.current;
    if (previous && previous !== currentTracker) {
      disposeTaskScope(queryClient, previous);
    }
    prevTrackerRef.current = currentTracker;
  }, [currentTracker, queryClient]);

  // Clean up on genuine component unmount while preserving active fetches across StrictMode replay.
  useEffect(() => {
    outerMountedRef.current = true;
    return () => {
      outerMountedRef.current = false;
      queueMicrotask(() => {
        if (outerMountedRef.current) return;
        const latest = prevTrackerRef.current;
        if (latest) {
          disposeTaskScope(queryClient, latest);
          prevTrackerRef.current = null;
        }
      });
    };
  }, [queryClient]);

  if (!safeSiteId || !isAssignedSiteManager || !currentTracker) {
    return null;
  }

  return (
    <ScopedManagerSafetyTaskPanel
      key={currentTracker.scopeKey}
      apiUrl={apiUrl}
      accessToken={token}
      siteId={safeSiteId}
      siteName={siteName}
      enableIdentification={enableIdentification}
      tracker={currentTracker}
    />
  );
}

function ScopedManagerSafetyTaskPanel({
  apiUrl,
  accessToken,
  siteId,
  siteName,
  enableIdentification,
  tracker,
}: {
  apiUrl: string;
  accessToken: string;
  siteId: string;
  siteName?: string;
  enableIdentification?: boolean;
  tracker: ActiveTaskScopeTracker;
}) {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const copy = getManagerSafetyTaskCopy(language);
  const headingId = useId();
  const client = useManagementClient(apiUrl);

  const routeEnabled = isSafetyIdentificationRouteEnabled(enableIdentification);
  const queueHref = buildScopedIdentificationQueueHref(siteId);
  const cameraSetupHref = buildScopedCameraSetupHref(siteId);

  const c02Query = useQuery({
    queryKey: [...tracker.queryPrefix, 'c02-open'] as const,
    enabled: routeEnabled,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: (query) => !tracker.disposed && !isNonPollingC02Error(query.state.error),
    refetchInterval: (query) =>
      tracker.disposed || isNonPollingC02Error(query.state.error) ? false : C02_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<Page<SafetyIdentificationRequest>> => {
      const { controller, release } = createScopeController(tracker);
      try {
        const page = await client.listSafetyIdentificationRequests(
          accessToken,
          siteId,
          { status: 'OPEN', offset: 0, limit: 5 },
          { signal: controller.signal },
        );
        if (tracker.disposed) {
          throw new ApiError('cancelled', 'Stale manager task scope');
        }
        if (
          !Number.isSafeInteger(page.total) ||
          page.total < page.items.length ||
          page.items.some((item) => !sameSafetyId(item.siteId, siteId) || item.status !== 'OPEN')
        ) {
          throw new ApiError('invalid-response', 'Mismatched safety identification page');
        }
        return page;
      } finally {
        release();
      }
    },
  });

  const camerasQuery = useQuery({
    queryKey: [...tracker.queryPrefix, 'cameras'] as const,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Page<CameraResponse>> => {
      const { controller, release } = createScopeController(tracker);
      try {
        const page = await client.listCameras(
          accessToken,
          siteId,
          { offset: 0, limit: 20 },
          { signal: controller.signal },
        );
        if (tracker.disposed) {
          throw new ApiError('cancelled', 'Stale manager task scope');
        }
        if (
          !Number.isSafeInteger(page.total) ||
          page.total < page.items.length ||
          page.items.some((item) => !sameSafetyId(item.siteId, siteId))
        ) {
          throw new ApiError('invalid-response', 'Mismatched site camera page');
        }
        return page;
      } finally {
        release();
      }
    },
  });

  const c02ErrorKind = c02Query.isError ? classifyC02TaskError(c02Query.error) : null;
  const c02Page = c02Query.data;
  const cameraErrorKind = camerasQuery.isError
    ? classifyCameraCheckError(camerasQuery.error)
    : null;
  const isEmptyCameraSite = camerasQuery.isSuccess && camerasQuery.data.total === 0;
  const allLoadedCamerasInactive =
    camerasQuery.isSuccess &&
    camerasQuery.data.total > 0 &&
    camerasQuery.data.items.length > 0 &&
    camerasQuery.data.items.every((camera) => camera.status === 'INACTIVE');

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 shadow-xs space-y-4"
    >
      <div className="min-w-0 space-y-1">
        <h2 id={headingId} className="text-base font-black text-[#041D2E] break-words">
          {copy.panelTitle}
        </h2>
        <p className="text-xs text-slate-600 break-words">{copy.panelSubtitle(siteName)}</p>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {/* Card 1: Pending C02 Identification Requests */}
        <div className="flex min-w-0 flex-col justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-4">
          <div className="min-w-0 space-y-2.5">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-[#041D2E] break-words">{copy.c02Heading}</h3>
              {routeEnabled && c02Query.isSuccess && c02Page && (
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    c02Page.total > 0
                      ? 'bg-amber-100 text-amber-900'
                      : 'bg-emerald-100 text-emerald-900'
                  }`}
                >
                  {c02Page.total > 0 ? copy.c02OpenCountBadge(c02Page.total) : copy.c02EmptyBadge}
                </span>
              )}
            </div>

            {!routeEnabled ? (
              <div
                role="status"
                aria-live="polite"
                className="min-w-0 space-y-1 text-xs text-slate-600"
              >
                <p className="font-semibold text-slate-800 break-words">
                  {copy.c02RouteDisabledTitle}
                </p>
                <p className="break-words">{copy.c02RouteDisabledBody}</p>
              </div>
            ) : c02Query.isPending ? (
              <p role="status" aria-live="polite" className="text-xs text-slate-500 break-words">
                {copy.c02Loading}
              </p>
            ) : c02ErrorKind === 'feature-unavailable' ? (
              <div
                role="status"
                aria-live="polite"
                className="min-w-0 space-y-1 text-xs text-slate-600"
              >
                <p className="font-semibold text-slate-800 break-words">
                  {copy.c02FeatureUnavailableTitle}
                </p>
                <p className="break-words">{copy.c02FeatureUnavailableBody}</p>
              </div>
            ) : c02ErrorKind === 'temporarily-unavailable' ? (
              <div
                role="status"
                aria-live="polite"
                className="min-w-0 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"
              >
                <p className="font-semibold break-words">{copy.c02TemporarilyUnavailableTitle}</p>
                <p className="break-words">{copy.c02TemporarilyUnavailableBody}</p>
              </div>
            ) : c02ErrorKind === 'unauthorized' ? (
              <p
                role="status"
                aria-live="polite"
                className="text-xs font-semibold text-amber-900 break-words"
              >
                {copy.c02UnauthorizedBody}
              </p>
            ) : c02ErrorKind === 'forbidden' ? (
              <p
                role="status"
                aria-live="polite"
                className="text-xs font-semibold text-red-700 break-words"
              >
                {copy.c02ForbiddenBody}
              </p>
            ) : c02ErrorKind === 'retriable-error' ? (
              <div
                role="status"
                aria-live="polite"
                className="min-w-0 space-y-1 rounded-lg border border-red-200 bg-red-50/80 p-3 text-xs text-red-900"
              >
                <p className="font-semibold break-words">{copy.c02ErrorTitle}</p>
                <p className="break-words">{userErrorMessage(c02Query.error)}</p>
              </div>
            ) : !c02Page || c02Page.total === 0 ? (
              <p className="text-xs text-slate-600 break-words">{copy.c02EmptyBody}</p>
            ) : (
              <div className="min-w-0 space-y-2">
                {c02Page.total > c02Page.items.length && (
                  <p className="text-xs text-slate-600 break-words">
                    {copy.c02ShowingSubset(c02Page.items.length, c02Page.total)}
                  </p>
                )}
                <ul className="min-w-0 space-y-2">
                  {c02Page.items.map((request) => {
                    const formattedDue = formatTaskDueTimestamp(request.dueAt, language);
                    const subjectLabel =
                      request.subject.kind === 'TRACKED'
                        ? copy.c02SubjectTracked
                        : copy.c02SubjectSingle;
                    return (
                      <li
                        key={request.id}
                        className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs space-y-1"
                      >
                        <p className="font-semibold text-[#041D2E] break-words">{request.reason}</p>
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                          <span>{subjectLabel}</span>
                          {formattedDue && <span>· {copy.c02DueLabel(formattedDue)}</span>}
                        </div>
                        <details className="text-[11px] text-slate-500">
                          <summary className="cursor-pointer font-medium">
                            {copy.c02TechnicalDetails}
                          </summary>
                          <p className="mt-1 font-mono break-all">{request.id}</p>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2 pt-1">
            {(c02ErrorKind === 'temporarily-unavailable' || c02ErrorKind === 'retriable-error') && (
              <button
                type="button"
                className={ACTION_SECONDARY_CLASS}
                disabled={c02Query.isFetching}
                onClick={() => void c02Query.refetch()}
              >
                {copy.c02RetryAction}
              </button>
            )}
            {routeEnabled &&
              queueHref &&
              c02ErrorKind !== 'feature-unavailable' &&
              c02ErrorKind !== 'unauthorized' &&
              c02ErrorKind !== 'forbidden' && (
                <ScopedActionLink href={queueHref} className={ACTION_PRIMARY_CLASS}>
                  {copy.c02OpenQueueAction}
                </ScopedActionLink>
              )}
          </div>
        </div>

        {/* Card 2: Camera & Zone Setup */}
        <div className="flex min-w-0 flex-col justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-4">
          <div className="min-w-0 space-y-2.5">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-[#041D2E] break-words">{copy.cameraHeading}</h3>
              {camerasQuery.isSuccess && (
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    isEmptyCameraSite
                      ? 'bg-amber-100 text-amber-900'
                      : 'bg-slate-200/90 text-[#041D2E]'
                  }`}
                >
                  {isEmptyCameraSite
                    ? copy.cameraEmptyBadge
                    : copy.cameraConfiguredBadge(camerasQuery.data.total)}
                </span>
              )}
            </div>

            {camerasQuery.isPending ? (
              <p role="status" aria-live="polite" className="text-xs text-slate-500 break-words">
                {copy.cameraLoading}
              </p>
            ) : cameraErrorKind === 'unauthorized' ? (
              <p
                role="status"
                aria-live="polite"
                className="text-xs font-semibold text-amber-900 break-words"
              >
                {copy.cameraUnauthorizedBody}
              </p>
            ) : cameraErrorKind === 'forbidden' ? (
              <p
                role="status"
                aria-live="polite"
                className="text-xs font-semibold text-red-700 break-words"
              >
                {copy.cameraForbiddenBody}
              </p>
            ) : cameraErrorKind === 'retriable-error' ? (
              <div
                role="status"
                aria-live="polite"
                className="min-w-0 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"
              >
                <p className="font-semibold break-words">{copy.cameraErrorTitle}</p>
                <p className="break-words">{userErrorMessage(camerasQuery.error)}</p>
              </div>
            ) : isEmptyCameraSite ? (
              <div className="min-w-0 space-y-1.5 text-xs text-slate-700">
                <p className="font-semibold text-[#041D2E] break-words">{copy.cameraEmptyPrompt}</p>
                <p className="text-slate-500 break-words">{copy.cameraTruthfulnessNote}</p>
              </div>
            ) : (
              <div className="min-w-0 space-y-1.5 text-xs text-slate-700">
                <p className="break-words">{copy.cameraConfiguredBody}</p>
                {allLoadedCamerasInactive && (
                  <p className="font-semibold text-amber-900 break-words">
                    {copy.cameraAllInactiveNote}
                  </p>
                )}
                <p className="text-slate-500 break-words">{copy.cameraTruthfulnessNote}</p>
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2 pt-1">
            {cameraErrorKind === 'retriable-error' && (
              <button
                type="button"
                className={ACTION_SECONDARY_CLASS}
                disabled={camerasQuery.isFetching}
                onClick={() => void camerasQuery.refetch()}
              >
                {copy.cameraRetryAction}
              </button>
            )}
            {cameraSetupHref &&
              cameraErrorKind !== 'unauthorized' &&
              cameraErrorKind !== 'forbidden' && (
                <ScopedActionLink
                  href={cameraSetupHref}
                  className={isEmptyCameraSite ? ACTION_PRIMARY_CLASS : ACTION_SECONDARY_CLASS}
                >
                  {isEmptyCameraSite ? copy.cameraEmptyAction : copy.cameraConfiguredAction}
                </ScopedActionLink>
              )}
          </div>
        </div>
      </div>
    </section>
  );
}
