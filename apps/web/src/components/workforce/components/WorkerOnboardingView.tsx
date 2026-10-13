import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient, type WorkerResponse } from '@smartsite/api-client';
import { WORKER_DEFAULT_TEMPORARY_PASSWORD } from '@smartsite/contracts/management';
import { useAuth, useCurrentUser } from '../../../features/auth/auth-session';
import { WorkerEnrollmentView } from '../../access/enrollment/WorkerEnrollmentView';
import { loadAllPages } from '../load-all-pages';

export function WorkerOnboardingView({ apiUrl }: { apiUrl: string }) {
  const { accessToken } = useAuth();
  const profile = useCurrentUser(apiUrl);
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const user = profile.data;
  const siteIds =
    user?.roleAssignments
      .filter((r) => r.role === 'CONTRACTOR_REPRESENTATIVE')
      .map((r) => r.siteId) ?? [];
  const allowed = !!accessToken && !user?.mustChangePassword && siteIds.length > 0;
  const sites = useQuery({
    queryKey: ['worker-onboarding', apiUrl, user?.id, 'sites'],
    enabled: allowed,
    queryFn: ({ signal }) =>
      loadAllPages((options) => client.listSites(accessToken!, options), signal),
  });
  const choices = sites.data?.items.filter((s) => siteIds.includes(s.id)) ?? [];
  const siteId = choices.some((s) => s.id === selectedSiteId)
    ? selectedSiteId
    : (choices[0]?.id ?? '');
  if (profile.isPending) return <p role="status">Loading your account…</p>;
  if (profile.isError)
    return (
      <div role="alert">
        Could not load your account. <button onClick={() => void profile.refetch()}>Retry</button>
      </div>
    );
  if (!allowed)
    return (
      <p role="alert">
        Worker Onboarding requires a Contractor Representative role for this Site and a completed
        password change.
      </p>
    );
  if (sites.isPending) return <p role="status">Loading your Sites…</p>;
  if (sites.isError)
    return (
      <div role="alert">
        Could not load Sites. <button onClick={() => void sites.refetch()}>Retry</button>
      </div>
    );
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-[#F66B17]">MF01</p>
        <h1 className="text-2xl font-bold text-slate-900">Worker Onboarding</h1>
        <p className="text-sm text-slate-600">
          Create accounts and manage workers belonging to your contractor at this Site. Register
          each Worker’s face with their consent.
        </p>
      </header>
      {!choices.length ? (
        <p role="status">No assigned Sites are available.</p>
      ) : (
        <>
          <label className="block text-sm font-semibold">
            Site
            <select
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-3"
              value={siteId}
              onChange={(e) => setSelectedSiteId(e.target.value)}
            >
              {choices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <WorkerAccountForm
            key={`${apiUrl}:${user!.id}:${siteId}`}
            apiUrl={apiUrl}
            token={accessToken!}
            siteId={siteId}
            sessionScope={user!.id}
          />
          <WorkerEnrollmentView
            key={`enrollment:${user!.id}:${siteId}`}
            apiUrl={apiUrl}
            token={accessToken!}
            siteId={siteId}
            sessionScope={user!.id}
            canManageAccounts={false}
          />
        </>
      )}
    </div>
  );
}

function WorkerAccountForm({
  apiUrl,
  token,
  siteId,
  sessionScope,
}: {
  apiUrl: string;
  token: string;
  siteId: string;
  sessionScope: string;
}) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const cache = useQueryClient();
  const options = useQuery({
    queryKey: ['worker-onboarding', apiUrl, sessionScope, siteId, 'contractors'],
    queryFn: () => client.contractorWorkerAccountOptions(token, siteId),
  });
  const [contractorId, setContractorId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const contractors = options.data?.contractors ?? [];
  const selected = contractors.some((c) => c.id === contractorId)
    ? contractorId
    : (contractors[0]?.id ?? '');
  const create = useMutation({
    mutationFn: () =>
      client.createContractorWorkerAccount(token, selected, {
        siteId,
        displayName: displayName.trim(),
        username: username.trim().toLowerCase(),
      }),
    onSuccess: () => {
      setDisplayName('');
      setUsername('');
      void cache.invalidateQueries({ queryKey: ['access-control', apiUrl, sessionScope, siteId] });
      void cache.invalidateQueries({ queryKey: ['workers', siteId] });
      void cache.invalidateQueries({
        queryKey: ['worker-onboarding', apiUrl, sessionScope, siteId, 'workers'],
      });
    },
  });
  const field = 'mt-1 block w-full rounded-lg border border-slate-300 p-3 text-sm';
  if (options.isPending) return <p role="status">Loading your contractors…</p>;
  if (options.isError)
    return (
      <div role="alert">
        Could not load your contractors.{' '}
        <button onClick={() => void options.refetch()}>Retry</button>
      </div>
    );
  if (!contractors.length)
    return (
      <p role="status">
        No active contractor participation is assigned to you at this Site. Contact your Site
        administrator.
      </p>
    );
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-bold">Create Worker account</h2>
      <p className="text-sm text-slate-600">
        The account receives the Worker role at this Site and can sign in immediately. Password
        change is optional. The Worker code is generated automatically when you save. Default
        temporary password: <strong>{WORKER_DEFAULT_TEMPORARY_PASSWORD}</strong>.
      </p>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!create.isPending && selected) create.mutate();
        }}
      >
        <fieldset disabled={create.isPending} className="contents">
          <label className="text-sm font-semibold">
            Contractor
            <select
              className={field}
              value={selected}
              onChange={(e) => setContractorId(e.target.value)}
            >
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Full name
            <input
              className={field}
              required
              maxLength={255}
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label className="text-sm font-semibold">
            Username
            <input
              className={field}
              required
              minLength={3}
              maxLength={64}
              pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,63}"
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-[#F66B17] px-4 py-3 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2"
            disabled={!selected || !displayName.trim() || !username.trim() || create.isPending}
          >
            {create.isPending ? 'Creating…' : 'Create Worker account'}
          </button>
        </fieldset>
      </form>
      {create.isError && <p role="alert">{create.error.message}</p>}
      {create.isSuccess && (
        <p role="status">
          Account {create.data.account.username} and Worker profile created. Give the Worker their
          temporary password <strong>{WORKER_DEFAULT_TEMPORARY_PASSWORD}</strong>, then register
          their face below. Worker code: <strong>{create.data.worker.externalId}</strong>.
        </p>
      )}
      <ContractorWorkerRoster
        key={selected}
        apiUrl={apiUrl}
        token={token}
        siteId={siteId}
        sessionScope={sessionScope}
        contractorId={selected}
      />
    </section>
  );
}

function ContractorWorkerRoster({
  apiUrl,
  token,
  siteId,
  sessionScope,
  contractorId,
}: {
  apiUrl: string;
  token: string;
  siteId: string;
  sessionScope: string;
  contractorId: string;
}) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState('');
  const workers = useQuery({
    queryKey: ['worker-onboarding', apiUrl, sessionScope, siteId, 'workers'],
    queryFn: ({ signal }) =>
      loadAllPages((options) => client.listWorkers(token, siteId, options), signal),
  });
  const ownedWorkers = workers.data?.items.filter((w) => w.contractorId === contractorId) ?? [];
  const term = search.trim().toLocaleLowerCase();
  const filtered = ownedWorkers.filter((w) =>
    `${w.externalId} ${w.displayName}`.toLocaleLowerCase().includes(term),
  );
  return (
    <div className="space-y-4 border-t border-slate-200 pt-6">
      <h2 className="text-lg font-bold">Your contractor’s workers</h2>
      <p className="text-sm text-slate-600">
        Workers belonging to the selected Contractor at this Site, including those created by other
        Representatives of the same Contractor.
      </p>
      {workers.isPending ? (
        <p role="status">Loading workers…</p>
      ) : workers.isError ? (
        <p role="alert">
          Could not load workers. <button onClick={() => void workers.refetch()}>Retry</button>
        </p>
      ) : (
        <>
          <label className="block text-sm font-semibold">
            Search workers by code or name
            <input
              className="mt-1 block w-full rounded-lg border border-slate-300 p-3 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              type="search"
            />
          </label>
          {!ownedWorkers.length ? (
            <p role="status">No workers belong to this Contractor at this Site yet.</p>
          ) : !filtered.length ? (
            <p role="status">No workers match your search.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {filtered.map((worker) => (
                <li key={worker.id} className="space-y-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 break-words">
                      <p className="font-semibold">{worker.displayName}</p>
                      <p className="text-sm text-slate-600">{worker.externalId}</p>
                    </div>
                    <div className="text-sm text-slate-600">
                      <p>{worker.isActive ? 'Active' : 'Suspended'}</p>
                      <p>{worker.userId ? 'Login account linked' : 'No login account linked'}</p>
                    </div>
                    <button
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
                      onClick={() => setEditingId(worker.id)}
                      aria-label={`Manage ${worker.displayName}`}
                    >
                      Manage
                    </button>
                  </div>
                  {editingId === worker.id && (
                    <WorkerProfileForm
                      key={worker.id}
                      apiUrl={apiUrl}
                      token={token}
                      worker={worker}
                      sessionScope={sessionScope}
                      onClose={() => setEditingId('')}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function WorkerProfileForm({
  apiUrl,
  token,
  worker,
  sessionScope,
  onClose,
}: {
  apiUrl: string;
  token: string;
  worker: WorkerResponse;
  sessionScope: string;
  onClose: () => void;
}) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const cache = useQueryClient();
  const [original] = useState(worker);
  const [displayName, setDisplayName] = useState(worker.displayName);
  const [isActive, setIsActive] = useState(worker.isActive);
  const queryKey = ['worker-onboarding', apiUrl, sessionScope, worker.siteId, 'workers'];
  const update = useMutation({
    mutationFn: () =>
      client.updateContractorWorker(token, worker.siteId, worker.contractorId!, worker.id, {
        externalId: original.externalId,
        displayName: displayName.trim(),
        isActive,
        expectedSnapshot: {
          externalId: original.externalId,
          displayName: original.displayName,
          isActive: original.isActive,
        },
      }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey });
      void cache.invalidateQueries({
        queryKey: ['access-control', apiUrl, sessionScope, worker.siteId],
      });
      void cache.invalidateQueries({ queryKey: ['workers', worker.siteId] });
      onClose();
    },
  });
  const field = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white p-3 text-sm';
  return (
    <form
      className="space-y-3 rounded-lg bg-slate-50 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!update.isPending && displayName.trim()) update.mutate();
      }}
    >
      <fieldset className="grid gap-3 sm:grid-cols-2" disabled={update.isPending}>
        <p className="text-sm font-semibold">Worker code: {original.externalId}</p>
        <label className="text-sm font-semibold">
          Edit full name
          <input
            className={field}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            maxLength={255}
          />
        </label>
        <label className="text-sm font-semibold sm:col-span-2">
          Worker status
          <select
            className={field}
            value={isActive ? 'active' : 'suspended'}
            onChange={(event) => setIsActive(event.target.value === 'active')}
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>
        <p className="text-sm text-slate-600 sm:col-span-2">
          Suspension prevents gate access and keeps the Worker’s history. Restoring a Worker still
          requires valid assignments and current entry conditions.
        </p>
        <button
          className="rounded-lg bg-[#F66B17] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          type="submit"
          disabled={update.isPending || !displayName.trim()}
        >
          {update.isPending ? 'Saving…' : 'Save Worker profile'}
        </button>
        <button
          className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold"
          type="button"
          onClick={onClose}
        >
          Cancel
        </button>
      </fieldset>
      {update.isError && (
        <p role="alert">
          {update.error.message}{' '}
          <button
            type="button"
            onClick={() => {
              void cache.invalidateQueries({ queryKey });
              onClose();
            }}
          >
            Reload Worker
          </button>
        </p>
      )}
    </form>
  );
}
