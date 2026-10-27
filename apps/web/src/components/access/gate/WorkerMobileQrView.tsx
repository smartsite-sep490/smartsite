import { useManagementClient } from '../../../features/auth/auth-session';
import { userErrorMessage } from '../../../i18n/messages';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { IconAlertTriangle, IconKey, IconLoader, IconShield } from '../../icons';
import { QrPassCard } from './QrPassCard';

export function WorkerMobileQrView({
  apiUrl,
  token,
  siteId,
  workerName,
}: {
  apiUrl: string;
  token: string;
  siteId: string;
  workerName: string;
}) {
  useTranslation();

  const client = useManagementClient(apiUrl);
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const pass = useMutation({
    mutationFn: (value: 'IN' | 'OUT') => client.issueWorkerQr(token, siteId, { direction: value }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    pass.mutate(direction);
  };

  const workerInitials = workerName.slice(0, 2).toUpperCase() || 'WK';

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {/* Worker Pass Card Header */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-6 text-white">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-200 backdrop-blur-xs">
              <IconKey className="h-3.5 w-3.5 text-[#FF7A1A]" />
              {tr('common.gate_fallback_pass')}
            </span>
            <span className="text-[11px] font-mono text-slate-400">QR</span>
          </div>

          <div className="mt-4 flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#FF7A1A] to-[#FF9B42] text-xl font-black text-white shadow-md">
              {workerInitials}
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold tracking-tight text-white">
                {tr('worker_mobile_qr_view.fallback_qr_value', { value1: workerName })}
              </h2>
            </div>
          </div>
        </div>

        {/* 3-Step Operation Instructions */}
        <div className="border-b border-slate-100 bg-slate-50/60 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
            <div className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#FF7A1A]/15 font-bold text-[#FF7A1A]">
                1
              </span>
              <p className="text-slate-600">
                {tr('worker_mobile_qr_view.receive_session_code_from_security_officer_at_gate')}
              </p>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#FF7A1A]/15 font-bold text-[#FF7A1A]">
                2
              </span>
              <p className="text-slate-600">
                {tr('worker_mobile_qr_view.enter_the_session_code_below')}
              </p>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#FF7A1A]/15 font-bold text-[#FF7A1A]">
                3
              </span>
              <p className="text-slate-600">
                {tr('worker_mobile_qr_view.present_dynamic_qr_code_at_scanner')}
              </p>
            </div>
          </div>
        </div>

        {/* Request Form */}
        <div className="p-6">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label
                htmlFor="worker-qr-direction"
                className="block text-xs font-bold uppercase tracking-wider text-slate-700"
              >
                {tr('worker_mobile_qr_view.passage_direction')}
              </label>
              <select
                id="worker-qr-direction"
                value={direction}
                onChange={(event) => {
                  setDirection(event.target.value as 'IN' | 'OUT');
                  pass.reset();
                }}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm"
              >
                <option value="IN">{tr('common.entry_in')}</option>
                <option value="OUT">{tr('common.exit_out')}</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={pass.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#FF7A1A] px-4 py-3 text-sm font-bold text-white shadow-xs hover:bg-[#E56A10] transition-all disabled:opacity-50"
            >
              {pass.isPending ? (
                <>
                  <IconLoader className="h-4 w-4" />
                  <span>{tr('common.generating_qr')}</span>
                </>
              ) : (
                <>
                  <IconKey className="h-4 w-4" />
                  <span>{tr('common.get_my_qr')}</span>
                </>
              )}
            </button>
          </form>

          {/* Error Message */}
          {pass.error && (
            <div
              role="alert"
              className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700"
            >
              <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
              <span>{userErrorMessage(pass.error)}</span>
            </div>
          )}

          {/* Active QR Pass Card */}
          {pass.data && !pass.isPending && !pass.error && (
            <div className="mt-6 pt-6 border-t border-slate-100">
              <QrPassCard pass={pass.data} onRefresh={() => pass.mutate(direction)} />
            </div>
          )}
        </div>

        {/* Security Note Footer */}
        <div className="border-t border-slate-100 bg-amber-50/60 p-4">
          <div className="flex items-start gap-2.5 text-xs text-amber-900">
            <IconShield className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
            <p className="leading-relaxed">
              {tr(
                'worker_mobile_qr_view.backend_enforces_gate_clearance_rules_worker_status_and_contractor_credentials_bef',
              )}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
