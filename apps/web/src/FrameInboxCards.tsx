import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SafetyFrameInboxPage } from '@smartsite/api-client';
import {
  IconAlertTriangle,
  IconBuilding,
  IconCamera,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconHardHat,
  IconUsers,
} from './components/icons';
import { Badge } from './components/ui';
import type { useManagementClient } from './features/auth/auth-session';
import './frame-inbox-catalog';
import { uiLocale } from './i18n';
import { SAFETY_NAMESPACE } from './i18n/runtime';
import './components/safety-episodes/tracked-episode-workspace-catalog';
import { FrameMissingEvidenceNotice, FramePhoto, type FrameCase } from './FrameInboxMedia';
import { FrameInboxSubjectRow } from './FrameInboxSubjectRow';

const FRAME_INBOX_SCOPE_KEY = 'frameInbox.scopeCountNote';

export type FrameInboxItem = SafetyFrameInboxPage['items'][number];

export interface FrameInboxCardsProps {
  client: ReturnType<typeof useManagementClient>;
  token: string;
  scope: string;
  frames: readonly FrameInboxItem[];
  cameraId?: string;
  frameKey?: string;
  onRefetch: () => Promise<unknown>;
}

function buildSubjectCropKey(frameIdentity: string, entry: FrameCase): string {
  const src = entry.source;
  return JSON.stringify([
    frameIdentity,
    entry.recipientId,
    entry.episodeId,
    src?.alertId ?? '',
    src?.eventId ?? '',
    src?.personObservationIndex ?? -1,
    src?.evidenceIndex ?? -1,
    src?.sha256 ?? '',
  ]);
}

export function FrameInboxCards({
  client,
  token,
  scope,
  frames,
  cameraId,
  frameKey,
  onRefetch,
}: FrameInboxCardsProps) {
  const { t } = useTranslation();
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);
  const queryClient = useQueryClient();
  const isMountedRef = useRef(true);
  const [open, setOpen] = useState<string>();
  const [openPersonCropIds, setOpenPersonCropIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const read = useMutation({
    mutationFn: async (
      cases: ReadonlyArray<{ recipientId: string; contentRevision: number; unread?: boolean }>,
    ) => {
      const targets = cases.filter((entry) => entry.unread !== false);
      if (!targets.length) return;
      const results = await Promise.allSettled(
        targets.map((entry) =>
          client.readSafetyEpisodeInbox(token, entry.recipientId, {
            seenRevision: entry.contentRevision,
          }),
        ),
      );
      await Promise.all([
        isMountedRef.current ? onRefetch() : Promise.resolve(),
        queryClient.invalidateQueries({ queryKey: ['notification-bell-ppe-inbox'] }),
      ]);
      const failed = results.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    },
  });

  const firstExpandedIndex = frames.findIndex((frame) => {
    const key = JSON.stringify([frame.siteId, frame.cameraId, frame.frameKey]);
    return open === key || (open === undefined && frame.frameKey === frameKey);
  });
  const tourCardIndex = firstExpandedIndex >= 0 ? firstExpandedIndex : 0;

  return (
    <>
      {read.isError && (
        <p
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-sm font-medium text-amber-950"
        >
          {t('frameInbox.readError')}
        </p>
      )}
      {frames.map((frame, frameIndex) => {
        const key = JSON.stringify([frame.siteId, frame.cameraId, frame.frameKey]);
        const panelId = `frame-breakdown-${frameIndex}`;
        const expanded = open === key || (open === undefined && frame.frameKey === frameKey);
        const allZones = frame.cases.flatMap((entry) => entry.zoneEntries);
        const denials = allZones.filter((zone) => zone.status === 'DENIED');
        const laterDenials = denials.filter((zone) => zone.laterFrame).length;
        const deniedCount = denials.length - laterDenials;
        const pendingZoneCount = allZones.filter((zone) => zone.status === 'PENDING').length;
        const unavailableZoneCount = allZones.filter(
          (zone) => zone.status === 'UNAVAILABLE',
        ).length;
        const sharedEvidenceEntry = frame.cases.find((entry) => entry.source);

        return (
          <article
            key={key}
            className={`min-w-0 rounded-2xl border p-4 sm:p-5 transition-colors ${
              frame.unread
                ? 'border-teal-700/40 border-l-4 border-l-teal-700 bg-white shadow-xs ring-1 ring-teal-700/10'
                : 'border-slate-200 bg-slate-50/55 hover:bg-white'
            }`}
          >
            <button
              type="button"
              data-tour-anchor={
                frameIndex === tourCardIndex ? 'frame-inbox-card-summary' : undefined
              }
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => setOpen(expanded ? '' : key)}
              className="group w-full min-w-0 rounded-xl p-1.5 -m-1.5 text-left transition-colors hover:bg-slate-50/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 focus-visible:ring-4 focus-visible:ring-teal-700/20"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs sm:text-sm">
                  <span
                    title={frame.siteName}
                    className="inline-flex min-w-0 max-w-full items-center gap-1.5 font-semibold text-slate-900"
                  >
                    <IconBuilding className="h-4 w-4 shrink-0 text-slate-500" />
                    <span className="truncate">{frame.siteName}</span>
                  </span>
                  <span aria-hidden="true" className="text-slate-400">
                    ·
                  </span>
                  <span
                    title={frame.cameraName}
                    className="inline-flex min-w-0 max-w-full items-center gap-1.5 font-medium text-slate-700"
                  >
                    <IconCamera className="h-4 w-4 shrink-0 text-slate-500" />
                    <span className="truncate">{frame.cameraName}</span>
                  </span>
                  <span aria-hidden="true" className="text-slate-400">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-slate-600">
                    <IconClock className="h-4 w-4 shrink-0 text-slate-500" />
                    <time dateTime={frame.capturedAt}>
                      {new Date(frame.capturedAt).toLocaleString(uiLocale())}
                    </time>
                  </span>
                </div>
                <Badge
                  variant={frame.unread ? 'warning' : 'neutral'}
                  dot={frame.unread}
                  className={`normal-case tracking-normal shrink-0 px-2.5 py-0.5 text-xs font-semibold ${
                    frame.unread ? 'border-teal-700/35 bg-teal-50 text-teal-950' : ''
                  }`}
                >
                  {t(frame.unread ? 'episodes.unread' : 'episodes.read')}
                </Badge>
              </div>
              <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between min-w-0">
                <div className="flex min-w-0 items-start sm:items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={`inline-flex h-10 min-w-11 shrink-0 items-center justify-center gap-1 rounded-xl border px-2.5 text-sm font-bold ${
                      frame.unread
                        ? 'border-teal-700/35 bg-teal-50 text-teal-950'
                        : 'border-slate-200 bg-white text-slate-800'
                    }`}
                  >
                    <IconUsers className="h-4 w-4 shrink-0" />
                    {frame.cases.length}
                  </span>
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-slate-400">
                    <span
                      data-testid="frame-summary-subjects-pill"
                      className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100/90 px-2.5 py-1 text-xs sm:text-sm font-semibold text-slate-900"
                    >
                      {t('frameInbox.people', { count: frame.cases.length })}
                    </span>
                    {' · '}
                    <span
                      data-testid="frame-summary-ppe-pill"
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs sm:text-sm font-semibold ${
                        frame.findingCount > 0
                          ? 'border-amber-300 bg-amber-50 text-amber-950'
                          : 'border-slate-200 bg-white text-slate-600 font-medium'
                      }`}
                    >
                      {frame.findingCount > 0 && (
                        <IconHardHat className="h-3.5 w-3.5 shrink-0 text-amber-800" />
                      )}
                      <span>
                        {frame.findingCount > 0
                          ? t('frameInbox.findings', { count: frame.findingCount })
                          : t('frameInbox.noPpeFindings')}
                      </span>
                    </span>
                    {deniedCount > 0 && (
                      <>
                        {' · '}
                        <span
                          data-testid="frame-summary-zone-denied-pill"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs sm:text-sm font-semibold text-rose-950"
                        >
                          <IconAlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-700" />
                          <span>{t('episodes.frameZoneDenials', { count: deniedCount })}</span>
                        </span>
                      </>
                    )}
                    {laterDenials > 0 && (
                      <span className="inline-flex items-center rounded-lg border border-rose-200 bg-rose-50/70 px-2.5 py-1 text-xs font-medium text-rose-900">
                        {t('episodes.laterFrameZoneDenials', { count: laterDenials })}
                      </span>
                    )}
                    {pendingZoneCount > 0 && (
                      <span
                        data-testid="frame-pending-zone-summary"
                        className="inline-flex items-center gap-1 rounded-lg border border-dashed border-amber-400 bg-amber-50/80 px-2.5 py-1 text-xs font-medium text-amber-900"
                      >
                        <IconClock className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                        <span>{t('frameInbox.zonePendingCount', { count: pendingZoneCount })}</span>
                      </span>
                    )}
                    {unavailableZoneCount > 0 && (
                      <span
                        data-testid="frame-unavailable-zone-summary"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100/80 px-2.5 py-1 text-xs font-medium text-slate-700"
                      >
                        <IconAlertTriangle className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                        <span>
                          {tSafety('frameInbox.zoneUnavailableCount', {
                            count: unavailableZoneCount,
                          })}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
                <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 transition-colors group-hover:border-slate-300 group-hover:bg-white group-focus-visible:border-teal-700 group-focus-visible:bg-teal-50 group-focus-visible:text-teal-950">
                  <span>
                    {t(expanded ? 'frameInbox.hideBreakdown' : 'frameInbox.showBreakdown')}
                  </span>
                  <IconChevronDown
                    className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
                  />
                </span>
              </div>
            </button>
            {frame.unread && (
              <div className="mt-2.5 flex items-center justify-end border-t border-slate-100 pt-2.5">
                <button
                  type="button"
                  disabled={read.isPending}
                  onClick={() => read.mutate(frame.cases)}
                  className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl border border-teal-700/40 bg-teal-50/70 px-3 py-1.5 text-xs font-semibold text-teal-950 transition-colors hover:bg-teal-100/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconCheck className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {read.isPending ? t('frameInbox.markingRead') : t('frameInbox.markRead')}
                  </span>
                </button>
              </div>
            )}
            {expanded && (
              <div id={panelId} className="mt-4 space-y-3.5 border-t border-slate-200 pt-4 min-w-0">
                <div
                  data-tour-anchor={
                    frameIndex === firstExpandedIndex ? 'frame-inbox-media-evidence' : undefined
                  }
                >
                  {sharedEvidenceEntry ? (
                    <FramePhoto
                      key={`${key}:${sharedEvidenceEntry.episodeId}:${sharedEvidenceEntry.source?.sha256 ?? ''}`}
                      client={client}
                      token={token}
                      scope={scope}
                      siteId={frame.siteId}
                      frameCameraId={frame.cameraId}
                      frameKey={frame.frameKey}
                      entry={sharedEvidenceEntry}
                    />
                  ) : (
                    <FrameMissingEvidenceNotice />
                  )}
                </div>
                <div className="space-y-2 min-w-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      {t('frameInbox.personBreakdown')}
                    </p>
                    <p data-testid="frame-check-scope-note" className="text-[11px] text-slate-500">
                      {tSafety(FRAME_INBOX_SCOPE_KEY)}
                    </p>
                  </div>
                  <ul className="space-y-2.5">
                    {frame.cases.map((entry, index) => {
                      const cropKey = buildSubjectCropKey(key, entry);
                      return (
                        <FrameInboxSubjectRow
                          key={entry.recipientId}
                          client={client}
                          token={token}
                          scope={scope}
                          siteId={frame.siteId}
                          frameCameraId={frame.cameraId}
                          cameraId={cameraId}
                          frameKey={frame.frameKey}
                          entry={entry}
                          personNumber={index + 1}
                          isTourTarget={frameIndex === firstExpandedIndex && index === 0}
                          personPhotoOpen={Boolean(openPersonCropIds[cropKey])}
                          isAckPending={read.isPending}
                          onMarkCaseRead={() => read.mutate([entry])}
                          onTogglePersonPhoto={() =>
                            setOpenPersonCropIds((prev) => ({
                              ...prev,
                              [cropKey]: !prev[cropKey],
                            }))
                          }
                        />
                      );
                    })}
                  </ul>
                </div>
                <details
                  data-testid="frame-technical-details"
                  className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-xs text-slate-600"
                >
                  <summary className="cursor-pointer font-medium text-slate-700 hover:text-slate-950 select-none">
                    {tSafety('frameInbox.technicalSummary')}
                  </summary>
                  <div className="mt-1.5 font-mono text-[11px] text-slate-600 break-all">
                    {tSafety('frameInbox.frameKeyLabel')} {frame.frameKey}
                  </div>
                </details>
              </div>
            )}
          </article>
        );
      })}
    </>
  );
}
