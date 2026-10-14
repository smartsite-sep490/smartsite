import { localizedError } from '../../../i18n/messages';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient, type WorkerResponse } from '@smartsite/api-client';
import { WORKER_DEFAULT_TEMPORARY_PASSWORD } from '@smartsite/contracts/management';
import { useAuth, useCurrentUser } from '../../../features/auth/auth-session';
import { WorkerEnrollmentView } from '../../access/enrollment/WorkerEnrollmentView';
import { loadAllPages } from '../load-all-pages';
import {
  IconAlertTriangle,
  IconBuilding2,
  IconCheck,
  IconRefresh,
  IconSearch,
  IconShield,
  IconUser,
  IconUsers,
} from '../../icons';

export function WorkerOnboardingView({ apiUrl }: { apiUrl: string }) {
  useTranslation();

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

  if (profile.isPending) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-500 gap-3">
        <IconRefresh className="w-5 h-5 animate-spin text-[#F66B17]" />
        <p role="status" className="text-sm font-semibold">
          {tr('common.loading_your_account_8fa5b7')}
        </p>
      </div>
    );
  }

  if (profile.isError) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 flex flex-wrap items-center justify-between gap-4 shadow-xs"
      >
        <div className="flex items-center gap-3">
          <IconAlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <span className="font-semibold">{tr('app.could_not_load_your_account')}</span>
        </div>
        <button
          onClick={() => void profile.refetch()}
          className="px-4 py-2 rounded-xl bg-white border border-red-200 text-red-700 font-bold hover:bg-red-100 transition-colors shadow-2xs"
        >
          {tr('common.retry')}
        </button>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 flex items-start gap-3 shadow-xs"
      >
        <IconShield className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <p className="font-medium leading-relaxed">
          {tr(
            'worker_onboarding_view.worker_onboarding_requires_a_contractor_representative_role_for_this_site_and_a_co',
          )}
        </p>
      </div>
    );
  }

  if (sites.isPending) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-500 gap-3">
        <IconRefresh className="w-5 h-5 animate-spin text-[#F66B17]" />
        <p role="status" className="text-sm font-semibold">
          {tr('common.loading_your_sites')}
        </p>
      </div>
    );
  }

  if (sites.isError) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 flex flex-wrap items-center justify-between gap-4 shadow-xs"
      >
        <div className="flex items-center gap-3">
          <IconAlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <span className="font-semibold">{tr('worker_onboarding_view.could_not_load_sites')}</span>
        </div>
        <button
          onClick={() => void sites.refetch()}
          className="px-4 py-2 rounded-xl bg-white border border-red-200 text-red-700 font-bold hover:bg-red-100 transition-colors shadow-2xs"
        >
          {tr('common.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-12">
      {/* Hero Header */}
      <header className="rounded-2xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xs relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-orange-50 border border-orange-200/80 text-[11px] font-black uppercase tracking-wider text-[#F66B17]">
              <span>MF01</span>
              <span>·</span>
              <span>{tr('common.worker_onboarding')}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-[#041D2E] tracking-tight">
              {tr('common.worker_onboarding')}
            </h1>
            <p className="text-sm text-slate-600 max-w-2xl leading-relaxed">
              {tr(
                'worker_onboarding_view.create_accounts_and_manage_workers_belonging_to_your_contractor_at_this_site_regis',
              )}
            </p>
          </div>

          {/* Site Selector Card */}
          {choices.length > 0 && (
            <div className="shrink-0 w-full sm:w-72 rounded-xl border border-slate-200/90 bg-slate-50/70 p-3.5 space-y-1.5 shadow-2xs">
              <label
                htmlFor="worker-onboarding-site-select"
                className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500"
              >
                <IconBuilding2 className="w-3.5 h-3.5 text-slate-400" />
                <span>{tr('common.site_fa7955')}</span>
              </label>
              <select
                id="worker-onboarding-site-select"
                aria-label={tr('common.site_fa7955')}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 shadow-2xs focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/15 focus:outline-none transition-all cursor-pointer"
                value={siteId}
                onChange={(e) => setSelectedSiteId(e.target.value)}
              >
                {choices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </header>

      {!choices.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 space-y-2 shadow-xs">
          <IconBuilding2 className="w-8 h-8 text-slate-400 mx-auto" />
          <p role="status" className="text-sm font-semibold">
            {tr('worker_onboarding_view.no_assigned_sites_are_available')}
          </p>
        </div>
      ) : (
        <>
          {/* Worker Account Provisioning Form & Roster */}
          <WorkerAccountForm
            key={`${apiUrl}:${user!.id}:${siteId}`}
            apiUrl={apiUrl}
            token={accessToken!}
            siteId={siteId}
            sessionScope={user!.id}
          />

          {/* Worker Face Biometrics & Consent Enrollment */}
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
  useTranslation();

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

  const field =
    'mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-sm font-semibold text-slate-800 placeholder:text-slate-400 focus:border-[#F66B17] focus:bg-white focus:ring-2 focus:ring-[#F66B17]/15 focus:outline-none transition-all';

  if (options.isPending) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-xs flex items-center justify-center gap-3">
        <IconRefresh className="w-5 h-5 animate-spin text-[#F66B17]" />
        <p role="status" className="text-sm font-semibold">
          {tr('common.loading_your_contractors')}
        </p>
      </div>
    );
  }

  if (options.isError) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 flex flex-wrap items-center justify-between gap-4 shadow-xs"
      >
        <div className="flex items-center gap-3">
          <IconAlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <span className="font-semibold">
            {tr('worker_onboarding_view.could_not_load_your_contractors')}
          </span>
        </div>
        <button
          onClick={() => void options.refetch()}
          className="px-4 py-2 rounded-xl bg-white border border-red-200 text-red-700 font-bold hover:bg-red-100 transition-colors shadow-2xs"
        >
          {tr('common.retry')}
        </button>
      </div>
    );
  }

  if (!contractors.length) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 shadow-xs flex items-start gap-3">
        <IconAlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <p role="status" className="font-medium leading-relaxed">
          {tr(
            'worker_onboarding_view.no_active_contractor_participation_is_assigned_to_you_at_this_site_contact_your_si',
          )}
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-6 rounded-2xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xs">
      {/* Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-[#F66B17] border border-orange-200/70 shadow-2xs">
            <IconUser className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-[#041D2E]">
              {tr('common.create_worker_account')}
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              {tr(
                'worker_onboarding_view.the_account_receives_the_worker_role_at_this_site_and_can_sign_in_immediately_pass',
              )}{' '}
              <strong className="font-mono text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                {WORKER_DEFAULT_TEMPORARY_PASSWORD}
              </strong>
              .
            </p>
          </div>
        </div>
      </div>

      {/* Creation Form */}
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!create.isPending && selected) create.mutate();
        }}
      >
        <fieldset disabled={create.isPending} className="contents">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
            {tr('common.contractor')}
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

          <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
            {tr('common.full_name')}
            <input
              className={field}
              required
              maxLength={255}
              autoComplete="name"
              placeholder={tr('common.full_name')}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>

          <label className="text-xs font-bold uppercase tracking-wider text-slate-700 sm:col-span-2">
            {tr('common.username')}
            <input
              className={field}
              required
              minLength={3}
              maxLength={64}
              pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,63}"
              autoComplete="off"
              placeholder={tr('common.username')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>

          <button
            type="submit"
            className="rounded-xl bg-[#F66B17] hover:bg-[#E05A0B] px-6 py-3 text-sm font-bold text-white shadow-xs hover:shadow-sm transition-all sm:col-span-2 flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!selected || !displayName.trim() || !username.trim() || create.isPending}
          >
            {create.isPending ? (
              <>
                <IconRefresh className="w-4 h-4 animate-spin" />
                <span>{tr('common.creating')}</span>
              </>
            ) : (
              <span>{tr('common.create_worker_account')}</span>
            )}
          </button>
        </fieldset>
      </form>

      {/* Error Banner */}
      {create.isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <IconAlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <p role="alert" className="text-xs font-bold text-red-800">
              {localizedError(create.error.message)}
            </p>
          </div>
        </div>
      )}

      {/* Success Notification Banner */}
      {create.isSuccess && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 p-4 shadow-2xs">
          <div className="flex items-start gap-3">
            <div className="h-6 w-6 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0 mt-0.5">
              <IconCheck className="w-3.5 h-3.5" />
            </div>
            <p role="status" className="text-xs leading-relaxed text-emerald-900 font-medium">
              {tr('common.account')} {create.data.account.username}{' '}
              {tr(
                'worker_onboarding_view.and_worker_profile_created_give_the_worker_their_temporary_password',
              )}{' '}
              <strong className="font-mono bg-emerald-100/90 px-1.5 py-0.5 rounded text-emerald-950 border border-emerald-300/80">
                {WORKER_DEFAULT_TEMPORARY_PASSWORD}
              </strong>
              {tr('worker_onboarding_view.then_register_their_face_below_worker_code')}{' '}
              <strong className="font-mono bg-emerald-100/90 px-1.5 py-0.5 rounded text-emerald-950 border border-emerald-300/80">
                {create.data.worker.externalId}
              </strong>
              .
            </p>
          </div>
        </div>
      )}

      {/* Roster of Workers */}
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
  useTranslation();

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
    <div className="space-y-4 border-t border-slate-100 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-bold text-[#041D2E]">
              {tr('common.your_contractor_s_workers')}
            </h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600 font-mono">
              {ownedWorkers.length}
            </span>
          </div>
          <p className="text-xs text-slate-500 font-medium">
            {tr(
              'worker_onboarding_view.workers_belonging_to_the_selected_contractor_at_this_site_including_those_created',
            )}
          </p>
        </div>
      </div>

      {workers.isPending ? (
        <div className="p-8 text-center text-slate-500 flex items-center justify-center gap-3">
          <IconRefresh className="w-4 h-4 animate-spin text-[#F66B17]" />
          <p role="status" className="text-xs font-semibold">
            {tr('common.loading_workers_52a28c')}
          </p>
        </div>
      ) : workers.isError ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-800 flex items-center justify-between gap-3"
        >
          <span>{tr('worker_onboarding_view.could_not_load_workers')}</span>
          <button
            onClick={() => void workers.refetch()}
            className="px-3 py-1 rounded-lg bg-white border border-red-200 text-red-700 font-bold hover:bg-red-100"
          >
            {tr('common.retry')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Search Box */}
          <div className="relative">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              {tr('worker_onboarding_view.search_workers_by_code_or_name')}
              <div className="relative mt-1.5">
                <IconSearch className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/70 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#F66B17] focus:bg-white focus:ring-2 focus:ring-[#F66B17]/15 focus:outline-none transition-all"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  type="search"
                  placeholder={tr('worker_onboarding_view.search_workers_by_code_or_name')}
                />
              </div>
            </label>
          </div>

          {!ownedWorkers.length ? (
            <div className="p-8 rounded-xl border border-slate-200/80 bg-slate-50/50 text-center text-slate-500 space-y-1.5">
              <IconUsers className="w-6 h-6 text-slate-400 mx-auto" />
              <p role="status" className="text-xs font-semibold">
                {tr('worker_onboarding_view.no_workers_belong_to_this_contractor_at_this_site_yet')}
              </p>
            </div>
          ) : !filtered.length ? (
            <div className="p-8 rounded-xl border border-slate-200/80 bg-slate-50/50 text-center text-slate-500">
              <p role="status" className="text-xs font-semibold">
                {tr('worker_onboarding_view.no_workers_match_your_search')}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {filtered.map((worker) => (
                <li
                  key={worker.id}
                  className="p-4 rounded-xl border border-slate-200/80 bg-white hover:border-slate-300 hover:shadow-2xs transition-all space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-sm text-[#041D2E] shrink-0">
                        {worker.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 break-words">
                        <p className="font-bold text-sm text-slate-900">{worker.displayName}</p>
                        <span className="font-mono text-xs font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/80">
                          {worker.externalId}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                          worker.isActive
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${worker.isActive ? 'bg-emerald-500' : 'bg-amber-500'}`}
                        />
                        {worker.isActive ? tr('common.active') : tr('common.suspended')}
                      </span>

                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                          worker.userId
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-slate-50 text-slate-500 border-slate-200'
                        }`}
                      >
                        {worker.userId
                          ? tr('common.login_account_linked')
                          : tr('worker_onboarding_view.no_login_account_linked')}
                      </span>

                      <button
                        className="rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 px-3.5 py-1.5 text-xs font-bold transition-all shadow-2xs hover:shadow-xs cursor-pointer ml-1"
                        onClick={() => setEditingId(worker.id)}
                        aria-label={tr('common.manage_value', { value1: worker.displayName })}
                      >
                        {tr('common.manage')}
                      </button>
                    </div>
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
        </div>
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
  useTranslation();

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

  const field =
    'mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/15 focus:outline-none transition-all';

  return (
    <form
      className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/90 p-4 sm:p-5 shadow-2xs"
      onSubmit={(event) => {
        event.preventDefault();
        if (!update.isPending && displayName.trim()) update.mutate();
      }}
    >
      <fieldset className="grid gap-3 sm:grid-cols-2" disabled={update.isPending}>
        <div className="sm:col-span-2 flex items-center justify-between border-b border-slate-200/70 pb-2">
          <p className="text-xs font-bold text-slate-700">
            {tr('common.worker_code_value', { value1: original.externalId })}
          </p>
        </div>

        <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
          {tr('common.edit_full_name')}
          <input
            className={field}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            maxLength={255}
          />
        </label>

        <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
          {tr('common.worker_status')}
          <select
            className={field}
            value={isActive ? 'active' : 'suspended'}
            onChange={(event) => setIsActive(event.target.value === 'active')}
          >
            <option value="active">{tr('common.active')}</option>
            <option value="suspended">{tr('common.suspended')}</option>
          </select>
        </label>

        <p className="text-xs text-slate-500 sm:col-span-2 leading-relaxed">
          {tr(
            'worker_onboarding_view.suspension_prevents_gate_access_and_keeps_the_worker_s_history_restoring_a_worker',
          )}
        </p>

        <div className="sm:col-span-2 flex flex-wrap gap-2 pt-1">
          <button
            className="rounded-xl bg-[#F66B17] hover:bg-[#E05A0B] px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:shadow-sm transition-all cursor-pointer disabled:opacity-50"
            type="submit"
            disabled={update.isPending || !displayName.trim()}
          >
            {update.isPending ? tr('common.saving') : tr('common.save_worker_profile')}
          </button>
          <button
            className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-4 py-2.5 text-xs font-bold transition-all shadow-2xs cursor-pointer"
            type="button"
            onClick={onClose}
          >
            {tr('common.cancel')}
          </button>
        </div>
      </fieldset>

      {update.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex items-center justify-between gap-3 text-xs text-red-800">
          <p role="alert" className="font-semibold">
            {localizedError(update.error.message)}
          </p>
          <button
            type="button"
            className="px-2.5 py-1 rounded bg-white border border-red-200 text-red-700 font-bold hover:bg-red-100"
            onClick={() => {
              void cache.invalidateQueries({ queryKey });
              onClose();
            }}
          >
            {tr('common.reload_worker')}
          </button>
        </div>
      )}
    </form>
  );
}
