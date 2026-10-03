import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
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
} from '../icons';
import { QrPassCard } from './QrPassCard';

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
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
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
      <div className="mx-auto max-w-3xl mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FF7A1A] text-white font-black text-sm">
            S
          </div>
          <span className="font-bold text-slate-900 tracking-tight">
            Smart<span className="text-[#FF7A1A]">Site</span>
          </span>
          <span className="text-slate-300">|</span>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Visitor Portal
          </span>
        </div>

        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 underline transition-colors"
        >
          <span>Staff / Security / Site Manager Login</span>
        </button>
      </div>

      <main className="mx-auto max-w-3xl space-y-6 rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-10 shadow-sm">
        {/* Header Hero */}
        <div className="space-y-2 border-b border-slate-100 pb-6">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#FF7A1A] border border-orange-100">
            <IconKey className="h-3.5 w-3.5" />
            Temporary Access Pass
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
            Visitor Site Registration
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            One representative for an individual or entire party. Requests are routed to the Site
            Manager of the selected site for clearance.
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
                  Save Tracking Link
                </span>
                {message && (
                  <span role="status" className="text-xs font-semibold text-emerald-700 flex items-center gap-1">
                    <IconCheck className="h-3.5 w-3.5" />
                    {message}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Save this link to check approval status and access your QR pass on mobile.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  aria-label="Visitor Pass Tracking Link"
                  readOnly
                  value={shareUrl}
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-xs text-slate-800 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(shareUrl)
                      .then(() => setMessage('Copied to clipboard.'))
                      .catch(() => setMessage('Select and copy the URL above.'));
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition-all shadow-xs"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  <span>Copy Tracking Link</span>
                </button>
              </div>
            </div>

            {/* Loading / Error States */}
            {pass.isPending && (
              <div role="status" className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500">
                <IconLoader className="h-4 w-4" />
                <span>Checking approval status…</span>
              </div>
            )}

            {pass.error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700"
              >
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                <span>{pass.error.message}</span>
              </div>
            )}

            {/* Visit Details & Pass */}
            {pass.data && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-4">
                    <div>
                      <h2 className="text-xl font-bold tracking-tight text-slate-900">
                        {pass.data.visit.visitorName} · {pass.data.visit.groupSize} visitors
                      </h2>
                      <p className="mt-1 text-xs text-slate-500">
                        Site:{' '}
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
                          Status:{' '}
                          {pass.data.visit.status === 'PENDING'
                            ? 'Pending Site Manager Approval'
                            : pass.data.visit.status === 'APPROVED'
                              ? 'Approved'
                              : 'Rejected'}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
                    <div className="rounded-xl bg-slate-50 p-3 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Target Area & Host Contact
                      </span>
                      <p className="text-slate-800 font-semibold">
                        Area: {pass.data.visit.targetArea} · Host: {pass.data.visit.hostName}
                      </p>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Authorized Schedule
                      </span>
                      <p className="font-mono text-slate-800">
                        {new Date(pass.data.visit.validFrom).toLocaleString()} –{' '}
                        {new Date(pass.data.visit.validUntil).toLocaleString()}
                      </p>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3 sm:col-span-2 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Entry / Exit Headcount
                      </span>
                      <p className="font-medium text-slate-800">
                        In: {pass.data.visit.enteredCount} · Out: {pass.data.visit.exitedCount} · On-site:{' '}
                        <span className="font-bold text-[#FF7A1A]">
                          {pass.data.visit.enteredCount - pass.data.visit.exitedCount}
                        </span>{' '}
                        visitors in site
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
                        Visit pass has concluded or expired.
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
                <span>Check Status / Refresh QR</span>
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
                <span>Register New Visit</span>
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
                1. Site & Designated Gate
              </h3>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="sm:col-span-2 block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Registration Site
                  <select
                    required
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs font-semibold text-slate-900 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                    value={siteId || sites.data?.items[0]?.id || ''}
                    onChange={(e) => setSiteId(e.target.value)}
                  >
                    <option value="">Select site</option>
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
                    <span>Loading sites…</span>
                  </div>
                )}

                {sites.error && (
                  <div role="alert" className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 sm:col-span-2">
                    <span>{sites.error.message}</span>
                    <button
                      type="button"
                      className="underline font-bold"
                      onClick={() => void sites.refetch()}
                    >
                      Retry
                    </button>
                  </div>
                )}

                <label className="sm:col-span-2 block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Designated Gate
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
                2. Representative Information
              </h3>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Representative Full Name
                  <input
                    name="visitorName"
                    required
                    maxLength={255}
                    placeholder="Full name of party representative"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                  />
                </label>

                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Company / Organization
                  <input
                    name="company"
                    maxLength={255}
                    placeholder="Company or agency name (optional)"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                  />
                </label>

                <label className="sm:col-span-2 block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Contact Phone / Email
                  <input
                    name="contact"
                    required
                    maxLength={255}
                    placeholder="Phone number or email address"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                  />
                </label>
              </div>
            </div>

            {/* Section 3: Visit Purpose & Host Info */}
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#FF7A1A] flex items-center gap-1.5">
                <IconShield className="h-3.5 w-3.5" />
                3. Host & Visit Purpose
              </h3>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Host Contact at Site
                  <input
                    name="hostName"
                    required
                    maxLength={255}
                    placeholder="Name of site host / supervising engineer"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                  />
                </label>

                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Target Visit Area
                  <input
                    name="targetArea"
                    required
                    maxLength={255}
                    placeholder="e.g. Building A, Admin Block, Foundation..."
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                  />
                </label>

                <label className="sm:col-span-2 block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Visit Purpose
                  <input
                    name="purpose"
                    required
                    maxLength={1000}
                    placeholder="Reason for site entry or official inspection..."
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                  />
                </label>
              </div>
            </div>

            {/* Section 4: Schedule and Group Size */}
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#FF7A1A] flex items-center gap-1.5">
                <IconCalendar className="h-3.5 w-3.5" />
                4. Schedule & Headcount
              </h3>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Total Visitors (Headcount)
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
                  Valid From
                  <input
                    name="validFrom"
                    type="datetime-local"
                    defaultValue={schedule.from}
                    required
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                  />
                </label>

                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Valid Until
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
                <span>{register.error.message}</span>
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
                    <span>Submitting…</span>
                  </>
                ) : (
                  <>
                    <IconCheck className="h-4 w-4" />
                    <span>Submit for Site Manager Approval</span>
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
