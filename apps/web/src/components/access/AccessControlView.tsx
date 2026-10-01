import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient, type LoginResponse } from '@smartsite/api-client';
import { IconCamera, IconKey, IconShield, IconUsers } from '../icons';
import { SecurityGateDeskView } from './SecurityGateDeskView';
import { WorkerEnrollmentView } from './WorkerEnrollmentView';
import { VisitorAccessView } from './VisitorAccessView';
import { WorkerGatePermissionsView } from './WorkerGatePermissionsView';

export type AccessSubTab =
  'gate-desk' | 'worker-enrollment' | 'gate-permissions' | 'visitor-passes';
const ACCESS_TABS = [
  { id: 'gate-desk', label: 'Security Gate Desk (MF02)', icon: IconCamera },
  { id: 'worker-enrollment', label: 'Worker Biometrics (MF01)', icon: IconUsers },
  { id: 'gate-permissions', label: 'Quyền vào cửa', icon: IconShield },
  { id: 'visitor-passes', label: 'Visitor Passes (MF04 QR)', icon: IconKey },
] as const;

export function AccessControlView({ apiUrl }: { apiUrl: string }) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const queryClient = useQueryClient();
  const activeSession = useRef<{ token: string; userId: string } | null>(null);
  const lifecycleGeneration = useRef(0);
  const [session, setSession] = useState<LoginResponse | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [requestedSiteId, setRequestedSiteId] = useState('');
  const [accessSubTab, setAccessSubTab] = useState<AccessSubTab>('gate-desk');
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
      if (
        !result.user.roleAssignments.some(
          (role) => role.role === 'ADMIN' && role.siteId === null,
        ) ||
        result.user.mustChangePassword
      ) {
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
  const token = session?.accessToken ?? '';
  const sessionScope = session?.user.id ?? '';
  const sites = useQuery({
    queryKey: ['access-control', apiUrl, sessionScope, 'sites'],
    queryFn: () => client.listSites(token, { limit: 100 }),
    enabled: !!token,
  });
  const siteId = sites.data?.items.some((site) => site.id === requestedSiteId)
    ? requestedSiteId
    : (sites.data?.items[0]?.id ?? '');
  const logout = () => {
    const current = activeSession.current;
    lifecycleGeneration.current += 1;
    activeSession.current = null;
    setSession(null);
    setRequestedSiteId('');
    setAccessSubTab('gate-desk');
    if (current) {
      removeSessionQueries(current.userId);
      void client.logout('WEB').catch(() => undefined);
    }
  };
  const submitLogin = (event: FormEvent) => {
    event.preventDefault();
    login.mutate();
  };
  if (!session)
    return (
      <div className="mx-auto max-w-md rounded-2xl border bg-white p-8">
        <h1 className="text-2xl font-bold">Site access & identity control</h1>
        <p className="mt-2 text-sm text-slate-600">
          Sign in as Admin to manage face enrollment and worker gate permissions.
        </p>
        <form onSubmit={submitLogin} className="mt-6 space-y-4">
          <label className="block">
            Username
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-2 block w-full rounded-lg border p-3"
            />
          </label>
          <label className="block">
            Password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 block w-full rounded-lg border p-3"
            />
          </label>
          {login.error && (
            <p role="alert" className="text-red-700">
              {login.error.message}
            </p>
          )}
          <button
            disabled={login.isPending}
            className="w-full rounded-lg bg-slate-950 p-3 font-semibold text-white disabled:opacity-50"
          >
            {login.isPending ? 'Signing in…' : 'Open access control'}
          </button>
        </form>
      </div>
    );
  return (
    <div className="mx-auto max-w-[1280px] space-y-6 pb-10 text-[#182232]">
      <header className="flex flex-wrap justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase text-orange-600">Identity & Site Access</p>
          <h1 className="mt-1 text-3xl font-bold">Site access & identity control</h1>
          <p className="mt-2 text-sm text-slate-600">
            Chọn công nhân và quản lý các cửa được phép vào. Backend quyết định quyền ra/vào.
          </p>
        </div>
        <button onClick={logout} className="rounded-lg border bg-white px-3 py-2">
          Sign out {session.user.displayName}
        </button>
      </header>
      <nav
        aria-label="Access control tabs"
        className="flex flex-wrap gap-1 border-b text-sm font-semibold"
      >
        {ACCESS_TABS.map((tab) => (
          <button
            type="button"
            key={tab.id}
            aria-current={accessSubTab === tab.id ? 'page' : undefined}
            onClick={() => setAccessSubTab(tab.id)}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 ${accessSubTab === tab.id ? 'border-orange-600 text-orange-600' : 'border-transparent text-slate-600'}`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </nav>
      {sites.isPending && <p>Đang tải công trình…</p>}
      {sites.error && (
        <p role="alert">
          {sites.error.message} <button onClick={() => void sites.refetch()}>Thử lại</button>
        </p>
      )}
      {!sites.isPending && !sites.error && !sites.data?.items.length && <p>Chưa có công trình.</p>}
      {siteId && (
        <>
          {accessSubTab !== 'gate-desk' && (
            <label className="block text-sm font-semibold">
              Công trình
              <select
                value={siteId}
                onChange={(event) => setRequestedSiteId(event.target.value)}
                className="ml-3 rounded-lg border p-2"
              >
                {sites.data?.items.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {accessSubTab === 'gate-desk' && (
            <SecurityGateDeskView
              key={`${sessionScope}:${siteId}`}
              apiUrl={apiUrl}
              token={token}
              sessionScope={sessionScope}
              selectedSiteId={siteId}
              sites={sites.data?.items ?? []}
              onSelectSite={setRequestedSiteId}
            />
          )}
          {accessSubTab === 'worker-enrollment' && (
            <WorkerEnrollmentView
              key={`${sessionScope}:${siteId}`}
              apiUrl={apiUrl}
              token={token}
              sessionScope={sessionScope}
              siteId={siteId}
            />
          )}
          {accessSubTab === 'gate-permissions' && (
            <WorkerGatePermissionsView
              key={`${sessionScope}:${siteId}`}
              apiUrl={apiUrl}
              token={token}
              sessionScope={sessionScope}
              siteId={siteId}
            />
          )}
          {accessSubTab === 'visitor-passes' && (
            <VisitorAccessView
              apiUrl={apiUrl}
              siteId={siteId}
              siteName={sites.data?.items.find((site) => site.id === siteId)?.name}
            />
          )}
        </>
      )}
    </div>
  );
}
