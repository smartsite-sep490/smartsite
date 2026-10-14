import { localizedError } from '../../../i18n/messages';
import { uiLocale } from '../../../i18n';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { SmartDatePicker } from '../../ui';

function localDate() {
  const date = new Date();
  return new Date(+date - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function ContractorZoneSetup({
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

  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const cache = useQueryClient();
  const key = ['access-control', apiUrl, userId, siteId, 'access-setup'];
  const setup = useQuery({ queryKey: key, queryFn: () => client.accessSetup(token, siteId) });
  const [participationId, setParticipationId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [validFrom, setValidFrom] = useState(localDate);
  const [validUntil, setValidUntil] = useState(localDate);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const grant = useMutation({
    mutationFn: () => {
      if (!validFrom || !validUntil || validUntil < validFrom)
        throw new Error(tr('contractor_zone_setup.end_date_must_be_on_or_after_start_date'));
      const fingerprint = JSON.stringify([
        participationId,
        zoneId,
        validFrom,
        validUntil,
        timezone,
      ]);
      if (request.current?.fingerprint !== fingerprint)
        request.current = { fingerprint, id: crypto.randomUUID() };
      return client.grantContractorZoneDates(token, siteId, {
        requestId: request.current.id,
        siteContractorId: participationId,
        zoneId,
        startDate: validFrom,
        endDate: validUntil,
        timezone,
      });
    },
    onSuccess: () => {
      request.current = null;
      void cache.invalidateQueries({ queryKey: key });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => client.revokeZonePermission(token, siteId, id, 'contractor'),
    onSuccess: () => cache.invalidateQueries({ queryKey: key }),
  });
  if (setup.isPending)
    return <p role="status">{tr('contractor_zone_setup.loading_contractor_zone_assignments')}</p>;
  if (setup.isError)
    return (
      <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4">
        {localizedError(setup.error.message)}{' '}
        <button type="button" onClick={() => void setup.refetch()}>
          {tr('common.retry')}
        </button>
      </div>
    );
  const data = setup.data;
  if (!data.canGrantContractorZones)
    return (
      <p role="alert">
        {tr('contractor_zone_setup.you_do_not_have_permission_to_assign_zones_for_this_site')}
      </p>
    );
  const inputClass =
    'w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-100';
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-5">
      <div>
        <h2 className="text-lg font-bold text-[#071A2B]">
          {tr('contractor_zone_setup.assign_zone_to_contractor')}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {tr(
            'contractor_zone_setup.select_a_contractor_and_zone_then_choose_the_start_and_end_dates_both_included',
          )}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {tr(
            'contractor_zone_setup.timezone_value_permission_is_limited_to_the_contractor_s_participation_period_in_t',
            { value1: timezone },
          )}
        </p>
      </div>
      {!data.zones.length && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          {tr('contractor_zone_setup.create_a_zone_in_the_zones_tab_first')}
        </p>
      )}
      {!data.participations.length && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          {tr('contractor_zone_setup.add_a_contractor_to_this_site_first')}
        </p>
      )}
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          grant.mutate();
        }}
      >
        <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
          {tr('common.contractor')}
          <select
            className={inputClass}
            required
            value={participationId}
            onChange={(e) => setParticipationId(e.target.value)}
          >
            <option value="">{tr('common.select_contractor')}</option>
            {data.participations.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
          {tr('common.zone')}
          <select
            className={inputClass}
            required
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
          >
            <option value="">{tr('common.select_zone')}</option>
            {data.zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
        <SmartDatePicker
          label={tr('common.start_date')}
          value={validFrom}
          onChange={setValidFrom}
          disablePast={false}
          fieldRequired
        />
        <SmartDatePicker
          label={tr('common.end_date')}
          value={validUntil}
          onChange={setValidUntil}
          disablePast={false}
          min={validFrom}
          fieldRequired
        />
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="rounded-xl bg-[#071A2B] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            disabled={
              grant.isPending ||
              !participationId ||
              !zoneId ||
              !validFrom ||
              !validUntil ||
              validUntil < validFrom
            }
          >
            {grant.isPending ? tr('common.assigning') : tr('common.assign_contractor_zone')}
          </button>
        </div>
      </form>
      {grant.isError && (
        <p role="alert" className="text-sm text-red-700">
          {localizedError(grant.error.message)}
        </p>
      )}
      {grant.isSuccess && (
        <p role="status" className="text-sm text-green-700">
          {tr('common.contractor_zone_assigned')}
        </p>
      )}
      <div className="border-t border-slate-100 pt-4 space-y-3">
        <h3 className="font-bold text-[#071A2B]">{tr('common.assigned_contractor_zones')}</h3>
        {!data.contractorPermissions.length && (
          <p className="text-sm text-slate-500">
            {tr('site_access_setup_view.no_contractor_zone_permissions')}
          </p>
        )}
        {data.contractorPermissions.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm"
          >
            <div>
              <p className="font-semibold">
                {data.participations.find((c) => c.id === p.siteContractorId)?.name ??
                  tr('common.unavailable_contractor')}{' '}
                · {data.zones.find((z) => z.id === p.zoneId)?.name ?? tr('common.unavailable_zone')}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {new Date(p.validFrom).toLocaleDateString(uiLocale(), { timeZone: timezone })} →{' '}
                {new Date(+new Date(p.validUntil) - 1).toLocaleDateString(uiLocale(), {
                  timeZone: timezone,
                })}{' '}
                · {p.revokedAt ? tr('common.revoked') : tr('common.assigned')}
              </p>
            </div>
            {!p.revokedAt && (
              <button
                type="button"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(p.id)}
                className="min-h-10 rounded-lg border border-slate-200 px-3"
              >
                {tr('common.revoke_contractor_zone')}
              </button>
            )}
          </div>
        ))}
        {revoke.isError && (
          <p role="alert" className="text-sm text-red-700">
            {localizedError(revoke.error.message)}
          </p>
        )}
      </div>
    </section>
  );
}
