import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient, ApiError } from '@smartsite/api-client';
import { useAuth, useCurrentUser } from '../../features/auth/auth-session';
import {
  IconCalendar,
  IconClock,
  IconUsers,
  IconPlus,
  IconCheckCircle2,
  IconAlertCircle,
  IconLoader,
  IconShield,
  IconBuilding,
  IconBuilding2,
  IconTrash,
  IconX,
  IconRefreshCw,
  IconCheck,
} from '../icons';
import { formatShiftTime, WORKFORCE_POLL_INTERVAL_MS } from './WorkforceSharedUI';
import {
  Button,
  Badge,
  Dialog,
  EmptyState,
  Tabs,
  Card,
  CardHeader,
  SmartInput,
  SmartSelect,
  SmartDatePicker,
  SmartTimePicker,
} from '../ui';

function currentDateIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentWeekRange() {
  const today = new Date();
  const monday = new Date(today);
  const day = monday.getDay();
  monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { fromDate: dateIso(monday), toDate: dateIso(sunday) };
}

function currentMonthRange() {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { fromDate: dateIso(first), toDate: dateIso(last) };
}

interface ScheduleSetupViewProps {
  apiUrl: string;
}

export function ScheduleSetupView({ apiUrl }: ScheduleSetupViewProps) {
  const { accessToken } = useAuth();
  const { data: currentUser } = useCurrentUser(apiUrl);
  const queryClient = useQueryClient();
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);

  const roleAssignments = useMemo(
    () => currentUser?.roleAssignments ?? [],
    [currentUser?.roleAssignments],
  );
  const roles = useMemo(() => roleAssignments.map((r) => r.role), [roleAssignments]);
  const isAdmin = roles.includes('ADMIN');
  const isManager = roles.includes('SITE_MANAGER');
  const isContractorRep = roles.includes('CONTRACTOR_REPRESENTATIVE');
  const canAccess = isAdmin || isManager || isContractorRep;
  const canManageShiftsAndVersions = isAdmin || isManager;
  const canAssignWorker = isContractorRep;

  // Site Scope Determination
  const scopedSiteIds = useMemo(
    () =>
      roleAssignments
        .filter(
          (r) =>
            r.role === 'SITE_MANAGER' ||
            r.role === 'ADMIN' ||
            r.role === 'CONTRACTOR_REPRESENTATIVE',
        )
        .map((r) => r.siteId)
        .filter((id): id is string => id !== null && id !== undefined),
    [roleAssignments],
  );

  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'shifts' | 'version' | 'assignment'>('shifts');
  const defaultWeekRange = useMemo(() => currentWeekRange(), []);
  const [assignmentRange, setAssignmentRange] = useState<'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM'>('WEEK');
  const [assignmentFromDate, setAssignmentFromDate] = useState(defaultWeekRange.fromDate);
  const [assignmentToDate, setAssignmentToDate] = useState(defaultWeekRange.toDate);
  const [assignmentWorkerFilter, setAssignmentWorkerFilter] = useState('');
  const [assignmentShiftFilter, setAssignmentShiftFilter] = useState('');
  const [assignmentSearchName, setAssignmentSearchName] = useState('');
  const [assignmentPage, setAssignmentPage] = useState(0);
  const [collapsedAssignmentDates, setCollapsedAssignmentDates] = useState<Set<string>>(new Set());

  // Modal open states
  const [showCreateShiftModal, setShowCreateShiftModal] = useState(false);
  const [showAssignContractorModal, setShowAssignContractorModal] = useState(false);
  const [showCreateVersionModal, setShowCreateVersionModal] = useState(false);
  const [shiftToDelete, setShiftToDelete] = useState<{ id: string; name: string } | null>(null);

  // ── Query Sites ─────────────────────────────────────────────────────────
  const sitesQuery = useQuery({
    queryKey: ['sites', 'schedule-setup'],
    queryFn: async () => {
      if (isAdmin) {
        const res = await client.listSites(accessToken!);
        return res.items;
      }
      const sitePromises = scopedSiteIds.map((sId) =>
        client.getSite(accessToken!, sId).catch(() => null),
      );
      const sites = await Promise.all(sitePromises);
      return sites.filter((s): s is NonNullable<typeof s> => s !== null);
    },
    enabled: Boolean(accessToken && canAccess),
  });

  const availableSites = useMemo(() => sitesQuery.data ?? [], [sitesQuery.data]);
  const activeSiteId = selectedSiteId ?? availableSites[0]?.id ?? null;
  const activeSite = useMemo(
    () => availableSites.find((s) => s.id === activeSiteId) ?? null,
    [availableSites, activeSiteId],
  );

  useEffect(() => {
    if (!selectedSiteId && availableSites.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedSiteId(availableSites[0]!.id);
    }
  }, [availableSites, selectedSiteId]);

  // ── Queries for Active Site ───────────────────────────────────────────
  const shiftsQuery = useQuery({
    queryKey: ['shifts', activeSiteId],
    queryFn: () => client.listShifts(accessToken!, activeSiteId!),
    enabled: Boolean(accessToken && activeSiteId),
  });
  const shifts = useMemo(() => shiftsQuery.data?.items ?? [], [shiftsQuery.data]);

  const versionsQuery = useQuery({
    queryKey: ['schedule-versions', activeSiteId],
    queryFn: () => client.listScheduleVersions(accessToken!, activeSiteId!),
    enabled: Boolean(accessToken && activeSiteId),
  });
  const versions = useMemo(() => versionsQuery.data?.items ?? [], [versionsQuery.data]);

  const workersQuery = useQuery({
    queryKey: ['workers', activeSiteId],
    queryFn: () => client.listWorkers(accessToken!, activeSiteId!),
    enabled: Boolean(accessToken && activeSiteId && canAssignWorker),
  });
  const workers = useMemo(() => workersQuery.data?.items ?? [], [workersQuery.data]);

  const contractorsQuery = useQuery({
    queryKey: ['contractors', activeSiteId],
    queryFn: () => client.listContractors(accessToken!, activeSiteId!),
    enabled: Boolean(accessToken && activeSiteId),
  });
  const contractors = useMemo(() => contractorsQuery.data?.items ?? [], [contractorsQuery.data]);

  const shiftContractorAssignmentsQuery = useQuery({
    queryKey: ['shift-contractor-assignments', activeSiteId],
    queryFn: () => client.listShiftContractorAssignments(accessToken!, activeSiteId!),
    enabled: Boolean(accessToken && activeSiteId),
  });
  const shiftContractorAssignments = useMemo(
    () => shiftContractorAssignmentsQuery.data?.items ?? [],
    [shiftContractorAssignmentsQuery.data],
  );

  const assignmentDateRange = useMemo(() => {
    if (assignmentRange === 'TODAY') {
      const today = currentDateIso();
      return { fromDate: today, toDate: today };
    }
    if (assignmentRange === 'MONTH') return currentMonthRange();
    if (assignmentRange === 'CUSTOM') {
      return {
        fromDate: assignmentFromDate || undefined,
        toDate: assignmentToDate || undefined,
      };
    }
    return defaultWeekRange;
  }, [assignmentFromDate, assignmentRange, assignmentToDate, defaultWeekRange]);

  const schedulesQuery = useQuery({
    queryKey: [
      'worker-schedules',
      activeSiteId,
      assignmentDateRange.fromDate,
      assignmentDateRange.toDate,
      assignmentWorkerFilter,
      assignmentShiftFilter,
      assignmentSearchName,
      assignmentPage,
    ],
    queryFn: () =>
      client.listWorkerSchedules(accessToken!, activeSiteId!, {
        offset: assignmentPage * 25,
        limit: 25,
        fromDate: assignmentDateRange.fromDate,
        toDate: assignmentDateRange.toDate,
        workerId: assignmentWorkerFilter || undefined,
        shiftId: assignmentShiftFilter || undefined,
        searchName: assignmentSearchName || undefined,
      }),
    enabled: Boolean(accessToken && activeSiteId && canAssignWorker),
    refetchInterval: WORKFORCE_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const schedules = useMemo(() => schedulesQuery.data?.items ?? [], [schedulesQuery.data]);
  const schedulesTotal = schedulesQuery.data?.total ?? 0;
  const assignmentPageCount = Math.max(1, Math.ceil(schedulesTotal / 25));
  const groupedAssignmentSchedules = useMemo(() => {
    const groups = new Map<string, typeof schedules>();
    for (const schedule of schedules) {
      const group = groups.get(schedule.workDate) ?? [];
      group.push(schedule);
      groups.set(schedule.workDate, group);
    }
    return Array.from(groups.entries());
  }, [schedules]);

  const resetAssignmentPage = () => setAssignmentPage(0);

  // ── Form States ───────────────────────────────────────────────────────────
  // Shift Form
  const [shiftName, setShiftName] = useState('');
  const [shiftStartsAt, setShiftStartsAt] = useState('08:00');
  const [shiftEndsAt, setShiftEndsAt] = useState('17:00');
  const [shiftTimezone, setShiftTimezone] = useState('UTC');
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [shiftSuccess, setShiftSuccess] = useState<string | null>(null);

  // Assign Shift to Contractor Form
  const [assignContractorShiftId, setAssignContractorShiftId] = useState('');
  const [assignContractorId, setAssignContractorId] = useState('');
  const [assignContractorError, setAssignContractorError] = useState<string | null>(null);
  const [assignContractorSuccess, setAssignContractorSuccess] = useState<string | null>(null);

  // Schedule Version Form
  const [versionFrom, setVersionFrom] = useState(currentDateIso());
  const [versionUntil, setVersionUntil] = useState('');
  const untilInclusive = true;
  const [versionError, setVersionError] = useState<string | null>(null);
  const [versionSuccess, setVersionSuccess] = useState<string | null>(null);

  // Worker Schedule Assignment Form
  const [assignVersionId, setAssignVersionId] = useState('');
  const [assignWorkerId, setAssignWorkerId] = useState('');
  const [assignShiftId, setAssignShiftId] = useState('');
  const [assignWorkDate, setAssignWorkDate] = useState(currentDateIso());
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null);

  // Default selected version for worker assignment
  const selectedVersionId = assignVersionId || versions[0]?.id || '';

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createShiftMutation = useMutation({
    mutationFn: (input: { name: string; startsAt: string; endsAt: string; timezone: string }) =>
      client.createShift(accessToken!, activeSiteId!, input),
    onSuccess: (newShift) => {
      setShiftSuccess(`Shift "${newShift.name}" created successfully.`);
      setShiftError(null);
      setShiftName('');
      setShowCreateShiftModal(false);
      queryClient.invalidateQueries({ queryKey: ['shifts', activeSiteId] });
      setTimeout(() => setShiftSuccess(null), 5000);
    },
    onError: (err: unknown) => {
      setShiftSuccess(null);
      if (err instanceof ApiError) {
        setShiftError(err.message);
      } else {
        setShiftError('Failed to create shift. Please check input parameters.');
      }
    },
  });

  const deleteShiftMutation = useMutation({
    mutationFn: (shiftId: string) => client.deleteShift(accessToken!, activeSiteId!, shiftId),
    onSuccess: () => {
      setShiftSuccess('Shift deleted successfully.');
      setShiftError(null);
      setShiftToDelete(null);
      queryClient.invalidateQueries({ queryKey: ['shifts', activeSiteId] });
      setTimeout(() => setShiftSuccess(null), 5000);
    },
    onError: (err: unknown) => {
      setShiftSuccess(null);
      if (err instanceof ApiError) {
        setShiftError(err.message);
      } else {
        setShiftError('Failed to delete shift.');
      }
    },
  });

  const assignShiftToContractorMutation = useMutation({
    mutationFn: ({ shiftId, contractorId }: { shiftId: string; contractorId: string }) =>
      client.assignShiftToContractor(accessToken!, activeSiteId!, shiftId, { contractorId }),
    onSuccess: () => {
      setAssignContractorSuccess('Shift assigned to contractor successfully.');
      setAssignContractorError(null);
      setShowAssignContractorModal(false);
      queryClient.invalidateQueries({ queryKey: ['shift-contractor-assignments', activeSiteId] });
      setTimeout(() => setAssignContractorSuccess(null), 5000);
    },
    onError: (err: unknown) => {
      setAssignContractorSuccess(null);
      if (err instanceof ApiError) {
        setAssignContractorError(err.message);
      } else {
        setAssignContractorError('Failed to assign shift to contractor.');
      }
    },
  });

  const createVersionMutation = useMutation({
    mutationFn: (input: { effectiveFrom: string; effectiveUntil?: string }) =>
      client.createScheduleVersion(accessToken!, activeSiteId!, input),
    onSuccess: (newVersion) => {
      setVersionSuccess(`Schedule version created (Version ${newVersion.version}).`);
      setVersionError(null);
      setShowCreateVersionModal(false);
      queryClient.invalidateQueries({ queryKey: ['schedule-versions', activeSiteId] });
      setTimeout(() => setVersionSuccess(null), 5000);
    },
    onError: (err: unknown) => {
      setVersionSuccess(null);
      if (err instanceof ApiError) {
        setVersionError(err.message);
      } else {
        setVersionError('Failed to create schedule version.');
      }
    },
  });

  const assignWorkerScheduleMutation = useMutation({
    mutationFn: (input: {
      versionId: string;
      workerId: string;
      shiftId: string;
      workDate: string;
    }) =>
      client.createWorkerSchedule(accessToken!, activeSiteId!, input.versionId, {
        workerId: input.workerId,
        shiftId: input.shiftId,
        workDate: input.workDate,
      }),
    onSuccess: () => {
      setAssignSuccess('Worker assigned to schedule successfully.');
      setAssignError(null);
      queryClient.invalidateQueries({ queryKey: ['worker-schedules', activeSiteId] });
      setTimeout(() => setAssignSuccess(null), 5000);
    },
    onError: (err: unknown) => {
      setAssignSuccess(null);
      if (err instanceof ApiError) {
        setAssignError(err.message);
      } else {
        setAssignError('Failed to assign worker schedule.');
      }
    },
  });

  // ── Form Handlers ─────────────────────────────────────────────────────────
  const handleCreateShift = (e: React.FormEvent) => {
    e.preventDefault();
    setShiftError(null);
    setShiftSuccess(null);

    if (!activeSiteId) {
      setShiftError('No site selected.');
      return;
    }
    if (!shiftName.trim()) {
      setShiftError('Shift name is required.');
      return;
    }
    if (!shiftStartsAt || !shiftEndsAt) {
      setShiftError('Start and end times are required.');
      return;
    }

    const formatIso = (timeStr: string, isEnd: boolean = false) => {
      const [hhStr] = timeStr.split(':');
      const hh = parseInt(hhStr || '0', 10);
      let day = '01';
      if (isEnd) {
        const startHh = parseInt(shiftStartsAt.split(':')[0] || '0', 10);
        if (hh < startHh) {
          day = '02';
        }
      }
      return `2026-10-${day}T${timeStr}:00.000Z`;
    };

    createShiftMutation.mutate({
      name: shiftName.trim(),
      startsAt: formatIso(shiftStartsAt, false),
      endsAt: formatIso(shiftEndsAt, true),
      timezone: shiftTimezone.trim() || 'UTC',
    });
  };

  const handleAssignShiftToContractor = (e: React.FormEvent) => {
    e.preventDefault();
    setAssignContractorError(null);
    setAssignContractorSuccess(null);

    if (!activeSiteId) {
      setAssignContractorError('No site selected.');
      return;
    }
    if (!assignContractorShiftId) {
      setAssignContractorError('Please select a shift.');
      return;
    }
    if (!assignContractorId) {
      setAssignContractorError('Please select a contractor.');
      return;
    }

    assignShiftToContractorMutation.mutate({
      shiftId: assignContractorShiftId,
      contractorId: assignContractorId,
    });
  };

  const handleCreateVersion = (e: React.FormEvent) => {
    e.preventDefault();
    setVersionError(null);
    setVersionSuccess(null);

    if (!activeSiteId) {
      setVersionError('No site selected.');
      return;
    }
    if (!versionFrom) {
      setVersionError('Effective from date is required.');
      return;
    }
    if (versionFrom < currentDateIso()) {
      setVersionError('Effective from date cannot be in the past.');
      return;
    }

    const fromDate = new Date(`${versionFrom}T00:00:00.000Z`).toISOString();
    let untilDate: string | undefined = undefined;

    if (versionUntil) {
      if (untilInclusive) {
        const d = new Date(`${versionUntil}T00:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        untilDate = d.toISOString();
      } else {
        untilDate = new Date(`${versionUntil}T00:00:00.000Z`).toISOString();
      }
    }

    createVersionMutation.mutate({
      effectiveFrom: fromDate,
      effectiveUntil: untilDate,
    });
  };

  const handleAssignWorkerSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    setAssignError(null);
    setAssignSuccess(null);

    if (!activeSiteId) {
      setAssignError('No site selected.');
      return;
    }
    if (!selectedVersionId) {
      setAssignError('Please select a Schedule Version first.');
      return;
    }
    if (!assignWorkerId) {
      setAssignError('Please select a Worker.');
      return;
    }
    if (!assignShiftId) {
      setAssignError('Please select a Shift.');
      return;
    }
    if (!assignWorkDate) {
      setAssignError('Please select a Work Date.');
      return;
    }

    assignWorkerScheduleMutation.mutate({
      versionId: selectedVersionId,
      workerId: assignWorkerId,
      shiftId: assignShiftId,
      workDate: assignWorkDate,
    });
  };

  const openAssignContractorForShift = (shiftId: string) => {
    setAssignContractorShiftId(shiftId);
    setAssignContractorId(contractors[0]?.id || '');
    setAssignContractorError(null);
    setShowAssignContractorModal(true);
  };

  // Filtered shifts
  const filteredShifts = shifts;

  // Tab items config
  const tabItems = useMemo(() => {
    const items: { id: 'shifts' | 'version' | 'assignment'; label: string; count?: number; icon?: React.ReactNode }[] = [
      { id: 'shifts', label: 'Shifts', count: shifts.length, icon: <IconClock className="w-3.5 h-3.5 text-[#F66B17]" /> },
      { id: 'version', label: 'Schedule Versions', count: versions.length, icon: <IconCalendar className="w-3.5 h-3.5 text-blue-600" /> },
    ];
    if (canAssignWorker) {
      items.push({
        id: 'assignment',
        label: 'Worker Assignment',
        count: schedulesTotal,
        icon: <IconUsers className="w-3.5 h-3.5 text-emerald-600" />,
      });
    }
    return items;
  }, [shifts.length, versions.length, schedulesTotal, canAssignWorker]);

  // ── Access Check ─────────────────────────────────────────────────────────
  if (!canAccess) {
    return (
      <div className="max-w-md mx-auto mt-20 p-8 rounded-2xl bg-white border border-rose-200 text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
          <IconShield className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">Access Restricted</h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          Schedule Setup is reserved for Contractor Representatives, Site Managers, and Administrators.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-300">

      {/* 1. Header & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#071A2B] text-white flex items-center justify-center shadow-xs shrink-0">
            <IconCalendar className="w-5 h-5 text-[#F66B17]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Workforce Management
              </span>
              <span className="text-slate-300">•</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                MF07 Scheduling
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[#071A2B]">
              Schedule Setup
            </h1>
          </div>
        </div>

        {/* Site Switcher & Refresh */}
        <div className="flex items-center gap-2.5">
          {availableSites.length > 1 && (
            <div className="flex items-center gap-1.5 min-w-[200px]">
              <span className="text-xs font-semibold text-slate-500 hidden sm:inline shrink-0">Site:</span>
              <SmartSelect
                size="sm"
                value={activeSiteId || ''}
                onChange={(val) => setSelectedSiteId(val)}
                className="w-full"
                options={availableSites.map((site) => ({
                  value: site.id,
                  label: `${site.name} (${site.code})`,
                }))}
              />
            </div>
          )}

          <Button
            variant="outline"
            size="md"
            onClick={() => {
              shiftsQuery.refetch();
              versionsQuery.refetch();
              if (canAssignWorker) schedulesQuery.refetch();
            }}
            isLoading={shiftsQuery.isFetching || versionsQuery.isFetching}
            leftIcon={<IconRefreshCw className="w-3.5 h-3.5 text-slate-500" />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Success / Notification Toasts */}
      {shiftSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5 font-medium">
            <IconCheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{shiftSuccess}</span>
          </div>
          <button type="button" onClick={() => setShiftSuccess(null)} className="text-emerald-600 hover:text-emerald-900 cursor-pointer">
            <IconX className="w-4 h-4" />
          </button>
        </div>
      )}

      {assignContractorSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5 font-medium">
            <IconCheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{assignContractorSuccess}</span>
          </div>
          <button type="button" onClick={() => setAssignContractorSuccess(null)} className="text-emerald-600 hover:text-emerald-900 cursor-pointer">
            <IconX className="w-4 h-4" />
          </button>
        </div>
      )}

      {versionSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5 font-medium">
            <IconCheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{versionSuccess}</span>
          </div>
          <button type="button" onClick={() => setVersionSuccess(null)} className="text-emerald-600 hover:text-emerald-900 cursor-pointer">
            <IconX className="w-4 h-4" />
          </button>
        </div>
      )}

      {assignSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5 font-medium">
            <IconCheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{assignSuccess}</span>
          </div>
          <button type="button" onClick={() => setAssignSuccess(null)} className="text-emerald-600 hover:text-emerald-900 cursor-pointer">
            <IconX className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. Top Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Configured Shifts</span>
            <p className="text-2xl font-black tracking-tight text-[#071A2B]">{shifts.length}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600">
            <IconClock className="w-5 h-5 text-[#F66B17]" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Schedule Versions</span>
            <p className="text-2xl font-black tracking-tight text-[#071A2B]">{versions.length}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600">
            <IconCalendar className="w-5 h-5 text-blue-600" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Site</span>
            <p className="text-sm font-black tracking-tight text-[#071A2B] truncate max-w-[180px]">
              {activeSite?.name || 'No Site'}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600">
            <IconBuilding className="w-5 h-5 text-slate-700" />
          </div>
        </div>
      </div>

      {/* 3. Navigation Tabs Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/90 shadow-xs">
        <Tabs
          items={tabItems}
          activeTab={activeTab}
          onChange={(tab) => setActiveTab(tab)}
        />

        {/* Tab Action Buttons */}
        <div className="flex items-center gap-2">
          {activeTab === 'shifts' && canManageShiftsAndVersions && (
            <>
              <Button
                variant="outline"
                size="md"
                onClick={() => {
                  setAssignContractorShiftId(shifts[0]?.id || '');
                  setAssignContractorId(contractors[0]?.id || '');
                  setAssignContractorError(null);
                  setShowAssignContractorModal(true);
                }}
                disabled={shifts.length === 0 || contractors.length === 0}
                leftIcon={<IconBuilding2 className="w-3.5 h-3.5 text-slate-600" />}
              >
                Assign Contractor
              </Button>

              <Button
                variant="default"
                size="md"
                onClick={() => {
                  setShiftError(null);
                  setShiftName('');
                  setShowCreateShiftModal(true);
                }}
                leftIcon={<IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />}
              >
                New Shift
              </Button>
            </>
          )}

          {activeTab === 'version' && canManageShiftsAndVersions && (
            <Button
              variant="default"
              size="md"
              onClick={() => {
                setVersionError(null);
                setShowCreateVersionModal(true);
              }}
              leftIcon={<IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />}
            >
              New Version
            </Button>
          )}
        </div>
      </div>

      {/* ── TAB 1: SHIFTS VIEW ────────────────────────────────────────────── */}
      {activeTab === 'shifts' && (
        <div className="space-y-4">
          {shiftsQuery.isLoading ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2 shadow-xs">
              <IconLoader className="w-5 h-5 animate-spin text-slate-500" />
              <span>Loading shift schedules...</span>
            </div>
          ) : shifts.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs">
              <EmptyState
                icon={<IconClock className="w-6 h-6 text-[#F66B17]" />}
                title="No Shifts Configured"
                description={
                  canManageShiftsAndVersions
                    ? 'Define operational shifts with specific hours and timezones for this site.'
                    : 'The Site Manager has not configured any shifts for this site yet.'
                }
                actionLabel={canManageShiftsAndVersions ? 'Create First Shift' : undefined}
                actionIcon={<IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />}
                onAction={() => {
                  setShiftError(null);
                  setShowCreateShiftModal(true);
                }}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredShifts.map((shift) => {
                const assignedContractorList = shiftContractorAssignments
                  .filter((a) => a.shiftId === shift.id)
                  .map((a) => contractors.find((c) => c.id === a.contractorId))
                  .filter((c): c is NonNullable<typeof c> => Boolean(c));

                return (
                  <Card key={shift.id} doubleBezel className="space-y-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-[#F66B17]" />
                          <h3 className="text-sm font-bold text-slate-900">{shift.name}</h3>
                        </div>
                        <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-md w-fit">
                          <IconClock className="w-3 h-3 text-slate-400" />
                          <span>
                            {formatShiftTime(shift.startsAt)} - {formatShiftTime(shift.endsAt)}
                          </span>
                          <span className="text-[10px] text-slate-400 font-normal">({shift.timezone || 'UTC'})</span>
                        </div>
                      </div>

                      {canManageShiftsAndVersions && (
                        <button
                          type="button"
                          onClick={() => setShiftToDelete({ id: shift.id, name: shift.name })}
                          className="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition-colors cursor-pointer"
                          title="Delete Shift"
                        >
                          <IconTrash className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Assigned Contractors Section */}
                    <div className="pt-2 border-t border-slate-100 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Assigned Contractors ({assignedContractorList.length})
                        </span>
                        {canManageShiftsAndVersions && (
                          <button
                            type="button"
                            onClick={() => openAssignContractorForShift(shift.id)}
                            className="text-[11px] font-bold text-[#F66B17] hover:underline cursor-pointer"
                          >
                            + Assign
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {assignedContractorList.length === 0 ? (
                          <span className="text-[11px] text-slate-400 italic">No contractor assigned</span>
                        ) : (
                          assignedContractorList.map((c) => (
                            <Badge key={c.id} variant="neutral">
                              {c.code}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: SCHEDULE VERSIONS ───────────────────────────────────────── */}
      {activeTab === 'version' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
          {versionsQuery.isLoading ? (
            <div className="py-16 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
              <IconLoader className="w-5 h-5 animate-spin text-slate-500" />
              <span>Loading schedule versions...</span>
            </div>
          ) : versions.length === 0 ? (
            <EmptyState
              icon={<IconCalendar className="w-6 h-6 text-blue-600" />}
              title="No Schedule Versions"
              description={
                canManageShiftsAndVersions
                  ? 'Create a schedule version defining effective date ranges before assigning worker shifts.'
                  : 'No active schedule versions found for this site.'
              }
              actionLabel={canManageShiftsAndVersions ? 'Create New Version' : undefined}
              actionIcon={<IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />}
              onAction={() => {
                setVersionError(null);
                setShowCreateVersionModal(true);
              }}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Version</th>
                    <th className="py-3 px-4">Effective From</th>
                    <th className="py-3 px-4">Effective Until</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {versions.map((ver) => (
                    <tr key={ver.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        Version {ver.version}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-700">
                        {new Date(ver.effectiveFrom).toLocaleDateString('vi-VN')}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-700">
                        {ver.effectiveUntil
                          ? new Date(ver.effectiveUntil).toLocaleDateString('vi-VN')
                          : 'Ongoing (No end date)'}
                      </td>
                      <td className="py-3.5 px-4">
                        <Badge variant="success" dot>
                          Active
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: WORKER ASSIGNMENT (CONTRACTOR REPRESENTATIVE ONLY) ─────── */}
      {activeTab === 'assignment' && canAssignWorker && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">

          {/* Assignment Form Card (4 cols) */}
          <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
            <CardHeader
              title="Assign Worker Schedule"
              subtitle="Schedule worker to a shift"
              icon={<IconUsers className="w-4 h-4 text-[#F66B17]" />}
            />

            <form onSubmit={handleAssignWorkerSchedule} className="space-y-3.5">
              {assignError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs">
                  <IconAlertCircle className="w-4 h-4 shrink-0" />
                  <span>{assignError}</span>
                </div>
              )}

              {/* Version selector */}
              <div className="space-y-1">
                <SmartSelect
                  label="Schedule Version"
                  fieldRequired
                  value={selectedVersionId}
                  onChange={setAssignVersionId}
                  placeholder="Select Version"
                  options={versions.map((v) => ({
                    value: v.id,
                    label: `Version ${v.version}`,
                    badge: v.effectiveUntil ? 'Fixed' : 'Ongoing',
                    description: `From ${new Date(v.effectiveFrom).toLocaleDateString('vi-VN')}${
                      v.effectiveUntil ? ` to ${new Date(v.effectiveUntil).toLocaleDateString('vi-VN')}` : ''
                    }`,
                  }))}
                />
              </div>

              {/* Worker selector */}
              <div className="space-y-1">
                <SmartSelect
                  label="Worker"
                  fieldRequired
                  searchable
                  searchPlaceholder="Search worker name or ID..."
                  value={assignWorkerId}
                  onChange={setAssignWorkerId}
                  placeholder="-- Select Worker --"
                  options={workers.map((w) => ({
                    value: w.id,
                    label: w.displayName,
                    badge: w.externalId || w.id.slice(0, 8),
                  }))}
                />
              </div>

              {/* Shift selector */}
              <div className="space-y-1">
                <SmartSelect
                  label="Shift"
                  fieldRequired
                  value={assignShiftId}
                  onChange={setAssignShiftId}
                  placeholder="-- Select Shift --"
                  options={shifts.map((s) => ({
                    value: s.id,
                    label: s.name,
                    description: `${formatShiftTime(s.startsAt)} - ${formatShiftTime(s.endsAt)} (${s.timezone || 'UTC'})`,
                  }))}
                />
              </div>

              {/* Work Date */}
              <div className="space-y-1">
                <SmartDatePicker
                  label="Work Date"
                  fieldRequired
                  value={assignWorkDate}
                  onChange={setAssignWorkDate}
                />
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  variant="default"
                  size="md"
                  className="w-full"
                  isLoading={assignWorkerScheduleMutation.isPending}
                  leftIcon={<IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />}
                >
                  Assign Schedule
                </Button>
              </div>
            </form>
          </div>

          {/* Existing Schedules Table (8 cols) */}
          <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 space-y-4">
              <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Assigned Schedules ({schedulesTotal})
              </h3>
              {schedulesQuery.isFetching && <IconLoader className="w-3.5 h-3.5 text-slate-400 animate-spin" />}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {([
                  ['TODAY', 'Today'],
                  ['WEEK', 'This week'],
                  ['MONTH', 'This month'],
                  ['CUSTOM', 'Custom range'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setAssignmentRange(value);
                      resetAssignmentPage();
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors cursor-pointer ${
                      assignmentRange === value
                        ? 'border-[#071A2B] bg-[#071A2B] text-white shadow-xs'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {assignmentRange === 'CUSTOM' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    From
                    <input
                      type="date"
                      value={assignmentFromDate}
                      onChange={(event) => {
                        setAssignmentFromDate(event.target.value);
                        resetAssignmentPage();
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-800 outline-none focus:border-[#F66B17]"
                    />
                  </label>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    To
                    <input
                      type="date"
                      value={assignmentToDate}
                      onChange={(event) => {
                        setAssignmentToDate(event.target.value);
                        resetAssignmentPage();
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-800 outline-none focus:border-[#F66B17]"
                    />
                  </label>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <SmartSelect
                    label="Worker"
                    size="sm"
                    searchable
                    searchPlaceholder="Filter worker..."
                    value={assignmentWorkerFilter}
                    onChange={(val) => {
                      setAssignmentWorkerFilter(val);
                      resetAssignmentPage();
                    }}
                    options={[
                      { value: '', label: 'All workers' },
                      ...workers.map((worker) => ({
                        value: worker.id,
                        label: worker.displayName,
                        badge: worker.externalId || worker.id.slice(0, 6),
                      })),
                    ]}
                  />
                </div>
                <div>
                  <SmartSelect
                    label="Shift"
                    size="sm"
                    value={assignmentShiftFilter}
                    onChange={(val) => {
                      setAssignmentShiftFilter(val);
                      resetAssignmentPage();
                    }}
                    options={[
                      { value: '', label: 'All shifts' },
                      ...shifts.map((shift) => ({
                        value: shift.id,
                        label: shift.name,
                        description: `${formatShiftTime(shift.startsAt)} - ${formatShiftTime(shift.endsAt)}`,
                      })),
                    ]}
                  />
                </div>
                <div>
                  <SmartInput
                    id="search-name-input"
                    label="Search Name"
                    placeholder="Worker name or email..."
                    value={assignmentSearchName}
                    onChange={(e) => {
                      setAssignmentSearchName(e.target.value);
                      resetAssignmentPage();
                    }}
                  />
                </div>
              </div>
            </div>

            {schedulesQuery.isLoading ? (
              <div className="py-16 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
                <IconLoader className="w-5 h-5 animate-spin text-slate-500" />
                <span>Loading worker schedules...</span>
              </div>
            ) : schedules.length === 0 ? (
              <div className="py-12 px-4 text-center space-y-2">
                <p className="text-xs text-slate-500">No worker schedules assigned yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[480px]">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50/90 backdrop-blur-xs">
                    <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-4">Worker</th>
                      <th className="py-3 px-4">Shift</th>
                      <th className="py-3 px-4">Work Date</th>
                      <th className="py-3 px-4">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {groupedAssignmentSchedules.map(([date, dateSchedules]) => {
                      const collapsed = collapsedAssignmentDates.has(date);
                      return (
                        <React.Fragment key={date}>
                          <tr className="bg-slate-50/80">
                            <td colSpan={4} className="px-4 py-2">
                              <button
                                type="button"
                                aria-expanded={!collapsed}
                                onClick={() => {
                                  setCollapsedAssignmentDates((current) => {
                                    const next = new Set(current);
                                    if (next.has(date)) next.delete(date);
                                    else next.add(date);
                                    return next;
                                  });
                                }}
                                className="flex w-full items-center justify-between text-left text-[11px] font-bold text-slate-700"
                              >
                                <span>{date} · {dateSchedules.length} schedule(s)</span>
                                <span>{collapsed ? '+' : '−'}</span>
                              </button>
                            </td>
                          </tr>
                          {!collapsed && dateSchedules.map((sched) => {
                            const workerObj = workers.find((w) => w.id === sched.workerId);
                            const shiftObj = shifts.find((s) => s.id === sched.shiftId);
                            return (
                              <tr key={sched.id} className="hover:bg-slate-50/70 transition-colors">
                                <td className="py-3 px-4 font-bold text-slate-900">
                                  {workerObj?.displayName || `Worker (${sched.workerId.slice(0, 6)})`}
                                </td>
                                <td className="py-3 px-4">
                                  <span className="font-semibold text-slate-800">
                                    {shiftObj?.name || 'Shift'}
                                  </span>
                                  {shiftObj && (
                                    <span className="block text-[10px] font-mono text-slate-500">
                                      {formatShiftTime(shiftObj.startsAt)} - {formatShiftTime(shiftObj.endsAt)}
                                    </span>
                                  )}
                                </td>
                                <td className="py-3 px-4 font-mono font-medium text-slate-700">
                                  {sched.workDate}
                                </td>
                                <td className="py-3 px-4 text-slate-400 text-[11px]">
                                  {new Date(sched.createdAt).toLocaleDateString('vi-VN')}
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
                  <span>Page {assignmentPage + 1} of {assignmentPageCount} · 25 per page</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={assignmentPage === 0}
                      onClick={() => setAssignmentPage((page) => Math.max(0, page - 1))}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-bold disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={assignmentPage + 1 >= assignmentPageCount}
                      onClick={() => setAssignmentPage((page) => Math.min(assignmentPageCount - 1, page + 1))}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-bold disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── MODAL 1: Create Shift Dialog ───────────────────────────────────── */}
      <Dialog
        open={showCreateShiftModal}
        onClose={() => setShowCreateShiftModal(false)}
        title="Create New Shift"
        description={`Define work shift hours on ${activeSite?.name}`}
        icon={<IconClock className="w-4 h-4 text-[#F66B17]" />}
      >
        <form onSubmit={handleCreateShift} className="space-y-4">
          {shiftError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs">
              <IconAlertCircle className="w-4 h-4 shrink-0" />
              <span>{shiftError}</span>
            </div>
          )}

          <div className="space-y-1">
            <SmartInput
              id="shift-name-input"
              label="Shift Name"
              fieldRequired
              type="text"
              placeholder="e.g. Day Shift / Ca Sáng"
              value={shiftName}
              onChange={(e) => setShiftName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div className="space-y-1">
              <SmartTimePicker
                id="shift-starts-at-input"
                label="Starts At"
                fieldRequired
                value={shiftStartsAt}
                onChange={setShiftStartsAt}
              />
            </div>

            <div className="space-y-1">
              <SmartTimePicker
                id="shift-ends-at-input"
                label="Ends At"
                fieldRequired
                value={shiftEndsAt}
                onChange={setShiftEndsAt}
              />
            </div>
          </div>

          <div className="space-y-1">
            <SmartInput
              id="shift-timezone-input"
              label="Timezone"
              type="text"
              value={shiftTimezone}
              onChange={(e) => setShiftTimezone(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="outline" size="md" onClick={() => setShowCreateShiftModal(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="md"
              isLoading={createShiftMutation.isPending}
              leftIcon={<IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />}
            >
              Create Shift
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ── MODAL 2: Assign Shift to Contractor Dialog ─────────────────────── */}
      <Dialog
        open={showAssignContractorModal}
        onClose={() => setShowAssignContractorModal(false)}
        title="Assign Shift to Contractor"
        description="Allow subcontractor workers to take this shift"
        icon={<IconBuilding2 className="w-4 h-4 text-[#F66B17]" />}
      >
        <form onSubmit={handleAssignShiftToContractor} className="space-y-4">
          {assignContractorError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs">
              <IconAlertCircle className="w-4 h-4 shrink-0" />
              <span>{assignContractorError}</span>
            </div>
          )}

          <div className="space-y-1">
            <SmartSelect
              id="assign-contractor-shift-select"
              label="Target Shift"
              fieldRequired
              value={assignContractorShiftId}
              onChange={setAssignContractorShiftId}
              options={shifts.map((s) => ({
                value: s.id,
                label: `${s.name} (${formatShiftTime(s.startsAt)} - ${formatShiftTime(s.endsAt)})`
              }))}
            />
          </div>

          <div className="space-y-1">
            <SmartSelect
              id="assign-contractor-select"
              label="Subcontractor"
              fieldRequired
              value={assignContractorId}
              onChange={setAssignContractorId}
              options={contractors.map((c) => ({
                value: c.id,
                label: `${c.name} (${c.code})`
              }))}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="outline" size="md" onClick={() => setShowAssignContractorModal(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="md"
              isLoading={assignShiftToContractorMutation.isPending}
              leftIcon={<IconCheck className="w-3.5 h-3.5 text-[#F66B17]" />}
            >
              Assign Contractor
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ── MODAL 3: Create Schedule Version Dialog ─────────────────────────── */}
      <Dialog
        open={showCreateVersionModal}
        onClose={() => setShowCreateVersionModal(false)}
        title="Create Schedule Version"
        description="Define a new planning period on this site"
        icon={<IconCalendar className="w-4 h-4 text-[#F66B17]" />}
      >
        <form onSubmit={handleCreateVersion} className="space-y-4">
          {versionError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs">
              <IconAlertCircle className="w-4 h-4 shrink-0" />
              <span>{versionError}</span>
            </div>
          )}

          <div className="space-y-1">
            <SmartDatePicker
              id="version-from-input"
              label="Effective From"
              fieldRequired
              value={versionFrom}
              onChange={setVersionFrom}
            />
          </div>

          <div className="space-y-1">
            <SmartDatePicker
              id="version-until-input"
              label="Effective Until (Optional)"
              value={versionUntil}
              onChange={setVersionUntil}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="outline" size="md" onClick={() => setShowCreateVersionModal(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="md"
              isLoading={createVersionMutation.isPending}
              leftIcon={<IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />}
            >
              Create Version
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ── MODAL 4: Delete Shift Confirmation Dialog ──────────────────────── */}
      <Dialog
        open={Boolean(shiftToDelete)}
        onClose={() => setShiftToDelete(null)}
        title="Delete Shift"
        description="Are you sure you want to delete this shift schedule?"
        icon={<IconTrash className="w-4 h-4 text-rose-500" />}
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600">
            Deleting <span className="font-bold text-slate-900">&quot;{shiftToDelete?.name}&quot;</span> will permanently remove this shift definition and its contractor links.
          </p>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="outline" size="md" onClick={() => setShiftToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="md"
              isLoading={deleteShiftMutation.isPending}
              onClick={() => shiftToDelete && deleteShiftMutation.mutate(shiftToDelete.id)}
            >
              Delete Shift
            </Button>
          </div>
        </div>
      </Dialog>

    </div>
  );
}
