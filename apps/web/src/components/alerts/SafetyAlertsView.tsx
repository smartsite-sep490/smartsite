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
  initialSiteId?: string;
  initialAlertId?: string;
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
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Your session is no longer valid. Sign in again.';
    if (error.status === 403) return 'This account cannot view the selected Site alerts.';
    if (error.status === 404) return 'The requested safety alert or site was not found.';
    if (error.status === 409)
      return 'This alert changed while you were reviewing it. The latest record has been loaded; review it before submitting again.';
    if (error.code === 'network') return 'Could not connect to the backend.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'The request could not be completed.';
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
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border p-4 text-left transition-colors ${
        selected
          ? 'border-[#F66B17] bg-[#FBF3DB]/30'
          : 'border-[#EAEAEA] bg-white hover:border-[#2F3437]/15 hover:bg-[#F7F6F3]'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[#6B6B6B]">
            {formatLabel(alert.alertType)}
          </p>
          <p className="mt-1 font-semibold text-[#2F3437]">{formatLabel(alert.candidateSubtype)}</p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusTone(alert.status)}`}
        >
          {formatLabel(alert.status)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#6B6B6B]">
        <span>{alert.detectionCount} detections</span>
        <span>Last seen {formatDate(alert.lastDetectedAt)}</span>
        <span>{alert.zoneId ? `Zone ${alert.zoneId.slice(0, 8)}` : 'No resolved Zone'}</span>
      </div>
    </button>
  );
}

export function SafetyAlertsView({
  apiUrl,
  initialSiteId,
  initialAlertId,
  initialStatus,
  initialType,
}: SafetyAlertsViewProps) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const queryClient = useQueryClient();
  const [session, setSession] = useState<LoginResponse | null>(null);
  const [sessionScope, setSessionScope] = useState('');
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
  }

  const [prevInitialAlertId, setPrevInitialAlertId] = useState(initialAlertId);
  if (prevInitialAlertId !== initialAlertId) {
    setPrevInitialAlertId(initialAlertId);
    setRequestedAlertId(initialAlertId ?? '');
  }

  const removeSessionQueries = useCallback(
    (scope: string) => {
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
          (role === 'ADMIN' && siteId === null) || (role === 'SAFETY_OFFICER' && siteId !== null),
      );
      if (!canReviewSafetyAlerts) {
        await client.logout().catch(() => undefined);
        throw new Error('A global Admin or Site-scoped Safety Officer role is required.');
      }
      if (result.user.mustChangePassword) {
        await client.logout().catch(() => undefined);
        throw new Error('Change the temporary password before opening safety alerts.');
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
      setSession(result);
      setSessionScope(freshScope);
      setPassword('');
      // Do not retain LoginResponse in TanStack mutation data because it contains the access token.
    },
  });

  useEffect(() => {
    lifecycleGeneration.current += 1;
    return () => {
      lifecycleGeneration.current += 1;
      const current = activeSession.current;
      activeSession.current = null;
      if (!current) return;
      removeSessionQueries(current.sessionScope);
      void client.logout().catch(() => undefined);
    };
  }, [client, removeSessionQueries]);

  const token = session?.accessToken ?? '';
  const sites = useQuery({
    queryKey: ['sites', apiUrl, sessionScope],
    queryFn: () => client.listSites(token, { limit: 100 }),
    enabled: token.length > 0,
  });

  const isGlobalAdmin =
    session?.user.roleAssignments.some(({ role, siteId }) => role === 'ADMIN' && siteId === null) ??
    false;
  const safetyOfficerSiteIds = useMemo(
    () =>
      new Set(
        session?.user.roleAssignments.flatMap(({ role, siteId }) =>
          role === 'SAFETY_OFFICER' && siteId !== null ? [siteId] : [],
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

  const alerts = useQuery({
    queryKey: ['safety-alerts', apiUrl, sessionScope, selectedSiteId, status, type, offset],
    queryFn: () =>
      client.listSafetyAlerts(token, selectedSiteId, {
        offset,
        limit: alertPageSize,
        ...(status === 'ALL' ? {} : { status }),
        ...(type === 'ALL' ? {} : { type }),
      }),
    enabled: token.length > 0 && selectedSiteId.length > 0,
  });

  const selectedAlertId = alerts.data?.items.some((alert) => alert.id === requestedAlertId)
    ? requestedAlertId
    : (alerts.data?.items[0]?.id ?? '');

  const detail = useQuery({
    queryKey: ['safety-alert', apiUrl, sessionScope, selectedSiteId, selectedAlertId],
    queryFn: () => client.getSafetyAlert(token, selectedSiteId, selectedAlertId),
    enabled: token.length > 0 && selectedSiteId.length > 0 && selectedAlertId.length > 0,
  });

  const review = useMutation({
    mutationFn: async (targetStatus: SafetyAlertReviewTargetStatus) => {
      if (!detail.data) throw new Error('Load an alert before submitting a review.');
      return client.reviewSafetyAlert(token, selectedSiteId, detail.data.id, {
        commandId: crypto.randomUUID(),
        expectedRevision: detail.data.revision,
        targetStatus,
        reason: reviewReason,
      });
    },
    onSuccess: async () => {
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
    const current = activeSession.current;
    activeSession.current = null;
    if (current) removeSessionQueries(current.sessionScope);
    login.reset();
    setSession(null);
    setSessionScope('');
    setRequestedSiteId('');
    setRequestedAlertId('');
    setOffset(0);
    setReviewReason('');
    if (current) void client.logout().catch(() => undefined);
  };

  if (!session) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-[#EAEAEA] bg-white p-7">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F66B17]">MF04 / MF05</p>
        <h1 className="mt-2 text-2xl font-bold text-[#2F3437]">Safety alert queue</h1>
        <p className="mt-2 text-sm leading-6 text-[#6B6B6B]">
          Sign in as a global Admin or Site-scoped Safety Officer to inspect AI evidence and record
          an auditable review decision.
        </p>
        <form className="mt-6 space-y-4" onSubmit={handleLogin}>
          <label className="block text-sm font-semibold text-[#2F3437]">
            Username
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1.5 w-full rounded-md border border-[#EAEAEA] px-3 py-2.5 font-normal outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
            />
          </label>
          <label className="block text-sm font-semibold text-[#2F3437]">
            Password
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
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1202px] space-y-6 pb-10 text-[#2F3437]">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F66B17]">MF04 / MF05</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#111111]">Safety alerts</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6B6B6B]">
            Review durable AI observations, request more evidence, confirm a safety violation, or
            dismiss a false alert. Every decision requires a reason and is kept in the audit trail.
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-md border border-[#EAEAEA] bg-white px-3 py-2 text-sm font-semibold text-[#2F3437] hover:bg-[#F7F6F3]"
        >
          Sign out {session.user.displayName}
        </button>
      </header>

      <section className="grid gap-4 rounded-lg border border-[#EAEAEA] bg-white p-4 md:grid-cols-3">
        <label className="text-xs font-bold uppercase tracking-wider text-[#6B6B6B]">
          Site
          <select
            value={selectedSiteId}
            onChange={(event) => {
              setRequestedSiteId(event.target.value);
              setRequestedAlertId('');
              setOffset(0);
              resetReviewDraft();
            }}
            disabled={sites.isPending || visibleSites.length === 0}
            className="mt-1.5 w-full rounded-md border border-[#EAEAEA] bg-white px-3 py-2 text-sm font-semibold text-[#2F3437]"
          >
            {visibleSites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.code} · {site.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wider text-[#6B6B6B]">
          Status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as 'ALL' | SafetyAlertStatus);
              setRequestedAlertId('');
              setOffset(0);
              resetReviewDraft();
            }}
            className="mt-1.5 w-full rounded-md border border-[#EAEAEA] bg-white px-3 py-2 text-sm font-semibold text-[#2F3437]"
          >
            <option value="ALL">All statuses</option>
            {statusOptions.map((value) => (
              <option key={value} value={value}>
                {formatLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wider text-[#6B6B6B]">
          Alert type
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as 'ALL' | SafetyAlertType);
              setRequestedAlertId('');
              setOffset(0);
              resetReviewDraft();
            }}
            className="mt-1.5 w-full rounded-md border border-[#EAEAEA] bg-white px-3 py-2 text-sm font-semibold text-[#2F3437]"
          >
            <option value="ALL">All types</option>
            {alertTypeOptions.map((value) => (
              <option key={value} value={value}>
                {formatLabel(value)}
              </option>
            ))}
          </select>
        </label>
      </section>

      {sites.isPending && <p className="rounded-lg bg-white p-5 text-sm">Loading Sites…</p>}
      {sites.error && (
        <p role="alert" className="rounded-lg bg-[#FDEBEC] p-5 text-sm text-[#9F2F2D]">
          {errorMessage(sites.error)}
        </p>
      )}
      {sites.data && visibleSites.length === 0 && (
        <p className="rounded-lg bg-white p-5 text-sm text-[#6B6B6B]">
          No Site with Safety Officer access is assigned to this account.
        </p>
      )}

      {selectedSiteId && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[#111111]">Alert queue</h2>
                {alerts.data && (
                  <p className="text-xs text-[#6B6B6B]">
                    {alerts.data.total === 0
                      ? '0 alerts'
                      : `${offset + 1}–${Math.min(offset + alerts.data.items.length, alerts.data.total)} of ${alerts.data.total}`}
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
                Refresh
              </button>
            </div>
            {alerts.isPending && <p className="rounded-lg bg-white p-5 text-sm">Loading alerts…</p>}
            {alerts.error && (
              <p role="alert" className="rounded-lg bg-[#FDEBEC] p-5 text-sm text-[#9F2F2D]">
                {errorMessage(alerts.error)}
              </p>
            )}
            {alerts.data?.items.length === 0 && (
              <p className="rounded-lg border border-dashed border-[#EAEAEA] bg-white p-8 text-center text-sm text-[#6B6B6B]">
                No alerts match the selected Site and filters.
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
                }}
              />
            ))}
            {alerts.data && alerts.data.total > alertPageSize && (
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={offset === 0 || alerts.isFetching}
                  onClick={() => setOffset((value) => Math.max(0, value - alertPageSize))}
                  className="rounded-md border border-[#EAEAEA] bg-white px-3 py-2 text-xs font-bold text-[#2F3437] hover:bg-[#F7F6F3] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={
                    offset + alerts.data.items.length >= alerts.data.total || alerts.isFetching
                  }
                  onClick={() => setOffset((value) => value + alertPageSize)}
                  className="rounded-md border border-[#EAEAEA] bg-white px-3 py-2 text-xs font-bold text-[#2F3437] hover:bg-[#F7F6F3] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}
          </section>

          <aside className="min-h-80 rounded-lg border border-[#EAEAEA] bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-[#111111]">Alert detail</h2>
              {selectedAlertId && (
                <button
                  type="button"
                  onClick={() => void detail.refetch()}
                  className="text-xs font-semibold text-[#F66B17] hover:text-[#D94E07] cursor-pointer"
                >
                  Refresh detail
                </button>
              )}
            </div>
            {!selectedAlertId && (
              <p className="mt-4 text-sm text-[#6B6B6B]">Select an alert to inspect its sources.</p>
            )}
            {detail.isPending && selectedAlertId && (
              <p className="mt-4 text-sm text-[#6B6B6B]">Loading alert detail…</p>
            )}
            {detail.error && (
              <p role="alert" className="mt-4 rounded-md bg-[#FDEBEC] p-3 text-sm text-[#9F2F2D]">
                {errorMessage(detail.error)}
              </p>
            )}
            {detail.data && (
              <div className="mt-4 space-y-5">
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-[#6B6B6B]">Candidate identity</dt>
                    <dd className="mt-1 font-semibold text-[#2F3437]">
                      {detail.data.candidateWorkerId ?? 'Unknown'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#6B6B6B]">Detections</dt>
                    <dd className="mt-1 font-semibold text-[#2F3437]">
                      {detail.data.detectionsTotal}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#6B6B6B]">Status</dt>
                    <dd className="mt-1 font-semibold text-[#2F3437]">
                      {formatLabel(detail.data.status)} · revision {detail.data.revision}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#6B6B6B]">First seen</dt>
                    <dd className="mt-1 font-semibold text-[#2F3437]">
                      {formatDate(detail.data.firstDetectedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#6B6B6B]">Last seen</dt>
                    <dd className="mt-1 font-semibold text-[#2F3437]">
                      {formatDate(detail.data.lastDetectedAt)}
                    </dd>
                  </div>
                </dl>
                <div>
                  <h3 className="text-sm font-bold text-[#2F3437]">Source observations</h3>
                  <div
                    className={`mt-2 space-y-2 ${safetyOfficerSiteIds.has(selectedSiteId) ? '' : 'max-h-80 overflow-auto'}`}
                  >
                    {detail.data.detections.map((detection) => (
                      <div
                        key={`${detail.data.id}:${detection.eventId}`}
                        className="rounded-md bg-[#F7F6F3] p-3 text-xs"
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
                        <p className="mt-1 break-all font-mono text-[#6B6B6B]">
                          {detection.eventId}
                        </p>
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
                        No source observation is linked to this alert.
                      </p>
                    )}
                  </div>
                </div>
                {(detail.data.status === 'PENDING_REVIEW' ||
                  detail.data.status === 'NEEDS_MORE_EVIDENCE') && (
                  <section className="rounded-lg border border-[#EAEAEA] bg-[#F7F6F3] p-4">
                    <h3 className="text-sm font-bold text-[#111111]">Record review decision</h3>
                    <p className="mt-1 text-xs leading-5 text-[#6B6B6B]">
                      Explain the evidence behind the decision. The reason is required and cannot be
                      edited after submission.
                    </p>
                    <textarea
                      value={reviewReason}
                      onChange={(event) => setReviewReason(event.target.value)}
                      minLength={5}
                      maxLength={1000}
                      rows={3}
                      placeholder="Example: Worker is clearly visible without a hard hat across the linked observations."
                      className="mt-3 w-full rounded-md border border-[#EAEAEA] bg-white px-3 py-2 text-sm outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10 placeholder:text-[#6B6B6B]"
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
                        Review decision recorded.
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={reviewReason.trim().length < 5 || review.isPending}
                        onClick={() => review.mutate('CONFIRMED')}
                        className="rounded-md bg-[#9F2F2D] px-3 py-2 text-xs font-bold text-white hover:bg-[#7F2524] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Confirm violation
                      </button>
                      <button
                        type="button"
                        disabled={reviewReason.trim().length < 5 || review.isPending}
                        onClick={() => review.mutate('DISMISSED')}
                        className="rounded-md bg-[#111111] px-3 py-2 text-xs font-bold text-white hover:bg-[#333333] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Dismiss alert
                      </button>
                      {detail.data.status === 'PENDING_REVIEW' && (
                        <button
                          type="button"
                          disabled={reviewReason.trim().length < 5 || review.isPending}
                          onClick={() => review.mutate('NEEDS_MORE_EVIDENCE')}
                          className="rounded-md border border-[#1F6C9F]/30 bg-white px-3 py-2 text-xs font-bold text-[#1F6C9F] hover:bg-[#E1F3FE] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Request more evidence
                        </button>
                      )}
                    </div>
                  </section>
                )}
                <section>
                  <h3 className="text-sm font-bold text-[#2F3437]">
                    Review history ({detail.data.reviewsTotal})
                  </h3>
                  <div className="mt-2 space-y-2">
                    {detail.data.reviews.map((item) => (
                      <article
                        key={item.id}
                        className="rounded-md border border-[#EAEAEA] p-3 text-xs"
                      >
                        <div className="flex flex-wrap justify-between gap-2">
                          <span className="font-bold text-[#2F3437]">
                            {formatLabel(item.fromStatus)} → {formatLabel(item.toStatus)}
                          </span>
                          <time className="text-[#6B6B6B]">{formatDate(item.createdAt)}</time>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-[#2F3437]">{item.reason}</p>
                        <p className="mt-2 font-mono text-[10px] text-[#6B6B6B]">
                          Actor {item.actorUserId} · revision {item.alertRevision}
                        </p>
                      </article>
                    ))}
                    {detail.data.reviews.length === 0 && (
                      <p className="rounded-md bg-[#F7F6F3] p-3 text-sm text-[#6B6B6B]">
                        No review decision has been recorded.
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
