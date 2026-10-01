import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient, ShiftChangeRequestResponse, ShiftSwapRequestResponse } from '@smartsite/api-client';
import { SmartCard, SmartButton, StatusBadge, LabelBadge, Modal, formatShiftTime, formatDateTime } from './WorkforceSharedUI';
import { IconUsers, IconCalendar, IconAlertCircle, IconCheckCircle2, IconSearch, IconFilter, IconUser } from '../icons';

export function WorkforceManagerReviewTab({ apiUrl, siteId, token }: { apiUrl: string; siteId: string; token: string }) {
  const queryClient = useQueryClient();
  const client = new SmartSiteManagementClient(apiUrl);
  const [subTab, setSubTab] = useState<'pending' | 'history'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'CHANGE' | 'SWAP'>('ALL');
  const [selectedChangeDetail, setSelectedChangeDetail] = useState<ShiftChangeRequestResponse | null>(null);
  const [selectedSwapDetail, setSelectedSwapDetail] = useState<ShiftSwapRequestResponse | null>(null);

  // Queries
  const { data: changes, isLoading: changesLoading } = useQuery({
    queryKey: ['shift-change-requests', siteId],
    queryFn: () => client.listShiftChangeRequests(token, siteId, { limit: 100 }),
  });
  const { data: swaps, isLoading: swapsLoading } = useQuery({
    queryKey: ['swap-requests', siteId],
    queryFn: () => client.listShiftSwapRequests(token, siteId, { limit: 100 }),
  });
  const { data: workers } = useQuery({
    queryKey: ['workers', siteId],
    queryFn: () => client.listWorkers(token, siteId, { limit: 100 }),
  });
  const { data: coworkers } = useQuery({
    queryKey: ['coworkers', siteId],
    queryFn: () => client.listCoworkers(token, siteId, { limit: 100 }),
  });
  const { data: shifts } = useQuery({
    queryKey: ['shifts', siteId],
    queryFn: () => client.listShifts(token, siteId, { limit: 100 }),
  });
  const { data: schedules } = useQuery({
    queryKey: ['worker-schedules', siteId],
    queryFn: () => client.listWorkerSchedules(token, siteId, { limit: 100 }),
  });

  const getWorkerName = React.useCallback((id?: string) => {
    if (!id) return 'Worker';
    const w =
      workers?.items.find((item) => item.id === id || (item as unknown as { userId?: string }).userId === id) ||
      coworkers?.items.find((item) => item.id === id || (item as unknown as { userId?: string }).userId === id);
    return w?.displayName || `Worker (${id.slice(0, 6)})`;
  }, [workers, coworkers]);
  const getShiftObj = (id: string) => shifts?.items.find((item) => item.id === id);
  const getShiftName = (id: string) => {
    const s = getShiftObj(id);
    return s ? `${s.name} (${formatShiftTime(s.startsAt)} - ${formatShiftTime(s.endsAt)})` : `Shift (${id.slice(0, 6)})`;
  };

  // Mutations
  const approveChange = useMutation({
    mutationFn: (id: string) => client.approveShiftChangeRequest(token, siteId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-change-requests', siteId] });
      queryClient.invalidateQueries({ queryKey: ['change', siteId] });
      queryClient.invalidateQueries({ queryKey: ['worker-schedules', siteId] });
      setSelectedChangeDetail(null);
    },
  });

  const rejectChange = useMutation({
    mutationFn: (id: string) => client.rejectShiftChangeRequest(token, siteId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-change-requests', siteId] });
      queryClient.invalidateQueries({ queryKey: ['change', siteId] });
      setSelectedChangeDetail(null);
    },
  });

  const approveSwap = useMutation({
    mutationFn: (id: string) => client.approveShiftSwapRequest(token, siteId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['swap-requests', siteId] });
      queryClient.invalidateQueries({ queryKey: ['swap', siteId] });
      queryClient.invalidateQueries({ queryKey: ['worker-schedules', siteId] });
      setSelectedSwapDetail(null);
    },
  });

  const rejectSwap = useMutation({
    mutationFn: (id: string) => client.rejectShiftSwapRequest(token, siteId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['swap-requests', siteId] });
      queryClient.invalidateQueries({ queryKey: ['swap', siteId] });
      setSelectedSwapDetail(null);
    },
  });

  const isLoading = changesLoading || swapsLoading;

  // Filter pending items:
  const pendingChanges = useMemo(() => {
    let list = changes?.items.filter((r) => r.status === 'PENDING_MANAGER') || [];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((r) => getWorkerName(r.workerId).toLowerCase().includes(q) || r.reason.toLowerCase().includes(q));
    }
    return list;
  }, [changes, searchQuery, getWorkerName]);

  const pendingSwaps = useMemo(() => {
    let list = swaps?.items.filter((r) => r.status === 'PENDING_MANAGER') || [];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          getWorkerName(r.requesterWorkerId).toLowerCase().includes(q) ||
          getWorkerName(r.coworkerWorkerId).toLowerCase().includes(q) ||
          r.reason.toLowerCase().includes(q)
      );
    }
    return list;
  }, [swaps, searchQuery, getWorkerName]);

  const totalPending = (changes?.items.filter((r) => r.status === 'PENDING_MANAGER').length || 0) + (swaps?.items.filter((r) => r.status === 'PENDING_MANAGER').length || 0);

  const historyChanges = useMemo(() => {
    let list = changes?.items.filter((r) => r.status !== 'PENDING_MANAGER' && r.status !== 'DRAFT') || [];
    if (filterType === 'SWAP') return [];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((r) => getWorkerName(r.workerId).toLowerCase().includes(q) || r.reason.toLowerCase().includes(q));
    }
    return list;
  }, [changes, filterType, searchQuery, getWorkerName]);

  const historySwaps = useMemo(() => {
    let list = swaps?.items.filter((r) => r.status !== 'PENDING_MANAGER' && r.status !== 'DRAFT' && r.status !== 'PENDING_COWORKER') || [];
    if (filterType === 'CHANGE') return [];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          getWorkerName(r.requesterWorkerId).toLowerCase().includes(q) ||
          getWorkerName(r.coworkerWorkerId).toLowerCase().includes(q) ||
          r.reason.toLowerCase().includes(q)
      );
    }
    return list;
  }, [swaps, filterType, searchQuery, getWorkerName]);

  const activeWorkerCount = workers?.items.length || 0;
  const totalAssignedShifts = schedules?.items.length || 0;

  const getErrorMessage = (err: unknown, defaultMsg: string) => {
    const errorObj = err as { status?: number; message?: string };
    if (errorObj?.status === 409) return 'Conflict: Schedule updated or version stale.';
    if (errorObj?.status === 403) return 'Forbidden: Site Manager authorization required.';
    return errorObj?.message || defaultMsg;
  };

  return (
    <div className="space-y-8">
      {/* 1. TOP HEADER & KPI METRICS OVERVIEW CARDS */}
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-black text-[#071A2B] tracking-tight">Site Manager Review</h1>
          <p className="text-xs text-[#607A96] mt-1">
            Review pending shift changes and coworker-accepted swap requests for this site.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl border border-[#DCE6EF] p-4 shadow-[0_2px_10px_rgba(7,26,43,0.03)] flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#071A2B] text-white flex items-center justify-center shrink-0">
              <IconUsers className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-[#607A96] uppercase tracking-wider">Active Workers</p>
              <p className="text-xl font-black text-[#071A2B]">{activeWorkerCount}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#DCE6EF] p-4 shadow-[0_2px_10px_rgba(7,26,43,0.03)] flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#F5F8FB] text-[#071A2B] flex items-center justify-center shrink-0 border border-[#DCE6EF]">
              <IconCalendar className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-[#607A96] uppercase tracking-wider">Assigned Shifts</p>
              <p className="text-xl font-black text-[#071A2B]">{totalAssignedShifts}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#DCE6EF] p-4 shadow-[0_2px_10px_rgba(7,26,43,0.03)] flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FEF3C7] text-[#D97706] flex items-center justify-center shrink-0 border border-[#FDE68A]">
              <IconAlertCircle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-[#607A96] uppercase tracking-wider">Pending Action</p>
              <p className="text-xl font-black text-[#D97706]">{totalPending}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#DCE6EF] p-4 shadow-[0_2px_10px_rgba(7,26,43,0.03)] flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#ECFDF5] text-[#16B77A] flex items-center justify-center shrink-0 border border-[#A7F3D0]">
              <IconCheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-[#607A96] uppercase tracking-wider">Risk of Shortage</p>
              <p className="text-xl font-black text-[#16B77A]">0 Shifts</p>
            </div>
          </div>
        </div>
      </div>

      {/* 2. CONTROLS BAR: SUBTABS, SEARCH & TYPE FILTERS */}
      <div className="bg-white rounded-2xl border border-[#DCE6EF] p-5 shadow-[0_4px_20px_rgba(7,26,43,0.03)] space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#DCE6EF] pb-4">
          <div className="flex gap-2">
            <button
              onClick={() => setSubTab('pending')}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                subTab === 'pending'
                  ? 'bg-[#071A2B] text-white shadow-xs'
                  : 'bg-[#F5F8FB] text-[#607A96] hover:bg-[#EAF0F6]'
              }`}
            >
              Pending Action ({totalPending})
            </button>
            <button
              onClick={() => setSubTab('history')}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                subTab === 'history'
                  ? 'bg-[#071A2B] text-white shadow-xs'
                  : 'bg-[#F5F8FB] text-[#607A96] hover:bg-[#EAF0F6]'
              }`}
            >
              Site Change History
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative w-full md:w-60">
              <IconSearch className="w-4 h-4 text-[#607A96] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search worker or reason..."
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#DCE6EF] bg-[#F5F8FB] text-xs text-[#071A2B] outline-none focus:border-[#071A2B] transition-colors"
              />
            </div>

            {/* Type Filter */}
            <div className="flex items-center gap-1.5 bg-[#F5F8FB] p-1 rounded-xl border border-[#DCE6EF]">
              <IconFilter className="w-3.5 h-3.5 text-[#607A96] ml-2" />
              {(['ALL', 'CHANGE', 'SWAP'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer capitalize ${
                    filterType === t ? 'bg-[#071A2B] text-white shadow-xs' : 'text-[#607A96] hover:bg-white'
                  }`}
                >
                  {t.toLowerCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* LOADING STATE */}
        {isLoading && (
          <div className="space-y-3 py-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-24 bg-[#F5F8FB] rounded-xl animate-pulse border border-[#DCE6EF]" />
            ))}
          </div>
        )}

        {/* 3. PENDING ACTIONS SECTION */}
        {!isLoading && subTab === 'pending' && totalPending === 0 && (
          <div className="py-12 text-center space-y-2">
            <p className="text-base font-bold text-[#071A2B]">All caught up!</p>
            <p className="text-xs text-[#607A96]">There are no pending shift change or coworker-accepted swap requests requiring manager review.</p>
          </div>
        )}

        {!isLoading && subTab === 'pending' && totalPending > 0 && (
          <div className="space-y-4">
            {/* PENDING DIRECT SHIFT CHANGES */}
            {(filterType === 'ALL' || filterType === 'CHANGE') &&
              pendingChanges.map((req) => (
                <SmartCard key={req.id} className="hover:border-[#071A2B]/40">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="space-y-2.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <LabelBadge>Direct Shift Change</LabelBadge>
                        <StatusBadge status={req.status} />
                        <span className="text-xs text-[#607A96] font-mono">
                          {formatDateTime(req.createdAt)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[#071A2B] text-white flex items-center justify-center font-bold text-xs shrink-0">
                          {getWorkerName(req.workerId).slice(0, 2).toUpperCase()}
                        </div>
                        <h3 className="font-bold text-[#071A2B] text-base truncate">
                          {getWorkerName(req.workerId)}
                        </h3>
                      </div>

                      <div className="p-3 bg-[#F5F8FB] rounded-xl border border-[#DCE6EF] text-xs space-y-1">
                        <span className="text-[#607A96] font-medium">Requested Target Shift: </span>
                        <span className="font-bold text-[#071A2B]">{getShiftName(req.toShiftId)}</span>
                      </div>

                      <p className="text-xs text-[#071A2B] italic bg-[#F5F8FB]/60 p-2.5 rounded-xl border border-[#DCE6EF]">
                        Reason: &quot;{req.reason}&quot;
                      </p>
                    </div>

                    <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
                      <SmartButton onClick={() => setSelectedChangeDetail(req)} variant="secondary">
                        View Details
                      </SmartButton>
                      <SmartButton
                        onClick={() => rejectChange.mutate(req.id)}
                        disabled={rejectChange.isPending || approveChange.isPending}
                        variant="destructive"
                      >
                        {rejectChange.isPending ? 'Rejecting...' : 'Reject'}
                      </SmartButton>
                      <SmartButton
                        onClick={() => approveChange.mutate(req.id)}
                        disabled={approveChange.isPending || rejectChange.isPending}
                        variant="success"
                      >
                        {approveChange.isPending ? 'Approving...' : 'Approve'}
                      </SmartButton>
                    </div>
                  </div>
                  {(approveChange.isError || rejectChange.isError) && (
                    <p className="text-xs text-red-600 mt-2 font-medium bg-red-50 p-2 rounded-lg border border-red-200">
                      {getErrorMessage(approveChange.error || rejectChange.error, 'Action failed.')}
                    </p>
                  )}
                </SmartCard>
              ))}

            {/* PENDING COWORKER-ACCEPTED SWAP REQUESTS */}
            {(filterType === 'ALL' || filterType === 'SWAP') &&
              pendingSwaps.map((req) => (
                <SmartCard key={req.id} className="hover:border-[#071A2B]/40">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="space-y-2.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <LabelBadge>Shift Swap</LabelBadge>
                        <StatusBadge status={req.status} />
                        {req.coworkerConfirmedAt && (
                          <LabelBadge dotColor="bg-emerald-500">Coworker Confirmed</LabelBadge>
                        )}
                        <span className="text-xs text-[#607A96] font-mono">
                          {formatDateTime(req.createdAt)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[#071A2B] text-white flex items-center justify-center font-bold text-xs shrink-0">
                          <IconUser className="w-4 h-4" />
                        </div>
                        <h3 className="font-bold text-[#071A2B] text-base truncate">
                          {getWorkerName(req.requesterWorkerId)} <span className="text-[#607A96] font-normal">&amp;</span> {getWorkerName(req.coworkerWorkerId)}
                        </h3>
                      </div>

                      <div className="p-3 bg-[#F5F8FB] rounded-xl border border-[#DCE6EF] text-xs space-y-1">
                        <span className="text-[#607A96] font-medium">Swap: </span>
                        <span className="font-bold text-[#071A2B]">{getShiftName(req.requesterShiftId)}</span>
                        <span className="text-[#607A96] mx-1">&harr;</span>
                        <span className="font-bold text-[#071A2B]">{getShiftName(req.coworkerShiftId)}</span>
                      </div>

                      <p className="text-xs text-[#071A2B] italic bg-[#F5F8FB]/60 p-2.5 rounded-xl border border-[#DCE6EF]">
                        Reason: &quot;{req.reason}&quot;
                      </p>
                    </div>

                    <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
                      <SmartButton onClick={() => setSelectedSwapDetail(req)} variant="secondary">
                        View Details
                      </SmartButton>
                      <SmartButton
                        onClick={() => rejectSwap.mutate(req.id)}
                        disabled={rejectSwap.isPending || approveSwap.isPending}
                        variant="destructive"
                      >
                        {rejectSwap.isPending ? 'Rejecting...' : 'Reject'}
                      </SmartButton>
                      <SmartButton
                        onClick={() => approveSwap.mutate(req.id)}
                        disabled={approveSwap.isPending || rejectSwap.isPending}
                        variant="success"
                      >
                        {approveSwap.isPending ? 'Approving...' : 'Approve'}
                      </SmartButton>
                    </div>
                  </div>
                  {(approveSwap.isError || rejectSwap.isError) && (
                    <p className="text-xs text-red-600 mt-2 font-medium bg-red-50 p-2 rounded-lg border border-red-200">
                      {getErrorMessage(approveSwap.error || rejectSwap.error, 'Action failed.')}
                    </p>
                  )}
                </SmartCard>
              ))}
          </div>
        )}

        {/* 4. SITE CHANGE HISTORY SECTION */}
        {!isLoading && subTab === 'history' && (
          <div className="space-y-3">
            {historyChanges.length === 0 && historySwaps.length === 0 && (
              <div className="py-8 text-center text-xs text-[#607A96]">No change history available matching the selected filter.</div>
            )}

            {historyChanges.map((req) => (
              <div key={req.id} className="p-4 rounded-2xl border border-[#DCE6EF] bg-[#F5F8FB]/60 hover:bg-white transition-all flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shadow-2xs">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <LabelBadge>Direct Change</LabelBadge>
                    <StatusBadge status={req.status} />
                  </div>
                  <p className="text-sm font-bold text-[#071A2B] truncate">
                    {getWorkerName(req.workerId)} <span className="text-[#607A96] font-normal">&rarr; Target:</span> {getShiftName(req.toShiftId)}
                  </p>
                  <p className="text-xs text-[#607A96]">Reason: &quot;{req.reason}&quot;</p>
                </div>
                <span className="text-xs text-[#607A96] font-mono shrink-0 bg-white px-2.5 py-1 rounded-lg border border-[#DCE6EF]">
                  {formatDateTime(req.createdAt)}
                </span>
              </div>
            ))}

            {historySwaps.map((req) => (
              <div key={req.id} className="p-4 rounded-2xl border border-[#DCE6EF] bg-[#F5F8FB]/60 hover:bg-white transition-all flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shadow-2xs">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <LabelBadge>Shift Swap</LabelBadge>
                    <StatusBadge status={req.status} />
                  </div>
                  <p className="text-sm font-bold text-[#071A2B] truncate">
                    {getWorkerName(req.requesterWorkerId)} <span className="text-[#607A96] font-normal">&harr;</span> {getWorkerName(req.coworkerWorkerId)}
                  </p>
                  <p className="text-xs text-[#607A96]">Reason: &quot;{req.reason}&quot;</p>
                </div>
                <span className="text-xs text-[#607A96] font-mono shrink-0 bg-white px-2.5 py-1 rounded-lg border border-[#DCE6EF]">
                  {formatDateTime(req.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 5. REQUEST DETAIL MODALS FOR SITE MANAGER REVIEW */}
      {selectedChangeDetail && (
        <Modal
          isOpen={true}
          onClose={() => setSelectedChangeDetail(null)}
          title="Direct Shift Change Details"
          subtitle="Inspect full worker request details before approval"
        >
          <div className="space-y-4">
            <div className="p-3.5 bg-[#F5F8FB] rounded-xl border border-[#DCE6EF] space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-[#071A2B]">Worker Profile</span>
                <StatusBadge status={selectedChangeDetail.status} />
              </div>
              <p className="text-sm font-bold text-[#071A2B]">{getWorkerName(selectedChangeDetail.workerId)}</p>
              <p className="text-xs text-[#607A96] font-mono">Submitted: {formatDateTime(selectedChangeDetail.createdAt)}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 p-3.5 bg-[#F5F8FB] rounded-xl border border-[#DCE6EF]">
              <div>
                <span className="text-[10px] font-bold text-[#607A96] uppercase">Current Shift</span>
                <p className="text-xs font-bold text-[#071A2B]">Assigned Schedule</p>
              </div>
              <div className="border-l border-[#DCE6EF] pl-3">
                <span className="text-[10px] font-bold text-[#16B77A] uppercase">Requested Target Shift</span>
                <p className="text-xs font-bold text-[#071A2B]">{getShiftName(selectedChangeDetail.toShiftId)}</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#071A2B] mb-1">Worker Reason</label>
              <p className="text-xs text-[#071A2B] bg-[#F5F8FB] p-3 rounded-xl border border-[#DCE6EF] italic">
                &quot;{selectedChangeDetail.reason}&quot;
              </p>
            </div>

            <div className="pt-3 flex justify-end gap-2 border-t border-[#DCE6EF]">
              <SmartButton
                onClick={() => rejectChange.mutate(selectedChangeDetail.id)}
                disabled={rejectChange.isPending || approveChange.isPending}
                variant="destructive"
              >
                Reject Request
              </SmartButton>
              <SmartButton
                onClick={() => approveChange.mutate(selectedChangeDetail.id)}
                disabled={approveChange.isPending || rejectChange.isPending}
                variant="success"
              >
                Approve Shift Change
              </SmartButton>
            </div>
          </div>
        </Modal>
      )}

      {selectedSwapDetail && (
        <Modal
          isOpen={true}
          onClose={() => setSelectedSwapDetail(null)}
          title="Shift Swap Details"
          subtitle="Inspect full coworker-accepted swap details before approval"
        >
          <div className="space-y-4">
            <div className="p-3.5 bg-[#ECFDF5] rounded-xl border border-[#A7F3D0] space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-[#047857]">Coworker Accepted</span>
                <StatusBadge status={selectedSwapDetail.status} />
              </div>
              <p className="text-xs text-[#047857]">
                Target coworker accepted this request on {formatDateTime(selectedSwapDetail.coworkerConfirmedAt || '')}.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 p-3.5 bg-[#F5F8FB] rounded-xl border border-[#DCE6EF]">
              <div>
                <span className="text-[10px] font-bold text-[#607A96] uppercase">Requester</span>
                <p className="text-xs font-bold text-[#071A2B]">{getWorkerName(selectedSwapDetail.requesterWorkerId)}</p>
                <p className="text-[11px] text-[#607A96] font-mono">{getShiftName(selectedSwapDetail.requesterShiftId)}</p>
              </div>
              <div className="border-l border-[#DCE6EF] pl-3">
                <span className="text-[10px] font-bold text-[#607A96] uppercase">Target Coworker</span>
                <p className="text-xs font-bold text-[#071A2B]">{getWorkerName(selectedSwapDetail.coworkerWorkerId)}</p>
                <p className="text-[11px] text-[#607A96] font-mono">{getShiftName(selectedSwapDetail.coworkerShiftId)}</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#071A2B] mb-1">Reason for Swap</label>
              <p className="text-xs text-[#071A2B] bg-[#F5F8FB] p-3 rounded-xl border border-[#DCE6EF] italic">
                &quot;{selectedSwapDetail.reason}&quot;
              </p>
            </div>

            <div className="pt-3 flex justify-end gap-2 border-t border-[#DCE6EF]">
              <SmartButton
                onClick={() => rejectSwap.mutate(selectedSwapDetail.id)}
                disabled={rejectSwap.isPending || approveSwap.isPending}
                variant="destructive"
              >
                Reject Swap
              </SmartButton>
              <SmartButton
                onClick={() => approveSwap.mutate(selectedSwapDetail.id)}
                disabled={approveSwap.isPending || rejectSwap.isPending}
                variant="success"
              >
                Approve Shift Swap
              </SmartButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
