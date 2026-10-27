import { useManagementClient } from '../../../features/auth/auth-session';
import { translate as tr } from '../../../i18n';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  VisitResponse,
  VisitorGateCommand,
  VisitorQrPreviewResponse,
  VisitorGateEventResponse,
} from '@smartsite/contracts';
import { SITE_GATES } from '@smartsite/contracts/gate-permissions';
import { useTranslation } from 'react-i18next';
import { uiLocale } from '../../../i18n';
import { QrScannerView } from '../gate/QrScannerView';
import { visitorError } from '../visitor-error';
import {
  IconCheck,
  IconX,
  IconEye,
  IconSearch,
  IconKey,
  IconClock,
  IconCalendar,
  IconUsers,
  IconAlertTriangle,
  IconBuilding,
} from '../../icons';

const field =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 transition-all shadow-2xs hover:border-slate-300 focus:border-[#F66B17] focus:outline-none focus:ring-2 focus:ring-orange-100 disabled:bg-slate-50 disabled:text-slate-500';

type Selection = {
  memberId: string;
  fullName: string;
  identityNumber: string;
  selected: boolean;
  eligible: boolean;
};

function formatSchedule(from: string, until: string, locale: string) {
  try {
    const dFrom = new Date(from);
    const dUntil = new Date(until);
    const sameDay = dFrom.toDateString() === dUntil.toDateString();
    const timeFrom = dFrom.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const timeUntil = dUntil.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const dateStr = dFrom.toLocaleDateString(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    if (sameDay) {
      return `${dateStr} · ${timeFrom} – ${timeUntil}`;
    }
    const dateUntilStr = dUntil.toLocaleDateString(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    return `${dateStr} ${timeFrom} – ${dateUntilStr} ${timeUntil}`;
  } catch {
    return `${from} – ${until}`;
  }
}

export type VisitorAccessMode = 'all' | 'approvals' | 'gate' | 'observer';

type StatusFilter = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';

function getPresenceInfo(
  v: VisitResponse,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const inside = Math.max(0, v.enteredCount - v.exitedCount);
  if (v.presence === 'NEEDS_REVIEW') {
    return {
      statusText: t('visitor.presenceNeedsReview'),
      badgeClass: 'bg-amber-100 text-amber-900 border-amber-300 font-bold',
      isInside: inside > 0,
      inside,
    };
  }
  if (v.enteredCount === 0) {
    return {
      statusText: t('visitor.presenceNotEntered'),
      badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
      isInside: false,
      inside: 0,
    };
  }
  if (v.enteredCount > v.exitedCount) {
    return {
      statusText: t('visitor.presenceOnSiteWithCount', { inside, groupSize: v.groupSize }),
      badgeClass: 'bg-sky-50 text-sky-800 border-sky-300 font-bold',
      isInside: true,
      inside,
    };
  }
  return {
    statusText: t('visitor.presenceCheckedOut'),
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    isInside: false,
    inside: 0,
  };
}

export interface VisitorAccessViewProps {
  apiUrl: string;
  token: string;
  siteId: string;
  siteName?: string;
  sessionScope: string;
  canApprove: boolean;
  canManualCheckout?: boolean;
  mode?: VisitorAccessMode;
}

export function VisitorAccessView({
  apiUrl,
  token,
  siteId,
  siteName,
  sessionScope,
  canApprove,
  canManualCheckout = false,
  mode: propMode,
}: VisitorAccessViewProps) {
  const { t } = useTranslation();
  const client = useManagementClient(apiUrl);
  const cache = useQueryClient();
  const key = ['access-control', apiUrl, sessionScope, 'visits', siteId];
  const historyKey = ['access-control', apiUrl, sessionScope, 'visitor-events', siteId];

  const mode: VisitorAccessMode =
    propMode ??
    (canApprove
      ? canManualCheckout
        ? 'all'
        : 'approvals'
      : canManualCheckout
        ? 'gate'
        : 'observer');
  const canApproveEffective = mode !== 'gate' && mode !== 'observer' && canApprove;
  const canManualCheckoutEffective =
    mode !== 'approvals' && mode !== 'observer' && canManualCheckout;
  const canScan = canManualCheckoutEffective;
  const visits = useQuery({
    queryKey: key,
    queryFn: () => client.listVisits(token, siteId),
    refetchInterval: 15_000,
  });

  const history = useQuery({
    queryKey: historyKey,
    queryFn: () => client.listVisitorEvents(token, siteId),
    refetchInterval: 15_000,
  });

  // State
  const [qrToken, setQrToken] = useState('');
  const [gateId, setGateId] = useState<string>(SITE_GATES[0].id);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [onSiteOnly, setOnSiteOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [viewSection, setViewSection] = useState<'all' | 'visits' | 'gate' | 'history'>('all');
  const [viewStyle, setViewStyle] = useState<'table' | 'cards'>('table');

  // Modals
  const [detailVisit, setDetailVisit] = useState<VisitResponse | null>(null);
  const [rejectVisit, setRejectVisit] = useState<VisitResponse | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [cancelVisit, setCancelVisit] = useState<VisitResponse | null>(null);
  const [cancelNote, setCancelNote] = useState('');
  const [manualCheckoutVisit, setManualCheckoutVisit] = useState<VisitResponse | null>(null);
  const [manualCheckoutNote, setManualCheckoutNote] = useState('');
  const [representativeConfirmed, setRepresentativeConfirmed] = useState(false);

  // Scanner state
  const [preview, setPreview] = useState<{
    siteId: string;
    gateId: string;
    qrToken: string;
    data: VisitorQrPreviewResponse;
  } | null>(null);
  const [selection, setSelection] = useState<Selection[]>([]);
  const [recorded, setRecorded] = useState<VisitorGateEventResponse | null>(null);
  const [selectionError, setSelectionError] = useState('');
  const pending = useRef<{ fingerprint: string; input: VisitorGateCommand } | null>(null);
  const manualRetry = useRef<{ fingerprint: string; id: string } | null>(null);

  const invalidate = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: key }),
      cache.invalidateQueries({ queryKey: historyKey }),
    ]);

  const decide = useMutation({
    mutationFn: ({
      id,
      status,
      version,
      reviewNote,
    }: {
      id: string;
      status: 'APPROVED' | 'REJECTED' | 'CANCELLED';
      version?: number;
      reviewNote?: string;
    }) =>
      client.decideVisit(token, siteId, id, status, {
        expectedVersion: version,
        reviewNote: reviewNote?.trim() || undefined,
      }),
    onSuccess: () => {
      setRejectVisit(null);
      setRejectNote('');
      setCancelVisit(null);
      setCancelNote('');
      if (detailVisit) setDetailVisit(null);
      return invalidate();
    },
  });

  const retryEmail = useMutation({
    mutationFn: (visitId: string) => client.retryVisitorEmail(token, siteId, visitId),
    onSuccess: invalidate,
  });

  const manualCheckout = useMutation({
    mutationFn: ({ visitId, note }: { visitId: string; note: string }) => {
      const fingerprint = JSON.stringify([siteId, visitId, note.trim()]);
      if (manualRetry.current?.fingerprint !== fingerprint)
        manualRetry.current = { fingerprint, id: crypto.randomUUID() };
      return client.manualVisitCheckout(token, siteId, visitId, {
        requestId: manualRetry.current.id,
        reviewNote: note.trim(),
        representativeConfirmed: true,
      });
    },
    onSuccess: () => {
      manualRetry.current = null;
      setRepresentativeConfirmed(false);
      setManualCheckoutVisit(null);
      setManualCheckoutNote('');
      return invalidate();
    },
  });

  const load = useMutation({
    mutationFn: (context: { siteId: string; gateId: string; qrToken: string }) =>
      client.previewVisitorQr(token, context.siteId, context.gateId, context.qrToken),
    onSuccess: (data, context) => {
      setPreview({ ...context, data });
      setSelectionError('');
      setSelection(
        (data.visit.members ?? []).map((m) => ({
          memberId: m.id,
          fullName: m.fullName,
          identityNumber: m.identityNumber,
          eligible: data.direction === 'IN' ? !m.inside : m.inside,
          selected: data.direction === 'OUT' && m.inside,
        })),
      );
    },
  });

  const verify = useMutation({
    mutationFn: ({
      siteId: site,
      gateId: gate,
      input,
    }: {
      siteId: string;
      gateId: string;
      input: VisitorGateCommand;
    }) => client.verifyVisitorQr(token, site, gate, input),
    onSuccess: (r) => {
      setRecorded(r);
      setQrToken('');
      setPreview(null);
      setSelection([]);
      pending.current = null;
      return invalidate();
    },
  });

  const active =
    preview?.siteId === siteId && preview.gateId === gateId && preview.qrToken === qrToken.trim()
      ? preview.data
      : null;
  const roster = active?.visit.members ?? [];
  const selected = selection.filter((m) => m.selected && m.eligible);

  const confirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!active) return;
    setSelectionError('');
    const attendees = selected.map(({ memberId, fullName, identityNumber }) => ({
      memberId,
      fullName: fullName.trim(),
      identityNumber: identityNumber.trim(),
    }));
    if (roster.length && !attendees.length) {
      setSelectionError('VISITOR_ATTENDANCE_SIZE');
      return;
    }
    const details = {
      token: qrToken.trim(),
      direction: active.direction,
      expectedVersion: active.visit.version,
      ...(roster.length ? { attendees } : {}),
    };
    const fingerprint = JSON.stringify([siteId, gateId, details]);
    const input =
      pending.current?.fingerprint === fingerprint
        ? pending.current.input
        : { ...details, requestId: crypto.randomUUID() };
    pending.current = { fingerprint, input };
    setRecorded(null);
    verify.mutate({ siteId, gateId, input });
  };

  const startLoad = (value = qrToken.trim(), gate = gateId) => {
    if (!value) return;
    setPreview(null);
    setSelection([]);
    setRecorded(null);
    verify.reset();
    load.mutate({ siteId, gateId: gate, qrToken: value });
  };

  const items = useMemo(() => visits.data?.items ?? [], [visits.data]);
  const pendingVisits = useMemo(() => items.filter((v) => v.status === 'PENDING'), [items]);
  const approvedVisits = useMemo(() => items.filter((v) => v.status === 'APPROVED'), [items]);
  const rejectedVisits = useMemo(() => items.filter((v) => v.status === 'REJECTED'), [items]);
  const cancelledVisits = useMemo(() => items.filter((v) => v.status === 'CANCELLED'), [items]);
  const expiredVisits = useMemo(() => items.filter((v) => v.status === 'EXPIRED'), [items]);
  const insideVisits = useMemo(() => items.filter((v) => v.enteredCount > v.exitedCount), [items]);
  const onSiteCount = useMemo(
    () => items.reduce((sum, v) => sum + Math.max(0, v.enteredCount - v.exitedCount), 0),
    [items],
  );

  const summary = useMemo(() => {
    if (visits.data?.summary) {
      return visits.data.summary;
    }
    return {
      totalVisits: visits.data?.total ?? items.length,
      pendingVisits: pendingVisits.length,
      approvedValidVisits: approvedVisits.length,
      onSitePeople: onSiteCount,
    };
  }, [visits.data, items, pendingVisits, approvedVisits, onSiteCount]);

  const filtered = useMemo(() => {
    return items.filter((v) => {
      const matchesStatus = statusFilter === 'ALL' || v.status === statusFilter;
      const matchesOnSite = !onSiteOnly || v.enteredCount > v.exitedCount;
      const query = search.trim().toLowerCase();
      const matchesSearch =
        !query ||
        `${v.visitorName} ${v.company ?? ''} ${v.contact} ${v.hostName} ${v.purpose}`
          .toLowerCase()
          .includes(query);
      return matchesStatus && matchesOnSite && matchesSearch;
    });
  }, [items, statusFilter, onSiteOnly, search]);

  const locale = uiLocale();

  return (
    <div className="space-y-5 text-[#2F3437]">
      {mode === 'observer' && (
        <p className="rounded-xl border bg-white p-3 text-sm font-semibold">
          {t('visitor.observerHint')}
        </p>
      )}
      {/* ── Header & Quick Stats ────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {mode === 'approvals' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#F66B17] border border-orange-200/60">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#F66B17]" />
                  {t('visitor.managerApproval')}
                </span>
              ) : mode === 'gate' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-sky-700 border border-sky-200/60">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-600" />
                  {t('visitor.securityGate')}
                </span>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#F66B17] border border-orange-200/60">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#F66B17]" />
                    {tr('integrated_ui.site_access_control')}
                  </span>
                  <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                    {t('visitor.managerAndGate')}
                  </span>
                </>
              )}
            </div>
            <h1 className="text-xl font-extrabold tracking-tight text-[#111111]">
              {mode === 'approvals'
                ? `${t('visitor.manageTitle')}${siteName ? ` — ${siteName}` : ''}`
                : mode === 'gate'
                  ? `${t('visitor.gateDeskTitle')}${siteName ? ` — ${siteName}` : ''}`
                  : t('visitor.accessTitle', { site: siteName ?? siteId })}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {canApproveEffective && (
              <a
                href="/visits/register"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#F66B17] hover:bg-[#E05A0A] px-3.5 py-2 text-xs font-bold text-white shadow-xs transition-all active:scale-[0.99] cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
                <span>{t('visitor.openPortal')}</span>
              </a>
            )}
          </div>
        </div>

        {/* Interactive Metric Cards */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              id: 'TOTAL',
              label: t('visitor.total'),
              count: summary.totalVisits,
              unit: t('visitor.unitVisits'),
              active: statusFilter === 'ALL' && !onSiteOnly,
              accent: 'text-slate-900',
              icon: IconUsers,
              onClick: () => {
                setStatusFilter('ALL');
                setOnSiteOnly(false);
              },
            },
            {
              id: 'PENDING',
              label: t('visitor.pending'),
              count: summary.pendingVisits,
              unit: t('visitor.unitVisits'),
              active: statusFilter === 'PENDING' && !onSiteOnly,
              accent: summary.pendingVisits > 0 ? 'text-amber-600' : 'text-slate-700',
              highlight: summary.pendingVisits > 0,
              icon: IconClock,
              onClick: () => {
                setStatusFilter('PENDING');
                setOnSiteOnly(false);
              },
            },
            {
              id: 'APPROVED',
              label: t('visitor.approvedValid'),
              count: summary.approvedValidVisits,
              unit: t('visitor.unitVisits'),
              active: statusFilter === 'APPROVED' && !onSiteOnly,
              accent: 'text-emerald-600',
              icon: IconCheck,
              onClick: () => {
                setStatusFilter('APPROVED');
                setOnSiteOnly(false);
              },
            },
            {
              id: 'INSIDE',
              label: t('visitor.inside'),
              count: summary.onSitePeople,
              unit: t('visitor.unitPeople'),
              active: onSiteOnly,
              accent: 'text-sky-600',
              icon: IconBuilding,
              onClick: () => {
                setOnSiteOnly(!onSiteOnly);
              },
            },
          ].map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  m.onClick();
                  if (viewSection === 'gate' || viewSection === 'history') setViewSection('visits');
                }}
                className={`rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                  m.active
                    ? 'border-[#071A2B] bg-slate-50/70 ring-2 ring-[#071A2B]/10 shadow-xs'
                    : m.highlight
                      ? 'border-amber-300 bg-amber-50/50 hover:border-amber-400'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between text-slate-500">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {m.label}
                  </span>
                  <Icon className="w-4 h-4 text-slate-400" />
                </div>
                <div className="mt-1.5 flex items-baseline gap-1.5">
                  <p className={`text-2xl font-black tracking-tight ${m.accent}`}>{m.count}</p>
                  <span className="text-xs font-semibold text-slate-400">{m.unit}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* View Section Navigation */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs">
          <div className="flex items-center gap-1 rounded-xl bg-slate-100/90 p-1">
            <button
              type="button"
              className={`rounded-lg px-3 py-1 font-bold transition-all cursor-pointer ${
                viewSection === 'all'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              onClick={() => setViewSection('all')}
            >
              {t('visitor.all')}
            </button>
            {canApproveEffective ? (
              <button
                type="button"
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 font-bold transition-all cursor-pointer ${
                  viewSection === 'visits'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                onClick={() => setViewSection('visits')}
              >
                <span>{t('visitor.tabVisitsAndApprovals')}</span>
                {pendingVisits.length > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-extrabold text-white">
                    {pendingVisits.length}
                  </span>
                )}
              </button>
            ) : (
              <button
                type="button"
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 font-bold transition-all cursor-pointer ${
                  viewSection === 'visits'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                onClick={() => setViewSection('visits')}
              >
                <span>{t('visitor.tabVisits')}</span>
                {insideVisits.length > 0 && (
                  <span className="rounded-full bg-sky-600 px-1.5 py-0.2 text-[10px] font-extrabold text-white">
                    {t('visitor.insideBadge', { count: insideVisits.length })}
                  </span>
                )}
              </button>
            )}
            {canScan && (
              <button
                type="button"
                className={`rounded-lg px-3 py-1 font-bold transition-all cursor-pointer ${
                  viewSection === 'gate'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                onClick={() => setViewSection('gate')}
              >
                {t('visitor.tabGate')}
              </button>
            )}
            <button
              type="button"
              className={`rounded-lg px-3 py-1 font-bold transition-all cursor-pointer ${
                viewSection === 'history'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              onClick={() => setViewSection('history')}
            >
              {t('visitor.tabHistory')}
            </button>
          </div>

          <div className="flex items-center gap-1 text-slate-500 text-xs">
            <span className="font-bold text-slate-800">
              {t('visitor.showingVisits', { count: filtered.length })}
            </span>
          </div>
        </div>
      </section>

      {/* ── PRIORITY APPROVAL QUEUE (CHỜ QUẢN LÝ DUYỆT) ────────────────── */}
      {canApproveEffective &&
        pendingVisits.length > 0 &&
        (viewSection === 'all' || viewSection === 'visits') && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 sm:p-5 shadow-xs space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200/80 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 border border-amber-200 text-amber-800 shrink-0">
                  <IconClock className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                      {t('visitor.needApproval')}
                    </h2>
                    <span className="rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-xs font-bold text-amber-900">
                      {t('visitor.needApprovalCount', { count: pendingVisits.length })}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{t('visitor.needApprovalHint')}</p>
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              {pendingVisits.map((v) => (
                <div
                  key={v.id}
                  className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 rounded-xl bg-white p-4 border border-amber-200/80 shadow-2xs hover:border-amber-300 transition-all"
                >
                  <div className="space-y-2 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-slate-900">{v.visitorName}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700 border border-slate-200">
                        {t('visitor.guests', { count: v.groupSize })}
                      </span>
                      {v.company && (
                        <span className="text-xs text-slate-500 font-medium">· {v.company}</span>
                      )}
                      {v.contact && (
                        <span className="text-xs text-slate-400 font-mono">({v.contact})</span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
                      <div>
                        <span className="text-slate-400 font-medium">{t('visitor.host')}: </span>
                        <span className="font-bold text-slate-700">{v.hostName}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 font-medium">{t('visitor.area')}: </span>
                        <span className="font-semibold text-slate-700">
                          {v.targetArea} ·{' '}
                          {t('visitor.gateName', {
                            number: SITE_GATES.findIndex((g) => g.id === v.gateId) + 1,
                          })}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 font-medium">
                          {t('visitor.schedule')}:{' '}
                        </span>
                        <span className="font-semibold text-slate-800">
                          {formatSchedule(v.validFrom, v.validUntil, locale)}
                        </span>
                      </div>
                    </div>

                    {v.purpose && (
                      <p className="text-xs text-slate-500 line-clamp-1 italic">
                        {t('visitor.purposeLabel')} {v.purpose}
                      </p>
                    )}
                  </div>

                  {/* Priority Actions */}
                  <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:border-slate-300 transition-all cursor-pointer"
                      onClick={() => setDetailVisit(v)}
                      title={t('visitor.viewDetails')}
                    >
                      <IconEye className="w-3.5 h-3.5" />
                      <span>
                        {t('visitor.viewDetails')} ({v.members?.length || v.groupSize || 1})
                      </span>
                    </button>

                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 px-3 py-1.5 text-xs font-bold transition-all shadow-2xs active:scale-[0.99] disabled:opacity-50 cursor-pointer"
                      disabled={decide.isPending}
                      onClick={() => {
                        setRejectVisit(v);
                        setRejectNote('');
                      }}
                    >
                      <IconX className="w-3.5 h-3.5" />
                      <span>{t('visitor.reject')}</span>
                    </button>

                    <button
                      type="button"
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 text-xs font-bold shadow-xs transition-all active:scale-[0.99] disabled:opacity-50 cursor-pointer"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({ id: v.id, status: 'APPROVED', version: v.version })
                      }
                    >
                      {decide.isPending ? (
                        <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <IconCheck className="w-3.5 h-3.5" />
                      )}
                      <span>{t('visitor.approve')}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

      {/* ── VISITOR PASSES LIST & MANAGEMENT ────────────────────────────── */}
      {(viewSection === 'all' || viewSection === 'visits') && (
        <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-extrabold text-slate-900">
                {t('visitor.listTitle', { count: filtered.length })}
              </h2>
              <p className="text-xs text-slate-500">{t('visitor.listSubtitle')}</p>
              {visits.data?.total !== undefined && items.length < visits.data.total && (
                <p className="mt-1 text-[11px] font-medium text-amber-700">
                  {t('visitor.cappedHint', { loaded: items.length, total: visits.data.total })}
                </p>
              )}
            </div>

            {/* Filter Pills & Quick On-Site Filter */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-1.5 bg-slate-100/90 p-1 rounded-xl">
                {[
                  { id: 'ALL', label: t('visitor.all'), count: items.length },
                  { id: 'PENDING', label: t('visitor.PENDING'), count: pendingVisits.length },
                  { id: 'APPROVED', label: t('visitor.APPROVED'), count: approvedVisits.length },
                  { id: 'REJECTED', label: t('visitor.REJECTED'), count: rejectedVisits.length },
                  { id: 'CANCELLED', label: t('visitor.CANCELLED'), count: cancelledVisits.length },
                  { id: 'EXPIRED', label: t('visitor.EXPIRED'), count: expiredVisits.length },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={statusFilter === tab.id}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                      statusFilter === tab.id
                        ? 'bg-[#071A2B] text-white shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                    onClick={() => setStatusFilter(tab.id as StatusFilter)}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono ${
                        statusFilter === tab.id
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-200/80 text-slate-600'
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                aria-pressed={onSiteOnly}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all cursor-pointer border ${
                  onSiteOnly
                    ? 'bg-sky-600 border-sky-600 text-white shadow-xs ring-2 ring-sky-200'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                }`}
                onClick={() => setOnSiteOnly(!onSiteOnly)}
              >
                <IconBuilding className="w-3.5 h-3.5" />
                <span>{t('visitor.filterOnSite')}</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono ${
                    onSiteOnly ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {insideVisits.length}
                </span>
              </button>
            </div>
          </div>

          {/* Search Bar & View Style Toggle */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <IconSearch className="w-4 h-4" />
              </div>
              <input
                className={`${field} pl-9`}
                aria-label={t('visitor.search')}
                placeholder={t('visitor.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <IconX className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 rounded-xl border border-slate-200 p-0.5 bg-slate-50">
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                  viewStyle === 'table'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                onClick={() => setViewStyle('table')}
                title={t('visitor.tableView')}
              >
                {t('visitor.table')}
              </button>
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                  viewStyle === 'cards'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                onClick={() => setViewStyle('cards')}
                title={t('visitor.cardView')}
              >
                {t('visitor.cards')}
              </button>
            </div>
          </div>

          {/* Dismissible Error Alerts */}
          {decide.error && (
            <div
              role="alert"
              className="flex items-center justify-between rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-800"
            >
              <div className="flex items-center gap-2">
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{visitorError(decide.error)}</span>
              </div>
              <button
                type="button"
                onClick={() => decide.reset()}
                className="rounded-lg p-1 text-rose-600 hover:bg-rose-100 cursor-pointer"
                aria-label={t('notify.close')}
              >
                <IconX className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {retryEmail.error && (
            <div
              role="alert"
              className="flex items-center justify-between rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-800"
            >
              <div className="flex items-center gap-2">
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{visitorError(retryEmail.error)}</span>
              </div>
              <button
                type="button"
                onClick={() => retryEmail.reset()}
                className="rounded-lg p-1 text-rose-600 hover:bg-rose-100 cursor-pointer"
                aria-label={t('notify.close')}
              >
                <IconX className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {manualCheckout.error && (
            <div
              role="alert"
              className="flex items-center justify-between rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-800"
            >
              <div className="flex items-center gap-2">
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{visitorError(manualCheckout.error)}</span>
              </div>
              <button
                type="button"
                onClick={() => manualCheckout.reset()}
                className="rounded-lg p-1 text-rose-600 hover:bg-rose-100 cursor-pointer"
                aria-label={t('notify.close')}
              >
                <IconX className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {visits.isPending && (
            <div className="flex items-center gap-2 p-6 text-xs text-slate-500">
              <div className="h-3.5 w-3.5 border-2 border-[#F66B17] border-t-transparent rounded-full animate-spin" />
              <p role="status">{t('visitor.loadingVisits')}</p>
            </div>
          )}

          {visits.error && (
            <div
              role="alert"
              className="flex items-center justify-between rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-800 border border-rose-200"
            >
              <span>{visitorError(visits.error)}</span>
              <button
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                onClick={() => void visits.refetch()}
              >
                {t('visitor.retry')}
              </button>
            </div>
          )}

          {!visits.isPending && !visits.error && filtered.length === 0 && (
            <div className="py-12 text-center text-xs text-slate-400">
              {t(items.length ? 'visitor.noMatches' : 'visitor.empty')}
            </div>
          )}

          {/* TABLE VIEW (REFINED & ENTERPRISE CLEAN) */}
          {viewStyle === 'table' && filtered.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-3.5">{t('visitor.colVisitorGroup')}</th>
                    <th className="py-3 px-3.5">{t('visitor.colHostGate')}</th>
                    <th className="py-3 px-3.5">{t('visitor.colVisitSchedule')}</th>
                    <th className="py-3 px-3.5">{t('visitor.colStatusEmail')}</th>
                    <th className="py-3 px-3.5">{t('visitor.colPresence')}</th>
                    <th className="py-3 px-3.5 text-right">{t('visitor.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((v) => {
                    const isInside = v.enteredCount > v.exitedCount;
                    const presenceInfo = getPresenceInfo(v, t);
                    return (
                      <tr key={v.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-3.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-900">{v.visitorName}</span>
                            <span className="rounded-full bg-slate-100 border border-slate-200 px-1.5 py-0.2 text-[10px] font-bold text-slate-700">
                              {v.groupSize}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {v.company ? `${v.company} · ` : ''}
                            {v.contact}
                          </p>
                        </td>

                        <td className="py-3 px-3.5">
                          <p className="font-semibold text-slate-800">{v.hostName}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {v.targetArea} ·{' '}
                            {t('visitor.gateNumber', {
                              number: SITE_GATES.findIndex((g) => g.id === v.gateId) + 1,
                            })}
                          </p>
                        </td>

                        <td className="py-3 px-3.5">
                          <div className="flex items-center gap-1 text-xs font-medium text-slate-700">
                            <IconCalendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>{formatSchedule(v.validFrom, v.validUntil, locale)}</span>
                          </div>
                        </td>

                        <td className="py-3 px-3.5">
                          <div className="flex flex-col gap-1 items-start">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${
                                v.status === 'APPROVED'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : v.status === 'PENDING'
                                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                                    : v.status === 'REJECTED'
                                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                                      : v.status === 'CANCELLED'
                                        ? 'bg-slate-100 text-slate-700 border-slate-300'
                                        : 'bg-purple-50 text-purple-800 border-purple-200'
                              }`}
                            >
                              {t('visitor.' + v.status)}
                            </span>
                            {v.email && (
                              <span className="text-[10px] text-slate-500 font-mono">
                                ✉ {t('visitor.emailStatus.' + (v.emailStatus ?? 'NOT_REQUESTED'))}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-3.5">
                          <div className="flex flex-col gap-1 items-start">
                            <span
                              className={`inline-block rounded-md px-2 py-0.5 text-[11px] border ${presenceInfo.badgeClass}`}
                            >
                              {presenceInfo.statusText}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {t('visitor.inOutCount', {
                                entered: v.enteredCount,
                                exited: v.exitedCount,
                              })}
                            </span>
                          </div>
                        </td>

                        <td className="py-3 px-3.5 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                            {/* Actions for PENDING visits */}
                            {canApproveEffective && v.status === 'PENDING' && (
                              <>
                                <button
                                  type="button"
                                  className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 text-xs font-bold shadow-2xs transition-all cursor-pointer"
                                  disabled={decide.isPending}
                                  onClick={() =>
                                    decide.mutate({
                                      id: v.id,
                                      status: 'APPROVED',
                                      version: v.version,
                                    })
                                  }
                                >
                                  {t('visitor.approve')}
                                </button>
                                <button
                                  type="button"
                                  className="rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 px-2 py-1 text-xs font-bold transition-all cursor-pointer"
                                  disabled={decide.isPending}
                                  onClick={() => {
                                    setRejectVisit(v);
                                    setRejectNote('');
                                  }}
                                >
                                  {t('visitor.reject')}
                                </button>
                              </>
                            )}

                            {/* Actions for APPROVED visits */}
                            {canApproveEffective && v.status === 'APPROVED' && (
                              <button
                                type="button"
                                className="rounded-lg border border-slate-200 text-slate-600 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50 px-2 py-1 text-xs font-semibold transition-all cursor-pointer"
                                disabled={decide.isPending}
                                onClick={() => {
                                  setCancelVisit(v);
                                  setCancelNote('');
                                }}
                              >
                                {t('visitor.cancel')}
                              </button>
                            )}

                            {canApproveEffective &&
                              ['APPROVED', 'REJECTED', 'CANCELLED'].includes(v.status) &&
                              ['FAILED', 'PENDING'].includes(v.emailStatus ?? '') && (
                                <button
                                  type="button"
                                  className="rounded-lg border border-orange-200 bg-orange-50 text-orange-800 px-2 py-1 text-xs font-bold cursor-pointer hover:bg-orange-100"
                                  disabled={retryEmail.isPending}
                                  onClick={() => retryEmail.mutate(v.id)}
                                >
                                  {t('visitor.retryEmail')}
                                </button>
                              )}

                            {canManualCheckoutEffective && isInside && (
                              <button
                                type="button"
                                className="rounded-lg bg-amber-600 hover:bg-amber-700 text-white px-2 py-1 text-xs font-bold cursor-pointer"
                                disabled={manualCheckout.isPending}
                                onClick={() => {
                                  setManualCheckoutVisit(v);
                                  setManualCheckoutNote('');
                                  setRepresentativeConfirmed(false);
                                }}
                              >
                                {t('visitor.manualCheckout')}
                              </button>
                            )}

                            <button
                              type="button"
                              className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all cursor-pointer"
                              onClick={() => setDetailVisit(v)}
                              title={t('visitor.viewDetails')}
                            >
                              <IconEye className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* CARD VIEW (MODERN & STRUCTURED) */}
          {viewStyle === 'cards' && filtered.length > 0 && (
            <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((v) => {
                const isInside = v.enteredCount > v.exitedCount;
                return (
                  <article
                    key={v.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-2xs hover:border-slate-300 transition-all"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-bold text-sm text-slate-900 leading-tight">
                            {v.visitorName}
                          </h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {v.company ? `${v.company} · ` : ''}
                            {v.contact}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0 border ${
                            v.status === 'APPROVED'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : v.status === 'PENDING'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : v.status === 'REJECTED'
                                  ? 'bg-rose-50 text-rose-800 border-rose-200'
                                  : v.status === 'CANCELLED'
                                    ? 'bg-slate-100 text-slate-700 border-slate-300'
                                    : 'bg-purple-50 text-purple-800 border-purple-200'
                          }`}
                        >
                          {t('visitor.' + v.status)}
                        </span>
                      </div>

                      <div className="rounded-lg bg-slate-50/80 p-3 text-xs space-y-1.5 text-slate-600">
                        <div>
                          <span className="text-slate-400 font-medium">{t('visitor.host')}: </span>
                          <span className="font-bold text-slate-800">{v.hostName}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 font-medium">{t('visitor.area')}: </span>
                          <span className="font-semibold text-slate-800">
                            {v.targetArea} ·{' '}
                            {t('visitor.gateName', {
                              number: SITE_GATES.findIndex((g) => g.id === v.gateId) + 1,
                            })}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 font-medium">
                            {t('visitor.schedule')}:{' '}
                          </span>
                          <span className="font-semibold text-slate-800">
                            {formatSchedule(v.validFrom, v.validUntil, locale)}
                          </span>
                        </div>
                        {v.purpose && (
                          <div className="truncate text-slate-500">
                            <span className="text-slate-400">{t('visitor.purposeLabel')} </span>
                            {v.purpose}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-xs px-1 border-t border-slate-100 pt-2.5">
                        {(() => {
                          const p = getPresenceInfo(v, t);
                          return (
                            <span className={`rounded-md px-2 py-0.5 text-[11px] border ${p.badgeClass}`}>
                              {p.statusText}
                            </span>
                          );
                        })()}
                        <span className="text-[11px] text-slate-500 font-mono">
                          {t('visitor.inOutCount', {
                            entered: v.enteredCount,
                            exited: v.exitedCount,
                          })}
                        </span>
                      </div>
                    </div>

                    {/* Card Actions */}
                    <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-center justify-between gap-1.5">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                        onClick={() => setDetailVisit(v)}
                      >
                        <IconEye className="w-3.5 h-3.5" />
                        <span>{t('visitor.viewDetails')}</span>
                      </button>

                      <div className="flex items-center gap-1.5">
                        {canApproveEffective && v.status === 'PENDING' && (
                          <>
                            <button
                              type="button"
                              className="rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 px-2 py-1 text-xs font-bold cursor-pointer"
                              disabled={decide.isPending}
                              onClick={() => {
                                setRejectVisit(v);
                                setRejectNote('');
                              }}
                            >
                              {t('visitor.reject')}
                            </button>
                            <button
                              type="button"
                              className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 text-xs font-bold cursor-pointer"
                              disabled={decide.isPending}
                              onClick={() =>
                                decide.mutate({ id: v.id, status: 'APPROVED', version: v.version })
                              }
                            >
                              {t('visitor.approve')}
                            </button>
                          </>
                        )}

                        {canApproveEffective && v.status === 'APPROVED' && (
                          <button
                            type="button"
                            className="rounded-lg border border-slate-200 text-slate-500 hover:text-rose-700 hover:border-rose-200 px-2 py-1 text-xs font-semibold cursor-pointer"
                            disabled={decide.isPending}
                            onClick={() => {
                              setCancelVisit(v);
                              setCancelNote('');
                            }}
                          >
                            {t('visitor.cancel')}
                          </button>
                        )}

                        {canManualCheckoutEffective && isInside && (
                          <button
                            type="button"
                            className="rounded-lg bg-amber-600 text-white px-2 py-1 text-xs font-bold cursor-pointer"
                            disabled={manualCheckout.isPending}
                            onClick={() => {
                              setManualCheckoutVisit(v);
                              setManualCheckoutNote('');
                              setRepresentativeConfirmed(false);
                            }}
                          >
                            {t('visitor.manualCheckout')}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── SECURITY GATE DESK (SCANNER & CHECK-IN) ────────────────────── */}
      {canScan && (viewSection === 'all' || viewSection === 'gate') && (
        <section className="space-y-5 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-50 border border-orange-200/70 text-[#F66B17] shrink-0">
                <IconKey className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                    {t('visitor.scanTitle')}
                  </h2>
                  <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                    {t('visitor.directGate')}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{t('visitor.scanHint')}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Gate Selector & Scanner */}
            <div className="lg:col-span-1 space-y-4">
              <label className="block text-xs font-bold text-slate-700">
                {t('visitor.gate')}
                <select
                  className={`${field} mt-1.5`}
                  disabled={verify.isPending || load.isPending}
                  value={gateId}
                  onChange={(e) => {
                    setGateId(e.target.value);
                    setPreview(null);
                    load.reset();
                  }}
                >
                  {SITE_GATES.map((g, i) => (
                    <option key={g.id} value={g.id}>
                      {t('visitor.gateName', { number: i + 1 })}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                <QrScannerView
                  disabled={verify.isPending || load.isPending}
                  onScan={(value) => {
                    setQrToken(value);
                    startLoad(value);
                  }}
                />
              </div>

              <div className="space-y-2.5">
                <label className="block text-xs font-bold text-slate-700">
                  {t('visitor.qrToken')}
                  <input
                    className={`${field} mt-1.5 font-mono uppercase font-bold tracking-wider`}
                    disabled={verify.isPending || load.isPending}
                    value={qrToken}
                    placeholder={t('visitor.tokenPlaceholder')}
                    onChange={(e) => {
                      setQrToken(e.target.value);
                      setPreview(null);
                      verify.reset();
                      load.reset();
                    }}
                    onKeyDown={(e) => {
                      if (
                        e.key === 'Enter' &&
                        qrToken.trim() &&
                        !load.isPending &&
                        !verify.isPending
                      ) {
                        e.preventDefault();
                        startLoad();
                      }
                    }}
                  />
                </label>

                {/* Fixed Search Button — Explicit solid styling matching SmartSite theme */}
                <button
                  type="button"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#071A2B] hover:bg-[#0E2841] text-white px-4 py-2.5 text-xs font-bold shadow-xs transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  disabled={!qrToken.trim() || verify.isPending || load.isPending}
                  onClick={() => startLoad()}
                >
                  {load.isPending ? (
                    <>
                      <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>{t('visitor.loadingPreview')}</span>
                    </>
                  ) : (
                    <>
                      <IconSearch className="w-3.5 h-3.5 text-slate-300" />
                      <span>{t('visitor.preview')}</span>
                    </>
                  )}
                </button>
              </div>

              {load.error && (
                <div
                  role="alert"
                  className="flex items-center justify-between rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-800"
                >
                  <div className="flex items-center gap-2">
                    <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                    <span>{visitorError(load.error)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => load.reset()}
                    className="rounded-lg p-1 text-rose-600 hover:bg-rose-100 cursor-pointer"
                  >
                    <IconX className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Roster & Passage Confirmation Panel */}
            <div className="lg:col-span-2">
              {active ? (
                <form
                  onSubmit={confirm}
                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-4"
                >
                  <fieldset disabled={verify.isPending} className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2.5">
                      <legend className="font-bold text-sm text-slate-900">
                        {t('visitor.summary', {
                          name: active.visit.visitorName,
                          count: active.visit.groupSize,
                        })}{' '}
                        <span className="mx-1 text-slate-400">·</span>
                        <span
                          className={`inline-block px-2 py-0.5 rounded-lg text-xs font-bold ${
                            active.direction === 'IN'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-amber-100 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {t('visitor.' + active.direction)}
                        </span>
                      </legend>

                      {roster.length > 0 && (
                        <p role="status" className="text-xs font-bold text-[#F66B17]">
                          {t('visitor.selected', {
                            count: selected.length,
                            total: active.visit.groupSize,
                          })}
                        </p>
                      )}
                    </div>

                    {roster.length ? (
                      <>
                        {active.direction === 'IN' && (
                          <div className="text-xs text-slate-600 bg-white p-3 rounded-xl border border-slate-200 flex items-start gap-2">
                            <span className="text-amber-500">💡</span>
                            <span>{t('visitor.replacementHint')}</span>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 cursor-pointer"
                            onClick={() =>
                              setSelection((rows) =>
                                rows.map((r) => ({ ...r, selected: r.eligible })),
                              )
                            }
                          >
                            {t('visitor.selectAll')}
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 cursor-pointer"
                            onClick={() =>
                              setSelection((rows) => rows.map((r) => ({ ...r, selected: false })))
                            }
                          >
                            {t('visitor.clearSelection')}
                          </button>
                        </div>

                        <div className="max-h-[26rem] space-y-2.5 overflow-y-auto pr-1">
                          {selection.map((row, i) => (
                            <div
                              key={row.memberId}
                              className={`rounded-xl border p-3.5 transition-all ${
                                row.selected
                                  ? 'border-[#F66B17]/60 bg-white shadow-2xs ring-1 ring-[#F66B17]/10'
                                  : 'border-slate-200 bg-slate-100/60 opacity-60'
                              }`}
                            >
                              <label className="flex items-center gap-2.5 text-xs font-bold text-slate-900 cursor-pointer">
                                <input
                                  type="checkbox"
                                  aria-label={t('visitor.selectMember', {
                                    name: roster[i]?.fullName,
                                  })}
                                  checked={row.selected}
                                  disabled={!row.eligible}
                                  className="h-4 w-4 rounded border-slate-300 text-[#F66B17] focus:ring-orange-400 cursor-pointer"
                                  onChange={(e) =>
                                    setSelection((rows) =>
                                      rows.map((r) =>
                                        r.memberId === row.memberId
                                          ? { ...r, selected: e.target.checked }
                                          : r,
                                      ),
                                    )
                                  }
                                />
                                <span className="text-xs font-bold">{roster[i]?.fullName}</span>
                                <span
                                  className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    row.selected
                                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                      : 'bg-slate-200 text-slate-600'
                                  }`}
                                >
                                  {t(row.selected ? 'visitor.present' : 'visitor.absent')}
                                </span>
                              </label>

                              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                                <label className="text-xs font-semibold text-slate-600">
                                  {t('visitor.memberName', { number: i + 1 })}
                                  <input
                                    className={`${field} mt-1`}
                                    required={row.selected}
                                    disabled={
                                      !row.eligible || active.direction === 'OUT' || !row.selected
                                    }
                                    maxLength={255}
                                    value={row.fullName}
                                    onChange={(e) =>
                                      setSelection((rows) =>
                                        rows.map((r) =>
                                          r.memberId === row.memberId
                                            ? { ...r, fullName: e.target.value }
                                            : r,
                                        ),
                                      )
                                    }
                                  />
                                </label>

                                <label className="text-xs font-semibold text-slate-600">
                                  {t('visitor.memberId', { number: i + 1 })}
                                  <input
                                    className={`${field} mt-1 font-mono`}
                                    required={row.selected}
                                    disabled={
                                      !row.eligible || active.direction === 'OUT' || !row.selected
                                    }
                                    pattern="[0-9]{12}"
                                    inputMode="numeric"
                                    minLength={12}
                                    maxLength={12}
                                    value={row.identityNumber}
                                    onChange={(e) =>
                                      setSelection((rows) =>
                                        rows.map((r) =>
                                          r.memberId === row.memberId
                                            ? { ...r, identityNumber: e.target.value }
                                            : r,
                                        ),
                                      )
                                    }
                                  />
                                </label>
                              </div>

                              <p className="mt-1.5 text-[11px] text-slate-500 italic">
                                {t('visitor.original', {
                                  name: roster[i]?.registeredFullName,
                                  id: roster[i]?.registeredIdentityNumber,
                                })}
                              </p>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-slate-600 bg-white p-3 rounded-xl border border-slate-200">
                        {t(
                          active.visit.groupSize === 1
                            ? 'visitor.singleHint'
                            : 'visitor.legacyHint',
                        )}
                      </p>
                    )}

                    <button
                      type="submit"
                      className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 shadow-xs transition-all active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2 cursor-pointer"
                      disabled={verify.isPending || (!!roster.length && !selected.length)}
                    >
                      {verify.isPending && (
                        <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      )}
                      {t('visitor.confirm' + active.direction)}
                    </button>
                  </fieldset>
                </form>
              ) : (
                <div className="h-full min-h-[240px] flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white border border-slate-200/80 text-slate-400 shadow-xs mb-3">
                    <IconSearch className="w-5 h-5 text-slate-400" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800">{t('visitor.readyToCheck')}</h3>
                  <p className="text-xs text-slate-500 max-w-sm mt-1 leading-relaxed">
                    {t('visitor.readyToCheckDesc')}
                  </p>
                </div>
              )}

              {selectionError && (
                <div
                  role="alert"
                  className="mt-3 flex items-center justify-between rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-800"
                >
                  <div className="flex items-center gap-2">
                    <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                    <span>{t(selectionError)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectionError('')}
                    className="rounded-lg p-1 text-rose-600 hover:bg-rose-100 cursor-pointer"
                  >
                    <IconX className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {verify.error && (
                <div
                  role="alert"
                  className="mt-3 flex items-center justify-between rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-800"
                >
                  <div className="flex items-center gap-2">
                    <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                    <span>{visitorError(verify.error)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => verify.reset()}
                    className="rounded-lg p-1 text-rose-600 hover:bg-rose-100 cursor-pointer"
                  >
                    <IconX className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {recorded && (
                <div
                  role="status"
                  className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs font-bold text-emerald-900 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2">
                    <IconCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      {t('visitor.recorded', {
                        direction: t('visitor.' + recorded.direction),
                        count: recorded.count,
                        name: recorded.visit.visitorName,
                        inside: recorded.visit.enteredCount - recorded.visit.exitedCount,
                      })}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRecorded(null)}
                    className="rounded-lg p-1 text-emerald-700 hover:bg-emerald-100 cursor-pointer"
                  >
                    <IconX className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── HISTORY LOGS ────────────────────────────────────────────────── */}
      {(viewSection === 'all' || viewSection === 'history') && (
        <section className="space-y-3.5 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-extrabold text-slate-900">{t('visitor.history')}</h2>
              <p className="text-xs text-slate-500">{t('visitor.historySubtitle')}</p>
            </div>
            <button
              type="button"
              onClick={() => void history.refetch()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <span>{t('visitor.refresh')}</span>
            </button>
          </div>

          {history.isPending && (
            <div className="flex items-center gap-2 p-4 text-xs text-slate-500">
              <div className="h-3.5 w-3.5 border-2 border-[#F66B17] border-t-transparent rounded-full animate-spin" />
              <p role="status">{t('visitor.loadingHistory')}</p>
            </div>
          )}

          {history.error && (
            <div
              role="alert"
              className="flex items-center justify-between rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-800 border border-rose-200"
            >
              <span>{visitorError(history.error)}</span>
              <button
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                onClick={() => void history.refetch()}
              >
                {t('visitor.retry')}
              </button>
            </div>
          )}

          {history.data?.items.length === 0 && (
            <p className="text-xs text-slate-400 py-6 text-center">{t('visitor.noHistory')}</p>
          )}

          <div className="space-y-2">
            {history.data?.items.map((e) => (
              <details
                key={e.id}
                className="group rounded-xl border border-slate-200 p-3.5 transition-all hover:border-slate-300 bg-white"
              >
                <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
                  <div>
                    <span className="font-bold text-xs text-slate-900">
                      {t('visitor.passage', {
                        direction: t('visitor.' + e.direction),
                        name: e.visit.visitorName,
                        count: e.count,
                      })}
                    </span>
                    <span className="text-xs text-slate-500 mt-0.5 block">
                      {new Date(e.createdAt).toLocaleString(locale)} · {t('visitor.details')}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 group-open:rotate-180 transition-transform">
                    ▼
                  </span>
                </summary>

                {e.attendees?.length ? (
                  <ul className="mt-3 pt-3 border-t border-slate-100 space-y-2 text-xs">
                    {e.attendees.map((a) => (
                      <li
                        key={a.memberId}
                        className="rounded-lg bg-slate-50 p-2.5 border border-slate-200/70 text-xs"
                      >
                        <p className="font-bold text-slate-800">
                          {a.fullName} ·{' '}
                          <span className="font-mono text-slate-600">{a.identityNumber}</span>
                        </p>
                        {a.replacedFrom && (
                          <p className="mt-1 text-[11px] font-semibold text-amber-800 bg-amber-50 inline-block px-2 py-0.5 rounded border border-amber-200">
                            {t('visitor.replacedFrom', {
                              name: a.replacedFrom.fullName,
                              id: a.replacedFrom.identityNumber,
                            })}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">{t('visitor.noIdentityHistory')}</p>
                )}
              </details>
            ))}
          </div>
        </section>
      )}

      {/* ── MODAL: VISIT DETAILS ────────────────────────────────────────── */}
      {detailVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071A2B]/40 p-4 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                  <IconEye className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    {t('visitor.detailTitle')}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    {tr('common.id')}
                    {detailVisit.id}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                onClick={() => setDetailVisit(null)}
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3.5 rounded-xl bg-slate-50 p-4 border border-slate-200/80">
                <div>
                  <span className="text-slate-400 font-medium">
                    {t('visitor.representativeLabel')}
                  </span>
                  <p className="font-bold text-slate-900 text-sm mt-0.5">
                    {detailVisit.visitorName}
                  </p>
                  <p className="text-xs text-slate-500">
                    {detailVisit.company || t('visitor.individual')}
                  </p>
                  <p className="text-xs text-slate-500">{detailVisit.contact}</p>
                </div>
                <div className="space-y-2">
                  <div>
                    <span className="text-slate-400 font-medium">{t('visitor.statusLabel')}</span>
                    <div className="mt-1 flex items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider border ${
                          detailVisit.status === 'APPROVED'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : detailVisit.status === 'PENDING'
                              ? 'bg-amber-100 text-amber-800 border-amber-200'
                              : detailVisit.status === 'REJECTED'
                                ? 'bg-rose-100 text-rose-800 border-rose-200'
                                : detailVisit.status === 'CANCELLED'
                                  ? 'bg-slate-200 text-slate-700 border-slate-300'
                                  : 'bg-purple-100 text-purple-800 border-purple-200'
                        }`}
                      >
                        {t('visitor.' + detailVisit.status)}
                      </span>
                    </div>
                    {detailVisit.email && (
                      <p className="text-xs text-slate-500 mt-1 font-mono">
                        ✉ {t('visitor.emailStatus.' + (detailVisit.emailStatus ?? 'NOT_REQUESTED'))}
                      </p>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-400 font-medium">{t('visitor.presenceLabel')}</span>
                    <div className="mt-1">
                      {(() => {
                        const p = getPresenceInfo(detailVisit, t);
                        return (
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold border ${p.badgeClass}`}
                          >
                            {p.statusText}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-400 font-medium">{t('visitor.hostLabel')}</span>
                  <p className="font-bold text-slate-800 text-xs mt-0.5">{detailVisit.hostName}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">{t('visitor.areaGateLabel')}</span>
                  <p className="font-bold text-slate-800 text-xs mt-0.5">
                    {detailVisit.targetArea} ·{' '}
                    {t('visitor.gateNumber', {
                      number: SITE_GATES.findIndex((g) => g.id === detailVisit.gateId) + 1,
                    })}
                  </p>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-400 font-medium">{t('visitor.scheduleLabel')}</span>
                  <p className="font-bold text-slate-800 text-xs mt-0.5">
                    {formatSchedule(detailVisit.validFrom, detailVisit.validUntil, locale)}
                  </p>
                </div>
                {detailVisit.purpose && (
                  <div className="col-span-2">
                    <span className="text-slate-400 font-medium">{t('visitor.purposeLabel')}</span>
                    <p className="font-medium text-slate-700 mt-0.5">{detailVisit.purpose}</p>
                  </div>
                )}
                {detailVisit.reviewNote && (
                  <div className="col-span-2 rounded-xl bg-amber-50 p-3 border border-amber-200">
                    <span className="text-amber-800 font-bold">{t('visitor.reviewNoteLabel')}</span>
                    <p className="text-slate-700 mt-0.5">{detailVisit.reviewNote}</p>
                  </div>
                )}
              </div>

              {/* Roster Table */}
              <div className="border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between pb-2">
                  <h4 className="font-bold text-slate-900 text-xs">
                    {t('visitor.rosterTitle', {
                      count: detailVisit.members?.length || detailVisit.groupSize,
                    })}
                  </h4>
                  <span className="text-xs text-slate-500">
                    {t('visitor.presenceCounts', {
                      entered: detailVisit.enteredCount,
                      exited: detailVisit.exitedCount,
                    })}
                  </span>
                </div>

                {detailVisit.members?.length ? (
                  <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {detailVisit.members.map((m, i) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between p-2.5 text-xs bg-white"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-4 text-slate-400 font-mono text-xs">{i + 1}.</span>
                          <span className="font-bold text-slate-800">{m.fullName}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-500 text-xs">
                            {m.identityNumber}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              m.inside
                                ? 'bg-sky-100 text-sky-800 border border-sky-200'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {m.inside ? t('visitor.tagInside') : t('visitor.tagOutside')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">{t('visitor.noMembers')}</p>
                )}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              {canApproveEffective && detailVisit.status === 'PENDING' && (
                <>
                  <button
                    type="button"
                    className="rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 px-3.5 py-2 text-xs font-bold cursor-pointer"
                    onClick={() => {
                      setRejectVisit(detailVisit);
                      setDetailVisit(null);
                    }}
                  >
                    {t('visitor.reject')}
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-bold cursor-pointer"
                    onClick={() => {
                      decide.mutate({
                        id: detailVisit.id,
                        status: 'APPROVED',
                        version: detailVisit.version,
                      });
                      setDetailVisit(null);
                    }}
                  >
                    {t('visitor.approve')}
                  </button>
                </>
              )}

              {canApproveEffective && detailVisit.status === 'APPROVED' && (
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 text-slate-600 hover:text-rose-700 hover:bg-rose-50 px-3.5 py-2 text-xs font-semibold cursor-pointer"
                  onClick={() => {
                    setCancelVisit(detailVisit);
                    setDetailVisit(null);
                  }}
                >
                  {t('visitor.cancel')}
                </button>
              )}

              {canManualCheckoutEffective && detailVisit.enteredCount > detailVisit.exitedCount && (
                <button
                  type="button"
                  className="rounded-xl bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-2 text-xs font-bold cursor-pointer"
                  disabled={manualCheckout.isPending}
                  onClick={() => {
                    setManualCheckoutVisit(detailVisit);
                    setManualCheckoutNote('');
                    setRepresentativeConfirmed(false);
                    setDetailVisit(null);
                  }}
                >
                  {t('visitor.manualCheckout')}
                </button>
              )}

              <button
                type="button"
                className="rounded-xl bg-[#071A2B] hover:bg-[#0E2841] text-white px-4 py-2 text-xs font-bold cursor-pointer"
                onClick={() => setDetailVisit(null)}
              >
                {t('visitor.closeModal')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: REJECT VISIT ─────────────────────────────────────────── */}
      {rejectVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071A2B]/40 p-4 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-extrabold text-slate-900">{t('visitor.rejectTitle')}</h3>
              <button
                type="button"
                className="rounded-lg p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                onClick={() => setRejectVisit(null)}
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              {t('visitor.rejectConfirmPrompt', { name: rejectVisit.visitorName })}
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700">
                {t('visitor.rejectReasonLabel')}
                <textarea
                  className={`${field} resize-none h-20 mt-1`}
                  value={rejectNote}
                  maxLength={1000}
                  placeholder={t('visitor.rejectPlaceholder')}
                  onChange={(e) => setRejectNote(e.target.value)}
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                onClick={() => setRejectVisit(null)}
              >
                {t('visitor.back')}
              </button>
              <button
                type="button"
                className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 text-xs font-bold disabled:opacity-50 cursor-pointer"
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate({
                    id: rejectVisit.id,
                    status: 'REJECTED',
                    version: rejectVisit.version,
                    reviewNote: rejectNote,
                  })
                }
              >
                {decide.isPending ? t('visitor.processing') : t('visitor.confirmReject')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: CANCEL VISIT ─────────────────────────────────────────── */}
      {cancelVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071A2B]/40 p-4 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-extrabold text-slate-900">
                {t('visitor.cancelApprovedTitle')}
              </h3>
              <button
                type="button"
                className="rounded-lg p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                onClick={() => setCancelVisit(null)}
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              {t('visitor.cancelDesc', { name: cancelVisit.visitorName })}
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700">
                {t('visitor.cancelReasonLabel')}
                <textarea
                  className={`${field} resize-none h-20 mt-1`}
                  required
                  value={cancelNote}
                  maxLength={1000}
                  placeholder={t('visitor.cancelPlaceholder')}
                  onChange={(e) => setCancelNote(e.target.value)}
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                onClick={() => setCancelVisit(null)}
              >
                {t('visitor.closeModal')}
              </button>
              <button
                type="button"
                className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 text-xs font-bold disabled:opacity-50 cursor-pointer"
                disabled={decide.isPending || !cancelNote.trim()}
                onClick={() =>
                  decide.mutate({
                    id: cancelVisit.id,
                    status: 'CANCELLED',
                    version: cancelVisit.version,
                    reviewNote: cancelNote,
                  })
                }
              >
                {decide.isPending ? t('visitor.processing') : t('visitor.confirmCancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: MANUAL CHECKOUT ──────────────────────────────────────── */}
      {manualCheckoutVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071A2B]/40 p-4 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-extrabold text-slate-900">
                {t('visitor.manualCheckoutTitle')}
              </h3>
              <button
                type="button"
                className="rounded-lg p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                onClick={() => setManualCheckoutVisit(null)}
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              {t('visitor.manualCheckoutDesc', { name: manualCheckoutVisit.visitorName })}
            </p>

            <div className="space-y-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={representativeConfirmed}
                  className="rounded text-[#F66B17] focus:ring-orange-400 cursor-pointer"
                  onChange={(e) => setRepresentativeConfirmed(e.target.checked)}
                />
                {t('visitor.representativeConfirmed')}
              </label>

              <label className="block text-xs font-bold text-slate-700">
                {t('visitor.checkoutNoteLabel')}
                <textarea
                  className={`${field} resize-none h-20 mt-1`}
                  required
                  value={manualCheckoutNote}
                  maxLength={1000}
                  placeholder={t('visitor.checkoutPlaceholder')}
                  onChange={(e) => setManualCheckoutNote(e.target.value)}
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                onClick={() => setManualCheckoutVisit(null)}
              >
                {t('visitor.closeModal')}
              </button>
              <button
                type="button"
                className="rounded-xl bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 text-xs font-bold disabled:opacity-50 cursor-pointer"
                disabled={
                  manualCheckout.isPending || !manualCheckoutNote.trim() || !representativeConfirmed
                }
                onClick={() =>
                  manualCheckout.mutate({
                    visitId: manualCheckoutVisit.id,
                    note: manualCheckoutNote,
                  })
                }
              >
                {manualCheckout.isPending ? t('visitor.processing') : t('visitor.confirmCheckout')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
