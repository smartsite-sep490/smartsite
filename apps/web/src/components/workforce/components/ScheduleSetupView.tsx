import { localizedError, localizeMessage } from '../../../i18n/messages';
import { uiLocale } from '../../../i18n';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import { ScheduleAssignmentForm } from './ScheduleAssignmentForm';
import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@smartsite/api-client';
import { useManagementClient, useAuth, useCurrentUser } from '../../../features/auth/auth-session';
import {
  IconCalendar,
  IconClock,
  IconUsers,
  IconPlus,
  IconAlertCircle,
  IconLoader,
  IconShield,
  IconBuilding,
  IconBuilding2,
  IconX,
  IconRefreshCw,
  IconCheck,
} from '../../icons';
import { formatShiftRange, formatWorkDate } from '../utils/workforce-format';
import { WORKFORCE_POLL_INTERVAL_MS } from '../constants/workforce.constants';
import type { WorkerResponse } from '@smartsite/contracts';
import {
  Button,
  Badge,
  Dialog,
  EmptyState,
  Tabs,
  Card,
  SmartInput,
  SmartSelect,
  SmartDatePicker,
  SmartTimePicker,
} from '../../ui';

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
  useTranslation();

  const { accessToken } = useAuth();
  const { data: currentUser } = useCurrentUser(apiUrl);
  const queryClient = useQueryClient();
  const client = useManagementClient(apiUrl);

  const roleAssignments = useMemo(
    () => currentUser?.roleAssignments ?? [],
    [currentUser?.roleAssignments],
  );
  const isAdmin = roleAssignments.some(
    (assignment) => assignment.role === 'ADMIN' && assignment.siteId === null,
  );
  const canDiscoverSites =
    isAdmin ||
    roleAssignments.some(
      (assignment) =>
        assignment.role === 'SITE_MANAGER' || assignment.role === 'CONTRACTOR_REPRESENTATIVE',
    );

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

  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('siteId'),
  );
  const [requestedTab, setActiveTab] = useState<'shifts' | 'version' | 'assignment'>(() =>
    new URLSearchParams(window.location.search).get('tab') === 'assignment'
      ? 'assignment'
      : 'shifts',
  );
  const defaultWeekRange = useMemo(() => currentWeekRange(), []);
  const [assignmentRange, setAssignmentRange] = useState<'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM'>(
    'WEEK',
  );
  const [assignmentFromDate, setAssignmentFromDate] = useState(defaultWeekRange.fromDate);
  const [assignmentToDate, setAssignmentToDate] = useState(defaultWeekRange.toDate);
  const [assignmentWorkerFilter, setAssignmentWorkerFilter] = useState('');
  const [assignmentTeamFilter, setAssignmentTeamFilter] = useState('');
  const [assignmentShiftFilter, setAssignmentShiftFilter] = useState('');
  const [assignmentSearchName, setAssignmentSearchName] = useState('');
  const [assignmentPage, setAssignmentPage] = useState(0);
  const [assignmentChoice, setAssignmentScope] = useState({ siteId: '', contractorId: '' });
  const [collapsedAssignmentDates, setCollapsedAssignmentDates] = useState<Set<string>>(new Set());

  // Modal open states
  const [showCreateShiftModal, setShowCreateShiftModal] = useState(false);
  const [showAssignContractorModal, setShowAssignContractorModal] = useState(false);
  const [showCreateVersionModal, setShowCreateVersionModal] = useState(false);
  const [shiftToArchive, setShiftToArchive] = useState<{ id: string; name: string } | null>(null);
  const [showArchivedShifts, setShowArchivedShifts] = useState(false);

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
    enabled: Boolean(accessToken && canDiscoverSites),
  });

  const availableSites = useMemo(() => sitesQuery.data ?? [], [sitesQuery.data]);
  const activeSiteId = selectedSiteId ?? availableSites[0]?.id ?? null;
  const activeSite = useMemo(
    () => availableSites.find((s) => s.id === activeSiteId) ?? null,
    [availableSites, activeSiteId],
  );
  const isManager = roleAssignments.some(
    (assignment) => assignment.role === 'SITE_MANAGER' && assignment.siteId === activeSiteId,
  );
  const isContractorRep = roleAssignments.some(
    (assignment) =>
      assignment.role === 'CONTRACTOR_REPRESENTATIVE' && assignment.siteId === activeSiteId,
  );
  const canAccess = isAdmin || isManager || isContractorRep;
  // MF07: only a Site Manager for the selected Site may create/delete shifts,
  // manage versions, and assign shifts to contractors. Admin may still view setup.
  const canManageShiftsAndVersions = isManager;
  const canAssignWorker = isContractorRep;
  const canViewAssignments = isAdmin || isContractorRep;
  const activeTab = requestedTab === 'assignment' && !canViewAssignments ? 'shifts' : requestedTab;
  const readScopes = useQuery({
    queryKey: ['schedule-read-scopes', apiUrl, currentUser?.id, activeSiteId, isManager],
    queryFn: async () =>
      isManager
        ? {
            items: (await client.accessSetup(accessToken!, activeSiteId!)).participations
              .filter(
                (p) =>
                  Date.parse(p.validFrom) <= Date.now() &&
                  (!p.validUntil || Date.parse(p.validUntil) > Date.now()),
              )
              .map((p) => ({
                siteId: activeSiteId!,
                contractorId: p.contractorId,
                contractorName: p.name,
              })),
          }
        : client.contractorDashboardScopes(accessToken!),
    enabled:
      !!accessToken &&
      !!activeSiteId &&
      canViewAssignments &&
      (isManager || isContractorRep) &&
      !canAssignWorker,
  });
  const readOptions = useMemo(
    () => readScopes.data?.items.filter((o) => o.siteId === activeSiteId) ?? [],
    [readScopes.data, activeSiteId],
  );
  const assignmentScope = useMemo(
    () =>
      canAssignWorker
        ? assignmentChoice
        : {
            siteId: activeSiteId ?? '',
            contractorId: readOptions.some((o) => o.contractorId === assignmentChoice.contractorId)
              ? assignmentChoice.contractorId
              : (readOptions[0]?.contractorId ?? ''),
          },
    [canAssignWorker, assignmentChoice, activeSiteId, readOptions],
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
  const availableShifts = useMemo(() => shifts.filter((shift) => !shift.archivedAt), [shifts]);

  const versionsQuery = useQuery({
    queryKey: ['schedule-versions', activeSiteId],
    queryFn: () => client.listScheduleVersions(accessToken!, activeSiteId!),
    enabled: Boolean(accessToken && activeSiteId),
  });
  const versions = useMemo(() => versionsQuery.data?.items ?? [], [versionsQuery.data]);

  const workersQuery = useQuery({
    queryKey: ['schedule-workers', apiUrl, accessToken, activeSiteId],
    queryFn: async () => {
      const items: WorkerResponse[] = [];
      for (let offset = 0; ; offset += 100) {
        const page = await client.listWorkers(accessToken!, activeSiteId!, { offset, limit: 100 });
        items.push(...page.items);
        if (items.length >= page.total || !page.items.length) return { items, total: page.total };
      }
    },
    enabled: Boolean(accessToken && activeSiteId && canViewAssignments),
  });
  const workers = useMemo(
    () =>
      workersQuery.data?.items.filter(
        (worker) =>
          assignmentScope.siteId === activeSiteId &&
          worker.contractorId === assignmentScope.contractorId,
      ) ?? [],
    [workersQuery.data, assignmentScope, activeSiteId],
  );

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

  const contractorTeamsQuery = useQuery({
    queryKey: ['contractor-teams', activeSiteId, assignmentScope.contractorId],
    queryFn: () =>
      client.listContractorTeams(accessToken!, activeSiteId!, assignmentScope.contractorId, {
        status: 'ACTIVE',
        offset: 0,
        limit: 100,
      }),
    enabled: Boolean(
      accessToken && activeSiteId && canViewAssignments && assignmentScope.contractorId,
    ),
  });
  const contractorTeams = useMemo(
    () => contractorTeamsQuery.data?.items ?? [],
    [contractorTeamsQuery.data],
  );

  const contractorTeamWorkersQuery = useQuery({
    queryKey: ['contractor-team-workers', activeSiteId, assignmentScope.contractorId],
    queryFn: () =>
      client.listContractorTeamWorkers(accessToken!, activeSiteId!, assignmentScope.contractorId, {
        offset: 0,
        limit: 200,
      }),
    enabled: Boolean(
      accessToken && activeSiteId && canViewAssignments && assignmentScope.contractorId,
    ),
  });
  const contractorTeamWorkers = useMemo(
    () => contractorTeamWorkersQuery.data?.items ?? [],
    [contractorTeamWorkersQuery.data],
  );

  const visibleWorkers = useMemo(() => {
    if (!assignmentTeamFilter) return workers;
    const memberIds = new Set(
      contractorTeamWorkers
        .filter((tw) => tw.teamId === assignmentTeamFilter)
        .map((tw) => tw.workerId),
    );
    return workers.filter((w) => memberIds.has(w.id));
  }, [workers, assignmentTeamFilter, contractorTeamWorkers]);

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
      apiUrl,
      accessToken,
      assignmentScope.contractorId,
      assignmentDateRange.fromDate,
      assignmentDateRange.toDate,
      assignmentWorkerFilter,
      assignmentTeamFilter,
      assignmentShiftFilter,
      assignmentSearchName,
      assignmentPage,
    ],
    queryFn: () =>
      client.listWorkerSchedules(accessToken!, activeSiteId!, {
        offset: assignmentPage * 25,
        limit: 25,
        contractorId: assignmentScope.contractorId,
        fromDate: assignmentDateRange.fromDate,
        toDate: assignmentDateRange.toDate,
        workerId: assignmentWorkerFilter || undefined,
        teamId: assignmentTeamFilter || undefined,
        shiftId: assignmentShiftFilter || undefined,
        searchName: assignmentSearchName || undefined,
      }),
    enabled: Boolean(
      accessToken &&
      activeSiteId &&
      canViewAssignments &&
      assignmentScope.siteId === activeSiteId &&
      assignmentScope.contractorId,
    ),
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
  const [hasShiftBreak, setHasShiftBreak] = useState(false);
  const [shiftBreakStartsAt, setShiftBreakStartsAt] = useState('12:00');
  const [shiftBreakEndsAt, setShiftBreakEndsAt] = useState('13:00');
  const [shiftAllowedExitMinutes, setShiftAllowedExitMinutes] = useState(15);
  const [shiftMaxExitCount, setShiftMaxExitCount] = useState(2);
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

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createShiftMutation = useMutation({
    mutationFn: (input: Parameters<typeof client.createShift>[2]) =>
      client.createShift(accessToken!, activeSiteId!, input),
    onSuccess: (newShift) => {
      setShiftSuccess(tr('schedule_setup_view.shift_created', { name: newShift.name }));
      setShiftError(null);
      setShiftName('');
      setHasShiftBreak(false);
      setShowCreateShiftModal(false);
      queryClient.invalidateQueries({ queryKey: ['shifts', activeSiteId] });
      setTimeout(() => setShiftSuccess(null), 5000);
    },
    onError: (err: unknown) => {
      setShiftSuccess(null);
      if (err instanceof ApiError) {
        setShiftError(err.message);
      } else {
        setShiftError(
          tr('schedule_setup_view.failed_to_create_shift_please_check_input_parameters'),
        );
      }
    },
  });

  const archiveShiftMutation = useMutation({
    mutationFn: (shiftId: string) => client.archiveShift(accessToken!, activeSiteId!, shiftId),
    onSuccess: () => {
      setShiftSuccess(tr('common.shift_archived_successfully'));
      setShiftError(null);
      setShiftToArchive(null);
      setAssignContractorShiftId('');
      queryClient.invalidateQueries({ queryKey: ['shifts', activeSiteId] });
      queryClient.invalidateQueries({ queryKey: ['eligible-shifts'] });
    },
    onError: (err: unknown) => {
      setShiftError(
        err instanceof Error ? err.message : tr('schedule_setup_view.failed_to_archive_shift'),
      );
    },
  });

  const assignShiftToContractorMutation = useMutation({
    mutationFn: ({ shiftId, contractorId }: { shiftId: string; contractorId: string }) =>
      client.assignShiftToContractor(accessToken!, activeSiteId!, shiftId, { contractorId }),
    onSuccess: () => {
      setAssignContractorSuccess(
        tr('schedule_setup_view.shift_assigned_to_contractor_successfully'),
      );
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
        setAssignContractorError(tr('schedule_setup_view.failed_to_assign_shift_to_contractor'));
      }
    },
  });

  const createVersionMutation = useMutation({
    mutationFn: (input: { effectiveFrom: string; effectiveUntil?: string }) =>
      client.createScheduleVersion(accessToken!, activeSiteId!, input),
    onSuccess: (newVersion) => {
      setVersionSuccess(tr('schedule_setup_view.version_created', { version: newVersion.version }));
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
        setVersionError(tr('schedule_setup_view.failed_to_create_schedule_version'));
      }
    },
  });

  // ── Form Handlers ─────────────────────────────────────────────────────────
  const handleCreateShift = (e: React.FormEvent) => {
    e.preventDefault();
    setShiftError(null);
    setShiftSuccess(null);

    if (!activeSiteId) {
      setShiftError(tr('common.no_site_selected_2b1789'));
      return;
    }
    if (!shiftName.trim()) {
      setShiftError(tr('schedule_setup_view.shift_name_is_required'));
      return;
    }
    if (!shiftStartsAt || !shiftEndsAt) {
      setShiftError(tr('schedule_setup_view.start_and_end_times_are_required'));
      return;
    }

    const formatIso = (timeStr: string, isEnd: boolean = false) => {
      const [hhStr, mmStr] = timeStr.split(':');
      const hh = parseInt(hhStr || '0', 10);
      const mm = (mmStr || '00').slice(0, 2);
      const paddedHh = String(hh).padStart(2, '0');
      let day = '01';
      if (isEnd) {
        if (timeStr < shiftStartsAt) {
          day = '02';
        }
      }
      return new Date(`2026-10-${day}T${paddedHh}:${mm}:00+07:00`).toISOString();
    };

    const startsAt = formatIso(shiftStartsAt);
    const endsAt = formatIso(shiftEndsAt, true);
    const breakStartsAt =
      hasShiftBreak && shiftBreakStartsAt ? formatIso(shiftBreakStartsAt, true) : null;
    const breakEndsAt =
      hasShiftBreak && shiftBreakEndsAt ? formatIso(shiftBreakEndsAt, true) : null;
    if (endsAt <= startsAt) {
      setShiftError(tr('schedule_setup_view.shift_end_must_be_after_its_start'));
      return;
    }
    if (
      hasShiftBreak &&
      (!breakStartsAt ||
        !breakEndsAt ||
        breakStartsAt < startsAt ||
        breakEndsAt > endsAt ||
        breakEndsAt <= breakStartsAt)
    ) {
      setShiftError(
        tr(
          'schedule_setup_view.enter_both_break_times_within_the_shift_with_the_end_after_the_start',
        ),
      );
      return;
    }
    createShiftMutation.mutate({
      name: shiftName.trim(),
      startsAt: formatIso(shiftStartsAt, false),
      endsAt: formatIso(shiftEndsAt, true),
      timezone: 'Asia/Ho_Chi_Minh',
      breakStartsAt,
      breakEndsAt,
      ...(shiftAllowedExitMinutes !== 15
        ? { allowedExitMinutes: Number(shiftAllowedExitMinutes) }
        : {}),
      ...(shiftMaxExitCount !== 2 ? { maxExitCount: Number(shiftMaxExitCount) } : {}),
    });
  };

  const handleAssignShiftToContractor = (e: React.FormEvent) => {
    e.preventDefault();
    setAssignContractorError(null);
    setAssignContractorSuccess(null);

    if (!activeSiteId) {
      setAssignContractorError(tr('common.no_site_selected_2b1789'));
      return;
    }
    if (!availableShifts.some((shift) => shift.id === assignContractorShiftId)) {
      setAssignContractorError(tr('schedule_setup_view.please_select_an_available_shift'));
      return;
    }
    if (!assignContractorId) {
      setAssignContractorError(tr('schedule_setup_view.please_select_a_contractor'));
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
      setVersionError(tr('common.no_site_selected_2b1789'));
      return;
    }
    if (!versionFrom) {
      setVersionError(tr('schedule_setup_view.effective_from_date_is_required'));
      return;
    }
    if (versionFrom < currentDateIso()) {
      setVersionError(tr('schedule_setup_view.effective_from_date_cannot_be_in_the_past'));
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

  const openAssignContractorForShift = (shiftId: string) => {
    setAssignContractorShiftId(shiftId);
    setAssignContractorId(contractors[0]?.id || '');
    setAssignContractorError(null);
    setShowAssignContractorModal(true);
  };

  // Filtered shifts
  const filteredShifts = showArchivedShifts ? shifts : availableShifts;

  // Tab items config
  const tabItems = useMemo(() => {
    const items: {
      id: 'shifts' | 'version' | 'assignment';
      label: string;
      count?: number;
      icon?: React.ReactNode;
    }[] = [
      {
        id: 'shifts',
        get label() {
          return tr('common.shifts');
        },
        count: shifts.length,
        icon: <IconClock className="w-3.5 h-3.5 text-[#F66B17]" />,
      },
      {
        id: 'version',
        get label() {
          return tr('common.schedule_versions');
        },
        count: versions.length,
        icon: <IconCalendar className="w-3.5 h-3.5 text-blue-600" />,
      },
    ];
    if (canViewAssignments) {
      items.push({
        id: 'assignment',
        get label() {
          return tr('common.worker_assignment');
        },
        count: schedulesTotal,
        icon: <IconUsers className="w-3.5 h-3.5 text-emerald-600" />,
      });
    }
    return items;
  }, [shifts.length, versions.length, schedulesTotal, canViewAssignments]);

  // ── Access Check ─────────────────────────────────────────────────────────
  if (!canAccess) {
    return (
      <div className="max-w-md mx-auto mt-20 p-8 rounded-2xl bg-white border border-rose-200 text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
          <IconShield className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">{tr('common.access_restricted')}</h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          {tr(
            'schedule_setup_view.schedule_setup_is_reserved_for_contractor_representatives_site_managers_and_admini',
          )}
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
              <span className="text-xs font-semibold text-slate-500">
                {tr('common.workforce_management')}
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[#071A2B]">
              {tr('common.schedule_setup')}
            </h1>
          </div>
        </div>

        {/* Site Switcher & Refresh */}
        <div className="flex flex-wrap items-center gap-2.5 max-w-full">
          {availableSites.length > 1 && (
            <div className="flex items-center gap-1.5 min-w-[200px]">
              <span className="text-xs font-semibold text-slate-500 hidden sm:inline shrink-0">
                {tr('common.site')}
              </span>
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
            {tr('common.refresh')}
          </Button>
        </div>
      </div>

      {/* ── HIGH-END FLOATING TOAST NOTIFICATIONS ───────────────────────── */}
      <div className="fixed top-5 right-5 z-50 flex flex-col gap-3 pointer-events-none max-w-sm sm:max-w-md w-[calc(100vw-2.5rem)]">
        {shiftSuccess && (
          <div
            role="status"
            className="pointer-events-auto relative overflow-hidden rounded-2xl bg-[#071A2B]/95 backdrop-blur-xl border border-white/15 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.35),0_0_0_1px_rgba(16,185,129,0.25)] text-white transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] animate-in slide-in-from-top-4 fade-in"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 gap-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center shadow-[0_0_12px_rgba(16,185,129,0.4)] shrink-0">
                  <IconCheck className="w-4 h-4 text-white" />
                </div>
                <span className="text-xs font-semibold text-slate-100">
                  {localizeMessage(shiftSuccess)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShiftSuccess(null)}
                className="text-slate-400 hover:text-white rounded-lg p-1 transition-colors cursor-pointer"
              >
                <IconX className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {assignContractorSuccess && (
          <div
            role="status"
            className="pointer-events-auto relative overflow-hidden rounded-2xl bg-[#071A2B]/95 backdrop-blur-xl border border-white/15 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.35),0_0_0_1px_rgba(16,185,129,0.25)] text-white transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] animate-in slide-in-from-top-4 fade-in"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 gap-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center shadow-[0_0_12px_rgba(16,185,129,0.4)] shrink-0">
                  <IconCheck className="w-4 h-4 text-white" />
                </div>
                <span className="text-xs font-semibold text-slate-100">
                  {localizeMessage(assignContractorSuccess)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAssignContractorSuccess(null)}
                className="text-slate-400 hover:text-white rounded-lg p-1 transition-colors cursor-pointer"
              >
                <IconX className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {versionSuccess && (
          <div
            role="status"
            className="pointer-events-auto relative overflow-hidden rounded-2xl bg-[#071A2B]/95 backdrop-blur-xl border border-white/15 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.35),0_0_0_1px_rgba(59,130,246,0.25)] text-white transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] animate-in slide-in-from-top-4 fade-in"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 gap-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500 text-white flex items-center justify-center shadow-[0_0_12px_rgba(59,130,246,0.4)] shrink-0">
                  <IconCheck className="w-4 h-4 text-white" />
                </div>
                <span className="text-xs font-semibold text-slate-100">
                  {localizeMessage(versionSuccess)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setVersionSuccess(null)}
                className="text-slate-400 hover:text-white rounded-lg p-1 transition-colors cursor-pointer"
              >
                <IconX className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. Top Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-3.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <span className="text-xs font-medium text-slate-500">
              {tr('common.configured_shifts')}
            </span>
            <p className="text-xl font-bold tracking-tight text-[#071A2B]">{shifts.length}</p>
          </div>
          <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600">
            <IconClock className="w-4 h-4 text-[#F66B17]" />
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-3.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <span className="text-xs font-medium text-slate-500">
              {tr('common.schedule_versions')}
            </span>
            <p className="text-xl font-bold tracking-tight text-[#071A2B]">{versions.length}</p>
          </div>
          <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600">
            <IconCalendar className="w-4 h-4 text-blue-600" />
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-3.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <span className="text-xs font-medium text-slate-500">{tr('common.active_site')}</span>
            <p className="text-sm font-bold tracking-tight text-[#071A2B] truncate max-w-[180px]">
              {activeSite?.name || tr('common.no_site')}
            </p>
          </div>
          <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600">
            <IconBuilding className="w-4 h-4 text-slate-700" />
          </div>
        </div>
      </div>

      {/* 3. Navigation Tabs Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-[#E2E8F0] shadow-xs">
        <Tabs items={tabItems} activeTab={activeTab} onChange={(tab) => setActiveTab(tab)} />

        {/* Tab Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 max-w-full">
          {activeTab === 'shifts' && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={showArchivedShifts}
                onChange={(event) => setShowArchivedShifts(event.target.checked)}
              />
              {tr('common.show_archived')}
            </label>
          )}
          {activeTab === 'shifts' && canManageShiftsAndVersions && (
            <>
              <Button
                variant="outline"
                size="md"
                onClick={() => {
                  setAssignContractorShiftId(availableShifts[0]?.id || '');
                  setAssignContractorId(contractors[0]?.id || '');
                  setAssignContractorError(null);
                  setShowAssignContractorModal(true);
                }}
                disabled={availableShifts.length === 0 || contractors.length === 0}
                leftIcon={<IconBuilding2 className="w-3.5 h-3.5 text-slate-600" />}
              >
                {tr('common.assign_contractor')}
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
                {tr('common.new_shift')}
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
              {tr('common.new_version')}
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
              <span>{tr('common.loading_shift_schedules')}</span>
            </div>
          ) : filteredShifts.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs">
              <EmptyState
                icon={<IconClock className="w-6 h-6 text-[#F66B17]" />}
                title={tr('common.no_available_shifts')}
                description={
                  canManageShiftsAndVersions
                    ? tr(
                        'schedule_setup_view.define_operational_shifts_with_specific_hours_and_timezones_for_this_site',
                      )
                    : tr(
                        'schedule_setup_view.the_site_manager_has_not_configured_any_shifts_for_this_site_yet',
                      )
                }
                actionLabel={
                  canManageShiftsAndVersions ? tr('common.create_first_shift') : undefined
                }
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
                          {shift.archivedAt && (
                            <Badge variant="neutral">{tr('common.archived')}</Badge>
                          )}
                        </div>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5 font-mono text-[11.5px] font-medium text-slate-700 bg-slate-50 border border-[#E2E8F0] px-2.5 py-1 rounded-lg w-fit">
                            <IconClock className="w-3 h-3 text-slate-400" />
                            <span>
                              {formatShiftRange(shift.startsAt, shift.endsAt, shift.timezone)}
                              {shift.breakStartsAt && shift.breakEndsAt && (
                                <span className="block text-xs text-slate-500">
                                  {tr('common.unpaid_break_value', {
                                    value1: formatShiftRange(
                                      shift.breakStartsAt,
                                      shift.breakEndsAt,
                                      shift.timezone,
                                    ),
                                  })}
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="text-[11.5px] text-slate-500">
                            {tr('schedule_setup_view.exit_policy_badge', {
                              minutes: shift.allowedExitMinutes ?? 15,
                              count: shift.maxExitCount ?? 2,
                            })}
                          </div>
                        </div>
                      </div>

                      {canManageShiftsAndVersions && (
                        <div className="flex items-center gap-2">
                          {!shift.archivedAt && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setShiftError(null);
                                setShiftToArchive({ id: shift.id, name: shift.name });
                              }}
                            >
                              {tr('common.archive')}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Assigned Contractors Section */}
                    <div className="pt-2 border-t border-slate-100 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {tr('common.assigned_contractors_value', {
                            value1: assignedContractorList.length,
                          })}
                        </span>
                        {canManageShiftsAndVersions && !shift.archivedAt && (
                          <button
                            type="button"
                            onClick={() => openAssignContractorForShift(shift.id)}
                            className="text-[11px] font-bold text-[#F66B17] hover:underline cursor-pointer"
                          >
                            {tr('common.assign')}
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {assignedContractorList.length === 0 ? (
                          <span className="text-[11px] text-slate-400 italic">
                            {tr('common.no_contractor_assigned')}
                          </span>
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
        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-xs overflow-hidden">
          {versionsQuery.isLoading ? (
            <div className="py-16 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
              <IconLoader className="w-5 h-5 animate-spin text-slate-500" />
              <span>{tr('common.loading_schedule_versions')}</span>
            </div>
          ) : versions.length === 0 ? (
            <EmptyState
              icon={<IconCalendar className="w-6 h-6 text-blue-600" />}
              title={tr('common.no_schedule_versions')}
              description={
                canManageShiftsAndVersions
                  ? tr(
                      'schedule_setup_view.create_a_schedule_version_defining_effective_date_ranges_before_assigning_worker_s',
                    )
                  : tr('schedule_setup_view.no_active_schedule_versions_found_for_this_site')
              }
              actionLabel={canManageShiftsAndVersions ? tr('common.create_new_version') : undefined}
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
                    <th className="py-3 px-4">{tr('common.version')}</th>
                    <th className="py-3 px-4">{tr('common.effective_from')}</th>
                    <th className="py-3 px-4">{tr('common.effective_until')}</th>
                    <th className="py-3 px-4">{tr('common.status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {versions.map((ver) => (
                    <tr key={ver.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        {tr('common.version_value', { value1: ver.version })}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-700">
                        {new Date(ver.effectiveFrom).toLocaleDateString(uiLocale())}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-700">
                        {ver.effectiveUntil
                          ? new Date(ver.effectiveUntil).toLocaleDateString(uiLocale())
                          : tr('schedule_setup_view.ongoing_no_end_date')}
                      </td>
                      <td className="py-3.5 px-4">
                        <Badge variant="success" dot>
                          {tr('common.active')}
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
      {activeTab === 'assignment' && canViewAssignments && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Assignment Form Card (4 cols) - Double-Bezel Architecture */}
          <div className="lg:col-span-4 rounded-3xl p-1.5 bg-gradient-to-b from-slate-100 to-slate-200/70 border border-slate-200/80 shadow-xs">
            <div className="bg-white rounded-[22px] p-5 border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-4">
              {!canAssignWorker && isManager && (
                <label>
                  {tr('common.contractor')}
                  <select
                    aria-label={tr('common.contractor')}
                    value={assignmentScope.contractorId}
                    onChange={(e) =>
                      setAssignmentScope({ siteId: activeSiteId!, contractorId: e.target.value })
                    }
                  >
                    {readOptions.map((o) => (
                      <option key={o.contractorId} value={o.contractorId}>
                        {o.contractorName}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {canAssignWorker && (
                <ScheduleAssignmentForm
                  key={activeSiteId}
                  apiUrl={apiUrl}
                  token={accessToken!}
                  siteId={activeSiteId!}
                  shifts={availableShifts}
                  versions={versions}
                  onScopeChange={setAssignmentScope}
                />
              )}
            </div>
          </div>

          {/* Existing Schedules Table (8 cols) - Double-Bezel Architecture */}
          <div className="lg:col-span-8 rounded-3xl p-1.5 bg-gradient-to-b from-slate-100 to-slate-200/70 border border-slate-200/80 shadow-xs">
            <div className="bg-white rounded-[22px] border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
              <div className="p-4 border-b border-slate-100/80 bg-slate-50/40 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                      {tr('common.assigned_schedules')}
                    </h3>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200/80">
                      {schedulesTotal}
                    </span>
                  </div>
                  {schedulesQuery.isFetching && (
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      <IconLoader className="w-3.5 h-3.5 text-slate-400 animate-spin" />
                      <span>{tr('common.syncing')}</span>
                    </div>
                  )}
                </div>

                {/* Range pills - Modern Segmented Control */}
                <div className="inline-flex items-center p-1 bg-slate-100/80 rounded-xl gap-1 border border-slate-200/50">
                  {(
                    [
                      ['TODAY', tr('common.today')],
                      ['WEEK', tr('common.this_week')],
                      ['MONTH', tr('common.this_month')],
                      ['CUSTOM', tr('common.custom_range')],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setAssignmentRange(value);
                        resetAssignmentPage();
                      }}
                      className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all cursor-pointer ${
                        assignmentRange === value
                          ? 'bg-white text-[#071A2B] shadow-xs ring-1 ring-slate-900/5'
                          : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {assignmentRange === 'CUSTOM' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-xl bg-slate-50/80 border border-slate-200/70">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {tr('common.from')}
                      <input
                        type="date"
                        value={assignmentFromDate}
                        onChange={(event) => {
                          setAssignmentFromDate(event.target.value);
                          resetAssignmentPage();
                        }}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-[inset_0_1px_1px_rgba(0,0,0,0.02)] outline-none focus:border-[#071A2B] focus:ring-2 focus:ring-slate-900/10 transition-all"
                      />
                    </label>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {tr('common.to')}
                      <input
                        type="date"
                        value={assignmentToDate}
                        onChange={(event) => {
                          setAssignmentToDate(event.target.value);
                          resetAssignmentPage();
                        }}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-[inset_0_1px_1px_rgba(0,0,0,0.02)] outline-none focus:border-[#071A2B] focus:ring-2 focus:ring-slate-900/10 transition-all"
                      />
                    </label>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  <div>
                    <SmartSelect
                      label={tr('common.team')}
                      size="sm"
                      value={assignmentTeamFilter}
                      onChange={(val) => {
                        setAssignmentTeamFilter(val);
                        if (val && assignmentWorkerFilter) {
                          const isStillValid = contractorTeamWorkers.some(
                            (tw) => tw.teamId === val && tw.workerId === assignmentWorkerFilter,
                          );
                          if (!isStillValid) setAssignmentWorkerFilter('');
                        }
                        resetAssignmentPage();
                      }}
                      options={[
                        {
                          value: '',
                          get label() {
                            return tr('common.all_teams_bf65fc');
                          },
                        },
                        ...contractorTeams.map((team) => ({
                          value: team.id,
                          label: team.name,
                          get badge() {
                            return tr('common.value_membervalue', {
                              value1: team.memberCount,
                              value2: team.memberCount === 1 ? '' : 's',
                            });
                          },
                        })),
                      ]}
                    />
                  </div>
                  <div>
                    <SmartSelect
                      label={tr('common.worker')}
                      size="sm"
                      searchable
                      searchPlaceholder={tr('common.filter_worker')}
                      value={assignmentWorkerFilter}
                      onChange={(val) => {
                        setAssignmentWorkerFilter(val);
                        resetAssignmentPage();
                      }}
                      options={[
                        {
                          value: '',
                          get label() {
                            return tr('common.all_workers_499a01');
                          },
                        },
                        ...visibleWorkers.map((worker) => ({
                          value: worker.id,
                          label: worker.displayName,
                          badge: worker.externalId || worker.id.slice(0, 6),
                        })),
                      ]}
                    />
                  </div>
                  <div>
                    <SmartSelect
                      label={tr('common.shift')}
                      size="sm"
                      value={assignmentShiftFilter}
                      onChange={(val) => {
                        setAssignmentShiftFilter(val);
                        resetAssignmentPage();
                      }}
                      options={[
                        {
                          value: '',
                          get label() {
                            return tr('common.all_shifts');
                          },
                        },
                        ...shifts.map((shift) => ({
                          value: shift.id,
                          label: shift.name,
                          description: formatShiftRange(
                            shift.startsAt,
                            shift.endsAt,
                            shift.timezone,
                          ),
                        })),
                      ]}
                    />
                  </div>
                  <div>
                    <SmartInput
                      id="search-name-input"
                      label={tr('common.search_name')}
                      placeholder={tr('schedule_setup_view.worker_name_or_id')}
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
                  <span>{tr('common.loading_worker_schedules')}</span>
                </div>
              ) : schedules.length === 0 ? (
                <div className="py-12 px-4 text-center space-y-2">
                  <p className="text-xs text-slate-500">
                    {tr('schedule_setup_view.no_worker_schedules_assigned_yet')}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[480px]">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-xs border-b border-slate-100 z-10">
                      <tr className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-4">{tr('common.worker')}</th>
                        <th className="py-3 px-4">{tr('common.shift')}</th>
                        <th className="py-3 px-4">{tr('common.work_date_f7426e')}</th>
                        <th className="py-3 px-4">{tr('common.status')}</th>
                        <th className="py-3 px-4">{tr('common.created')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {groupedAssignmentSchedules.map(([date, dateSchedules]) => {
                        const collapsed = collapsedAssignmentDates.has(date);
                        return (
                          <React.Fragment key={date}>
                            <tr className="bg-slate-50/70 border-y border-slate-100/80">
                              <td colSpan={5} className="px-4 py-2">
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
                                  className="flex w-full items-center justify-between text-left group cursor-pointer"
                                >
                                  <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-1.5 text-slate-800">
                                      <IconCalendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                      <span className="font-mono text-[11px] font-bold">
                                        {formatWorkDate(date)}
                                      </span>
                                    </div>
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white border border-slate-200 text-slate-600 shadow-2xs">
                                      {tr('common.value_schedule_s', {
                                        value1: dateSchedules.length,
                                      })}
                                    </span>
                                  </div>
                                  <span className="text-xs font-bold text-slate-400 group-hover:text-slate-600">
                                    {collapsed ? '+' : '−'}
                                  </span>
                                </button>
                              </td>
                            </tr>
                            {!collapsed &&
                              dateSchedules.map((sched) => {
                                const workerObj = workers.find((w) => w.id === sched.workerId);
                                const shiftObj = shifts.find((s) => s.id === sched.shiftId);
                                const workerTeam = contractorTeamWorkers.find(
                                  (tw) => tw.workerId === sched.workerId,
                                );
                                return (
                                  <tr
                                    key={sched.id}
                                    className="hover:bg-slate-50/70 transition-colors"
                                  >
                                    <td className="py-3 px-4">
                                      <div className="flex flex-wrap items-center gap-2.5 max-w-full">
                                        <div className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200/80 flex items-center justify-center text-[10px] font-bold text-slate-700 shrink-0">
                                          {(workerObj?.displayName || 'W').charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                          <span className="font-bold text-slate-900 block leading-tight">
                                            {workerObj?.displayName ||
                                              tr('common.worker_value', {
                                                value1: sched.workerId.slice(0, 6),
                                              })}
                                          </span>
                                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                            {workerObj?.externalId && (
                                              <span className="text-[10px] font-mono text-slate-400">
                                                #{workerObj.externalId}
                                              </span>
                                            )}
                                            {workerTeam?.teamName && (
                                              <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/70">
                                                {workerTeam.teamName}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="py-3 px-4">
                                      <div className="inline-flex flex-wrap items-center gap-2.5 max-w-full px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-50/90 to-indigo-50/80 border border-blue-200/90 shadow-2xs hover:shadow-xs transition-shadow">
                                        <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0 shadow-xs">
                                          <IconClock className="w-3.5 h-3.5" />
                                        </div>
                                        <div className="min-w-0">
                                          <span className="font-bold text-slate-900 block text-xs leading-tight tracking-tight">
                                            {shiftObj?.name || tr('common.shift')}
                                          </span>
                                          {shiftObj && (
                                            <span className="text-[10px] font-mono font-bold text-blue-700 block mt-0.5 leading-none">
                                              {formatShiftRange(
                                                shiftObj.startsAt,
                                                shiftObj.endsAt,
                                                shiftObj.timezone,
                                              )}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="py-3 px-4 font-mono font-semibold text-slate-800">
                                      {formatWorkDate(sched.workDate)}
                                    </td>
                                    <td className="py-3 px-4">
                                      <span
                                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase ${
                                          sched.isActive
                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
                                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                                        }`}
                                      >
                                        <span
                                          className={`w-1.5 h-1.5 rounded-full ${
                                            sched.isActive
                                              ? 'bg-emerald-500 ring-2 ring-emerald-300/40'
                                              : 'bg-slate-400'
                                          }`}
                                        />
                                        {sched.isActive
                                          ? tr('common.active')
                                          : tr('common.inactive_ac7c94')}
                                      </span>
                                    </td>
                                    <td className="py-3 px-4 text-slate-400 text-[11px] font-mono">
                                      {new Date(sched.createdAt).toLocaleDateString(uiLocale())}
                                    </td>
                                  </tr>
                                );
                              })}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100/90 bg-slate-50/50 px-4 py-3 text-[11px] text-slate-500">
                    <span className="font-medium">
                      {tr('common.page')}{' '}
                      <strong className="text-slate-800">{assignmentPage + 1}</strong>{' '}
                      {tr('common.of')}{' '}
                      <strong className="text-slate-800">{assignmentPageCount}</strong>{' '}
                      {tr('schedule_setup_view.25_per_page')}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={assignmentPage === 0}
                        onClick={() => setAssignmentPage((page) => Math.max(0, page - 1))}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 transition-all cursor-pointer shadow-2xs"
                      >
                        {tr('common.previous')}
                      </button>
                      <button
                        type="button"
                        disabled={assignmentPage + 1 >= assignmentPageCount}
                        onClick={() =>
                          setAssignmentPage((page) => Math.min(assignmentPageCount - 1, page + 1))
                        }
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 transition-all cursor-pointer shadow-2xs"
                      >
                        {tr('common.next')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 1: Create Shift Dialog ───────────────────────────────────── */}
      <Dialog
        open={showCreateShiftModal}
        onClose={() => setShowCreateShiftModal(false)}
        title={tr('common.create_new_shift')}
        description={tr('schedule_setup_view.define_work_shift_hours_on_value', {
          value1: activeSite?.name,
        })}
        icon={<IconClock className="w-4 h-4 text-[#F66B17]" />}
      >
        <form onSubmit={handleCreateShift} className="space-y-4">
          {shiftError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs">
              <IconAlertCircle className="w-4 h-4 shrink-0" />
              <span>{localizedError(shiftError ?? undefined)}</span>
            </div>
          )}

          <div className="space-y-1">
            <SmartInput
              id="shift-name-input"
              label={tr('common.shift_name')}
              fieldRequired
              type="text"
              placeholder={tr('schedule_setup_view.e_g_day_shift_ca_sang')}
              value={shiftName}
              onChange={(e) => setShiftName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div className="space-y-1">
              <SmartTimePicker
                id="shift-starts-at-input"
                label={tr('common.starts_at')}
                fieldRequired
                value={shiftStartsAt}
                onChange={setShiftStartsAt}
              />
            </div>

            <div className="space-y-1">
              <SmartTimePicker
                id="shift-ends-at-input"
                label={tr('common.ends_at')}
                fieldRequired
                value={shiftEndsAt}
                onChange={setShiftEndsAt}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hasShiftBreak}
              onChange={(e) => setHasShiftBreak(e.target.checked)}
            />
            {tr('schedule_setup_view.include_an_unpaid_lunch_break')}
          </label>
          {hasShiftBreak && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3.5">
                <SmartTimePicker
                  id="shift-break-start-input"
                  label={tr('common.break_starts_at')}
                  fieldRequired
                  value={shiftBreakStartsAt}
                  onChange={setShiftBreakStartsAt}
                />
                <SmartTimePicker
                  id="shift-break-end-input"
                  label={tr('common.break_ends_at')}
                  fieldRequired
                  value={shiftBreakEndsAt}
                  onChange={setShiftBreakEndsAt}
                />
              </div>
              <p className="text-xs text-slate-500">
                {tr(
                  'schedule_setup_view.only_break_time_overlapping_actual_presence_is_deducted_times_use_asia_ho_chi_minh',
                )}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3.5 pt-2 border-t border-slate-100">
            <div className="space-y-1">
              <label
                htmlFor="shift-allowed-exit-minutes"
                className="block text-xs font-medium text-slate-700"
              >
                {tr('schedule_setup_view.allowed_exit_minutes')}
              </label>
              <input
                id="shift-allowed-exit-minutes"
                type="number"
                min={0}
                max={120}
                className="w-full px-3 py-2 text-sm border rounded-xl border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#F66B17]/20 focus:border-[#F66B17]"
                value={shiftAllowedExitMinutes}
                onChange={(e) => setShiftAllowedExitMinutes(parseInt(e.target.value, 10) || 0)}
              />
              <p className="text-[11px] text-slate-500">
                {tr('schedule_setup_view.allowed_exit_minutes_desc')}
              </p>
            </div>
            <div className="space-y-1">
              <label
                htmlFor="shift-max-exit-count"
                className="block text-xs font-medium text-slate-700"
              >
                {tr('schedule_setup_view.max_exit_count')}
              </label>
              <input
                id="shift-max-exit-count"
                type="number"
                min={0}
                max={10}
                className="w-full px-3 py-2 text-sm border rounded-xl border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#F66B17]/20 focus:border-[#F66B17]"
                value={shiftMaxExitCount}
                onChange={(e) => setShiftMaxExitCount(parseInt(e.target.value, 10) || 0)}
              />
              <p className="text-[11px] text-slate-500">
                {tr('schedule_setup_view.max_exit_count_desc')}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="outline" size="md" onClick={() => setShowCreateShiftModal(false)}>
              {tr('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant="default"
              size="md"
              isLoading={createShiftMutation.isPending}
              leftIcon={<IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />}
            >
              {tr('common.create_shift')}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ── MODAL 2: Assign Shift to Contractor Dialog ─────────────────────── */}
      <Dialog
        open={showAssignContractorModal}
        onClose={() => setShowAssignContractorModal(false)}
        title={tr('schedule_setup_view.assign_shift_to_contractor')}
        description={tr('schedule_setup_view.allow_subcontractor_workers_to_take_this_shift')}
        icon={<IconBuilding2 className="w-4 h-4 text-[#F66B17]" />}
      >
        <form onSubmit={handleAssignShiftToContractor} className="space-y-4">
          {assignContractorError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs">
              <IconAlertCircle className="w-4 h-4 shrink-0" />
              <span>{localizedError(assignContractorError ?? undefined)}</span>
            </div>
          )}

          <div className="space-y-1">
            <SmartSelect
              id="assign-contractor-shift-select"
              label={tr('common.target_shift')}
              fieldRequired
              value={assignContractorShiftId}
              onChange={setAssignContractorShiftId}
              options={availableShifts.map((s) => ({
                value: s.id,
                label: `${s.name} (${formatShiftRange(s.startsAt, s.endsAt, s.timezone)})`,
              }))}
            />
          </div>

          <div className="space-y-1">
            <SmartSelect
              id="assign-contractor-select"
              label={tr('common.subcontractor')}
              fieldRequired
              value={assignContractorId}
              onChange={setAssignContractorId}
              options={contractors.map((c) => ({
                value: c.id,
                label: `${c.name} (${c.code})`,
              }))}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="outline" size="md" onClick={() => setShowAssignContractorModal(false)}>
              {tr('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant="default"
              size="md"
              isLoading={assignShiftToContractorMutation.isPending}
              leftIcon={<IconCheck className="w-3.5 h-3.5 text-[#F66B17]" />}
            >
              {tr('common.assign_contractor')}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ── MODAL 3: Create Schedule Version Dialog ─────────────────────────── */}
      <Dialog
        open={showCreateVersionModal}
        onClose={() => setShowCreateVersionModal(false)}
        title={tr('common.create_schedule_version')}
        description={tr('schedule_setup_view.define_a_new_planning_period_on_this_site')}
        icon={<IconCalendar className="w-4 h-4 text-[#F66B17]" />}
      >
        <form onSubmit={handleCreateVersion} className="space-y-4">
          {versionError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs">
              <IconAlertCircle className="w-4 h-4 shrink-0" />
              <span>{localizedError(versionError ?? undefined)}</span>
            </div>
          )}

          <div className="space-y-1">
            <SmartDatePicker
              id="version-from-input"
              label={tr('common.effective_from')}
              fieldRequired
              value={versionFrom}
              onChange={setVersionFrom}
            />
          </div>

          <div className="space-y-1">
            <SmartDatePicker
              id="version-until-input"
              label={tr('common.effective_until_optional')}
              value={versionUntil}
              onChange={setVersionUntil}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="outline" size="md" onClick={() => setShowCreateVersionModal(false)}>
              {tr('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant="default"
              size="md"
              isLoading={createVersionMutation.isPending}
              leftIcon={<IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />}
            >
              {tr('common.create_version')}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(shiftToArchive)}
        onClose={() => setShiftToArchive(null)}
        title={tr('common.archive_shift')}
        description={tr('schedule_setup_view.stop_using_this_shift_for_new_assignments')}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {tr(
              'schedule_setup_view.archive_quot_value_quot_existing_schedules_attendance_and_request_history_will_be',
              { value1: shiftToArchive?.name },
            )}
          </p>
          {shiftError && (
            <p role="alert" className="text-sm text-rose-600">
              {localizedError(shiftError ?? undefined)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="md" onClick={() => setShiftToArchive(null)}>
              {tr('common.cancel')}
            </Button>
            <Button
              size="md"
              isLoading={archiveShiftMutation.isPending}
              onClick={() => shiftToArchive && archiveShiftMutation.mutate(shiftToArchive.id)}
            >
              {tr('common.archive_shift')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
