import { localizedError, localizeMessage } from '../../../i18n/messages';
import { localizedLabel } from '../../../i18n/labels';
import { uiLocale } from '../../../i18n';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { VisitorGateCommand } from '@smartsite/contracts';
import { SITE_GATES } from '@smartsite/contracts/gate-permissions';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCamera,
  IconCheck,
  IconClock,
  IconKey,
  IconLoader,
  IconRefresh,
  IconSearch,
  IconUsers,
  IconX,
} from '../../icons';
import { QrScannerView } from '../gate/QrScannerView';

export function VisitorAccessView({
  apiUrl,
  token,
  siteId,
  siteName = tr('common.site_fa7955'),
  sessionScope,
  canApprove,
  canManualCheckout = false,
}: {
  apiUrl: string;
  token: string;
  siteId: string;
  siteName?: string;
  sessionScope: string;
  canApprove: boolean;
  canManualCheckout?: boolean;
}) {
  useTranslation();

  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const cache = useQueryClient();
  const key = ['access-control', apiUrl, sessionScope, 'visits', siteId];

  const visits = useQuery({
    queryKey: key,
    queryFn: () => client.listVisits(token, siteId),
    refetchInterval: 15_000,
  });

  const [qrToken, setQrToken] = useState('');
  const [gateId, setGateId] = useState<string>(SITE_GATES[0].id);
  const [reviewNote, setReviewNote] = useState('');
  const [representativeConfirmed, setRepresentativeConfirmed] = useState(false);
  const manualRetry = useRef<{ visitId: string; note: string; id: string } | null>(null);
  const manualCheckout = useMutation({
    mutationFn: (visitId: string) => {
      if (
        manualRetry.current?.visitId !== visitId ||
        manualRetry.current.note !== reviewNote.trim()
      )
        manualRetry.current = { visitId, note: reviewNote.trim(), id: crypto.randomUUID() };
      return client.manualVisitCheckout(token, siteId, visitId, {
        requestId: manualRetry.current.id,
        reviewNote: reviewNote.trim(),
        representativeConfirmed: true,
      });
    },
    onSuccess: () => {
      manualRetry.current = null;
      setRepresentativeConfirmed(false);
      void cache.invalidateQueries({ queryKey: key });
    },
  });
  const [message, setMessage] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'INSIDE'
  >('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const pending = useRef<{ gateId: string; input: VisitorGateCommand } | null>(null);

  const decide = useMutation({
    mutationFn: ({
      id,
      status,
      version,
    }: {
      id: string;
      status: 'APPROVED' | 'REJECTED' | 'CANCELLED';
      version?: number;
    }) =>
      client.decideVisit(token, siteId, id, status, {
        expectedVersion: version,
        reviewNote: reviewNote.trim() || undefined,
      }),
    onSuccess: () => cache.invalidateQueries({ queryKey: key }),
  });

  const verify = useMutation({
    mutationFn: (input: VisitorGateCommand) => client.verifyVisitorQr(token, siteId, gateId, input),
    onSuccess: (r) => {
      setMessage(
        tr(
          'visitor_access_view.recorded_value_value_people_value_remaining_on_site_value_visitors',
          {
            value1: r.direction,
            value2: r.count,
            value3: r.visit.visitorName,
            value4: r.visit.enteredCount - r.visit.exitedCount,
          },
        ),
      );
      setQrToken('');
      pending.current = null;
      void cache.invalidateQueries({ queryKey: key });
    },
  });

  const confirm = (direction: 'IN' | 'OUT') => {
    const old = pending.current;
    const input =
      old &&
      old.gateId === gateId &&
      old.input.token === qrToken.trim() &&
      old.input.direction === direction
        ? old.input
        : { token: qrToken.trim(), direction, requestId: crypto.randomUUID() };
    pending.current = { gateId, input };
    setMessage('');
    verify.mutate(input);
  };

  const rawItems = useMemo(() => visits.data?.items ?? [], [visits.data]);

  // Metrics computation
  const metrics = useMemo(() => {
    const total = rawItems.length;
    const pendingCount = rawItems.filter((v) => v.status === 'PENDING').length;
    const currentlyInside = rawItems.reduce(
      (acc, v) => acc + Math.max(0, v.enteredCount - v.exitedCount),
      0,
    );
    const approved = rawItems.filter((v) => v.status === 'APPROVED').length;
    return { total, pendingCount, currentlyInside, approved };
  }, [rawItems]);

  // Filtered visits
  const filteredVisits = useMemo(() => {
    return rawItems.filter((v) => {
      if (statusFilter === 'PENDING' && v.status !== 'PENDING') return false;
      if (statusFilter === 'APPROVED' && v.status !== 'APPROVED') return false;
      if (statusFilter === 'REJECTED' && v.status !== 'REJECTED') return false;
      if (statusFilter === 'INSIDE' && v.enteredCount - v.exitedCount <= 0) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = v.visitorName.toLowerCase().includes(q);
        const matchCompany = v.company?.toLowerCase().includes(q);
        const matchHost = v.hostName.toLowerCase().includes(q);
        const matchContact = v.contact.toLowerCase().includes(q);
        if (!matchName && !matchCompany && !matchHost && !matchContact) return false;
      }

      return true;
    });
  }, [rawItems, statusFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Page Header Strip */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#FF7A1A] border border-orange-100">
                <IconKey className="h-3.5 w-3.5" />
                {tr('common.mf04_qr')}
              </span>
              <span className="text-xs font-semibold text-slate-500">
                {canApprove
                  ? tr('visitor_access_view.site_manager_approval_authority')
                  : tr('visitor_access_view.view_only_gate_scanner')}
              </span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              {tr('visitor_access_view.visitor_access_passes_value', { value1: siteName })}
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              {canApprove
                ? tr(
                    'visitor_access_view.pass_requests_routed_to_the_site_manager_of_this_site_for_approval',
                  )
                : tr(
                    'visitor_access_view.site_manager_clearance_is_required_before_visitors_receive_dynamic_qr_passes',
                  )}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/visits/register"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-[#FF7A1A] px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-[#E56A10] transition-all"
            >
              <span>{tr('visitor_access_view.open_visitor_registration_portal')}</span>
              <IconArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        {/* KPI Summary Cards */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {tr('common.total_registrations')}
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900">{metrics.total}</span>
              <span className="text-xs text-slate-400">{tr('common.passes')}</span>
            </div>
          </div>

          <div
            className={`rounded-xl border p-4 ${
              metrics.pendingCount > 0
                ? 'border-amber-200 bg-amber-50/70 text-amber-950'
                : 'border-slate-100 bg-slate-50/70 text-slate-900'
            }`}
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {tr('common.pending_approval_6da02e')}
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={`text-2xl font-black ${
                  metrics.pendingCount > 0 ? 'text-amber-700' : 'text-slate-900'
                }`}
              >
                {metrics.pendingCount}
              </span>
              <span className="text-xs text-slate-400">{tr('common.requests')}</span>
            </div>
          </div>

          <div
            className={`rounded-xl border p-4 ${
              metrics.currentlyInside > 0
                ? 'border-emerald-200 bg-emerald-50/70 text-emerald-950'
                : 'border-slate-100 bg-slate-50/70 text-slate-900'
            }`}
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {tr('common.currently_on_site')}
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={`text-2xl font-black ${
                  metrics.currentlyInside > 0 ? 'text-emerald-700' : 'text-slate-900'
                }`}
              >
                {metrics.currentlyInside}
              </span>
              <span className="text-xs text-slate-400">{tr('common.visitors')}</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {tr('common.approved_passes')}
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900">{metrics.approved}</span>
              <span className="text-xs text-slate-400">{tr('common.cleared')}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Main Approval Table & Filtering */}
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        {/* Table Filter Toolbar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                {
                  id: 'ALL' as const,
                  get label() {
                    return tr('common.all');
                  },
                },
                {
                  id: 'PENDING' as const,
                  get label() {
                    return tr('common.pending');
                  },
                  count: metrics.pendingCount,
                },
                {
                  id: 'APPROVED' as const,
                  get label() {
                    return tr('common.approved');
                  },
                },
                {
                  id: 'INSIDE' as const,
                  get label() {
                    return tr('common.on_site');
                  },
                },
                {
                  id: 'REJECTED' as const,
                  get label() {
                    return tr('common.rejected');
                  },
                },
              ] as {
                id: 'ALL' | 'PENDING' | 'APPROVED' | 'INSIDE' | 'REJECTED';
                label: string;
                count?: number;
              }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                  statusFilter === tab.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-bold text-white">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="relative min-w-64">
            <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={tr('visitor_access_view.search_by_visitor_company_host')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
            />
          </div>
        </div>

        {/* Loading / Error States */}
        {visits.isPending && (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500">
            <IconLoader className="h-4 w-4" />
            <p>{tr('common.loading_visitor_passes')}</p>
          </div>
        )}

        {visits.error && (
          <div
            role="alert"
            className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700"
          >
            <span>{localizedError(visits.error.message)}</span>
            <button
              onClick={() => void visits.refetch()}
              className="inline-flex items-center gap-1 underline hover:text-rose-900"
            >
              <IconRefresh className="h-3 w-3" />
              <span>{tr('common.retry')}</span>
            </button>
          </div>
        )}

        {decide.error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"
          >
            <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
            <span>{localizedError(decide.error.message)}</span>
          </div>
        )}

        {/* Empty States */}
        {rawItems.length === 0 && !visits.isPending && !visits.error && (
          <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center">
            <IconUsers className="mx-auto h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm font-semibold text-slate-600">
              {tr('visitor_access_view.no_visitor_pass_requests_at_this_site')}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {tr(
                'visitor_access_view.share_the_registration_portal_with_visitors_or_contractors_to_receive_requests',
              )}
            </p>
          </div>
        )}

        {rawItems.length > 0 && filteredVisits.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-xs text-slate-500">
            {tr('visitor_access_view.no_visitor_requests_match_the_active_filter_criteria')}
          </div>
        )}

        {(canApprove || canManualCheckout) && (
          <label className="block text-xs text-slate-700">
            {tr('visitor_access_view.review_cancellation_reason')}
            <input
              value={reviewNote}
              maxLength={1000}
              onChange={(e) => setReviewNote(e.target.value)}
              className="mt-1 block w-full rounded-lg border p-2"
            />
          </label>
        )}
        {canManualCheckout && (
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={representativeConfirmed}
              onChange={(e) => setRepresentativeConfirmed(e.target.checked)}
            />
            {tr('visitor_access_view.the_representative_confirmed_the_entire_group_has_left')}
          </label>
        )}
        {manualCheckout.error && <p role="alert">{localizedError(manualCheckout.error.message)}</p>}
        {/* Table View */}
        {filteredVisits.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  {[
                    tr('common.representative_contact'),
                    tr('visitor_access_view.schedule_gate_target_area'),
                    tr('common.headcount'),
                    tr('common.status_clearance'),
                  ].map((header) => (
                    <th key={header} className="px-4 py-3.5 font-semibold">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredVisits.map((v) => {
                  const gate = SITE_GATES.find((g) => g.id === v.gateId);
                  const inside = v.enteredCount - v.exitedCount;
                  const initials = v.visitorName.slice(0, 2).toUpperCase() || 'VT';

                  return (
                    <tr key={v.id} className="hover:bg-slate-50/50 transition-colors">
                      {/* Visitor details */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-xs font-bold text-[#FF7A1A]">
                            {initials}
                          </div>
                          <div className="min-w-0 space-y-0.5">
                            <strong className="block text-sm font-bold text-slate-900">
                              {v.visitorName}
                            </strong>
                            {v.company && <p className="text-slate-600 font-medium">{v.company}</p>}
                            <p className="font-mono text-[11px] text-slate-500">{v.contact}</p>
                            <p className="text-[11px] text-slate-600">
                              <span className="text-slate-400">{tr('common.host')}</span>{' '}
                              {v.hostName}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Schedule / Gate / Area */}
                      <td className="px-4 py-3.5 space-y-1">
                        <div className="flex items-center gap-1.5 text-slate-700">
                          <IconClock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span className="font-mono text-[11px]">
                            {new Date(v.validFrom).toLocaleString(uiLocale())} –{' '}
                            {new Date(v.validUntil).toLocaleString(uiLocale())}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700 text-[11px]">
                            <IconKey className="h-3 w-3 text-slate-400" />
                            {gate?.name ?? v.gateId}
                          </span>
                          <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 font-medium text-blue-700 text-[11px]">
                            {v.targetArea}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 line-clamp-1 italic">
                          "{v.purpose}"
                        </p>
                      </td>

                      {/* Headcount breakdown */}
                      <td className="px-4 py-3.5 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-900">
                            {tr('common.registered_value', { value1: v.groupSize })}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 font-mono">
                          {tr('visitor_access_view.in_value_out_value', {
                            value1: v.enteredCount,
                            value2: v.exitedCount,
                          })}
                        </p>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                            inside > 0
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              inside > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                            }`}
                          />
                          {tr('common.on_site_9b4c38')} {inside} {tr('common.visitors')}
                        </span>
                      </td>

                      {/* Status and Actions */}
                      <td className="px-4 py-3.5 space-y-2">
                        <div>
                          {v.status === 'PENDING' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800 border border-amber-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                              {tr('common.pending_332011')}
                            </span>
                          )}
                          {v.status === 'APPROVED' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-200">
                              <IconCheck className="h-3 w-3 text-emerald-600" />
                              {tr('common.approved_f19952')}
                            </span>
                          )}
                          {v.status === 'REJECTED' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 border border-rose-200">
                              <IconX className="h-3 w-3 text-rose-600" />
                              {tr('common.rejected_04cc0e')}
                            </span>
                          )}
                        </div>

                        {canApprove && v.status === 'PENDING' && (
                          <div className="flex items-center gap-1.5 pt-1">
                            <button
                              disabled={decide.isPending}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 transition-all"
                              onClick={() =>
                                decide.mutate({ id: v.id, status: 'APPROVED', version: v.version })
                              }
                            >
                              <IconCheck className="h-3.5 w-3.5" />
                              <span>{tr('common.approve')}</span>
                            </button>
                            <button
                              disabled={decide.isPending}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-all"
                              onClick={() =>
                                decide.mutate({ id: v.id, status: 'REJECTED', version: v.version })
                              }
                            >
                              <IconX className="h-3.5 w-3.5 text-slate-400" />
                              <span>{tr('common.reject')}</span>
                            </button>
                          </div>
                        )}
                        {['CANCELLED', 'EXPIRED'].includes(v.status) && (
                          <span className="text-xs font-bold">{localizedLabel(v.status)}</span>
                        )}
                        {v.reviewNote && <p className="text-xs text-slate-600">{v.reviewNote}</p>}
                        {v.presence === 'NEEDS_REVIEW' && (
                          <p role="alert" className="text-xs text-amber-700">
                            {tr(
                              'visitor_access_view.legacy_group_count_needs_reconciliation_at_the_gate',
                            )}
                          </p>
                        )}
                        {canManualCheckout && inside > 0 && (
                          <button
                            disabled={
                              manualCheckout.isPending ||
                              !reviewNote.trim() ||
                              !representativeConfirmed
                            }
                            onClick={() => manualCheckout.mutate(v.id)}
                            className="rounded border px-3 py-1"
                          >
                            {tr('common.manual_group_checkout')}
                          </button>
                        )}
                        {canApprove && ['PENDING', 'APPROVED'].includes(v.status) && (
                          <button
                            disabled={decide.isPending || !reviewNote.trim()}
                            onClick={() =>
                              decide.mutate({ id: v.id, status: 'CANCELLED', version: v.version })
                            }
                            className="mt-2 block rounded-lg border px-3 py-1 text-xs disabled:opacity-50"
                          >
                            {tr('common.cancel_visit')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Security Gate QR Verification Station */}
      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-[#FF7A1A]">
            <IconCamera className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-900">
              {tr('visitor_access_view.scan_visitor_qr_at_gate')}
            </h2>
            <p className="text-xs text-slate-500">
              {tr(
                'visitor_access_view.the_representative_confirms_entry_or_exit_for_the_entire_approved_group',
              )}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Left Column: Gate Selector & Camera Scanner */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                {tr('common.designated_gate')}
                <select
                  disabled={verify.isPending}
                  value={gateId}
                  onChange={(e) => setGateId(e.target.value)}
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

            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
              <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-600">
                {tr('visitor_access_view.camera_upload_qr')}
              </span>
              <QrScannerView
                disabled={verify.isPending}
                onScan={(value) => {
                  setQrToken(value);
                  verify.reset();
                }}
              />
            </div>
          </div>

          {/* Right Column: Token Input, Headcount & Confirm Actions */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                {tr('common.qr_token')}
                <input
                  disabled={verify.isPending}
                  value={qrToken}
                  onChange={(e) => setQrToken(e.target.value)}
                  placeholder={tr('visitor_access_view.enter_or_scan_token_ssq')}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 font-mono text-xs text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-[#FF7A1A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/15"
                />
              </label>
            </div>

            <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              {tr(
                'visitor_access_view.headcount_comes_from_the_approved_visit_and_includes_the_representative_confirm_on',
              )}
            </p>

            {/* Confirmation Buttons */}
            <div className="pt-2 flex flex-wrap gap-3">
              {(['IN', 'OUT'] as const).map((d) => (
                <button
                  key={d}
                  disabled={!qrToken.trim() || verify.isPending}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-xs font-bold text-white shadow-xs transition-all disabled:opacity-40 ${
                    d === 'IN'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-slate-800 hover:bg-slate-900'
                  }`}
                  onClick={() => confirm(d)}
                >
                  {verify.isPending ? (
                    <IconLoader className="h-4 w-4" />
                  ) : d === 'IN' ? (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 14l-7 7m0 0l-7-7m7 7V3"
                      />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 10l7-7m0 0l7 7m-7-7v18"
                      />
                    </svg>
                  )}
                  <span>
                    {tr('common.confirm_check_value', {
                      value1: d === 'IN' ? tr('common.in_in') : tr('common.out_out'),
                    })}
                  </span>
                </button>
              ))}
            </div>

            {/* Error and Success Feedback */}
            {verify.error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700"
              >
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                <span>{localizedError(verify.error.message)}</span>
              </div>
            )}

            {message && (
              <div
                role="status"
                className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-semibold text-emerald-800"
              >
                <IconCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>{localizeMessage(message)}</span>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
