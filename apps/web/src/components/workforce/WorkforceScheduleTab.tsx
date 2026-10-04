import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  ShiftSwapRequestResponse,
  WorkerScheduleResponse,
} from '@smartsite/api-client';
import {
  formatShiftTime,
  formatDateTime,
  WORKFORCE_POLL_INTERVAL_MS,
} from './WorkforceSharedUI';
import { splitWorkerSwapRequests } from './WorkforceScheduleUtils';
import {
  IconCalendar,
  IconArrowRight,
  IconUser,
  IconClock,
  IconAlertCircle,
  IconCheckCircle2,
  IconLoader,
  IconCheck,
  IconRefreshCw,
  IconUsers,
  IconChevronLeft,
  IconChevronRight,
  IconX,
} from '../icons';
import {
  Button,
  Badge,
  Dialog,
  EmptyState,
  Tabs,
  Card,
  SmartSelect,
  Alert,
  AlertTitle,
  AlertDescription,
} from '../ui';

function localDateIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekRangeFromOffset(offsetWeeks: number = 0) {
  const today = new Date();
  const target = new Date(today);
  target.setDate(today.getDate() + offsetWeeks * 7);
  const monday = new Date(target);
  const day = monday.getDay();
  monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { fromDate: localDateIso(monday), toDate: localDateIso(sunday) };
}


function currentMonthRange() {
  const today = new Date();
  return {
    fromDate: localDateIso(new Date(today.getFullYear(), today.getMonth(), 1)),
    toDate: localDateIso(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
  };
}

function getWeekDays(fromDateIso: string) {
  const [y, m, d] = fromDateIso.split('-').map(Number);
  const start = new Date(y!, m! - 1, d!);

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const shortDayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const days: {
    dateIso: string;
    dayOfWeek: number;
    viName: string;
    shortName: string;
    dayMonth: string;
    fullFormattedDate: string;
  }[] = [];

  for (let i = 0; i < 7; i++) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    const iso = localDateIso(current);
    const dayOfWeek = current.getDay();
    const dayNum = String(current.getDate()).padStart(2, '0');
    const monthNum = String(current.getMonth() + 1).padStart(2, '0');
    days.push({
      dateIso: iso,
      dayOfWeek,
      viName: dayNames[dayOfWeek] || '',
      shortName: shortDayNames[dayOfWeek] || '',
      dayMonth: `${dayNum}/${monthNum}`,
      fullFormattedDate: `${dayNum}/${monthNum}/${current.getFullYear()}`,
    });
  }
  return days;
}

export function WorkforceScheduleTab({
  apiUrl,
  siteId,
  token,
  currentUserId,
}: {
  apiUrl: string;
  siteId: string;
  token: string;
  currentUserId: string;
}) {
  const queryClient = useQueryClient();
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);

  const [selectedSchedule, setSelectedSchedule] = useState<WorkerScheduleResponse | null>(null);
  const [modalType, setModalType] = useState<'swap' | 'change' | null>(null);
  const [activeView, setActiveView] = useState<'schedule' | 'requests' | 'coworker'>('schedule');
  const [scheduleViewMode, setScheduleViewMode] = useState<'timetable' | 'list'>('timetable');
  const [changeTargetShiftId, setChangeTargetShiftId] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [swapTargetScheduleId, setSwapTargetScheduleId] = useState('');
  const [swapReason, setSwapReason] = useState('');
  const [declineTarget, setDeclineTarget] = useState<ShiftSwapRequestResponse | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const todayIso = useMemo(() => localDateIso(new Date()), []);
  const [weekOffset, setWeekOffset] = useState(0);
  const [scheduleRange, setScheduleRange] = useState<'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM'>('WEEK');
  const [scheduleFromDate, setScheduleFromDate] = useState(todayIso);
  const [scheduleToDate, setScheduleToDate] = useState(todayIso);
  const [schedulePage, setSchedulePage] = useState(0);
  const [collapsedScheduleDates, setCollapsedScheduleDates] = useState<Set<string>>(new Set());

  const activeWeekRange = useMemo(() => getWeekRangeFromOffset(weekOffset), [weekOffset]);
  const activeWeekDays = useMemo(() => getWeekDays(activeWeekRange.fromDate), [activeWeekRange.fromDate]);

  const scheduleDateRange = useMemo(() => {
    if (scheduleRange === 'TODAY') {
      const today = localDateIso(new Date());
      return { fromDate: today, toDate: today };
    }
    if (scheduleRange === 'WEEK') {
      return activeWeekRange;
    }
    if (scheduleRange === 'MONTH') return currentMonthRange();
    if (scheduleRange === 'CUSTOM') {
      return {
        fromDate: scheduleFromDate || undefined,
        toDate: scheduleToDate || undefined,
      };
    }
    return activeWeekRange;
  }, [activeWeekRange, scheduleFromDate, scheduleRange, scheduleToDate]);

  // 1. Primary Queries
  const {
    data: schedules,
    isLoading: schedLoading,
    isError: schedError,
    refetch: refetchSchedules,
  } = useQuery({
    queryKey: [
      'worker-schedules',
      siteId,
      scheduleDateRange.fromDate,
      scheduleDateRange.toDate,
      schedulePage,
    ],
    queryFn: () =>
      client.listWorkerSchedules(token, siteId, {
        offset: schedulePage * 25,
        limit: 25,
        fromDate: scheduleDateRange.fromDate,
        toDate: scheduleDateRange.toDate,
      }),
    refetchInterval: WORKFORCE_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const { data: shifts } = useQuery({
    queryKey: ['shifts', siteId],
    queryFn: () => client.listShifts(token, siteId, { limit: 25 }),
  });

  const { data: workers } = useQuery({
    queryKey: ['workers', siteId],
    queryFn: () => client.listWorkers(token, siteId, { limit: 25 }),
  });

  const { data: coworkers } = useQuery({
    queryKey: ['coworkers', siteId],
    queryFn: () => client.listCoworkers(token, siteId, { limit: 25 }),
  });

  const { data: swapRequests } = useQuery({
    queryKey: ['swap-requests', siteId],
    queryFn: () => client.listShiftSwapRequests(token, siteId, { limit: 25 }),
    refetchInterval: WORKFORCE_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const { data: changeRequests } = useQuery({
    queryKey: ['shift-change-requests', siteId],
    queryFn: () => client.listShiftChangeRequests(token, siteId, { limit: 25 }),
    refetchInterval: WORKFORCE_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // 2. Discovery queries when schedule is selected for Change/Swap
  const { data: eligibleShifts } = useQuery({
    queryKey: ['eligible-shifts', siteId, selectedSchedule?.id],
    queryFn: () => client.listEligibleShifts(token, siteId, selectedSchedule!.id),
    enabled: !!selectedSchedule?.id && modalType === 'change',
  });

  const { data: swapCandidates } = useQuery({
    queryKey: ['swap-candidates', siteId, selectedSchedule?.id],
    queryFn: () => client.listSwapCandidates(token, siteId, selectedSchedule!.id),
    enabled: !!selectedSchedule?.id && modalType === 'swap',
  });

  // 3. Mutations
  const createSwap = useMutation({
    mutationFn: (data: {
      requesterWorkerScheduleId: string;
      coworkerWorkerScheduleId: string;
      reason: string;
    }) => client.createShiftSwapRequest(token, siteId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['worker-schedules', siteId] });
      queryClient.invalidateQueries({ queryKey: ['swap-requests', siteId] });
      setModalType(null);
      setSelectedSchedule(null);
      setSwapReason('');
      setSwapTargetScheduleId('');
    },
  });

  const createChange = useMutation({
    mutationFn: (data: { workerScheduleId: string; toShiftId: string; reason: string }) =>
      client.createShiftChangeRequest(token, siteId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['worker-schedules', siteId] });
      queryClient.invalidateQueries({ queryKey: ['shift-change-requests', siteId] });
      setModalType(null);
      setSelectedSchedule(null);
      setChangeReason('');
      setChangeTargetShiftId('');
    },
  });

  const confirmCoworkerSwap = useMutation({
    mutationFn: (id: string) => client.confirmShiftSwapRequest(token, siteId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['swap-requests', siteId] });
      queryClient.invalidateQueries({ queryKey: ['worker-schedules', siteId] });
    },
  });

  const declineCoworkerSwap = useMutation({
    mutationFn: (input: { requestId: string; reason: string }) =>
      client.declineShiftSwapRequest(token, siteId, input.requestId, { reason: input.reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['swap-requests', siteId] });
      queryClient.invalidateQueries({ queryKey: ['worker-schedules', siteId] });
      setDeclineTarget(null);
      setDeclineReason('');
    },
  });

  // Helper resolvers
  const getWorkerName = (id?: string) => {
    if (!id) return 'Worker';
    const w =
      workers?.items.find((item) => item.id === id) ||
      coworkers?.items.find((item) => item.id === id);
    return w?.displayName || `Worker (${id.slice(0, 6)})`;
  };

  const getShiftObj = (id: string) => shifts?.items.find((item) => item.id === id);
  const getShiftName = (id: string) => {
    const s = getShiftObj(id);
    return s
      ? `${s.name} (${formatShiftTime(s.startsAt)} - ${formatShiftTime(s.endsAt)})`
      : `Shift (${id.slice(0, 6)})`;
  };

  const scheduleList = useMemo(() => schedules?.items || [], [schedules?.items]);
  const scheduleTotal = schedules?.total ?? 0;
  const schedulePageCount = Math.max(1, Math.ceil(scheduleTotal / 25));
  const groupedScheduleList = useMemo(() => {
    const groups = new Map<string, WorkerScheduleResponse[]>();
    for (const schedule of scheduleList) {
      const group = groups.get(schedule.workDate) ?? [];
      group.push(schedule);
      groups.set(schedule.workDate, group);
    }
    return Array.from(groups.entries());
  }, [scheduleList]);
  const resetSchedulePage = () => setSchedulePage(0);
  const currentWorkerId = useMemo(
    () => workers?.items.find((worker) => worker.userId === currentUserId)?.id ?? null,
    [workers?.items, currentUserId],
  );
  const myChanges = useMemo(
    () =>
      currentWorkerId
        ? (changeRequests?.items ?? []).filter((request) => request.workerId === currentWorkerId)
        : [],
    [changeRequests, currentWorkerId],
  );
  const { myRequests: mySwaps, incomingRequests: coworkerPendingSwaps, relatedPendingRequests } =
    useMemo(
      () => splitWorkerSwapRequests(swapRequests?.items ?? [], currentWorkerId),
      [swapRequests, currentWorkerId],
    );

  const allMyRequests = useMemo(() => {
    const changes = myChanges.map((c) => ({ ...c, requestType: 'CHANGE' as const }));
    const swaps = mySwaps.map((s) => ({ ...s, requestType: 'SWAP' as const }));
    return [...changes, ...swaps].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [myChanges, mySwaps]);

  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('smartsite_dismissed_schedule_notifs');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const dismissNotification = (id: string) => {
    setDismissedNotificationIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem('smartsite_dismissed_schedule_notifs', JSON.stringify(Array.from(next)));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  const latestDecidedRequest = useMemo(() => {
    return (
      allMyRequests.find(
        (req) =>
          (req.status === 'APPROVED' ||
            req.status === 'APPLIED' ||
            req.status === 'REJECTED' ||
            req.status === 'CONFLICTED') &&
          !dismissedNotificationIds.has(req.id),
      ) ?? null
    );
  }, [allMyRequests, dismissedNotificationIds]);
  const pendingScheduleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const request of myChanges) {
      if (request.status === 'PENDING_MANAGER') ids.add(request.workerScheduleId);
    }
    for (const request of relatedPendingRequests) {
      if (request.status === 'PENDING_COWORKER' || request.status === 'PENDING_MANAGER') {
        ids.add(request.requesterWorkerScheduleId);
        ids.add(request.coworkerWorkerScheduleId);
      }
    }
    return ids;
  }, [myChanges, relatedPendingRequests]);

  const openChangeModal = (sched: WorkerScheduleResponse) => {
    if (sched.workDate < todayIso) return;
    setSelectedSchedule(sched);
    setChangeReason('');
    setChangeTargetShiftId('');
    setModalType('change');
  };

  const openSwapModal = (sched: WorkerScheduleResponse) => {
    if (sched.workDate < todayIso) return;
    setSelectedSchedule(sched);
    setSwapReason('');
    setSwapTargetScheduleId('');
    setModalType('swap');
  };

  const closeModal = () => {
    setModalType(null);
    setSelectedSchedule(null);
    setChangeReason('');
    setSwapReason('');
    createChange.reset();
    createSwap.reset();
  };

  const closeDeclineModal = () => {
    setDeclineTarget(null);
    setDeclineReason('');
    declineCoworkerSwap.reset();
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (schedLoading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2 shadow-xs">
        <IconLoader className="w-5 h-5 animate-spin text-slate-500" />
        <span>Loading your schedule data...</span>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (schedError) {
    return (
      <div className="max-w-md mx-auto mt-20 p-8 rounded-2xl bg-white border border-rose-200 text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
          <IconAlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">Failed to Load Schedule</h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          An error occurred while loading your schedule and requests.
        </p>
        <Button variant="default" size="md" onClick={() => void refetchSchedules()}>
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
            <IconCalendar className="w-5 h-5 text-[#F66B17]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Workforce Portal
              </span>
              <span className="text-slate-300">•</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                My Assignments
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[#071A2B]">
              My Schedule &amp; Requests
            </h1>
          </div>
        </div>

        <Button
          variant="outline"
          size="md"
          onClick={() => void refetchSchedules()}
          leftIcon={<IconRefreshCw className="w-3.5 h-3.5 text-slate-500" />}
        >
          Refresh
        </Button>
      </div>

      {/* 2. Quick Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Assigned Shifts</span>
            <p className="text-2xl font-black tracking-tight text-[#071A2B]">{scheduleList.length}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600">
            <IconClock className="w-5 h-5 text-[#F66B17]" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">My Requests</span>
            <p className="text-2xl font-black tracking-tight text-[#071A2B]">
              {myChanges.length + mySwaps.length}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600">
            <IconArrowRight className="w-5 h-5 text-blue-600" />
          </div>
        </div>

        <div
          onClick={() => setActiveView('coworker')}
          className={`border rounded-xl p-4 shadow-xs flex items-center justify-between transition-all cursor-pointer ${
            coworkerPendingSwaps.length > 0
              ? 'bg-amber-50/50 border-amber-300 ring-2 ring-amber-400/20 hover:bg-amber-50 hover:border-amber-400'
              : 'bg-white border-slate-200/90 hover:border-slate-300'
          }`}
        >
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Coworker Swap Requests</span>
              {coworkerPendingSwaps.length > 0 && (
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              )}
            </div>
            <p className="text-2xl font-black tracking-tight text-amber-600">
              {coworkerPendingSwaps.length}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600">
            <IconUser className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* ── WORKFORCE ACTIVITY NOTIFICATIONS ─────────────────────────────── */}
      {(coworkerPendingSwaps.length > 0 || latestDecidedRequest !== null) && (
        <div className="space-y-3">
          {/* 1. Pending Incoming Coworker Swap Requests */}
          {coworkerPendingSwaps.length > 0 && (
            <Alert variant="warning" className="animate-in slide-in-from-top-2 fade-in duration-200">
              <IconUser className="w-5 h-5" />
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <AlertTitle className="text-amber-950 font-bold flex items-center gap-2 text-xs">
                    <span>Action Required · Coworker Shift Swap</span>
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  </AlertTitle>
                  <AlertDescription className="text-amber-900/90 font-medium text-xs">
                    {coworkerPendingSwaps.length === 1 ? (
                      <>
                        <span className="font-semibold text-slate-950">
                          {getWorkerName(coworkerPendingSwaps[0]!.requesterWorkerId)}
                        </span>{' '}
                        wants to swap with your shift ({getShiftName(coworkerPendingSwaps[0]!.coworkerShiftId)}).
                      </>
                    ) : (
                      <>
                        You have <span className="font-semibold text-slate-950">{coworkerPendingSwaps.length} shift swap requests</span> from coworkers waiting for your confirmation.
                      </>
                    )}
                  </AlertDescription>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setActiveView('coworker')}
                    rightIcon={<IconArrowRight className="w-3.5 h-3.5 text-[#F66B17]" />}
                    className="bg-[#071A2B] text-white hover:bg-[#0E2841] shadow-xs text-xs"
                  >
                    Review ({coworkerPendingSwaps.length})
                  </Button>
                </div>
              </div>
            </Alert>
          )}

          {/* 2. Latest Decided Shift Change / Swap Request (Approved or Rejected by Contractor) */}
          {latestDecidedRequest && (() => {
            const req = latestDecidedRequest;
            const isApproved = req.status === 'APPROVED' || req.status === 'APPLIED';
            const isChange = req.requestType === 'CHANGE';
            const shiftName = isChange ? getShiftName((req as { toShiftId: string }).toShiftId) : undefined;
            const swapReq = !isChange ? (req as { coworkerWorkerId: string; requesterWorkerId: string }) : null;
            const coworkerName = swapReq
              ? getWorkerName(swapReq.coworkerWorkerId === currentWorkerId ? swapReq.requesterWorkerId : swapReq.coworkerWorkerId)
              : undefined;
            const reviewReason = (req as { reviewReason?: string | null }).reviewReason;

            return (
              <Alert
                key={req.id}
                variant={isApproved ? 'success' : 'destructive'}
                className="animate-in slide-in-from-top-2 fade-in duration-200"
              >
                {isApproved ? (
                  <IconCheck className="w-5 h-5" />
                ) : (
                  <IconAlertCircle className="w-5 h-5" />
                )}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <AlertTitle
                      className={`font-bold flex items-center gap-2 text-xs ${
                        isApproved ? 'text-emerald-950' : 'text-rose-950'
                      }`}
                    >
                      <span>
                        {isApproved
                          ? isChange
                            ? 'Shift Change Approved'
                            : 'Shift Swap Approved'
                          : isChange
                          ? 'Shift Change Rejected'
                          : 'Shift Swap Declined'}
                      </span>
                      <span className={`w-2 h-2 rounded-full ${isApproved ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    </AlertTitle>
                    <AlertDescription className="text-xs text-slate-700 font-medium">
                      {isApproved ? (
                        isChange ? (
                          <>
                            Your shift change request to <span className="font-bold text-[#071A2B]">{shiftName}</span> has been <span className="font-bold text-emerald-700">approved</span> by the contractor!
                          </>
                        ) : (
                          <>
                            Your shift swap request with <span className="font-bold text-[#071A2B]">{coworkerName}</span> has been <span className="font-bold text-emerald-700">approved</span> by the contractor!
                          </>
                        )
                      ) : (
                        <>
                          Your shift request was not approved.{' '}
                          {reviewReason && (
                            <span className="italic text-slate-600 font-normal">
                              (Reason: &quot;{reviewReason}&quot;)
                            </span>
                          )}
                        </>
                      )}
                    </AlertDescription>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => {
                        if (isApproved) setActiveView('schedule');
                        else setActiveView('requests');
                      }}
                      rightIcon={<IconArrowRight className="w-3.5 h-3.5 text-[#F66B17]" />}
                      className="bg-[#071A2B] text-white hover:bg-[#0E2841] shadow-xs text-xs font-semibold"
                    >
                      {isApproved ? 'View Timetable' : 'View Requests'}
                    </Button>
                    <button
                      type="button"
                      onClick={() => dismissNotification(req.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                      aria-label="Dismiss notification"
                      title="Dismiss notification"
                    >
                      <IconX className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </Alert>
            );
          })()}
        </div>
      )}


      {/* 3. Sub-Tabs */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-xs flex items-center justify-between">
        <Tabs
          items={[
            {
              id: 'schedule' as const,
              label: 'My Shifts',
              count: scheduleList.length,
              icon: <IconClock className="w-3.5 h-3.5 text-[#F66B17]" />,
            },
            {
              id: 'requests' as const,
              label: 'My Change/Swap Requests',
              count: myChanges.length + mySwaps.length,
              icon: <IconArrowRight className="w-3.5 h-3.5 text-blue-600" />,
            },
            {
              id: 'coworker' as const,
              label: 'Coworker Swaps',
              count: coworkerPendingSwaps.length,
              icon: <IconUser className="w-3.5 h-3.5 text-emerald-600" />,
            },
          ]}
          activeTab={activeView}
          onChange={(tab) => setActiveView(tab)}
        />
      </div>

      {/* ── TAB 1: SCHEDULE VIEW (TIMETABLE & LIST) ─────────────────────────── */}
      {activeView === 'schedule' && (
        <div className="space-y-4">
          {/* Controls Bar: Range Selector & View Toggle */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex flex-wrap items-center gap-2">
                {([
                  ['WEEK', 'This week'],
                  ['TODAY', 'Today'],
                  ['MONTH', 'This month'],
                  ['CUSTOM', 'Custom range'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setScheduleRange(value);
                      if (value === 'WEEK') setWeekOffset(0);
                      resetSchedulePage();
                    }}
                    className={`rounded-xl border px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                      scheduleRange === value
                        ? 'border-[#071A2B] bg-[#071A2B] text-white shadow-xs'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* View Mode Switcher (Timetable vs List) */}
              <div className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/70">
                <button
                  type="button"
                  onClick={() => setScheduleViewMode('timetable')}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    scheduleViewMode === 'timetable'
                      ? 'bg-white text-[#071A2B] shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <IconCalendar className="w-3.5 h-3.5 text-[#F66B17]" />
                  <span>Timetable</span>
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleViewMode('list')}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    scheduleViewMode === 'list'
                      ? 'bg-white text-[#071A2B] shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <IconClock className="w-3.5 h-3.5 text-slate-500" />
                  <span>List</span>
                </button>
              </div>
            </div>

            {/* Week Navigation Header */}
            {scheduleRange === 'WEEK' && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-800">
                    Week: {activeWeekDays[0]?.fullFormattedDate} - {activeWeekDays[6]?.fullFormattedDate}
                  </span>
                  {weekOffset === 0 && (
                    <Badge variant="default" dot>CURRENT WEEK</Badge>
                  )}
                  {weekOffset < 0 && (
                    <Badge variant="neutral">PAST ({Math.abs(weekOffset)} wks ago)</Badge>
                  )}
                  {weekOffset > 0 && (
                    <Badge variant="success">FUTURE (+{weekOffset} wks)</Badge>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setWeekOffset((prev) => prev - 1)}
                    leftIcon={<IconChevronLeft className="w-3.5 h-3.5 text-slate-600" />}
                  >
                    Previous week
                  </Button>
                  {weekOffset !== 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setWeekOffset(0)}
                    >
                      Current week
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setWeekOffset((prev) => prev + 1)}
                    rightIcon={<IconChevronRight className="w-3.5 h-3.5 text-slate-600" />}
                  >
                    Next week
                  </Button>
                </div>
              </div>
            )}

            {scheduleRange === 'CUSTOM' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  From
                  <input
                    type="date"
                    value={scheduleFromDate}
                    onChange={(event) => {
                      setScheduleFromDate(event.target.value);
                      resetSchedulePage();
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-800 outline-none focus:border-[#F66B17]"
                  />
                </label>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  To
                  <input
                    type="date"
                    value={scheduleToDate}
                    onChange={(event) => {
                      setScheduleToDate(event.target.value);
                      resetSchedulePage();
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-800 outline-none focus:border-[#F66B17]"
                  />
                </label>
              </div>
            )}
          </div>

          {/* ── VIEW OPTION A: TIMETABLE GRID ──────────────────────────────── */}
          {scheduleViewMode === 'timetable' && scheduleRange === 'WEEK' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 items-stretch">
              {activeWeekDays.map((day) => {
                const isToday = day.dateIso === todayIso;
                const isPast = day.dateIso < todayIso;
                const daySchedules = scheduleList.filter((s) => s.workDate === day.dateIso);

                return (
                  <div
                    key={day.dateIso}
                    className={`flex flex-col rounded-2xl border transition-all duration-200 ${
                      isToday
                        ? 'border-[#071A2B] ring-2 ring-[#071A2B]/10 shadow-md bg-white'
                        : isPast
                        ? 'border-slate-200/70 bg-slate-50/40 opacity-90'
                        : 'border-slate-200/90 bg-white shadow-xs'
                    }`}
                  >
                    {/* Day Column Header */}
                    <div
                      className={`px-3 py-2.5 rounded-t-2xl flex items-center justify-between border-b ${
                        isToday
                          ? 'bg-[#071A2B] text-white border-[#071A2B]'
                          : isPast
                          ? 'bg-slate-100/90 text-slate-600 border-slate-200/70'
                          : 'bg-slate-50/90 text-slate-800 border-slate-100'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-bold ${isToday ? 'text-white' : 'text-slate-900'}`}>
                            {day.viName}
                          </span>
                        </div>
                        <span className={`text-[11px] font-mono ${isToday ? 'text-slate-300' : 'text-slate-500'}`}>
                          {day.dayMonth}
                        </span>
                      </div>

                      {isToday && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#F66B17] text-white tracking-wider uppercase">
                          Today
                        </span>
                      )}
                      {isPast && !isToday && (
                        <span className="text-[10px] font-medium text-slate-400">
                          Past
                        </span>
                      )}
                    </div>

                    {/* Day Column Body */}
                    <div className="p-2 flex-1 flex flex-col justify-between space-y-2 min-h-[160px]">
                      {daySchedules.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center p-3 text-center rounded-xl border border-dashed border-slate-200/80 bg-slate-50/50">
                          <span className="text-xs font-semibold text-slate-400">Off Day</span>
                          <span className="text-[10px] text-slate-400">No shift scheduled</span>
                        </div>
                      ) : (
                        <div className="space-y-2 flex-1 flex flex-col">
                          {daySchedules.map((sched) => {
                            const shiftObj = getShiftObj(sched.shiftId);
                            const hasPendingRequest = pendingScheduleIds.has(sched.id);

                            return (
                              <div
                                key={sched.id}
                                className={`p-2.5 rounded-xl border space-y-2 flex-1 flex flex-col justify-between transition-all ${
                                  isPast
                                    ? 'bg-slate-50 border-slate-200/70 text-slate-500'
                                    : 'bg-white border-slate-200/90 shadow-xs hover:border-slate-300'
                                }`}
                              >
                                <div className="space-y-1.5">
                                  {/* Shift Header & Status Badge */}
                                  <div className="flex items-center justify-between gap-1">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span className={`w-2 h-2 rounded-full shrink-0 ${isPast ? 'bg-slate-400' : 'bg-[#F66B17]'}`} />
                                      <h4 className="text-xs font-bold text-slate-900 truncate" title={shiftObj?.name}>
                                        {shiftObj?.name || 'Shift'}
                                      </h4>
                                    </div>
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-tight uppercase shrink-0 ${
                                        isPast
                                          ? 'bg-slate-100 text-slate-500 border border-slate-200/60'
                                          : hasPendingRequest
                                          ? 'bg-amber-50 text-amber-700 border border-amber-200/60'
                                          : isToday
                                          ? 'bg-blue-50 text-blue-700 border border-blue-200/60'
                                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                                      }`}
                                    >
                                      {isPast
                                        ? 'PAST'
                                        : hasPendingRequest
                                        ? 'PENDING'
                                        : 'SCHEDULED'}
                                    </span>
                                  </div>

                                  {/* Shift Time Badge */}
                                  {shiftObj && (
                                    <div className="p-1.5 rounded-lg bg-slate-50 border border-slate-100 font-mono text-[10px] text-slate-700 flex items-center gap-1">
                                      <IconClock className="w-3 h-3 text-slate-400 shrink-0" />
                                      <span className="truncate">
                                        {formatShiftTime(shiftObj.startsAt)} - {formatShiftTime(shiftObj.endsAt)}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                {/* Action Buttons or Past Status */}
                                <div className="pt-2 border-t border-slate-100">
                                  {isPast ? (
                                    <div className="text-[10px] text-slate-400 italic text-center py-1 bg-slate-50/80 rounded-md border border-slate-100">
                                      Past shift (Locked)
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        disabled={hasPendingRequest}
                                        onClick={() => openChangeModal(sched)}
                                        className="flex-1 flex items-center justify-center gap-1 px-1 py-1.5 h-7 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 transition-all cursor-pointer"
                                        title={hasPendingRequest ? 'Request pending approval.' : 'Change shift'}
                                      >
                                        <IconClock className="w-3 h-3 text-blue-600 shrink-0" />
                                        <span>Change</span>
                                      </button>
                                      <button
                                        type="button"
                                        disabled={hasPendingRequest}
                                        onClick={() => openSwapModal(sched)}
                                        className="flex-1 flex items-center justify-center gap-1 px-1 py-1.5 h-7 rounded-lg bg-[#071A2B] text-white text-[11px] font-semibold hover:bg-[#0E2841] disabled:opacity-50 transition-all cursor-pointer shadow-xs"
                                        title={hasPendingRequest ? 'Request pending approval.' : 'Swap with coworker'}
                                      >
                                        <IconUsers className="w-3 h-3 text-[#F66B17] shrink-0" />
                                        <span>Swap</span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── VIEW OPTION B: LIST / CARDS VIEW ────────────────────────────── */
            <div className="space-y-4">
              {scheduleList.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs">
                  <EmptyState
                    icon={<IconCalendar className="w-6 h-6 text-slate-400" />}
                    title="No Shifts Assigned"
                    description="You have no scheduled shifts assigned in this date range."
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  {groupedScheduleList.map(([date, dateSchedules]) => {
                    const collapsed = collapsedScheduleDates.has(date);
                    const isDatePast = date < todayIso;
                    const isDateToday = date === todayIso;

                    return (
                      <section key={date} className="space-y-3">
                        <button
                          type="button"
                          aria-expanded={!collapsed}
                          onClick={() => {
                            setCollapsedScheduleDates((current) => {
                              const next = new Set(current);
                              if (next.has(date)) next.delete(date);
                              else next.add(date);
                              return next;
                            });
                          }}
                          className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left shadow-xs transition-colors cursor-pointer ${
                            isDateToday
                              ? 'border-[#071A2B] bg-[#071A2B] text-white'
                              : isDatePast
                              ? 'border-slate-200 bg-slate-50/80 text-slate-700'
                              : 'border-slate-200 bg-white text-slate-800'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold">
                              {date} · {dateSchedules.length} shift{dateSchedules.length === 1 ? '' : 's'}
                            </span>
                            {isDateToday && <Badge variant="default">Today</Badge>}
                            {isDatePast && <Badge variant="neutral">Past</Badge>}
                          </div>
                          <span className="text-sm font-bold">{collapsed ? '+' : '−'}</span>
                        </button>
                        {!collapsed && (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {dateSchedules.map((sched) => {
                              const shiftObj = getShiftObj(sched.shiftId);
                              const hasPendingRequest = pendingScheduleIds.has(sched.id);
                              const isPast = sched.workDate < todayIso;

                              return (
                                <Card key={sched.id} doubleBezel className="space-y-3.5">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${isPast ? 'bg-slate-400' : 'bg-[#F66B17]'}`} />
                                        <h3 className="text-sm font-bold text-slate-900">
                                          {shiftObj?.name || 'Shift'}
                                        </h3>
                                      </div>
                                    </div>

                                    <Badge
                                      variant={
                                        isPast
                                          ? 'neutral'
                                          : hasPendingRequest
                                          ? 'warning'
                                          : 'success'
                                      }
                                    >
                                      {isPast ? 'PAST' : hasPendingRequest ? 'PENDING REVIEW' : 'SCHEDULED'}
                                    </Badge>
                                  </div>

                                  {shiftObj && (
                                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 font-mono text-xs text-slate-700 flex items-center gap-1.5">
                                      <IconClock className="w-3.5 h-3.5 text-slate-400" />
                                      <span>
                                        {formatShiftTime(shiftObj.startsAt)} - {formatShiftTime(shiftObj.endsAt)}
                                      </span>
                                    </div>
                                  )}

                                  <div className="pt-2.5 border-t border-slate-100">
                                    {isPast ? (
                                      <div className="text-xs text-slate-400 italic text-center py-1.5 bg-slate-50 rounded-lg border border-slate-100">
                                        Past shift (change/swap unavailable)
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-end gap-2.5">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          disabled={hasPendingRequest}
                                          onClick={() => openChangeModal(sched)}
                                          leftIcon={<IconClock className="w-3.5 h-3.5 text-blue-600" />}
                                          className="border-slate-300 text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                                          title={hasPendingRequest ? 'A request for this shift is already pending review.' : undefined}
                                        >
                                          Change Shift
                                        </Button>
                                        <Button
                                          variant="default"
                                          size="sm"
                                          disabled={hasPendingRequest}
                                          onClick={() => openSwapModal(sched)}
                                          leftIcon={<IconUsers className="w-3.5 h-3.5 text-[#F66B17]" />}
                                          className="bg-[#071A2B] text-white hover:bg-[#0E2841] shadow-xs"
                                          title={hasPendingRequest ? 'A request for this shift is already pending review.' : undefined}
                                        >
                                          Swap Shift
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                </Card>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}

                  <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-[11px] text-slate-500">
                    <span>Page {schedulePage + 1} of {schedulePageCount}</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={schedulePage === 0}
                        onClick={() => setSchedulePage((page) => Math.max(0, page - 1))}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-bold disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        disabled={schedulePage + 1 >= schedulePageCount}
                        onClick={() => setSchedulePage((page) => Math.min(schedulePageCount - 1, page + 1))}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-bold disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: MY REQUESTS ─────────────────────────────────────────────── */}
      {activeView === 'requests' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
          {myChanges.length === 0 && mySwaps.length === 0 ? (
            <EmptyState
              icon={<IconArrowRight className="w-6 h-6 text-slate-400" />}
              title="No Requests Filed"
              description="When you request a shift change or coworker swap, tracking status will appear here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Shift Details</th>
                    <th className="py-3 px-4">Reason</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Filed Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {allMyRequests.map((req) => (
                    <tr key={`${req.requestType}-${req.id}`} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-800">
                        {req.requestType === 'CHANGE' ? 'Shift Change' : 'Shift Swap'}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-slate-900">
                        {req.requestType === 'CHANGE' ? (
                          <span className="font-normal text-slate-700">To: {getShiftName(req.toShiftId)}</span>
                        ) : (
                          `Swap with ${getWorkerName(req.coworkerWorkerId)}`
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 italic">
                        <div>{req.reason || 'No reason specified'}</div>
                        {req.reviewReason && (
                          <div className="mt-1 border-t border-slate-200/70 pt-1 text-[11px] not-italic text-rose-700">
                            Review message: {req.reviewReason}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <Badge
                          variant={
                            req.status === 'APPROVED' || req.status === 'APPLIED'
                              ? 'success'
                              : req.status === 'REJECTED'
                              ? 'danger'
                              : 'warning'
                          }
                          dot
                        >
                          {req.status}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                        {formatDateTime(req.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: COWORKER SWAPS ──────────────────────────────────────────── */}
      {activeView === 'coworker' && (
        <div className="space-y-4">
          {coworkerPendingSwaps.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs">
              <EmptyState
                icon={<IconCheckCircle2 className="w-6 h-6 text-emerald-500" />}
                title="No Pending Coworker Swaps"
                description="No coworkers are currently waiting for your confirmation to swap shifts."
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {coworkerPendingSwaps.map((swap) => (
                <Card key={swap.id} doubleBezel className="space-y-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-xs">
                        {getWorkerName(swap.requesterWorkerId).charAt(0)}
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-xs">
                          {getWorkerName(swap.requesterWorkerId)}
                        </h4>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {formatDateTime(swap.createdAt)}
                        </span>
                      </div>
                    </div>

                    <Badge variant="warning" dot>PENDING COWORKER</Badge>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-700 space-y-1">
                    <div>
                      <span className="font-semibold">{getWorkerName(swap.requesterWorkerId)}&apos;s shift:</span> {getShiftName(swap.requesterShiftId)}
                    </div>
                    <div>
                      <span className="font-semibold">Your shift:</span> {getShiftName(swap.coworkerShiftId)}
                    </div>
                    {swap.reason && (
                      <p className="text-[11px] text-slate-500 italic pt-1 border-t border-slate-200/60">
                        &quot;{swap.reason}&quot;
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={confirmCoworkerSwap.isPending || declineCoworkerSwap.isPending}
                      onClick={() => {
                        setDeclineTarget(swap);
                        setDeclineReason('');
                        declineCoworkerSwap.reset();
                      }}
                      className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                    >
                      Decline
                    </Button>

                    <Button
                      variant="default"
                      size="sm"
                      isLoading={confirmCoworkerSwap.isPending}
                      disabled={confirmCoworkerSwap.isPending || declineCoworkerSwap.isPending}
                      onClick={() => confirmCoworkerSwap.mutate(swap.id)}
                      leftIcon={<IconCheck className="w-3.5 h-3.5 text-emerald-400" />}
                    >
                      Accept Swap
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MODAL: Request Shift Change Dialog ──────────────────────────────── */}
      <Dialog
        open={Boolean(declineTarget)}
        onClose={closeDeclineModal}
        title="Decline Shift Swap"
        description="The requester will see your reason in their request history."
        icon={<IconAlertCircle className="w-4 h-4 text-rose-500" />}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!declineTarget || declineReason.trim().length < 5) return;
            declineCoworkerSwap.mutate({
              requestId: declineTarget.id,
              reason: declineReason.trim(),
            });
          }}
          className="space-y-4"
        >
          {declineCoworkerSwap.isError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs">
              <IconAlertCircle className="w-4 h-4 shrink-0" />
              <span>Failed to decline this swap. Please refresh and try again.</span>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-700">
            You are declining the swap request from <span className="font-bold">{declineTarget ? getWorkerName(declineTarget.requesterWorkerId) : 'the requester'}</span>.
          </div>

          <div className="space-y-1.5">
            <label htmlFor="coworker-decline-reason" className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#607A96]">
              Reason for declining <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="coworker-decline-reason"
              rows={4}
              required
              minLength={5}
              maxLength={1000}
              value={declineReason}
              onChange={(event) => setDeclineReason(event.target.value)}
              placeholder="Why can you not accept this swap?"
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#DCE6EF] bg-[#F9FAFC] text-sm font-semibold text-[#071A2B] placeholder-[#94A3B8] outline-none focus:border-[#071A2B] focus:bg-white focus:ring-2 focus:ring-[#071A2B]/8 resize-none"
            />
            <p className="text-[11px] text-slate-500">Reason must be at least 5 characters.</p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button type="button" variant="outline" size="md" onClick={closeDeclineModal}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              size="md"
              disabled={declineReason.trim().length < 5}
              isLoading={declineCoworkerSwap.isPending}
            >
              Decline Swap
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={modalType === 'change'}
        onClose={closeModal}
        title="Request Shift Change"
        description={`Request changing shift on ${selectedSchedule?.workDate}`}
        icon={<IconClock className="w-4 h-4 text-[#F66B17]" />}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!selectedSchedule || !changeTargetShiftId) return;
            createChange.mutate({
              workerScheduleId: selectedSchedule.id,
              toShiftId: changeTargetShiftId,
              reason: changeReason.trim(),
            });
          }}
          className="space-y-4"
        >
          {createChange.isError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs">
              <IconAlertCircle className="w-4 h-4 shrink-0" />
              <span>Failed to submit shift change request.</span>
            </div>
          )}

          <div className="space-y-1">
            <SmartSelect
              label="Target Shift"
              fieldRequired
              value={changeTargetShiftId}
              onChange={setChangeTargetShiftId}
              placeholder="-- Select Target Shift --"
              options={(eligibleShifts?.items || shifts?.items || []).map((s) => ({
                value: s.id,
                label: `${s.name} (${formatShiftTime(s.startsAt)} - ${formatShiftTime(s.endsAt)})`
              }))}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#607A96]">
              Reason <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={3}
              required
              placeholder="Why do you need to change your shift?"
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#DCE6EF] bg-[#F9FAFC] text-sm font-semibold text-[#071A2B] placeholder-[#94A3B8] outline-none transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[#B0C4D8] focus:border-[#071A2B] focus:bg-white focus:ring-2 focus:ring-[#071A2B]/8 shadow-[inset_0_1px_2px_rgba(7,26,43,0.04)] resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="outline" size="md" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="md"
              disabled={!changeTargetShiftId || !changeReason.trim()}
              isLoading={createChange.isPending}
            >
              Submit Change Request
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ── MODAL: Request Shift Swap Dialog ────────────────────────────────── */}
      <Dialog
        open={modalType === 'swap'}
        onClose={closeModal}
        title="Request Shift Swap"
        description={`Swap your shift on ${selectedSchedule?.workDate} with a coworker`}
        icon={<IconUser className="w-4 h-4 text-[#F66B17]" />}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!selectedSchedule || !swapTargetScheduleId) return;
            createSwap.mutate({
              requesterWorkerScheduleId: selectedSchedule.id,
              coworkerWorkerScheduleId: swapTargetScheduleId,
              reason: swapReason.trim(),
            });
          }}
          className="space-y-4"
        >
          {createSwap.isError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs">
              <IconAlertCircle className="w-4 h-4 shrink-0" />
              <span>Failed to submit swap request.</span>
            </div>
          )}

          <div className="space-y-1">
            <SmartSelect
              label="Select Coworker Shift"
              fieldRequired
              value={swapTargetScheduleId}
              onChange={setSwapTargetScheduleId}
              placeholder="-- Select Candidate --"
              options={(swapCandidates?.items || []).map((cand) => ({
                value: cand.candidateWorkerScheduleId,
                label: `${cand.candidateWorkerDisplayName} - ${cand.workDate} (${cand.currentShift.name})`
              }))}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#607A96]">
              Reason <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={3}
              required
              placeholder="Why do you wish to swap this shift?"
              value={swapReason}
              onChange={(e) => setSwapReason(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#DCE6EF] bg-[#F9FAFC] text-sm font-semibold text-[#071A2B] placeholder-[#94A3B8] outline-none transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[#B0C4D8] focus:border-[#071A2B] focus:bg-white focus:ring-2 focus:ring-[#071A2B]/8 shadow-[inset_0_1px_2px_rgba(7,26,43,0.04)] resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="outline" size="md" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="md"
              disabled={!swapTargetScheduleId || !swapReason.trim()}
              isLoading={createSwap.isPending}
            >
              Submit Swap Request
            </Button>
          </div>
        </form>
      </Dialog>

    </div>
  );
}
