import { localizedLabel } from '../../../i18n/labels';
import { userErrorMessage } from '../../../i18n/messages';
import { translate as tr } from '../../../i18n';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useManagementClient, useAuth, useCurrentUser } from '../../../features/auth/auth-session';
import type { ZoneResponse } from '@smartsite/contracts';
import { uiLocale } from '../../../i18n';
import { IconCamera, IconShield, IconPlus, IconUsers, IconAlertTriangle } from '../../icons';
import { SmartDatePicker } from '../../ui';
import { participationDates } from './participation-dates';

const fieldInput =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-2xs hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#F66B17]/20 focus:border-[#F66B17] transition-all';
const primaryButton =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl bg-[#F66B17] hover:bg-[#E05A0A] text-white px-4 py-2 text-xs font-bold shadow-xs transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer';

export function SiteOperationsSetupView({
  apiUrl,
  participationOnly = false,
}: {
  apiUrl: string;
  participationOnly?: boolean;
}) {
  const { t } = useTranslation();
  const locale = uiLocale();
  const { accessToken } = useAuth();
  const { data: user } = useCurrentUser(apiUrl);
  const client = useManagementClient(apiUrl);
  const cache = useQueryClient();

  const [requestedSite, setSite] = useState('');
  const [zoneCode, setZoneCode] = useState('');
  const [zoneName, setZoneName] = useState('');
  const [policy, setPolicy] = useState<ZoneResponse['restrictionPolicy']>('NONE');
  const [cameraCode, setCameraCode] = useState('');
  const [cameraName, setCameraName] = useState('');
  const [externalId, setExternalId] = useState('');
  const [contractorId, setContractorId] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const invalidParticipationRange = Boolean(validFrom && validUntil && validUntil < validFrom);

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
  const siteId = permittedSites.some((s) => s.id === requestedSite)
    ? requestedSite
    : (permittedSites[0]?.id ?? '');
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

  const contractors = useQuery({
    queryKey: [...key, siteId, 'contractors'],
    queryFn: () => client.contractorParticipationOptions(accessToken!, siteId),
    enabled: !!accessToken && !!siteId,
  });

  const access = useQuery({
    queryKey: [...key, siteId, 'participations'],
    queryFn: () => client.accessSetup(accessToken!, siteId),
    enabled: !!accessToken && !!siteId,
  });

  const invalidate = () => cache.invalidateQueries({ queryKey: key });

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
      await invalidate();
    },
  });

  const participate = useMutation({
    mutationFn: () =>
      client.createContractorParticipation(accessToken!, contractorId, {
        siteId,
        ...participationDates(validFrom, validUntil),
      }),
    onSuccess: invalidate,
  });

  const submit = (e: FormEvent, mutation: { mutate(): void }) => {
    e.preventDefault();
    if (canManage) mutation.mutate();
  };

  if (sites.isPending) {
    return (
      <div className="flex items-center gap-2 p-8 text-xs text-slate-500">
        <div className="h-4 w-4 border-2 border-[#F66B17] border-t-transparent rounded-full animate-spin" />
        <p role="status">{t('siteOps.loadingSites')}</p>
      </div>
    );
  }

  if (sites.error) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 p-4 text-xs font-semibold text-rose-800"
      >
        <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
        <span>{userErrorMessage(sites.error)}</span>
      </div>
    );
  }

  if (!siteId) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
        <p>{t('siteOps.noSiteAssigned')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-[#2F3437]">
      {/* Header section */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div
          className={`flex flex-wrap items-center justify-between gap-4 ${participationOnly ? '' : 'border-b border-slate-100 pb-4'}`}
        >
          {!participationOnly && (
            <div className="space-y-1">
              <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#F66B17] border border-orange-200/60">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#F66B17]" />
                  {tr('integrated_ui.site_operations')}
                </span>
                <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  {canManage ? tr('integrated_ui.manager') : tr('integrated_ui.observer')}
                </span>
              </div>
              <h1 className="text-xl font-extrabold tracking-tight text-[#111111]">
                {canManage ? t('siteOps.titleManage') : t('siteOps.titleObserve')}
              </h1>
            </div>
          )}

          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-xs font-bold text-slate-700">
              <span>{t('siteOps.siteLabel')}</span>
              <select
                className="min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#F66B17]/20 focus:border-[#F66B17] transition-all cursor-pointer"
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
      </section>

      {/* Participating Contractors section */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-50 border border-orange-200/70 text-[#F66B17] shrink-0">
            <IconUsers className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              {t('siteOps.contractorsTitle')}
            </h2>
          </div>
        </div>

        {access.isPending && (
          <div className="flex items-center gap-2 p-4 text-xs text-slate-500">
            <div className="h-3.5 w-3.5 border-2 border-[#F66B17] border-t-transparent rounded-full animate-spin" />
            <p role="status">{t('siteOps.loadingContractors')}</p>
          </div>
        )}

        {(access.error || contractors.error) && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-800"
          >
            <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{userErrorMessage(access.error || contractors.error)}</span>
            <button
              type="button"
              className="underline focus-visible:outline-2"
              onClick={() => {
                void access.refetch();
                void contractors.refetch();
              }}
            >
              {t('common.retry')}
            </button>
          </div>
        )}

        {access.data?.participations && access.data.participations.length > 0 && (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {access.data.participations.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 text-xs space-y-1 hover:border-slate-300 transition-all"
              >
                <p className="font-bold text-slate-900">{p.name}</p>
                <p className="text-[11px] text-slate-500 font-mono">
                  {new Date(p.validFrom).toLocaleString(locale)} —{' '}
                  {p.validUntil
                    ? new Date(p.validUntil).toLocaleString(locale)
                    : t('siteOps.indefinite')}
                </p>
              </div>
            ))}
          </div>
        )}

        {access.data?.participations.length === 0 && (
          <p className="text-xs text-slate-400 py-4 text-center">{t('siteOps.noContractors')}</p>
        )}

        {canManage && (
          <form
            className="flex flex-wrap items-end gap-3 pt-3 border-t border-slate-100"
            onSubmit={(e) => {
              if (!validFrom || invalidParticipationRange) {
                e.preventDefault();
                return;
              }
              submit(e, participate);
            }}
          >
            <div className="space-y-1 text-xs">
              <label className="font-bold text-slate-700">{t('siteOps.contractorLabel')}</label>
              <select
                required
                className={fieldInput}
                value={contractorId}
                onChange={(e) => setContractorId(e.target.value)}
              >
                <option value="">{t('siteOps.selectContractor')}</option>
                {contractors.data?.items
                  .filter((c) => c.isActive)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="w-full sm:w-64">
              <SmartDatePicker
                label={t('siteOps.from')}
                fieldRequired
                value={validFrom}
                onChange={setValidFrom}
                disablePast={false}
              />
            </div>
            <div className="w-full sm:w-64">
              <SmartDatePicker
                label={t('siteOps.until')}
                value={validUntil}
                onChange={setValidUntil}
                disablePast={false}
                clearable
                min={validFrom || undefined}
                error={
                  invalidParticipationRange
                    ? t('contractor_zone_setup.end_date_must_be_on_or_after_start_date')
                    : undefined
                }
              />
            </div>
            <button
              className={primaryButton}
              disabled={participate.isPending || !validFrom || invalidParticipationRange}
            >
              <IconPlus className="w-3.5 h-3.5" />
              <span>{t('siteOps.addParticipation')}</span>
            </button>
            <p className="w-full text-xs text-slate-500">
              {t('siteOps.participationDateHint', {
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              })}
            </p>
          </form>
        )}
        {participate.error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-800"
          >
            <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{userErrorMessage(participate.error)}</span>
          </div>
        )}
      </section>

      {!participationOnly && (
        <>
          {/* Work Zones section */}
          <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-4">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-50 border border-orange-200/70 text-[#F66B17] shrink-0">
                <IconShield className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                  {t('siteOps.zonesTitle')}
                </h2>
              </div>
            </div>

            {zones.isPending && (
              <div className="flex items-center gap-2 p-4 text-xs text-slate-500">
                <div className="h-3.5 w-3.5 border-2 border-[#F66B17] border-t-transparent rounded-full animate-spin" />
                <p role="status">{t('siteOps.loadingZones')}</p>
              </div>
            )}

            {zones.error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-800"
              >
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{userErrorMessage(zones.error)}</span>
              </div>
            )}

            {zones.data?.items && zones.data.items.length > 0 && (
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {zones.data.items.map((z) => (
                  <div
                    key={z.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 text-xs space-y-1.5 hover:border-slate-300 transition-all"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-slate-800">{z.code}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          z.restrictionPolicy === 'NONE'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : z.restrictionPolicy === 'AUTHORIZATION_REQUIRED'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {z.restrictionPolicy === 'NONE'
                          ? t('siteOps.policyNone')
                          : z.restrictionPolicy === 'AUTHORIZATION_REQUIRED'
                            ? t('siteOps.policyAuth')
                            : t('siteOps.policyProhibited')}
                      </span>
                    </div>
                    <p className="font-semibold text-slate-900">{z.name}</p>
                  </div>
                ))}
              </div>
            )}

            {zones.data?.items.length === 0 && (
              <p className="text-xs text-slate-400 py-4 text-center">{t('siteOps.noZones')}</p>
            )}

            {canManage && (
              <form
                className="flex flex-wrap gap-3 pt-3 border-t border-slate-100"
                onSubmit={(e) => submit(e, createZone)}
              >
                <input
                  aria-label={t('siteOps.zoneCodePlaceholder')}
                  placeholder={t('siteOps.zoneCodePlaceholder')}
                  className={`${fieldInput} max-w-[160px]`}
                  required
                  maxLength={64}
                  value={zoneCode}
                  onChange={(e) => setZoneCode(e.target.value)}
                />
                <input
                  aria-label={t('siteOps.zoneNamePlaceholder')}
                  placeholder={t('siteOps.zoneNamePlaceholder')}
                  className={`${fieldInput} max-w-[220px]`}
                  required
                  maxLength={255}
                  value={zoneName}
                  onChange={(e) => setZoneName(e.target.value)}
                />
                <select
                  aria-label={t('siteOps.policyLabel')}
                  className={`${fieldInput} max-w-[200px]`}
                  value={policy}
                  onChange={(e) => setPolicy(e.target.value as ZoneResponse['restrictionPolicy'])}
                >
                  <option value="NONE">{t('siteOps.policyNone')}</option>
                  <option value="AUTHORIZATION_REQUIRED">{t('siteOps.policyAuth')}</option>
                  <option value="PROHIBITED_FOR_ALL">{t('siteOps.policyProhibited')}</option>
                </select>
                <button className={primaryButton} disabled={createZone.isPending}>
                  <IconPlus className="w-3.5 h-3.5" />
                  <span>{t('siteOps.createZone')}</span>
                </button>
              </form>
            )}
            {createZone.error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-800"
              >
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{userErrorMessage(createZone.error)}</span>
              </div>
            )}
          </section>

          {/* Site Cameras section */}
          <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-4">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-50 border border-orange-200/70 text-[#F66B17] shrink-0">
                <IconCamera className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                  {t('siteOps.camerasTitle')}
                </h2>
              </div>
            </div>

            {cameras.isPending && (
              <div className="flex items-center gap-2 p-4 text-xs text-slate-500">
                <div className="h-3.5 w-3.5 border-2 border-[#F66B17] border-t-transparent rounded-full animate-spin" />
                <p role="status">{t('siteOps.loadingCameras')}</p>
              </div>
            )}

            {cameras.error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-800"
              >
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{userErrorMessage(cameras.error)}</span>
              </div>
            )}

            {cameras.data?.items && cameras.data.items.length > 0 && (
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {cameras.data.items.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 text-xs space-y-1 hover:border-slate-300 transition-all"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-slate-800">{c.code}</span>
                      <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600 uppercase">
                        {localizedLabel(c.status)}
                      </span>
                    </div>
                    <p className="font-semibold text-slate-900">{c.name}</p>
                  </div>
                ))}
              </div>
            )}

            {cameras.data?.items.length === 0 && (
              <p className="text-xs text-slate-400 py-4 text-center">{t('siteOps.noCameras')}</p>
            )}

            {canManage && (
              <form
                className="flex flex-wrap gap-3 pt-3 border-t border-slate-100"
                onSubmit={(e) => submit(e, createCamera)}
              >
                <input
                  aria-label={t('siteOps.cameraCodePlaceholder')}
                  placeholder={t('siteOps.cameraCodePlaceholder')}
                  className={`${fieldInput} max-w-[150px]`}
                  required
                  maxLength={64}
                  value={cameraCode}
                  onChange={(e) => setCameraCode(e.target.value)}
                />
                <input
                  aria-label={t('siteOps.cameraNamePlaceholder')}
                  placeholder={t('siteOps.cameraNamePlaceholder')}
                  className={`${fieldInput} max-w-[200px]`}
                  required
                  maxLength={255}
                  value={cameraName}
                  onChange={(e) => setCameraName(e.target.value)}
                />
                <input
                  aria-label={t('siteOps.externalIdPlaceholder')}
                  placeholder={t('siteOps.externalIdPlaceholder')}
                  className={`${fieldInput} max-w-[220px]`}
                  required
                  maxLength={128}
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                />
                <button className={primaryButton} disabled={createCamera.isPending}>
                  <IconPlus className="w-3.5 h-3.5" />
                  <span>{t('siteOps.createCamera')}</span>
                </button>
              </form>
            )}
            {createCamera.error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-800"
              >
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{userErrorMessage(createCamera.error)}</span>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
