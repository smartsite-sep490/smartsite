import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import type { GateResponse } from '@smartsite/contracts';
import { useTranslation } from 'react-i18next';
import { useGateCatalog } from '../../access/useGateCatalog';
import { GateCatalogNotice } from '../../access/GateCatalogNotice';
import { userErrorMessage } from '../../../i18n/messages';
import {
  IconBuilding2,
  IconCheckCircle2,
  IconChevronDown,
  IconLoader,
  IconPlus,
} from '../../icons';
import { Button } from '../../ui';

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
  const createFormId = useId();
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
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

  const empty = query.isSuccess && query.data.items.length === 0;

  return (
    <section
      aria-label={t('gateSetup.title')}
      className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs transition-all"
    >
      {/* Compact Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-3.5 border-b border-slate-100">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 border border-orange-200/60 text-[#F66B17] shadow-2xs">
            <IconBuilding2 className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-[#041D2E] tracking-tight">{t('gateSetup.title')}</h3>
            {query.data && (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold tabular-nums text-slate-600">
                {query.data.total}
              </span>
            )}
            <span className="hidden sm:inline text-xs text-slate-400 font-normal">
              · {t('gateSetup.description')}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 ml-auto">
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs font-semibold px-3"
              aria-expanded={isCreateOpen}
              aria-controls={createFormId}
              disabled={create.isPending}
              onClick={() => {
                if (isCollapsed) setIsCollapsed(false);
                setCreateOpen((open) => !open);
              }}
              leftIcon={!isCreateOpen ? <IconPlus className="h-3.5 w-3.5" /> : undefined}
              rightIcon={
                <IconChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${isCreateOpen ? 'rotate-180' : ''}`}
                />
              }
            >
              {t(isCreateOpen ? 'gateSetup.hideCreate' : 'gateSetup.create')}
            </Button>
          )}

          {/* Collapse / Expand Toggle Button */}
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? t('common.expand') : t('common.collapse')}
            aria-label={isCollapsed ? t('common.expand') : t('common.collapse')}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-all cursor-pointer shadow-2xs"
          >
            <IconChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
            />
          </button>
        </div>
      </div>

      {/* Create Gate Form (Compact inline) */}
      {canManage && isCreateOpen && (
        <form
          id={createFormId}
          onSubmit={submit}
          className="border-b border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={nameInputId} className="text-xs font-bold text-slate-700">
              {t('gateSetup.name')}
            </label>
            <span id={`${nameInputId}-hint`} className="text-[11px] text-slate-400">
              {t('gateSetup.autoCode')}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id={nameInputId}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-900 outline-none transition hover:border-slate-300 focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/20 disabled:bg-slate-100"
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
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#F66B17] px-4 text-xs font-bold text-white shadow-xs transition hover:bg-[#E05A0A] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {create.isPending ? (
                <IconLoader className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <IconPlus className="h-3.5 w-3.5" />
              )}
              {t(create.isPending ? 'gateSetup.creating' : 'gateSetup.create')}
            </button>
          </div>
        </form>
      )}

      {/* Main Content Area (Foldable) */}
      {!isCollapsed && (
        <div className="p-3 sm:p-4 space-y-2">
          {(create.error || update.error) && (
            <p
              role="alert"
              className="rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700"
            >
              {userErrorMessage(create.error ?? update.error!)}
            </p>
          )}

          {create.isSuccess && (
            <p
              role="status"
              className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800"
            >
              <IconCheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                {t('gateSetup.created', { name: create.data.name, code: create.data.code })}
              </span>
            </p>
          )}

          {empty && canManage ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-4 text-center">
              <p className="text-xs font-bold text-slate-700">{t('gateSetup.emptyTitle')}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">{t('gateSetup.emptyManager')}</p>
            </div>
          ) : (
            <GateCatalogNotice query={query} />
          )}

          {/* Compact Gate Rows */}
          {query.data?.items.map((gate) => (
            <div
              key={gate.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/40 hover:bg-slate-50/90 px-3.5 py-2 transition-colors"
            >
              {/* Left: Gate Name, Code & Status */}
              <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                <span className="text-xs sm:text-sm font-bold text-[#041D2E] truncate">
                  {gate.name}
                </span>
                <code className="select-all rounded bg-white border border-slate-200 px-1.5 py-0.5 text-[11px] font-mono font-medium text-slate-600 shadow-2xs">
                  {gate.code}
                </code>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    gate.status === 'ACTIVE'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                      : 'bg-slate-100 text-slate-500 border border-slate-200'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-full ${
                      gate.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-slate-400'
                    }`}
                  />
                  {t('gateSetup.' + gate.status.toLowerCase())}
                </span>
              </div>

              {/* Right: Actions */}
              {canManage && editing?.id !== gate.id && (
                <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                  <button
                    type="button"
                    className="inline-flex items-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-slate-900 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
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
                    className="inline-flex items-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-slate-900 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
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

              {/* Rename Form (Inline) */}
              {canManage && editing?.id === gate.id && (
                <form
                  className="flex flex-wrap items-center gap-2 w-full pt-2 mt-1 border-t border-slate-200/70"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = String(new FormData(event.currentTarget).get('name') ?? '').trim();
                    if (value && !update.isPending) update.mutate({ gate, input: { name: value } });
                  }}
                >
                  <label className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-700">
                    <span>{t('gateSetup.editName')}</span>
                    <input
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-900 outline-none hover:border-slate-300 focus:border-[#F66B17] focus:ring-1 focus:ring-[#F66B17]/20"
                      name="name"
                      defaultValue={gate.name}
                      required
                      maxLength={100}
                      disabled={update.isPending}
                    />
                  </label>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <button
                      type="submit"
                      className="rounded-lg bg-[#F66B17] hover:bg-[#E05A0A] text-white px-2.5 py-1 text-xs font-bold shadow-2xs transition-all disabled:opacity-50 cursor-pointer"
                      disabled={update.isPending}
                    >
                      {t(update.isPending ? 'gateSetup.saving' : 'gateSetup.save')}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 transition-all disabled:opacity-50 cursor-pointer"
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
      )}
    </section>
  );
}
