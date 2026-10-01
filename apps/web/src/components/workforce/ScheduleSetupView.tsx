import React, { useState, useEffect } from 'react';
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
  IconCheck,
  IconTrash,
} from '../icons';
import { SmartButton, formatShiftTime } from './WorkforceSharedUI';
import {
  SmartInput,
  SmartSelect,
  SmartDatePicker,
  SmartTimePicker,
  SmartCheckbox,
} from '../ui/SmartFormControls';

interface ScheduleSetupViewProps {
  apiUrl: string;
}

export function ScheduleSetupView({ apiUrl }: ScheduleSetupViewProps) {
  const { accessToken } = useAuth();
  const { data: currentUser } = useCurrentUser(apiUrl);
  const queryClient = useQueryClient();
  const client = new SmartSiteManagementClient(apiUrl);

  const roleAssignments = currentUser?.roleAssignments ?? [];
  const roles = roleAssignments.map((r) => r.role);
  const isAdmin = roles.includes('ADMIN');
  const isManager = roles.includes('SITE_MANAGER') || isAdmin;

  // Site Scope Determination
  const managerSiteIds = roleAssignments
    .filter((r) => r.role === 'SITE_MANAGER' || r.role === 'ADMIN')
    .map((r) => r.siteId)
    .filter((id): id is string => id !== null && id !== undefined);

  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'shifts' | 'version' | 'assignment'>('shifts');
  const [shiftToDelete, setShiftToDelete] = useState<{ id: string; name: string } | null>(null);

  // ── Query Sites ─────────────────────────────────────────────────────────
  const sitesQuery = useQuery({
    queryKey: ['sites', 'schedule-setup'],
    queryFn: async () => {
      if (isAdmin) {
        const res = await client.listSites(accessToken!);
        return res.items;
      }
      // For Site Manager: fetch each assigned site detail
      const sitePromises = managerSiteIds.map((sId) =>
        client.getSite(accessToken!, sId).catch(() => null)
      );
      const sites = await Promise.all(sitePromises);
      return sites.filter((s): s is NonNullable<typeof s> => s !== null);
    },
    enabled: Boolean(accessToken && isManager),
  });

  const availableSites = React.useMemo(() => sitesQuery.data ?? [], [sitesQuery.data]);
  const activeSiteId = selectedSiteId ?? availableSites[0]?.id ?? null;
  const activeSite = React.useMemo(() => availableSites.find((s) => s.id === activeSiteId) ?? null, [availableSites, activeSiteId]);

  useEffect(() => {
    if (!selectedSiteId && availableSites.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedSiteId(availableSites[0]!.id);
    }
  }, [availableSites, selectedSiteId]);

  // ── Queries for Selected Site ───────────────────────────────────────────
  const shiftsQuery = useQuery({
    queryKey: ['shifts', activeSiteId],
    queryFn: () => client.listShifts(accessToken!, activeSiteId!),
    enabled: Boolean(accessToken && activeSiteId),
  });

  const versionsQuery = useQuery({
    queryKey: ['scheduleVersions', activeSiteId],
    queryFn: () => client.listScheduleVersions(accessToken!, activeSiteId!),
    enabled: Boolean(accessToken && activeSiteId),
  });

  const workersQuery = useQuery({
    queryKey: ['workers', activeSiteId],
    queryFn: () => client.listWorkers(accessToken!, activeSiteId!, { offset: 0, limit: 100 }),
    enabled: Boolean(accessToken && activeSiteId),
  });

  const contractorsQuery = useQuery({
    queryKey: ['contractors', activeSiteId],
    queryFn: () => client.listContractors(accessToken!, activeSiteId!),
    enabled: Boolean(accessToken && activeSiteId),
  });

  const schedulesQuery = useQuery({
    queryKey: ['workerSchedules', activeSiteId],
    queryFn: () => client.listWorkerSchedules(accessToken!, activeSiteId!, { offset: 0, limit: 100 }),
    enabled: Boolean(accessToken && activeSiteId),
  });

  const shifts = React.useMemo(() => shiftsQuery.data?.items ?? [], [shiftsQuery.data?.items]);
  const versions = React.useMemo(() => versionsQuery.data?.items ?? [], [versionsQuery.data?.items]);
  const workers = React.useMemo(() => workersQuery.data?.items ?? [], [workersQuery.data?.items]);
  const contractors = React.useMemo(() => contractorsQuery.data?.items ?? [], [contractorsQuery.data?.items]);
  const schedules = React.useMemo(() => schedulesQuery.data?.items ?? [], [schedulesQuery.data?.items]);

  // Selected schedule version state for Worker Schedule Assignment
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedVersionId && versions.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedVersionId(versions[0]!.id);
    }
  }, [versions, selectedVersionId]);

  // ── Form States ──────────────────────────────────────────────────────────

  // 1. Shift Form
  const [shiftName, setShiftName] = useState('Morning');
  const [shiftStartsAt, setShiftStartsAt] = useState('08:00');
  const [shiftEndsAt, setShiftEndsAt] = useState('16:00');
  const SHIFT_TIMEZONES = [
    { value: 'Asia/Ho_Chi_Minh', label: 'Asia/Ho_Chi_Minh (UTC+7)' },
    { value: 'UTC', label: 'UTC (GMT+0)' },
    { value: 'Asia/Bangkok', label: 'Asia/Bangkok (UTC+7)' },
    { value: 'Asia/Singapore', label: 'Asia/Singapore (UTC+8)' },
    { value: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+9)' },
  ];
  const [shiftTimezone, setShiftTimezone] = useState('Asia/Ho_Chi_Minh');
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [shiftSuccess, setShiftSuccess] = useState<string | null>(null);

  // 2. Schedule Version Form
  const [versionFrom, setVersionFrom] = useState('2026-10-01');
  const [versionUntil, setVersionUntil] = useState('2026-12-31');
  const [untilInclusive, setUntilInclusive] = useState(true);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [versionSuccess, setVersionSuccess] = useState<string | null>(null);

  // 3. Worker Schedule Form
  const [assignWorkerId, setAssignWorkerId] = useState('');
  const [assignWorkDate, setAssignWorkDate] = useState('2026-10-01');
  const [assignShiftId, setAssignShiftId] = useState('');
  const [assignIsActive, setAssignIsActive] = useState(true);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null);

  // A worker may be assigned to multiple different shifts on the same day,
  // but must not be offered again for the exact same active shift.
  const assignedWorkerIdsForSelectedShift = React.useMemo(() => {
    if (!assignWorkDate || !assignShiftId) return new Set<string>();
    return new Set(
      schedules
        .filter(
          (schedule) =>
            schedule.isActive &&
            schedule.workDate === assignWorkDate &&
            schedule.shiftId === assignShiftId,
        )
        .map((schedule) => schedule.workerId),
    );
  }, [assignShiftId, assignWorkDate, schedules]);

  const availableWorkers = React.useMemo(
    () => workers.filter((worker) => !assignedWorkerIdsForSelectedShift.has(worker.id)),
    [assignedWorkerIdsForSelectedShift, workers],
  );

  useEffect(() => {
    if (assignWorkerId && assignedWorkerIdsForSelectedShift.has(assignWorkerId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAssignWorkerId('');
    }
  }, [assignWorkerId, assignedWorkerIdsForSelectedShift]);

  // ── Mutations ────────────────────────────────────────────────────────────

  const createShiftMutation = useMutation({
    mutationFn: (input: { name: string; startsAt: string; endsAt: string; timezone: string }) =>
      client.createShift(accessToken!, activeSiteId!, input),
    onSuccess: (newShift) => {
      setShiftError(null);
      setShiftSuccess(`Shift "${newShift.name}" created successfully.`);
      queryClient.invalidateQueries({ queryKey: ['shifts', activeSiteId] });
    },
    onError: (err: unknown) => {
      setShiftSuccess(null);
      if (err instanceof ApiError) {
        if (err.status === 400) setShiftError(`Validation Error (400): ${err.message}`);
        else if (err.status === 403) setShiftError('Forbidden (403): You do not have permission for this site.');
        else if (err.status === 409) setShiftError(`Conflict (409): ${err.message}`);
        else setShiftError(err.message);
      } else {
        setShiftError('Failed to create shift. Please check input parameters.');
      }
    },
  });

  const deleteShiftMutation = useMutation({
    mutationFn: (shiftId: string) => client.deleteShift(accessToken!, activeSiteId!, shiftId),
    onSuccess: () => {
      setShiftError(null);
      setShiftSuccess('Shift deleted successfully.');
      queryClient.invalidateQueries({ queryKey: ['shifts', activeSiteId] });
    },
    onError: (err: unknown) => {
      setShiftSuccess(null);
      if (err instanceof ApiError) {
        if (err.status === 409) setShiftError(`Cannot delete shift: ${err.message}`);
        else if (err.status === 403) setShiftError('Forbidden (403): You do not have permission for this site.');
        else setShiftError(err.message);
      } else {
        setShiftError('Failed to delete shift. Please try again.');
      }
    },
  });

  const createVersionMutation = useMutation({
    mutationFn: (input: { effectiveFrom: string; effectiveUntil?: string }) =>
      client.createScheduleVersion(accessToken!, activeSiteId!, input),
    onSuccess: (newVersion) => {
      setVersionError(null);
      setVersionSuccess(`Schedule Version #${newVersion.version} created successfully.`);
      queryClient.invalidateQueries({ queryKey: ['scheduleVersions', activeSiteId] });
      setSelectedVersionId(newVersion.id);
    },
    onError: (err: unknown) => {
      setVersionSuccess(null);
      if (err instanceof ApiError) {
        if (err.status === 400) setVersionError(`Validation Error (400): ${err.message}`);
        else if (err.status === 403) setVersionError('Forbidden (403): Unauthorized site access.');
        else setVersionError(err.message);
      } else {
        setVersionError('Failed to create schedule version.');
      }
    },
  });

  const createWorkerScheduleMutation = useMutation({
    mutationFn: (input: { workerId: string; shiftId: string; workDate: string; isActive?: boolean }) =>
      client.createWorkerSchedule(accessToken!, activeSiteId!, selectedVersionId!, input),
    onSuccess: () => {
      setAssignError(null);
      setAssignSuccess('Worker schedule assigned successfully!');
      queryClient.invalidateQueries({ queryKey: ['workerSchedules', activeSiteId] });
    },
    onError: (err: unknown) => {
      setAssignSuccess(null);
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setAssignError(`Conflict Error (409): Worker already has an assigned shift on this date (${assignWorkDate}).`);
        } else if (err.status === 400) {
          setAssignError(`Validation Error (400): ${err.message}`);
        } else if (err.status === 403) {
          setAssignError('Forbidden (403): You cannot assign schedules for this site.');
        } else {
          setAssignError(err.message);
        }
      } else {
        setAssignError('Failed to assign worker schedule.');
      }
    },
  });

  // ── Access Check ─────────────────────────────────────────────────────────
  if (!isManager) {
    return (
      <div className="max-w-xl mx-auto mt-20 p-8 rounded-[1.25rem] bg-red-50 border border-red-200 text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-[1.25rem] bg-red-100 text-red-600 mx-auto flex items-center justify-center">
          <IconShield className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-red-900">Access Denied</h2>
        <p className="text-sm text-red-700 leading-relaxed">
          Schedule Setup is reserved for Site Managers and Administrators. Workers can view their schedules in the "My Schedule & Requests" section.
        </p>
      </div>
    );
  }

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
      setShiftError('Starts at and Ends at are required.');
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

    if (!shiftTimezone.trim()) {
      setShiftError('Timezone is required.');
      return;
    }

    createShiftMutation.mutate({
      name: shiftName.trim(),
      startsAt: formatIso(shiftStartsAt, false),
      endsAt: formatIso(shiftEndsAt, true),
      timezone: shiftTimezone.trim(),
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

    const fromDate = new Date(`${versionFrom}T00:00:00.000Z`).toISOString();
    let untilDate: string | undefined = undefined;

    if (versionUntil) {
      if (untilInclusive && versionUntil === '2026-12-31') {
        // Special requirement requirement handling: "đến hết ngày 31/12" -> 01/01/2027 00:00:00 UTC
        untilDate = '2027-01-01T00:00:00.000Z';
      } else if (untilInclusive) {
        // Add +1 day UTC for inclusive end date
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
      setAssignError('Please create and select a Schedule Version first.');
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
      setAssignError('Please enter a Work Date.');
      return;
    }

    createWorkerScheduleMutation.mutate({
      workerId: assignWorkerId,
      shiftId: assignShiftId,
      workDate: assignWorkDate,
      isActive: assignIsActive,
    });
  };

  // Helper resolvers
  const getContractorName = (cId?: string | null) => {
    if (!cId) return 'Direct / Unassigned';
    return contractors.find((c) => c.id === cId)?.name ?? `Contractor (${cId.slice(0, 6)})`;
  };

  const getShiftName = (sId: string) => {
    const s = shifts.find((sh) => sh.id === sId);
    if (!s) return sId;
    return `${s.name} (${formatShiftTime(s.startsAt)} - ${formatShiftTime(s.endsAt)})`;
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]">

      {/* ── PAGE HEADER ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[#DCE6EF]/70">
        {/* Left: Title */}
        <div>
          <h1 className="text-xl font-black tracking-tight text-[#071A2B] leading-none">
            Schedule &amp; Shift Setup
          </h1>
          <p className="text-xs text-[#607A96] mt-1">
            Configure site shifts, schedule versions, and assign daily worker schedules.
          </p>
        </div>

        {/* Right: Site Scope */}
        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-white border border-[#DCE6EF] rounded-xl shadow-[0_2px_8px_rgba(7,26,43,0.04)] min-w-[240px]">
          <div className="w-7 h-7 rounded-lg bg-[#F5F8FB] border border-[#DCE6EF] flex items-center justify-center shrink-0">
            <IconBuilding className="w-3.5 h-3.5 text-[#607A96]" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-[#94A3B8] leading-none mb-0.5">
              Active Site
            </span>
            {sitesQuery.isLoading ? (
              <span className="text-xs text-[#607A96] flex items-center gap-1.5">
                <IconLoader className="w-3.5 h-3.5 animate-spin" /> Loading…
              </span>
            ) : availableSites.length === 0 ? (
              <span className="text-xs text-red-500 font-bold">No sites assigned</span>
            ) : (
              <select
                id="select-scope-site"
                value={activeSiteId ?? ''}
                onChange={(e) => {
                  setSelectedSiteId(e.target.value);
                  setShiftError(null);
                  setVersionError(null);
                  setAssignError(null);
                }}
                className="w-full bg-transparent text-sm font-bold text-[#071A2B] outline-none cursor-pointer leading-tight appearance-none"
              >
                {availableSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name} ({site.code})
                  </option>
                ))}
              </select>
            )}
          </div>
          <svg className="w-3.5 h-3.5 text-[#94A3B8] shrink-0 pointer-events-none" viewBox="0 0 14 14" fill="none">
            <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* ── TAB NAVIGATION ───────────────────────────────────────────────────── */}
      <div className="bg-[#F5F8FB] p-1 rounded-xl border border-[#E8EEF4] flex items-center gap-1 overflow-x-auto">
        <button
          onClick={() => setActiveTab('shifts')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] cursor-pointer ${
            activeTab === 'shifts'
              ? 'bg-[#071A2B] text-white shadow-[0_2px_12px_rgba(7,26,43,0.18)]'
              : 'text-[#607A96] hover:bg-white hover:text-[#071A2B] hover:shadow-sm'
          }`}
        >
          <IconClock className="w-3.5 h-3.5" />
          <span>Shifts ({shifts.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('version')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] cursor-pointer ${
            activeTab === 'version'
              ? 'bg-[#071A2B] text-white shadow-[0_2px_12px_rgba(7,26,43,0.18)]'
              : 'text-[#607A96] hover:bg-white hover:text-[#071A2B] hover:shadow-sm'
          }`}
        >
          <IconCalendar className="w-3.5 h-3.5" />
          <span>Schedule Versions ({versions.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('assignment')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] cursor-pointer ${
            activeTab === 'assignment'
              ? 'bg-[#071A2B] text-white shadow-[0_2px_12px_rgba(7,26,43,0.18)]'
              : 'text-[#607A96] hover:bg-white hover:text-[#071A2B] hover:shadow-sm'
          }`}
        >
          <IconUsers className="w-3.5 h-3.5" />
          <span>Worker Assignment ({schedules.length})</span>
        </button>
      </div>

      {/* ── TAB 1: SHIFT SETUP ───────────────────────────────────────────────── */}
      {activeTab === 'shifts' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Shift Creation Form */}
          <div className="lg:col-span-5">
            <div className="bg-white rounded-2xl border border-[#DCE6EF] p-5 shadow-[0_4px_20px_rgba(7,26,43,0.03)] space-y-4">
              <div className="flex items-center justify-between border-b border-[#F5F8FB] pb-6 mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-[#071A2B] text-white shadow-[0_4px_20px_rgba(7,26,43,0.15)] flex items-center justify-center font-bold shadow-[0_4px_20px_rgba(0,0,0,0.1)]">
                    <IconClock className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black tracking-tight text-[#071A2B]">Create Shift</h2>
                    <p className="text-xs font-medium text-[#607A96] mt-1">Configure shift timing for {activeSite?.name}</p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleCreateShift} className="space-y-4">
                {shiftError && (
                  <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-700 text-xs leading-relaxed">
                    <IconAlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{shiftError}</span>
                  </div>
                )}

                {shiftSuccess && (
                  <div className="p-3.5 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-start gap-3 text-[#047857] text-xs leading-relaxed">
                    <IconCheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{shiftSuccess}</span>
                  </div>
                )}

                {/* Quick Presets */}
                <div className="space-y-2">
                  <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#607A96]">Quick Presets</span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => { setShiftName('Morning'); setShiftStartsAt('08:00'); setShiftEndsAt('16:00'); }}
                      className="px-3.5 py-2 rounded-xl border border-[#DCE6EF] bg-[#F9FAFC] text-xs font-bold text-[#607A96] hover:border-[#071A2B] hover:text-[#071A2B] hover:bg-white transition-all duration-200 cursor-pointer"
                    >
                      Morning (08:00–16:00)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShiftName('Evening'); setShiftStartsAt('16:00'); setShiftEndsAt('00:00'); }}
                      className="px-3.5 py-2 rounded-xl border border-[#DCE6EF] bg-[#F9FAFC] text-xs font-bold text-[#607A96] hover:border-[#071A2B] hover:text-[#071A2B] hover:bg-white transition-all duration-200 cursor-pointer"
                    >
                      Evening (16:00–00:00)
                    </button>
                  </div>
                </div>

                <SmartInput
                  id="shift-name-input"
                  label="Shift Name"
                  fieldRequired
                  placeholder="Morning, Evening, Night..."
                  value={shiftName}
                  onChange={(e) => setShiftName(e.target.value)}
                />

                <SmartTimePicker
                  id="shift-start-input"
                  label="Starts At"
                  fieldRequired
                  value={shiftStartsAt}
                  onChange={(v) => setShiftStartsAt(v)}
                  placeholder="Select start time"
                />

                <SmartTimePicker
                  id="shift-end-input"
                  label="Ends At"
                  fieldRequired
                  value={shiftEndsAt}
                  onChange={(v) => setShiftEndsAt(v)}
                  placeholder="Select end time"
                />

                <SmartSelect
                  id="shift-timezone-input"
                  label="Timezone"
                  fieldRequired
                  value={shiftTimezone}
                  onChange={(v) => setShiftTimezone(v)}
                  options={SHIFT_TIMEZONES}
                />

                <SmartButton
                  type="submit"
                  variant="default"
                  disabled={createShiftMutation.isPending}
                >
                  {createShiftMutation.isPending ? <IconLoader className="w-4 h-4 mr-2 animate-spin" /> : <IconPlus className="w-4 h-4 text-[#F66B17] mr-2" />}
                  {createShiftMutation.isPending ? 'Saving Shift...' : 'Save Shift'}
                </SmartButton>
              </form>
            </div>
          </div>

          {/* Existing Shifts List */}
          <div className="lg:col-span-7">
            <div className="bg-white rounded-2xl border border-[#DCE6EF] p-5 shadow-[0_4px_20px_rgba(7,26,43,0.03)] space-y-4">
              <div className="flex items-center justify-between border-b border-[#F5F8FB] pb-4 mb-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#071A2B]">
                  Configured Shifts ({shifts.length})
                </h3>
                {shiftsQuery.isLoading && <IconLoader className="w-4 h-4 text-[#94A3B8] animate-spin" />}
              </div>

              {shifts.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#607A96] bg-[#F9FAFC] rounded-[1.25rem] border border-dashed border-[#DCE6EF]">
                  No shifts defined for this site yet. Create Morning and Evening shifts using the form on the left.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {shifts.map((s) => (
                    <div key={s.id} className="p-4 rounded-[1.25rem] border border-[#DCE6EF] bg-white space-y-3 relative overflow-hidden transition-all hover:border-[#EBF1F6] hover:shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-base tracking-tight text-[#071A2B]">{s.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono font-bold px-2.5 py-1 rounded-md bg-[#F5F8FB] text-[#607A96] border border-[#DCE6EF]/50">
                            {s.timezone}
                          </span>
                          <button
                            type="button"
                            aria-label={`Delete ${s.name} shift`}
                            title="Delete shift"
                            disabled={deleteShiftMutation.isPending}
                            onClick={() => {
                              setShiftToDelete({ id: s.id, name: s.name });
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-100 text-red-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <IconTrash className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs font-bold text-[#607A96] bg-[#F9FAFC] border border-[#F5F8FB] px-3 py-2 rounded-xl">
                        <IconClock className="w-4 h-4 text-[#94A3B8]" />
                        <span>{formatShiftTime(s.startsAt)} - {formatShiftTime(s.endsAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: SCHEDULE VERSION ──────────────────────────────────────────── */}
      {activeTab === 'version' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Create Version Form */}
          <div className="lg:col-span-5">
            <div className="bg-white rounded-2xl border border-[#DCE6EF] p-5 shadow-[0_4px_20px_rgba(7,26,43,0.03)] space-y-4">
              <div className="flex items-center justify-between border-b border-[#F5F8FB] pb-6 mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-[#071A2B] text-white shadow-[0_4px_20px_rgba(7,26,43,0.15)] flex items-center justify-center font-bold shadow-[0_4px_20px_rgba(0,0,0,0.1)]">
                    <IconCalendar className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black tracking-tight text-[#071A2B]">Create Schedule Version</h2>
                    <p className="text-xs font-medium text-[#607A96] mt-1">Define validity period for worker schedules</p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleCreateVersion} className="space-y-4">
                {versionError && (
                  <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-700 text-xs leading-relaxed">
                    <IconAlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{versionError}</span>
                  </div>
                )}

                {versionSuccess && (
                  <div className="p-3.5 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-start gap-3 text-[#047857] text-xs leading-relaxed">
                    <IconCheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{versionSuccess}</span>
                  </div>
                )}

                <SmartDatePicker
                  id="version-from-input"
                  label="Effective From"
                  fieldRequired
                  value={versionFrom}
                  onChange={(v) => setVersionFrom(v)}
                  placeholder="Select start date"
                />

                <SmartDatePicker
                  id="version-until-input"
                  label="Effective Until (Optional)"
                  value={versionUntil}
                  onChange={(v) => setVersionUntil(v)}
                  placeholder="No end date (open)"
                />

                <SmartCheckbox
                  id="until-inclusive-cb"
                  label="Treat end date as inclusive"
                  description="e.g. 31/12 extends through 23:59:59 of that day"
                  checked={untilInclusive}
                  onChange={(v) => setUntilInclusive(v)}
                />

                <SmartButton
                  type="submit"
                  variant="default"
                  disabled={createVersionMutation.isPending}
                >
                  {createVersionMutation.isPending ? <IconLoader className="w-4 h-4 mr-2 animate-spin" /> : <IconPlus className="w-4 h-4 text-[#F66B17] mr-2" />}
                  {createVersionMutation.isPending ? 'Creating Version...' : 'Create Schedule Version'}
                </SmartButton>
              </form>
            </div>
          </div>

          {/* Schedule Versions List */}
          <div className="lg:col-span-7">
            <div className="bg-white rounded-2xl border border-[#DCE6EF] p-5 shadow-[0_4px_20px_rgba(7,26,43,0.03)] space-y-4">
              <div className="flex items-center justify-between border-b border-[#F5F8FB] pb-4 mb-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#071A2B]">
                  Schedule Versions ({versions.length})
                </h3>
                {versionsQuery.isLoading && <IconLoader className="w-4 h-4 text-[#94A3B8] animate-spin" />}
              </div>

              {versions.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#607A96] bg-[#F9FAFC] rounded-[1.25rem] border border-dashed border-[#DCE6EF]">
                  No schedule version created yet. Create one to start assigning worker schedules.
                </div>
              ) : (
                <div className="space-y-4">
                  {versions.map((v) => {
                    const isSelected = v.id === selectedVersionId;
                    return (
                      <div
                        key={v.id}
                        onClick={() => setSelectedVersionId(v.id)}
                        className={`group p-4 rounded-[1.25rem] border cursor-pointer transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                          isSelected
                            ? 'border-[#071A2B] bg-[#071A2B] text-white shadow-lg'
                            : 'border-[#DCE6EF] bg-white text-[#071A2B] hover:border-[#94A3B8] hover:bg-[#F9FAFC] hover:shadow-sm'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] font-bold px-3 py-1.5 rounded-lg uppercase tracking-wider ${isSelected ? 'bg-white/20 text-white' : 'bg-[#F5F8FB] text-[#607A96] group-hover:bg-[#DCE6EF]'}`}>
                            Schedule Version #{v.version}
                          </span>
                          {isSelected && (
                            <span className="text-[10px] font-extrabold flex items-center gap-1.5 text-emerald-400 uppercase tracking-wider">
                              <IconCheck className="w-4 h-4" /> Active Selection
                            </span>
                          )}
                        </div>
                        <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className={`block text-[10px] uppercase font-bold tracking-[0.2em] mb-1 ${isSelected ? 'text-white/50' : 'text-[#94A3B8]'}`}>From</span>
                            <span className="font-bold">{new Date(v.effectiveFrom).toLocaleDateString('vi-VN')}</span>
                          </div>
                          <div>
                            <span className={`block text-[10px] uppercase font-bold tracking-[0.2em] mb-1 ${isSelected ? 'text-white/50' : 'text-[#94A3B8]'}`}>Until</span>
                            <span className="font-bold">
                              {v.effectiveUntil ? new Date(v.effectiveUntil).toLocaleDateString('vi-VN') : 'Indefinite'}
                            </span>
                          </div>
                        </div>
                        <p className={`text-[10px] font-mono mt-4 pt-4 border-t truncate ${isSelected ? 'border-white/10 text-white/40' : 'border-[#F5F8FB] text-[#94A3B8]'}`}>
                          Configuration Locked
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: WORKER SCHEDULE ASSIGNMENT ────────────────────────────────── */}
      {activeTab === 'assignment' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Form Assign Worker Schedule */}
          <div className="lg:col-span-5">
            <div className="p-[2px] rounded-[1.75rem] bg-gradient-to-b from-white via-[#F1F5F9] to-[#E2E8F0] shadow-[0_4px_16px_rgba(7,26,43,0.03)]">
              <div className="bg-white rounded-[calc(1.75rem-2px)] p-6 space-y-5">
                <div className="flex items-center gap-4 pb-5 border-b border-[#F0F4F8]">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-[#071A2B] to-[#122A42] shadow-[0_4px_12px_rgba(7,26,43,0.2)] flex items-center justify-center">
                    <IconUsers className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black tracking-tight text-[#071A2B]">Assign Worker Schedule</h2>
                    <p className="text-xs font-medium text-[#607A96] mt-0.5">Assign shift to a worker for a specific date</p>
                  </div>
                </div>

                <form onSubmit={handleAssignWorkerSchedule} className="space-y-4">
                  {assignError && (
                    <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-700 text-xs leading-relaxed">
                      <IconAlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{assignError}</span>
                    </div>
                  )}

                  {assignSuccess && (
                    <div className="p-3.5 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-start gap-3 text-[#047857] text-xs leading-relaxed">
                      <IconCheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{assignSuccess}</span>
                    </div>
                  )}

                  {/* Active Schedule Version Selector */}
                  {versions.length > 0 ? (
                    <SmartSelect
                      id="schedule-version-select"
                      label="Active Schedule Version"
                      fieldRequired
                      value={selectedVersionId || ''}
                      onChange={(val) => setSelectedVersionId(val)}
                      options={versions.map((v) => ({
                        value: v.id,
                        label: `Schedule Version #${v.version} (${new Date(v.effectiveFrom).toLocaleDateString('vi-VN')}${
                          v.effectiveUntil ? ' - ' + new Date(v.effectiveUntil).toLocaleDateString('vi-VN') : ' (Open-ended)'
                        })`,
                      }))}
                      placeholder="Select a schedule version..."
                    />
                  ) : (
                    <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 font-medium space-y-1">
                      <p className="font-bold">No schedule version created yet.</p>
                      <p className="text-[11px] text-amber-700">Please create a schedule version in Tab 2 before assigning worker shifts.</p>
                    </div>
                  )}

                  {/* Worker Selector */}
                  <div className="pt-1">
                    {workersQuery.isLoading ? (
                      <div className="text-xs text-[#607A96] flex items-center gap-2 py-2">
                        <IconLoader className="w-4 h-4 animate-spin" /> Loading workers...
                      </div>
                    ) : workers.length === 0 ? (
                      <div className="text-xs text-red-600 font-bold p-3 bg-red-50 rounded-xl border border-red-100">
                        No existing workers found for this site.
                      </div>
                    ) : availableWorkers.length === 0 && assignShiftId ? (
                      <div className="text-xs text-[#607A96] font-bold p-3 bg-[#F9FAFC] rounded-xl border border-dashed border-[#DCE6EF]">
                        All workers already have this shift on {assignWorkDate}. Choose another shift or date.
                      </div>
                    ) : (
                      <SmartSelect
                        id="assign-worker-select"
                        label="Select Worker"
                        fieldRequired
                        value={assignWorkerId}
                        onChange={(v) => setAssignWorkerId(v)}
                        placeholder="-- Choose Worker --"
                        options={availableWorkers.map((w) => ({
                          value: w.id,
                          label: `${w.displayName} (${w.externalId}) — ${getContractorName(w.contractorId)}`,
                        }))}
                      />
                    )}
                  </div>

                  {/* Shift Selector */}
                  <div className="pt-1">
                    {shifts.length === 0 ? (
                      <div className="text-xs text-red-600 font-bold p-3 bg-red-50 rounded-xl border border-red-100">
                        No shifts defined. Please create shifts in Tab 1 first.
                      </div>
                    ) : (
                      <SmartSelect
                        id="assign-shift-select"
                        label="Select Shift"
                        fieldRequired
                        value={assignShiftId}
                        onChange={(v) => setAssignShiftId(v)}
                        placeholder="-- Choose Shift --"
                        options={shifts.map((s) => ({
                          value: s.id,
                          label: `${s.name} (${formatShiftTime(s.startsAt)} - ${formatShiftTime(s.endsAt)})`,
                        }))}
                      />
                    )}
                  </div>

                  {/* Work Date */}
                  <div className="pt-1">
                    <SmartDatePicker
                      id="assign-workdate-input"
                      label="Work Date"
                      fieldRequired
                      value={assignWorkDate}
                      onChange={(v) => setAssignWorkDate(v)}
                      placeholder="Select work date"
                    />
                  </div>

                  {/* Active Toggle */}
                  <div className="pt-2">
                    <SmartCheckbox
                      id="assign-active-cb"
                      label="Set schedule as Active"
                      checked={assignIsActive}
                      onChange={(v) => setAssignIsActive(v)}
                    />
                  </div>

                  <div className="pt-3">
                    <SmartButton
                      type="submit"
                      variant="default"
                      className="w-full justify-center bg-gradient-to-b from-[#F66B17] to-[#e55905] hover:from-[#FF8133] hover:to-[#f66b17] border-none text-white shadow-[0_4px_16px_rgba(246,107,23,0.25)] hover:shadow-[0_6px_24px_rgba(246,107,23,0.35)] transition-all h-11 text-base"
                      disabled={createWorkerScheduleMutation.isPending || !selectedVersionId || !assignWorkerId || !assignShiftId}
                    >
                      {createWorkerScheduleMutation.isPending ? <IconLoader className="w-4 h-4 mr-2 animate-spin text-white/80" /> : <IconPlus className="w-4 h-4 mr-2 text-white/80" />}
                      {createWorkerScheduleMutation.isPending ? 'Assigning...' : 'Assign Schedule'}
                    </SmartButton>
                  </div>
                </form>
              </div>
            </div>
          </div>

          {/* Assigned Worker Schedules Table */}
          <div className="lg:col-span-7">
            <div className="bg-white rounded-2xl border border-[#DCE6EF] p-5 shadow-[0_4px_20px_rgba(7,26,43,0.03)] space-y-4">
              <div className="flex items-center justify-between border-b border-[#F5F8FB] pb-4 mb-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#071A2B]">
                  Assigned Worker Schedules ({schedules.length})
                </h3>
                {schedulesQuery.isLoading && <IconLoader className="w-4 h-4 text-[#94A3B8] animate-spin" />}
              </div>

              {schedules.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#607A96] bg-[#F9FAFC] rounded-[1.25rem] border border-dashed border-[#DCE6EF]">
                  No worker schedules assigned for this site yet. Use the form on the left to assign your first shift.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-[1.25rem] border border-[#DCE6EF]">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[#DCE6EF] bg-[#F9FAFC] text-[#607A96] uppercase text-[10px] font-bold tracking-[0.2em]">
                        <th className="py-4 px-5">Worker Code</th>
                        <th className="py-4 px-5">Worker Name</th>
                        <th className="py-4 px-5">Contractor</th>
                        <th className="py-4 px-5">Work Date</th>
                        <th className="py-4 px-5">Assigned Shift</th>
                        <th className="py-4 px-5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F5F8FB]">
                      {schedules.map((sch) => {
                        const workerObj = workers.find((w) => w.id === sch.workerId);
                        return (
                          <tr key={sch.id} className="hover:bg-[#F9FAFC]/50 transition-colors">
                            <td className="py-4 px-5">
                              <span className="font-bold px-2.5 py-1 rounded-md bg-[#F5F8FB] text-[#071A2B] border border-[#DCE6EF]/50 text-xs">
                                {workerObj?.externalId ?? 'WORKER'}
                              </span>
                            </td>
                            <td className="py-4 px-5 font-bold text-[#071A2B]">
                              {workerObj?.displayName ?? `Worker (${sch.workerId.slice(0, 6)})`}
                            </td>
                            <td className="py-4 px-5 text-[#607A96] text-xs font-medium">
                              {getContractorName(workerObj?.contractorId)}
                            </td>
                            <td className="py-4 px-5 font-semibold text-[#071A2B]">
                              {sch.workDate}
                            </td>
                            <td className="py-4 px-5">
                              <span className="font-bold text-[#071A2B]">
                                {getShiftName(sch.shiftId)}
                              </span>
                            </td>
                            <td className="py-4 px-5">
                              <span
                                className={`text-[10px] font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider border ${
                                  sch.isActive
                                    ? 'bg-emerald-50 text-emerald-600 border-emerald-200/50'
                                    : 'bg-red-50 text-red-600 border-red-200/50'
                                }`}
                              >
                                {sch.isActive ? 'ACTIVE' : 'INACTIVE'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE SHIFT CONFIRMATION MODAL ──────────────────────────────────── */}
      {shiftToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071A2B]/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl border border-[#E8EEF4] shadow-2xl max-w-sm w-full p-5 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 pb-3 border-b border-[#F0F4F8]">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0 border border-red-100">
                <IconTrash className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#071A2B]">Delete Shift</h3>
                <p className="text-xs text-[#607A96] mt-0.5">Are you sure?</p>
              </div>
            </div>
            <p className="text-sm text-[#071A2B]">
              Delete the <span className="font-bold">{shiftToDelete.name}</span> shift? This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShiftToDelete(null)}
                className="px-4 py-2 rounded-lg border border-[#DCE6EF] bg-white text-xs font-bold text-[#607A96] hover:bg-[#F9FAFC] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  deleteShiftMutation.mutate(shiftToDelete.id);
                  setShiftToDelete(null);
                }}
                className="px-4 py-2 rounded-lg bg-red-500 text-white text-xs font-bold hover:bg-red-600 transition-colors duration-200 cursor-pointer"
              >
                Delete Shift
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
