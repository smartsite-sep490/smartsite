import { localizedError } from '../../../i18n/messages';
import { uiLocale } from '../../../i18n';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { SmartDatePicker } from '../../ui';
import {
  IconAlertTriangle,
  IconCalendar,
  IconCheck,
  IconLoader,
  IconRefresh,
  IconShield,
  IconTrash,
} from '../../icons';

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
    return (
      <div className="py-16 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
        <IconLoader className="w-5 h-5 animate-spin text-slate-500" />
        <p role="status">{tr('contractor_zone_setup.loading_contractor_zone_assignments')}</p>
      </div>
    );

  if (setup.isError)
    return (
      <div
        role="alert"
        className="rounded-2xl border border-rose-200 bg-rose-50/80 p-5 flex items-center justify-between text-xs text-rose-700"
      >
        <span>{localizedError(setup.error.message)}</span>
        <button
          type="button"
          onClick={() => void setup.refetch()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 bg-white font-semibold text-rose-700 hover:bg-rose-50 cursor-pointer shadow-2xs"
        >
          <IconRefresh className="w-3.5 h-3.5" />
          <span>{tr('common.retry')}</span>
        </button>
      </div>
    );

  const data = setup.data;
  if (!data.canGrantContractorZones)
    return (
      <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50/80 p-5 text-xs text-amber-800">
        {tr('contractor_zone_setup.you_do_not_have_permission_to_assign_zones_for_this_site')}
      </div>
    );

  return (
    <div className="space-y-6">
      {/* Assign Zone Form Card */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-[#F66B17] shrink-0">
            <IconShield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {tr('contractor_zone_setup.assign_zone_to_contractor')}
            </h2>
          </div>
        </div>

        {!data.zones.length && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-800 flex items-center gap-2">
            <IconAlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>{tr('contractor_zone_setup.create_a_zone_in_the_zones_tab_first')}</span>
          </div>
        )}
        {!data.participations.length && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-800 flex items-center gap-2">
            <IconAlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>{tr('contractor_zone_setup.add_a_contractor_to_this_site_first')}</span>
          </div>
        )}

        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            grant.mutate();
          }}
        >
          <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
            {tr('common.contractor')}
            <select
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#F66B17] focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/10 transition-colors cursor-pointer"
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

          <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
            {tr('common.zone')}
            <select
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#F66B17] focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/10 transition-colors cursor-pointer"
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

          <div className="sm:col-span-2 pt-1">
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#071A2B] hover:bg-[#0c2840] px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-xs hover:shadow transition-all disabled:opacity-50 cursor-pointer min-h-10 active:scale-[0.99]"
              disabled={
                grant.isPending ||
                !participationId ||
                !zoneId ||
                !validFrom ||
                !validUntil ||
                validUntil < validFrom
              }
            >
              <IconShield className="w-4 h-4" />
              <span>{grant.isPending ? tr('common.assigning') : tr('common.assign_contractor_zone')}</span>
            </button>
          </div>
        </form>

        {grant.isError && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-xs text-rose-700 flex items-center gap-2">
            <IconAlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{localizedError(grant.error.message)}</span>
          </div>
        )}
        {grant.isSuccess && (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-xs text-emerald-700 flex items-center gap-2">
            <IconCheck className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{tr('common.contractor_zone_assigned')}</span>
          </div>
        )}
      </section>

      {/* Assigned Contractor Zones List Card */}
      <section className="rounded-2xl border border-slate-200/90 bg-white shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <h3 className="text-sm font-bold text-slate-900">{tr('common.assigned_contractor_zones')}</h3>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {data.contractorPermissions.length}
            </span>
          </div>
        </div>

        {!data.contractorPermissions.length ? (
          <div className="p-8 text-center">
            <p className="text-xs text-slate-400">
              {tr('site_access_setup_view.no_contractor_zone_permissions')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {data.contractorPermissions.map((p) => {
              const contractorName =
                data.participations.find((c) => c.id === p.siteContractorId)?.name ??
                tr('common.unavailable_contractor');
              const zoneName =
                data.zones.find((z) => z.id === p.zoneId)?.name ?? tr('common.unavailable_zone');
              const isRevoked = Boolean(p.revokedAt);

              return (
                <div
                  key={p.id}
                  className="px-6 py-4 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{contractorName}</span>
                      <span className="text-slate-300">→</span>
                      <span className="inline-flex items-center gap-1 font-semibold text-slate-800 text-sm">
                        <IconShield className="w-3.5 h-3.5 text-[#F66B17]" />
                        {zoneName}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                          isRevoked
                            ? 'bg-slate-100 text-slate-500 border-slate-200'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        }`}
                      >
                        {isRevoked ? tr('common.revoked') : tr('common.assigned')}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <IconCalendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        {new Date(p.validFrom).toLocaleDateString(uiLocale(), { timeZone: timezone })}
                        {' – '}
                        {new Date(+new Date(p.validUntil) - 1).toLocaleDateString(uiLocale(), {
                          timeZone: timezone,
                        })}
                      </span>
                    </div>
                  </div>

                  {!isRevoked && (
                    <button
                      type="button"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(p.id)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 bg-white text-xs font-semibold text-rose-700 hover:bg-rose-50 hover:border-rose-300 transition-colors cursor-pointer disabled:opacity-50 shrink-0 self-start sm:self-auto min-h-9"
                    >
                      <IconTrash className="w-3.5 h-3.5 text-rose-500" />
                      <span>{tr('common.revoke_contractor_zone')}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {revoke.isError && (
          <div role="alert" className="p-4 border-t border-rose-100 bg-rose-50/80 text-xs text-rose-700 flex items-center gap-2">
            <IconAlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{localizedError(revoke.error.message)}</span>
          </div>
        )}
      </section>
    </div>
  );
}
