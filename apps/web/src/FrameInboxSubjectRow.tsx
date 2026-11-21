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
} from './components/icons';
import {
  isSafetyIdentificationRouteEnabled,
  sanitizeSafetyFrameKey,
  sanitizeSafetyQueryId,
  sanitizeSafetyUuid,
} from './components/safety-episodes/safetyUrlParams';
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
  if (status === 'DENIED') return 'border-rose-300 bg-rose-50/90 text-rose-950';
  if (status === 'PENDING') {
    return 'border-dashed border-amber-400 bg-amber-50/85 text-amber-950';
  }
  if (status === 'ALLOWED') return 'border-emerald-200 bg-emerald-50/85 text-emerald-900';
  return 'border-slate-200 bg-slate-100/90 text-slate-700';
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
      className={`min-w-0 border-l-[3px] px-3.5 py-3 transition-colors ${
        entry.unread ? 'border-l-teal-700 bg-white' : 'border-l-transparent bg-slate-50/35'
      }`}
    >
      <div
        data-tour-anchor={isTourTarget ? 'frame-inbox-subject-status' : undefined}
        className="min-w-0 space-y-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              aria-hidden="true"
              className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular-nums ${
                entry.unread ? 'bg-[#0F172A] text-white' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {personNumber}
            </span>
            <h3 className="text-sm font-semibold text-slate-950">
              {t('frameInbox.person', { number: personNumber })}
            </h3>
            {entry.findingCount > 0 && (
              <span
                data-testid={`frame-subject-ppe-count-${personNumber}`}
                className="inline-flex items-center gap-1 rounded border border-amber-200/90 bg-amber-50/90 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-amber-950"
              >
                <IconHardHat className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                <span>{t('frameInbox.findings', { count: entry.findingCount })}</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
            {entry.contentRevision > 1 && (
              <span
                data-testid={`frame-subject-revision-${personNumber}`}
                className={`tabular-nums ${
                  entry.unread
                    ? 'rounded border border-teal-200/80 bg-teal-50/75 px-1.5 py-0.5 font-medium text-teal-900'
                    : 'text-slate-500'
                }`}
              >
                {tSafety(
                  entry.unread ? 'frameInbox.caseUpdatedRevision' : 'frameInbox.caseSeenRevision',
                  { revision: entry.contentRevision },
                )}
              </span>
            )}
            <span data-testid={`frame-subject-identity-${personNumber}`} className="text-slate-600">
              {tSafety('frameInbox.identityUnconfirmedBadge')}
            </span>
            <span
              className={`inline-flex items-center gap-1 ${
                entry.unread ? 'font-semibold text-teal-800' : 'text-slate-500'
              }`}
            >
              {entry.unread && (
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-teal-700" />
              )}
              {t(entry.unread ? 'episodes.unread' : 'episodes.read')}
            </span>
          </div>
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
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-1.5 text-xs text-amber-950"
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
                className="inline-flex h-7 items-center rounded-md border border-amber-300 bg-white px-2.5 text-xs font-semibold text-amber-950 hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:opacity-50"
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
            className="divide-y divide-amber-200/50 rounded-lg border border-amber-200/80 bg-amber-50/40 px-3 py-0.5"
          >
            {findings.map((finding) => (
              <li
                key={finding.alertId}
                className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs"
              >
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-900">
                  <IconHardHat className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                  <span>
                    {t('ppeNotifications.' + finding.candidateSubtype, {
                      defaultValue: localizedLabel(finding.candidateSubtype),
                    })}
                  </span>
                </span>
                <span className="font-medium text-amber-900">{localizedLabel(finding.status)}</span>
              </li>
            ))}
          </ul>
        )}

        {entry.findingCount === 0 && (
          <p className="text-xs text-slate-500">{t('frameInbox.noPpeFindings')}</p>
        )}

        {!entry.source && (
          <div
            data-testid={`frame-subject-crop-missing-${personNumber}`}
            className="flex flex-wrap items-center gap-1.5 text-xs text-amber-900"
          >
            <IconAlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-700" />
            <span className="font-medium">{t('frameInbox.personEvidenceMissing')}</span>
            <span aria-hidden="true" className="text-slate-400">
              ·
            </span>
            <span className="text-slate-600">{t('frameInbox.evidenceInCase')}</span>
          </div>
        )}

        {entry.zoneEntries?.length > 0 && (
          <div className="space-y-1.5">
            {entry.zoneEntries.map((zone) => (
              <div
                key={zone.requestId}
                data-zone-status={zone.status}
                className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border px-2.5 py-1.5 text-xs ${zoneToneClass(zone.status)}`}
              >
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  {zone.status === 'DENIED' ? (
                    <IconAlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-700" />
                  ) : zone.status === 'PENDING' ? (
                    <IconClock className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                  ) : null}
                  <span>
                    {t(zone.laterFrame ? 'frameInbox.laterZone' : 'frameInbox.zone')} ·{' '}
                    {t(`frameInbox.zoneStatus.${zone.status}`)}
                  </span>
                </span>
                {zone.status === 'PENDING' && (
                  <span className="font-medium text-amber-900">
                    {t('frameInbox.zonePendingHint')}
                  </span>
                )}
                {zone.status === 'DENIED' && zone.reasonCode && (
                  <span className="font-medium text-rose-900">
                    {formatZoneReason(zone.reasonCode)}
                  </span>
                )}
                {zone.status === 'UNAVAILABLE' && zone.reasonCode && (
                  <span className="font-medium text-slate-700">
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
        className="mt-2.5 flex flex-col gap-2 border-t border-slate-100 pt-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
      >
        <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center">
          {entry.source && (
            <button
              type="button"
              aria-pressed={personPhotoOpen}
              onClick={onTogglePersonPhoto}
              className={`inline-flex h-8 w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 ${
                personPhotoOpen
                  ? 'border-teal-700/60 bg-teal-50/80 text-teal-950'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
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
          {entry.unread && onMarkCaseRead && (
            <button
              type="button"
              data-testid={`frame-subject-mark-read-${personNumber}`}
              disabled={isAckPending}
              onClick={onMarkCaseRead}
              className="inline-flex h-8 w-full sm:w-auto items-center justify-center gap-1 rounded-lg px-2.5 text-xs font-medium whitespace-nowrap text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconCheck className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              <span>
                {isAckPending ? t('frameInbox.markingRead') : tSafety('frameInbox.markCaseRead')}
              </span>
            </button>
          )}
        </div>

        <Link
          aria-describedby={handoffHintId}
          className="inline-flex h-9 w-full sm:w-auto sm:ml-auto items-center justify-center gap-1.5 rounded-lg bg-[#0F172A] px-3.5 text-xs sm:text-sm font-semibold whitespace-nowrap text-white transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          to={`/incidents?${caseParams}`}
        >
          <span>{t('frameInbox.openCase', { number: personNumber })}</span>
          <IconChevronRight className="h-3.5 w-3.5 shrink-0" />
        </Link>
        <span
          id={handoffHintId}
          data-testid={`frame-subject-handoff-hint-${personNumber}`}
          className="sr-only"
        >
          {tSafety(c02Enabled ? 'frameInbox.caseIdentificationHint' : 'frameInbox.caseReviewHint')}
        </span>
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
