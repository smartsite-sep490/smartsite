import { localizedLabel } from '../../i18n/labels';
import { uiLocale } from '../../i18n';
import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { StatusBadge, TechnicalDetails } from '../safety/SafetyWorkflowUi';
import { IncidentView } from '../safety/IncidentView';
import { SafetyTasksView } from '../safety/SafetyTasksView';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  SmartSiteManagementClient,
  type LoginResponse,
  type SafetyAlertResponse,
  type SafetyAlertReviewTargetStatus,
  type SafetyAlertStatus,
  type SafetyAlertType,
} from '@smartsite/api-client';
import { SafetyAlertEvidencePanel } from './SafetyAlertEvidencePanel';

export interface SafetyAlertsViewProps {
  apiUrl: string;
  authenticatedSession?: Pick<LoginResponse, 'accessToken' | 'user'>;
  onSignOut?: () => void;
  initialSiteId?: string;
  initialAlertId?: string;
  initialIncidentId?: string;
  initialActionId?: string;
  initialStatus?: 'ALL' | SafetyAlertStatus;
  initialType?: 'ALL' | SafetyAlertType;
}

const statusOptions: readonly SafetyAlertStatus[] = [
  'PENDING_REVIEW',
  'NEEDS_MORE_EVIDENCE',
  'CONFIRMED',
  'DISMISSED',
  'CLOSED',
];

const alertTypeOptions: readonly SafetyAlertType[] = ['PPE_VIOLATION', 'RESTRICTED_ZONE_INTRUSION'];
const alertPageSize = 20;

function formatLabel(value: string): string {
  const translated = localizedLabel(value);
  return translated !== value
    ? translated
    : value
        .toLowerCase()
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(uiLocale());
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return tr('safety_alert_evidence_utils.your_session_is_no_longer_valid_sign_in_again');
    if (error.status === 403)
      return tr('safety_alerts_view.this_account_cannot_view_the_selected_site_alerts');
    if (error.status === 404)
      return tr('safety_alerts_view.the_requested_safety_alert_or_site_was_not_found');
    if (error.status === 409)
      return tr(
        'safety_alerts_view.this_alert_changed_while_you_were_reviewing_it_the_latest_record_has_been_loaded_r',
      );
    if (error.code === 'network') return tr('safety_alerts_view.could_not_connect_to_the_backend');
    return error.message;
  }
  return error instanceof Error
    ? error.message
    : tr('access_control_view.the_request_could_not_be_completed');
}

function statusTone(status: SafetyAlertStatus): string {
  if (status === 'PENDING_REVIEW') return 'bg-[#FBF3DB] text-[#956400] border-[#EAEAEA]';
  if (status === 'NEEDS_MORE_EVIDENCE') return 'bg-[#E1F3FE] text-[#1F6C9F] border-[#EAEAEA]';
  if (status === 'CONFIRMED') return 'bg-[#FDEBEC] text-[#9F2F2D] border-[#EAEAEA]';
  return 'bg-[#F7F6F3] text-[#6B6B6B] border-[#EAEAEA]';
}

function AlertRow({
  alert,
  selected,
  onSelect,
}: {
  alert: SafetyAlertResponse;
  selected: boolean;
  onSelect(): void;
}) {
  useTranslation();

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`w-full min-w-0 rounded-lg border p-3 sm:p-4 text-left transition-colors ${
        selected
          ? 'border-[#F66B17] bg-[#FBF3DB]/30'
          : 'border-[#EAEAEA] bg-white hover:border-[#2F3437]/15 hover:bg-[#F7F6F3]'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-[#6B6B6B]">
            {formatLabel(alert.alertType)}
          </p>
          <p className="mt-1 font-semibold text-[#2F3437] break-words">
            {formatLabel(alert.candidateSubtype)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusTone(alert.status)}`}
        >
          {formatLabel(alert.status)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6B6B6B]">
        <span>{tr('common.value_detections', { value1: alert.detectionCount })}</span>
        <span>{tr('common.last_seen_value', { value1: formatDate(alert.lastDetectedAt) })}</span>
        <span>
          {alert.zoneId
            ? tr('common.zone_value', { value1: alert.zoneId.slice(0, 8) })
            : tr('common.no_resolved_zone')}
        </span>
      </div>
    </button>
  );
}

function initialWorkspaceTab(
  session: Pick<LoginResponse, 'user'>,
): 'Alerts' | 'Incidents' | 'Safety Tasks' {
  const roles = session.user.roleAssignments;
  return roles.some(({ role }) => role === 'SAFETY_OFFICER' || role === 'ADMIN')
    ? 'Alerts'
    : roles.some(({ role }) => role === 'CONTRACTOR_REPRESENTATIVE')
      ? 'Incidents'
      : 'Safety Tasks';
}

export function SafetyAlertsView({
  apiUrl,
  authenticatedSession,
  onSignOut,
  initialSiteId,
  initialAlertId,
  initialIncidentId,
  initialActionId,
  initialStatus,
  initialType,
}: SafetyAlertsViewProps) {
  useTranslation();

  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const queryClient = useQueryClient();
  const [workspaceTab, setWorkspaceTab] = useState<'Alerts' | 'Incidents' | 'Safety Tasks'>(
    initialIncidentId
      ? 'Incidents'
      : authenticatedSession
        ? initialWorkspaceTab(authenticatedSession)
        : 'Alerts',
  );
  const incidentLink = (initialIncidentId ?? '') + ':' + (initialActionId ?? '');
  const [previousIncidentLink, setPreviousIncidentLink] = useState(incidentLink);
  if (previousIncidentLink !== incidentLink) {
    setPreviousIncidentLink(incidentLink);
    if (initialIncidentId) setWorkspaceTab('Incidents');
  }
  const [incidentSourceAlert, setIncidentSourceAlert] = useState('');
  const [mobileAlertDetail, setMobileAlertDetail] = useState(false);
  const [localSession, setSession] = useState<LoginResponse | null>(null);
  const session = authenticatedSession ?? localSession;
  const externalSession = authenticatedSession !== undefined;
  const [sessionScope, setSessionScope] = useState<string>(() => crypto.randomUUID());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [requestedSiteId, setRequestedSiteId] = useState(initialSiteId ?? '');
  const [requestedAlertId, setRequestedAlertId] = useState(initialAlertId ?? '');
  const [status, setStatus] = useState<'ALL' | SafetyAlertStatus>(initialStatus ?? 'ALL');
  const [type, setType] = useState<'ALL' | SafetyAlertType>(initialType ?? 'ALL');
  const [offset, setOffset] = useState(0);
  const [reviewReason, setReviewReason] = useState('');
  const activeSession = useRef<{ token: string; userId: string; sessionScope: string } | null>(
    null,
  );
  const lifecycleGeneration = useRef(0);
  const externalScope = useRef(sessionScope);

  // Minimal appropriate mount semantics: adjust filters when navigation initial* props change without useEffect
  const [prevInitialType, setPrevInitialType] = useState(initialType);
  if (prevInitialType !== initialType) {
    setPrevInitialType(initialType);
    setType(initialType ?? 'ALL');
  }

  const [prevInitialStatus, setPrevInitialStatus] = useState(initialStatus);
  if (prevInitialStatus !== initialStatus) {
    setPrevInitialStatus(initialStatus);
    setStatus(initialStatus ?? 'ALL');
  }

  const [prevInitialSiteId, setPrevInitialSiteId] = useState(initialSiteId);
  if (prevInitialSiteId !== initialSiteId) {
    setPrevInitialSiteId(initialSiteId);
    setRequestedSiteId(initialSiteId ?? '');
    setRequestedAlertId('');
    setMobileAlertDetail(false);
    setIncidentSourceAlert('');
  }

  const [prevInitialAlertId, setPrevInitialAlertId] = useState(initialAlertId);
  if (prevInitialAlertId !== initialAlertId) {
    setPrevInitialAlertId(initialAlertId);
    setRequestedAlertId(initialAlertId ?? '');
  }

  const removeSessionQueries = useCallback(
    (scope: string) => {
      void queryClient.cancelQueries({ queryKey: ['sites', apiUrl, scope] });
      void queryClient.cancelQueries({ queryKey: ['safety-alerts', apiUrl, scope] });
      void queryClient.cancelQueries({ queryKey: ['safety-alert', apiUrl, scope] });
      void queryClient.cancelQueries({ queryKey: ['safety-workflow', apiUrl, scope] });
      queryClient.removeQueries({ queryKey: ['safety-workflow', apiUrl, scope] });
      for (const mutation of queryClient.getMutationCache().getAll())
        if (mutation.options.meta?.safetySession === scope)
          queryClient.getMutationCache().remove(mutation);
      // Cancel sensitive in-flight queries
      void queryClient.cancelQueries({ queryKey: ['safety-alert-evidence', apiUrl, scope] });
      void queryClient.cancelQueries({ queryKey: ['observation-identity-context', apiUrl, scope] });
      void queryClient.cancelQueries({ queryKey: ['observation-identity-workers', apiUrl, scope] });
      void queryClient.cancelQueries({
        queryKey: ['observation-identity-decisions', apiUrl, scope],
      });

      // Evict all session and identity data from TanStack cache
      queryClient.removeQueries({ queryKey: ['sites', apiUrl, scope] });
      queryClient.removeQueries({ queryKey: ['safety-alerts', apiUrl, scope] });
      queryClient.removeQueries({ queryKey: ['safety-alert', apiUrl, scope] });
      queryClient.removeQueries({ queryKey: ['safety-alert-evidence', apiUrl, scope] });
      queryClient.removeQueries({ queryKey: ['observation-identity-context', apiUrl, scope] });
      queryClient.removeQueries({ queryKey: ['observation-identity-workers', apiUrl, scope] });
      queryClient.removeQueries({ queryKey: ['observation-identity-decisions', apiUrl, scope] });
    },
    [apiUrl, queryClient],
  );

  const login = useMutation({
    mutationFn: async () => {
      const generation = lifecycleGeneration.current;
      const result = await client.login(username, password);
      const canReviewSafetyAlerts = result.user.roleAssignments.some(
        ({ role, siteId }) =>
          (role === 'ADMIN' && siteId === null) ||
          (['SAFETY_OFFICER', 'CONTRACTOR_REPRESENTATIVE', 'SITE_MANAGER'].includes(role) &&
            siteId !== null),
      );
      if (!canReviewSafetyAlerts) {
        await client.logout().catch(() => undefined);
        throw new Error(
          tr(
            'safety_alerts_view.a_global_admin_or_site_scoped_safety_contractor_representative_or_manager_role_is',
          ),
        );
      }
      if (result.user.mustChangePassword) {
        await client.logout().catch(() => undefined);
        throw new Error(
          tr('safety_alerts_view.change_the_temporary_password_before_opening_safety_alerts'),
        );
      }
      if (generation !== lifecycleGeneration.current) {
        void client.logout().catch(() => undefined);
        return;
      }
      const freshScope = crypto.randomUUID();
      activeSession.current = {
        token: result.accessToken,
        userId: result.user.id,
        sessionScope: freshScope,
      };
      setWorkspaceTab(initialWorkspaceTab(result));
      setSession(result);
      setSessionScope(freshScope);
      setIncidentSourceAlert('');
      setPassword('');
      // Do not retain LoginResponse in TanStack mutation data because it contains the access token.
    },
  });

  useEffect(() => {
    if (authenticatedSession)
      activeSession.current = {
        token: authenticatedSession.accessToken,
        userId: authenticatedSession.user.id,
        sessionScope,
      };
  }, [authenticatedSession, sessionScope]);

  useEffect(() => {
    lifecycleGeneration.current += 1;
    const scope = externalScope.current;
    return () => {
      lifecycleGeneration.current += 1;
      const current = activeSession.current;
      activeSession.current = null;
      if (externalSession) {
        removeSessionQueries(scope);
        return;
      }
      if (!current) return;
      removeSessionQueries(current.sessionScope);
      void client.logout().catch(() => undefined);
    };
  }, [client, removeSessionQueries, externalSession]);

  const token = session?.accessToken ?? '';
  const sites = useQuery({
    queryKey: ['sites', apiUrl, sessionScope],
    queryFn: ({ signal }) => client.listSites(token, { limit: 100 }, { signal }),
    enabled: token.length > 0,
  });

  const isGlobalAdmin =
    session?.user.roleAssignments.some(({ role, siteId }) => role === 'ADMIN' && siteId === null) ??
    false;
  const safetyOfficerSiteIds = useMemo(
    () =>
      new Set(
        session?.user.roleAssignments.flatMap(({ role, siteId }) =>
          ['SAFETY_OFFICER', 'CONTRACTOR_REPRESENTATIVE', 'SITE_MANAGER'].includes(role) &&
          siteId !== null
            ? [siteId]
            : [],
        ) ?? [],
      ),
    [session],
  );
  const visibleSites = useMemo(
    () =>
      sites.data?.items.filter((site) => isGlobalAdmin || safetyOfficerSiteIds.has(site.id)) ?? [],
    [isGlobalAdmin, safetyOfficerSiteIds, sites.data?.items],
  );

  const selectedSiteId = visibleSites.some((site) => site.id === requestedSiteId)
    ? requestedSiteId
    : (visibleSites[0]?.id ?? '');

  const canAlerts =
    isGlobalAdmin ||
    session?.user.roleAssignments.some(
      (r) => r.role === 'SAFETY_OFFICER' && r.siteId === selectedSiteId,
    );
  const canTasks =
    isGlobalAdmin ||
    session?.user.roleAssignments.some(
      (r) => ['SAFETY_OFFICER', 'SITE_MANAGER'].includes(r.role) && r.siteId === selectedSiteId,
    );
  const alerts = useQuery({
    queryKey: ['safety-alerts', apiUrl, sessionScope, selectedSiteId, status, type, offset],
    queryFn: ({ signal }) =>
      client.listSafetyAlerts(
        token,
        selectedSiteId,
        {
          offset,
          limit: alertPageSize,
          ...(status === 'ALL' ? {} : { status }),
          ...(type === 'ALL' ? {} : { type }),
        },
        { signal },
      ),
    enabled:
      token.length > 0 && selectedSiteId.length > 0 && !!canAlerts && workspaceTab === 'Alerts',
  });

  const selectedAlertId = requestedAlertId || alerts.data?.items[0]?.id || '';

  const detail = useQuery({
    queryKey: ['safety-alert', apiUrl, sessionScope, selectedSiteId, selectedAlertId],
    queryFn: ({ signal }) =>
      client.getSafetyAlert(token, selectedSiteId, selectedAlertId, { signal }),
    enabled:
      token.length > 0 &&
      selectedSiteId.length > 0 &&
      selectedAlertId.length > 0 &&
      !!canAlerts &&
      workspaceTab === 'Alerts',
  });

  const review = useMutation({
    mutationFn: async (targetStatus: SafetyAlertReviewTargetStatus) => {
      if (!detail.data)
        throw new Error(tr('safety_alerts_view.load_an_alert_before_submitting_a_review'));
      return client.reviewSafetyAlert(token, selectedSiteId, detail.data.id, {
        commandId: crypto.randomUUID(),
        expectedRevision: detail.data.revision,
        targetStatus,
        reason: reviewReason,
      });
    },
    onSuccess: async (result) => {
      if (activeSession.current?.sessionScope !== sessionScope) return;
      setRequestedAlertId(result.alert.id);
      setReviewReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['safety-alerts', apiUrl, sessionScope] }),
        queryClient.invalidateQueries({ queryKey: ['safety-alert', apiUrl, sessionScope] }),
      ]);
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409) {
        await Promise.all([alerts.refetch(), detail.refetch()]);
      }
    },
  });

  const resetReviewDraft = () => {
    review.reset();
    setReviewReason('');
  };

  const handleLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    login.mutate();
  };

  const handleLogout = () => {
    if (externalSession) {
      removeSessionQueries(sessionScope);
      onSignOut?.();
      return;
    }
    const current = activeSession.current;
    activeSession.current = null;
    if (current) removeSessionQueries(current.sessionScope);
    login.reset();
    setSession(null);
    setSessionScope('');
    setIncidentSourceAlert('');
    setRequestedSiteId('');
    setRequestedAlertId('');
    setOffset(0);
    setReviewReason('');
    if (current) void client.logout().catch(() => undefined);
  };

  if (!session) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-[#EAEAEA] bg-white p-7">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B6B6B]">
          {tr('common.site_safety_workspace')}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-[#2F3437]">
          {tr('common.safety_alert_queue')}
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#6B6B6B]">
          {tr(
            'safety_alerts_view.sign_in_with_your_site_role_to_manage_incidents_corrective_work_and_safety_tasks_o',
          )}
        </p>
        <form className="mt-6 space-y-4" onSubmit={handleLogin}>
          <label className="block text-sm font-semibold text-[#2F3437]">
            {tr('common.username')}
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1.5 w-full rounded-md border border-[#EAEAEA] px-3 py-2.5 font-normal outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
            />
          </label>
          <label className="block text-sm font-semibold text-[#2F3437]">
            {tr('common.password')}
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1.5 w-full rounded-md border border-[#EAEAEA] px-3 py-2.5 font-normal outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
            />
          </label>
          {login.error && (
            <p role="alert" className="rounded-md bg-[#FDEBEC] px-3 py-2 text-sm text-[#9F2F2D]">
              {errorMessage(login.error)}
            </p>
          )}
          <button
            type="submit"
            disabled={login.isPending}
            className="w-full rounded-md bg-[#111111] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#333333] disabled:cursor-wait disabled:opacity-60"
          >
            {login.isPending ? tr('common.signing_in') : tr('common.sign_in')}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1202px] w-full min-w-0 space-y-6 pb-10 text-[#2F3437]">
      <header className="flex flex-wrap items-start justify-between gap-4 min-w-0">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B6B6B]">
            {tr('common.site_safety_workspace')}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#111111]">
            {tr('common.safety_operations')}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6B6B6B]">
            {tr(
              'safety_alerts_view.review_alerts_manage_corrective_work_and_verify_safety_tasks_for_your_site',
            )}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <label className="min-w-0 text-xs font-bold uppercase tracking-wider text-[#6B6B6B]">
            {tr('common.site_fa7955')}
            <select
              value={selectedSiteId}
              onChange={(event) => {
                setRequestedSiteId(event.target.value);
                setMobileAlertDetail(false);
                setIncidentSourceAlert('');
                setRequestedAlertId('');
                setOffset(0);
                resetReviewDraft();
              }}
              disabled={sites.isPending || visibleSites.length === 0}
              className="mt-1.5 w-full min-w-0 truncate rounded-md border border-[#EAEAEA] bg-white px-3 py-2 text-sm font-semibold text-[#2F3437]"
            >
              {visibleSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.code} · {site.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-md border border-[#EAEAEA] bg-white px-3 py-2 text-sm font-semibold text-[#2F3437] hover:bg-[#F7F6F3] shrink-0 max-w-full truncate"
          >
            {tr('common.sign_out_value', { value1: session.user.displayName })}
          </button>
        </div>
      </header>

      <nav
        className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-2"
        aria-label={tr('common.safety_workspace')}
      >
        {(['Alerts', 'Incidents', 'Safety Tasks'] as const).map((tab) => (
          <button
            type="button"
            key={localizedLabel(tab)}
            aria-pressed={workspaceTab === tab}
            disabled={(tab === 'Alerts' && !canAlerts) || (tab === 'Safety Tasks' && !canTasks)}
            onClick={() => setWorkspaceTab(tab)}
            className={
              'min-h-11 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ' +
              (workspaceTab === tab
                ? 'bg-[#111] text-white'
                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-bone)]')
            }
          >
            {tab}
          </button>
        ))}
      </nav>
      <section
        className={
          'grid gap-3 sm:gap-4 rounded-xl border border-[#EAEAEA] bg-white p-4 grid-cols-1 sm:grid-cols-2 min-w-0 ' +
          (workspaceTab === 'Alerts' && canAlerts
            ? mobileAlertDetail
              ? 'hidden lg:grid'
              : ''
            : 'hidden')
        }
      >
        {workspaceTab === 'Alerts' && canAlerts && (
          <>
            <label className="min-w-0 text-xs font-bold uppercase tracking-wider text-[#6B6B6B]">
              {tr('common.status')}
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as 'ALL' | SafetyAlertStatus);
                  setRequestedAlertId('');
                  setOffset(0);
                  resetReviewDraft();
                }}
                className="mt-1.5 w-full min-w-0 truncate rounded-md border border-[#EAEAEA] bg-white px-3 py-2 text-sm font-semibold text-[#2F3437]"
              >
                <option value="ALL">{tr('common.all_statuses_8ee573')}</option>
                {statusOptions.map((value) => (
                  <option key={value} value={value}>
                    {formatLabel(value)}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 text-xs font-bold uppercase tracking-wider text-[#6B6B6B] sm:col-span-2 lg:col-span-1">
              {tr('common.alert_type')}
              <select
                value={type}
                onChange={(event) => {
                  setType(event.target.value as 'ALL' | SafetyAlertType);
                  setRequestedAlertId('');
                  setOffset(0);
                  resetReviewDraft();
                }}
                className="mt-1.5 w-full min-w-0 truncate rounded-md border border-[#EAEAEA] bg-white px-3 py-2 text-sm font-semibold text-[#2F3437]"
              >
                <option value="ALL">{tr('common.all_types')}</option>
                {alertTypeOptions.map((value) => (
                  <option key={value} value={value}>
                    {formatLabel(value)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </section>

      {sites.isPending && (
        <p className="rounded-lg bg-white p-5 text-sm">{tr('common.loading_sites_c334d0')}</p>
      )}
      {sites.error && (
        <p role="alert" className="rounded-lg bg-[#FDEBEC] p-5 text-sm text-[#9F2F2D]">
          {errorMessage(sites.error)}
        </p>
      )}
      {sites.data && visibleSites.length === 0 && (
        <p className="rounded-lg bg-white p-5 text-sm text-[#6B6B6B]">
          {tr('safety_alerts_view.no_site_with_safety_workflow_access_is_assigned_to_this_account')}
        </p>
      )}

      {selectedSiteId && workspaceTab === 'Incidents' && (
        <IncidentView
          initialIncidentId={initialIncidentId}
          initialActionId={initialActionId}
          key={sessionScope + selectedSiteId}
          client={client}
          apiUrl={apiUrl}
          scope={sessionScope}
          token={token}
          siteId={selectedSiteId}
          user={session.user}
          initialAlertId={incidentSourceAlert}
          onSourceConsumed={() => setIncidentSourceAlert('')}
        />
      )}
      {selectedSiteId && workspaceTab === 'Safety Tasks' && canTasks && (
        <SafetyTasksView
          key={sessionScope + selectedSiteId}
          client={client}
          apiUrl={apiUrl}
          scope={sessionScope}
          token={token}
          siteId={selectedSiteId}
          user={session.user}
        />
      )}
      {selectedSiteId && workspaceTab === 'Alerts' && canAlerts && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(240px,0.65fr)_minmax(0,1.35fr)] min-w-0">
          <section
            aria-label={tr('common.alert_list')}
            className={'space-y-3 min-w-0 ' + (mobileAlertDetail ? 'hidden lg:block' : '')}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[#111111]">{tr('common.alert_queue')}</h2>
                {alerts.data && (
                  <p className="text-xs text-[#6B6B6B]">
                    {alerts.data.total === 0
                      ? tr('common.0_alerts')
                      : tr('common.value_value_of_value', {
                          value1: offset + 1,
                          value2: Math.min(offset + alerts.data.items.length, alerts.data.total),
                          value3: alerts.data.total,
                        })}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  void alerts.refetch();
                  if (selectedAlertId) void detail.refetch();
                }}
                className="text-sm font-semibold text-[#F66B17] hover:text-[#D94E07] cursor-pointer"
              >
                {tr('common.refresh')}
              </button>
            </div>
            {alerts.isPending && (
              <p className="rounded-lg bg-white p-5 text-sm">{tr('common.loading_alerts')}</p>
            )}
            {alerts.error && (
              <p role="alert" className="rounded-lg bg-[#FDEBEC] p-5 text-sm text-[#9F2F2D]">
                {errorMessage(alerts.error)}
              </p>
            )}
            {alerts.data?.items.length === 0 && (
              <p className="rounded-lg border border-dashed border-[#EAEAEA] bg-white p-8 text-center text-sm text-[#6B6B6B]">
                {tr('safety_alerts_view.no_alerts_match_the_selected_site_and_filters')}
              </p>
            )}
            {alerts.data?.items.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                selected={selectedAlertId === alert.id}
                onSelect={() => {
                  if (alert.id !== selectedAlertId) resetReviewDraft();
                  setRequestedAlertId(alert.id);
                  setMobileAlertDetail(true);
                }}
              />
            ))}
            {alerts.data && alerts.data.total > alertPageSize && (
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={offset === 0 || alerts.isFetching}
                  onClick={() => {
                    resetReviewDraft();
                    setRequestedAlertId('');
                    setMobileAlertDetail(false);
                    setOffset((value) => Math.max(0, value - alertPageSize));
                  }}
                  className="rounded-md border border-[#EAEAEA] bg-white px-3 py-2 text-xs font-bold text-[#2F3437] hover:bg-[#F7F6F3] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {tr('common.previous')}
                </button>
                <button
                  type="button"
                  disabled={
                    offset + alerts.data.items.length >= alerts.data.total || alerts.isFetching
                  }
                  onClick={() => {
                    resetReviewDraft();
                    setRequestedAlertId('');
                    setMobileAlertDetail(false);
                    setOffset((value) => value + alertPageSize);
                  }}
                  className="rounded-md border border-[#EAEAEA] bg-white px-3 py-2 text-xs font-bold text-[#2F3437] hover:bg-[#F7F6F3] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {tr('common.next')}
                </button>
              </div>
            )}
          </section>

          <aside
            aria-label={tr('common.alert_detail')}
            className={
              'min-h-80 rounded-xl border border-[#EAEAEA] bg-white p-4 sm:p-5 min-w-0 ' +
              (!mobileAlertDetail ? 'hidden lg:block' : '')
            }
          >
            <button
              type="button"
              className="mb-4 min-h-10 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold lg:hidden"
              onClick={() => setMobileAlertDetail(false)}
            >
              {tr('common.back_to_alerts')}
            </button>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-[#111111]">{tr('common.alert_detail')}</h2>
              {selectedAlertId && (
                <button
                  type="button"
                  onClick={() => void detail.refetch()}
                  className="text-xs font-semibold text-[#F66B17] hover:text-[#D94E07] cursor-pointer"
                >
                  {tr('common.refresh_detail')}
                </button>
              )}
            </div>
            {!selectedAlertId && (
              <p className="mt-4 text-sm text-[#6B6B6B]">
                {tr('safety_alerts_view.select_an_alert_to_inspect_its_sources')}
              </p>
            )}
            {detail.isPending && selectedAlertId && (
              <p className="mt-4 text-sm text-[#6B6B6B]">{tr('common.loading_alert_detail')}</p>
            )}
            {detail.error && (
              <p role="alert" className="mt-4 rounded-md bg-[#FDEBEC] p-3 text-sm text-[#9F2F2D]">
                {errorMessage(detail.error)}
              </p>
            )}
            {detail.data && (
              <div className="mt-4 space-y-5 min-w-0">
                <TechnicalDetails>
                  {tr('safety_alerts_view.alert_value_revision_value', {
                    value1: detail.data.id,
                    value2: detail.data.revision,
                  })}
                </TechnicalDetails>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm min-w-0">
                  <div>
                    <dt className="text-[#6B6B6B]">{tr('common.candidate_identity')}</dt>
                    <dd className="mt-1 font-semibold text-[#2F3437] break-words">
                      {detail.data.candidateWorkerId ?? tr('common.unknown')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#6B6B6B]">{tr('common.detections')}</dt>
                    <dd className="mt-1 font-semibold text-[#2F3437]">
                      {detail.data.detectionsTotal}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#6B6B6B]">{tr('common.status')}</dt>
                    <dd className="mt-1 font-semibold text-[#2F3437] break-words">
                      <StatusBadge value={detail.data.status} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#6B6B6B]">{tr('common.first_seen')}</dt>
                    <dd className="mt-1 font-semibold text-[#2F3437] break-words">
                      {formatDate(detail.data.firstDetectedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#6B6B6B]">{tr('common.last_seen')}</dt>
                    <dd className="mt-1 font-semibold text-[#2F3437] break-words">
                      {formatDate(detail.data.lastDetectedAt)}
                    </dd>
                  </div>
                </dl>
                <div>
                  <h3 className="text-sm font-bold text-[#2F3437]">
                    {tr('common.evidence_amp_sources')}
                  </h3>
                  <div
                    className={`mt-2 space-y-2 ${safetyOfficerSiteIds.has(selectedSiteId) ? '' : 'max-h-80 overflow-auto'}`}
                  >
                    {detail.data.detections.map((detection) => (
                      <div
                        key={`${detail.data.id}:${detection.eventId}`}
                        className="rounded-md bg-[#F7F6F3] p-3 text-xs min-w-0"
                      >
                        <div className="flex justify-between gap-3">
                          <span className="font-mono font-semibold text-[#2F3437]">
                            {detection.cameraExternalId}
                          </span>
                          <span className="font-bold text-[#346538]">
                            {formatLabel(detection.processingStatus)}
                          </span>
                        </div>
                        <p className="mt-1 text-[#6B6B6B]">{formatDate(detection.capturedAt)}</p>
                        <TechnicalDetails>
                          {tr('common.observation')} <span>{detection.eventId}</span>
                        </TechnicalDetails>
                        <SafetyAlertEvidencePanel
                          client={client}
                          apiUrl={apiUrl}
                          sessionScope={sessionScope}
                          token={token}
                          siteId={selectedSiteId}
                          alertId={detail.data.id}
                          detection={detection}
                          canReviewIdentity={safetyOfficerSiteIds.has(selectedSiteId)}
                        />
                      </div>
                    ))}
                    {detail.data.detections.length === 0 && (
                      <p className="rounded-md bg-[#F7F6F3] p-3 text-sm text-[#6B6B6B]">
                        {tr('safety_alerts_view.no_source_observation_is_linked_to_this_alert')}
                      </p>
                    )}
                  </div>
                </div>
                {(detail.data.status === 'PENDING_REVIEW' ||
                  detail.data.status === 'NEEDS_MORE_EVIDENCE') && (
                  <section className="rounded-lg border border-[#EAEAEA] bg-[#F7F6F3] p-3 sm:p-4 min-w-0">
                    <h3 className="text-sm font-bold text-[#111111]">
                      {tr('common.record_review_decision')}
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-[#6B6B6B]">
                      {tr(
                        'safety_alerts_view.explain_the_evidence_behind_the_decision_the_reason_is_required_and_cannot_be_edit',
                      )}
                    </p>
                    <label
                      htmlFor="review-reason-textarea"
                      className="mt-3 block text-xs font-semibold text-[#2F3437]"
                    >
                      {tr('common.decision_reason')}{' '}
                      <span className="font-normal text-[#6B6B6B]">
                        {tr('common.minimum_5_characters')}
                      </span>
                    </label>
                    <textarea
                      id="review-reason-textarea"
                      name="reviewReason"
                      aria-label={tr('safety_alerts_view.decision_reason_minimum_5_characters')}
                      value={reviewReason}
                      onChange={(event) => setReviewReason(event.target.value)}
                      minLength={5}
                      maxLength={1000}
                      rows={3}
                      placeholder={tr(
                        'safety_alerts_view.example_worker_is_clearly_visible_without_a_hard_hat_across_the_linked_observation',
                      )}
                      className="mt-1.5 w-full min-w-0 rounded-md border border-[#EAEAEA] bg-white px-3 py-2 text-sm outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10 placeholder:text-[#6B6B6B]"
                    />
                    {review.error && (
                      <p
                        role="alert"
                        className="mt-2 rounded-md bg-[#FDEBEC] p-2 text-xs text-[#9F2F2D]"
                      >
                        {errorMessage(review.error)}
                      </p>
                    )}
                    {review.isSuccess && (
                      <p
                        role="status"
                        className="mt-2 rounded-md bg-[#EDF3EC] p-2 text-xs text-[#346538]"
                      >
                        {tr('common.review_decision_recorded')}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={reviewReason.trim().length < 5 || review.isPending}
                        onClick={() => review.mutate('CONFIRMED')}
                        className="rounded-md bg-[#9F2F2D] px-3 py-2 text-xs font-bold text-white hover:bg-[#7F2524] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {tr('common.confirm_violation')}
                      </button>
                      <button
                        type="button"
                        disabled={reviewReason.trim().length < 5 || review.isPending}
                        onClick={() => review.mutate('DISMISSED')}
                        className="rounded-md bg-[#111111] px-3 py-2 text-xs font-bold text-white hover:bg-[#333333] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {tr('common.dismiss_alert')}
                      </button>
                      {detail.data.status === 'PENDING_REVIEW' && (
                        <button
                          type="button"
                          disabled={reviewReason.trim().length < 5 || review.isPending}
                          onClick={() => review.mutate('NEEDS_MORE_EVIDENCE')}
                          className="rounded-md border border-[#1F6C9F]/30 bg-white px-3 py-2 text-xs font-bold text-[#1F6C9F] hover:bg-[#E1F3FE] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {tr('common.request_more_evidence')}
                        </button>
                      )}
                    </div>
                  </section>
                )}
                {detail.data.status === 'CONFIRMED' &&
                  !detail.data.incidentId &&
                  session.user.roleAssignments.some(
                    (r) => r.role === 'SAFETY_OFFICER' && r.siteId === selectedSiteId,
                  ) && (
                    <button
                      type="button"
                      className="min-h-10 rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--action-primary-hover)]"
                      onClick={() => {
                        setIncidentSourceAlert(detail.data!.id);
                        setWorkspaceTab('Incidents');
                      }}
                    >
                      {tr('safety_alerts_view.create_incident_from_alert')}
                    </button>
                  )}
                <section className="min-w-0">
                  <h3 className="text-sm font-bold text-[#2F3437]">
                    {tr('common.review_history_value', { value1: detail.data.reviewsTotal })}
                  </h3>
                  <div className="mt-2 space-y-2">
                    {detail.data.reviews.map((item) => (
                      <article
                        key={item.id}
                        className="rounded-md border border-[#EAEAEA] p-3 text-xs min-w-0"
                      >
                        <div className="flex flex-wrap justify-between gap-2">
                          <span className="font-bold text-[#2F3437] break-words">
                            {formatLabel(item.fromStatus)} → {formatLabel(item.toStatus)}
                          </span>
                          <time className="text-[#6B6B6B]">{formatDate(item.createdAt)}</time>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-[#2F3437]">
                          {item.reason}
                        </p>
                        <TechnicalDetails>
                          {tr('safety_alerts_view.actor_value_revision_value', {
                            value1: item.actorUserId,
                            value2: item.alertRevision,
                          })}
                        </TechnicalDetails>
                      </article>
                    ))}
                    {detail.data.reviews.length === 0 && (
                      <p className="rounded-md bg-[#F7F6F3] p-3 text-sm text-[#6B6B6B]">
                        {tr('safety_alerts_view.no_review_decision_has_been_recorded')}
                      </p>
                    )}
                  </div>
                </section>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
