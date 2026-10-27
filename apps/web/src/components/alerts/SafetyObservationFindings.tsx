import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, type SmartSiteManagementClient } from '@smartsite/api-client';
import { translate as tr, uiLanguage } from '../../i18n';
import { localizedLabel } from '../../i18n/labels';
import { getOpaqueTokenNonce } from '../ppe/zone-ppe-scope';
import { StatusBadge, TechnicalDetails } from '../safety/SafetyWorkflowUi';
import { formatCandidateSubtype } from './safetyAlertEvidenceUtils';

export function SafetyObservationFindings({
  client,
  apiUrl,
  sessionScope,
  token,
  siteId,
  alertId,
  eventId,
  onSelectAlert,
  onUnauthorized,
}: {
  client: SmartSiteManagementClient;
  apiUrl: string;
  sessionScope: string;
  token: string;
  siteId: string;
  alertId: string;
  eventId: string;
  onSelectAlert: (id: string) => void;
  onUnauthorized?: () => void;
}) {
  useTranslation();
  const isVi = uiLanguage() === 'vi';
  const queryClient = useQueryClient();
  const tokenNonce = getOpaqueTokenNonce(queryClient, token);
  const scopeKey = `${apiUrl}:${sessionScope}:${tokenNonce}:${siteId}:${alertId}:${eventId}`;
  const [activeScopeKey, setActiveScopeKey] = useState(scopeKey);
  const [open, setOpen] = useState(false);

  if (activeScopeKey !== scopeKey) {
    setActiveScopeKey(scopeKey);
    setOpen(false);
  }
  const isExpanded = activeScopeKey === scopeKey ? open : false;

  const query = useInfiniteQuery({
    queryKey: [
      'safety-observation-findings',
      apiUrl,
      sessionScope,
      siteId,
      alertId,
      eventId,
      tokenNonce,
    ],
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      client.listSafetyObservationFindings(
        token,
        siteId,
        alertId,
        eventId,
        { offset: pageParam, limit: 20 },
        { signal },
      ),
    enabled: isExpanded && !!token && !!siteId && !!alertId && !!eventId,
    getNextPageParam: (last, _pages, offset) =>
      last.items.length > 0 && offset + last.items.length < last.total
        ? offset + last.items.length
        : undefined,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });

  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) {
      onUnauthorized?.();
    }
  }, [query.error, onUnauthorized]);

  const isForbiddenOrUnauthorized =
    query.error instanceof ApiError && (query.error.status === 401 || query.error.status === 403);
  const isAccessDenied =
    isForbiddenOrUnauthorized || (query.error instanceof ApiError && query.error.status === 404);
  const hasVisibleData =
    Boolean(query.data?.pages.length) &&
    !isAccessDenied &&
    (!query.isError || query.isFetchNextPageError);
  const firstPage = hasVisibleData ? query.data?.pages[0] : undefined;
  const latestPage = hasVisibleData ? query.data?.pages.at(-1) : undefined;
  const subject = firstPage?.subject ?? null;
  const total = latestPage?.total ?? 0;
  const items = hasVisibleData
    ? [
        ...new Map(
          (query.data?.pages ?? []).flatMap((value) => value.items).map((item) => [item.id, item]),
        ).values(),
      ]
    : [];
  const isRefreshing = query.isFetching && !query.isPending && !query.isFetchingNextPage;

  return (
    <section className="mt-3 border-t border-slate-200 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setOpen((value) => !value)}
          className="rounded px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2"
        >
          {tr('observation_findings.title')}
        </button>
        {isExpanded && isRefreshing && (
          <span role="status" className="text-[11px] text-slate-500">
            {tr('observation_findings.refreshing', {
              defaultValue: isVi ? 'Đang làm mới các phát hiện…' : 'Refreshing findings…',
            })}
          </span>
        )}
      </div>
      {isExpanded && (
        <div className="mt-2 space-y-2">
          {query.isPending && <p role="status">{tr('common.loading')}</p>}
          {query.isError && (
            <div role="alert" className="rounded-md bg-[#FDEBEC] p-2.5 text-xs text-[#9F2F2D]">
              <p>
                {isForbiddenOrUnauthorized
                  ? tr('observation_findings.denied', {
                      defaultValue: isVi
                        ? 'Không có quyền xem các phát hiện liên quan của người này.'
                        : 'Access denied for related findings on this person.',
                    })
                  : tr('observation_findings.unavailable')}
              </p>
              <button
                type="button"
                onClick={() =>
                  void (query.isFetchNextPageError && !isAccessDenied
                    ? query.fetchNextPage({ cancelRefetch: false })
                    : query.refetch())
                }
                disabled={query.isFetching}
                className="mt-1.5 rounded border border-[#9F2F2D]/30 bg-white px-2 py-1 font-semibold text-[#9F2F2D] hover:bg-[#FDEBEC] focus-visible:outline-2"
              >
                {tr('common.retry')}
              </button>
            </div>
          )}
          {firstPage && !subject && (
            <p role="status" className="text-slate-600">
              {tr('observation_findings.unresolved')}
            </p>
          )}
          {subject && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200/80 bg-white/80 px-2.5 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <h3 className="break-words text-xs font-semibold text-slate-900">
                    {tr('observation_findings.subject_in_frame', {
                      value1: subject.personObservationIndex + 1,
                      defaultValue: isVi
                        ? 'Người #{{value1}} trong ảnh này'
                        : 'Person #{{value1}} in this image',
                    })}
                  </h3>
                  <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 break-words">
                    {tr('observation_findings.event_local_badge', {
                      defaultValue: isVi ? 'Chỉ ảnh này' : 'This image only',
                    })}
                  </span>
                </div>
                {(total > 0 || items.length > 0) && (
                  <span className="text-[11px] text-slate-500">
                    {items.length > total
                      ? tr('observation_findings.loaded_vs_server_total', {
                          value1: items.length,
                          value2: total,
                          defaultValue: isVi
                            ? 'Đã tải {{value1}} · Tổng máy chủ mới nhất: {{value2}}'
                            : '{{value1}} loaded · Latest server total: {{value2}}',
                        })
                      : tr('common.value_value_of_value', {
                          value1: items.length > 0 ? 1 : 0,
                          value2: items.length,
                          value3: total,
                        })}
                  </span>
                )}
              </div>
              {items.length === 0 ? (
                <p role="status" className="text-slate-600">
                  {tr('observation_findings.empty', {
                    defaultValue: isVi
                      ? 'Chưa có phát hiện nào được ghi nhận cho người này trong khung hình này.'
                      : 'No findings recorded for this person in this frame.',
                  })}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      aria-current={item.id === alertId ? 'true' : undefined}
                      className="flex flex-wrap items-center justify-between gap-3 p-2.5"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p
                            id={`finding-subtype-${alertId}-${eventId}-${item.id}`}
                            className="break-words [overflow-wrap:anywhere] font-semibold text-slate-900"
                          >
                            {formatCandidateSubtype(item.candidateSubtype)}
                          </p>
                          <StatusBadge value={item.status} />
                        </div>
                        <p className="break-words [overflow-wrap:anywhere] text-[11px] text-slate-500">
                          {localizedLabel(item.alertType)}
                          {' · '}
                          {item.zoneId
                            ? tr('common.zone_value', { value1: item.zoneId })
                            : tr('common.no_resolved_zone')}
                        </p>
                      </div>
                      {item.id === alertId ? (
                        <span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                          {tr('observation_findings.current')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          aria-describedby={`finding-subtype-${alertId}-${eventId}-${item.id}`}
                          onClick={() => onSelectAlert(item.id)}
                          className="shrink-0 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2"
                        >
                          {tr('observation_findings.open')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {query.hasNextPage && (
                <button
                  type="button"
                  disabled={query.isFetching}
                  onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
                  className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 disabled:opacity-50"
                >
                  {tr(query.isFetchingNextPage ? 'common.loading' : 'common.load_more')}
                </button>
              )}
              <div className="rounded-md border border-slate-200/80 bg-white/80 px-2.5 py-1">
                <TechnicalDetails key={scopeKey}>
                  <p className="break-words text-slate-600">{tr('observation_findings.scope')}</p>
                  <p className="break-words font-mono text-[11px] text-slate-500">
                    {tr('observation_findings.subject_provenance', {
                      value1: subject.kind,
                      value2: subject.eventId,
                      value3: subject.personObservationIndex,
                      defaultValue: isVi
                        ? 'Chủ thể {{value1}} · Sự kiện {{value2}} · Chỉ mục người #{{value3}}'
                        : 'Subject {{value1}} · Event {{value2}} · Person index #{{value3}}',
                    })}
                  </p>
                  {items.length > 0 && (
                    <ul className="space-y-1 border-t border-slate-100 pt-1.5 font-mono text-[11px] text-slate-500">
                      {items.map((item) => (
                        <li key={item.id} className="break-words">
                          {tr('safety_alerts_view.alert_value_revision_value', {
                            value1: item.id,
                            value2: item.revision,
                          })}
                        </li>
                      ))}
                    </ul>
                  )}
                </TechnicalDetails>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
