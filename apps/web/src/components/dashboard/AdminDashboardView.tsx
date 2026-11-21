import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth, useCurrentUser, useManagementClient } from '../../features/auth/auth-session';
import { loadAllPages } from '../workforce/load-all-pages';
import { getSiteManagers, getReadySiteManagers } from '../workforce/utils/site-setup-helpers';
import type { ActiveTab } from '../layout/AppLayout';
import type { DashboardNavigateContext } from './DashboardView';

interface Props {
  apiUrl: string;
  onNavigate: (tab: ActiveTab, context?: DashboardNavigateContext) => void;
}

export function AdminDashboardView({ apiUrl, onNavigate }: Props) {
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  const { data: actor } = useCurrentUser(apiUrl);
  const client = useManagementClient(apiUrl);
  const key = ['account-management', apiUrl, actor?.id];
  const enabled = Boolean(
    accessToken &&
    actor?.isActive &&
    !actor.mustChangePassword &&
    actor.roleAssignments.some((r) => r.role === 'ADMIN' && r.siteId === null),
  );
  const users = useQuery({
    queryKey: [...key, 'users'],
    queryFn: ({ signal }) => loadAllPages((page) => client.listUsers(accessToken!, page), signal),
    enabled,
  });
  const sites = useQuery({
    queryKey: [...key, 'sites'],
    queryFn: ({ signal }) => loadAllPages((page) => client.listSites(accessToken!, page), signal),
    enabled,
  });
  function refresh() {
    void users.refetch();
    void sites.refetch();
  }
  if (users.isError || sites.isError)
    return (
      <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-5 space-y-3">
        <p>{t('admin_dashboard.unavailable')}</p>
        <button type="button" onClick={refresh} className="underline">
          {t('accounts.retry')}
        </button>
      </div>
    );
  if (users.isPending || sites.isPending) return <p role="status">{t('accounts.loading')}</p>;
  const accounts = users.data.items;
  const pendingSites = sites.data.items.filter(
    (site) => !getReadySiteManagers(accounts, site.id).length,
  );
  const metrics = [
    ['admin_dashboard.accounts', accounts.length],
    ['admin_dashboard.disabled', accounts.filter((user) => !user.isActive).length],
    ['admin_dashboard.sites', sites.data.items.length],
    ['admin_dashboard.needs_manager', pendingSites.length],
  ] as const;
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('admin_dashboard.title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('admin_dashboard.description')}</p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={users.isFetching || sites.isFetching}
          className="min-h-10 rounded-xl border bg-white px-4 text-sm disabled:opacity-50"
        >
          {t('admin_dashboard.refresh')}
        </button>
      </header>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div key={label} className="rounded-2xl border bg-white p-5">
            <dt className="text-sm text-slate-600">{t(label)}</dt>
            <dd className="mt-2 text-3xl font-bold text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
      <nav aria-label={t('admin_dashboard.shortcuts')} className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => onNavigate('accounts')}
          className="min-h-10 rounded-xl bg-[#041D2E] px-4 text-sm font-semibold text-white"
        >
          {t('accounts.title')}
        </button>
        <button
          type="button"
          onClick={() => onNavigate('site-setup')}
          className="min-h-10 rounded-xl border bg-white px-4 text-sm font-semibold"
        >
          {t('admin_dashboard.manage_sites')}
        </button>
      </nav>
      <section className="rounded-2xl border bg-white p-5">
        <h2 className="text-lg font-bold text-slate-900">{t('admin_dashboard.needs_manager')}</h2>
        {pendingSites.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            {t(sites.data.items.length ? 'admin_dashboard.all_ready' : 'admin_dashboard.no_sites')}
          </p>
        ) : (
          <ul className="mt-3 divide-y">
            {pendingSites.map((site) => {
              const managers = getSiteManagers(accounts, site.id);
              const status = !managers.length
                ? 'unassigned'
                : managers.some((m) => !m.isActive)
                  ? 'manager_disabled'
                  : 'password_required';
              return (
                <li
                  key={site.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div className="min-w-0 break-words">
                    <p className="font-semibold">{site.name}</p>
                    <p className="text-sm text-slate-500">{site.code}</p>
                    <p className="mt-1 text-sm text-amber-800">{t(`admin_dashboard.${status}`)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('site-setup', { siteId: site.id })}
                    className="min-h-10 rounded-xl border px-4 text-sm font-semibold"
                  >
                    {t('admin_dashboard.open_site')}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
