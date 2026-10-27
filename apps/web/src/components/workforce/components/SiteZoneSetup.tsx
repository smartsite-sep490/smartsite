import { useManagementClient } from '../../../features/auth/auth-session';
import { userErrorMessage } from '../../../i18n/messages';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ZoneResponse } from '@smartsite/api-client';
import { loadAllPages } from '../load-all-pages';
import {
  IconAlertTriangle,
  IconCheck,
  IconHardHat,
  IconLoader,
  IconPlus,
  IconRefresh,
  IconShield,
} from '../../icons';

export function SiteZoneSetup({
  apiUrl,
  token,
  siteId,
  userId,
}: {
  apiUrl: string;
  token: string;
  siteId: string;
  userId: string;
}) {
  useTranslation();

  const client = useManagementClient(apiUrl);
  const cache = useQueryClient();
  const key = ['site-setup', apiUrl, userId, 'zones', siteId];
  const zones = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      loadAllPages((options) => client.listZones(token, siteId, options), signal),
  });
  const [name, setName] = useState('');
  const [type, setType] = useState<ZoneResponse['type']>('STANDARD');
  const [policy, setPolicy] = useState<ZoneResponse['restrictionPolicy']>('NONE');
  const [hardHat, setHardHat] = useState(false);
  const [vest, setVest] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      client.createZone(token, siteId, {
        name: name.trim(),
        type,
        restrictionPolicy: policy,
        requiredPpe: [...(hardHat ? ['HARD_HAT'] : []), ...(vest ? ['SAFETY_VEST'] : [])],
      }),
    onSuccess: () => {
      setName('');
      void cache.invalidateQueries({ queryKey: key });
      void cache.invalidateQueries({
        queryKey: ['access-control', apiUrl, userId, siteId, 'access-setup'],
      });
    },
  });

  return (
    <div className="space-y-6">
      {/* Create Zone Form Card */}
      <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-[#F66B17] shrink-0">
            <IconShield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">{tr('common.create_zone')}</h2>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-5"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
              {tr('common.zone_name')}
              <input
                className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#F66B17] focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/10 transition-colors"
                required
                maxLength={255}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
              {tr('common.zone_type')}
              <select
                className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#F66B17] focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/10 transition-colors cursor-pointer"
                value={type}
                onChange={(e) => setType(e.target.value as ZoneResponse['type'])}
              >
                <option value="STANDARD">{tr('common.standard')}</option>
                <option value="RESTRICTED">{tr('common.restricted')}</option>
                <option value="HAZARDOUS">{tr('common.hazardous')}</option>
              </select>
            </label>

            <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
              {tr('common.access_policy')}
              <select
                className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#F66B17] focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/10 transition-colors cursor-pointer"
                value={policy}
                onChange={(e) => setPolicy(e.target.value as ZoneResponse['restrictionPolicy'])}
              >
                <option value="NONE">{tr('common.no_restriction')}</option>
                <option value="AUTHORIZATION_REQUIRED">
                  {tr('common.authorization_required')}
                </option>
                <option value="PROHIBITED_FOR_ALL">{tr('common.prohibited_for_all')}</option>
              </select>
            </label>
          </div>

          <div className="pt-1">
            <span className="block text-xs font-semibold text-slate-700 mb-2">
              {tr('common.required_ppe')}
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <label
                className={`inline-flex items-center gap-2.5 px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer select-none transition-all ${
                  hardHat
                    ? 'border-orange-300 bg-orange-50 text-orange-950 ring-1 ring-orange-300/50 shadow-2xs'
                    : 'border-slate-200 bg-slate-50/50 text-slate-600 hover:bg-slate-100 hover:border-slate-300'
                }`}
              >
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-[#F66B17] focus:ring-[#F66B17] w-4 h-4 cursor-pointer"
                  checked={hardHat}
                  onChange={(e) => setHardHat(e.target.checked)}
                />
                <IconHardHat
                  className={`w-4 h-4 ${hardHat ? 'text-[#F66B17]' : 'text-slate-400'}`}
                />
                <span>{tr('common.hard_hat')}</span>
              </label>

              <label
                className={`inline-flex items-center gap-2.5 px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer select-none transition-all ${
                  vest
                    ? 'border-orange-300 bg-orange-50 text-orange-950 ring-1 ring-orange-300/50 shadow-2xs'
                    : 'border-slate-200 bg-slate-50/50 text-slate-600 hover:bg-slate-100 hover:border-slate-300'
                }`}
              >
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-[#F66B17] focus:ring-[#F66B17] w-4 h-4 cursor-pointer"
                  checked={vest}
                  onChange={(e) => setVest(e.target.checked)}
                />
                <IconShield className={`w-4 h-4 ${vest ? 'text-[#F66B17]' : 'text-slate-400'}`} />
                <span>{tr('common.safety_vest_280adb')}</span>
              </label>
            </div>
          </div>

          <div className="pt-2">
            <button
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#071A2B] hover:bg-[#0c2840] text-white px-5 py-2.5 text-xs sm:text-sm font-bold shadow-xs hover:shadow transition-all disabled:opacity-50 cursor-pointer min-h-10 active:scale-[0.99]"
              disabled={create.isPending || !name.trim()}
              type="submit"
            >
              <IconPlus className="w-4 h-4" />
              <span>{create.isPending ? tr('common.creating') : tr('common.create_zone')}</span>
            </button>
          </div>
        </form>

        {create.isError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-xs text-rose-700 flex items-center gap-2"
          >
            <IconAlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{userErrorMessage(create.error)}</span>
          </div>
        )}
        {create.isSuccess && (
          <div
            role="status"
            className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-xs text-emerald-700 flex items-center gap-2"
          >
            <IconCheck className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{tr('common.zone_created')}</span>
          </div>
        )}
      </section>

      {/* Configured Zones List Card */}
      <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <h3 className="text-sm font-bold text-slate-900">{tr('common.configured_zones')}</h3>
            {zones.data && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {zones.data.items.length}
              </span>
            )}
          </div>
        </div>

        {zones.isPending ? (
          <div className="py-12 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
            <IconLoader className="w-5 h-5 animate-spin text-slate-500" />
            <p role="status">{tr('common.loading_zones')}</p>
          </div>
        ) : zones.isError ? (
          <div
            role="alert"
            className="p-5 flex items-center justify-between text-xs text-rose-700 bg-rose-50/60"
          >
            <span>{tr('common.zones_unavailable')}</span>
            <button
              type="button"
              onClick={() => void zones.refetch()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 bg-white font-semibold text-rose-700 hover:bg-rose-50 cursor-pointer"
            >
              <IconRefresh className="w-3.5 h-3.5" />
              <span>{tr('common.retry')}</span>
            </button>
          </div>
        ) : zones.data.items.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-xs text-slate-400">
              {tr('site_zone_setup.no_zones_configured_for_this_site')}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {zones.data.items.map((zone) => (
              <li
                key={zone.id}
                className="px-6 py-4 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-orange-50/80 border border-orange-100 flex items-center justify-center text-orange-600 shrink-0">
                    <IconShield className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 truncate">{zone.name}</div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                          zone.type === 'HAZARDOUS'
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : zone.type === 'RESTRICTED'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {zone.type === 'HAZARDOUS'
                          ? tr('common.hazardous')
                          : zone.type === 'RESTRICTED'
                            ? tr('common.restricted')
                            : tr('common.standard')}
                      </span>

                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                          zone.restrictionPolicy === 'PROHIBITED_FOR_ALL'
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : zone.restrictionPolicy === 'AUTHORIZATION_REQUIRED'
                              ? 'bg-sky-50 text-sky-800 border-sky-200'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        }`}
                      >
                        {zone.restrictionPolicy === 'PROHIBITED_FOR_ALL'
                          ? tr('common.prohibited_for_all')
                          : zone.restrictionPolicy === 'AUTHORIZATION_REQUIRED'
                            ? tr('common.authorization_required')
                            : tr('common.no_restriction')}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                  {zone.requiredPpe && zone.requiredPpe.length > 0 ? (
                    zone.requiredPpe.map((ppe) => (
                      <span
                        key={ppe}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-50/70 border border-orange-200/60 text-orange-900 text-[11px] font-semibold"
                      >
                        {ppe === 'HARD_HAT' ? (
                          <>
                            <IconHardHat className="w-3.5 h-3.5 text-[#F66B17]" />
                            <span>{tr('common.hard_hat')}</span>
                          </>
                        ) : ppe === 'SAFETY_VEST' ? (
                          <>
                            <IconShield className="w-3.5 h-3.5 text-[#F66B17]" />
                            <span>{tr('common.safety_vest_280adb')}</span>
                          </>
                        ) : (
                          <span>{ppe}</span>
                        )}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-slate-400 font-medium">
                      {tr('common.no_ppe_required')}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
