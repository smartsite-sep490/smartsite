import { useManagementClient } from '../../features/auth/auth-session';
import { SafetyOverviewView } from '../safety/SafetyOverviewView';
import { SafetyChecklistsView } from '../safety/SafetyChecklistsView';
import { AlertWorkContext } from '../safety/AlertWorkContext';
import type { RelatedAlertFilter } from '../safety/safety-context';
import { localizedLabel } from '../../i18n/labels';
import { SAFETY_NAMESPACE, translate as tr, uiLocale } from '../../i18n';
import '../../i18n/ppe-catalog';
import { useTranslation } from 'react-i18next';
import { StatusBadge, TechnicalDetails } from '../safety/SafetyWorkflowUi';
import { IncidentView } from '../safety/IncidentView';
import { SafetyTasksView } from '../safety/SafetyTasksView';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  type AccountResponse,
  type LoginResponse,
  type SafetyAlertResponse,
  type SafetyAlertReviewTargetStatus,
  type SafetyAlertStatus,
  type SafetyAlertType,
} from '@smartsite/api-client';
import { SafetyAlertEvidencePanel } from './SafetyAlertEvidencePanel';
import { formatCandidateSubtype } from './safetyAlertEvidenceUtils';
import type { SharedSession } from '../../types/shared-session';
import { useLocale } from '../../i18n/ppe-locale';

export interface SafetyAlertsViewProps {
  apiUrl: string;
  authenticatedSession?: Pick<LoginResponse, 'accessToken' | 'user'>;
  onSignOut?: () => void;
  initialSiteId?: string;
  initialAlertId?: string;
  initialIncidentId?: string;
  initialChecklistId?: string;
  initialActionId?: string;
  initialStatus?: 'ALL' | SafetyAlertStatus;
  initialType?: 'ALL' | SafetyAlertType;
  sharedSession?: SharedSession | null;
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

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return tr('safety.alerts.loginFailed401', { ns: SAFETY_NAMESPACE });
    if (error.code === 'network') return tr('safety_alerts_view.could_not_connect_to_the_backend');
    return tr('access_control_view.the_request_could_not_be_completed');
  }
  return tr('access_control_view.the_request_could_not_be_completed');
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
    return tr('access_control_view.the_request_could_not_be_completed');
  }
  return tr('access_control_view.the_request_could_not_be_completed');
}

function isUnauthorizedError(error: unknown): boolean {
  if (error instanceof ApiError && error.status === 401) return true;
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    (error as { status: unknown }).status === 401
  ) {
    return true;
  }
  return false;
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
            {formatCandidateSubtype(alert.candidateSubtype)}
          </p>
          {alert.candidateSubtype === 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE' && (
            <p className="mt-1 text-[11px] text-[#1F6C9F] italic leading-tight">
              {tr('safety.alerts.zoneAuthUnavailableInline', { ns: SAFETY_NAMESPACE })}
            </p>
          )}
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

type WorkspaceTab = 'Overview' | 'Alerts' | 'Incidents' | 'Checklists' | 'Safety Tasks';
function initialWorkspaceTab(
  session: {
    user: Pick<AccountResponse, 'roleAssignments'>;
  },
  mainWorkspace = false,
): WorkspaceTab {
  const roles = session.user.roleAssignments;
  return roles.some(({ role }) => role === 'SAFETY_OFFICER' || role === 'ADMIN')
    ? mainWorkspace
      ? 'Overview'
      : 'Alerts'
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
  initialChecklistId,
  initialActionId,
  initialStatus,
  initialType,
  sharedSession,
}: SafetyAlertsViewProps) {
  useTranslation();
  const { t } = useLocale();

  const client = useManagementClient(apiUrl);
  const queryClient = useQueryClient();
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(
    initialIncidentId
      ? 'Incidents'
      : initialChecklistId
        ? 'Checklists'
        : initialAlertId || initialType || initialStatus
          ? 'Alerts'
          : sharedSession !== undefined
            ? sharedSession
              ? initialWorkspaceTab({ user: sharedSession.user })
              : 'Alerts'
            : authenticatedSession
              ? initialWorkspaceTab(authenticatedSession, true)
              : 'Alerts',
  );
  const [relatedAlertFilter, setRelatedAlertFilter] = useState<RelatedAlertFilter>();
  const [relatedChecklistFilter, setRelatedChecklistFilter] =
    useState<import('../safety/safety-context').RelatedChecklistFilter>();
  const [requestedChecklistId, setRequestedChecklistId] = useState(initialChecklistId ?? '');
  const [createdIncidentId, setCreatedIncidentId] = useState('');
  const [checklistDraft, setChecklistDraft] = useState<{ teamId: string; day: string }>();
  const [incidentReturn, setIncidentReturn] = useState<'Overview' | 'Checklists'>();
  const [previousChecklistLink, setPreviousChecklistLink] = useState(initialChecklistId);
  if (previousChecklistLink !== initialChecklistId) {
    setPreviousChecklistLink(initialChecklistId);
    if (initialChecklistId) {
      setRelatedChecklistFilter(undefined);
      setChecklistDraft(undefined);
      setRequestedChecklistId(initialChecklistId);
      setWorkspaceTab('Checklists');
    }
  }
  const incidentLink = (initialIncidentId ?? '') + ':' + (initialActionId ?? '');
  const [previousIncidentLink, setPreviousIncidentLink] = useState(incidentLink);
  if (previousIncidentLink !== incidentLink) {
    setPreviousIncidentLink(incidentLink);
    if (initialIncidentId) {
      setCreatedIncidentId('');
      setRelatedAlertFilter(undefined);
      setRelatedChecklistFilter(undefined);
      setIncidentReturn(undefined);
      setWorkspaceTab('Incidents');
    }
  }
  const [incidentSourceAlert, setIncidentSourceAlert] = useState('');
  const [mobileAlertDetail, setMobileAlertDetail] = useState(false);
  const [localSession, setSession] = useState<LoginResponse | null>(null);
  const session = authenticatedSession ?? localSession;

  const [sessionScope, setSessionScope] = useState<string>(() => crypto.randomUUID());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [requestedSiteId, setRequestedSiteId] = useState(initialSiteId ?? '');
  const [requestedAlertId, setRequestedAlertId] = useState(initialAlertId ?? '');
  const [retainedReviewContext, setRetainedReviewContext] = useState<{
    scope: string;
    siteId: string;
    alertId: string;
  } | null>(null);
  const [status, setStatus] = useState<'ALL' | SafetyAlertStatus>(initialStatus ?? 'ALL');
  const [type, setType] = useState<'ALL' | SafetyAlertType>(initialType ?? 'ALL');
  const [offset, setOffset] = useState(0);
  const [reviewDraft, setReviewDraft] = useState<{
    scope: string;
    siteId: string;
    alertId: string;
    reason: string;
  } | null>(null);
  const reviewCommand = useRef<{ signature: string; commandId: string } | null>(null);
  const clearReviewDraft = useCallback(() => {
    setReviewDraft(null);
    reviewCommand.current = null;
  }, []);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(null);
  const [controlled401Scope, setControlled401Scope] = useState<string | null>(null);
  const [child401Scope, setChild401Scope] = useState<string | null>(null);
  const activeSession = useRef<{ token: string; userId: string; sessionScope: string } | null>(
    null,
  );
  const lifecycleGeneration = useRef(0);
  const lastSignedOutIdentityRef = useRef<string | null>(null);
  const lastLoggedOutStandaloneScopeRef = useRef<string | null>(null);

  const hasSharedSession = sharedSession !== undefined;
  const isControlled = hasSharedSession || authenticatedSession !== undefined;
  const isShared =
    isControlled && (hasSharedSession ? sharedSession !== null : Boolean(authenticatedSession));
  const parentSignOut = hasSharedSession ? (sharedSession?.onSignOut ?? onSignOut) : onSignOut;
  const incomingToken = hasSharedSession
    ? (sharedSession?.accessToken ?? '')
    : (session?.accessToken ?? '');
  const incomingScope = hasSharedSession ? (sharedSession?.sessionScope ?? '') : sessionScope;
  const incomingUser = hasSharedSession ? (sharedSession?.user ?? null) : (session?.user ?? null);
  const incomingUserId = incomingUser?.id ?? '';

  const effectiveToken = incomingToken;
  const effectiveUser = incomingUser;
  const roleSignature = (user: Pick<AccountResponse, 'roleAssignments'> | null | undefined) =>
    JSON.stringify(
      (user?.roleAssignments ?? [])
        .map(({ role, siteId }) => [role, siteId])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
  const incomingRoles = roleSignature(effectiveUser);
  // The shared projection never manufactures full Account fields for MF08.
  const fullSession = hasSharedSession ? authenticatedSession : session;
  const isKnownFullAccountRejected = Boolean(
    fullSession &&
    effectiveUser &&
    fullSession.accessToken === effectiveToken &&
    fullSession.user.id === effectiveUser.id &&
    (!fullSession.user.isActive || fullSession.user.mustChangePassword),
  );
  const workflowUser =
    fullSession &&
    effectiveUser &&
    effectiveToken &&
    incomingScope &&
    fullSession.accessToken === effectiveToken &&
    fullSession.user.id === effectiveUser.id &&
    fullSession.user.isActive &&
    !fullSession.user.mustChangePassword &&
    roleSignature(fullSession.user) === incomingRoles
      ? fullSession.user
      : null;
  const canAccessSafetyWorkspace =
    !isKnownFullAccountRejected &&
    (effectiveUser?.roleAssignments.some(
      ({ role, siteId }) =>
        (role === 'ADMIN' && siteId === null) ||
        (['SAFETY_OFFICER', 'SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE'].includes(role) &&
          siteId !== null),
    ) ??
      false);

  const canReviewSafetyAlerts = useMemo(() => {
    if (!effectiveUser || isKnownFullAccountRejected) return false;
    return effectiveUser.roleAssignments.some(
      ({ role, siteId }) =>
        (role === 'ADMIN' && siteId === null) || (role === 'SAFETY_OFFICER' && siteId !== null),
    );
  }, [effectiveUser, isKnownFullAccountRejected]);

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
    setIncidentReturn(undefined);
    setRelatedAlertFilter(undefined);
    setChecklistDraft(undefined);
    setRelatedChecklistFilter(undefined);
    setRequestedChecklistId(initialChecklistId ?? '');
    setCreatedIncidentId('');
    setRequestedSiteId(initialSiteId ?? '');
    setRequestedAlertId('');
    setMobileAlertDetail(false);
    setIncidentSourceAlert('');
    setRetainedReviewContext(null);
  }

  const [prevInitialAlertId, setPrevInitialAlertId] = useState(initialAlertId);
  if (prevInitialAlertId !== initialAlertId) {
    setPrevInitialAlertId(initialAlertId);
    setRequestedAlertId(initialAlertId ?? '');
    setRetainedReviewContext(null);
  }

  const removeSessionQueries = useCallback(
    (scope: string) => {
      if (!scope) return;
      for (const prefix of ['sites', 'safety-alerts', 'safety-alert', 'safety-workflow']) {
        void queryClient.cancelQueries({ queryKey: [prefix, apiUrl, scope] });
        queryClient.removeQueries({ queryKey: [prefix, apiUrl, scope] });
      }
      for (const mutation of queryClient.getMutationCache().getAll()) {
        if (mutation.options.meta?.safetySession === scope)
          queryClient.getMutationCache().remove(mutation);
      }
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

  const [credentialGen, setCredentialGen] = useState(() => ({
    scope: incomingScope,
    token: incomingToken,
    userId: incomingUserId,
    roles: incomingRoles,
    accountRejected: isKnownFullAccountRejected,
    generation: 0,
    effectiveScope: incomingScope,
  }));

  const isCredentialChanged =
    credentialGen.scope !== incomingScope ||
    credentialGen.token !== incomingToken ||
    credentialGen.userId !== incomingUserId ||
    credentialGen.roles !== incomingRoles ||
    credentialGen.accountRejected !== isKnownFullAccountRejected;

  const activeGeneration = isCredentialChanged
    ? credentialGen.scope !== incomingScope
      ? 0
      : credentialGen.generation + 1
    : credentialGen.generation;

  const activeEffectiveScope = isCredentialChanged
    ? activeGeneration === 0
      ? incomingScope
      : `${incomingScope}:gen-${activeGeneration}`
    : credentialGen.effectiveScope;

  if (isCredentialChanged) {
    setCredentialGen({
      scope: incomingScope,
      token: incomingToken,
      userId: incomingUserId,
      roles: incomingRoles,
      accountRejected: isKnownFullAccountRejected,
      generation: activeGeneration,
      effectiveScope: activeEffectiveScope,
    });
    if (controlled401Scope !== null) {
      setControlled401Scope(null);
    }
    if (child401Scope !== null) {
      setChild401Scope(null);
    }
    setRequestedSiteId(initialSiteId ?? '');
    setRequestedAlertId(initialAlertId ?? '');
    setRetainedReviewContext(null);
    setOffset(0);
    setReviewDraft(null);
    setIncidentSourceAlert('');
    if (incomingUser)
      setWorkspaceTab(
        initialIncidentId
          ? 'Incidents'
          : initialChecklistId
            ? 'Checklists'
            : initialAlertId || initialType || initialStatus
              ? 'Alerts'
              : initialWorkspaceTab({ user: incomingUser }, !hasSharedSession),
      );
  }

  const effectiveScopeRef = useRef(activeEffectiveScope);
  useEffect(() => {
    effectiveScopeRef.current = activeEffectiveScope;
  }, [activeEffectiveScope]);

  const handleChildUnauthorized = useCallback((capturedScope: string) => {
    if (capturedScope && capturedScope === effectiveScopeRef.current) {
      setChild401Scope(capturedScope);
    }
  }, []);

  const login = useMutation({
    mutationFn: async () => {
      const generation = lifecycleGeneration.current;
      const result = await client.login(username, password);
      const allowed = result.user.roleAssignments.some(
        ({ role, siteId }) =>
          (role === 'ADMIN' && siteId === null) ||
          (['SAFETY_OFFICER', 'CONTRACTOR_REPRESENTATIVE', 'SITE_MANAGER'].includes(role) &&
            siteId !== null),
      );
      if (!allowed) {
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
      setWorkspaceTab(
        initialAlertId || initialType || initialStatus
          ? 'Alerts'
          : initialWorkspaceTab(result, true),
      );
      setSession(result);
      setSessionScope(freshScope);
      setIncidentSourceAlert('');
      setPassword('');
      setSessionExpiredMessage(null);
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

    return () => {
      lifecycleGeneration.current += 1;
      const current = activeSession.current;
      activeSession.current = null;
      if (isControlled) {
        if (effectiveScopeRef.current) {
          removeSessionQueries(effectiveScopeRef.current);
        }
      } else {
        if (current) {
          removeSessionQueries(current.sessionScope);
          void client.logout().catch(() => undefined);
        }
      }
    };
  }, [client, isControlled, removeSessionQueries]);

  const isControlled401Rejected = isControlled && controlled401Scope === activeEffectiveScope;

  const sites = useQuery({
    queryKey: ['sites', apiUrl, activeEffectiveScope],
    queryFn: ({ signal }) => client.listSites(effectiveToken, { limit: 100 }, { signal }),
    enabled:
      !isControlled401Rejected &&
      canAccessSafetyWorkspace &&
      effectiveToken.length > 0 &&
      activeEffectiveScope.length > 0,
  });

  const isGlobalAdmin =
    effectiveUser?.roleAssignments.some(
      ({ role, siteId }) => role === 'ADMIN' && siteId === null,
    ) ?? false;
  const safetyOfficerSiteIds = useMemo(
    () =>
      new Set(
        effectiveUser?.roleAssignments.flatMap(({ role, siteId }) =>
          role === 'SAFETY_OFFICER' && siteId !== null ? [siteId] : [],
        ) ?? [],
      ),
    [effectiveUser],
  );
  const workflowSiteIds = useMemo(
    () =>
      new Set(
        effectiveUser?.roleAssignments.flatMap(({ role, siteId }) =>
          ['SAFETY_OFFICER', 'SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE'].includes(role) &&
          siteId !== null
            ? [siteId]
            : [],
        ) ?? [],
      ),
    [effectiveUser],
  );
  const selectedTabSiteIds = workspaceTab === 'Alerts' ? safetyOfficerSiteIds : workflowSiteIds;
  const visibleSites = useMemo(
    () =>
      sites.error
        ? []
        : (sites.data?.items.filter((site) => isGlobalAdmin || selectedTabSiteIds.has(site.id)) ??
          []),
    [isGlobalAdmin, selectedTabSiteIds, sites.data?.items, sites.error],
  );

  const selectedSiteId = sites.error
    ? ''
    : visibleSites.some((site) => site.id === requestedSiteId)
      ? requestedSiteId
      : (visibleSites[0]?.id ?? '');

  const canAlerts =
    isGlobalAdmin ||
    effectiveUser?.roleAssignments.some(
      (r) => r.role === 'SAFETY_OFFICER' && r.siteId === selectedSiteId,
    );
  const canTasks =
    isGlobalAdmin ||
    effectiveUser?.roleAssignments.some(
      (r) => ['SAFETY_OFFICER', 'SITE_MANAGER'].includes(r.role) && r.siteId === selectedSiteId,
    );
  const canIncidents =
    Boolean(workflowUser) && (isGlobalAdmin || workflowSiteIds.has(selectedSiteId));
  const alerts = useQuery({
    queryKey: [
      'safety-alerts',
      apiUrl,
      activeEffectiveScope,
      selectedSiteId,
      status,
      type,
      offset,
      relatedAlertFilter,
    ],
    queryFn: ({ signal }) =>
      client.listSafetyAlerts(
        effectiveToken,
        selectedSiteId,
        {
          offset,
          limit: alertPageSize,
          ...(status === 'ALL' ? {} : { status }),
          ...(type === 'ALL' ? {} : { type }),
          ...(relatedAlertFilter ?? {}),
        },
        { signal },
      ),
    enabled:
      !isControlled401Rejected &&
      canReviewSafetyAlerts &&
      effectiveToken.length > 0 &&
      activeEffectiveScope.length > 0 &&
      !sites.error &&
      selectedSiteId.length > 0 &&
      Boolean(canAlerts) &&
      workspaceTab === 'Alerts',
  });

  const canRetainReviewedAlert =
    retainedReviewContext?.scope === activeEffectiveScope &&
    retainedReviewContext.siteId === selectedSiteId &&
    retainedReviewContext.alertId === requestedAlertId;

  const canRetainDraftAlert =
    reviewDraft?.scope === activeEffectiveScope &&
    reviewDraft.siteId === selectedSiteId &&
    reviewDraft.alertId === requestedAlertId;

  const selectedAlertId =
    sites.error || alerts.error
      ? ''
      : alerts.data?.items.some((alert) => alert.id === requestedAlertId) ||
          canRetainReviewedAlert ||
          canRetainDraftAlert
        ? requestedAlertId
        : (alerts.data?.items[0]?.id ?? '');

  const reviewReason =
    reviewDraft?.scope === activeEffectiveScope &&
    reviewDraft.siteId === selectedSiteId &&
    reviewDraft.alertId === selectedAlertId
      ? reviewDraft.reason
      : '';

  function setReviewReason(reason: string) {
    if (!reason) {
      clearReviewDraft();
      return;
    }
    // Pin the implicitly selected alert as soon as its review is edited.
    // Queue refreshes must not move a draft to a newer or different alert.
    setRequestedAlertId(selectedAlertId);
    setReviewDraft({
      scope: activeEffectiveScope,
      siteId: selectedSiteId,
      alertId: selectedAlertId,
      reason,
    });
  }

  const reviewContextRef = useRef({
    scope: activeEffectiveScope,
    siteId: selectedSiteId,
    alertId: selectedAlertId,
  });
  useEffect(() => {
    reviewContextRef.current = {
      scope: activeEffectiveScope,
      siteId: selectedSiteId,
      alertId: selectedAlertId,
    };
  }, [activeEffectiveScope, selectedSiteId, selectedAlertId]);

  const detail = useQuery({
    queryKey: ['safety-alert', apiUrl, activeEffectiveScope, selectedSiteId, selectedAlertId],
    queryFn: ({ signal }) =>
      client.getSafetyAlert(effectiveToken, selectedSiteId, selectedAlertId, { signal }),
    enabled:
      !isControlled401Rejected &&
      canReviewSafetyAlerts &&
      effectiveToken.length > 0 &&
      activeEffectiveScope.length > 0 &&
      !sites.error &&
      !alerts.error &&
      selectedSiteId.length > 0 &&
      selectedAlertId.length > 0 &&
      Boolean(canAlerts) &&
      workspaceTab === 'Alerts',
  });

  const review = useMutation({
    meta: { safetySession: activeEffectiveScope },
    gcTime: 0,
    mutationFn: async ({
      targetStatus,
      targetScope,
      targetSiteId,
      targetAlertId,
      expectedRevision,
      targetReason,
    }: {
      targetStatus: SafetyAlertReviewTargetStatus;
      targetScope: string;
      targetSiteId: string;
      targetAlertId: string;
      expectedRevision: number;
      targetReason: string;
    }) => {
      const signature = JSON.stringify([
        apiUrl,
        targetScope,
        targetSiteId,
        targetAlertId,
        expectedRevision,
        targetStatus,
        targetReason.trim(),
      ]);
      if (reviewCommand.current?.signature !== signature) {
        reviewCommand.current = { signature, commandId: crypto.randomUUID() };
      }
      return client.reviewSafetyAlert(effectiveToken, targetSiteId, targetAlertId, {
        commandId: reviewCommand.current.commandId,
        expectedRevision,
        targetStatus,
        reason: targetReason,
      });
    },
    onSuccess: async (_data, variables) => {
      if (variables.targetScope !== effectiveScopeRef.current) return;
      const current = reviewContextRef.current;
      if (
        variables.targetScope === current.scope &&
        variables.targetSiteId === current.siteId &&
        variables.targetAlertId === current.alertId
      ) {
        setRetainedReviewContext({
          scope: variables.targetScope,
          siteId: variables.targetSiteId,
          alertId: variables.targetAlertId,
        });
        setRequestedAlertId(variables.targetAlertId);
        clearReviewDraft();
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['safety-alerts', apiUrl, variables.targetScope, variables.targetSiteId],
        }),
        queryClient.invalidateQueries({
          queryKey: [
            'safety-alert',
            apiUrl,
            variables.targetScope,
            variables.targetSiteId,
            variables.targetAlertId,
          ],
          exact: true,
        }),
      ]);
    },
    onError: async (error, variables) => {
      if (variables.targetScope !== effectiveScopeRef.current) return;
      if (error instanceof ApiError && error.status === 409) {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: ['safety-alerts', apiUrl, variables.targetScope, variables.targetSiteId],
          }),
          queryClient.invalidateQueries({
            queryKey: [
              'safety-alert',
              apiUrl,
              variables.targetScope,
              variables.targetSiteId,
              variables.targetAlertId,
            ],
            exact: true,
          }),
        ]);
      }
    },
  });

  const isCurrentReviewMutation =
    review.variables?.targetScope === activeEffectiveScope &&
    review.variables.targetSiteId === selectedSiteId &&
    review.variables.targetAlertId === selectedAlertId;
  const reviewPending = isCurrentReviewMutation && review.isPending;
  const reviewSuccess = isCurrentReviewMutation && review.isSuccess;
  const reviewError = isCurrentReviewMutation ? review.error : null;

  const resetReviewDraft = () => {
    review.reset();
    clearReviewDraft();
  };

  const prevScopeRef = useRef(activeEffectiveScope);
  useEffect(() => {
    if (prevScopeRef.current && prevScopeRef.current !== activeEffectiveScope) {
      removeSessionQueries(prevScopeRef.current);
      setRequestedSiteId(initialSiteId ?? '');
      setRequestedAlertId(initialAlertId ?? '');
      setRetainedReviewContext(null);
      setOffset(0);
      clearReviewDraft();
      review.reset();
    }
    prevScopeRef.current = activeEffectiveScope;
  }, [
    activeEffectiveScope,
    removeSessionQueries,
    initialSiteId,
    initialAlertId,
    review,
    clearReviewDraft,
  ]);

  const auth401Error = useMemo(() => {
    if (isUnauthorizedError(sites.error)) return sites.error;
    if (isUnauthorizedError(alerts.error)) return alerts.error;
    if (isUnauthorizedError(detail.error)) return detail.error;
    if (
      review.variables?.targetScope === activeEffectiveScope &&
      isUnauthorizedError(review.error)
    ) {
      return review.error;
    }
    if (child401Scope === activeEffectiveScope) {
      return new ApiError('http', 'Child component session expired', 401);
    }
    return null;
  }, [
    sites.error,
    alerts.error,
    detail.error,
    review.error,
    review.variables,
    activeEffectiveScope,
    child401Scope,
  ]);

  if (isControlled && isShared && auth401Error && controlled401Scope !== activeEffectiveScope) {
    setControlled401Scope(activeEffectiveScope);
  }

  if (
    !isControlled &&
    session &&
    auth401Error &&
    sessionExpiredMessage !== 'Your session is no longer valid. Sign in again.'
  ) {
    setSessionExpiredMessage('Your session is no longer valid. Sign in again.');
  }

  const handleLogout = useCallback(() => {
    setIncidentReturn(undefined);
    setRelatedAlertFilter(undefined);
    setRelatedChecklistFilter(undefined);
    setChecklistDraft(undefined);
    if (isControlled) {
      setControlled401Scope(activeEffectiveScope);
      if (activeEffectiveScope) removeSessionQueries(activeEffectiveScope);
      parentSignOut?.();
      return;
    }
    const current = activeSession.current;
    activeSession.current = null;
    if (current) removeSessionQueries(current.sessionScope);
    if (activeEffectiveScope) removeSessionQueries(activeEffectiveScope);
    login.reset();
    setSession(null);
    setSessionScope('');
    setIncidentSourceAlert('');
    setRequestedSiteId('');
    setRequestedAlertId('');
    setRetainedReviewContext(null);
    setOffset(0);
    clearReviewDraft();
    if (current) void client.logout().catch(() => undefined);
  }, [
    isControlled,
    activeEffectiveScope,
    removeSessionQueries,
    parentSignOut,
    login,
    client,
    clearReviewDraft,
  ]);

  useEffect(() => {
    if (!auth401Error) return;
    if (isControlled) {
      if (activeEffectiveScope) {
        removeSessionQueries(activeEffectiveScope);
      }
      if (
        parentSignOut &&
        activeEffectiveScope &&
        lastSignedOutIdentityRef.current !== activeEffectiveScope
      ) {
        lastSignedOutIdentityRef.current = activeEffectiveScope;
        parentSignOut();
      }
    } else {
      if (
        activeEffectiveScope &&
        lastLoggedOutStandaloneScopeRef.current !== activeEffectiveScope
      ) {
        lastLoggedOutStandaloneScopeRef.current = activeEffectiveScope;
        handleLogout();
      }
    }
  }, [
    auth401Error,
    isControlled,
    activeEffectiveScope,
    removeSessionQueries,
    parentSignOut,
    handleLogout,
  ]);

  const handleLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSessionExpiredMessage(null);
    login.mutate();
  };

  if (isShared && !canAccessSafetyWorkspace && !isKnownFullAccountRejected) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-[#EAEAEA] bg-white p-7">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F66B17]">MF04 / MF05</p>
        <h1 className="mt-2 text-2xl font-bold text-[#2F3437]">
          {t('safety.alerts.accessRestricted.title')}
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#6B6B6B]">
          {t('safety.alerts.accessRestricted.description')}
        </p>
      </div>
    );
  }

  if ((isControlled && !isShared) || isControlled401Rejected || isKnownFullAccountRejected) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-[#EAEAEA] bg-white p-7">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F66B17]">MF04 / MF05</p>
        <h1 className="mt-2 text-2xl font-bold text-[#2F3437]">
          {isKnownFullAccountRejected
            ? t('safety.alerts.accessRestricted.title')
            : t('ppe.sessionExpired.title')}
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#6B6B6B]">
          {isKnownFullAccountRejected
            ? fullSession?.user.mustChangePassword
              ? tr('safety_alerts_view.change_the_temporary_password_before_opening_safety_alerts')
              : t('ppe.error.metadata403')
            : t('safety.alerts.sessionExpired.description')}
        </p>
      </div>
    );
  }

  // Hide protected content in the same render that rejects the session;
  // the logout effect clears credentials and cached queries afterward.
  if (!isControlled && (!session || auth401Error)) {
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
              onChange={(event) => {
                setUsername(event.target.value);
                setSessionExpiredMessage(null);
              }}
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
              onChange={(event) => {
                setPassword(event.target.value);
                setSessionExpiredMessage(null);
              }}
              className="mt-1.5 w-full rounded-md border border-[#EAEAEA] px-3 py-2.5 font-normal outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
            />
          </label>
          {sessionExpiredMessage && !login.error && (
            <p role="alert" className="rounded-md bg-[#FDEBEC] px-3 py-2 text-sm text-[#9F2F2D]">
              {tr('safety_alert_evidence_utils.your_session_is_no_longer_valid_sign_in_again')}
            </p>
          )}
          {login.error && (
            <p role="alert" className="rounded-md bg-[#FDEBEC] px-3 py-2 text-sm text-[#9F2F2D]">
              {loginErrorMessage(login.error)}
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
    <div className="mx-auto max-w-[1202px] w-full min-w-0 space-y-3 pb-10 text-[#2F3437]">
      <header className="flex flex-wrap items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#111111]">
            {tr('common.safety_operations')}
          </h1>
        </div>
        <div className="flex min-w-0 flex-wrap items-end gap-3 lg:max-w-[55%]">
          <label className="min-w-0 w-full sm:w-72 text-xs font-bold uppercase tracking-wider text-[#6B6B6B]">
            {tr('common.site_fa7955')}
            <select
              value={selectedSiteId}
              onChange={(event) => {
                setRelatedAlertFilter(undefined);
                setRelatedChecklistFilter(undefined);
                setIncidentReturn(undefined);
                setChecklistDraft(undefined);
                setRequestedChecklistId('');
                setCreatedIncidentId('');
                setRequestedSiteId(event.target.value);
                setMobileAlertDetail(false);
                setIncidentSourceAlert('');
                setRequestedAlertId('');
                setRetainedReviewContext(null);
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
            {tr('common.sign_out_value', { value1: effectiveUser?.displayName ?? '' })}
          </button>
        </div>
      </header>

      <nav
        className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-2"
        aria-label={tr('common.safety_workspace')}
      >
        {(['Overview', 'Alerts', 'Incidents', 'Checklists', 'Safety Tasks'] as const).map((tab) => (
          <button
            type="button"
            key={'workspace-' + tab}
            aria-pressed={workspaceTab === tab}
            disabled={
              (tab === 'Alerts' && !canReviewSafetyAlerts) ||
              (tab === 'Incidents' && !canIncidents) ||
              (tab === 'Checklists' && (!canIncidents || !workflowUser)) ||
              ((tab === 'Safety Tasks' || tab === 'Overview') && (!canTasks || !workflowUser))
            }
            onClick={() => setWorkspaceTab(tab)}
            className={
              'min-h-11 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ' +
              (workspaceTab === tab
                ? 'bg-[#111] text-white'
                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-bone)]')
            }
          >
            {tab === 'Overview' || tab === 'Checklists'
              ? localizedLabel(tab)
              : tr(
                  tab === 'Alerts'
                    ? 'common.alerts'
                    : tab === 'Incidents'
                      ? 'common.incidents'
                      : 'common.safety_tasks',
                )}
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
        <div className="rounded-lg bg-[#FDEBEC] p-5 text-sm text-[#9F2F2D] flex flex-wrap items-center justify-between gap-3">
          <p role="alert">{errorMessage(sites.error)}</p>
          <button
            type="button"
            onClick={() => void sites.refetch()}
            className="rounded-md border border-[#9F2F2D]/30 bg-white px-3 py-1.5 text-xs font-bold text-[#9F2F2D] hover:bg-[#FDEBEC] cursor-pointer"
          >
            {t('safety.alerts.retrySites')}
          </button>
        </div>
      )}
      {!sites.error &&
        !sites.isPending &&
        sites.data &&
        visibleSites.length === 0 &&
        (workspaceTab === 'Alerts' || workflowUser) && (
          <p className="rounded-lg bg-white p-5 text-sm text-[#6B6B6B]">
            {tr(
              'safety_alerts_view.no_site_with_safety_workflow_access_is_assigned_to_this_account',
            )}
          </p>
        )}

      {workspaceTab !== 'Alerts' && !workflowUser && (
        <p role="status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
          {tr('app.safety_full_account_required')}
        </p>
      )}
      {selectedSiteId && canTasks && workflowUser && (
        <section hidden={workspaceTab !== 'Overview'}>
          <SafetyOverviewView
            key={'overview' + activeEffectiveScope + selectedSiteId}
            client={client}
            apiUrl={apiUrl}
            scope={activeEffectiveScope}
            token={effectiveToken}
            siteId={selectedSiteId}
            user={workflowUser}
            active={workspaceTab === 'Overview'}
            canAlerts={!!canReviewSafetyAlerts}
            canAssign={workflowUser.roleAssignments.some(
              (r) => r.role === 'SAFETY_OFFICER' && r.siteId === selectedSiteId,
            )}
            onAlerts={(filter) => {
              setRelatedAlertFilter(filter);
              setStatus('ALL');
              setType('ALL');
              setRequestedAlertId('');
              setOffset(0);
              setWorkspaceTab('Alerts');
            }}
            onViewChecklists={(teamId, day, name) => {
              setRelatedChecklistFilter({
                teamId,
                fromDate: day,
                toDate: day,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                caption: name + ' · ' + day,
              });
              setRequestedChecklistId('');
              setWorkspaceTab('Checklists');
            }}
            onChecklist={(teamId, day) => {
              setChecklistDraft({ teamId, day });
              setWorkspaceTab('Checklists');
            }}
          />
        </section>
      )}
      {selectedSiteId && canIncidents && workflowUser && (
        <section hidden={workspaceTab !== 'Checklists'}>
          <SafetyChecklistsView
            key={JSON.stringify([
              activeEffectiveScope,
              selectedSiteId,
              requestedChecklistId,
              relatedChecklistFilter?.teamId,
              relatedChecklistFilter?.fromDate,
              relatedChecklistFilter?.toDate,
              relatedChecklistFilter?.timezone,
            ])}
            client={client}
            apiUrl={apiUrl}
            scope={activeEffectiveScope}
            token={effectiveToken}
            siteId={selectedSiteId}
            user={workflowUser}
            active={workspaceTab === 'Checklists'}
            context={relatedChecklistFilter}
            onClearContext={() => setRelatedChecklistFilter(undefined)}
            onBackToOverview={() => setWorkspaceTab('Overview')}
            initialChecklistId={requestedChecklistId}
            draft={checklistDraft}
            onDraftConsumed={() => setChecklistDraft(undefined)}
            onIncident={(id) => {
              setIncidentReturn('Checklists');
              setCreatedIncidentId(id);
              setIncidentSourceAlert('');
              setWorkspaceTab('Incidents');
            }}
          />
        </section>
      )}
      {workspaceTab === 'Alerts' && relatedAlertFilter && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--surface-bone)] p-3">
          <p className="text-sm">
            {tr('safety_workspace.related_alerts_value1', { value1: relatedAlertFilter.caption })}
          </p>
          <div className="flex gap-2">
            <button
              className="text-sm font-semibold underline"
              onClick={() => setWorkspaceTab('Overview')}
            >
              {tr('safety_workspace.back_to_overview')}
            </button>
            <button
              className="text-sm font-semibold underline"
              onClick={() => {
                setRelatedAlertFilter(undefined);
                setOffset(0);
              }}
            >
              {tr('safety_workspace.clear_context_filter')}
            </button>
          </div>
        </div>
      )}

      {selectedSiteId && workspaceTab === 'Incidents' && canIncidents && workflowUser && (
        <IncidentView
          onBack={incidentReturn ? () => setWorkspaceTab(incidentReturn) : undefined}
          backLabel={
            incidentReturn === 'Overview'
              ? tr('safety_workspace.back_to_overview')
              : tr('safety_workspace.back_to_checklists')
          }
          onOpenChecklist={(id) => {
            setRelatedChecklistFilter(undefined);
            setChecklistDraft(undefined);
            setRequestedChecklistId(id);
            setWorkspaceTab('Checklists');
          }}
          initialIncidentId={createdIncidentId || initialIncidentId}
          initialActionId={initialActionId}
          key={activeEffectiveScope + selectedSiteId}
          client={client}
          apiUrl={apiUrl}
          scope={activeEffectiveScope}
          token={effectiveToken}
          siteId={selectedSiteId}
          user={workflowUser}
          initialAlertId={incidentSourceAlert}
          onSourceConsumed={() => setIncidentSourceAlert('')}
        />
      )}
      {selectedSiteId && workspaceTab === 'Safety Tasks' && canTasks && workflowUser && (
        <SafetyTasksView
          key={activeEffectiveScope + selectedSiteId}
          client={client}
          apiUrl={apiUrl}
          scope={activeEffectiveScope}
          token={effectiveToken}
          siteId={selectedSiteId}
          user={workflowUser}
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
                {!alerts.error && alerts.data && (
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
            {!alerts.error && !alerts.isPending && alerts.data?.items.length === 0 && (
              <p className="rounded-lg border border-dashed border-[#EAEAEA] bg-white p-8 text-center text-sm text-[#6B6B6B]">
                {tr('safety_alerts_view.no_alerts_match_the_selected_site_and_filters')}
              </p>
            )}
            {!alerts.error &&
              alerts.data?.items.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  selected={selectedAlertId === alert.id}
                  onSelect={() => {
                    if (alert.id !== selectedAlertId) {
                      resetReviewDraft();
                      setRetainedReviewContext(null);
                    }
                    setRequestedAlertId(alert.id);
                  }}
                />
              ))}
            {!alerts.error && alerts.data && alerts.data.total > alertPageSize && (
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={offset === 0 || alerts.isFetching}
                  onClick={() => {
                    resetReviewDraft();
                    setRequestedAlertId('');
                    setRetainedReviewContext(null);
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
                    setRetainedReviewContext(null);
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
              {selectedAlertId && !alerts.error && !detail.error && (
                <button
                  type="button"
                  onClick={() => void detail.refetch()}
                  className="text-xs font-semibold text-[#F66B17] hover:text-[#D94E07] cursor-pointer"
                >
                  {tr('common.refresh_detail')}
                </button>
              )}
            </div>
            {!alerts.error && !detail.error && !selectedAlertId && (
              <p className="mt-4 text-sm text-[#6B6B6B]">
                {tr('safety_alerts_view.select_an_alert_to_inspect_its_sources')}
              </p>
            )}
            {!alerts.error && detail.isPending && selectedAlertId && (
              <p className="mt-4 text-sm text-[#6B6B6B]">{tr('common.loading_alert_detail')}</p>
            )}
            {!alerts.error && detail.error && (
              <div className="mt-4 rounded-md bg-[#FDEBEC] p-3 text-sm text-[#9F2F2D] flex flex-wrap items-center justify-between gap-2">
                <p role="alert">{errorMessage(detail.error)}</p>
                <button
                  type="button"
                  onClick={() => void detail.refetch()}
                  className="rounded border border-[#9F2F2D]/30 bg-white px-2.5 py-1 text-xs font-bold text-[#9F2F2D] hover:bg-[#FDEBEC] cursor-pointer"
                >
                  {t('safety.alerts.retryDetail')}
                </button>
              </div>
            )}
            {!sites.error && !alerts.error && !detail.error && detail.data && (
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
                <div role="status" aria-atomic="true">
                  {reviewPending && (
                    <p className="rounded-md bg-[#F7F6F3] p-2 text-xs text-[#6B6B6B]">
                      {t('safety.alerts.recordingReviewDecision')}
                    </p>
                  )}
                  {reviewSuccess && (
                    <p className="rounded-md bg-[#EDF3EC] p-2 text-xs text-[#346538]">
                      {tr('common.review_decision_recorded')}
                    </p>
                  )}
                </div>
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
                        {workflowUser && (
                          <AlertWorkContext
                            client={client}
                            apiUrl={apiUrl}
                            scope={activeEffectiveScope}
                            token={effectiveToken}
                            siteId={selectedSiteId}
                            user={workflowUser}
                            alertId={detail.data.id}
                            revision={detail.data.revision}
                          />
                        )}
                        <SafetyAlertEvidencePanel
                          client={client}
                          apiUrl={apiUrl}
                          sessionScope={activeEffectiveScope}
                          token={effectiveToken}
                          siteId={selectedSiteId}
                          alertId={detail.data.id}
                          detection={detection}
                          canReviewIdentity={safetyOfficerSiteIds.has(selectedSiteId)}
                          onUnauthorized={() => handleChildUnauthorized(activeEffectiveScope)}
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
                    {detail.data.candidateSubtype === 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE' && (
                      <div
                        role="status"
                        data-testid="zone-entry-auth-unavailable-guidance"
                        className="mt-3 rounded-md border border-[#1F6C9F]/20 bg-[#E1F3FE] p-2.5 text-xs text-[#1F6C9F] leading-relaxed"
                      >
                        <p className="font-semibold">
                          {t('safety.alerts.zoneAuthUnavailableTitle')}
                        </p>
                        <p className="mt-0.5">{t('safety.alerts.zoneAuthUnavailableBody')}</p>
                      </div>
                    )}
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
                    {(() => {
                      return (
                        <>
                          {reviewError && (
                            <p
                              role="alert"
                              className="mt-2 rounded-md bg-[#FDEBEC] p-2 text-xs text-[#9F2F2D]"
                            >
                              {errorMessage(reviewError)}
                            </p>
                          )}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={reviewReason.trim().length < 5 || reviewPending}
                              onClick={() => {
                                if (!detail.data) return;
                                review.mutate({
                                  targetStatus: 'CONFIRMED',
                                  targetScope: activeEffectiveScope,
                                  targetSiteId: selectedSiteId,
                                  targetAlertId: detail.data.id,
                                  expectedRevision: detail.data.revision,
                                  targetReason: reviewReason,
                                });
                              }}
                              className="rounded-md bg-[#9F2F2D] px-3 py-2 text-xs font-bold text-white hover:bg-[#7F2524] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9F2F2D] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {tr('common.confirm_violation')}
                            </button>
                            <button
                              type="button"
                              disabled={reviewReason.trim().length < 5 || reviewPending}
                              onClick={() => {
                                if (!detail.data) return;
                                review.mutate({
                                  targetStatus: 'DISMISSED',
                                  targetScope: activeEffectiveScope,
                                  targetSiteId: selectedSiteId,
                                  targetAlertId: detail.data.id,
                                  expectedRevision: detail.data.revision,
                                  targetReason: reviewReason,
                                });
                              }}
                              className="rounded-md bg-[#111111] px-3 py-2 text-xs font-bold text-white hover:bg-[#333333] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111111] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {tr('common.dismiss_alert')}
                            </button>
                            {detail.data.status === 'PENDING_REVIEW' && (
                              <button
                                type="button"
                                disabled={reviewReason.trim().length < 5 || reviewPending}
                                onClick={() => {
                                  if (!detail.data) return;
                                  review.mutate({
                                    targetStatus: 'NEEDS_MORE_EVIDENCE',
                                    targetScope: activeEffectiveScope,
                                    targetSiteId: selectedSiteId,
                                    targetAlertId: detail.data.id,
                                    expectedRevision: detail.data.revision,
                                    targetReason: reviewReason,
                                  });
                                }}
                                className="rounded-md border border-[#1F6C9F]/30 bg-white px-3 py-2 text-xs font-bold text-[#1F6C9F] hover:bg-[#E1F3FE] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F6C9F] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {tr('common.request_more_evidence')}
                              </button>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </section>
                )}
                {detail.data.status === 'CONFIRMED' &&
                  !detail.data.incidentId &&
                  workflowUser?.roleAssignments.some(
                    (r) => r.role === 'SAFETY_OFFICER' && r.siteId === selectedSiteId,
                  ) && (
                    <button
                      type="button"
                      className="min-h-10 rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--action-primary-hover)]"
                      onClick={() => {
                        setIncidentReturn(relatedAlertFilter ? 'Overview' : undefined);
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
