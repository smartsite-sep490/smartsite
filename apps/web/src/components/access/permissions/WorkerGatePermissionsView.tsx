import type { SmartSiteManagementClient } from '@smartsite/api-client';
import { useManagementClient } from '../../../features/auth/auth-session';
import { localizedError } from '../../../i18n/messages';
import { localizedGateName } from '../../../i18n/labels';
import { translate as tr, uiLocale } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type WorkerResponse, type WorkerGatePermissionsResponse } from '@smartsite/contracts';
import { SITE_GATES } from '@smartsite/contracts/gate-permissions';
import {
  IconAlertTriangle,
  IconCheck,
  IconKey,
  IconRefresh,
  IconSearch,
  IconShield,
  IconUsers,
} from '../../icons';

export function GatePermissionEditor({
  snapshot,
  client,
  token,
  siteId,
  onSaved,
}: {
  snapshot: WorkerGatePermissionsResponse;
  client: SmartSiteManagementClient;
  token: string;
  siteId: string;
  onSaved: (value: WorkerGatePermissionsResponse) => void;
}) {
  useTranslation();

  const [gateIds, setGateIds] = useState(() => [
    ...new Set(
      snapshot.items
        .filter(
          (item) =>
            SITE_GATES.some((gate) => gate.id === item.gateId) &&
            new Date(item.validFrom).getTime() <= Date.now() &&
            (!item.validUntil || new Date(item.validUntil).getTime() > Date.now()),
        )
        .map((item) => item.gateId),
    ),
  ]);

  const save = useMutation({
    mutationFn: () =>
      client.setWorkerGatePermissions(token, siteId, snapshot.workerId, {
        gateIds,
        expectedPermissionIds: snapshot.items.map((item) => item.id),
      }),
    onSuccess: onSaved,
  });

  const selectAll = () => setGateIds(SITE_GATES.map((g) => g.id));
  const deselectAll = () => setGateIds([]);

  return (
    <div className="space-y-6">
      <fieldset disabled={save.isPending} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <legend className="flex items-center gap-2.5 font-bold text-slate-900 text-sm">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-100 text-[#F66B17]">
              <IconKey className="h-4 w-4" />
            </div>
            <span>{tr('common.authorized_gates')}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
              {tr('common.value_value_gates', {
                value1: gateIds.length,
                value2: SITE_GATES.length,
              })}
            </span>
          </legend>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={selectAll}
              className="font-bold text-[#F66B17] hover:text-[#e05b0d] hover:underline"
            >
              {tr('common.select_all')}
            </button>
            <span className="text-slate-300">•</span>
            <button
              type="button"
              onClick={deselectAll}
              className="font-medium text-slate-500 hover:text-slate-800 hover:underline"
            >
              {tr('common.deselect_all')}
            </button>
          </div>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-3">
          {SITE_GATES.map((gate) => {
            const isChecked = gateIds.includes(gate.id);
            return (
              <label
                key={gate.id}
                className={`relative flex cursor-pointer flex-col justify-between rounded-2xl border p-4 transition-all ${
                  isChecked
                    ? 'border-emerald-400 bg-emerald-50/60 shadow-xs ring-2 ring-emerald-500/20'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60 shadow-2xs'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(event) =>
                        setGateIds((previous) =>
                          event.target.checked
                            ? [...previous, gate.id]
                            : previous.filter((id) => id !== gate.id),
                        )
                      }
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div>
                      <span className="block text-sm font-bold text-slate-900">
                        {localizedGateName(gate.id)}
                      </span>
                      <span className="block font-mono text-[11px] text-slate-400">{gate.id}</span>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      isChecked
                        ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-500/20'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {isChecked ? tr('common.authorized') : tr('common.locked')}
                  </span>
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Warning & SOP Guidance */}
      <div className="space-y-2 rounded-2xl border border-amber-200/90 bg-amber-50/80 p-4 text-xs leading-relaxed text-amber-950 shadow-2xs">
        <div className="flex items-start gap-3">
          <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <p className="font-semibold">
              {tr(
                'worker_gate_permissions_view.saving_will_replace_current_permissions_with_selected_gates_effective_immediately',
              )}
            </p>
            <p className="text-amber-800/90">
              {tr(
                'worker_gate_permissions_view.gate_permissions_require_an_approved_worker_assignment_and_expire_with_it_worker_i',
              )}
            </p>
          </div>
        </div>
      </div>

      {save.error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700"
        >
          <IconAlertTriangle className="h-4 w-4 shrink-0" />
          <span>{localizedError(save.error.message)}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-1 border-t border-slate-100">
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate()}
          className="flex items-center gap-2 rounded-xl bg-[#F66B17] px-6 py-2.5 text-xs font-bold text-white shadow-md shadow-orange-500/15 transition-all hover:bg-[#e05b0d] hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
        >
          {save.isPending ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>{tr('common.saving_permissions')}</span>
            </>
          ) : (
            <>
              <IconCheck className="h-4 w-4" />
              <span>{tr('common.save_gate_permissions')}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function WorkerGatePermissionsView({
  apiUrl,
  token,
  siteId,
  sessionScope,
  readOnly = false,
}: {
  apiUrl: string;
  token: string;
  siteId: string;
  sessionScope: string;
  readOnly?: boolean;
}) {
  useTranslation();

  const client = useManagementClient(apiUrl);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [savedWorkerId, setSavedWorkerId] = useState('');

  const workers = useQuery({
    queryKey: ['access-control', apiUrl, sessionScope, siteId, 'gate-permission-workers'],
    enabled: !!siteId,
    queryFn: async () => {
      const items: WorkerResponse[] = [];
      let total: number;
      do {
        const page = await client.listWorkers(token, siteId, { offset: items.length, limit: 100 });
        items.push(...page.items);
        total = page.total;
        if (!page.items.length) break;
      } while (items.length < total);
      return items;
    },
  });

  const key = ['access-control', apiUrl, sessionScope, siteId, workerId, 'gate-permissions'];
  const permissions = useQuery({
    queryKey: key,
    queryFn: () => client.getWorkerGatePermissions(token, siteId, workerId),
    enabled: !!siteId && !!workerId,
  });

  const visible =
    workers.data?.filter((worker) =>
      `${worker.displayName} ${worker.externalId}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
    ) ?? [];

  const selectedWorker = workers.data?.find((w) => w.id === workerId);

  return (
    <section className="space-y-6 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs">
      {/* View Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-100 text-[#F66B17] ring-1 ring-orange-500/20">
            <IconShield className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              {tr('common.worker_gate_permissions')}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {tr(
                'worker_gate_permissions_view.configure_perimeter_access_gates_authorized_for_each_worker_at_this_construction_s',
              )}
            </p>
          </div>
        </div>

        {workers.data && (
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1 text-xs font-bold text-slate-700 shadow-2xs">
              {tr('common.value_site_workers', { value1: workers.data.length })}
            </span>
          </div>
        )}
      </div>

      {/* Main 2-Column Responsive Layout */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Worker Selector & Info (5 cols) */}
        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-2xl border border-slate-200/90 bg-slate-50/60 p-4 space-y-4 shadow-2xs">
            <div>
              <label
                htmlFor="gate-worker-search"
                className="block text-xs font-bold uppercase tracking-wider text-slate-700"
              >
                {tr('common.find_worker')}
              </label>
              <div className="relative mt-1.5">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="gate-worker-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/15 focus:outline-none transition-all"
                  placeholder={tr('worker_gate_permissions_view.worker_name_or_id_code')}
                />
              </div>
            </div>

            {workers.isPending && (
              <div className="flex items-center gap-2 py-2 text-xs text-slate-500">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#F66B17] border-t-transparent" />
                <span>{tr('common.loading_site_workers')}</span>
              </div>
            )}

            {workers.error && (
              <div
                role="alert"
                className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"
              >
                <span>{localizedError(workers.error.message)}</span>
                <button
                  type="button"
                  onClick={() => void workers.refetch()}
                  className="font-bold underline hover:text-red-900"
                >
                  {tr('common.retry')}
                </button>
              </div>
            )}

            <div>
              <label
                htmlFor="gate-worker-select"
                className="block text-xs font-bold uppercase tracking-wider text-slate-700"
              >
                {tr('common.select_worker')}
              </label>
              <select
                id="gate-worker-select"
                value={workerId}
                disabled={workers.isPending}
                onChange={(event) => {
                  setWorkerId(event.target.value);
                  setSavedWorkerId('');
                }}
                className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm font-semibold text-slate-800 focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/15 focus:outline-none disabled:bg-slate-100 transition-all"
              >
                <option value="">
                  {tr('worker_gate_permissions_view.select_a_worker_from_this_site')}
                </option>
                {visible.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.displayName} ({worker.externalId})
                    {!worker.userId ? tr('common.unlinked_account') : ''}
                    {!worker.isActive ? tr('common.inactive') : ''}
                  </option>
                ))}
              </select>
            </div>

            {!workers.isPending && !visible.length && (
              <p className="text-center text-xs text-slate-500 py-2">
                {tr('worker_gate_permissions_view.no_matching_workers_found')}
              </p>
            )}
          </div>

          {/* Selected Worker Info Card */}
          {selectedWorker && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-slate-900 to-slate-800 text-sm font-bold text-white shadow-xs">
                  {selectedWorker.displayName.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-sm font-bold text-slate-900">
                    {selectedWorker.displayName}
                  </h4>
                  <p className="font-mono text-xs text-slate-500">
                    {tr('common.id_value', { value1: selectedWorker.externalId })}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs">
                <span
                  className={`rounded-full px-2.5 py-0.5 font-bold ${
                    selectedWorker.isActive
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {selectedWorker.isActive
                    ? tr('common.active_worker')
                    : tr('common.inactive_worker')}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 font-semibold ${
                    selectedWorker.userId
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {selectedWorker.userId
                    ? tr('common.account_linked')
                    : tr('common.no_account_linked')}
                </span>
              </div>

              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setSavedWorkerId('');
                    void permissions.refetch();
                  }}
                  className="flex items-center gap-1.5 text-xs font-bold text-[#F66B17] hover:text-[#e05b0d] hover:underline"
                >
                  <IconRefresh className="h-3.5 w-3.5" />
                  <span>{tr('common.reload_current_permissions')}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Gate Permissions Editor (7 cols) */}
        <div className="lg:col-span-7">
          {!workerId ? (
            <div className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-slate-400">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <IconUsers className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-700">
                {tr('common.no_worker_selected')}
              </h3>
              <p className="mt-1 max-w-sm text-xs text-slate-500">
                {tr(
                  'worker_gate_permissions_view.select_a_worker_from_the_left_list_to_view_and_configure_their_authorized_gate_cle',
                )}
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-4">
              {permissions.isPending && (
                <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#F66B17] border-t-transparent" />
                  <span>{tr('common.loading_gate_permissions')}</span>
                </div>
              )}

              {permissions.error && (
                <div
                  role="alert"
                  className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700"
                >
                  <span>{localizedError(permissions.error.message)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSavedWorkerId('');
                      void permissions.refetch();
                    }}
                    className="font-bold underline hover:text-red-900"
                  >
                    {tr('common.reload_permissions')}
                  </button>
                </div>
              )}

              {savedWorkerId === workerId && workerId && (
                <div
                  role="status"
                  className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-bold text-emerald-800 shadow-2xs"
                >
                  <IconCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>
                    {tr(
                      'worker_gate_permissions_view.gate_permissions_successfully_saved_to_database',
                    )}
                  </span>
                </div>
              )}

              {permissions.data &&
                !permissions.isFetching &&
                (readOnly ? (
                  <div className="space-y-3">
                    <p className="font-semibold">{tr('gatePerm.readOnlyTitle')}</p>
                    {permissions.data.items.map((item) => (
                      <p key={item.id}>
                        {localizedGateName(item.gateId)} ·{' '}
                        {new Date(item.validFrom).toLocaleString(uiLocale())} —{' '}
                        {item.validUntil
                          ? new Date(item.validUntil).toLocaleString(uiLocale())
                          : tr('gatePerm.noExpiry')}
                      </p>
                    ))}
                    {!permissions.data.items.length && <p>{tr('gatePerm.noGrants')}</p>}
                  </div>
                ) : (
                  <GatePermissionEditor
                    key={`${workerId}:${permissions.data.items.map((item) => item.id).join(',')}`}
                    snapshot={permissions.data}
                    client={client}
                    token={token}
                    siteId={siteId}
                    onSaved={(value) => {
                      queryClient.setQueryData(key, value);
                      setSavedWorkerId(value.workerId);
                    }}
                  />
                ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
