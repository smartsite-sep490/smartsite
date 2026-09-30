import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  type LoginResponse,
  type Page,
  type WorkerResponse,
  type ZoneAccessEffect,
  type ZoneEntryDecisionStatus,
} from '@smartsite/api-client';
import { IconAlertTriangle, IconCheck, IconClock, IconKey, IconUsers, IconX } from '../icons';
import { grantState, toUtcIso, zoneDecisionLabel } from './accessControlUtils';

interface AccessControlViewProps {
  apiUrl: string;
}

const decisionStatuses: ZoneEntryDecisionStatus[] = ['ALLOWED', 'DENIED', 'UNAVAILABLE'];
const pageSize = 20;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

function formatDate(value: string | null) {
  if (!value) return 'No expiry';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function decisionTone(status: ZoneEntryDecisionStatus) {
  if (status === 'ALLOWED') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'DENIED') return 'border-red-200 bg-red-50 text-red-700';
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

function stateTone(state: ReturnType<typeof grantState>) {
  if (state === 'ACTIVE') return 'bg-emerald-50 text-emerald-700';
  if (state === 'SCHEDULED') return 'bg-blue-50 text-blue-700';
  return 'bg-[#F7F6F3] text-[#6B6B6B]';
}

function defaultLocalDateTime() {
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return now.toISOString().slice(0, 16);
}

async function loadAllWorkers(
  client: SmartSiteManagementClient,
  token: string,
  siteId: string,
): Promise<Page<WorkerResponse>> {
  const items: WorkerResponse[] = [];
  let total: number;
  do {
    const page = await client.listWorkers(token, siteId, { offset: items.length, limit: 100 });
    items.push(...page.items);
    total = page.total;
    if (page.items.length === 0) break;
  } while (items.length < total);
  return { items, total };
}

function WorkerName({ worker }: { worker?: WorkerResponse }) {
  if (!worker) return <span className="font-mono text-xs text-[#6B6B6B]">Unknown worker</span>;
  return (
    <span>
      <span className="block font-semibold text-[#2F3437]">{worker.displayName}</span>
      <span className="block text-xs text-[#6B6B6B]">{worker.externalId}</span>
    </span>
  );
}

export function AccessControlView({ apiUrl }: AccessControlViewProps) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const queryClient = useQueryClient();
  const activeSession = useRef<{ token: string; userId: string } | null>(null);
  const lifecycleGeneration = useRef(0);
  const [session, setSession] = useState<LoginResponse | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [requestedSiteId, setRequestedSiteId] = useState('');
  const [requestedZoneId, setRequestedZoneId] = useState('');
  const [decisionStatus, setDecisionStatus] = useState<'ALL' | ZoneEntryDecisionStatus>('ALL');
  const [workerExternalId, setWorkerExternalId] = useState('');
  const [workerDisplayName, setWorkerDisplayName] = useState('');
  const [grantWorkerId, setGrantWorkerId] = useState('');
  const [grantEffect, setGrantEffect] = useState<ZoneAccessEffect>('ALLOW');
  const [validFrom, setValidFrom] = useState(defaultLocalDateTime);
  const [validUntil, setValidUntil] = useState('');
  const [grantOffset, setGrantOffset] = useState(0);
  const [decisionOffset, setDecisionOffset] = useState(0);
  const [clockTick, setClockTick] = useState(Date.now);

  const removeSessionQueries = useCallback(
    (userId: string) => {
      queryClient.removeQueries({ queryKey: ['access-control', apiUrl, userId] });
    },
    [apiUrl, queryClient],
  );

  const login = useMutation({
    mutationFn: async () => {
      const generation = lifecycleGeneration.current;
      const result = await client.login(username, password);
      const isGlobalAdmin = result.user.roleAssignments.some(
        ({ role, siteId }) => role === 'ADMIN' && siteId === null,
      );
      if (!isGlobalAdmin || result.user.mustChangePassword) {
        await client.logout('WEB').catch(() => undefined);
        throw new Error('Use an active Admin account with its permanent password.');
      }
      if (generation !== lifecycleGeneration.current) {
        await client.logout('WEB').catch(() => undefined);
        throw new Error('The sign-in request was cancelled.');
      }
      activeSession.current = { token: result.accessToken, userId: result.user.id };
      setSession(result);
      setPassword('');
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
      void client.logout('WEB').catch(() => undefined);
    };
  }, [client, removeSessionQueries]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const token = session?.accessToken ?? '';
  const sessionScope = session?.user.id ?? '';
  const sites = useQuery({
    queryKey: ['access-control', apiUrl, sessionScope, 'sites'],
    queryFn: () => client.listSites(token, { limit: 100 }),
    enabled: token.length > 0,
  });
  const siteId = sites.data?.items.some((site) => site.id === requestedSiteId)
    ? requestedSiteId
    : (sites.data?.items[0]?.id ?? '');

  const zones = useQuery({
    queryKey: ['access-control', apiUrl, sessionScope, siteId, 'zones'],
    queryFn: () => client.listZones(token, siteId, { limit: 100 }),
    enabled: token.length > 0 && siteId.length > 0,
  });
  const workers = useQuery({
    queryKey: ['access-control', apiUrl, sessionScope, siteId, 'workers'],
    queryFn: () => loadAllWorkers(client, token, siteId),
    enabled: token.length > 0 && siteId.length > 0,
  });
  const zoneId = zones.data?.items.some((zone) => zone.id === requestedZoneId)
    ? requestedZoneId
    : (zones.data?.items.find((zone) => zone.restrictionPolicy !== 'NONE')?.id ??
      zones.data?.items[0]?.id ??
      '');
  const selectedZone = zones.data?.items.find((zone) => zone.id === zoneId);
  const canManageGrants = selectedZone?.restrictionPolicy === 'AUTHORIZATION_REQUIRED';

  const grants = useQuery({
    queryKey: ['access-control', apiUrl, sessionScope, siteId, zoneId, 'grants', grantOffset],
    queryFn: () =>
      client.listZoneAccessGrants(token, siteId, zoneId, {
        offset: grantOffset,
        limit: pageSize,
      }),
    enabled: token.length > 0 && siteId.length > 0 && zoneId.length > 0,
  });
  const decisions = useQuery({
    queryKey: [
      'access-control',
      apiUrl,
      sessionScope,
      siteId,
      zoneId,
      'decisions',
      decisionStatus,
      decisionOffset,
    ],
    queryFn: () =>
      client.listZoneEntryDecisions(token, siteId, {
        offset: decisionOffset,
        limit: pageSize,
        ...(zoneId ? { zoneId } : {}),
        ...(decisionStatus === 'ALL' ? {} : { status: decisionStatus }),
      }),
    enabled: token.length > 0 && siteId.length > 0,
    refetchInterval: 15_000,
  });

  const workerById = useMemo(
    () => new Map(workers.data?.items.map((worker) => [worker.id, worker]) ?? []),
    [workers.data?.items],
  );
  const now = useMemo(() => new Date(clockTick), [clockTick]);

  const createWorker = useMutation({
    mutationFn: () =>
      client.createWorker(token, siteId, {
        externalId: workerExternalId,
        displayName: workerDisplayName,
      }),
    onSuccess: async (worker) => {
      setWorkerExternalId('');
      setWorkerDisplayName('');
      setGrantWorkerId(worker.id);
      await queryClient.invalidateQueries({
        queryKey: ['access-control', apiUrl, sessionScope, siteId, 'workers'],
      });
    },
  });
  const createGrant = useMutation({
    mutationFn: () =>
      client.createZoneAccessGrant(token, siteId, zoneId, {
        workerId: grantWorkerId,
        effect: grantEffect,
        validFrom: toUtcIso(validFrom)!,
        validUntil: toUtcIso(validUntil),
      }),
    onSuccess: async () => {
      setValidUntil('');
      setGrantOffset(0);
      await queryClient.invalidateQueries({
        queryKey: ['access-control', apiUrl, sessionScope, siteId, zoneId, 'grants'],
      });
    },
  });
  const revokeGrant = useMutation({
    mutationFn: (grantId: string) => client.revokeZoneAccessGrant(token, siteId, zoneId, grantId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['access-control', apiUrl, sessionScope, siteId, zoneId, 'grants'],
      });
    },
  });

  const logout = () => {
    const current = activeSession.current;
    activeSession.current = null;
    setSession(null);
    setRequestedSiteId('');
    setRequestedZoneId('');
    setGrantOffset(0);
    setDecisionOffset(0);
    if (current) removeSessionQueries(current.userId);
    if (current) void client.logout('WEB').catch(() => undefined);
  };

  const submitLogin = (event: FormEvent) => {
    event.preventDefault();
    login.mutate();
  };
  const submitWorker = (event: FormEvent) => {
    event.preventDefault();
    createWorker.mutate();
  };
  const submitGrant = (event: FormEvent) => {
    event.preventDefault();
    createGrant.mutate();
  };

  if (!session) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-[#EAEAEA] bg-white p-7 shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
          <IconKey className="h-6 w-6" />
        </div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-[#F66B17]">MF05</p>
        <h1 className="mt-1 text-2xl font-bold text-[#111111]">Site access authorization</h1>
        <p className="mt-2 text-sm leading-6 text-[#6B6B6B]">
          Sign in as Admin to manage Workers, Zone permissions and audit AI-assisted entry
          decisions.
        </p>
        <form className="mt-6 space-y-4" onSubmit={submitLogin}>
          <label className="block text-sm font-semibold text-[#2F3437]">
            Username
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-[#EAEAEA] px-3 py-2.5 font-normal outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-orange-100"
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
              className="mt-1.5 w-full rounded-lg border border-[#EAEAEA] px-3 py-2.5 font-normal outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-orange-100"
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
            className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {login.isPending ? 'Signing in…' : 'Open access control'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6 pb-10 text-[#182232]">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F66B17]">
            MF05 · Restricted Zone
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#111111]">
            Site access & authorization
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6B6B6B]">
            Backend policy remains authoritative. An AI identity candidate never becomes permission
            until a trusted Worker identity is verified.
          </p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="rounded-lg border border-[#EAEAEA] bg-white px-3 py-2 text-sm font-semibold text-[#2F3437] hover:bg-[#FBFBFA]"
        >
          Sign out {session.user.displayName}
        </button>
      </header>

      <section className="grid gap-4 rounded-lg border border-[#EAEAEA] bg-white p-4 md:grid-cols-2">
        <label className="text-xs font-bold uppercase tracking-wider text-[#6B6B6B]">
          Site
          <select
            value={siteId}
            onChange={(event) => {
              setRequestedSiteId(event.target.value);
              setRequestedZoneId('');
              setGrantWorkerId('');
              setGrantOffset(0);
              setDecisionOffset(0);
            }}
            className="mt-1.5 w-full rounded-lg border border-[#EAEAEA] bg-white px-3 py-2.5 text-sm font-semibold text-[#2F3437]"
          >
            {sites.data?.items.map((site) => (
              <option key={site.id} value={site.id}>
                {site.code} · {site.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wider text-[#6B6B6B]">
          Restricted Zone
          <select
            value={zoneId}
            onChange={(event) => {
              setRequestedZoneId(event.target.value);
              setGrantOffset(0);
              setDecisionOffset(0);
            }}
            disabled={!zones.data?.items.length}
            className="mt-1.5 w-full rounded-lg border border-[#EAEAEA] bg-white px-3 py-2.5 text-sm font-semibold text-[#2F3437] disabled:bg-[#F7F6F3]"
          >
            {zones.data?.items.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.code} · {zone.name} · {zone.restrictionPolicy}
              </option>
            ))}
          </select>
        </label>
      </section>

      {(sites.error || zones.error || workers.error) && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {errorMessage(sites.error ?? zones.error ?? workers.error)}
        </p>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-[#EAEAEA] bg-white p-5">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-blue-50 p-2 text-blue-700">
              <IconUsers />
            </span>
            <span className="text-sm font-semibold text-[#6B6B6B]">Active Workers</span>
          </div>
          <p className="mt-4 text-3xl font-bold text-[#111111]">
            {workers.data?.items.filter((worker) => worker.isActive).length ?? '—'}
          </p>
        </div>
        <div className="rounded-lg border border-[#EAEAEA] bg-white p-5">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
              <IconKey />
            </span>
            <span className="text-sm font-semibold text-[#6B6B6B]">Rules in selected Zone</span>
          </div>
          <p className="mt-4 text-3xl font-bold text-[#111111]">{grants.data?.total ?? '—'}</p>
        </div>
        <div className="rounded-lg border border-[#EAEAEA] bg-white p-5">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-amber-50 p-2 text-amber-700">
              <IconClock />
            </span>
            <span className="text-sm font-semibold text-[#6B6B6B]">Recent decisions</span>
          </div>
          <p className="mt-4 text-3xl font-bold text-[#111111]">{decisions.data?.total ?? '—'}</p>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <section className="rounded-lg border border-[#EAEAEA] bg-white p-5">
          <div>
            <h2 className="text-lg font-bold text-[#111111]">Worker roster</h2>
            <p className="mt-1 text-sm text-[#6B6B6B]">
              Create the Worker record used by trusted identity verification.
            </p>
          </div>
          <form
            onSubmit={submitWorker}
            className="mt-5 grid gap-3 rounded-xl bg-[#FBFBFA] p-4 sm:grid-cols-2"
          >
            <label className="text-xs font-bold text-[#6B6B6B]">
              Worker code
              <input
                required
                maxLength={128}
                value={workerExternalId}
                onChange={(event) => setWorkerExternalId(event.target.value)}
                placeholder="WKR-001"
                className="mt-1.5 w-full rounded-lg border border-[#EAEAEA] bg-white px-3 py-2 text-sm font-normal"
              />
            </label>
            <label className="text-xs font-bold text-[#6B6B6B]">
              Display name
              <input
                required
                maxLength={255}
                value={workerDisplayName}
                onChange={(event) => setWorkerDisplayName(event.target.value)}
                placeholder="Nguyen Van A"
                className="mt-1.5 w-full rounded-lg border border-[#EAEAEA] bg-white px-3 py-2 text-sm font-normal"
              />
            </label>
            {createWorker.error && (
              <p role="alert" className="text-sm text-red-700 sm:col-span-2">
                {errorMessage(createWorker.error)}
              </p>
            )}
            <button
              type="submit"
              disabled={createWorker.isPending || !siteId}
              className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2"
            >
              {createWorker.isPending ? 'Creating…' : 'Add Worker'}
            </button>
          </form>
          <div className="mt-4 max-h-80 space-y-2 overflow-auto">
            {workers.isPending && <p className="text-sm text-[#6B6B6B]">Loading Workers…</p>}
            {workers.data?.items.map((worker) => (
              <div
                key={worker.id}
                className="flex items-center justify-between rounded-xl border border-[#EAEAEA] px-4 py-3"
              >
                <WorkerName worker={worker} />
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${worker.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-[#F7F6F3] text-[#6B6B6B]'}`}
                >
                  {worker.isActive ? 'ACTIVE' : 'INACTIVE'}
                </span>
              </div>
            ))}
            {workers.data?.items.length === 0 && (
              <p className="rounded-xl border border-dashed border-[#EAEAEA] p-6 text-center text-sm text-[#6B6B6B]">
                No Worker has been configured for this Site.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-[#EAEAEA] bg-white p-5">
          <div>
            <h2 className="text-lg font-bold text-[#111111]">Zone permissions</h2>
            <p className="mt-1 text-sm text-[#6B6B6B]">
              Explicit DENY takes priority when Backend evaluates entry at event time.
            </p>
          </div>
          {selectedZone && !canManageGrants && (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {selectedZone.restrictionPolicy === 'PROHIBITED_FOR_ALL'
                ? 'This Zone denies every entry. An ALLOW rule cannot override PROHIBITED_FOR_ALL.'
                : 'This Zone does not require individual access rules. Backend policy allows entry without a grant.'}
            </p>
          )}
          <form
            onSubmit={submitGrant}
            className="mt-5 grid gap-3 rounded-xl bg-[#FBFBFA] p-4 sm:grid-cols-2"
          >
            <label className="text-xs font-bold text-[#6B6B6B] sm:col-span-2">
              Worker
              <select
                required
                disabled={!canManageGrants}
                value={grantWorkerId}
                onChange={(event) => setGrantWorkerId(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[#EAEAEA] bg-white px-3 py-2 text-sm font-normal"
              >
                <option value="">Select Worker</option>
                {workers.data?.items
                  .filter((worker) => worker.isActive)
                  .map((worker) => (
                    <option key={worker.id} value={worker.id}>
                      {worker.externalId} · {worker.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-xs font-bold text-[#6B6B6B]">
              Effect
              <select
                disabled={!canManageGrants}
                value={grantEffect}
                onChange={(event) => setGrantEffect(event.target.value as ZoneAccessEffect)}
                className="mt-1.5 w-full rounded-lg border border-[#EAEAEA] bg-white px-3 py-2 text-sm font-normal"
              >
                <option value="ALLOW">ALLOW</option>
                <option value="DENY">DENY</option>
              </select>
            </label>
            <label className="text-xs font-bold text-[#6B6B6B]">
              Valid from
              <input
                required
                disabled={!canManageGrants}
                type="datetime-local"
                value={validFrom}
                onChange={(event) => setValidFrom(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[#EAEAEA] bg-white px-3 py-2 text-sm font-normal"
              />
            </label>
            <label className="text-xs font-bold text-[#6B6B6B] sm:col-span-2">
              Valid until <span className="font-normal text-[#A3A09C]">(optional)</span>
              <input
                type="datetime-local"
                disabled={!canManageGrants}
                value={validUntil}
                min={validFrom}
                onChange={(event) => setValidUntil(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[#EAEAEA] bg-white px-3 py-2 text-sm font-normal"
              />
            </label>
            {createGrant.error && (
              <p role="alert" className="text-sm text-red-700 sm:col-span-2">
                {errorMessage(createGrant.error)}
              </p>
            )}
            <button
              type="submit"
              disabled={createGrant.isPending || !zoneId || !grantWorkerId || !canManageGrants}
              className="rounded-lg bg-[#F66B17] px-4 py-2 text-sm font-bold text-white hover:bg-[#D9570C] disabled:opacity-50 sm:col-span-2"
            >
              {createGrant.isPending ? 'Saving…' : 'Create permission'}
            </button>
          </form>
          <div className="mt-4 max-h-80 space-y-2 overflow-auto">
            {grants.isPending && zoneId && (
              <p className="text-sm text-[#6B6B6B]">Loading permissions…</p>
            )}
            {grants.error && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {errorMessage(grants.error)}
              </p>
            )}
            {revokeGrant.error && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {errorMessage(revokeGrant.error)}
              </p>
            )}
            {grants.data?.items.map((grant) => {
              const state = grantState(grant, now);
              return (
                <div key={grant.id} className="rounded-xl border border-[#EAEAEA] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <WorkerName worker={workerById.get(grant.workerId)} />
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${grant.effect === 'ALLOW' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}
                      >
                        {grant.effect}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${stateTone(state)}`}
                      >
                        {state}
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-[#6B6B6B]">
                    {formatDate(grant.validFrom)} → {formatDate(grant.validUntil)}
                  </p>
                  {state !== 'REVOKED' && (
                    <button
                      type="button"
                      disabled={revokeGrant.isPending}
                      onClick={() => revokeGrant.mutate(grant.id)}
                      className="mt-3 text-xs font-bold text-red-700 hover:text-red-900"
                    >
                      Revoke permission
                    </button>
                  )}
                </div>
              );
            })}
            {grants.data?.items.length === 0 && (
              <p className="rounded-xl border border-dashed border-[#EAEAEA] p-6 text-center text-sm text-[#6B6B6B]">
                No access rule exists for the selected Zone.
              </p>
            )}
            {grants.data && grants.data.total > pageSize && (
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={grantOffset === 0 || grants.isFetching}
                  onClick={() => setGrantOffset((value) => Math.max(0, value - pageSize))}
                  className="rounded-lg border border-[#EAEAEA] px-3 py-2 text-xs font-bold text-[#2F3437] disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={
                    grantOffset + grants.data.items.length >= grants.data.total || grants.isFetching
                  }
                  onClick={() => setGrantOffset((value) => value + pageSize)}
                  className="rounded-lg border border-[#EAEAEA] px-3 py-2 text-xs font-bold text-[#2F3437] disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-[#EAEAEA] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[#111111]">Entry decision audit</h2>
            <p className="mt-1 text-sm text-[#6B6B6B]">
              ALLOWED, DENIED and fail-closed unavailable outcomes produced by Backend.
            </p>
          </div>
          <label className="text-xs font-bold uppercase tracking-wider text-[#6B6B6B]">
            Status
            <select
              value={decisionStatus}
              onChange={(event) => {
                setDecisionStatus(event.target.value as typeof decisionStatus);
                setDecisionOffset(0);
              }}
              className="ml-2 rounded-lg border border-[#EAEAEA] bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-[#2F3437]"
            >
              <option value="ALL">All decisions</option>
              {decisionStatuses.map((status) => (
                <option key={status} value={status}>
                  {zoneDecisionLabel(status)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {decisions.error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {errorMessage(decisions.error)}
          </p>
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#EAEAEA] text-xs uppercase tracking-wider text-[#6B6B6B]">
                <th className="px-3 py-3">Decision</th>
                <th className="px-3 py-3">Worker evidence</th>
                <th className="px-3 py-3">Track</th>
                <th className="px-3 py-3">Reason</th>
                <th className="px-3 py-3">Evaluated</th>
              </tr>
            </thead>
            <tbody>
              {decisions.data?.items.map((decision) => (
                <tr key={decision.id} className="border-b border-[#EAEAEA] last:border-0">
                  <td className="px-3 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${decisionTone(decision.status)}`}
                    >
                      {decision.status === 'ALLOWED' ? (
                        <IconCheck className="h-3.5 w-3.5" />
                      ) : decision.status === 'DENIED' ? (
                        <IconX className="h-3.5 w-3.5" />
                      ) : (
                        <IconAlertTriangle className="h-3.5 w-3.5" />
                      )}
                      {zoneDecisionLabel(decision.status)}
                    </span>
                  </td>
                  <td className="px-3 py-4">
                    <WorkerName
                      worker={decision.workerId ? workerById.get(decision.workerId) : undefined}
                    />
                    {!decision.workerId && decision.candidateWorkerId && (
                      <span className="mt-1 block text-xs text-amber-700">
                        Candidate: {decision.candidateWorkerId}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-4 font-mono text-xs text-[#6B6B6B]">
                    #{decision.trackId}
                  </td>
                  <td className="px-3 py-4 text-[#2F3437]">
                    {decision.reasonCode.replaceAll('_', ' ')}
                  </td>
                  <td className="px-3 py-4 text-[#6B6B6B]">{formatDate(decision.evaluatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {decisions.isPending && (
            <p className="p-6 text-center text-sm text-[#6B6B6B]">Loading entry decisions…</p>
          )}
          {decisions.data?.items.length === 0 && (
            <p className="p-6 text-center text-sm text-[#6B6B6B]">
              No decision matches the current Site, Zone and status.
            </p>
          )}
          {decisions.data && decisions.data.total > pageSize && (
            <div className="flex items-center justify-end gap-2 border-t border-[#EAEAEA] p-3">
              <span className="mr-auto text-xs text-[#6B6B6B]">
                {decisionOffset + 1}–
                {Math.min(decisionOffset + decisions.data.items.length, decisions.data.total)} of{' '}
                {decisions.data.total}
              </span>
              <button
                type="button"
                disabled={decisionOffset === 0 || decisions.isFetching}
                onClick={() => setDecisionOffset((value) => Math.max(0, value - pageSize))}
                className="rounded-lg border border-[#EAEAEA] px-3 py-2 text-xs font-bold text-[#2F3437] disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={
                  decisionOffset + decisions.data.items.length >= decisions.data.total ||
                  decisions.isFetching
                }
                onClick={() => setDecisionOffset((value) => value + pageSize)}
                className="rounded-lg border border-[#EAEAEA] px-3 py-2 text-xs font-bold text-[#2F3437] disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
