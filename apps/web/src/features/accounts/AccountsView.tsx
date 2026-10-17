import { translate as tr } from '../../i18n';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { useAuth, useCurrentUser, useLogout } from '../auth/auth-session';
import { loadAllPages } from '../../components/workforce/load-all-pages';
import {
  IconUsers,
  IconSearch,
  IconRefresh,
  IconKey,
  IconShield,
  IconCheck,
  IconX,
  IconAlertTriangle,
} from '../../components/icons';
import { AccountEditor, type AccountEditorAction } from './AccountEditor';
import { ACCOUNT_ROLES, accountButton, accountControl, accountErrorKey } from './account-utils';

const PAGE_SIZE = 20;

export function AccountsView({ apiUrl }: { apiUrl: string }) {
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  const profile = useCurrentUser(apiUrl);
  const logout = useLogout(apiUrl);
  const currentUser = profile.data;
  const isAdmin = Boolean(
    accessToken &&
    !profile.isError &&
    !profile.isPending &&
    currentUser?.isActive &&
    !currentUser.mustChangePassword &&
    currentUser.roleAssignments.some(({ role, siteId }) => role === 'ADMIN' && siteId === null),
  );
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const cache = useQueryClient();
  const key = ['account-management', apiUrl, currentUser?.id];

  const users = useQuery({
    queryKey: [...key, 'users'],
    queryFn: ({ signal }) =>
      loadAllPages((options) => client.listUsers(accessToken!, options), signal),
    enabled: isAdmin,
  });

  const sites = useQuery({
    queryKey: [...key, 'sites'],
    queryFn: ({ signal }) =>
      loadAllPages((options) => client.listSites(accessToken!, options), signal),
    enabled: isAdmin,
  });

  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [siteId, setSiteId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<AccountEditorAction | null>(null);
  const [saved, setSaved] = useState(false);

  const allAccounts = useMemo(() => users.data?.items ?? [], [users.data]);

  const activeCount = useMemo(() => allAccounts.filter((a) => a.isActive).length, [allAccounts]);
  const inactiveCount = useMemo(() => allAccounts.filter((a) => !a.isActive).length, [allAccounts]);
  const tempPasswordCount = useMemo(
    () => allAccounts.filter((a) => a.mustChangePassword).length,
    [allAccounts],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return allAccounts.filter(
      (account) =>
        (!query ||
          `${account.username} ${account.displayName}`.toLocaleLowerCase().includes(query)) &&
        ((!role && !siteId) ||
          account.roleAssignments.some(
            (assignment) =>
              (!role || assignment.role === role) && (!siteId || assignment.siteId === siteId),
          )) &&
        (!status ||
          (status === 'active'
            ? account.isActive
            : status === 'inactive'
              ? !account.isActive
              : account.mustChangePassword)),
    );
  }, [allAccounts, search, role, siteId, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const rows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const siteNames = new Map(
    (sites.data?.items ?? []).map((site) => [site.id, `${site.name} (${site.code})`]),
  );

  function open(action: AccountEditorAction) {
    setEditor(action);
    setSaved(false);
  }

  function refresh() {
    void users.refetch();
    void sites.refetch();
  }

  if (profile.isPending && accessToken) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-4">
        <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-5 text-xs text-slate-600 shadow-xs">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#F66B17] border-t-transparent" />
          <p role="status">{t('accounts.loading')}</p>
        </div>
      </div>
    );
  }

  if (profile.isError) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-4">
        <div
          role="alert"
          className="w-full max-w-md space-y-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-6 text-center shadow-xs"
        >
          <IconAlertTriangle className="mx-auto h-8 w-8 text-rose-600" />
          <p className="text-xs font-semibold text-rose-800">{t(accountErrorKey(profile.error))}</p>
          <button className={accountButton} onClick={() => void profile.refetch()}>
            {t('accounts.retry')}
          </button>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-4">
        <div
          role="alert"
          className="w-full max-w-md space-y-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-6 text-center shadow-xs"
        >
          <IconShield className="mx-auto h-8 w-8 text-amber-600" />
          <p className="text-xs font-semibold text-amber-900 leading-relaxed">
            {t('accounts.denied')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 text-[#2F3437]">
      {/* ── Top Header & Stats ────────────────────────────────────────────── */}
      <header className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#F66B17] border border-orange-200/60">
                <span className="h-1.5 w-1.5 rounded-full bg-[#F66B17]" />
                {tr('integrated_ui.identity_governance')}
              </span>
              <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                {tr('integrated_ui.admin_console')}
              </span>
            </div>
            <h1 className="text-xl font-extrabold tracking-tight text-[#111111]">
              {t('accounts.title')}
            </h1>
            <p className="text-xs text-[#6B6B6B]">{t('accounts.description')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              className={accountButton}
              onClick={refresh}
              disabled={users.isFetching || sites.isFetching}
            >
              <IconRefresh className="w-3.5 h-3.5" />
              <span>{t('accounts.refresh')}</span>
            </button>
            <button
              type="button"
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl bg-[#F66B17] hover:bg-[#E05A0A] text-white px-4 py-2 text-xs font-bold shadow-xs transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              disabled={!sites.isSuccess || Boolean(editor)}
              onClick={() => open({ mode: 'create' })}
            >
              <IconUsers className="w-4 h-4" />
              <span>{t('accounts.create')}</span>
            </button>
          </div>
        </div>

        {/* Quick Metric Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              id: '',
              label: t('accounts.allStatuses'),
              count: allAccounts.length,
              active: status === '',
              accent: 'text-slate-900',
              icon: IconUsers,
            },
            {
              id: 'active',
              label: t('accounts.active'),
              count: activeCount,
              active: status === 'active',
              accent: 'text-emerald-600',
              icon: IconCheck,
            },
            {
              id: 'inactive',
              label: t('accounts.inactive'),
              count: inactiveCount,
              active: status === 'inactive',
              accent: 'text-rose-600',
              icon: IconX,
            },
            {
              id: 'temporary',
              label: t('accounts.passwordRequired'),
              count: tempPasswordCount,
              active: status === 'temporary',
              accent: 'text-amber-600',
              icon: IconKey,
            },
          ].map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setStatus(m.id);
                  setPage(0);
                }}
                className={`rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                  m.active
                    ? 'border-[#071A2B] bg-slate-50/70 ring-2 ring-[#071A2B]/10 shadow-xs'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between text-slate-500">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {m.label}
                  </span>
                  <Icon className="w-4 h-4 text-slate-400" />
                </div>
                <p className={`mt-1.5 text-2xl font-black tracking-tight ${m.accent}`}>{m.count}</p>
              </button>
            );
          })}
        </div>
      </header>

      {/* Global Status Notifications */}
      {saved && (
        <div
          role="status"
          className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-semibold text-emerald-800"
        >
          <div className="flex items-center gap-2">
            <IconCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{t('accounts.saved')}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaved(false)}
            className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
          >
            <IconX className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {sites.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold text-amber-900"
        >
          <div className="flex items-center gap-2">
            <IconAlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{t('accounts.sitesError')}</span>
          </div>
          <button className={accountButton} onClick={() => void sites.refetch()}>
            {t('accounts.retry')}
          </button>
        </div>
      )}

      {/* Modal Editor */}
      {editor && (
        <AccountEditor
          key={editor.mode + ('account' in editor ? editor.account.id : '')}
          action={editor}
          client={client}
          token={accessToken!}
          actorId={currentUser!.id}
          sites={sites.data?.items ?? []}
          sitesReady={sites.isSuccess}
          onClose={() => setEditor(null)}
          onSaved={(selfRevoked) => {
            setEditor(null);
            if (selfRevoked) {
              logout.mutate();
              return;
            }
            setSaved(true);
            void cache.invalidateQueries({ queryKey: key });
            void cache.invalidateQueries({ queryKey: ['site-setup', apiUrl] });
            void cache.invalidateQueries({ queryKey: ['access-control', apiUrl] });
          }}
        />
      )}

      {/* ── Filters Section ─────────────────────────────────────────────── */}
      <section
        aria-label={t('accounts.filters')}
        className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs"
      >
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1.5 text-xs font-bold text-slate-700">
            <span>{t('accounts.search')}</span>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <IconSearch className="w-4 h-4" />
              </div>
              <input
                type="search"
                className={`${accountControl} pl-9`}
                value={search}
                placeholder={t('accounts.searchHint')}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <IconX className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </label>

          <label className="space-y-1.5 text-xs font-bold text-slate-700">
            <span>{t('accounts.roleFilter')}</span>
            <select
              aria-label={t('accounts.roleFilter')}
              className={accountControl}
              value={role}
              onChange={(event) => {
                setRole(event.target.value);
                setPage(0);
              }}
            >
              <option value="">{t('accounts.allRoles')}</option>
              {ACCOUNT_ROLES.map((value) => (
                <option key={value} value={value}>
                  {t(`accounts.role.${value}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5 text-xs font-bold text-slate-700">
            <span>{t('accounts.siteFilter')}</span>
            <select
              aria-label={t('accounts.siteFilter')}
              className={accountControl}
              value={siteId}
              disabled={!sites.isSuccess}
              onChange={(event) => {
                setSiteId(event.target.value);
                setPage(0);
              }}
            >
              <option value="">{t('accounts.allSites')}</option>
              {(sites.data?.items ?? []).map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} ({site.code})
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5 text-xs font-bold text-slate-700">
            <span>{t('accounts.statusFilter')}</span>
            <select
              aria-label={t('accounts.statusFilter')}
              className={accountControl}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            >
              <option value="">{t('accounts.allStatuses')}</option>
              <option value="active">{t('accounts.active')}</option>
              <option value="inactive">{t('accounts.inactive')}</option>
              <option value="temporary">{t('accounts.passwordRequired')}</option>
            </select>
          </label>
        </div>
      </section>

      {/* ── Table & Accounts List ────────────────────────────────────────── */}
      <section
        aria-label={t('accounts.list')}
        className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <h2 className="font-extrabold text-sm text-slate-900">{t('accounts.list')}</h2>
            <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-xs font-bold text-slate-700">
              {t('accounts.total', { count: filtered.length })}
            </span>
          </div>
          <span className="text-xs text-slate-500">
            {t('accounts.showingPage', { page: currentPage + 1, total: totalPages })}
          </span>
        </div>

        {users.isPending ? (
          <div className="flex items-center gap-2 p-8 text-xs text-slate-500">
            <div className="h-4 w-4 border-2 border-[#F66B17] border-t-transparent rounded-full animate-spin" />
            <p role="status">{t('accounts.loading')}</p>
          </div>
        ) : users.isError ? (
          <div role="alert" className="space-y-3 p-6">
            <p className="text-xs font-semibold text-rose-800">{t(accountErrorKey(users.error))}</p>
            <button className={accountButton} onClick={() => void users.refetch()}>
              {t('accounts.retry')}
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="p-12 text-center text-xs text-slate-400">{t('accounts.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">{t('accounts.list')}</caption>
              <thead className="bg-slate-50 text-[11px] font-bold text-slate-600 uppercase tracking-wider border-b border-slate-200">
                <tr>
                  {['identity', 'roles', 'statusFilter', 'passwordStatus', 'actions'].map(
                    (column) => (
                      <th
                        key={column}
                        scope="col"
                        className={`py-3 px-4 ${column === 'actions' ? 'text-right' : ''}`}
                      >
                        {t(`accounts.${column}`)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((account) => {
                  const initials = (account.displayName || account.username)
                    .slice(0, 2)
                    .toUpperCase();
                  return (
                    <tr
                      key={account.id}
                      className="hover:bg-slate-50/70 transition-colors align-top"
                    >
                      {/* Identity Column */}
                      <td className="max-w-64 py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 border border-slate-200/80 font-bold text-xs text-slate-700 shadow-2xs">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 text-xs truncate">
                              {account.displayName}
                            </p>
                            <p className="font-mono text-[11px] text-slate-500 truncate mt-0.5">
                              {account.username}
                            </p>
                            {account.id === currentUser!.id && (
                              <span className="mt-1 inline-block rounded-full bg-blue-50 border border-blue-200 px-2 py-0.2 text-[10px] font-bold text-blue-700">
                                {t('accounts.you')}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Roles Column */}
                      <td className="min-w-56 py-3.5 px-4">
                        <ul className="space-y-1.5">
                          {account.roleAssignments.map((assignment) => (
                            <li
                              key={`${assignment.role}:${assignment.siteId}`}
                              className="space-y-0.5"
                            >
                              <span
                                className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                  assignment.role === 'ADMIN'
                                    ? 'bg-slate-900 text-white'
                                    : assignment.role === 'SITE_MANAGER'
                                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                      : assignment.role === 'SAFETY_OFFICER'
                                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                        : assignment.role === 'SECURITY_OFFICER'
                                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                          : 'bg-slate-100 text-slate-700 border border-slate-200'
                                }`}
                              >
                                {t(`accounts.role.${assignment.role}`)}
                              </span>
                              <p className="text-[11px] text-slate-500 font-medium">
                                {assignment.siteId === null
                                  ? t('accounts.global')
                                  : (siteNames.get(assignment.siteId) ??
                                    t('accounts.unavailableSite', { id: assignment.siteId }))}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </td>

                      {/* Status Column */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                            account.isActive
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              account.isActive ? 'bg-emerald-600' : 'bg-slate-400'
                            }`}
                          />
                          {t(account.isActive ? 'accounts.active' : 'accounts.inactive')}
                        </span>
                      </td>

                      {/* Password Status Column */}
                      <td className="min-w-36 py-3.5 px-4">
                        <span
                          className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                            account.mustChangePassword
                              ? 'bg-amber-50 text-amber-800 border border-amber-200'
                              : 'bg-slate-50 text-slate-600 border border-slate-200/80'
                          }`}
                        >
                          {t(
                            account.mustChangePassword
                              ? 'accounts.passwordRequired'
                              : 'accounts.passwordReady',
                          )}
                        </span>
                      </td>

                      {/* Actions Column */}
                      <td className="min-w-56 py-3.5 px-4 text-right">
                        <div
                          role="group"
                          aria-label={t('accounts.actionsFor', { username: account.username })}
                          className="inline-flex flex-wrap items-center justify-end gap-1.5"
                        >
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs transition-all cursor-pointer disabled:opacity-50"
                            disabled={!sites.isSuccess || Boolean(editor)}
                            onClick={() => open({ mode: 'roles', account })}
                          >
                            <IconShield className="w-3.5 h-3.5 text-slate-400" />
                            <span>{t('accounts.editRoles')}</span>
                          </button>

                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs transition-all cursor-pointer disabled:opacity-50"
                            disabled={Boolean(editor)}
                            onClick={() => open({ mode: 'password', account })}
                          >
                            <IconKey className="w-3.5 h-3.5 text-slate-400" />
                            <span>{t('accounts.resetPassword')}</span>
                          </button>

                          <button
                            type="button"
                            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50 ${
                              account.isActive
                                ? 'border border-slate-200 text-slate-600 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50'
                                : 'border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                            }`}
                            disabled={account.id === currentUser!.id || Boolean(editor)}
                            title={
                              account.id === currentUser!.id
                                ? t('accounts.selfDisableHint')
                                : undefined
                            }
                            onClick={() => open({ mode: 'status', account })}
                          >
                            <span>
                              {t(account.isActive ? 'accounts.disable' : 'accounts.enable')}
                            </span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        <nav
          aria-label={t('accounts.pagination')}
          className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3.5"
        >
          <span className="text-xs text-slate-600 font-medium">
            {t('accounts.page', { page: currentPage + 1, total: totalPages })}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className={accountButton}
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              {t('accounts.previous')}
            </button>
            <button
              type="button"
              className={accountButton}
              disabled={currentPage + 1 >= totalPages}
              onClick={() => setPage(currentPage + 1)}
            >
              {t('accounts.next')}
            </button>
          </div>
        </nav>
      </section>
    </div>
  );
}
