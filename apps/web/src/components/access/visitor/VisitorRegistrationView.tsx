import { useManagementClient } from '../../../features/auth/auth-session';
import { localizedError, localizeMessage } from '../../../i18n/messages';
import { LanguageSwitcher } from '../../../i18n/LanguageSwitcher';
import { uiLocale } from '../../../i18n';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { CreateVisitCommand } from '@smartsite/contracts';
import { SITE_GATES } from '@smartsite/contracts/gate-permissions';
import {
  IconAlertTriangle,
  IconBuilding2,
  IconCalendar,
  IconCheck,
  IconKey,
  IconLoader,
  IconRefresh,
  IconShield,
  IconUser,
} from '../../icons';
import { QrPassCard } from '../gate/QrPassCard';

function localTime(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function readReference() {
  const m = /^#visitor-pass=([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(window.location.hash);
  return m ? { visitId: m[1]!, accessKey: m[2]! } : null;
}

export function VisitorRegistrationView({
  apiUrl,
  onBack,
}: {
  apiUrl: string;
  onBack: () => void;
}) {
  useTranslation();

  const client = useManagementClient(apiUrl);
  const [reference, setReference] = useState(readReference);
  const [siteId, setSiteId] = useState('');
  const [message, setMessage] = useState('');
  const [schedule] = useState(() => ({
    from: localTime(new Date(Date.now() + 3600_000)),
    until: localTime(new Date(Date.now() + 7200_000)),
  }));
  const [attempt, setAttempt] = useState<CreateVisitCommand | null>(null);

  const sites = useQuery({
    queryKey: ['visitor-registration', apiUrl, 'sites'],
    queryFn: () => client.listVisitorSites(),
  });
  const selectedSiteId = siteId || sites.data?.items[0]?.id || '';
  const zones = useQuery({
    queryKey: ['visitor-registration', apiUrl, selectedSiteId, 'zones'],
    enabled: !!selectedSiteId && !reference,
    queryFn: () => client.listVisitorZones(selectedSiteId),
  });

  const pass = useQuery({
    queryKey: ['visitor-registration', apiUrl, reference?.visitId, reference?.accessKey],
    enabled: !!reference,
    queryFn: () => client.getVisitorPass(reference!.visitId, reference!.accessKey),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (q) => (q.state.data?.visit.status === 'PENDING' ? 15_000 : 240_000),
  });

  const register = useMutation({
    mutationFn: (input: CreateVisitCommand) =>
      client.registerVisit(siteId || sites.data!.items[0]!.id, input),
    onSuccess: (visit, input) => {
      setReference({ visitId: visit.id, accessKey: input.accessKey });
      window.history.replaceState(null, '', `#visitor-pass=${visit.id}.${input.accessKey}`);
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const input: CreateVisitCommand = {
      requestId: attempt?.requestId ?? crypto.randomUUID(),
      accessKey:
        attempt?.accessKey ??
        Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join(''),
      visitorName: String(f.get('visitorName')),
      company: String(f.get('company')),
      contact: String(f.get('contact')),
      hostName: String(f.get('hostName')),
      purpose: String(f.get('purpose')),
      targetArea: String(f.get('targetArea')),
      groupSize: Number(f.get('groupSize')),
      zoneIds: f.getAll('zoneIds').map(String),
      gateId: String(f.get('gateId')),
      validFrom: new Date(String(f.get('validFrom'))).toISOString(),
      validUntil: new Date(String(f.get('validUntil'))).toISOString(),
    };
    setAttempt(input);
    register.mutate(input);
  };

  const shareUrl = reference
    ? `${window.location.origin}${window.location.pathname}#visitor-pass=${reference.visitId}.${reference.accessKey}`
    : '';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-slate-50/50 to-slate-100 py-8 px-4 sm:px-6 lg:px-8">
      {/* Top Header Bar */}
      <div className="mx-auto max-w-3xl mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FF7A1A] text-white font-black text-sm">
            S
          </div>
          <span className="font-bold text-slate-900 tracking-tight">
            Smart
            <span className="text-[#FF7A1A]">Site</span>
          </span>
          <span className="text-slate-300">|</span>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            {tr('common.visitor_portal')}
          </span>
        </div>

        <LanguageSwitcher />
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 underline transition-colors"
        >
          <span>{tr('visitor_registration_view.staff_security_site_manager_login')}</span>
        </button>
      </div>

      <main className="mx-auto max-w-3xl space-y-6 rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-10 shadow-sm">
        {/* Header Hero */}
        <div className="space-y-2 border-b border-slate-100 pb-6">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#FF7A1A] border border-orange-100">
            <IconKey className="h-3.5 w-3.5" />
            {tr('common.temporary_access_pass')}
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
            {tr('common.visitor_site_registration')}
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            {tr(
              'visitor_registration_view.one_representative_for_an_individual_or_entire_party_requests_are_routed_to_the_si',
            )}
          </p>
        </div>

        {reference ? (
          /* ========================================================================= */
          /* REGISTRATION RESULT & PASS TRACKING VIEW                                  */
          /* ========================================================================= */
          <div className="space-y-6">
            {/* Shareable Link Card */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  {tr('common.save_tracking_link')}
                </span>
                {message && (
                  <span
                    role="status"
                    className="text-xs font-semibold text-emerald-700 flex items-center gap-1"
                  >
                    <IconCheck className="h-3.5 w-3.5" />
                    {localizeMessage(message)}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {tr(
                  'visitor_registration_view.save_this_link_to_check_approval_status_and_access_your_qr_pass_on_mobile',
                )}
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  aria-label={tr('visitor_registration_view.visitor_pass_tracking_link')}
                  readOnly
                  value={shareUrl}
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-xs text-slate-800 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(shareUrl)
                      .then(() => setMessage(tr('common.copied_to_clipboard')))
                      .catch(() =>
                        setMessage(tr('visitor_registration_view.select_and_copy_the_url_above')),
                      );
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition-all shadow-xs"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  <span>{tr('common.copy_tracking_link')}</span>
                </button>
              </div>
            </div>

            {/* Loading / Error States */}
            {pass.isPending && (
              <div
                role="status"
                className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500"
              >
                <IconLoader className="h-4 w-4" />
                <span>{tr('common.checking_approval_status')}</span>
              </div>
            )}

            {pass.error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700"
              >
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                <span>{localizedError(pass.error.message)}</span>
              </div>
            )}

            {/* Visit Details & Pass */}
            {pass.data && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-4">
                    <div>
                      <h2 className="text-xl font-bold tracking-tight text-slate-900">
                        {tr('visitor_registration_view.value_value_visitors', {
                          value1: pass.data.visit.visitorName,
                          value2: pass.data.visit.groupSize,
                        })}
                      </h2>
                      <p className="mt-1 text-xs text-slate-500">
                        {tr('common.site')}{' '}
                        <span className="font-semibold text-slate-800">
                          {sites.data?.items.find((s) => s.id === pass.data?.visit.siteId)?.name ??
                            pass.data.visit.siteId}
                        </span>
                      </p>
                    </div>

                    {/* Status Pill */}
                    <div>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${
                          pass.data.visit.status === 'PENDING'
                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                            : pass.data.visit.status === 'APPROVED'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${
                            pass.data.visit.status === 'PENDING'
                              ? 'bg-amber-500 animate-pulse'
                              : pass.data.visit.status === 'APPROVED'
                                ? 'bg-emerald-500'
                                : 'bg-rose-500'
                          }`}
                        />
                        <span>
                          {tr('common.status_value', {
                            value1:
                              pass.data.visit.status === 'PENDING'
                                ? tr('visitor_registration_view.pending_site_manager_approval')
                                : pass.data.visit.status === 'APPROVED'
                                  ? tr('common.approved')
                                  : pass.data.visit.status,
                          })}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
                    <div className="rounded-xl bg-slate-50 p-3 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {tr('visitor_registration_view.target_area_host_contact')}
                      </span>
                      <p className="text-slate-800 font-semibold">
                        {tr('visitor_registration_view.area_value_host_value', {
                          value1: pass.data.visit.targetArea,
                          value2: pass.data.visit.hostName,
                        })}
                      </p>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {tr('common.authorized_schedule')}
                      </span>
                      <p className="font-mono text-slate-800">
                        {new Date(pass.data.visit.validFrom).toLocaleString(uiLocale())} –{' '}
                        {new Date(pass.data.visit.validUntil).toLocaleString(uiLocale())}
                      </p>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3 sm:col-span-2 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {tr('visitor_registration_view.entry_exit_headcount')}
                      </span>
                      <p className="font-medium text-slate-800">
                        {tr('common.in_76d6aa')} {pass.data.visit.enteredCount}{' '}
                        {tr('common.out_331e30')} {pass.data.visit.exitedCount}{' '}
                        {tr('common.on_site_babffe')}{' '}
                        <span className="font-bold text-[#FF7A1A]">
                          {pass.data.visit.enteredCount - pass.data.visit.exitedCount}
                        </span>{' '}
                        {tr('common.visitors_in_site')}
                      </p>
                    </div>
                  </div>

                  {/* QR Card Presentation */}
                  {pass.data.pass ? (
                    <div className="pt-4 border-t border-slate-100">
                      <QrPassCard pass={pass.data.pass} onRefresh={() => void pass.refetch()} />
                    </div>
                  ) : (
                    pass.data.visit.status === 'APPROVED' && (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-xs text-slate-500">
                        {tr('visitor_registration_view.visit_pass_has_concluded_or_expired')}
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                disabled={pass.isFetching}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-all shadow-xs disabled:opacity-50"
                onClick={() => void pass.refetch()}
              >
                <IconRefresh className="h-3.5 w-3.5 text-slate-500" />
                <span>{tr('visitor_registration_view.check_status_refresh_qr')}</span>
              </button>

              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-all shadow-xs"
                onClick={() => {
                  setReference(null);
                  setAttempt(null);
                  register.reset();
                  window.history.replaceState(null, '', window.location.pathname);
                }}
              >
                <span>{tr('common.register_new_visit')}</span>
              </button>
            </div>
          </div>
        ) : (
          /* ========================================================================= */
          /* REGISTRATION FORM                                                         */
          /* ========================================================================= */
          <form onSubmit={submit} className="space-y-6">
            {/* Section 1: Site and Gate Selection */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#FF7A1A] flex items-center gap-1.5">
                <IconBuilding2 className="h-3.5 w-3.5" />
                {tr('visitor_registration_view.1_site_designated_gate')}
              </h3>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="sm:col-span-2 block text-xs font-bold uppercase tracking-wider text-slate-700">
                  {tr('common.registration_site')}
                  <select
                    required
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs font-semibold text-slate-900 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                    value={siteId || sites.data?.items[0]?.id || ''}
                    onChange={(e) => setSiteId(e.target.value)}
                  >
                    <option value="">{tr('common.select_site')}</option>
                    {sites.data?.items.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>

                {sites.isPending && (
                  <div className="flex items-center gap-2 text-xs text-slate-500 sm:col-span-2">
                    <IconLoader className="h-3.5 w-3.5" />
                    <span>{tr('common.loading_sites')}</span>
                  </div>
                )}

                {sites.error && (
                  <div
                    role="alert"
                    className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 sm:col-span-2"
                  >
                    <span>{localizedError(sites.error.message)}</span>
                    <button
                      type="button"
                      className="underline font-bold"
                      onClick={() => void sites.refetch()}
                    >
                      {tr('common.retry')}
                    </button>
                  </div>
                )}

                <label className="sm:col-span-2 block text-xs font-bold uppercase tracking-wider text-slate-700">
                  {tr('common.designated_gate')}
                  <select
                    name="gateId"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs font-semibold text-slate-900 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                  >
                    {SITE_GATES.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {/* Section 2: Visitor Representative Info */}
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#FF7A1A] flex items-center gap-1.5">
                <IconUser className="h-3.5 w-3.5" />
                {tr('common.2_representative_information')}
              </h3>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  {tr('common.representative_full_name')}
                  <input
                    name="visitorName"
                    required
                    maxLength={255}
                    placeholder={tr('visitor_registration_view.full_name_of_party_representative')}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                  />
                </label>

                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  {tr('common.company_organization')}
                  <input
                    name="company"
                    maxLength={255}
                    placeholder={tr('visitor_registration_view.company_or_agency_name_optional')}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                  />
                </label>

                <label className="sm:col-span-2 block text-xs font-bold uppercase tracking-wider text-slate-700">
                  {tr('visitor_registration_view.contact_phone_email')}
                  <input
                    name="contact"
                    required
                    maxLength={255}
                    placeholder={tr('visitor_registration_view.phone_number_or_email_address')}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                  />
                </label>
              </div>
            </div>

            {/* Section 3: Visit Purpose & Host Info */}
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#FF7A1A] flex items-center gap-1.5">
                <IconShield className="h-3.5 w-3.5" />
                {tr('visitor_registration_view.3_host_visit_purpose')}
              </h3>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  {tr('visitor_registration_view.host_contact_at_site')}
                  <input
                    name="hostName"
                    required
                    maxLength={255}
                    placeholder={tr(
                      'visitor_registration_view.name_of_site_host_supervising_engineer',
                    )}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                  />
                </label>

                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  {tr('common.target_visit_area')}
                  <input
                    name="targetArea"
                    required
                    maxLength={255}
                    placeholder={tr(
                      'visitor_registration_view.e_g_building_a_admin_block_foundation',
                    )}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                  />
                </label>

                <fieldset className="sm:col-span-2 space-y-2">
                  <legend className="text-xs font-bold">{tr('common.requested_zones')}</legend>
                  {zones.isPending && selectedSiteId && (
                    <p role="status">{tr('common.loading_site_zones')}</p>
                  )}
                  {zones.error && (
                    <p role="alert">
                      {tr('visitor_registration_view.unable_to_load_site_zones')}{' '}
                      <button type="button" onClick={() => void zones.refetch()}>
                        {tr('common.retry')}
                      </button>
                    </p>
                  )}
                  {zones.data?.items.map((z) => (
                    <label key={z.id} className="mr-4 inline-flex items-center gap-2 text-sm">
                      <input name="zoneIds" type="checkbox" value={z.id} />
                      {z.name}
                    </label>
                  ))}
                  <p className="text-xs text-slate-500">
                    {tr(
                      'visitor_registration_view.requested_access_takes_effect_only_after_site_manager_approval',
                    )}
                  </p>
                </fieldset>
                <label className="sm:col-span-2 block text-xs font-bold uppercase tracking-wider text-slate-700">
                  {tr('common.visit_purpose')}
                  <input
                    name="purpose"
                    required
                    maxLength={1000}
                    placeholder={tr(
                      'visitor_registration_view.reason_for_site_entry_or_official_inspection',
                    )}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                  />
                </label>
              </div>
            </div>

            {/* Section 4: Schedule and Group Size */}
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#FF7A1A] flex items-center gap-1.5">
                <IconCalendar className="h-3.5 w-3.5" />
                {tr('visitor_registration_view.4_schedule_headcount')}
              </h3>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  {tr('common.total_visitors_headcount')}
                  <input
                    name="groupSize"
                    type="number"
                    min={1}
                    max={1000}
                    defaultValue={1}
                    required
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs font-bold text-slate-900 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                  />
                </label>

                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  {tr('common.valid_from_f38b0e')}
                  <input
                    name="validFrom"
                    type="datetime-local"
                    defaultValue={schedule.from}
                    required
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                  />
                </label>

                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  {tr('common.valid_until_b252ed')}
                  <input
                    name="validUntil"
                    type="datetime-local"
                    defaultValue={schedule.until}
                    required
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                  />
                </label>
              </div>
            </div>

            {/* Error Message */}
            {register.error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700"
              >
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                <span>{localizedError(register.error.message)}</span>
              </div>
            )}

            {/* Submit Action */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={register.isPending || !sites.data?.items.length}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FF7A1A] py-3.5 px-6 font-bold text-sm text-white shadow-xs hover:bg-[#E56A10] transition-all disabled:opacity-50"
              >
                {register.isPending ? (
                  <>
                    <IconLoader className="h-4 w-4" />
                    <span>{tr('common.submitting')}</span>
                  </>
                ) : (
                  <>
                    <IconCheck className="h-4 w-4" />
                    <span>{tr('visitor_registration_view.submit_for_site_manager_approval')}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
