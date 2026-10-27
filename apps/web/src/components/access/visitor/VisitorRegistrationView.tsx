import { translate as tr } from '../../../i18n';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { CreateVisitCommand, VisitorMemberInput } from '@smartsite/contracts';
import { SITE_GATES } from '@smartsite/contracts/gate-permissions';
import { useTranslation } from 'react-i18next';
import { uiLocale, uiLanguage } from '../../../i18n';
import { LanguageSwitcher } from '../../../i18n/LanguageSwitcher';
import { localizeMessage } from '../../../i18n/messages';
import { QrPassCard } from '../gate/QrPassCard';
import { readVisitorExcel, downloadVisitorTemplate } from '../visitor-excel';
import { visitorError } from '../visitor-error';

const field =
  'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 transition-all shadow-2xs hover:border-slate-300 focus:border-orange-500 focus:outline-none focus:ring-3 focus:ring-orange-100 disabled:bg-slate-50 disabled:text-slate-500';
const button =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-2xs transition-all hover:bg-slate-50 hover:border-slate-300 active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none';
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
  const { t } = useTranslation();
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const [reference, setReference] = useState(readReference);
  const [siteId, setSiteId] = useState('');
  const [message, setMessage] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [formError, setFormError] = useState('');
  const [importError, setImportError] = useState<Error | null>(null);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(0);
  const [groupSize, setGroupSize] = useState('1');
  const [members, setMembers] = useState<VisitorMemberInput[]>([]);
  const importGeneration = useRef(0);
  const [schedule] = useState(() => ({
    from: localTime(new Date(Date.now() + 3600_000)),
    until: localTime(new Date(Date.now() + 7200_000)),
  }));
  const [attempt, setAttempt] = useState<{ siteId: string; input: CreateVisitCommand } | null>(
    null,
  );
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
  const managers = useQuery({
    queryKey: ['visitor-registration', apiUrl, selectedSiteId, 'managers'],
    enabled: !!selectedSiteId && !reference,
    queryFn: () => client.listVisitorManagers(selectedSiteId),
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
    mutationFn: ({ siteId: site, input }: { siteId: string; input: CreateVisitCommand }) =>
      client.registerVisit(site, input),
    onSuccess: (visit, { input }) => {
      setReference({ visitId: visit.id, accessKey: input.accessKey });
      window.history.replaceState(null, '', `#visitor-pass=${visit.id}.${input.accessKey}`);
    },
  });
  const resize = (value: string) => {
    setGroupSize(value);
    setImported(0);
    setImportError(null);
    importGeneration.current++;
    const size = Number(value);
    if (Number.isInteger(size) && size >= 2 && size <= 1000)
      setMembers((old) =>
        Array.from({ length: size }, (_, i) => old[i] ?? { fullName: '', identityNumber: '' }),
      );
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    const f = new FormData(event.currentTarget);
    const selectedManager = managers.data?.items.find(
      (manager) => manager.id === f.get('siteManagerId'),
    );
    if (!selectedManager) {
      setFormError('visitor.managerRequired');
      return;
    }
    const size = Number(groupSize);
    const roster =
      size > 1
        ? members.map((m) => ({
            fullName: m.fullName.trim(),
            identityNumber: m.identityNumber.trim(),
          }))
        : [];
    if (size > 1 && roster.length !== size) {
      setFormError('visitor.listSize');
      return;
    }
    if (new Set(roster.map((m) => m.identityNumber)).size !== roster.length) {
      setFormError('visitor.duplicate');
      return;
    }
    const from = new Date(String(f.get('validFrom'))),
      until = new Date(String(f.get('validUntil')));
    if (!(until > from) || until.getTime() <= Date.now()) {
      setFormError('visitor.datesInvalid');
      return;
    }
    const details = {
      visitorName: String(f.get('visitorName')).trim(),
      company: String(f.get('company')).trim(),
      contact: String(f.get('contact')).trim(),
      hostName: selectedManager.displayName,
      siteManagerId: selectedManager.id,
      purpose: String(f.get('purpose')).trim(),
      targetArea: String(f.get('targetArea')).trim(),
      groupSize: size,
      members: roster,
      zoneIds: f.getAll('zoneIds').map(String),
      gateId: String(f.get('gateId')),
      email: String(f.get('email')).trim(),
      language: uiLanguage(),
      validFrom: from.toISOString(),
      validUntil: until.toISOString(),
    };
    const previous = attempt?.input;
    const same =
      attempt?.siteId === selectedSiteId &&
      previous &&
      JSON.stringify({
        ...details,
        requestId: previous.requestId,
        accessKey: previous.accessKey,
      }) === JSON.stringify(previous);
    const input: CreateVisitCommand = {
      ...details,
      requestId: same ? previous.requestId : crypto.randomUUID(),
      accessKey: same
        ? previous.accessKey
        : Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
            b.toString(16).padStart(2, '0'),
          ).join(''),
    };
    const request = { siteId: selectedSiteId, input };
    setAttempt(request);
    register.mutate(request);
  };
  const shareUrl = reference
    ? `${window.location.origin}${window.location.pathname}#visitor-pass=${reference.visitId}.${reference.accessKey}`
    : '';
  const textField = (name: string, key: string, required = true, maxLength = 255) => (
    <label className="block text-xs font-bold text-slate-700">
      {t(key)}
      <input name={name} required={required} maxLength={maxLength} className={field} />
    </label>
  );
  return (
    <div className="min-h-screen bg-slate-50/70 px-4 py-8 sm:px-6">
      {/* Top Navigation */}
      <header className="mx-auto mb-8 flex max-w-4xl flex-wrap items-center justify-between gap-4 border-b border-slate-200/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-orange-600 to-amber-500 text-white font-black shadow-xs">
            S
          </div>
          <div>
            <div className="font-black text-slate-900 tracking-tight leading-none text-base">
              Smart<span className="text-orange-600">Site</span>
            </div>
            <p className="text-[11px] font-semibold text-slate-500 mt-0.5">{t('visitor.portal')}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="text-xs font-semibold text-slate-600 hover:text-orange-600 hover:underline transition-colors"
            onClick={onBack}
          >
            {t('visitor.login')}
          </button>
          <LanguageSwitcher />
        </div>
      </header>

      {/* Main Content Card */}
      <main className="mx-auto max-w-4xl rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm sm:p-10">
        {/* Banner */}
        <div className="border-b border-slate-100 pb-6 mb-8">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700 border border-orange-200/70 uppercase tracking-wider">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
            {t('visitor.badge')}
          </span>
          <h1 className="mt-3 text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            {t('visitor.title')}
          </h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed max-w-2xl">
            {t('visitor.intro')}
          </p>
        </div>

        {reference ? (
          <div className="space-y-8">
            {/* Tracking Link Box */}
            <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">{t('visitor.saveLink')}</h2>
                <span className="text-[11px] font-medium text-slate-500">
                  {tr('integrated_ui.private_url')}
                </span>
              </div>
              <p className="text-xs text-slate-600">{t('visitor.linkHint')}</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  className={`${field} mt-0 flex-1 font-mono text-xs text-slate-600 select-all`}
                  aria-label={t('visitor.link')}
                  readOnly
                  value={shareUrl}
                />
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#071A2B] hover:bg-[#112D4E] text-white px-4 py-2.5 text-xs font-bold shadow-xs transition-all active:scale-[0.99] shrink-0 cursor-pointer"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(shareUrl)
                      .then(() => {
                        setCopiedLink(true);
                        setMessage('visitor.copied');
                        setTimeout(() => setCopiedLink(false), 2500);
                      })
                      .catch(() => setMessage('visitor.copyFallback'));
                  }}
                >
                  {copiedLink ? (
                    <>
                      <svg
                        className="w-4 h-4 text-emerald-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      <span className="text-emerald-300 font-bold">{t('visitor.tokenCopied')}</span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-4 h-4 text-slate-300"
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
                      <span className="font-bold">{t('visitor.copyLink')}</span>
                    </>
                  )}
                </button>
              </div>
              {message && (
                <p role="status" className="text-xs font-semibold text-emerald-700 animate-fadeIn">
                  {t(message)}
                </p>
              )}
            </section>

            {pass.isPending && (
              <div className="flex items-center gap-2 p-4 rounded-2xl bg-slate-50 text-slate-600 text-sm">
                <div className="h-4 w-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                <p role="status">{t('visitor.checking')}</p>
              </div>
            )}
            {pass.error && (
              <p
                role="alert"
                className="p-4 rounded-2xl bg-rose-50 text-rose-700 text-sm border border-rose-200"
              >
                {visitorError(pass.error)}
              </p>
            )}

            {pass.data && (
              <section className="space-y-6">
                {/* Status Hero Card */}
                <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 shadow-2xs">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-black text-slate-900">
                        {t('visitor.summary', {
                          name: pass.data.visit.visitorName,
                          count: pass.data.visit.groupSize,
                        })}
                      </h2>
                      <p className="mt-1 text-xs text-slate-500">
                        {pass.data.visit.company ? `${pass.data.visit.company} · ` : ''}
                        {pass.data.visit.contact}
                      </p>
                    </div>

                    <span
                      className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wider ${
                        pass.data.visit.status === 'APPROVED'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : pass.data.visit.status === 'PENDING'
                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                            : 'bg-rose-50 text-rose-800 border border-rose-200'
                      }`}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          pass.data.visit.status === 'APPROVED'
                            ? 'bg-emerald-500'
                            : pass.data.visit.status === 'PENDING'
                              ? 'bg-amber-500 animate-pulse'
                              : 'bg-rose-500'
                        }`}
                      />
                      {t('visitor.status', { status: t('visitor.' + pass.data.visit.status) })}
                    </span>
                  </div>

                  {pass.data.visit.email && (
                    <div className="mt-4 flex items-center gap-2 rounded-xl bg-white border border-slate-200/80 p-3 text-xs text-slate-600">
                      <svg
                        className="w-4 h-4 text-slate-400 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                        />
                      </svg>
                      <span className="font-medium text-slate-900">{pass.data.visit.email}</span>
                      <span className="text-slate-400">·</span>
                      <p role="status" className="font-semibold text-orange-950">
                        {t(
                          'visitor.emailStatus.' + (pass.data.visit.emailStatus ?? 'NOT_REQUESTED'),
                        )}
                      </p>
                    </div>
                  )}

                  {/* Visit Details Grid */}
                  <dl className="mt-5 grid gap-3 text-xs sm:grid-cols-2 pt-4 border-t border-slate-100">
                    <div className="rounded-xl bg-slate-50/70 p-3">
                      <dt className="text-slate-500 font-semibold">{t('visitor.site')}</dt>
                      <dd className="mt-1 font-bold text-slate-900">
                        {sites.data?.items.find((s) => s.id === pass.data?.visit.siteId)?.name ??
                          pass.data.visit.siteId}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50/70 p-3">
                      <dt className="text-slate-500 font-semibold">{t('visitor.host')}</dt>
                      <dd className="mt-1 font-bold text-slate-900">{pass.data.visit.hostName}</dd>
                    </div>
                    <div className="rounded-xl bg-slate-50/70 p-3">
                      <dt className="text-slate-500 font-semibold">{t('visitor.area')}</dt>
                      <dd className="mt-1 font-bold text-slate-900">
                        {pass.data.visit.targetArea}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50/70 p-3">
                      <dt className="text-slate-500 font-semibold">{t('visitor.schedule')}</dt>
                      <dd className="mt-1 font-bold text-slate-900">
                        {new Date(pass.data.visit.validFrom).toLocaleString(uiLocale())} –{' '}
                        {new Date(pass.data.visit.validUntil).toLocaleString(uiLocale())}
                      </dd>
                    </div>
                  </dl>

                  {/* Headcount pill */}
                  <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 border border-slate-200/80 p-3 text-xs font-semibold">
                    <span className="text-slate-500 font-bold">{t('visitor.presenceOnSite')}</span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200/80 px-2 py-0.5 text-[11px] font-bold">
                      {t('visitor.headcountIn', { count: pass.data.visit.enteredCount })}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 text-[11px] font-bold">
                      {t('visitor.headcountOut', { count: pass.data.visit.exitedCount })}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 text-sky-800 border border-sky-200/80 px-2 py-0.5 text-[11px] font-bold">
                      {t('visitor.headcountCurrent', {
                        count: Math.max(
                          0,
                          pass.data.visit.enteredCount - pass.data.visit.exitedCount,
                        ),
                      })}
                    </span>
                  </div>
                </div>

                {/* QR Card Container */}
                {pass.data.pass ? (
                  <div className="py-2">
                    <QrPassCard pass={pass.data.pass} onRefresh={() => void pass.refetch()} />
                  </div>
                ) : (
                  pass.data.visit.status === 'APPROVED' && (
                    <p className="rounded-xl bg-slate-100 p-4 text-center text-sm font-semibold text-slate-600">
                      {t('visitor.concluded')}
                    </p>
                  )
                )}
              </section>
            )}

            <div className="flex flex-wrap gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#F66B17] hover:bg-[#E05A0A] text-white px-4 py-2.5 text-xs font-bold shadow-xs transition-all active:scale-[0.99] cursor-pointer disabled:opacity-50"
                disabled={pass.isFetching}
                onClick={() => void pass.refetch()}
              >
                <svg
                  className={`w-3.5 h-3.5 ${pass.isFetching ? 'animate-spin' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                {t('visitor.refresh')}
              </button>
              <button
                type="button"
                className={button}
                onClick={() => {
                  setReference(null);
                  setAttempt(null);
                  setGroupSize('1');
                  setMembers([]);
                  setImported(0);
                  setImportError(null);
                  setFormError('');
                  register.reset();
                  setMessage('');
                  window.history.replaceState(null, '', window.location.pathname);
                }}
              >
                {t('visitor.new')}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-8">
            {/* Step 1: Representative & Group Information */}
            <fieldset
              className="space-y-5 rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-7 shadow-2xs"
              disabled={register.isPending || importing}
            >
              <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-orange-100 text-xs font-black text-orange-700">
                  1
                </span>
                <legend className="text-sm font-bold text-slate-900">
                  {t('visitor.guestSection')}
                </legend>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {textField('visitorName', 'visitor.name')}
                {textField('company', 'visitor.company', false)}
                {textField('contact', 'visitor.contact')}
                <label className="block text-xs font-bold text-slate-700">
                  {t('visitor.groupSize')}
                  <input
                    className={`${field} font-semibold`}
                    name="groupSize"
                    type="number"
                    required
                    min={1}
                    max={1000}
                    value={groupSize}
                    onChange={(e) => resize(e.target.value)}
                  />
                </label>
              </div>

              {/* Email with delivery badge note */}
              <div className="space-y-1.5 pt-1">
                <label className="block text-xs font-bold text-slate-700">
                  {t('visitor.email')}
                  <div className="relative mt-1">
                    <input
                      className={field}
                      type="email"
                      name="email"
                      required
                      maxLength={254}
                      placeholder={tr('integrated_ui.visitor_example_com')}
                    />
                  </div>
                </label>
                <p className="text-[11px] text-slate-500">{t('visitor.permanentHint')}</p>
              </div>

              {/* Step 1.2: Roster List & Excel Import */}
              <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 sm:p-5 mt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xs font-black uppercase tracking-wider text-slate-700">
                      {t('visitor.members')} ({groupSize})
                    </h2>
                    <p className="text-[11px] text-slate-500 mt-0.5">{t('visitor.groupHint')}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={button}
                      onClick={() => {
                        void downloadVisitorTemplate().catch(() =>
                          setImportError(new Error(t('visitor.importInvalid'))),
                        );
                      }}
                    >
                      <svg
                        className="w-3.5 h-3.5 text-emerald-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      {t('visitor.template')}
                    </button>

                    <label className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-xs font-semibold text-orange-800 shadow-2xs transition-all hover:bg-orange-100/80 hover:border-orange-300 active:scale-[0.99] cursor-pointer">
                      <svg
                        className="w-3.5 h-3.5 text-orange-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                        />
                      </svg>
                      {t('visitor.import')}
                      <input
                        aria-label={t('visitor.import')}
                        className="sr-only"
                        type="file"
                        accept=".xlsx"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = '';
                          if (!file) return;
                          const generation = ++importGeneration.current;
                          setImportError(null);
                          setImported(0);
                          setImporting(true);
                          void readVisitorExcel(file)
                            .then((list) => {
                              if (generation !== importGeneration.current) return;
                              setMembers(list);
                              setGroupSize(String(list.length));
                              setImported(list.length);
                            })
                            .catch((error: unknown) => {
                              if (generation === importGeneration.current)
                                setImportError(
                                  error instanceof Error
                                    ? error
                                    : new Error(t('visitor.importInvalid')),
                                );
                            })
                            .finally(() => setImporting(false));
                        }}
                      />
                    </label>
                  </div>
                </div>

                {imported > 0 && (
                  <p
                    role="status"
                    className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs font-semibold text-emerald-800 flex items-center gap-2"
                  >
                    <svg
                      className="w-4 h-4 text-emerald-600 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    {t('visitor.imported', { count: imported })}
                  </p>
                )}

                {importError && (
                  <p
                    role="alert"
                    className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-800"
                  >
                    {localizeMessage(importError.message)}
                  </p>
                )}

                {Number(groupSize) > 1 && (
                  <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
                    {members.map((m, i) => (
                      <div
                        key={i}
                        className="relative rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs grid gap-3 sm:grid-cols-2"
                      >
                        <span className="col-span-full text-[11px] font-bold text-slate-400">
                          #{i + 1} {i === 0 ? `(${t('visitor.name')})` : ''}
                        </span>
                        <label className="text-xs font-bold text-slate-700">
                          {t('visitor.memberName', { number: i + 1 })}
                          <input
                            className={field}
                            required
                            maxLength={255}
                            value={m.fullName}
                            placeholder={t('visitor.memberNamePlaceholder')}
                            onChange={(e) =>
                              setMembers((old) =>
                                old.map((v, j) =>
                                  j === i ? { ...v, fullName: e.target.value } : v,
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="text-xs font-bold text-slate-700">
                          {t('visitor.memberId', { number: i + 1 })}
                          <input
                            className={`${field} font-mono`}
                            required
                            inputMode="numeric"
                            pattern="[0-9]{12}"
                            minLength={12}
                            maxLength={12}
                            placeholder="001099000123"
                            value={m.identityNumber}
                            onChange={(e) =>
                              setMembers((old) =>
                                old.map((v, j) =>
                                  j === i ? { ...v, identityNumber: e.target.value } : v,
                                ),
                              )
                            }
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </fieldset>

            {importing && (
              <div className="flex items-center gap-2 p-3 text-xs text-slate-600 bg-slate-50 rounded-xl">
                <div className="h-3.5 w-3.5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                <p role="status">{t('visitor.importing')}</p>
              </div>
            )}

            {/* Step 2: Site & Destination Details */}
            <fieldset
              className="space-y-5 rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-7 shadow-2xs"
              disabled={register.isPending}
            >
              <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-orange-100 text-xs font-black text-orange-700">
                  2
                </span>
                <legend className="text-sm font-bold text-slate-900">
                  {t('visitor.siteSection')}
                </legend>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs font-bold text-slate-700">
                  {t('visitor.site')}
                  <select
                    className={field}
                    required
                    value={selectedSiteId}
                    onChange={(e) => setSiteId(e.target.value)}
                  >
                    <option value="">{t('visitor.selectSite')}</option>
                    {sites.data?.items.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs font-bold text-slate-700">
                  {t('visitor.gate')}
                  <select className={field} name="gateId">
                    {SITE_GATES.map((g, i) => (
                      <option key={g.id} value={g.id}>
                        {t('visitor.gateName', { number: i + 1 })}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs font-bold text-slate-700">
                  {t('visitor.host')}
                  <select
                    key={selectedSiteId}
                    name="siteManagerId"
                    className={field}
                    required
                    disabled={managers.isPending || !!managers.error}
                    defaultValue=""
                  >
                    <option value="">{t('visitor.selectManager')}</option>
                    {managers.data?.items.map((manager) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                {textField('targetArea', 'visitor.area')}

                <div className="sm:col-span-2">
                  {textField('purpose', 'visitor.purpose', true, 1000)}
                </div>
              </div>

              {sites.isPending && (
                <p role="status" className="text-xs text-slate-500">
                  {t('visitor.loadingSites')}
                </p>
              )}
              {sites.error && (
                <p role="alert" className="text-xs font-semibold text-rose-700">
                  {visitorError(sites.error)}{' '}
                  <button type="button" className="underline" onClick={() => void sites.refetch()}>
                    {t('visitor.retry')}
                  </button>
                </p>
              )}
              {sites.data?.items.length === 0 && (
                <p className="text-xs text-slate-500">{t('visitor.noSites')}</p>
              )}
              {managers.isPending && selectedSiteId && (
                <p role="status" className="text-xs text-slate-500">
                  {t('visitor.loadingManagers')}
                </p>
              )}
              {managers.error && (
                <p role="alert" className="text-xs font-semibold text-rose-700">
                  {t('visitor.managersError')}{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void managers.refetch()}
                  >
                    {t('visitor.retry')}
                  </button>
                </p>
              )}
              {managers.data?.items.length === 0 && (
                <p role="alert" className="text-xs text-amber-700">
                  {t('visitor.noManagers')}
                </p>
              )}

              {/* Zones */}
              <fieldset key={selectedSiteId} className="space-y-2 pt-2 border-t border-slate-100">
                <legend className="text-xs font-bold text-slate-700">{t('visitor.zones')}</legend>
                {zones.isPending && selectedSiteId && (
                  <p role="status" className="text-xs text-slate-500">
                    {t('visitor.loadingZones')}
                  </p>
                )}
                {zones.error && (
                  <p role="alert" className="text-xs font-semibold text-rose-700">
                    {t('visitor.zonesError')}{' '}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void zones.refetch()}
                    >
                      {t('visitor.retry')}
                    </button>
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {zones.data?.items.map((z) => (
                    <label
                      key={z.id}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-white hover:border-orange-300 transition-all cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        name="zoneIds"
                        value={z.id}
                        className="rounded text-orange-600 focus:ring-orange-400"
                      />
                      {z.name}
                    </label>
                  ))}
                </div>
                {zones.data?.items.length === 0 && (
                  <p className="text-xs text-slate-400">{t('visitor.noZones')}</p>
                )}
                <p className="text-[11px] text-slate-400 pt-1">{t('visitor.zoneHint')}</p>
              </fieldset>
            </fieldset>

            {/* Step 3: Schedule */}
            <fieldset
              className="space-y-5 rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-7 shadow-2xs"
              disabled={register.isPending}
            >
              <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-orange-100 text-xs font-black text-orange-700">
                  3
                </span>
                <legend className="text-sm font-bold text-slate-900">
                  {t('visitor.scheduleSection')}
                </legend>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs font-bold text-slate-700">
                  {t('visitor.from')}
                  <input
                    className={field}
                    name="validFrom"
                    type="datetime-local"
                    required
                    defaultValue={schedule.from}
                  />
                </label>
                <label className="block text-xs font-bold text-slate-700">
                  {t('visitor.until')}
                  <input
                    className={field}
                    name="validUntil"
                    type="datetime-local"
                    required
                    defaultValue={schedule.until}
                  />
                </label>
              </div>
            </fieldset>

            {formError && (
              <p
                role="alert"
                className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-800"
              >
                {t(formError)}
              </p>
            )}
            {register.error && (
              <p
                role="alert"
                className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-800"
              >
                {visitorError(register.error)}
              </p>
            )}

            <button
              type="submit"
              disabled={register.isPending || importing || !sites.data?.items.length}
              className="w-full rounded-2xl bg-gradient-to-r from-orange-600 to-amber-600 px-6 py-4 font-black text-sm text-white shadow-md hover:from-orange-700 hover:to-amber-700 active:scale-[0.99] transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
            >
              {register.isPending && (
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              {t(register.isPending ? 'visitor.submitting' : 'visitor.submit')}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
