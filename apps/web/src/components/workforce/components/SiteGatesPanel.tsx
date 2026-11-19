import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import type { GateResponse } from '@smartsite/contracts';
import { useTranslation } from 'react-i18next';
import { useGateCatalog } from '../../access/useGateCatalog';
import { GateCatalogNotice } from '../../access/GateCatalogNotice';
import { userErrorMessage } from '../../../i18n/messages';
import { IconBuilding2, IconCheckCircle2, IconLoader, IconPlus } from '../../icons';

export function SiteGatesPanel({
  client,
  apiUrl,
  token,
  siteId,
  sessionScope,
  canManage,
}: {
  client: SmartSiteManagementClient;
  apiUrl: string;
  token: string;
  siteId: string;
  sessionScope: string;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const nameInputId = useId();
  const query = useGateCatalog(client, apiUrl, sessionScope, token, siteId);
  const cache = useQueryClient();
  const [editing, setEditing] = useState<GateResponse | null>(null);
  const [name, setName] = useState('');
  const refresh = () => cache.invalidateQueries({ queryKey: ['site-gates', apiUrl] });
  const create = useMutation({
    mutationFn: () => client.createSiteGate(token, siteId, { name: name.trim() }),
    onSuccess: async () => {
      setName('');
      await refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({
      gate,
      input,
    }: {
      gate: GateResponse;
      input: { name?: string; status?: 'ACTIVE' | 'INACTIVE' };
    }) => client.updateSiteGate(token, siteId, gate.id, input),
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim() && !create.isPending) create.mutate();
  };
  const field =
    'min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/20 disabled:bg-slate-100';
  const secondary =
    'inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F66B17] disabled:cursor-not-allowed disabled:opacity-50';
  const empty = query.isSuccess && query.data.items.length === 0;
  return (
    <section
      aria-label={t('gateSetup.title')}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[#F66B17]">
            <IconBuilding2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-[#041D2E]">{t('gateSetup.title')}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">{t('gateSetup.description')}</p>
          </div>
        </div>
        {query.data && (
          <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-slate-600">
            {query.data.total}
          </span>
        )}
      </div>
      {canManage && (
        <form onSubmit={submit} className="space-y-3 border-b border-slate-100 bg-slate-50/70 p-5">
          <div>
            <label htmlFor={nameInputId} className="text-sm font-semibold text-slate-800">
              {t('gateSetup.name')}
            </label>
            <p id={`${nameInputId}-hint`} className="mt-1 text-xs leading-5 text-slate-500">
              {t('gateSetup.autoCode')}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id={nameInputId}
              className={field}
              aria-describedby={`${nameInputId}-hint`}
              placeholder={t('gateSetup.namePlaceholder')}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                create.reset();
              }}
              disabled={create.isPending}
              required
              maxLength={100}
            />
            <button
              type="submit"
              disabled={create.isPending || query.isPending || !!query.error || !name.trim()}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#F66B17] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#E05A0A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F66B17] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {create.isPending ? (
                <IconLoader className="h-4 w-4 animate-spin" />
              ) : (
                <IconPlus className="h-4 w-4" />
              )}
              {t(create.isPending ? 'gateSetup.creating' : 'gateSetup.create')}
            </button>
          </div>
        </form>
      )}
      <div className="space-y-3 p-5">
        {(create.error || update.error) && (
          <p
            role="alert"
            className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          >
            {userErrorMessage(create.error ?? update.error!)}
          </p>
        )}
        {create.isSuccess && (
          <p
            role="status"
            className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800"
          >
            <IconCheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              {t('gateSetup.created', { name: create.data.name, code: create.data.code })}
            </span>
          </p>
        )}
        {empty && canManage ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center">
            <p className="text-sm font-semibold text-slate-700">{t('gateSetup.emptyTitle')}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{t('gateSetup.emptyManager')}</p>
          </div>
        ) : (
          <GateCatalogNotice query={query} />
        )}
        {query.data?.items.map((gate) => (
          <div key={gate.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold text-[#041D2E]">{gate.name}</p>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${gate.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${gate.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-slate-400'}`}
                />
                {t('gateSetup.' + gate.status.toLowerCase())}
              </span>
            </div>
            <code className="mt-2 inline-block max-w-full select-all break-all rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
              {gate.code}
            </code>
            {canManage && editing?.id !== gate.id && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  className={secondary}
                  disabled={update.isPending}
                  onClick={() => {
                    update.reset();
                    setEditing(gate);
                  }}
                >
                  {t('gateSetup.rename')}
                </button>
                <button
                  type="button"
                  className={secondary}
                  disabled={update.isPending}
                  onClick={() =>
                    update.mutate({
                      gate,
                      input: { status: gate.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
                    })
                  }
                >
                  {t(gate.status === 'ACTIVE' ? 'gateSetup.deactivate' : 'gateSetup.activate')}
                </button>
              </div>
            )}
            {canManage && editing?.id === gate.id && (
              <form
                className="mt-3 space-y-3 border-t border-slate-100 pt-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = String(new FormData(event.currentTarget).get('name') ?? '').trim();
                  if (value && !update.isPending) update.mutate({ gate, input: { name: value } });
                }}
              >
                <label className="block text-xs font-semibold text-slate-700">
                  {t('gateSetup.editName')}
                  <input
                    className={`${field} mt-2`}
                    name="name"
                    defaultValue={gate.name}
                    required
                    maxLength={100}
                    disabled={update.isPending}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className={secondary} disabled={update.isPending}>
                    {t(update.isPending ? 'gateSetup.saving' : 'gateSetup.save')}
                  </button>
                  <button
                    type="button"
                    className={secondary}
                    disabled={update.isPending}
                    onClick={() => {
                      setEditing(null);
                      update.reset();
                    }}
                  >
                    {t('gateSetup.cancel')}
                  </button>
                </div>
              </form>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
