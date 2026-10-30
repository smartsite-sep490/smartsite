import { useManagementClient } from '../../features/auth/auth-session';
import { userErrorMessage } from '../../i18n/messages';
import { localizedLabel, localizedGateName } from '../../i18n/labels';
import { translate as tr } from '../../i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SITE_GATES } from '@smartsite/contracts/gates';
import { uiLocale } from '../../i18n';
import { IconAlertTriangle } from '../icons';

export function GateObservationView({
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
  const { t } = useTranslation();
  const locale = uiLocale();
  const client = useManagementClient(apiUrl);
  const [gateId, setGateId] = useState<string>(SITE_GATES[0].id);

  const logs = useQuery({
    queryKey: ['gate-access-logs', apiUrl, sessionScope, siteId, gateId],
    queryFn: () => client.listGateAccessLogs(token, siteId, gateId),
    refetchInterval: 15_000,
  });

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="space-y-1">
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-sky-700 border border-sky-200/60">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-600" />
              {tr('integrated_ui.turnstile_stream')}
            </span>
          </div>
          <h2 className="text-xl font-extrabold tracking-tight text-[#111111]">
            {t('gateObservation.title')}
          </h2>
        </div>

        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-xs font-bold text-slate-700">
            <span>{t('gateObservation.gateLabel')}</span>
            <select
              aria-label={t('gateObservation.gateSelectAria')}
              className="min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#F66B17]/20 focus:border-[#F66B17] transition-all cursor-pointer"
              value={gateId}
              onChange={(e) => setGateId(e.target.value)}
            >
              {SITE_GATES.map((g) => (
                <option key={g.id} value={g.id}>
                  {localizedGateName(g.id)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {logs.isPending && (
        <div className="flex items-center gap-2 p-6 text-xs text-slate-500">
          <div className="h-3.5 w-3.5 border-2 border-[#F66B17] border-t-transparent rounded-full animate-spin" />
          <p role="status">{t('gateObservation.loading')}</p>
        </div>
      )}

      {logs.error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-800"
        >
          <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{userErrorMessage(logs.error)}</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200/80">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <th className="py-3 px-3.5">{t('gateObservation.colTime')}</th>
              <th className="py-3 px-3.5">{t('gateObservation.colWorker')}</th>
              <th className="py-3 px-3.5">{t('gateObservation.colContractor')}</th>
              <th className="py-3 px-3.5">{t('gateObservation.colDirection')}</th>
              <th className="py-3 px-3.5">{t('gateObservation.colMethod')}</th>
              <th className="py-3 px-3.5 text-right">{t('gateObservation.colDecision')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.data?.items.map((log) => {
              const isAuthorized = log.decision.authorization === 'ALLOWED';
              return (
                <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-3.5 font-mono text-slate-600">
                    {new Date(log.createdAt).toLocaleString(locale)}
                  </td>
                  <td className="py-3 px-3.5 font-bold text-slate-900">
                    {log.workerName ?? t('gateObservation.unknownWorker')}
                  </td>
                  <td className="py-3 px-3.5 text-slate-600">{log.contractorName ?? '—'}</td>
                  <td className="py-3 px-3.5">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        log.direction === 'IN'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {log.direction === 'IN' ? t('gateObservation.in') : t('gateObservation.out')}
                    </span>
                  </td>
                  <td className="py-3 px-3.5 font-mono text-slate-600">
                    {localizedLabel(log.method)}
                  </td>
                  <td className="py-3 px-3.5 text-right">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isAuthorized
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}
                    >
                      {localizedLabel(log.decision.authorization)} ·{' '}
                      {localizedLabel(log.decision.reasonCode)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {logs.data?.items.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 p-8 text-center">
          <p className="text-xs text-slate-500">{t('gateObservation.empty')}</p>
        </div>
      )}
    </section>
  );
}
