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

interface SafetyAlertsViewProps {
  apiUrl: string;
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
    if (error.status === 409)
      return 'This alert changed while you were reviewing it. The latest record has been loaded; review it before submitting again.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

function statusTone(status: SafetyAlertStatus): string {
  if (status === 'PENDING_REVIEW') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (status === 'NEEDS_MORE_EVIDENCE') return 'bg-blue-50 text-blue-800 border-blue-200';
  if (status === 'CONFIRMED') return 'bg-red-50 text-red-800 border-red-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
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
      className={`w-full rounded-xl border p-4 text-left transition-colors ${
        selected
          ? 'border-[#F66B17] bg-orange-50/60'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
            {formatLabel(alert.alertType)}
          </p>
          <p className="mt-1 font-semibold text-slate-950">{formatLabel(alert.candidateSubtype)}</p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusTone(alert.status)}`}
        >
          {formatLabel(alert.status)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
        <span>{alert.detectionCount} detections</span>
        <span>Last seen {formatDate(alert.lastDetectedAt)}</span>
        <span>{alert.zoneId ? `Zone ${alert.zoneId.slice(0, 8)}` : 'No resolved Zone'}</span>
      </div>
    </button>
  );
}

export function SafetyAlertsView({ apiUrl }: SafetyAlertsViewProps) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const queryClient = useQueryClient();
  const [session, setSession] = useState<LoginResponse | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [requestedSiteId, setRequestedSiteId] = useState('');
  const [requestedAlertId, setRequestedAlertId] = useState('');
  const [status, setStatus] = useState<'ALL' | SafetyAlertStatus>('ALL');
  const [type, setType] = useState<'ALL' | SafetyAlertType>('ALL');
  const [offset, setOffset] = useState(0);
  const [reviewReason, setReviewReason] = useState('');
  const activeSession = useRef<{ token: string; userId: string } | null>(null);
  const lifecycleGeneration = useRef(0);

  const removeSessionQueries = useCallback(
    (userId: string) => {
      queryClient.removeQueries({ queryKey: ['sites', apiUrl, userId] });
      queryClient.removeQueries({ queryKey: ['safety-alerts', apiUrl, userId] });
      queryClient.removeQueries({ queryKey: ['safety-alert', apiUrl, userId] });
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
      activeSession.current = { token: result.accessToken, userId: result.user.id };
      setSession(result);
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
      removeSessionQueries(current.userId);
      void client.logout().catch(() => undefined);
    };
  }, [client, removeSessionQueries]);

  const token = session?.accessToken ?? '';
  const sessionScope = session?.user.id ?? '';
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
    if (current) removeSessionQueries(current.userId);
    login.reset();
    setSession(null);
    setRequestedSiteId('');
    setRequestedAlertId('');
    setOffset(0);
    setReviewReason('');
    if (current) void client.logout().catch(() => undefined);
  };

  if (!session) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F66B17]">MF04 / MF05</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">Safety alert queue</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Sign in as a global Admin or Site-scoped Safety Officer to inspect AI evidence and record
          an auditable review decision.
        </p>
        <form className="mt-6 space-y-4" onSubmit={handleLogin}>
          <label className="block text-sm font-semibold text-slate-700">
            Username
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-orange-100"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-orange-100"
            />
          </label>
          {login.error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage(login.error)}
            </p>
          )}
          <button
            type="submit"
            disabled={login.isPending}
            className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
          >
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1202px] space-y-6 pb-10 text-[#182232]">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F66B17]">MF04 / MF05</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Safety alerts</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Review durable AI observations, request more evidence, confirm a safety violation, or
            dismiss a false alert. Every decision requires a reason and is kept in the audit trail.
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Sign out {session.user.displayName}
        </button>
      </header>

      <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-3">
        <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
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
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
          >
            {visibleSites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.code} · {site.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as 'ALL' | SafetyAlertStatus);
              setRequestedAlertId('');
              setOffset(0);
              resetReviewDraft();
            }}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
          >
            <option value="ALL">All statuses</option>
            {statusOptions.map((value) => (
              <option key={value} value={value}>
                {formatLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Alert type
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as 'ALL' | SafetyAlertType);
              setRequestedAlertId('');
              setOffset(0);
              resetReviewDraft();
            }}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
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

      {sites.isPending && <p className="rounded-xl bg-white p-5 text-sm">Loading Sites…</p>}
      {sites.error && (
        <p role="alert" className="rounded-xl bg-red-50 p-5 text-sm text-red-700">
          {errorMessage(sites.error)}
        </p>
      )}
      {sites.data && visibleSites.length === 0 && (
        <p className="rounded-xl bg-white p-5 text-sm text-slate-600">
          No Site with Safety Officer access is assigned to this account.
        </p>
      )}

      {selectedSiteId && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-950">Alert queue</h2>
                {alerts.data && (
                  <p className="text-xs text-slate-500">
                    {alerts.data.total === 0
                      ? '0 alerts'
                      : `${offset + 1}–${Math.min(offset + alerts.data.items.length, alerts.data.total)} of ${alerts.data.total}`}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void alerts.refetch()}
                className="text-sm font-semibold text-[#C84C08] hover:text-[#9B3803]"
              >
                Refresh
              </button>
            </div>
            {alerts.isPending && <p className="rounded-xl bg-white p-5 text-sm">Loading alerts…</p>}
            {alerts.error && (
              <p role="alert" className="rounded-xl bg-red-50 p-5 text-sm text-red-700">
                {errorMessage(alerts.error)}
              </p>
            )}
            {alerts.data?.items.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
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
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={
                    offset + alerts.data.items.length >= alerts.data.total || alerts.isFetching
                  }
                  onClick={() => setOffset((value) => value + alertPageSize)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}
          </section>

          <aside className="min-h-80 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-bold text-slate-950">Alert detail</h2>
            {!selectedAlertId && (
              <p className="mt-4 text-sm text-slate-500">Select an alert to inspect its sources.</p>
            )}
            {detail.isPending && selectedAlertId && (
              <p className="mt-4 text-sm text-slate-500">Loading alert detail…</p>
            )}
            {detail.error && (
              <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {errorMessage(detail.error)}
              </p>
            )}
            {detail.data && (
              <div className="mt-4 space-y-5">
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-slate-500">Candidate identity</dt>
                    <dd className="mt-1 font-semibold text-slate-900">
                      {detail.data.candidateWorkerId ?? 'Unknown'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Detections</dt>
                    <dd className="mt-1 font-semibold text-slate-900">
                      {detail.data.detectionsTotal}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Status</dt>
                    <dd className="mt-1 font-semibold text-slate-900">
                      {formatLabel(detail.data.status)} · revision {detail.data.revision}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">First seen</dt>
                    <dd className="mt-1 font-semibold text-slate-900">
                      {formatDate(detail.data.firstDetectedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Last seen</dt>
                    <dd className="mt-1 font-semibold text-slate-900">
                      {formatDate(detail.data.lastDetectedAt)}
                    </dd>
                  </div>
                </dl>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Source observations</h3>
                  <div className="mt-2 max-h-80 space-y-2 overflow-auto">
                    {detail.data.detections.map((detection) => (
                      <div key={detection.eventId} className="rounded-lg bg-slate-50 p-3 text-xs">
                        <div className="flex justify-between gap-3">
                          <span className="font-mono font-semibold text-slate-700">
                            {detection.cameraExternalId}
                          </span>
                          <span className="font-bold text-emerald-700">
                            {formatLabel(detection.processingStatus)}
                          </span>
                        </div>
                        <p className="mt-1 text-slate-500">{formatDate(detection.capturedAt)}</p>
                        <p className="mt-1 break-all font-mono text-slate-400">
                          {detection.eventId}
                        </p>
                        <SafetyAlertEvidencePanel
                          client={client}
                          token={token}
                          siteId={selectedSiteId}
                          alertId={detail.data.id}
                          detection={detection}
                        />
                      </div>
                    ))}
                    {detail.data.detections.length === 0 && (
                      <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
                        No source observation is linked to this alert.
                      </p>
                    )}
                  </div>
                </div>
                {(detail.data.status === 'PENDING_REVIEW' ||
                  detail.data.status === 'NEEDS_MORE_EVIDENCE') && (
                  <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="text-sm font-bold text-slate-950">Record review decision</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
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
                      className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-orange-100"
                    />
                    {review.error && (
                      <p
                        role="alert"
                        className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700"
                      >
                        {errorMessage(review.error)}
                      </p>
                    )}
                    {review.isSuccess && (
                      <p
                        role="status"
                        className="mt-2 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700"
                      >
                        Review decision recorded.
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={reviewReason.trim().length < 5 || review.isPending}
                        onClick={() => review.mutate('CONFIRMED')}
                        className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Confirm violation
                      </button>
                      <button
                        type="button"
                        disabled={reviewReason.trim().length < 5 || review.isPending}
                        onClick={() => review.mutate('DISMISSED')}
                        className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Dismiss alert
                      </button>
                      {detail.data.status === 'PENDING_REVIEW' && (
                        <button
                          type="button"
                          disabled={reviewReason.trim().length < 5 || review.isPending}
                          onClick={() => review.mutate('NEEDS_MORE_EVIDENCE')}
                          className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-bold text-blue-800 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Request more evidence
                        </button>
                      )}
                    </div>
                  </section>
                )}
                <section>
                  <h3 className="text-sm font-bold text-slate-900">
                    Review history ({detail.data.reviewsTotal})
                  </h3>
                  <div className="mt-2 space-y-2">
                    {detail.data.reviews.map((item) => (
                      <article
                        key={item.id}
                        className="rounded-lg border border-slate-200 p-3 text-xs"
                      >
                        <div className="flex flex-wrap justify-between gap-2">
                          <span className="font-bold text-slate-800">
                            {formatLabel(item.fromStatus)} → {formatLabel(item.toStatus)}
                          </span>
                          <time className="text-slate-500">{formatDate(item.createdAt)}</time>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-slate-700">{item.reason}</p>
                        <p className="mt-2 font-mono text-[10px] text-slate-400">
                          Actor {item.actorUserId} · revision {item.alertRevision}
                        </p>
                      </article>
                    ))}
                    {detail.data.reviews.length === 0 && (
                      <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
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
