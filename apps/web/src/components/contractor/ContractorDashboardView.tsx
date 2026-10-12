import React, { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  type ContractorDashboardScope,
  type ContractorTeamResponse,
  type ContractorTeamWorkerResponse,
  type SafetyAlertStatus,
  type SafetyAlertType,
} from '@smartsite/api-client';
import { useAuth, useCurrentUser } from '../../features/auth/auth-session';
import { loadAllPages } from '../workforce/load-all-pages';
import {
  IconUsers,
  IconBuilding,
  IconAlertTriangle,
  IconSearch,
  IconChevronRight,
  IconRefresh,
  IconClock,
  IconShield,
} from '../icons';
import { Button, Badge, Dialog, EmptyState, Alert, AlertTitle, AlertDescription } from '../ui';
import type { ActiveTab } from '../layout/AppLayout';

export interface DashboardNavigateContext {
  alertType?: SafetyAlertType;
  siteId?: string;
  alertId?: string;
  status?: SafetyAlertStatus;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') {
      return status;
    }
  }
  return undefined;
}

const DEFAULT_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const PAGE_SIZE = 10;

export interface ContractorDashboardViewProps {
  apiUrl?: string;
  sessionScope?: string;
  onNavigate?: (tab: ActiveTab, context?: DashboardNavigateContext) => void;
  initialSiteId?: string;
  initialContractorId?: string;
  onScopeChange?: (siteId: string, contractorId: string) => void;
}

export function ContractorDashboardView({
  apiUrl: apiUrlProp,
  sessionScope: sessionScopeProp,
  onNavigate,
  initialSiteId,
  initialContractorId,
  onScopeChange,
}: ContractorDashboardViewProps) {
  const resolvedApiUrl = apiUrlProp || DEFAULT_API_URL;
  const { accessToken } = useAuth();
  const currentUser = useCurrentUser(resolvedApiUrl);
  const sessionScope = sessionScopeProp || currentUser.data?.id || 'contractor-session';
  const queryClient = useQueryClient();
  const client = useMemo(() => new SmartSiteManagementClient(resolvedApiUrl), [resolvedApiUrl]);

  // ── 1. Scopes Discovery ────────────────────────────────────────────────────────
  const scopesQuery = useQuery({
    queryKey: ['contractor-dashboard-scopes', resolvedApiUrl, sessionScope],
    queryFn: () => client.contractorDashboardScopes(accessToken!),
    enabled: !!accessToken,
    staleTime: 30000,
  });

  const availableScopes = useMemo(() => scopesQuery.data?.items ?? [], [scopesQuery.data?.items]);

  const [selectedSiteId, setSelectedSiteId] = useState<string>(initialSiteId || '');
  const [selectedContractorId, setSelectedContractorId] = useState<string>(
    initialContractorId || '',
  );

  // Auto-select ONLY if exactly one scope exists.
  // When multiple scopes exist, require explicit user selection without silently defaulting.
  const activeScope: ContractorDashboardScope | undefined = useMemo(() => {
    if (availableScopes.length === 1) {
      return availableScopes[0];
    }
    if (selectedSiteId && selectedContractorId && availableScopes.length > 1) {
      return availableScopes.find(
        (s) => s.siteId === selectedSiteId && s.contractorId === selectedContractorId,
      );
    }
    return undefined;
  }, [availableScopes, selectedSiteId, selectedContractorId]);

  const currentSiteId = activeScope?.siteId ?? '';
  const currentContractorId = activeScope?.contractorId ?? '';

  // ── 2. Active Tab / Sub-view ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'overview' | 'teams' | 'workers'>('overview');

  // ── 3. Filters & Pagination States ────────────────────────────────────────────
  // Teams filters
  const [teamSearch, setTeamSearch] = useState('');
  const [teamStatusFilter, setTeamStatusFilter] = useState<'ACTIVE' | 'ARCHIVED' | 'ALL'>('ACTIVE');
  const [teamOffset, setTeamOffset] = useState(0);

  // Workers filters
  const [workerSearch, setWorkerSearch] = useState('');
  const [workerTeamFilter, setWorkerTeamFilter] = useState<string>('ALL');
  const [workerOffset, setWorkerOffset] = useState(0);

  // Reset pagination, filters, and close modals on scope change
  const createRequestIdRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const assignRequestIdRef = useRef<{ fingerprint: string; id: string } | null>(null);

  const handleScopeSelect = (scopeKey: string) => {
    // 1. Close and clean all modals so old drafts/targets cannot be submitted into new scope
    createRequestIdRef.current = null;
    assignRequestIdRef.current = null;
    setIsCreateTeamOpen(false);
    setCreateTeamName('');
    setCreateTeamDescription('');
    setCreateTeamError(null);

    setEditingTeam(null);
    setEditTeamName('');
    setEditTeamDescription('');
    setEditTeamError(null);

    setArchivingTeam(null);
    setArchiveReason('');
    setArchiveError(null);

    setAssigningWorker(null);
    setTargetTeamId('UNASSIGN');
    setAssignReason('');
    setAssignError(null);
    setScheduleLink('');

    // 2. Reset filters and pagination
    setTeamSearch('');
    setTeamStatusFilter('ACTIVE');
    setTeamOffset(0);
    setWorkerSearch('');
    setWorkerTeamFilter('ALL');
    setWorkerOffset(0);

    // 3. Update scope
    if (!scopeKey) {
      setSelectedSiteId('');
      setSelectedContractorId('');
      return;
    }
    const [sId, cId] = scopeKey.split(':');
    if (sId && cId) {
      setSelectedSiteId(sId);
      setSelectedContractorId(cId);
      onScopeChange?.(sId, cId);
    }
  };

  // ── 4. Main Queries ───────────────────────────────────────────────────────────
  // A. Dashboard KPI Query
  const dashboardQuery = useQuery({
    queryKey: [
      'contractor-dashboard',
      resolvedApiUrl,
      sessionScope,
      currentSiteId,
      currentContractorId,
    ],
    queryFn: () => client.contractorDashboard(accessToken!, currentSiteId, currentContractorId),
    enabled: !!accessToken && !!currentSiteId && !!currentContractorId,
    staleTime: 15000,
  });

  // B. Teams List Query
  const teamsQuery = useQuery({
    queryKey: [
      'contractor-teams',
      resolvedApiUrl,
      sessionScope,
      currentSiteId,
      currentContractorId,
      teamSearch,
      teamStatusFilter,
      teamOffset,
    ],
    queryFn: () =>
      client.listContractorTeams(accessToken!, currentSiteId, currentContractorId, {
        offset: teamOffset,
        limit: PAGE_SIZE,
        search: teamSearch.trim() || undefined,
        status: teamStatusFilter,
      }),
    enabled: !!accessToken && !!currentSiteId && !!currentContractorId,
    staleTime: 15000,
  });

  // C. Active Teams for select dropdowns (loads all pages using loadAllPages helper)
  const allActiveTeamsQuery = useQuery({
    queryKey: [
      'contractor-teams-active-all',
      resolvedApiUrl,
      sessionScope,
      currentSiteId,
      currentContractorId,
    ],
    queryFn: ({ signal }) =>
      loadAllPages(
        (page) =>
          client.listContractorTeams(accessToken!, currentSiteId, currentContractorId, {
            ...page,
            status: 'ACTIVE',
          }),
        signal,
      ),
    enabled: !!accessToken && !!currentSiteId && !!currentContractorId,
    staleTime: 30000,
  });

  // D. Workers List Query
  const isUnassignedOnly = workerTeamFilter === 'UNASSIGNED';
  const targetFilterTeamId =
    workerTeamFilter !== 'ALL' && workerTeamFilter !== 'UNASSIGNED' ? workerTeamFilter : undefined;

  const workersQuery = useQuery({
    queryKey: [
      'contractor-team-workers',
      resolvedApiUrl,
      sessionScope,
      currentSiteId,
      currentContractorId,
      workerSearch,
      workerTeamFilter,
      workerOffset,
    ],
    queryFn: () =>
      client.listContractorTeamWorkers(accessToken!, currentSiteId, currentContractorId, {
        offset: workerOffset,
        limit: PAGE_SIZE,
        search: workerSearch.trim() || undefined,
        teamId: targetFilterTeamId,
        unassigned: isUnassignedOnly ? true : undefined,
      }),
    enabled: !!accessToken && !!currentSiteId && !!currentContractorId,
    staleTime: 15000,
  });

  // ── 5. Invalidation Helper ────────────────────────────────────────────────────
  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: [
          'contractor-dashboard',
          resolvedApiUrl,
          sessionScope,
          currentSiteId,
          currentContractorId,
        ],
      }),
      queryClient.invalidateQueries({
        queryKey: [
          'contractor-teams',
          resolvedApiUrl,
          sessionScope,
          currentSiteId,
          currentContractorId,
        ],
      }),
      queryClient.invalidateQueries({
        queryKey: [
          'contractor-teams-active-all',
          resolvedApiUrl,
          sessionScope,
          currentSiteId,
          currentContractorId,
        ],
      }),
      queryClient.invalidateQueries({
        queryKey: [
          'contractor-team-workers',
          resolvedApiUrl,
          sessionScope,
          currentSiteId,
          currentContractorId,
        ],
      }),
    ]);
  };

  // ── 6. Modal States & Mutations ───────────────────────────────────────────────
  // Create Team Modal
  const [isCreateTeamOpen, setIsCreateTeamOpen] = useState(false);
  const [createTeamName, setCreateTeamName] = useState('');
  const [createTeamDescription, setCreateTeamDescription] = useState('');
  const [createTeamError, setCreateTeamError] = useState<string | null>(null);

  const openCreateTeam = () => {
    createRequestIdRef.current = null;
    setCreateTeamName('');
    setCreateTeamDescription('');
    setCreateTeamError(null);
    setIsCreateTeamOpen(true);
  };

  const createTeamMutation = useMutation({
    mutationFn: async () => {
      setCreateTeamError(null);
      if (!createTeamName.trim()) {
        throw new Error('Team name is required.');
      }
      const input = {
        name: createTeamName.trim(),
        description: createTeamDescription.trim() || undefined,
      };
      const fingerprint = JSON.stringify({
        siteId: currentSiteId,
        contractorId: currentContractorId,
        ...input,
      });
      if (createRequestIdRef.current?.fingerprint !== fingerprint) {
        createRequestIdRef.current = { fingerprint, id: crypto.randomUUID() };
      }
      return client.createContractorTeam(accessToken!, currentSiteId, currentContractorId, {
        ...input,
        requestId: createRequestIdRef.current.id,
      });
    },
    onSuccess: async () => {
      createRequestIdRef.current = null;
      setIsCreateTeamOpen(false);
      setCreateTeamName('');
      setCreateTeamDescription('');
      await invalidateAll();
    },
    onError: (err: unknown) => {
      setCreateTeamError(getErrorMessage(err, 'Could not create team. Please try again.'));
    },
  });

  // Edit Team Modal
  const [editingTeam, setEditingTeam] = useState<ContractorTeamResponse | null>(null);
  const [editTeamName, setEditTeamName] = useState('');
  const [editTeamDescription, setEditTeamDescription] = useState('');
  const [editTeamError, setEditTeamError] = useState<string | null>(null);

  const openEditTeam = (team: ContractorTeamResponse) => {
    setEditingTeam(team);
    setEditTeamName(team.name);
    setEditTeamDescription(team.description || '');
    setEditTeamError(null);
  };

  const updateTeamMutation = useMutation({
    mutationFn: async () => {
      setEditTeamError(null);
      if (!editingTeam) return;
      if (!editTeamName.trim()) {
        throw new Error('Team name is required.');
      }
      return client.updateContractorTeam(
        accessToken!,
        currentSiteId,
        currentContractorId,
        editingTeam.id,
        {
          expectedVersion: editingTeam.version,
          name: editTeamName.trim(),
          description: editTeamDescription.trim(),
        },
      );
    },
    onSuccess: async () => {
      setEditingTeam(null);
      await invalidateAll();
    },
    onError: (err: unknown) => {
      const status = getErrorStatus(err);
      setEditTeamError(
        status === 409
          ? 'Conflict: Team was updated by another user. Please refresh and try again.'
          : getErrorMessage(err, 'Could not update team.'),
      );
      if (status === 409) {
        void invalidateAll();
      }
    },
  });

  // Archive Team Modal
  const [archivingTeam, setArchivingTeam] = useState<ContractorTeamResponse | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const openArchiveTeam = (team: ContractorTeamResponse) => {
    setArchivingTeam(team);
    setArchiveReason('');
    setArchiveError(null);
  };

  const archiveTeamMutation = useMutation({
    mutationFn: async () => {
      setArchiveError(null);
      if (!archivingTeam) return;
      const finalReason = archiveReason.trim() || 'Archived by contractor representative';
      return client.archiveContractorTeam(
        accessToken!,
        currentSiteId,
        currentContractorId,
        archivingTeam.id,
        {
          expectedVersion: archivingTeam.version,
          reason: finalReason,
        },
      );
    },
    onSuccess: async () => {
      setArchivingTeam(null);
      await invalidateAll();
    },
    onError: (err: unknown) => {
      const status = getErrorStatus(err);
      setArchiveError(
        status === 409
          ? 'Conflict: Team status or membership was modified. Please reload.'
          : getErrorMessage(err, 'Could not archive team.'),
      );
      if (status === 409) {
        void invalidateAll();
      }
    },
  });

  // Assign/Transfer/Remove Worker Modal
  const [assigningWorker, setAssigningWorker] = useState<ContractorTeamWorkerResponse | null>(null);
  const [targetTeamId, setTargetTeamId] = useState<string>('UNASSIGN');
  const [assignReason, setAssignReason] = useState('');
  const [assignError, setAssignError] = useState<string | null>(null);
  const [scheduleLink, setScheduleLink] = useState('');

  const openAssignWorker = (worker: ContractorTeamWorkerResponse) => {
    assignRequestIdRef.current = null;
    setAssigningWorker(worker);
    setTargetTeamId(worker.teamId || 'UNASSIGN');
    setAssignReason('');
    setAssignError(null);
  };

  const assignWorkerMutation = useMutation({
    mutationFn: async () => {
      setAssignError(null);
      if (!assigningWorker) return;
      if (assigningWorker.membershipId && assignReason.trim().length < 5) {
        // Automatically provide a default reason if none is given since the UI field is removed
      }
      const newTeamId = targetTeamId === 'UNASSIGN' ? null : targetTeamId;
      const finalReason = assignReason.trim() || 'Updated by contractor representative';
      const input = {
        expectedMembershipId: assigningWorker.membershipId,
        teamId: newTeamId,
        ...(assigningWorker.membershipId ? { reason: finalReason } : {}),
      };
      const fingerprint = JSON.stringify({
        siteId: currentSiteId,
        contractorId: currentContractorId,
        workerId: assigningWorker.workerId,
        ...input,
      });
      if (assignRequestIdRef.current?.fingerprint !== fingerprint) {
        assignRequestIdRef.current = { fingerprint, id: crypto.randomUUID() };
      }
      return client.assignContractorTeam(
        accessToken!,
        currentSiteId,
        currentContractorId,
        assigningWorker.workerId,
        {
          ...input,
          requestId: assignRequestIdRef.current.id,
        },
      );
    },
    onSuccess: async (member) => {
      assignRequestIdRef.current = null;
      setScheduleLink(
        member?.teamId
          ? `/schedule-setup?${new URLSearchParams({ tab: 'assignment', siteId: currentSiteId, contractorId: currentContractorId, teamId: member.teamId, workerId: member.workerId })}`
          : '',
      );
      setAssigningWorker(null);
      await invalidateAll();
    },
    onError: (err: unknown) => {
      const status = getErrorStatus(err);
      setAssignError(
        status === 409
          ? 'Conflict: Worker membership was changed by another user. Reloading data...'
          : getErrorMessage(err, 'Could not update team membership.'),
      );
      if (status === 409) {
        void invalidateAll();
      }
    },
  });

  // ── 7. Render Loading & Error for Scope Discovery ─────────────────────────────
  if (scopesQuery.isLoading) {
    return (
      <div
        role="status"
        aria-label="Loading contractor scopes"
        className="flex flex-col items-center justify-center min-h-[50dvh] gap-3 text-slate-500"
      >
        <div className="w-8 h-8 rounded-full border-2 border-[#071A2B] border-t-transparent animate-spin" />
        <p className="text-xs font-semibold">Loading contractor workspaces and sites...</p>
      </div>
    );
  }

  if (scopesQuery.isError) {
    const status = getErrorStatus(scopesQuery.error);
    return (
      <div
        role="alert"
        className="max-w-xl mx-auto my-12 p-6 rounded-2xl border border-rose-200 bg-white shadow-sm space-y-4 text-center"
      >
        <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
          <IconAlertTriangle className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">
          {status === 403 ? 'Access Denied' : 'Could Not Load Contractor Scopes'}
        </h2>
        <p className="text-xs text-slate-600">
          {status === 403
            ? 'Your account does not have active contractor representative permissions.'
            : scopesQuery.error?.message ||
              'A network error occurred while discovering your assigned sites.'}
        </p>
        <Button
          variant="default"
          size="md"
          onClick={() => void scopesQuery.refetch()}
          disabled={scopesQuery.isFetching}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (availableScopes.length === 0) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8">
        <EmptyState
          icon={<IconBuilding className="w-8 h-8 text-slate-400" />}
          title="No Contractor Scopes Available"
          description="You are currently not assigned as a Contractor Representative to any active Site."
        />
      </div>
    );
  }

  // Active teams list for select dropdown
  const activeTeamsList = allActiveTeamsQuery.data?.items ?? [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {scheduleLink && (
        <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm">
          Team updated. Existing schedules remain unchanged.{' '}
          <a className="font-bold text-blue-800 underline" href={scheduleLink}>
            Choose whether to apply remaining team schedules
          </a>
          <button className="ml-3 text-xs" onClick={() => setScheduleLink('')}>
            Dismiss
          </button>
        </div>
      )}
      {/* ── HEADER & SCOPE SELECTOR ───────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-[#071A2B] text-white tracking-wide uppercase">
              Contractor Dashboard
            </span>
            {activeScope && (
              <>
                <span className="text-xs font-semibold text-slate-400">·</span>
                <span className="text-xs font-bold text-slate-600">
                  {activeScope.contractorName}
                </span>
              </>
            )}
          </div>
          {activeScope ? (
            <h1 className="text-2xl font-black text-[#071A2B] tracking-tight mt-1.5">
              {activeScope.siteName}{' '}
              <span className="text-base font-medium text-slate-400">({activeScope.siteCode})</span>
            </h1>
          ) : (
            <h1 className="text-2xl font-black text-[#071A2B] tracking-tight mt-1.5">
              Select Site & Contractor Scope
            </h1>
          )}
        </div>

        {/* Scope dropdown selector */}
        <div className="w-full md:w-80">
          <label
            htmlFor="contractor-scope-select"
            className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
          >
            Active Site Scope
          </label>
          <select
            id="contractor-scope-select"
            aria-label="Active Site Scope"
            value={
              selectedSiteId && selectedContractorId
                ? `${selectedSiteId}:${selectedContractorId}`
                : ''
            }
            onChange={(e) => handleScopeSelect(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-[#071A2B] outline-none transition-all duration-200 hover:border-slate-300 focus:border-[#071A2B] focus:bg-white focus:ring-2 focus:ring-[#071A2B]/10 shadow-xs cursor-pointer"
          >
            {availableScopes.length > 1 && (
              <option value="">-- Select Site & Contractor Scope --</option>
            )}
            {availableScopes.map((scope) => (
              <option
                key={`${scope.siteId}:${scope.contractorId}`}
                value={`${scope.siteId}:${scope.contractorId}`}
              >
                {scope.siteName} ({scope.siteCode}) — {scope.contractorName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!activeScope ? (
        <div className="bg-white p-8 rounded-2xl border border-slate-200/80 shadow-xs">
          <EmptyState
            icon={<IconBuilding className="w-8 h-8 text-slate-400" />}
            title="Scope Selection Required"
            description="You represent multiple sites or contractors. Please select a specific Site and Contractor from the dropdown above to view metrics and manage teams."
          />
        </div>
      ) : (
        <>
          {/* ── KPI METRIC CARDS ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {/* Managed Workers Card */}
            <div
              role="region"
              aria-label="Managed Workers KPI"
              className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs relative overflow-hidden group"
            >
              <div className="absolute inset-x-0 top-0 h-0.5 bg-blue-500 rounded-t-2xl" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                  Managed Workers
                </p>
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <IconUsers className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="flex items-end gap-3">
                <p className="text-4xl font-black text-[#071A2B] leading-none">
                  {dashboardQuery.isLoading ? '—' : (dashboardQuery.data?.workerCount ?? 0)}
                </p>
                <span className="text-sm font-semibold text-slate-500 mb-0.5">Active Workers</span>
              </div>
            </div>

            {/* Active Teams Card */}
            <div
              role="region"
              aria-label="Active Teams KPI"
              className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs relative overflow-hidden group"
            >
              <div className="absolute inset-x-0 top-0 h-0.5 bg-emerald-500 rounded-t-2xl" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                  Active Teams
                </p>
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <IconBuilding className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="flex items-end gap-3">
                <p className="text-4xl font-black text-[#071A2B] leading-none">
                  {dashboardQuery.isLoading ? '—' : (dashboardQuery.data?.teamCount ?? 0)}
                </p>
                <span className="text-sm font-semibold text-slate-500 mb-0.5">Organized Teams</span>
              </div>
            </div>

            {/* Unassigned Workers Card */}
            <div
              role="region"
              aria-label="Unassigned Workers KPI"
              className={`bg-white p-6 rounded-2xl border shadow-xs relative overflow-hidden group ${
                (dashboardQuery.data?.unassignedWorkerCount ?? 0) > 0
                  ? 'border-amber-200'
                  : 'border-slate-200/80'
              }`}
            >
              <div
                className={`absolute inset-x-0 top-0 h-0.5 rounded-t-2xl ${
                  (dashboardQuery.data?.unassignedWorkerCount ?? 0) > 0
                    ? 'bg-amber-400'
                    : 'bg-slate-300'
                }`}
              />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                  Unassigned Workers
                </p>
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    (dashboardQuery.data?.unassignedWorkerCount ?? 0) > 0
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  <IconAlertTriangle className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="flex items-end gap-3">
                <p
                  className={`text-4xl font-black leading-none ${
                    (dashboardQuery.data?.unassignedWorkerCount ?? 0) > 0
                      ? 'text-amber-600'
                      : 'text-[#071A2B]'
                  }`}
                >
                  {dashboardQuery.isLoading
                    ? '—'
                    : (dashboardQuery.data?.unassignedWorkerCount ?? 0)}
                </p>
                <span className="text-sm font-semibold text-slate-500 mb-0.5">Awaiting Team</span>
              </div>
              {(dashboardQuery.data?.unassignedWorkerCount ?? 0) > 0 && (
                <p className="text-[11px] text-amber-600 mt-2 font-medium">
                  Workers not in a team cannot participate in shift swaps.
                </p>
              )}
            </div>
          </div>

          {/* ── QUICK ACTION LINKS ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <button
              type="button"
              onClick={() => onNavigate?.('workforce')}
              className="flex items-center gap-4 p-5 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-50 transition-all text-left group cursor-pointer"
            >
              <div className="w-11 h-11 shrink-0 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <IconShield className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-[#071A2B] group-hover:text-indigo-700 transition-colors">
                  Review Shift Swaps & Leaves
                </p>
              </div>
              <IconChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate?.('schedule-setup')}
              className="flex items-center gap-4 p-5 rounded-xl border border-slate-200 bg-white hover:border-teal-300 hover:shadow-md hover:shadow-teal-50 transition-all text-left group cursor-pointer"
            >
              <div className="w-11 h-11 shrink-0 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center group-hover:bg-teal-600 group-hover:text-white transition-colors">
                <IconClock className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-[#071A2B] group-hover:text-teal-700 transition-colors">
                  Schedule Setup
                </p>
              </div>
              <IconChevronRight className="w-4 h-4 text-slate-300 group-hover:text-teal-500 group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate?.('access')}
              className="flex items-center gap-4 p-5 rounded-xl border border-slate-200 bg-white hover:border-orange-300 hover:shadow-md hover:shadow-orange-50 transition-all text-left group cursor-pointer"
            >
              <div className="w-11 h-11 shrink-0 rounded-xl bg-orange-50 text-[#F66B17] flex items-center justify-center group-hover:bg-[#F66B17] group-hover:text-white transition-colors">
                <IconUsers className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-[#071A2B] group-hover:text-orange-700 transition-colors">
                  Attendance & Gate Pass
                </p>
              </div>
              <IconChevronRight className="w-4 h-4 text-slate-300 group-hover:text-orange-500 group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>
          </div>

          {/* ── NAVIGATION TABS (Teams vs Workers) ─────────────────────────────────── */}
          <div className="flex items-center justify-between border-b border-slate-200 pt-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('overview')}
                className={`px-4 py-2.5 text-xs font-bold transition-all border-b-2 -mb-px flex items-center gap-2 cursor-pointer ${
                  activeTab === 'overview'
                    ? 'border-[#071A2B] text-[#071A2B]'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <IconBuilding className="w-4 h-4" />
                <span>Teams Management ({teamsQuery.data?.total ?? 0})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('workers')}
                className={`px-4 py-2.5 text-xs font-bold transition-all border-b-2 -mb-px flex items-center gap-2 cursor-pointer ${
                  activeTab === 'workers'
                    ? 'border-[#071A2B] text-[#071A2B]'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <IconUsers className="w-4 h-4" />
                <span>Worker Assignments ({workersQuery.data?.total ?? 0})</span>
              </button>
            </div>

            <div className="flex items-center gap-2 pb-2">
              {activeTab === 'overview' && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={openCreateTeam}
                  className="rounded-xl font-bold bg-[#071A2B] text-white hover:bg-[#0E2841] shadow-xs"
                >
                  + Create Team
                </Button>
              )}
              <button
                type="button"
                aria-label="Refresh dashboard data"
                onClick={() => void invalidateAll()}
                className="p-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <IconRefresh className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ── TAB 1: TEAMS MANAGEMENT ───────────────────────────────────────────── */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {/* Filter Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs">
                <div className="relative w-full sm:w-72">
                  <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={teamSearch}
                    onChange={(e) => {
                      setTeamSearch(e.target.value);
                      setTeamOffset(0);
                    }}
                    placeholder="Search team by name..."
                    aria-label="Search team by name"
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-[#071A2B] placeholder-slate-400 outline-none focus:bg-white focus:border-[#071A2B]"
                  />
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <label
                    htmlFor="team-status-filter"
                    className="text-[11px] font-bold text-slate-500 uppercase tracking-wider"
                  >
                    Status:
                  </label>
                  <select
                    id="team-status-filter"
                    aria-label="Filter teams by status"
                    value={teamStatusFilter}
                    onChange={(e) => {
                      setTeamStatusFilter(e.target.value as 'ACTIVE' | 'ARCHIVED' | 'ALL');
                      setTeamOffset(0);
                    }}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-[#071A2B] outline-none cursor-pointer"
                  >
                    <option value="ACTIVE">Active Teams</option>
                    <option value="ARCHIVED">Archived Teams</option>
                    <option value="ALL">All Teams</option>
                  </select>
                </div>
              </div>

              {/* Teams Table */}
              {teamsQuery.isLoading ? (
                <div
                  role="status"
                  className="py-12 text-center text-xs font-semibold text-slate-500 bg-white rounded-2xl border border-slate-200"
                >
                  Loading teams...
                </div>
              ) : teamsQuery.isError ? (
                <div
                  role="alert"
                  className="p-6 text-center rounded-2xl border border-rose-200 bg-white space-y-3"
                >
                  <p className="text-xs font-bold text-rose-600">
                    {teamsQuery.error?.message || 'Could not load contractor teams.'}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => void teamsQuery.refetch()}>
                    Retry
                  </Button>
                </div>
              ) : (teamsQuery.data?.items ?? []).length === 0 ? (
                <div className="bg-white p-8 rounded-2xl border border-slate-200/80">
                  <EmptyState
                    icon={<IconBuilding className="w-8 h-8 text-slate-400" />}
                    title="No Teams Found"
                    description={
                      teamSearch
                        ? 'No teams match your search query.'
                        : 'No contractor teams configured yet. Create a team (e.g. Painting Team, Flooring Team) to organize workers.'
                    }
                  />
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/75 border-b border-slate-200/80 text-[10px] uppercase font-bold tracking-wider text-slate-500">
                        <tr>
                          <th className="py-3 px-4">Team Name</th>
                          <th className="py-3 px-4">Description</th>
                          <th className="py-3 px-4 text-center">Active Members</th>
                          <th className="py-3 px-4 text-center">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {teamsQuery.data!.items.map((team) => (
                          <tr key={team.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="py-3.5 px-4 font-bold text-[#071A2B]">
                              <span>{team.name}</span>
                            </td>
                            <td className="py-3.5 px-4 text-slate-600 max-w-xs truncate">
                              {team.description || (
                                <span className="text-slate-400 italic">No description</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full font-bold text-[11px] ${
                                  team.memberCount > 0
                                    ? 'bg-blue-50 text-blue-700'
                                    : 'bg-slate-100 text-slate-500'
                                }`}
                              >
                                {team.memberCount} member
                                {team.memberCount !== 1 ? 's' : ''}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <Badge variant={team.isActive ? 'success' : 'neutral'}>
                                {team.isActive ? 'Active' : 'Archived'}
                              </Badge>
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setWorkerTeamFilter(team.id);
                                    setActiveTab('workers');
                                  }}
                                  className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-700 transition-colors cursor-pointer"
                                >
                                  Members
                                </button>
                                {team.isActive && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openEditTeam(team)}
                                      className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-700 transition-colors cursor-pointer"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      disabled={team.memberCount > 0}
                                      title={
                                        team.memberCount > 0
                                          ? 'Cannot archive team with active members. Remove or transfer members first.'
                                          : 'Archive team'
                                      }
                                      onClick={() => openArchiveTeam(team)}
                                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-colors ${
                                        team.memberCount > 0
                                          ? 'border-slate-100 text-slate-300 cursor-not-allowed bg-slate-50'
                                          : 'border-rose-200 text-rose-600 hover:bg-rose-50 cursor-pointer'
                                      }`}
                                    >
                                      Archive
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {teamsQuery.data!.total > PAGE_SIZE && (
                    <div className="flex items-center justify-between p-4 border-t border-slate-100 text-xs text-slate-600">
                      <p>
                        Showing {teamOffset + 1} to{' '}
                        {Math.min(teamOffset + PAGE_SIZE, teamsQuery.data!.total)} of{' '}
                        {teamsQuery.data!.total} teams
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={teamOffset === 0}
                          onClick={() => setTeamOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={teamOffset + PAGE_SIZE >= teamsQuery.data!.total}
                          onClick={() => setTeamOffset((prev) => prev + PAGE_SIZE)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── TAB 2: WORKER ASSIGNMENTS ─────────────────────────────────────────── */}
          {activeTab === 'workers' && (
            <div className="space-y-4">
              {/* Filter Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs">
                <div className="relative w-full sm:w-72">
                  <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={workerSearch}
                    onChange={(e) => {
                      setWorkerSearch(e.target.value);
                      setWorkerOffset(0);
                    }}
                    placeholder="Search worker by name..."
                    aria-label="Search worker by name"
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-[#071A2B] placeholder-slate-400 outline-none focus:bg-white focus:border-[#071A2B]"
                  />
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <label
                    htmlFor="worker-team-filter"
                    className="text-[11px] font-bold text-slate-500 uppercase tracking-wider"
                  >
                    Filter by Team:
                  </label>
                  <select
                    id="worker-team-filter"
                    aria-label="Filter workers by team"
                    value={workerTeamFilter}
                    onChange={(e) => {
                      setWorkerTeamFilter(e.target.value);
                      setWorkerOffset(0);
                    }}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-[#071A2B] outline-none cursor-pointer"
                  >
                    <option value="ALL">All Workers</option>
                    <option value="UNASSIGNED">Unassigned Only</option>
                    {activeTeamsList.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Workers Table */}
              {workersQuery.isLoading ? (
                <div
                  role="status"
                  className="py-12 text-center text-xs font-semibold text-slate-500 bg-white rounded-2xl border border-slate-200"
                >
                  Loading workers...
                </div>
              ) : workersQuery.isError ? (
                <div
                  role="alert"
                  className="p-6 text-center rounded-2xl border border-rose-200 bg-white space-y-3"
                >
                  <p className="text-xs font-bold text-rose-600">
                    {workersQuery.error?.message || 'Could not load contractor workers.'}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => void workersQuery.refetch()}>
                    Retry
                  </Button>
                </div>
              ) : (workersQuery.data?.items ?? []).length === 0 ? (
                <div className="bg-white p-8 rounded-2xl border border-slate-200/80">
                  <EmptyState
                    icon={<IconUsers className="w-8 h-8 text-slate-400" />}
                    title="No Workers Found"
                    description={
                      workerSearch || workerTeamFilter !== 'ALL'
                        ? 'No workers match the selected filters.'
                        : 'No workers found under this contractor.'
                    }
                  />
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/75 border-b border-slate-200/80 text-[10px] uppercase font-bold tracking-wider text-slate-500">
                        <tr>
                          <th className="py-3 px-4">Worker Name</th>
                          <th className="py-3 px-4">Assigned Team</th>
                          <th className="py-3 px-4">Membership Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {workersQuery.data!.items.map((worker) => (
                          <tr
                            key={worker.workerId}
                            className="hover:bg-slate-50/50 transition-colors"
                          >
                            <td className="py-3.5 px-4 font-bold text-[#071A2B]">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-[11px]">
                                  {worker.displayName.slice(0, 2).toUpperCase()}
                                </div>
                                <span>{worker.displayName}</span>
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              {worker.teamName ? (
                                <span className="font-bold text-[#071A2B]">{worker.teamName}</span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full font-bold text-[10px] bg-amber-50 text-amber-700 border border-amber-200">
                                  Unassigned
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-slate-500">
                              {worker.membershipId ? (
                                <span className="font-mono text-[11px] text-emerald-700">
                                  Active Membership
                                </span>
                              ) : (
                                <span className="text-slate-400">No active membership</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <Button
                                variant={worker.teamId ? 'outline' : 'default'}
                                size="sm"
                                onClick={() => openAssignWorker(worker)}
                                className="font-bold"
                              >
                                {worker.teamId ? 'Transfer / Remove' : 'Assign Team'}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {workersQuery.data!.total > PAGE_SIZE && (
                    <div className="flex items-center justify-between p-4 border-t border-slate-100 text-xs text-slate-600">
                      <p>
                        Showing {workerOffset + 1} to{' '}
                        {Math.min(workerOffset + PAGE_SIZE, workersQuery.data!.total)} of{' '}
                        {workersQuery.data!.total} workers
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={workerOffset === 0}
                          onClick={() => setWorkerOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={workerOffset + PAGE_SIZE >= workersQuery.data!.total}
                          onClick={() => setWorkerOffset((prev) => prev + PAGE_SIZE)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── MODAL: CREATE TEAM ────────────────────────────────────────────────── */}
      <Dialog
        open={isCreateTeamOpen}
        onClose={() => setIsCreateTeamOpen(false)}
        title="Create New Contractor Team"
        description={`Create a new team for ${activeScope?.contractorName} at ${activeScope?.siteName}`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createTeamMutation.mutate();
          }}
          className="space-y-4"
        >
          {createTeamError && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{createTeamError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="create-team-name"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
            >
              Team Name <span className="text-rose-500">*</span>
            </label>
            <input
              id="create-team-name"
              type="text"
              required
              value={createTeamName}
              onChange={(e) => setCreateTeamName(e.target.value)}
              placeholder="e.g. Painting Team A, Flooring Team..."
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-semibold text-[#071A2B] outline-none focus:border-[#071A2B] focus:bg-white focus:ring-4 focus:ring-[#071A2B]/5 shadow-xs"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="create-team-desc"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
            >
              Description (Optional)
            </label>
            <textarea
              id="create-team-desc"
              rows={3}
              value={createTeamDescription}
              onChange={(e) => setCreateTeamDescription(e.target.value)}
              placeholder="Responsibilities or trade scope..."
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-semibold text-[#071A2B] outline-none focus:border-[#071A2B] focus:bg-white focus:ring-4 focus:ring-[#071A2B]/5 shadow-xs resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsCreateTeamOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              isLoading={createTeamMutation.isPending}
              disabled={!createTeamName.trim()}
              className="rounded-full px-6 font-bold bg-[#071A2B] hover:bg-[#0E2841] text-white shadow-xs"
            >
              Create Team
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ── MODAL: EDIT TEAM ──────────────────────────────────────────────────── */}
      <Dialog
        open={!!editingTeam}
        onClose={() => setEditingTeam(null)}
        title="Edit Team"
        description={editingTeam ? `Update details for ${editingTeam.name}` : ''}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateTeamMutation.mutate();
          }}
          className="space-y-4"
        >
          {editTeamError && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{editTeamError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="edit-team-name"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
            >
              Team Name <span className="text-rose-500">*</span>
            </label>
            <input
              id="edit-team-name"
              type="text"
              required
              value={editTeamName}
              onChange={(e) => setEditTeamName(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-semibold text-[#071A2B] outline-none focus:border-[#071A2B] focus:bg-white focus:ring-4 focus:ring-[#071A2B]/5 shadow-xs"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="edit-team-desc"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
            >
              Description
            </label>
            <textarea
              id="edit-team-desc"
              rows={3}
              value={editTeamDescription}
              onChange={(e) => setEditTeamDescription(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-semibold text-[#071A2B] outline-none focus:border-[#071A2B] focus:bg-white focus:ring-4 focus:ring-[#071A2B]/5 shadow-xs resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setEditingTeam(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              isLoading={updateTeamMutation.isPending}
              disabled={!editTeamName.trim()}
              className="rounded-full px-6 font-bold bg-[#071A2B] hover:bg-[#0E2841] text-white shadow-xs"
            >
              Save Changes
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ── MODAL: ARCHIVE TEAM ───────────────────────────────────────────────── */}
      <Dialog
        open={!!archivingTeam}
        onClose={() => setArchivingTeam(null)}
        title="Archive Contractor Team"
        description={
          archivingTeam
            ? `Archive team "${archivingTeam.name}". Archiving is only allowed when a team has 0 members.`
            : ''
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            archiveTeamMutation.mutate();
          }}
          className="space-y-4"
        >
          {archiveError && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{archiveError}</AlertDescription>
            </Alert>
          )}

          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
            <p className="font-bold">Are you sure you want to archive this team?</p>
            <p>The team will be deactivated. History and audit records will remain preserved.</p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setArchivingTeam(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              isLoading={archiveTeamMutation.isPending}
              disabled={archiveTeamMutation.isPending}
              className="rounded-full px-6 font-bold"
            >
              Confirm Archive
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ── MODAL: ASSIGN / TRANSFER / REMOVE WORKER ──────────────────────────── */}
      <Dialog
        open={!!assigningWorker}
        onClose={() => setAssigningWorker(null)}
        title={assigningWorker?.teamId ? 'Transfer or Remove Worker Team' : 'Assign Worker to Team'}
        description={
          assigningWorker
            ? `Worker: ${assigningWorker.displayName} · Current Team: ${
                assigningWorker.teamName || 'None'
              }`
            : ''
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            assignWorkerMutation.mutate();
          }}
          className="space-y-4"
        >
          {assignError && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{assignError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="assign-team-target"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
            >
              Target Team <span className="text-rose-500">*</span>
            </label>
            <select
              id="assign-team-target"
              aria-label="Target Team"
              value={targetTeamId}
              onChange={(e) => setTargetTeamId(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-semibold text-[#071A2B] outline-none focus:border-[#071A2B] focus:bg-white focus:ring-4 focus:ring-[#071A2B]/5 shadow-xs cursor-pointer"
            >
              <option value="UNASSIGN">-- Remove from Team --</option>
              {activeTeamsList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.memberCount} members)
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500">
              Each worker can belong to at most one active team per site.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setAssigningWorker(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              isLoading={assignWorkerMutation.isPending}
              disabled={targetTeamId === 'UNASSIGN' && !assigningWorker?.membershipId}
              className="rounded-full px-6 font-bold bg-[#071A2B] hover:bg-[#0E2841] text-white shadow-xs"
            >
              Confirm Assignment
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
