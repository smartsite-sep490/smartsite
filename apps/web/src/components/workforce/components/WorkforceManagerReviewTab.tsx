import { useManagementClient } from '../../../features/auth/auth-session';
import { localizedLabel } from '../../../i18n/labels';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { useNotificationRequest } from '../hooks/useNotificationRequest';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ShiftRequestResponse } from '@smartsite/api-client';
import {
  IconUsers,
  IconAlertCircle,
  IconCheckCircle2,
  IconSearch,
  IconShield,
  IconLoader,
  IconCheck,
  IconX,
  IconClock,
  IconRefreshCw,
  IconArrowRight,
  IconChevronLeft,
  IconChevronRight,
} from '../../icons';
import { formatShiftTime, formatDateTime, formatWorkDate } from '../utils/workforce-format';
import { useShiftRequests } from '../hooks/useShiftRequests';
import { RequestPagination } from './RequestPagination';
import { schedulingError } from '../utils/scheduling-error';
import {
  Button,
  Badge,
  Dialog,
  EmptyState,
  Tabs,
  Card,
  Alert,
  AlertTitle,
  AlertDescription,
} from '../../ui';

export function WorkforceManagerReviewTab({
  apiUrl,
  siteId,
  token,
}: {
  apiUrl: string;
  siteId: string;
  token: string;
}) {
  useTranslation();

  const queryClient = useQueryClient();
  const client = useManagementClient(apiUrl);
  const target = useNotificationRequest(apiUrl, siteId, token);
  const [userSubTab, setSubTab] = useState<'pending' | 'history' | null>(null);
  const subTab =
    userSubTab ?? (target.data && target.data.status !== 'PENDING_MANAGER' ? 'history' : 'pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'CHANGE' | 'SWAP'>('ALL');
  const [rejectTarget, setRejectTarget] = useState<{ type: 'CHANGE' | 'SWAP'; id: string } | null>(
    null,
  );
  const [rejectReason, setRejectReason] = useState('');
  const [actionFeedback, setActionFeedback] = useState<{
    type: 'success' | 'error';
    title: string;
    message: string;
  } | null>(null);

  const [historyPage, setHistoryPage] = useState(0);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const requestQuery = useShiftRequests(apiUrl, siteId, token, {
    view: subTab === 'pending' ? 'REVIEW' : 'HISTORY',
    requestType: filterType,
    search: searchQuery,
    offset: historyPage * historyPageSize,
    limit: historyPageSize,
  });

  // Queries
  const changesError = requestQuery.isError;
  const swapsError = false;
  const changesErrorObj = requestQuery.error;
  const swapsErrorObj: { status?: number } = {};
  const refetchChanges = requestQuery.refetch;
  const refetchSwaps = requestQuery.refetch;
  const { data: workers } = useQuery({
    queryKey: ['workers', siteId],
    queryFn: () => client.listWorkers(token, siteId, { limit: 25 }),
  });

  const { data: coworkers } = useQuery({
    queryKey: ['coworkers', siteId],
    queryFn: () => client.listCoworkers(token, siteId, { limit: 25 }),
  });

  const { data: shifts } = useQuery({
    queryKey: ['shifts', siteId],
    queryFn: () => client.listShifts(token, siteId, { limit: 25 }),
  });

  const getWorkerName = React.useCallback(
    (id?: string) => {
      if (!id) return tr('common.worker');
      const w =
        workers?.items.find(
          (item) => item.id === id || (item as unknown as { userId?: string }).userId === id,
        ) ||
        coworkers?.items.find(
          (item) => item.id === id || (item as unknown as { userId?: string }).userId === id,
        );
      return w?.displayName || tr('common.worker_value', { value1: id.slice(0, 6) });
    },
    [workers, coworkers],
  );

  const getShiftObj = (id: string) => shifts?.items.find((item) => item.id === id);
  const getShiftName = (id: string) => {
    const s = getShiftObj(id);
    return s
      ? `${s.name} (${formatShiftTime(s.startsAt)} - ${formatShiftTime(s.endsAt)})`
      : tr('common.shift_value', { value1: id.slice(0, 6) });
  };

  const actionError = (error: unknown) =>
    setActionFeedback({
      type: 'error',
      get title() {
        return tr('common.action_failed');
      },
      message: schedulingError(error),
    });

  // Mutations
  const approveChange = useMutation({
    mutationFn: (id: string) => client.approveShiftChangeRequest(token, siteId, id),
    onError: actionError,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['notifications', apiUrl] });
      void queryClient.invalidateQueries({ queryKey: ['notification-request', apiUrl, siteId] });
      queryClient.invalidateQueries({ queryKey: ['shift-requests', apiUrl, siteId] });
      queryClient.invalidateQueries({ queryKey: ['worker-schedules', siteId] });
      setActionFeedback(
        result.status === 'APPLIED'
          ? {
              type: 'success',
              get title() {
                return tr('common.shift_change_approved');
              },
              get message() {
                return tr(
                  'workforce_manager_review_tab.shift_change_request_has_been_approved_the_worker_schedule_is_now_updated',
                );
              },
            }
          : {
              type: 'error',
              get title() {
                return tr('workforce_manager_review_tab.shift_change_could_not_be_applied');
              },
              get message() {
                return tr(
                  'workforce_manager_review_tab.the_schedule_changed_before_approval_review_the_current_schedule_and_submit_a_new',
                );
              },
            },
      );
      setTimeout(() => setActionFeedback(null), 5000);
    },
  });

  const rejectChange = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      client.rejectShiftChangeRequest(token, siteId, input.id, { reason: input.reason }),
    onError: actionError,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications', apiUrl] });
      void queryClient.invalidateQueries({ queryKey: ['notification-request', apiUrl, siteId] });
      queryClient.invalidateQueries({ queryKey: ['shift-requests', apiUrl, siteId] });
      setRejectTarget(null);
      setRejectReason('');
      setActionFeedback({
        type: 'success',
        get title() {
          return tr('common.shift_change_rejected');
        },
        get message() {
          return tr('workforce_manager_review_tab.the_shift_change_request_has_been_declined');
        },
      });
      setTimeout(() => setActionFeedback(null), 5000);
    },
  });

  const approveSwap = useMutation({
    mutationFn: (id: string) => client.approveShiftSwapRequest(token, siteId, id),
    onError: actionError,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['notifications', apiUrl] });
      void queryClient.invalidateQueries({ queryKey: ['notification-request', apiUrl, siteId] });
      queryClient.invalidateQueries({ queryKey: ['shift-requests', apiUrl, siteId] });
      queryClient.invalidateQueries({ queryKey: ['worker-schedules', siteId] });
      setActionFeedback(
        result.status === 'APPLIED'
          ? {
              type: 'success',
              get title() {
                return tr('common.shift_swap_approved');
              },
              get message() {
                return tr(
                  'workforce_manager_review_tab.shift_swap_request_approved_schedules_for_both_workers_have_been_updated',
                );
              },
            }
          : {
              type: 'error',
              get title() {
                return tr('workforce_manager_review_tab.shift_swap_could_not_be_applied');
              },
              get message() {
                return tr(
                  'workforce_manager_review_tab.the_schedule_changed_before_approval_review_the_current_schedule_and_submit_a_new',
                );
              },
            },
      );
      setTimeout(() => setActionFeedback(null), 5000);
    },
  });

  const rejectSwap = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      client.rejectShiftSwapRequest(token, siteId, input.id, { reason: input.reason }),
    onError: actionError,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications', apiUrl] });
      void queryClient.invalidateQueries({ queryKey: ['notification-request', apiUrl, siteId] });
      queryClient.invalidateQueries({ queryKey: ['shift-requests', apiUrl, siteId] });
      setRejectTarget(null);
      setRejectReason('');
      setActionFeedback({
        type: 'success',
        get title() {
          return tr('common.shift_swap_rejected');
        },
        get message() {
          return tr('workforce_manager_review_tab.the_shift_swap_request_has_been_declined');
        },
      });
      setTimeout(() => setActionFeedback(null), 5000);
    },
  });

  const openRejectModal = (type: 'CHANGE' | 'SWAP', id: string) => {
    setRejectTarget({ type, id });
    setRejectReason('');
  };

  const closeRejectModal = () => {
    setRejectTarget(null);
    setRejectReason('');
    rejectChange.reset();
    rejectSwap.reset();
  };

  const isLoading = requestQuery.isLoading;
  const pageItems = requestQuery.data?.items ?? [];
  const selected =
    target.data &&
    !pageItems.some((r) => r.id === target.data!.id) &&
    (filterType === 'ALL' || target.data.requestType === filterType) &&
    (subTab === 'pending'
      ? target.data.status === 'PENDING_MANAGER'
      : !['DRAFT', 'PENDING_MANAGER', 'PENDING_COWORKER'].includes(target.data.status))
      ? target.data
      : null;
  const visibleItems = selected ? [selected, ...pageItems] : pageItems;
  const filteredPending = {
    changes: visibleItems.filter(
      (r): r is Extract<ShiftRequestResponse, { requestType: 'CHANGE' }> =>
        r.requestType === 'CHANGE' && r.status === 'PENDING_MANAGER',
    ),
    swaps: visibleItems.filter(
      (r): r is Extract<ShiftRequestResponse, { requestType: 'SWAP' }> =>
        r.requestType === 'SWAP' && r.status === 'PENDING_MANAGER',
    ),
    total: visibleItems.length,
  };
  const totalPending = requestQuery.data?.pendingCount ?? 0;
  const allHistory = visibleItems;
  const historyTotal = requestQuery.data?.total ?? 0;
  const historyPageCount = Math.max(1, Math.ceil(historyTotal / historyPageSize));
  const paginatedHistory = allHistory;

  const activeWorkerCount = workers?.items.length || 0;

  // ── Access Denied ──────────────────────────────────────────────────────────
  const is403 =
    (changesError && (changesErrorObj as { status?: number })?.status === 403) ||
    (swapsError && (swapsErrorObj as { status?: number })?.status === 403);

  if (is403) {
    return (
      <div className="max-w-md mx-auto mt-20 p-8 rounded-2xl bg-white border border-rose-200 text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
          <IconShield className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">{tr('common.access_denied')}</h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          {tr(
            'workforce_manager_review_tab.contractor_review_is_reserved_for_contractor_representatives_assigned_to_this_site',
          )}
        </p>
      </div>
    );
  }

  // ── Error State ───────────────────────────────────────────────────────────
  if (changesError || swapsError) {
    return (
      <div className="max-w-md mx-auto mt-20 p-8 rounded-2xl bg-white border border-rose-200 text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
          <IconAlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">
          {tr('workforce_manager_review_tab.failed_to_load_requests')}
        </h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          {tr(
            'workforce_manager_review_tab.an_error_occurred_while_loading_shift_change_and_swap_requests',
          )}
        </p>
        <Button
          variant="default"
          size="md"
          onClick={() => {
            void refetchChanges();
            void refetchSwaps();
          }}
        >
          {tr('common.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {target.isLoading && <p role="status">{tr('common.loading_selected_request')}</p>}
      {target.isError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
        >
          {tr(
            'workforce_manager_review_tab.this_request_is_unavailable_or_you_no_longer_have_access',
          )}{' '}
          <button type="button" onClick={() => void target.refetch()} className="underline">
            {tr('common.retry')}
          </button>
        </div>
      )}

      {/* 1. Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div className="flex flex-wrap items-center gap-3 max-w-full">
          <div className="w-10 h-10 rounded-xl bg-[#071A2B] text-white flex items-center justify-center shadow-xs shrink-0">
            <IconShield className="w-5 h-5 text-[#F66B17]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                {tr('common.workforce_operations')}
              </span>
              <span className="text-slate-300">•</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                {tr('common.shift_approvals')}
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[#071A2B]">
              {tr('common.contractor_review')}
            </h1>
          </div>
        </div>

        <Button
          variant="outline"
          size="md"
          onClick={() => {
            void refetchChanges();
            void refetchSwaps();
          }}
          isLoading={isLoading}
          leftIcon={<IconRefreshCw className="w-3.5 h-3.5 text-slate-500" />}
        >
          {tr('common.refresh')}
        </Button>
      </div>

      {/* 2. Top Summary Metrics */}
      <div className="flex flex-wrap items-center gap-3 max-w-full">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl px-4 py-2.5 shadow-xs flex min-w-0 max-w-full items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-500">
            <IconUsers className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              {tr('common.workers')}
            </p>
            <p className="text-sm font-bold text-[#071A2B]">{activeWorkerCount}</p>
          </div>
        </div>

        <div
          className={`bg-white border rounded-2xl px-4 py-2.5 shadow-xs flex min-w-0 max-w-full items-center gap-3 ${totalPending > 0 ? 'border-amber-300 bg-amber-50/30' : 'border-[#E2E8F0]'}`}
        >
          <div
            className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 ${totalPending > 0 ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-slate-50 border-slate-100 text-slate-400'}`}
          >
            <IconAlertCircle className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p
              className={`text-[11px] font-medium uppercase tracking-wider ${totalPending > 0 ? 'text-amber-800 font-semibold' : 'text-slate-500'}`}
            >
              {tr('common.pending_action')}
            </p>
            <p
              className={`text-sm font-bold ${totalPending > 0 ? 'text-amber-600' : 'text-slate-700'}`}
            >
              {totalPending}
            </p>
          </div>
        </div>
      </div>

      {/* ── HIGH-END FLOATING TOAST FEEDBACK ─────────────────────────────── */}
      {actionFeedback && (
        <div className="fixed top-5 right-5 z-50 pointer-events-auto max-w-sm sm:max-w-md w-[calc(100vw-2.5rem)] animate-in slide-in-from-top-4 fade-in duration-300">
          <div className="relative overflow-hidden rounded-2xl bg-[#071A2B]/95 backdrop-blur-xl border border-white/15 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.35),0_0_0_1px_rgba(16,185,129,0.25)] text-white">
            <div className="flex items-start gap-3.5">
              <div
                className={`w-9 h-9 rounded-xl text-white flex items-center justify-center shrink-0 ${
                  actionFeedback.type === 'success'
                    ? 'bg-emerald-500 shadow-sm'
                    : 'bg-rose-500 shadow-sm'
                }`}
              >
                {actionFeedback.type === 'success' ? (
                  <IconCheck className="w-5 h-5 text-white" />
                ) : (
                  <IconAlertCircle className="w-5 h-5 text-white" />
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
                    {actionFeedback.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActionFeedback(null)}
                    className="text-slate-400 hover:text-white rounded-lg p-1 transition-colors cursor-pointer"
                    aria-label={tr('common.dismiss_notification')}
                  >
                    <IconX className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs font-semibold text-slate-100 leading-snug">
                  {actionFeedback.message}
                </p>
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/10 overflow-hidden">
              <div className="h-full bg-emerald-400 animate-[pulse_2s_ease-in-out_infinite]" />
            </div>
          </div>
        </div>
      )}

      {/* Pending Reviews Notice Banner */}
      {totalPending > 0 && subTab === 'pending' && (
        <Alert variant="warning" className="animate-in slide-in-from-top-2 fade-in duration-200">
          <IconAlertCircle className="w-5 h-5" />
          <div className="space-y-1">
            <AlertTitle className="text-amber-950 font-bold flex items-center gap-2 text-xs">
              <span>{tr('common.pending_contractor_review')}</span>
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            </AlertTitle>
            <AlertDescription className="text-amber-900/90 font-medium text-xs">
              {tr('common.you_have')}{' '}
              <span className="font-semibold text-slate-950">
                {tr('common.value_shift_request_s', { value1: totalPending })}
              </span>{' '}
              {tr('workforce_manager_review_tab.awaiting_your_review_and_approval')}
            </AlertDescription>
          </div>
        </Alert>
      )}

      {/* 3. Controls & Tabs */}
      <div className="bg-white p-3 rounded-2xl border border-[#E2E8F0] shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <Tabs
          items={[
            {
              id: 'pending' as const,
              get label() {
                return tr('common.pending_review');
              },
              count: totalPending,
              icon: <IconAlertCircle className="w-3.5 h-3.5 text-amber-500" />,
            },
            {
              id: 'history' as const,
              get label() {
                return tr('common.request_history');
              },
              icon: <IconClock className="w-3.5 h-3.5 text-slate-500" />,
            },
          ]}
          activeTab={subTab}
          onChange={(tab) => {
            setSubTab(tab);
            setHistoryPage(0);
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          {/* Type Filter Buttons */}
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50/80 p-0.5">
            <button
              type="button"
              onClick={() => {
                setFilterType('ALL');
                setHistoryPage(0);
              }}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                filterType === 'ALL'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {tr('common.all')}
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterType('CHANGE');
                setHistoryPage(0);
              }}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                filterType === 'CHANGE'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {tr('common.changes')}
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterType('SWAP');
                setHistoryPage(0);
              }}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                filterType === 'SWAP'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {tr('common.swaps')}
            </button>
          </div>

          {/* Search Box */}
          <div className="relative">
            <IconSearch className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setHistoryPage(0);
              }}
              placeholder={tr('workforce_manager_review_tab.search_worker_reason')}
              className="bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1 text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:bg-white transition-colors w-44"
            />
          </div>
        </div>
      </div>

      {/* 4. Content Area: Pending Review Cards Feed */}
      {subTab === 'pending' && (
        <div className="space-y-4">
          {isLoading ? (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-16 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2 shadow-xs">
              <IconLoader className="w-5 h-5 animate-spin text-slate-500" />
              <span>{tr('common.loading_review_requests')}</span>
            </div>
          ) : filteredPending.total === 0 ? (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-xs">
              <EmptyState
                icon={<IconCheckCircle2 className="w-6 h-6 text-emerald-500" />}
                title={tr('common.all_caught_up')}
                description={tr(
                  'workforce_manager_review_tab.no_pending_shift_change_or_swap_requests_requiring_your_review',
                )}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Direct Shift Changes */}
              {filteredPending.changes.map((change) => {
                const isOperating =
                  (approveChange.isPending && approveChange.variables === change.id) ||
                  (rejectChange.isPending && rejectTarget?.id === change.id);

                return (
                  <Card key={change.id} doubleBezel className="space-y-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                          {getWorkerName(change.workerId).charAt(0)}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 text-xs">
                            {getWorkerName(change.workerId)}
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {formatDateTime(change.createdAt)}
                          </span>
                        </div>
                      </div>

                      <Badge variant="info">{tr('common.shift_change')}</Badge>
                    </div>

                    {/* Transition details */}
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
                      <div className="text-xs text-slate-700">
                        {tr('common.shift_date')}{' '}
                        <span className="font-semibold">{formatWorkDate(change.workDate)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold text-slate-600">
                          {getShiftName(change.fromShiftId)}
                        </span>
                        <IconArrowRight className="w-3 h-3 text-slate-400" />
                        <span className="font-bold text-[#F66B17]">
                          {getShiftName(change.toShiftId)}
                        </span>
                      </div>
                      {change.reason && (
                        <p className="text-[11px] text-slate-600 italic">
                          {tr('common.quot_value_quot', { value1: change.reason })}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isOperating}
                        onClick={() => openRejectModal('CHANGE', change.id)}
                        className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                      >
                        {tr('common.reject')}
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        isLoading={approveChange.isPending && approveChange.variables === change.id}
                        disabled={isOperating}
                        onClick={() => approveChange.mutate(change.id)}
                        leftIcon={<IconCheck className="w-3 h-3 text-emerald-400" />}
                      >
                        {tr('common.approve_change')}
                      </Button>
                    </div>
                  </Card>
                );
              })}

              {/* Shift Swaps */}
              {filteredPending.swaps.map((swap) => {
                const isOperating =
                  (approveSwap.isPending && approveSwap.variables === swap.id) ||
                  (rejectSwap.isPending && rejectTarget?.id === swap.id);

                return (
                  <Card key={swap.id} doubleBezel className="space-y-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                          {getWorkerName(swap.requesterWorkerId).charAt(0)}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 text-xs">
                            {getWorkerName(swap.requesterWorkerId)} ↔{' '}
                            {getWorkerName(swap.coworkerWorkerId)}
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {formatDateTime(swap.createdAt)}
                          </span>
                        </div>
                      </div>

                      <Badge variant="success">{tr('common.swap_confirmed')}</Badge>
                    </div>

                    {/* Swap details */}
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
                      <div className="text-xs text-slate-700 space-y-1">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">
                              {getWorkerName(swap.requesterWorkerId)}
                            </span>
                            <Badge variant="neutral">
                              {tr('common.team_value', {
                                value1:
                                  swap.requesterTeamName === undefined
                                    ? tr('common.unavailable')
                                    : (swap.requesterTeamName ?? tr('common.unassigned')),
                              })}
                            </Badge>
                          </div>
                          <div>
                            {tr('common.date')}{' '}
                            <span className="font-semibold">
                              {formatWorkDate(swap.requesterWorkDate)}
                            </span>{' '}
                            {tr('common.shift_2e9119')} {getShiftName(swap.requesterShiftId)}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">
                              {getWorkerName(swap.coworkerWorkerId)}
                            </span>
                            <Badge variant="neutral">
                              {tr('common.team_value', {
                                value1:
                                  swap.coworkerTeamName === undefined
                                    ? tr('common.unavailable')
                                    : (swap.coworkerTeamName ?? tr('common.unassigned')),
                              })}
                            </Badge>
                          </div>
                          <div>
                            {tr('common.date')}{' '}
                            <span className="font-semibold">
                              {formatWorkDate(swap.coworkerWorkDate)}
                            </span>{' '}
                            {tr('common.shift_2e9119')} {getShiftName(swap.coworkerShiftId)}
                          </div>
                        </div>
                      </div>
                      {swap.reason && (
                        <p className="text-[11px] text-slate-600 italic pt-1 border-t border-slate-200/60">
                          {tr('common.quot_value_quot', { value1: swap.reason })}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isOperating}
                        onClick={() => openRejectModal('SWAP', swap.id)}
                        className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                      >
                        {tr('common.reject')}
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        isLoading={approveSwap.isPending && approveSwap.variables === swap.id}
                        disabled={isOperating}
                        onClick={() => approveSwap.mutate(swap.id)}
                        leftIcon={<IconCheck className="w-3 h-3 text-emerald-400" />}
                      >
                        {tr('common.approve_swap')}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {subTab === 'pending' && (
        <RequestPagination
          page={historyPage}
          size={historyPageSize}
          total={historyTotal}
          onChange={setHistoryPage}
        />
      )}
      {subTab === 'history' && allHistory.length === 0 && historyTotal > 0 && (
        <RequestPagination
          page={historyPage}
          size={historyPageSize}
          total={historyTotal}
          onChange={setHistoryPage}
        />
      )}

      {/* 5. Content Area: Request History Table */}
      {subTab === 'history' && (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-xs overflow-hidden">
          {isLoading ? (
            <p role="status" className="p-4">
              {tr('common.loading_request_history')}
            </p>
          ) : allHistory.length === 0 ? (
            <EmptyState
              icon={<IconClock className="w-6 h-6 text-slate-400" />}
              title={tr('common.no_history_records')}
              description={tr(
                'workforce_manager_review_tab.past_approved_and_rejected_workforce_change_requests_will_appear_here',
              )}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-4">{tr('common.type')}</th>
                      <th className="py-3 px-4">{tr('common.worker_s')}</th>
                      <th className="py-3 px-4">{tr('common.details_reason')}</th>
                      <th className="py-3 px-4">{tr('common.status')}</th>
                      <th className="py-3 px-4">{tr('common.date_99c40a')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedHistory.map((item) => (
                      <tr
                        key={`${item.requestType}-${item.id}`}
                        className="hover:bg-slate-50/70 transition-colors"
                      >
                        <td className="py-3.5 px-4 font-bold text-slate-800">
                          {item.requestType === 'CHANGE' ? tr('common.change') : tr('common.swap')}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-900">
                          {item.requestType === 'CHANGE'
                            ? getWorkerName(item.workerId)
                            : `${getWorkerName(item.requesterWorkerId)} ↔ ${getWorkerName(item.coworkerWorkerId)}`}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">
                          {item.requestType === 'CHANGE' ? (
                            <>
                              <div>
                                {tr('common.shift_date_value', {
                                  value1: formatWorkDate(item.workDate),
                                })}
                              </div>
                              <div>
                                {tr('common.to_value', { value1: getShiftName(item.toShiftId) })}
                              </div>
                              {item.reason && (
                                <div className="text-[11px] text-slate-400 italic">
                                  {tr('common.quot_value_quot', { value1: item.reason })}
                                </div>
                              )}
                            </>
                          ) : item.reason ? (
                            `"${item.reason}"`
                          ) : (
                            tr('workforce_manager_review_tab.swap_agreed_by_coworker')
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <Badge
                            variant={
                              item.status === 'APPROVED' || item.status === 'APPLIED'
                                ? 'success'
                                : 'danger'
                            }
                            dot
                          >
                            {localizedLabel(item.status)}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-4 text-slate-400 text-[11px] font-mono">
                          {formatDateTime(item.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 border-t border-slate-100 bg-slate-50/50 text-xs text-slate-500 font-medium">
                <div className="flex items-center gap-2">
                  <span>
                    {tr('common.showing')}{' '}
                    <span className="font-bold text-slate-900">
                      {historyTotal === 0 ? 0 : historyPage * historyPageSize + 1}
                    </span>{' '}
                    {tr('common.to_663ea1')}{' '}
                    <span className="font-bold text-slate-900">
                      {Math.min((historyPage + 1) * historyPageSize, historyTotal)}
                    </span>{' '}
                    {tr('common.of')}{' '}
                    <span className="font-bold text-slate-900">{historyTotal}</span>{' '}
                    {tr('common.records')}
                  </span>
                  <div className="flex items-center gap-1.5 ml-2 border-l border-slate-200 pl-3">
                    <span className="text-[11px] text-slate-400">{tr('common.per_page')}</span>
                    <select
                      value={historyPageSize}
                      onChange={(e) => {
                        setHistoryPageSize(Number(e.target.value));
                        setHistoryPage(0);
                      }}
                      className="bg-white border border-slate-200 rounded-md px-1.5 py-0.5 text-xs text-slate-700 outline-none focus:border-[#F66B17] cursor-pointer"
                    >
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                    </select>
                  </div>
                </div>

                {historyPageCount > 1 && (
                  <div className="flex items-center gap-1 self-end sm:self-center">
                    <button
                      type="button"
                      disabled={historyPage === 0}
                      onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-2xs cursor-pointer"
                    >
                      <IconChevronLeft className="w-3.5 h-3.5" />
                      <span>{tr('common.prev')}</span>
                    </button>

                    <div className="flex items-center gap-1">
                      {Array.from({ length: historyPageCount }).map((_, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setHistoryPage(idx)}
                          className={`w-7 h-7 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                            historyPage === idx
                              ? 'bg-[#071A2B] text-white shadow-2xs'
                              : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {idx + 1}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      disabled={historyPage + 1 >= historyPageCount}
                      onClick={() => setHistoryPage((p) => Math.min(historyPageCount - 1, p + 1))}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-2xs cursor-pointer"
                    >
                      <span>{tr('common.next')}</span>
                      <IconChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── MODAL: Reject Reason Confirmation Dialog ────────────────────────── */}
      <Dialog
        open={Boolean(rejectTarget)}
        onClose={closeRejectModal}
        title={tr('common.reject_request_e169f1')}
        description={tr(
          'workforce_manager_review_tab.please_provide_a_reason_for_declining_this_request',
        )}
        icon={<IconX className="w-4 h-4 text-rose-500" />}
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="reject-reason-input" className="block text-xs font-bold text-slate-700">
              {tr('common.rejection_reason_628908')} <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="reject-reason-input"
              rows={3}
              required
              placeholder={tr(
                'workforce_manager_review_tab.e_g_insufficient_coverage_for_the_requested_shift',
              )}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/10"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="outline" size="md" onClick={closeRejectModal}>
              {tr('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              size="md"
              disabled={!rejectReason.trim()}
              isLoading={rejectChange.isPending || rejectSwap.isPending}
              onClick={() => {
                if (!rejectTarget || !rejectReason.trim()) return;
                if (rejectTarget.type === 'CHANGE') {
                  rejectChange.mutate({ id: rejectTarget.id, reason: rejectReason.trim() });
                } else {
                  rejectSwap.mutate({ id: rejectTarget.id, reason: rejectReason.trim() });
                }
              }}
            >
              {tr('common.confirm_rejection_dce40d')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
