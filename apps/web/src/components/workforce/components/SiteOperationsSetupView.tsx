import { localizedLabel } from '../../../i18n/labels';
import { userErrorMessage } from '../../../i18n/messages';
import { translate as tr } from '../../../i18n';
import { useState, useMemo, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useManagementClient, useAuth, useCurrentUser } from '../../../features/auth/auth-session';
import type { ZoneResponse } from '@smartsite/contracts';
import { uiLocale } from '../../../i18n';
import {
  IconCamera,
  IconShield,
  IconPlus,
  IconUsers,
  IconAlertTriangle,
  IconChevronRight,
  IconX,
  IconBuilding,
  IconHardHat,
  IconCalendar,
  IconClock,
  IconSearch,
  IconArrowRight,
} from '../../icons';

/* ─────────────────────────────────────────────────────────────
   Design tokens (inlined for zero-abstraction)
   Premium Soft-Structuralism — construction command centre
──────────────────────────────────────────────────────────────── */

const fieldInput =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-[var(--shadow-card)] hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#F66B17]/20 focus:border-[#F66B17] transition-all duration-200';

/** Orange pill primary button */
const primaryBtn =
  'group inline-flex items-center justify-center gap-2 rounded-full bg-[#F66B17] hover:bg-[#E05A0A] text-white px-5 py-2.5 text-xs font-bold shadow-[var(--shadow-orange)] transition-all duration-300 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer';

/** Navy ghost secondary button */
const ghostBtn =
  'inline-flex items-center gap-1.5 rounded-lg border border-[#F66B17]/30 text-[#F66B17] px-3.5 py-2 text-xs font-semibold hover:bg-orange-50 hover:border-[#F66B17]/60 transition-all duration-200 cursor-pointer';

/* ── Contractor presentation helpers ────────────────────────── */

/** Extract clean 1-2 character monogram for contractor initials */
function getContractorInitials(name: string): string {
  if (!name) return 'CO';
  const clean = name.trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return 'CO';
  if (parts.length === 1) {
    return clean.slice(0, 2).toUpperCase();
  }
  const second = parts[1];
  return ((first[0] ?? '') + (second?.[0] ?? '')).toUpperCase();
}

/** Format ISO participation timestamps into clean readable date/time (without noisy seconds) */
function formatParticipationDate(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const dateStr = d.toLocaleDateString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const hours = d.getHours();
    const minutes = d.getMinutes();
    if (hours !== 0 || minutes !== 0) {
      const timeStr = d.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      return `${dateStr}, ${timeStr}`;
    }
    return dateStr;
  } catch {
    return iso;
  }
}

/** Real-time participation status */
function getParticipationStatus(validFrom: string, validUntil: string | null): 'ACTIVE' | 'UPCOMING' | 'EXPIRED' {
  const now = Date.now();
  const start = new Date(validFrom).getTime();
  const end = validUntil ? new Date(validUntil).getTime() : null;

  if (start > now) return 'UPCOMING';
  if (end !== null && end < now) return 'EXPIRED';
  return 'ACTIVE';
}

/* ── Section header with accent bar ────────────────────────── */
function SectionHeader({
  icon,
  title,
  subtitle,
  count,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-3">
        {/* Orange accent bar */}
        <div className="w-1 h-5 rounded-full bg-[#F66B17] shrink-0" />
        {/* Icon badge */}
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#041D2E]/6 text-[#041D2E] shrink-0">
          {icon}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-700">{title}</h2>
            {count !== undefined && (
              <span className="text-xs font-mono font-bold text-slate-500 bg-slate-100 border border-slate-200/80 px-2 py-0.5 rounded-full">
                {count}
              </span>
            )}
          </div>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ── Inline error banner ────────────────────────────────────── */
function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200/80 p-3.5 text-xs font-semibold text-rose-800"
    >
      <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
      <span className="flex-1">{userErrorMessage(error)}</span>
      {onRetry && (
        <button
          type="button"
          className="underline text-rose-700 hover:text-rose-900 focus-visible:outline-2 cursor-pointer"
          onClick={onRetry}
        >
          {tr('common.retry')}
        </button>
      )}
    </div>
  );
}

/* ── Skeleton card loader (shape-matched) ────────────────────── */
function CardSkeleton({ cols = 2 }: { cols?: number }) {
  return (
    <div
      className={`grid gap-3 ${cols === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}
    >
      {Array.from({ length: cols === 2 ? 2 : 3 }).map((_, i) => (
        <div key={i} className="card-shell">
          <div className="card-core space-y-2 !py-4">
            <div className="skeleton h-3 w-24 rounded" />
            <div className="skeleton h-4 w-36 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Zone restriction policy badge ──────────────────────────── */
function PolicyBadge({ policy }: { policy: ZoneResponse['restrictionPolicy'] }) {
  const map = {
    NONE: {
      label: tr('siteOps.policyNone'),
      cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    },
    AUTHORIZATION_REQUIRED: {
      label: tr('siteOps.policyAuth'),
      cls: 'bg-amber-50 text-amber-700 border border-amber-200',
    },
    PROHIBITED_FOR_ALL: {
      label: tr('siteOps.policyProhibited'),
      cls: 'bg-rose-50 text-rose-700 border border-rose-200',
    },
  };
  const { label, cls } = map[policy] ?? map.NONE;
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════
   Main component
══════════════════════════════════════════════════════════════ */

export function SiteOperationsSetupView({
  apiUrl,
  participationOnly = false,
  siteId: controlledSiteId,
}: {
  apiUrl: string;
  participationOnly?: boolean;
  siteId?: string;
}) {
  const { t } = useTranslation();
  const locale = uiLocale();
  const { accessToken } = useAuth();
  const { data: user } = useCurrentUser(apiUrl);
  const client = useManagementClient(apiUrl);
  const cache = useQueryClient();

  // ── Form state ──────────────────────────────────────────────
  const [requestedSite, setSite] = useState('');
  const [zoneCode, setZoneCode] = useState('');
  const [zoneName, setZoneName] = useState('');
  const [policy, setPolicy] = useState<ZoneResponse['restrictionPolicy']>('NONE');
  const [cameraCode, setCameraCode] = useState('');
  const [cameraName, setCameraName] = useState('');
  const [externalId, setExternalId] = useState('');

  // Collapsible add-form panels
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [showCameraForm, setShowCameraForm] = useState(false);
  const [contractorSearch, setContractorSearch] = useState('');

  // ── Queries ─────────────────────────────────────────────────
  const key = ['site-operations', apiUrl, user?.id];

  const sites = useQuery({
    queryKey: [...key, 'sites'],
    queryFn: () => client.listSites(accessToken!, { limit: 100 }),
    enabled: !!accessToken,
  });

  const admin = user?.roleAssignments.some((r) => r.role === 'ADMIN' && r.siteId === null);
  const permittedSites =
    sites.data?.items.filter(
      (site) =>
        admin ||
        user?.roleAssignments.some((r) => r.role === 'SITE_MANAGER' && r.siteId === site.id),
    ) ?? [];
  const siteId =
    controlledSiteId ||
    (permittedSites.some((s) => s.id === requestedSite)
      ? requestedSite
      : (permittedSites[0]?.id ?? ''));
  const canManage =
    !!siteId && user?.roleAssignments.some((r) => r.role === 'SITE_MANAGER' && r.siteId === siteId);

  const zones = useQuery({
    queryKey: [...key, siteId, 'zones'],
    queryFn: () => client.listZones(accessToken!, siteId, { limit: 100 }),
    enabled: !!accessToken && !!siteId,
  });

  const cameras = useQuery({
    queryKey: [...key, siteId, 'cameras'],
    queryFn: () => client.listCameras(accessToken!, siteId, { limit: 100 }),
    enabled: !!accessToken && !!siteId,
  });

  const access = useQuery({
    queryKey: [...key, siteId, 'participations'],
    queryFn: () => client.accessSetup(accessToken!, siteId),
    enabled: !!accessToken && !!siteId,
  });

  const participations = useMemo(
    () => access.data?.participations ?? [],
    [access.data?.participations],
  );
  const filteredParticipations = useMemo(() => {
    if (!contractorSearch.trim()) return participations;
    const q = contractorSearch.toLowerCase();
    return participations.filter((p) => p.name.toLowerCase().includes(q));
  }, [participations, contractorSearch]);

  const invalidate = () => cache.invalidateQueries({ queryKey: key });

  // ── Mutations ────────────────────────────────────────────────
  const createZone = useMutation({
    mutationFn: () =>
      client.createZone(accessToken!, siteId, {
        code: zoneCode,
        name: zoneName,
        type: policy === 'NONE' ? 'STANDARD' : 'RESTRICTED',
        restrictionPolicy: policy,
        requiredPpe: [],
      }),
    onSuccess: async () => {
      setZoneCode('');
      setZoneName('');
      setShowZoneForm(false);
      await invalidate();
    },
  });

  const createCamera = useMutation({
    mutationFn: () =>
      client.createCamera(accessToken!, siteId, { code: cameraCode, name: cameraName, externalId }),
    onSuccess: async () => {
      setCameraCode('');
      setCameraName('');
      setExternalId('');
      setShowCameraForm(false);
      await invalidate();
    },
  });

  const submit = (e: FormEvent, mutation: { mutate(): void }) => {
    e.preventDefault();
    if (canManage) mutation.mutate();
  };

  // ── Loading / error states ──────────────────────────────────
  if (sites.isPending) {
    return (
      <div className="space-y-3 p-2">
        <div className="flex items-center gap-3 px-1">
          <div className="skeleton h-4 w-4 rounded-full" />
          <div className="skeleton h-3 w-40 rounded" />
        </div>
        <CardSkeleton cols={2} />
      </div>
    );
  }

  if (sites.error) {
    return <ErrorBanner error={sites.error} />;
  }

  if (!siteId) {
    return (
      <div className="card-shell">
        <div className="card-core flex flex-col items-center gap-3 py-10 text-center">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
            <IconShield className="h-5 w-5" />
          </div>
          <p className="text-sm font-semibold text-slate-500">{t('siteOps.noSiteAssigned')}</p>
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="space-y-5 text-[#1e293b]">
      {/* ── Header: site selector + role badge (ONLY when standalone, NOT when participationOnly) ── */}
      {!participationOnly && (
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4 mb-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                {/* Site Operations pill */}
                <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 border border-orange-200/60 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#F66B17]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#F66B17]" />
                  {tr('integrated_ui.site_operations')}
                </span>
                {/* Role badge */}
                <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  {canManage ? tr('integrated_ui.manager') : tr('integrated_ui.observer')}
                </span>
              </div>
              <h1 className="text-xl font-extrabold tracking-tight text-[#041D2E]">
                {canManage ? t('siteOps.titleManage') : t('siteOps.titleObserve')}
              </h1>
            </div>

            {/* Site selector */}
            <label className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-600">
              <span>{t('siteOps.siteLabel')}</span>
              <select
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#F66B17]/20 focus:border-[#F66B17] transition-all duration-200 cursor-pointer"
                value={siteId}
                onChange={(e) => setSite(e.target.value)}
              >
                {permittedSites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {/* ── Participating Contractors ───────────────────────── */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 shadow-xs">
        <div>
          <SectionHeader
            icon={<IconUsers className="h-4 w-4" />}
            title={t('siteOps.contractorsTitle')}
            subtitle={t('siteOps.contractorsSubtitle')}
            count={participations.length}
            action={
              participations.length > 2 || contractorSearch ? (
                <div className="relative min-w-[200px] sm:w-64">
                  <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={contractorSearch}
                    onChange={(e) => setContractorSearch(e.target.value)}
                    placeholder={t('siteOps.filterContractors')}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50/60 pl-8 pr-7 py-1.5 text-xs font-medium text-slate-800 placeholder-slate-400 hover:border-slate-300 focus:bg-white focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/20 focus:outline-none transition-all"
                  />
                  {contractorSearch && (
                    <button
                      type="button"
                      onClick={() => setContractorSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      aria-label={t('siteOps.clearFilter')}
                    >
                      <IconX className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ) : undefined
            }
          />

          {/* Loading skeleton */}
          {access.isPending && <CardSkeleton cols={2} />}

          {/* Error */}
          {access.error && (
            <ErrorBanner
              error={access.error}
              onRetry={() => {
                void access.refetch();
              }}
            />
          )}

          {/* Participations grid */}
          {!access.isPending && !access.error && filteredParticipations.length > 0 && (
            <div className="grid gap-3.5 sm:grid-cols-2">
              {filteredParticipations.map((p) => {
                const status = getParticipationStatus(p.validFrom, p.validUntil);
                const assignedWorkersCount = (access.data?.assignments ?? []).filter(
                  (a) => a.siteContractorId === p.id,
                ).length;
                const assignedZonesCount = (access.data?.contractorPermissions ?? []).filter(
                  (cp) => cp.siteContractorId === p.id && !cp.revokedAt,
                ).length;

                return (
                  <div
                    key={p.id}
                    className="group flex flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs hover:border-slate-300 hover:shadow-sm transition-all duration-200"
                  >
                    <div className="space-y-3">
                      {/* Top row: Monogram + Name + Status pill */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Solid Navy monogram badge (zero gradients) */}
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#041D2E] text-white font-bold text-sm tracking-wider select-none shadow-xs">
                            {getContractorInitials(p.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900 group-hover:text-[#041D2E] transition-colors truncate">
                              {p.name}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500 font-medium">
                              <IconBuilding className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>{t('siteOps.contractorPartner')}</span>
                            </div>
                          </div>
                        </div>

                        {/* Status badge */}
                        <div className="shrink-0">
                          {status === 'ACTIVE' && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              {t('siteOps.statusActive')}
                            </span>
                          )}
                          {status === 'UPCOMING' && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200/80 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              {t('siteOps.statusUpcoming')}
                            </span>
                          )}
                          {status === 'EXPIRED' && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                              {t('siteOps.statusExpired')}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Timeline Surface */}
                      <div className="rounded-lg bg-slate-50/90 border border-slate-100 p-2.5">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          {/* Valid From */}
                          <div className="min-w-0 flex-1">
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              {t('siteOps.from')}
                            </span>
                            <div className="mt-0.5 flex items-center gap-1.5 font-semibold text-slate-800">
                              <IconCalendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="font-mono text-xs truncate">
                                {formatParticipationDate(p.validFrom, locale)}
                              </span>
                            </div>
                          </div>

                          {/* Arrow divider */}
                          <div className="flex items-center text-slate-300 shrink-0 px-1">
                            <IconArrowRight className="w-3.5 h-3.5" />
                          </div>

                          {/* Valid Until */}
                          <div className="min-w-0 flex-1 text-right">
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              {t('siteOps.until')}
                            </span>
                            <div className="mt-0.5 flex items-center justify-end gap-1.5 font-semibold">
                              {p.validUntil ? (
                                <>
                                  <IconCalendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <span className="font-mono text-xs text-slate-800 truncate">
                                    {formatParticipationDate(p.validUntil, locale)}
                                  </span>
                                </>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded bg-slate-200/60 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                  <IconClock className="w-3 h-3 text-slate-500 shrink-0" />
                                  {t('siteOps.indefinite')}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Operational Meta Footer */}
                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs text-slate-500">
                      <div className="flex items-center gap-3">
                        {/* Assigned Zones Chip */}
                        <span
                          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600"
                          title={`${assignedZonesCount} ${t('siteOps.assignedZones')}`}
                        >
                          <IconShield className="w-3.5 h-3.5 text-[#F66B17]" />
                          <span className="font-bold text-slate-800 font-mono">{assignedZonesCount}</span>
                          <span className="text-slate-500">{t('siteOps.assignedZones')}</span>
                        </span>

                        <span className="h-3 w-px bg-slate-200" aria-hidden="true" />

                        {/* Assigned Workers Chip */}
                        <span
                          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600"
                          title={`${assignedWorkersCount} ${t('siteOps.assignedWorkers')}`}
                        >
                          <IconHardHat className="w-3.5 h-3.5 text-slate-400" />
                          <span className="font-bold text-slate-800 font-mono">{assignedWorkersCount}</span>
                          <span className="text-slate-500">{t('siteOps.assignedWorkers')}</span>
                        </span>
                      </div>

                      {/* Short ID badge */}
                      <span className="text-[10px] font-mono text-slate-400">
                        {p.id ? `#${p.id.slice(0, 8)}` : ''}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty search results state */}
          {!access.isPending &&
            !access.error &&
            participations.length > 0 &&
            filteredParticipations.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
                <IconSearch className="w-5 h-5 text-slate-400" />
                <p className="text-xs font-semibold text-slate-600">
                  {t('siteOps.noMatchingContractors', { query: contractorSearch })}
                </p>
                <button
                  type="button"
                  onClick={() => setContractorSearch('')}
                  className="text-xs font-semibold text-[#F66B17] hover:underline cursor-pointer"
                >
                  {t('siteOps.clearFilter')}
                </button>
              </div>
            )}

          {/* Empty state: No participations configured */}
          {!access.isPending && !access.error && participations.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-center text-slate-400">
                <IconUsers className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-700">{t('siteOps.noContractors')}</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  {t('siteOps.contractorsSubtitle')}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Work Zones + Cameras (only when not participation-only) ── */}
      {!participationOnly && (
        <>
          {/* Work Zones */}
          <div className="card-shell">
            <div className="card-core">
              <SectionHeader
                icon={<IconShield className="h-4 w-4" />}
                title={t('siteOps.zonesTitle')}
                count={zones.data?.items.length}
                action={
                  canManage && (
                    <button
                      type="button"
                      className={ghostBtn}
                      onClick={() => setShowZoneForm((v) => !v)}
                    >
                      {showZoneForm ? (
                        <>
                          <IconX className="w-3.5 h-3.5" />
                          <span>{tr('common.cancel')}</span>
                        </>
                      ) : (
                        <>
                          <IconPlus className="w-3.5 h-3.5" />
                          <span>{t('siteOps.createZone')}</span>
                        </>
                      )}
                    </button>
                  )
                }
              />

              {zones.isPending && <CardSkeleton cols={3} />}
              {zones.error && <ErrorBanner error={zones.error} />}

              {/* Zones grid */}
              {zones.data?.items && zones.data.items.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {zones.data.items.map((z) => (
                    <div
                      key={z.id}
                      className="rounded-xl bg-slate-50/70 ring-1 ring-slate-900/5 p-1.5 hover:[box-shadow:var(--shadow-card-hover)] transition-all duration-300"
                    >
                      <div
                        className="rounded-[calc(0.75rem-4px)] bg-white px-4 py-3.5 space-y-1.5"
                        style={{ boxShadow: 'var(--shadow-card)' }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md">
                            {z.code}
                          </span>
                          <PolicyBadge policy={z.restrictionPolicy} />
                        </div>
                        <p className="text-sm font-semibold text-slate-900">{z.name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Empty state */}
              {zones.data?.items.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <div className="w-10 h-10 rounded-xl bg-slate-50 ring-1 ring-slate-900/5 flex items-center justify-center text-slate-400">
                    <IconShield className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-500">{t('siteOps.noZones')}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {canManage ? `${t('siteOps.createZone')} →` : ''}
                    </p>
                  </div>
                </div>
              )}

              {createZone.error && <ErrorBanner error={createZone.error} />}

              {/* ── Collapsible new-zone form ── */}
              {canManage && showZoneForm && (
                <form
                  className="mt-4 rounded-xl bg-orange-50/50 border border-orange-200/60 p-4 space-y-3"
                  onSubmit={(e) => submit(e, createZone)}
                >
                  <p className="text-xs font-bold text-[#F66B17] uppercase tracking-widest mb-2">
                    {t('siteOps.createZone')}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">
                        {t('siteOps.zoneCodePlaceholder')}
                      </label>
                      <input
                        aria-label={t('siteOps.zoneCodePlaceholder')}
                        placeholder={t('siteOps.zoneCodePlaceholder')}
                        className={fieldInput}
                        required
                        maxLength={64}
                        value={zoneCode}
                        onChange={(e) => setZoneCode(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">
                        {t('siteOps.zoneNamePlaceholder')}
                      </label>
                      <input
                        aria-label={t('siteOps.zoneNamePlaceholder')}
                        placeholder={t('siteOps.zoneNamePlaceholder')}
                        className={fieldInput}
                        required
                        maxLength={255}
                        value={zoneName}
                        onChange={(e) => setZoneName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">
                        {t('siteOps.policyLabel')}
                      </label>
                      <select
                        aria-label={t('siteOps.policyLabel')}
                        className={fieldInput}
                        value={policy}
                        onChange={(e) =>
                          setPolicy(e.target.value as ZoneResponse['restrictionPolicy'])
                        }
                      >
                        <option value="NONE">{t('siteOps.policyNone')}</option>
                        <option value="AUTHORIZATION_REQUIRED">{t('siteOps.policyAuth')}</option>
                        <option value="PROHIBITED_FOR_ALL">{t('siteOps.policyProhibited')}</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end pt-1">
                    <button className={primaryBtn} disabled={createZone.isPending}>
                      <IconPlus className="w-3.5 h-3.5" />
                      <span>{t('siteOps.createZone')}</span>
                      <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center group-hover:translate-x-0.5 transition-transform">
                        <IconChevronRight className="w-3 h-3" />
                      </span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* Site Cameras */}
          <div className="card-shell">
            <div className="card-core">
              <SectionHeader
                icon={<IconCamera className="h-4 w-4" />}
                title={t('siteOps.camerasTitle')}
                count={cameras.data?.items.length}
                action={
                  canManage && (
                    <button
                      type="button"
                      className={ghostBtn}
                      onClick={() => setShowCameraForm((v) => !v)}
                    >
                      {showCameraForm ? (
                        <>
                          <IconX className="w-3.5 h-3.5" />
                          <span>{tr('common.cancel')}</span>
                        </>
                      ) : (
                        <>
                          <IconPlus className="w-3.5 h-3.5" />
                          <span>{t('siteOps.createCamera')}</span>
                        </>
                      )}
                    </button>
                  )
                }
              />

              {cameras.isPending && <CardSkeleton cols={3} />}
              {cameras.error && <ErrorBanner error={cameras.error} />}

              {cameras.data?.items && cameras.data.items.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {cameras.data.items.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-xl bg-slate-50/70 ring-1 ring-slate-900/5 p-1.5 hover:[box-shadow:var(--shadow-card-hover)] transition-all duration-300"
                    >
                      <div
                        className="rounded-[calc(0.75rem-4px)] bg-white px-4 py-3.5 space-y-1.5"
                        style={{ boxShadow: 'var(--shadow-card)' }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md">
                            {c.code}
                          </span>
                          <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[10px] font-bold text-slate-600 uppercase tracking-wide">
                            {localizedLabel(c.status)}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-slate-900">{c.name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {cameras.data?.items.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <div className="w-10 h-10 rounded-xl bg-slate-50 ring-1 ring-slate-900/5 flex items-center justify-center text-slate-400">
                    <IconCamera className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-500">{t('siteOps.noCameras')}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {canManage ? `${t('siteOps.createCamera')} →` : ''}
                    </p>
                  </div>
                </div>
              )}

              {createCamera.error && <ErrorBanner error={createCamera.error} />}

              {/* ── Collapsible new-camera form ── */}
              {canManage && showCameraForm && (
                <form
                  className="mt-4 rounded-xl bg-orange-50/50 border border-orange-200/60 p-4 space-y-3"
                  onSubmit={(e) => submit(e, createCamera)}
                >
                  <p className="text-xs font-bold text-[#F66B17] uppercase tracking-widest mb-2">
                    {t('siteOps.createCamera')}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">
                        {t('siteOps.cameraCodePlaceholder')}
                      </label>
                      <input
                        aria-label={t('siteOps.cameraCodePlaceholder')}
                        placeholder={t('siteOps.cameraCodePlaceholder')}
                        className={fieldInput}
                        required
                        maxLength={64}
                        value={cameraCode}
                        onChange={(e) => setCameraCode(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">
                        {t('siteOps.cameraNamePlaceholder')}
                      </label>
                      <input
                        aria-label={t('siteOps.cameraNamePlaceholder')}
                        placeholder={t('siteOps.cameraNamePlaceholder')}
                        className={fieldInput}
                        required
                        maxLength={255}
                        value={cameraName}
                        onChange={(e) => setCameraName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">
                        {t('siteOps.externalIdPlaceholder')}
                      </label>
                      <input
                        aria-label={t('siteOps.externalIdPlaceholder')}
                        placeholder={t('siteOps.externalIdPlaceholder')}
                        className={fieldInput}
                        required
                        maxLength={128}
                        value={externalId}
                        onChange={(e) => setExternalId(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end pt-1">
                    <button className={primaryBtn} disabled={createCamera.isPending}>
                      <IconPlus className="w-3.5 h-3.5" />
                      <span>{t('siteOps.createCamera')}</span>
                      <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center group-hover:translate-x-0.5 transition-transform">
                        <IconChevronRight className="w-3 h-3" />
                      </span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
