import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
} from '@smartsite/api-client';
import {
  IconUsers,
  IconCalendar,
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
} from '../icons';
import { formatShiftTime, formatDateTime, WORKFORCE_POLL_INTERVAL_MS } from './WorkforceSharedUI';
import { filterContractorReviewRequests } from './WorkforceManagerReviewUtils';
import {
  Button,
  Badge,
  Dialog,
  EmptyState,
  Tabs,
  Card,
} from '../ui';

export function WorkforceManagerReviewTab({
  apiUrl,
  siteId,
  token,
}: {
  apiUrl: string;
  siteId: string;
  token: string;
}) {
  const queryClient = useQueryClient();
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const [subTab, setSubTab] = useState<'pending' | 'history'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'CHANGE' | 'SWAP'>('ALL');
  const [rejectTarget, setRejectTarget] = useState<{ type: 'CHANGE' | 'SWAP'; id: string } | null>(
    null,
  );
  const [rejectReason, setRejectReason] = useState('');

  // Queries
  const {
    data: changes,
    isLoading: changesLoading,
    isError: changesError,
    error: changesErrorObj,
    refetch: refetchChanges,
  } = useQuery({
    queryKey: ['shift-change-requests', siteId],
    queryFn: () => client.listShiftChangeRequests(token, siteId, { limit: 25 }),
    refetchInterval: WORKFORCE_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const {
    data: swaps,
    isLoading: swapsLoading,
    isError: swapsError,
    error: swapsErrorObj,
    refetch: refetchSwaps,
  } = useQuery({
    queryKey: ['swap-requests', siteId],
    queryFn: () => client.listShiftSwapRequests(token, siteId, { limit: 25 }),
    refetchInterval: WORKFORCE_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

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

  const { data: schedules } = useQuery({
    queryKey: ['worker-schedules', siteId],
    queryFn: () => client.listWorkerSchedules(token, siteId, { limit: 25 }),
    refetchInterval: WORKFORCE_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const getWorkerName = React.useCallback(
    (id?: string) => {
      if (!id) return 'Worker';
      const w =
        workers?.items.find(
          (item) => item.id === id || (item as unknown as { userId?: string }).userId === id,
        ) ||
        coworkers?.items.find(
          (item) => item.id === id || (item as unknown as { userId?: string }).userId === id,
        );
      return w?.displayName || `Worker (${id.slice(0, 6)})`;
    },
    [workers, coworkers],
  );

  const getShiftObj = (id: string) => shifts?.items.find((item) => item.id === id);
  const getShiftName = (id: string) => {
    const s = getShiftObj(id);
    return s
      ? `${s.name} (${formatShiftTime(s.startsAt)} - ${formatShiftTime(s.endsAt)})`
      : `Shift (${id.slice(0, 6)})`;
  };

  // Mutations
  const approveChange = useMutation({
    mutationFn: (id: string) => client.approveShiftChangeRequest(token, siteId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-change-requests', siteId] });
      queryClient.invalidateQueries({ queryKey: ['worker-schedules', siteId] });
    },
  });

  const rejectChange = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      client.rejectShiftChangeRequest(token, siteId, input.id, { reason: input.reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-change-requests', siteId] });
      setRejectTarget(null);
      setRejectReason('');
    },
  });

  const approveSwap = useMutation({
    mutationFn: (id: string) => client.approveShiftSwapRequest(token, siteId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['swap-requests', siteId] });
      queryClient.invalidateQueries({ queryKey: ['worker-schedules', siteId] });
    },
  });

  const rejectSwap = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      client.rejectShiftSwapRequest(token, siteId, input.id, { reason: input.reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['swap-requests', siteId] });
      setRejectTarget(null);
      setRejectReason('');
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

  const isLoading = changesLoading || swapsLoading;

  // Filter pending items
  const filteredPending = useMemo(() => {
    const { pendingChanges, pendingSwaps } = filterContractorReviewRequests(
      changes?.items || [],
      swaps?.items || [],
    );

    let filteredC = pendingChanges;
    let filteredS = pendingSwaps;

    if (filterType === 'CHANGE') filteredS = [];
    if (filterType === 'SWAP') filteredC = [];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filteredC = filteredC.filter(
        (r) =>
          getWorkerName(r.workerId).toLowerCase().includes(q) ||
          r.reason.toLowerCase().includes(q),
      );
      filteredS = filteredS.filter(
        (r) =>
          getWorkerName(r.requesterWorkerId).toLowerCase().includes(q) ||
          getWorkerName(r.coworkerWorkerId).toLowerCase().includes(q) ||
          r.reason.toLowerCase().includes(q),
      );
    }

    return {
      changes: filteredC,
      swaps: filteredS,
      total: filteredC.length + filteredS.length,
    };
  }, [changes, swaps, filterType, searchQuery, getWorkerName]);

  const totalPending =
    (changes?.items?.filter((r) => r.status === 'PENDING_MANAGER').length || 0) +
    (swaps?.items?.filter((r) => r.status === 'PENDING_MANAGER').length || 0);

  // History list
  const historyChanges = useMemo(() => {
    let list =
      changes?.items.filter((r) => r.status !== 'PENDING_MANAGER' && r.status !== 'DRAFT') || [];
    if (filterType === 'SWAP') return [];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          getWorkerName(r.workerId).toLowerCase().includes(q) ||
          r.reason.toLowerCase().includes(q),
      );
    }
    return list;
  }, [changes, filterType, searchQuery, getWorkerName]);

  const historySwaps = useMemo(() => {
    let list =
      swaps?.items.filter(
        (r) =>
          r.status !== 'PENDING_MANAGER' &&
          r.status !== 'DRAFT' &&
          r.status !== 'PENDING_COWORKER',
      ) || [];
    if (filterType === 'CHANGE') return [];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          getWorkerName(r.requesterWorkerId).toLowerCase().includes(q) ||
          getWorkerName(r.coworkerWorkerId).toLowerCase().includes(q) ||
          r.reason.toLowerCase().includes(q),
      );
    }
    return list;
  }, [swaps, filterType, searchQuery, getWorkerName]);

  const activeWorkerCount = workers?.items.length || 0;
  const totalAssignedShifts = schedules?.total || 0;

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
        <h2 className="text-lg font-bold text-slate-900">Access Denied</h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          Contractor Review is reserved for Contractor Representatives assigned to this Site and Contractor.
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
        <h2 className="text-lg font-bold text-slate-900">Failed to Load Requests</h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          An error occurred while loading shift change and swap requests.
        </p>
        <Button
          variant="default"
          size="md"
          onClick={() => {
            void refetchChanges();
            void refetchSwaps();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-300">

      {/* 1. Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#071A2B] text-white flex items-center justify-center shadow-xs shrink-0">
            <IconShield className="w-5 h-5 text-[#F66B17]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Workforce Operations
              </span>
              <span className="text-slate-300">•</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Shift Approvals
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[#071A2B]">
              Contractor Review
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
          Refresh
        </Button>
      </div>

      {/* 2. Top Summary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Workers</span>
            <p className="text-xl font-black text-[#071A2B]">{activeWorkerCount}</p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600">
            <IconUsers className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Assigned Shifts</span>
            <p className="text-xl font-black text-[#071A2B]">{totalAssignedShifts}</p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600">
            <IconCalendar className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Pending Action</span>
            <p className="text-xl font-black text-amber-600">{totalPending}</p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600">
            <IconAlertCircle className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Coverage Risk</span>
            <p className="text-xl font-black text-emerald-600">0 Shifts</p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
            <IconCheckCircle2 className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* 3. Controls & Tabs */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <Tabs
          items={[
            {
              id: 'pending' as const,
              label: 'Pending Review',
              count: totalPending,
              icon: <IconAlertCircle className="w-3.5 h-3.5 text-amber-500" />,
            },
            {
              id: 'history' as const,
              label: 'Request History',
              icon: <IconClock className="w-3.5 h-3.5 text-slate-500" />,
            },
          ]}
          activeTab={subTab}
          onChange={(tab) => setSubTab(tab)}
        />

        <div className="flex flex-wrap items-center gap-2">
          {/* Type Filter Buttons */}
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50/80 p-0.5">
            <button
              type="button"
              onClick={() => setFilterType('ALL')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                filterType === 'ALL' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilterType('CHANGE')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                filterType === 'CHANGE' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Changes
            </button>
            <button
              type="button"
              onClick={() => setFilterType('SWAP')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                filterType === 'SWAP' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Swaps
            </button>
          </div>

          {/* Search Box */}
          <div className="relative">
            <IconSearch className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search worker / reason..."
              className="bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1 text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:bg-white transition-colors w-44"
            />
          </div>
        </div>
      </div>

      {/* 4. Content Area: Pending Review Cards Feed */}
      {subTab === 'pending' && (
        <div className="space-y-4">
          {isLoading ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2 shadow-xs">
              <IconLoader className="w-5 h-5 animate-spin text-slate-500" />
              <span>Loading review requests...</span>
            </div>
          ) : filteredPending.total === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs">
              <EmptyState
                icon={<IconCheckCircle2 className="w-6 h-6 text-emerald-500" />}
                title="All Caught Up!"
                description="No pending shift change or swap requests requiring your review."
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

                      <Badge variant="info">SHIFT CHANGE</Badge>
                    </div>

                    {/* Transition details */}
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
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
                          &quot;{change.reason}&quot;
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
                        Reject
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        isLoading={approveChange.isPending && approveChange.variables === change.id}
                        disabled={isOperating}
                        onClick={() => approveChange.mutate(change.id)}
                        leftIcon={<IconCheck className="w-3 h-3 text-emerald-400" />}
                      >
                        Approve Change
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
                            {getWorkerName(swap.requesterWorkerId)} ↔ {getWorkerName(swap.coworkerWorkerId)}
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {formatDateTime(swap.createdAt)}
                          </span>
                        </div>
                      </div>

                      <Badge variant="success">SWAP CONFIRMED</Badge>
                    </div>

                    {/* Swap details */}
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
                      <div className="text-xs text-slate-700 space-y-1">
                        <div>
                          <span className="font-semibold">{getWorkerName(swap.requesterWorkerId)}:</span> Shift ({getShiftName(swap.requesterShiftId)})
                        </div>
                        <div>
                          <span className="font-semibold">{getWorkerName(swap.coworkerWorkerId)}:</span> Shift ({getShiftName(swap.coworkerShiftId)})
                        </div>
                      </div>
                      {swap.reason && (
                        <p className="text-[11px] text-slate-600 italic pt-1 border-t border-slate-200/60">
                          &quot;{swap.reason}&quot;
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
                        Reject
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        isLoading={approveSwap.isPending && approveSwap.variables === swap.id}
                        disabled={isOperating}
                        onClick={() => approveSwap.mutate(swap.id)}
                        leftIcon={<IconCheck className="w-3 h-3 text-emerald-400" />}
                      >
                        Approve Swap
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 5. Content Area: Request History Table */}
      {subTab === 'history' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
          {historyChanges.length === 0 && historySwaps.length === 0 ? (
            <EmptyState
              icon={<IconClock className="w-6 h-6 text-slate-400" />}
              title="No History Records"
              description="Past approved and rejected workforce change requests will appear here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Worker(s)</th>
                    <th className="py-3 px-4">Details / Reason</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {historyChanges.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-800">Change</td>
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        {getWorkerName(item.workerId)}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        <div>To: {getShiftName(item.toShiftId)}</div>
                        {item.reason && <div className="text-[11px] text-slate-400 italic">&quot;{item.reason}&quot;</div>}
                      </td>
                      <td className="py-3.5 px-4">
                        <Badge variant={item.status === 'APPROVED' || item.status === 'APPLIED' ? 'success' : 'danger'} dot>
                          {item.status}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                        {formatDateTime(item.createdAt)}
                      </td>
                    </tr>
                  ))}
                  {historySwaps.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-800">Swap</td>
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        {getWorkerName(item.requesterWorkerId)} ↔ {getWorkerName(item.coworkerWorkerId)}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        {item.reason ? `"${item.reason}"` : 'Swap agreed by coworker'}
                      </td>
                      <td className="py-3.5 px-4">
                        <Badge variant={item.status === 'APPROVED' || item.status === 'APPLIED' ? 'success' : 'danger'} dot>
                          {item.status}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                        {formatDateTime(item.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── MODAL: Reject Reason Confirmation Dialog ────────────────────────── */}
      <Dialog
        open={Boolean(rejectTarget)}
        onClose={closeRejectModal}
        title="Reject Request"
        description="Please provide a reason for declining this request"
        icon={<IconX className="w-4 h-4 text-rose-500" />}
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="reject-reason-input" className="block text-xs font-bold text-slate-700">
              Rejection Reason <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="reject-reason-input"
              rows={3}
              required
              placeholder="e.g. Insufficient coverage for the requested shift"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/10"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="outline" size="md" onClick={closeRejectModal}>
              Cancel
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
              Confirm Rejection
            </Button>
          </div>
        </div>
      </Dialog>

    </div>
  );
}
