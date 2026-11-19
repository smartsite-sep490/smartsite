import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@smartsite/api-client';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconEye,
  IconHardHat,
  IconUser,
} from './components/icons';
import {
  isSafetyIdentificationRouteEnabled,
  sanitizeSafetyFrameKey,
  sanitizeSafetyQueryId,
  sanitizeSafetyUuid,
} from './components/safety-episodes/safetyUrlParams';
import { Badge } from './components/ui';
import { useManagementClient } from './features/auth/auth-session';
import i18n from './i18n';
import { hasRegisteredFeatureKey } from './i18n/feature-catalog-registry';
import { localizedLabel } from './i18n/labels';
import { SAFETY_NAMESPACE } from './i18n/runtime';
import './components/safety-episodes/tracked-episode-workspace-catalog';
import { PersonPhoto, type FrameCase } from './FrameInboxMedia';

function humanizeSnakeCode(code: string): string {
  const normalized = code.trim().replaceAll('_', ' ').toLowerCase();
  return normalized ? normalized[0]!.toUpperCase() + normalized.slice(1) : code;
}

interface SubjectFindingItem {
  alertId: string;
  alertType?: string;
  candidateSubtype: string;
  status: string;
}

function zoneToneClass(status: FrameCase['zoneEntries'][number]['status']) {
  if (status === 'DENIED') return 'border-rose-300 bg-rose-50 text-rose-950 font-semibold';
  if (status === 'PENDING') {
    return 'border-dashed border-amber-400 bg-amber-50 text-amber-950 font-medium';
  }
  if (status === 'ALLOWED') return 'border-emerald-200 bg-emerald-50 text-emerald-900 font-medium';
  return 'border-slate-200 bg-slate-100 text-slate-700 font-medium';
}

export function FrameInboxSubjectRow({
  client,
  token,
  scope,
  siteId,
  frameCameraId,
  cameraId,
  frameKey,
  entry,
  personNumber,
  personPhotoOpen,
  isTourTarget = false,
  isAckPending = false,
  onMarkCaseRead,
  onTogglePersonPhoto,
}: {
  client: ReturnType<typeof useManagementClient>;
  token: string;
  scope: string;
  siteId: string;
  frameCameraId: string;
  cameraId?: string;
  frameKey: string;
  entry: FrameCase;
  personNumber: number;
  personPhotoOpen: boolean;
  isTourTarget?: boolean;
  isAckPending?: boolean;
  onMarkCaseRead?: () => void;
  onTogglePersonPhoto: () => void;
}) {
  const { t } = useTranslation();
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);
  const handoffHintId = useId();
  const isTrackedFrame = frameKey.startsWith('tracked:');
  const canLoadFindings =
    entry.findingCount > 0 &&
    (isTrackedFrame
      ? typeof client.getTrackedEpisode === 'function'
      : typeof client.getSafetyEpisode === 'function');

  const findingsQuery = useQuery({
    queryKey: [
      'frame-subject-findings',
      scope,
      siteId,
      frameCameraId,
      frameKey,
      isTrackedFrame ? 'tracked' : 'event',
      entry.recipientId,
      entry.episodeId,
      entry.contentRevision,
    ],
    queryFn: async ({ signal }): Promise<SubjectFindingItem[]> => {
      const detail = isTrackedFrame
        ? await client.getTrackedEpisode(token, siteId, entry.episodeId, { signal })
        : await client.getSafetyEpisode(token, siteId, entry.episodeId, { signal });
      const rawFindings: SubjectFindingItem[] = Array.isArray(detail?.findings)
        ? detail.findings
        : [];
      // Frame/case findingCount counts PPE ONLY; Zone assessments are rendered in zoneEntries.
      return rawFindings.filter(
        (finding) => !finding.alertType || finding.alertType === 'PPE_VIOLATION',
      );
    },
    enabled: canLoadFindings,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  function formatZoneReason(reasonCode: string): string {
    const code = reasonCode.trim().toUpperCase().replaceAll(' ', '_');
    const featureKey = 'frameInbox.zoneReason.' + code;
    if (hasRegisteredFeatureKey(featureKey)) return tSafety(featureKey);
    if (i18n.exists('ppeNotifications.' + code)) return t('ppeNotifications.' + code);
    if (i18n.exists('labels.' + code)) return localizedLabel(code);
    return /^[A-Z0-9_]+$/.test(reasonCode.trim()) ? humanizeSnakeCode(code) : reasonCode;
  }

  const findingsForbidden =
    findingsQuery.error instanceof ApiError &&
    [401, 403, 404].includes(findingsQuery.error.status ?? 0);
  const findings = findingsForbidden || findingsQuery.isError ? [] : (findingsQuery.data ?? []);
  const safeSiteId = sanitizeSafetyQueryId(siteId);
  const safeRecipientId = sanitizeSafetyQueryId(entry.recipientId);
  const safeFrameKey = sanitizeSafetyFrameKey(frameKey);
  const safeCameraId = sanitizeSafetyUuid(cameraId)?.toLowerCase();
  const c02Enabled = isSafetyIdentificationRouteEnabled();
  const caseParams = new URLSearchParams({ tab: 'episodes' });
  if (safeSiteId) caseParams.set('siteId', safeSiteId);
  if (safeRecipientId) caseParams.set('recipientId', safeRecipientId);
  if (safeFrameKey) caseParams.set('frameKey', safeFrameKey);
  if (safeCameraId) caseParams.set('cameraId', safeCameraId);

  return (
    <li
      data-testid={`frame-subject-row-${personNumber}`}
      className={`min-w-0 rounded-xl border p-3 sm:p-3.5 transition-colors ${
        entry.unread
          ? 'border-slate-200 border-l-4 border-l-teal-600 bg-white shadow-2xs'
          : 'border-slate-200/80 bg-slate-50/70'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between min-w-0">
        <div
          data-tour-anchor={isTourTarget ? 'frame-inbox-subject-status' : undefined}
          className="min-w-0 space-y-1.5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-md border border-slate-200 bg-slate-100 px-1.5 text-xs font-bold text-slate-700"
            >
              <IconUser className="h-3 w-3 shrink-0" />
              {personNumber}
            </span>
            <span className="text-sm font-semibold text-slate-950">
              {t('frameInbox.person', { number: personNumber })}
            </span>
            {entry.findingCount > 0 && (
              <>
                <span aria-hidden="true" className="text-xs text-slate-300">
                  ·
                </span>
                <span
                  data-testid={`frame-subject-ppe-count-${personNumber}`}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-950"
                >
                  <IconHardHat className="h-3 w-3 shrink-0 text-amber-800" />
                  <span>{t('frameInbox.findings', { count: entry.findingCount })}</span>
                </span>
              </>
            )}
            <Badge
              variant={entry.unread ? 'warning' : 'neutral'}
              dot={entry.unread}
              className={`normal-case tracking-normal text-[11px] font-semibold ${
                entry.unread ? 'border-teal-700/30 bg-teal-50 text-teal-950' : ''
              }`}
            >
              {t(entry.unread ? 'episodes.unread' : 'episodes.read')}
            </Badge>
            <Badge
              variant="neutral"
              data-testid={`frame-subject-identity-${personNumber}`}
              className="normal-case tracking-normal text-[11px] font-medium"
            >
              {tSafety('frameInbox.identityUnconfirmedBadge')}
            </Badge>
          </div>
          {canLoadFindings && findingsQuery.isPending && (
            <p role="status" className="text-xs text-slate-600">
              {t('frameInbox.subjectFindingsLoading')}
            </p>
          )}
          {canLoadFindings && findingsQuery.isError && (
            <div
              role="alert"
              data-testid={`frame-subject-findings-error-${personNumber}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-950"
            >
              <span>
                {findingsForbidden
                  ? t('frameInbox.unavailable')
                  : tSafety('frameInbox.subjectFindingsError')}
              </span>
              {!findingsForbidden && (
                <button
                  type="button"
                  disabled={findingsQuery.isFetching}
                  onClick={() => void findingsQuery.refetch()}
                  className="rounded px-1.5 py-0.5 font-semibold underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:opacity-50"
                >
                  {t('common.retry')}
                </button>
              )}
            </div>
          )}
          {findings.length > 0 && (
            <ul
              aria-label={t('frameInbox.subjectFindingsLabel')}
              data-testid={`frame-subject-findings-${personNumber}`}
              className="flex flex-wrap gap-1.5 pt-0.5"
            >
              {findings.map((finding) => (
                <li
                  key={finding.alertId}
                  className="inline-flex items-center gap-1.5 rounded-md border border-amber-300/80 bg-amber-50/80 px-2 py-0.5 text-xs font-medium text-slate-900"
                >
                  <IconHardHat className="h-3 w-3 shrink-0 text-amber-800" />
                  <span>
                    {t('ppeNotifications.' + finding.candidateSubtype, {
                      defaultValue: localizedLabel(finding.candidateSubtype),
                    })}
                  </span>
                  <span aria-hidden="true" className="text-slate-400">
                    ·
                  </span>
                  <span className="text-[11px] text-slate-700">
                    {localizedLabel(finding.status)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {entry.findingCount === 0 && (
              <Badge
                variant="neutral"
                className="normal-case tracking-normal text-[11px] font-medium"
              >
                {t('frameInbox.noPpeFindings')}
              </Badge>
            )}
            {entry.source ? (
              <Badge variant="info" className="normal-case tracking-normal text-[11px] font-medium">
                <IconHardHat className="h-3 w-3 shrink-0" />
                <span>{t('frameInbox.personCropAvailable')}</span>
              </Badge>
            ) : (
              <span
                data-testid={`frame-subject-crop-missing-${personNumber}`}
                className="inline-flex flex-wrap items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50/70 px-2 py-0.5 text-xs text-amber-950"
              >
                <IconAlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                <span>{t('frameInbox.personEvidenceMissing')}</span>
                <span aria-hidden="true" className="text-amber-700/60">
                  ·
                </span>
                <span>{t('frameInbox.evidenceInCase')}</span>
              </span>
            )}
          </div>
          {entry.zoneEntries?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {entry.zoneEntries.map((zone) => (
                <div
                  key={zone.requestId}
                  data-zone-status={zone.status}
                  className={`inline-flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs ${zoneToneClass(zone.status)}`}
                >
                  {zone.status === 'DENIED' ? (
                    <IconAlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-700" />
                  ) : zone.status === 'PENDING' ? (
                    <IconClock className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                  ) : null}
                  <span>
                    {t(zone.laterFrame ? 'frameInbox.laterZone' : 'frameInbox.zone')} ·{' '}
                    {t(`frameInbox.zoneStatus.${zone.status}`)}
                  </span>
                  {zone.status === 'PENDING' && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-950">
                      {t('frameInbox.zonePendingHint')}
                    </span>
                  )}
                  {zone.status === 'DENIED' && zone.reasonCode && (
                    <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-950">
                      {formatZoneReason(zone.reasonCode)}
                    </span>
                  )}
                  {zone.status === 'UNAVAILABLE' && zone.reasonCode && (
                    <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[11px] font-medium text-slate-800">
                      {formatZoneReason(zone.reasonCode)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div
          data-tour-anchor={isTourTarget ? 'frame-inbox-open-case' : undefined}
          className="flex flex-col gap-1.5 sm:items-end sm:shrink-0"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            {entry.unread && onMarkCaseRead && (
              <button
                type="button"
                data-testid={`frame-subject-mark-read-${personNumber}`}
                disabled={isAckPending}
                onClick={onMarkCaseRead}
                className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg border border-teal-700/40 bg-teal-50/70 px-2.5 py-1.5 text-xs font-semibold text-teal-950 transition-colors hover:bg-teal-100/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IconCheck className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {isAckPending ? t('frameInbox.markingRead') : tSafety('frameInbox.markCaseRead')}
                </span>
              </button>
            )}
            {entry.source && (
              <button
                type="button"
                aria-pressed={personPhotoOpen}
                onClick={onTogglePersonPhoto}
                className={`inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700/30 ${
                  personPhotoOpen
                    ? 'border-teal-700 bg-teal-50 text-teal-950'
                    : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                }`}
              >
                <IconEye className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {t(
                    personPhotoOpen
                      ? 'frameInbox.hidePersonEvidence'
                      : 'frameInbox.viewPersonEvidence',
                    { number: personNumber },
                  )}
                </span>
              </button>
            )}
            <Link
              aria-describedby={handoffHintId}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg bg-teal-800 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-900 focus-visible:ring-2 focus-visible:ring-teal-700/40"
              to={`/incidents?${caseParams}`}
            >
              <span>{t('frameInbox.openCase', { number: personNumber })}</span>
              <IconChevronRight className="h-3.5 w-3.5 shrink-0" />
            </Link>
          </div>
          <p
            id={handoffHintId}
            data-testid={`frame-subject-handoff-hint-${personNumber}`}
            className="text-[11px] text-slate-600 sm:text-right"
          >
            {tSafety(
              c02Enabled ? 'frameInbox.caseIdentificationHint' : 'frameInbox.caseReviewHint',
            )}
          </p>
        </div>
      </div>
      {entry.source && personPhotoOpen && (
        <PersonPhoto
          key={`${siteId}:${frameCameraId}:${frameKey}:${entry.recipientId}:${entry.episodeId}:${entry.source.alertId}:${entry.source.eventId}:${entry.source.personObservationIndex}:${entry.source.evidenceIndex}:${entry.source.sha256}`}
          client={client}
          token={token}
          scope={scope}
          siteId={siteId}
          frameCameraId={frameCameraId}
          frameKey={frameKey}
          entry={entry}
          personNumber={personNumber}
        />
      )}
    </li>
  );
}
