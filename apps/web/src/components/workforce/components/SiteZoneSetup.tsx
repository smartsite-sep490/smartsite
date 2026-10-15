import { useManagementClient } from '../../../features/auth/auth-session';
import { localizedError } from '../../../i18n/messages';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ZoneResponse } from '@smartsite/api-client';
import { loadAllPages } from '../load-all-pages';

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
  const inputClass =
    'w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-100';
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <div>
        <h2 className="text-lg font-bold text-[#071A2B]">{tr('common.create_zone')}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {tr('site_zone_setup.add_a_work_area_and_configure_its_access_policy_and_required_ppe')}
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <p className="sm:col-span-2 text-xs text-slate-500">
          {tr('site_zone_setup.zone_code_is_generated_automatically_when_saved')}
        </p>
        <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
          {tr('common.zone_name')}
          <input
            className={inputClass}
            required
            maxLength={255}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
          {tr('common.zone_type')}
          <select
            className={inputClass}
            value={type}
            onChange={(e) => setType(e.target.value as ZoneResponse['type'])}
          >
            <option value="STANDARD">{tr('common.standard')}</option>
            <option value="RESTRICTED">{tr('common.restricted')}</option>
            <option value="HAZARDOUS">{tr('common.hazardous')}</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
          {tr('common.access_policy')}
          <select
            className={inputClass}
            value={policy}
            onChange={(e) => setPolicy(e.target.value as ZoneResponse['restrictionPolicy'])}
          >
            <option value="NONE">{tr('common.no_restriction')}</option>
            <option value="AUTHORIZATION_REQUIRED">{tr('common.authorization_required')}</option>
            <option value="PROHIBITED_FOR_ALL">{tr('common.prohibited_for_all')}</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={hardHat} onChange={(e) => setHardHat(e.target.checked)} />{' '}
          {tr('common.hard_hat')}
        </label>
        <label>
          <input type="checkbox" checked={vest} onChange={(e) => setVest(e.target.checked)} />{' '}
          {tr('common.safety_vest_280adb')}
        </label>
        <button
          className="rounded-xl bg-[#071A2B] text-white px-4 py-2 min-h-10 disabled:opacity-50"
          disabled={create.isPending || !name.trim()}
          type="submit"
        >
          {create.isPending ? tr('common.creating') : tr('common.create_zone')}
        </button>
      </form>
      {create.isError && <p role="alert">{localizedError(create.error.message)}</p>}
      {create.isSuccess && <p role="status">{tr('common.zone_created')}</p>}
      <div className="border-t border-slate-100 pt-4 space-y-3">
        <h3 className="font-bold text-[#071A2B]">{tr('common.configured_zones')}</h3>
        {zones.isPending ? (
          <p role="status">{tr('common.loading_zones')}</p>
        ) : zones.isError ? (
          <div role="alert">
            {tr('common.zones_unavailable')}{' '}
            <button type="button" onClick={() => void zones.refetch()}>
              {tr('common.retry')}
            </button>
          </div>
        ) : zones.data.items.length === 0 ? (
          <p>{tr('site_zone_setup.no_zones_configured_for_this_site')}</p>
        ) : (
          <ul>
            {zones.data.items.map((zone) => (
              <li key={zone.id}>
                {zone.name} ({zone.code}) · {zone.type} · {zone.restrictionPolicy}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
