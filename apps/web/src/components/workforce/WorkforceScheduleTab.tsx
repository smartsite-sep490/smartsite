import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient, WorkerScheduleResponse } from '@smartsite/api-client';
import { SmartCard, SmartButton, Modal, StatusBadge, LabelBadge, formatShiftTime, formatDateTime } from './WorkforceSharedUI';
import { SmartSelect } from '../ui/SmartFormControls';
import { IconCalendar, IconArrowRight, IconUser, IconClock, IconAlertCircle, IconCheckCircle2 } from '../icons';

export function WorkforceScheduleTab({ apiUrl, siteId, token }: { apiUrl: string; siteId: string; token: string }) {
  const queryClient = useQueryClient();
  const client = new SmartSiteManagementClient(apiUrl);

  const [selectedSchedule, setSelectedSchedule] = useState<WorkerScheduleResponse | null>(null);
  const [modalType, setModalType] = useState<'swap' | 'change' | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'CHANGE' | 'SWAP' | 'PENDING' | 'COMPLETED'>('ALL');
  const [weekOffset, setWeekOffset] = useState<number>(0);
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null);
  const [changeTargetId, setChangeTargetId] = useState<string>('');
  const [swapTargetId, setSwapTargetId] = useState<string>('');

  // 1. Primary Queries
  const { data: schedules, isLoading: schedLoading, isError: schedError, refetch: refetchSchedules } = useQuery({
    queryKey: ['worker-schedules', siteId],
    queryFn: () => client.listWorkerSchedules(token, siteId, { limit: 100 }),
  });

  const { data: shifts } = useQuery({
    queryKey: ['shifts', siteId],
    queryFn: () => client.listShifts(token, siteId, { limit: 100 }),
  });

  const { data: workers } = useQuery({
    queryKey: ['workers', siteId],
    queryFn: () => client.listWorkers(token, siteId, { limit: 100 }),
  });

  const { data: coworkers } = useQuery({
    queryKey: ['coworkers', siteId],
    queryFn: () => client.listCoworkers(token, siteId, { limit: 100 }),
  });

  const { data: swapRequests, isLoading: swapsLoading } = useQuery({
    queryKey: ['swap-requests', siteId],
    queryFn: () => client.listShiftSwapRequests(token, siteId, { limit: 100 }),
  });

  const { data: changeRequests, isLoading: changesLoading } = useQuery({
    queryKey: ['shift-change-requests', siteId],
    queryFn: () => client.listShiftChangeRequests(token, siteId, { limit: 100 }),
  });

  // 2. Discovery queries when schedule is selected for Change/Swap
  const { data: eligibleShifts, isLoading: eligibleLoading } = useQuery({
    queryKey: ['eligible-shifts', siteId, selectedSchedule?.id],
    queryFn: () => client.listEligibleShifts(token, siteId, selectedSchedule!.id),
    enabled: !!selectedSchedule?.id && modalType === 'change',
  });

  const { data: swapCandidates, isLoading: candidatesLoading } = useQuery({
    queryKey: ['swap-candidates', siteId, selectedSchedule?.id],
    queryFn: () => client.listSwapCandidates(token, siteId, selectedSchedule!.id),
    enabled: !!selectedSchedule?.id && modalType === 'swap',
  });

  // 3. Mutations
  const createSwap = useMutation({
    mutationFn: (data: { requesterWorkerScheduleId: string; coworkerWorkerScheduleId: string; reason: string }) =>
      client.createShiftSwapRequest(token, siteId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['worker-schedules', siteId] });
      queryClient.invalidateQueries({ queryKey: ['swap-requests', siteId] });
      queryClient.invalidateQueries({ queryKey: ['swap', siteId] });
      setModalType(null);
    },
  });

  const createChange = useMutation({
    mutationFn: (data: { workerScheduleId: string; toShiftId: string; reason: string }) =>
      client.createShiftChangeRequest(token, siteId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['worker-schedules', siteId] });
      queryClient.invalidateQueries({ queryKey: ['shift-change-requests', siteId] });
      queryClient.invalidateQueries({ queryKey: ['change', siteId] });
      setModalType(null);
    },
  });

  const confirmSwap = useMutation({
    mutationFn: (requestId: string) => client.confirmShiftSwapRequest(token, siteId, requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['swap-requests', siteId] });
      queryClient.invalidateQueries({ queryKey: ['swap', siteId] });
      queryClient.invalidateQueries({ queryKey: ['worker-schedules', siteId] });
    },
  });

  const rejectSwap = useMutation({
    mutationFn: (requestId: string) => client.rejectShiftSwapRequest(token, siteId, requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['swap-requests', siteId] });
      queryClient.invalidateQueries({ queryKey: ['swap', siteId] });
    },
  });

  const handleOpenModal = (type: 'swap' | 'change', schedule: WorkerScheduleResponse) => {
    setSelectedSchedule(schedule);
    setModalType(type);
    setChangeTargetId('');
    setSwapTargetId('');
  };

  const getWorkerName = React.useCallback((workerId?: string) => {
    if (!workerId) return 'Worker';
    const w =
      workers?.items.find((item) => item.id === workerId || (item as unknown as { userId?: string }).userId === workerId) ||
      coworkers?.items.find((item) => item.id === workerId || (item as unknown as { userId?: string }).userId === workerId);
    if (w?.displayName) return w.displayName;
    const candidate = swapCandidates?.items.find((c) => c.candidateWorkerId === workerId);
    if (candidate?.candidateWorkerDisplayName) return candidate.candidateWorkerDisplayName;
    return `Worker (${workerId.slice(0, 6)})`;
  }, [workers, coworkers, swapCandidates]);

  const getShiftObj = React.useCallback((shiftId?: string) => (shiftId ? shifts?.items.find((item) => item.id === shiftId) : undefined), [shifts]);

  const getShiftName = React.useCallback((shiftId?: string) => {
    if (!shiftId) return 'N/A';
    const s = getShiftObj(shiftId);
    return s ? `${s.name} (${formatShiftTime(s.startsAt)} - ${formatShiftTime(s.endsAt)})` : `Shift (${shiftId.slice(0, 6)})`;
  }, [getShiftObj]);

  const formatShiftSummary = (shiftId?: string) => {
    if (!shiftId) return { name: 'No shift', time: '' };
    const s = getShiftObj(shiftId);
    if (!s) return { name: 'Assigned Shift', time: '' };
    return {
      name: `${s.name} Shift`,
      time: `${formatShiftTime(s.startsAt)} - ${formatShiftTime(s.endsAt)}`,
    };
  };

  // 4. Timetable & Weekly Calendar Calculations
  const weekDays = useMemo(() => {
    const now = new Date();
    // Normalize to current week's Monday
    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek - 1) + weekOffset * 7);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const isoStr = d.toISOString().split('T')[0] || '';
      const todayIso = new Date().toISOString().split('T')[0] || '';
      const isToday = todayIso === isoStr;
      days.push({
        dateObj: d,
        dateStr: isoStr,
        dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
        formattedDate: d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' }),
        isToday,
      });
    }
    return days;
  }, [weekOffset]);

  // Active or selected schedule items mapped by date
  const scheduleByDate = useMemo(() => {
    const map = new Map<string, WorkerScheduleResponse[]>();
    schedules?.items.forEach((s) => {
      const list = map.get(s.workDate) || [];
      list.push(s);
      map.set(s.workDate, list);
    });
    return map;
  }, [schedules]);

  // Current active / today's shift summary
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0] || '', []);
  const todaySchedules = scheduleByDate.get(todayStr) || [];

  const pendingCoworkerSwaps = swapRequests?.items.filter((r) => r.status === 'PENDING_COWORKER') || [];

  const pendingScheduleIds = useMemo(() => {
    const ids = new Set<string>();
    const pendingStatuses = new Set(['PENDING_COWORKER', 'PENDING_MANAGER']);

    changeRequests?.items.forEach((request) => {
      if (pendingStatuses.has(request.status)) ids.add(request.workerScheduleId);
    });
    swapRequests?.items.forEach((request) => {
      if (pendingStatuses.has(request.status)) {
        ids.add(request.requesterWorkerScheduleId);
        ids.add(request.coworkerWorkerScheduleId);
      }
    });
    return ids;
  }, [changeRequests, swapRequests]);

  const pendingRequestsCount =
    (changeRequests?.items.filter((r) => r.status === 'PENDING_MANAGER').length || 0) +
    (swapRequests?.items.filter((r) => r.status === 'PENDING_MANAGER' || r.status === 'PENDING_COWORKER').length || 0);

  // Combined Request History
  const combinedHistory = useMemo(() => {
    const changeList = (changeRequests?.items || []).map((r) => ({
      id: r.id,
      type: 'CHANGE' as const,
      status: r.status,
      createdAt: r.createdAt,
      reason: r.reason,
      details: `Change to ${getShiftName(r.toShiftId)}`,
      toShiftId: r.toShiftId,
    }));

    const swapList = (swapRequests?.items || []).map((r) => ({
      id: r.id,
      type: 'SWAP' as const,
      status: r.status,
      createdAt: r.createdAt,
      reason: r.reason,
      details: `Swap with ${getWorkerName(r.coworkerWorkerId)}`,
      coworkerId: r.coworkerWorkerId,
    }));

    const all = [...changeList, ...swapList].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    if (historyFilter === 'CHANGE') return all.filter((item) => item.type === 'CHANGE');
    if (historyFilter === 'SWAP') return all.filter((item) => item.type === 'SWAP');
    if (historyFilter === 'PENDING') return all.filter((item) => item.status.includes('PENDING'));
    if (historyFilter === 'COMPLETED')
      return all.filter((item) => item.status === 'APPROVED' || item.status === 'APPLIED' || item.status === 'REJECTED');

    return all;
  }, [changeRequests, swapRequests, historyFilter, getShiftName, getWorkerName]);

  // Handle API error formatting helper
  const getErrorMessage = (err: unknown, defaultMsg: string) => {
    const errorObj = err as { status?: number; message?: string; response?: { data?: { message?: string } } };
    if (errorObj?.status === 409) return 'Conflict: This shift schedule is no longer available or already modified.';
    if (errorObj?.status === 403) return 'Forbidden: You do not have permission to request this shift change.';
    if (errorObj?.status === 400) return errorObj?.message || 'Invalid request parameters.';
    return errorObj?.message || defaultMsg;
  };

  return (
    <div className="space-y-8">
      {/* 1. TOP HEADER & WEEKLY TIMETABLE / CALENDAR */}
      <div className="bg-white rounded-2xl border border-[#DCE6EF] p-6 shadow-[0_4px_20px_rgba(7,26,43,0.03)] space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#DCE6EF] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#071A2B] text-white flex items-center justify-center">
                <IconCalendar className="w-4 h-4" />
              </div>
              <h1 className="text-2xl font-black text-[#071A2B] tracking-tight">My Schedule</h1>
            </div>
            <p className="text-xs text-[#607A96] mt-1">
              View your 7-day assigned shifts and submit change or swap requests.
            </p>
          </div>

          {/* Week Selector */}
          <div className="flex items-center gap-2 bg-[#F5F8FB] p-1.5 rounded-xl border border-[#DCE6EF]">
            <button
              onClick={() => setWeekOffset((prev) => prev - 1)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-[#071A2B] hover:bg-white transition-colors cursor-pointer"
            >
              &larr; Prev Week
            </button>
            <button
              onClick={() => {
                setWeekOffset(0);
                setSelectedDateStr(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                weekOffset === 0 ? 'bg-[#071A2B] text-white' : 'text-[#607A96] hover:bg-white'
              }`}
            >
              Current Week
            </button>
            <button
              onClick={() => setWeekOffset((prev) => prev + 1)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-[#071A2B] hover:bg-white transition-colors cursor-pointer"
            >
              Next Week &rarr;
            </button>
          </div>
        </div>

        {/* 7-Day Weekly Timetable Grid */}
        {schedLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="h-32 bg-[#F5F8FB] rounded-xl animate-pulse p-3 border border-[#DCE6EF]" />
            ))}
          </div>
        ) : schedError ? (
          <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-center space-y-3">
            <p className="text-red-700 text-sm font-bold">Could not load worker schedules.</p>
            <SmartButton onClick={() => void refetchSchedules()} variant="destructive">
              Retry
            </SmartButton>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {weekDays.map((day) => {
              const daySchedules = scheduleByDate.get(day.dateStr) || [];
              const isSelected = selectedDateStr === day.dateStr;
              const hasShift = daySchedules.length > 0;

              return (
                <div
                  key={day.dateStr}
                  onClick={() => setSelectedDateStr(selectedDateStr === day.dateStr ? null : day.dateStr)}
                  className={`rounded-xl p-3 border transition-all duration-200 flex flex-col justify-between min-h-[140px] cursor-pointer ${
                    isSelected
                      ? 'border-[#071A2B] bg-[#071A2B] text-white shadow-md ring-2 ring-[#071A2B]/20'
                      : day.isToday
                      ? 'border-[#16B77A] bg-[#ECFDF5]/40 text-[#071A2B]'
                      : 'border-[#DCE6EF] bg-[#F5F8FB]/50 hover:bg-white text-[#071A2B]'
                  }`}
                >
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className={`text-xs font-bold ${isSelected ? 'text-white/80' : 'text-[#607A96]'}`}>
                        {day.dayName}
                      </span>
                      {day.isToday && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isSelected ? 'bg-[#16B77A] text-white' : 'bg-[#16B77A]/20 text-[#16B77A]'}`}>
                          Today
                        </span>
                      )}
                    </div>
                    <p className={`text-sm font-black ${isSelected ? 'text-white' : 'text-[#071A2B]'}`}>
                      {day.formattedDate}
                    </p>
                  </div>

                  <div className="mt-3 space-y-1.5">
                    {hasShift ? (
                      daySchedules.map((s) => {
                        const shift = shifts?.items.find((item) => item.id === s.shiftId);
                        const isShiftActive = s.isActive;
                        return (
                          <div
                            key={s.id}
                            className={`p-2 rounded-lg text-xs font-medium border ${
                              isSelected
                                ? 'bg-white/15 border-white/20 text-white'
                                : isShiftActive
                                ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]'
                                : 'bg-[#FEF3C7] border-[#FDE68A] text-[#92400E]'
                            }`}
                          >
                            <div className="font-bold truncate">{shift?.name || 'Shift'}</div>
                            <div className="text-[11px] font-mono mt-0.5 opacity-90">
                              {shift ? `${formatShiftTime(shift.startsAt)} - ${formatShiftTime(shift.endsAt)}` : '08:00 - 16:00'}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className={`text-[11px] italic py-2 text-center rounded-lg border border-dashed ${isSelected ? 'border-white/20 text-white/60' : 'border-[#DCE6EF] text-[#607A96]'}`}>
                        No shift
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. SCHEDULE SUMMARY BAR */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Today's Shift */}
        {(() => {
          const todayItem = todaySchedules.length > 0 ? todaySchedules[0] : null;
          const info = formatShiftSummary(todayItem?.shiftId);
          return (
            <div className="bg-white rounded-2xl border border-[#DCE6EF] p-4 shadow-xs flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#ECFDF5] text-[#16B77A] flex items-center justify-center shrink-0">
                <IconClock className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold text-[#607A96] uppercase tracking-wider">Today&apos;s Shift</p>
                <p className="text-sm font-bold text-[#071A2B] truncate">{todayItem ? info.name : 'No shift today'}</p>
                {todayItem && info.time && (
                  <p className="text-[11px] font-mono text-[#16B77A] truncate mt-0.5">{info.time}</p>
                )}
              </div>
            </div>
          );
        })()}

        {/* Next Shift */}
        {(() => {
          const nextItem = schedules?.items && schedules.items.length > 0 ? schedules.items[0] : null;
          const info = formatShiftSummary(nextItem?.shiftId);
          return (
            <div className="bg-white rounded-2xl border border-[#DCE6EF] p-4 shadow-xs flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#F5F8FB] text-[#071A2B] flex items-center justify-center shrink-0">
                <IconCalendar className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold text-[#607A96] uppercase tracking-wider">Next Shift</p>
                <p className="text-sm font-bold text-[#071A2B] truncate">{nextItem ? info.name : 'None scheduled'}</p>
                {nextItem && (
                  <p className="text-[11px] font-mono text-[#607A96] truncate mt-0.5">
                    {nextItem.workDate} {info.time ? `• ${info.time}` : ''}
                  </p>
                )}
              </div>
            </div>
          );
        })()}

        {/* Pending Requests */}
        <div className="bg-white rounded-2xl border border-[#DCE6EF] p-4 shadow-xs flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#FEF3C7] text-[#D97706] flex items-center justify-center shrink-0">
            <IconAlertCircle className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold text-[#607A96] uppercase tracking-wider">Pending Requests</p>
            <p className="text-sm font-bold text-[#071A2B] truncate">{pendingRequestsCount} Pending</p>
            <p className="text-[11px] text-[#607A96] truncate mt-0.5">Awaiting decision</p>
          </div>
        </div>

        {/* Schedule Status */}
        <div className="bg-white rounded-2xl border border-[#DCE6EF] p-4 shadow-xs flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#ECFDF5] text-[#16B77A] flex items-center justify-center shrink-0">
            <IconCheckCircle2 className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold text-[#607A96] uppercase tracking-wider">Schedule Status</p>
            <p className="text-sm font-bold text-[#16B77A] truncate">Active &amp; Compliant</p>
            <p className="text-[11px] text-[#607A96] truncate mt-0.5">All rules verified</p>
          </div>
        </div>
      </div>

      {/* 3. INCOMING SWAP CONFIRMATIONS (COWORKER INBOX) */}
      {pendingCoworkerSwaps.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#F4A62A] animate-ping" />
            <h2 className="text-xl font-bold tracking-tight text-[#071A2B]">
              Incoming Swap Confirmations ({pendingCoworkerSwaps.length})
            </h2>
          </div>
          <div className="grid gap-4">
            {pendingCoworkerSwaps.map((req) => (
              <SmartCard key={req.id} className="bg-[#FFFBEB]/40 border-[#FCD34D]">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={req.status} />
                      <span className="text-xs text-[#607A96]">
                        Requested on {formatDateTime(req.createdAt)}
                      </span>
                    </div>
                    <h3 className="font-bold text-[#071A2B] text-base">
                      Swap Request from {getWorkerName(req.requesterWorkerId)}
                    </h3>
                    <p className="text-xs text-[#607A96]">
                      They want to swap their shift ({getShiftName(req.requesterShiftId)}) with your shift ({getShiftName(req.coworkerShiftId)}).
                    </p>
                    <p className="text-xs text-[#071A2B] italic bg-white p-2 rounded-lg border border-[#DCE6EF]">
                      &quot;{req.reason}&quot;
                    </p>
                  </div>
                  <div className="flex gap-2 w-full md:w-auto shrink-0">
                    <SmartButton
                      onClick={() => rejectSwap.mutate(req.id)}
                      disabled={rejectSwap.isPending || confirmSwap.isPending}
                      variant="destructive"
                    >
                      {rejectSwap.isPending ? 'Rejecting...' : 'Reject'}
                    </SmartButton>
                    <SmartButton
                      onClick={() => confirmSwap.mutate(req.id)}
                      disabled={confirmSwap.isPending || rejectSwap.isPending}
                      variant="success"
                    >
                      {confirmSwap.isPending ? 'Accepting...' : 'Accept Swap'}
                    </SmartButton>
                  </div>
                </div>
                {(confirmSwap.isError || rejectSwap.isError) && (
                  <p className="text-xs text-red-600 mt-2 font-medium">
                    {getErrorMessage(confirmSwap.error || rejectSwap.error, 'Action failed. Please try again.')}
                  </p>
                )}
              </SmartCard>
            ))}
          </div>
        </div>
      )}

      {/* 4. ASSIGNED SHIFTS LIST & ACTION BUTTONS */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#071A2B]">Assigned Schedules & Actions</h2>
            <p className="text-xs text-[#607A96]">Select a shift to request a Direct Change or Coworker Swap.</p>
          </div>
        </div>

        {(!schedules?.items || schedules.items.length === 0) && !schedLoading && (
          <SmartCard>
            <div className="py-10 text-center space-y-2">
              <p className="text-base font-bold text-[#071A2B]">No schedules assigned</p>
              <p className="text-xs text-[#607A96]">You currently have no active shift schedules on this site.</p>
            </div>
          </SmartCard>
        )}

        {(schedules?.items.length ?? 0) > 0 && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {schedules?.items.map((sched) => {
              const shift = getShiftObj(sched.shiftId);
              const workerName = getWorkerName(sched.workerId);
              const hasPendingRequest = pendingScheduleIds.has(sched.id);
              return (
                <SmartCard key={sched.id} className="flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-mono font-bold bg-[#F5F8FB] text-[#071A2B] px-2.5 py-1 rounded-md border border-[#DCE6EF]">
                        {sched.workDate}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          hasPendingRequest
                            ? 'bg-[#FFF7ED] text-[#C2410C]'
                            : sched.isActive
                              ? 'bg-[#ECFDF5] text-[#16B77A]'
                              : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {hasPendingRequest ? 'Request Pending' : sched.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <h3 className="font-bold text-lg text-[#071A2B]">{shift?.name || 'Assigned Shift'}</h3>
                    <p className="text-xs text-[#607A96] mt-0.5 font-medium">{workerName}</p>
                    <p className="text-[#071A2B] text-sm mt-3 mb-4 font-mono font-semibold">
                      {shift ? `${formatShiftTime(shift.startsAt)} - ${formatShiftTime(shift.endsAt)}` : '08:00 - 16:00'}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-3 border-t border-[#DCE6EF]">
                    <SmartButton
                      onClick={() => handleOpenModal('change', sched)}
                      disabled={hasPendingRequest}
                      variant="default"
                    >
                      <IconArrowRight className="w-3.5 h-3.5 mr-2" />
                      {hasPendingRequest ? 'Pending' : 'Change Shift'}
                    </SmartButton>
                    <SmartButton
                      onClick={() => handleOpenModal('swap', sched)}
                      disabled={hasPendingRequest}
                      variant="outline"
                    >
                      <IconUser className="w-3.5 h-3.5 mr-2" />
                      {hasPendingRequest ? 'Pending' : 'Swap Shift'}
                    </SmartButton>
                  </div>
                </SmartCard>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. REQUEST HISTORY & STATUS TIMELINE */}
      <div className="bg-white rounded-2xl border border-[#DCE6EF] p-6 shadow-[0_4px_20px_rgba(7,26,43,0.03)] space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DCE6EF] pb-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#071A2B]">My Request History &amp; Status</h2>
            <p className="text-xs text-[#607A96]">Track your submitted shift change and swap requests.</p>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap gap-1.5 bg-[#F5F8FB] p-1 rounded-xl border border-[#DCE6EF]">
            {(['ALL', 'CHANGE', 'SWAP', 'PENDING', 'COMPLETED'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setHistoryFilter(filter)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer capitalize ${
                  historyFilter === filter ? 'bg-[#071A2B] text-white shadow-xs' : 'text-[#607A96] hover:bg-white'
                }`}
              >
                {filter.toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {(changesLoading || swapsLoading) && (
          <div className="text-xs text-[#607A96] animate-pulse py-4 text-center">Loading request history...</div>
        )}

        {!changesLoading && !swapsLoading && combinedHistory.length === 0 && (
          <div className="py-8 text-center text-xs text-[#607A96]">
            No request history matching the selected filter.
          </div>
        )}

        {combinedHistory.length > 0 && (
          <div className="space-y-3">
            {combinedHistory.map((item) => (
              <div key={item.id} className="p-4 rounded-xl border border-[#DCE6EF] bg-[#F5F8FB]/40 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <LabelBadge>
                      {item.type === 'CHANGE' ? 'Direct Shift Change' : 'Shift Swap'}
                    </LabelBadge>
                    <StatusBadge status={item.status} />
                  </div>
                  <p className="text-sm font-bold text-[#071A2B]">{item.details}</p>
                  <p className="text-xs text-[#607A96]">Reason: &quot;{item.reason}&quot;</p>
                </div>
                <span className="text-xs text-[#607A96] font-mono shrink-0">
                  {formatDateTime(item.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 6. REDESIGNED DIRECT SHIFT CHANGE MODAL */}
      <Modal
        isOpen={modalType === 'change'}
        onClose={() => setModalType(null)}
        title="Request Direct Shift Change"
        subtitle="Request to change your assigned shift date/time"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            createChange.mutate({
              workerScheduleId: selectedSchedule!.id,
              toShiftId: fd.get('toShiftId') as string,
              reason: fd.get('reason') as string,
            });
          }}
          className="space-y-5"
        >
          {/* Side-by-side comparison */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-[#F5F8FB] rounded-xl border border-[#DCE6EF]">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[#607A96] uppercase">Current Schedule</span>
              <p className="text-xs font-bold text-[#071A2B]">{selectedSchedule?.workDate}</p>
              <p className="text-xs text-[#607A96] font-mono">{getShiftName(selectedSchedule?.shiftId || '')}</p>
            </div>
            <div className="space-y-1 border-l border-[#DCE6EF] pl-3">
              <span className="text-[10px] font-bold text-[#16B77A] uppercase">Target Shift</span>
              <p className="text-xs font-bold text-[#071A2B]">Select below</p>
            </div>
          </div>

          {/* Workflow Steps */}
          <div className="p-3 bg-[#F5F8FB] rounded-xl border border-[#DCE6EF] text-[11px] text-[#607A96] space-y-1">
            <p className="font-bold text-[#071A2B]">Workflow Steps:</p>
            <div className="flex items-center gap-1.5 text-[11px] mt-1">
              <span className="px-1.5 py-0.5 bg-[#071A2B] text-white rounded font-bold">1</span> Worker Submit &rarr;
              <span className="px-1.5 py-0.5 bg-[#071A2B] text-white rounded font-bold">2</span> Manager Review &rarr;
              <span className="px-1.5 py-0.5 bg-[#16B77A] text-white rounded font-bold">3</span> Updated
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#071A2B] mb-1">Target Shift</label>
            {eligibleLoading ? (
              <div className="p-3 text-xs text-[#607A96] animate-pulse bg-[#F5F8FB] rounded-xl border border-[#DCE6EF]">
                Loading eligible shifts...
              </div>
            ) : (
              <SmartSelect
                name="toShiftId"
                required
                value={changeTargetId}
                onChange={setChangeTargetId}
                placeholder="-- Select Target Shift --"
                options={(eligibleShifts?.items || shifts?.items || []).map((s) => ({
                  value: s.id,
                  label: `${s.name} (${formatShiftTime(s.startsAt)} - ${formatShiftTime(s.endsAt)})`,
                }))}
              />
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-[#071A2B] mb-1">Reason for Shift Change</label>
            <textarea
              name="reason"
              required
              minLength={5}
              maxLength={1000}
              rows={3}
              placeholder="Explain why you require a shift change..."
              className="w-full border border-[#DCE6EF] rounded-xl px-4 py-3 bg-[#F5F8FB] text-sm text-[#071A2B] outline-none focus:ring-2 focus:ring-[#071A2B]"
            />
            <p className="mt-1 text-[11px] text-[#607A96]">Reason must be at least 5 characters.</p>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <SmartButton type="button" onClick={() => setModalType(null)} variant="secondary">
              Cancel
            </SmartButton>
            <SmartButton type="submit" disabled={createChange.isPending || eligibleLoading} variant="default">
              {createChange.isPending ? 'Submitting...' : 'Submit Change Request'}
            </SmartButton>
          </div>
          {createChange.isError && (
            <p className="text-red-600 text-xs mt-2 font-medium bg-red-50 p-2.5 rounded-xl border border-red-200">
              {getErrorMessage(createChange.error, 'Failed to submit shift change request.')}
            </p>
          )}
        </form>
      </Modal>

      {/* 7. REDESIGNED SHIFT SWAP MODAL */}
      <Modal
        isOpen={modalType === 'swap'}
        onClose={() => setModalType(null)}
        title="Request Shift Swap"
        subtitle="Swap your assigned shift with a coworker"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            createSwap.mutate({
              requesterWorkerScheduleId: selectedSchedule!.id,
              coworkerWorkerScheduleId: fd.get('coworkerWorkerScheduleId') as string,
              reason: fd.get('reason') as string,
            });
          }}
          className="space-y-5"
        >
          {/* Side-by-side comparison */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-[#FEF3C7]/40 rounded-xl border border-[#FDE68A]">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[#92400E] uppercase">Your Schedule</span>
              <p className="text-xs font-bold text-[#071A2B]">{selectedSchedule?.workDate}</p>
              <p className="text-xs text-[#607A96] font-mono">{getShiftName(selectedSchedule?.shiftId || '')}</p>
            </div>
            <div className="space-y-1 border-l border-[#FDE68A] pl-3">
              <span className="text-[10px] font-bold text-[#D97706] uppercase">Target Coworker</span>
              <p className="text-xs font-bold text-[#071A2B]">Select candidate</p>
            </div>
          </div>

          {/* Workflow Steps */}
          <div className="p-3 bg-[#F5F8FB] rounded-xl border border-[#DCE6EF] text-[11px] text-[#607A96] space-y-1">
            <p className="font-bold text-[#071A2B]">Workflow Steps:</p>
            <div className="flex items-center gap-1.5 text-[11px] mt-1 flex-wrap">
              <span className="px-1.5 py-0.5 bg-[#071A2B] text-white rounded font-bold">1</span> Requester Submit &rarr;
              <span className="px-1.5 py-0.5 bg-[#F4A62A] text-white rounded font-bold">2</span> Coworker Confirm &rarr;
              <span className="px-1.5 py-0.5 bg-[#071A2B] text-white rounded font-bold">3</span> Manager Approve &rarr;
              <span className="px-1.5 py-0.5 bg-[#16B77A] text-white rounded font-bold">4</span> Swapped
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#071A2B] mb-1">Target Coworker Schedule</label>
            {candidatesLoading ? (
              <div className="p-3 text-xs text-[#607A96] animate-pulse bg-[#F5F8FB] rounded-xl border border-[#DCE6EF]">
                Loading swap candidates...
              </div>
            ) : (
              <>
                <SmartSelect
                  name="coworkerWorkerScheduleId"
                  required
                  value={swapTargetId}
                  onChange={setSwapTargetId}
                  placeholder="-- Select Target Coworker Schedule --"
                  options={swapCandidates?.items && swapCandidates.items.length > 0
                    ? swapCandidates.items.map((c) => ({
                        value: c.candidateWorkerScheduleId,
                        label: `${c.candidateWorkerDisplayName} (${c.workDate} - ${c.currentShift.name} ${formatShiftTime(c.currentShift.startsAt)}-${formatShiftTime(c.currentShift.endsAt)})`
                      }))
                    : []
                  }
                />
                {!(swapCandidates?.items && swapCandidates.items.length > 0) && (
                  <div className="mt-2 text-xs text-red-600 font-bold p-3 bg-red-50 rounded-xl border border-red-100">
                    No eligible coworker from the same contractor.
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-[#071A2B] mb-1">Reason for Swap</label>
            <textarea
              name="reason"
              required
              minLength={5}
              maxLength={1000}
              rows={3}
              placeholder="State why you wish to swap shifts with this coworker..."
              className="w-full border border-[#DCE6EF] rounded-xl px-4 py-3 bg-[#F5F8FB] text-sm text-[#071A2B] outline-none focus:ring-2 focus:ring-[#071A2B]"
            />
            <p className="mt-1 text-[11px] text-[#607A96]">Reason must be at least 5 characters.</p>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <SmartButton type="button" onClick={() => setModalType(null)} variant="secondary">
              Cancel
            </SmartButton>
            <SmartButton
              type="submit"
              disabled={createSwap.isPending || candidatesLoading || !swapCandidates?.items?.length}
              variant="default"
            >
              {createSwap.isPending ? 'Submitting...' : 'Submit Swap Request'}
            </SmartButton>
          </div>
          {createSwap.isError && (
            <p className="text-red-600 text-xs mt-2 font-medium bg-red-50 p-2.5 rounded-xl border border-red-200">
              {getErrorMessage(createSwap.error, 'Failed to submit shift swap request.')}
            </p>
          )}
        </form>
      </Modal>
    </div>
  );
}
