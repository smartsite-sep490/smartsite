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
import { isSafetyIdentificationRouteEnabled } from './components/safety-episodes/safetyUrlParams';
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
  const [selectedFrameKeys, setSelectedFrameKeys] = useState<Record<string, boolean>>({});
  const c02Enabled = isSafetyIdentificationRouteEnabled();

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
      if (isMountedRef.current) setSelectedFrameKeys({});
    },
  });

  const unreadFramesWithKeys = frames
    .map((frame) => ({
      frame,
      key: JSON.stringify([frame.siteId, frame.cameraId, frame.frameKey]),
    }))
    .filter(({ frame }) => frame.unread);
  const selectedUnreadFrames = unreadFramesWithKeys.filter(({ key }) => selectedFrameKeys[key]);
  const allPageUnreadSelected =
    unreadFramesWithKeys.length > 0 && selectedUnreadFrames.length === unreadFramesWithKeys.length;
  const batchTargetFrames =
    selectedUnreadFrames.length > 0 ? selectedUnreadFrames : unreadFramesWithKeys;
  const batchTargetCases = batchTargetFrames.flatMap(({ frame }) =>
    frame.cases.filter((entry) => entry.unread),
  );

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
      {unreadFramesWithKeys.length > 1 && (
        <div
          data-testid="frame-inbox-batch-bar"
          className="flex flex-col gap-2 rounded-xl border border-slate-200/90 bg-slate-50/90 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm">
            <label className="inline-flex cursor-pointer select-none items-center gap-2 font-semibold text-slate-800">
              <input
                type="checkbox"
                checked={allPageUnreadSelected}
                disabled={read.isPending}
                className="h-4 w-4 rounded border-slate-400 accent-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
                onChange={(event) => {
                  if (event.target.checked) {
                    const next: Record<string, boolean> = {};
                    for (const item of unreadFramesWithKeys) next[item.key] = true;
                    setSelectedFrameKeys(next);
                  } else {
                    setSelectedFrameKeys({});
                  }
                }}
              />
              <span>
                {tSafety('frameInbox.selectAllUnreadPage', { count: unreadFramesWithKeys.length })}
              </span>
            </label>
            {selectedUnreadFrames.length > 0 ? (
              <div className="inline-flex items-center gap-2">
                <span className="rounded-md bg-teal-100/80 px-2 py-0.5 text-xs font-semibold text-teal-950 tabular-nums">
                  {tSafety('frameInbox.selectedFramesCount', {
                    count: selectedUnreadFrames.length,
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedFrameKeys({})}
                  className="text-xs font-semibold text-slate-600 underline decoration-slate-400 underline-offset-2 hover:text-slate-950"
                >
                  {tSafety('frameInbox.clearFrameSelection')}
                </button>
              </div>
            ) : (
              <span className="hidden 2xl:inline text-xs text-slate-500">
                {tSafety('frameInbox.batchAckScopeHint')}
              </span>
            )}
          </div>
          <button
            type="button"
            data-testid="frame-inbox-mark-visible-read"
            disabled={read.isPending || batchTargetCases.length === 0}
            onClick={() => read.mutate(batchTargetCases)}
            className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-teal-700/45 bg-white px-3.5 py-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap text-teal-950 shadow-2xs transition-colors hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IconCheck className="h-3.5 w-3.5 shrink-0 text-teal-800" />
            <span>
              {read.isPending
                ? t('frameInbox.markingRead')
                : selectedUnreadFrames.length > 0
                  ? tSafety('frameInbox.markSelectedRead', { count: selectedUnreadFrames.length })
                  : tSafety('frameInbox.markVisiblePageRead', {
                      count: unreadFramesWithKeys.length,
                    })}
            </span>
          </button>
        </div>
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
        const updatedCaseCount = frame.cases.filter(
          (entry) => entry.unread && entry.contentRevision > 1,
        ).length;
        const hasZoneQualifiers =
          laterDenials > 0 || pendingZoneCount > 0 || unavailableZoneCount > 0;
        const sharedEvidenceEntry = frame.cases.find((entry) => entry.source);
        const displayTimestamp = new Date(frame.capturedAt).toLocaleString(uiLocale());
        const summaryAriaLabel = [
          frame.cameraName,
          frame.siteName,
          displayTimestamp,
          t(frame.unread ? 'episodes.unread' : 'episodes.read'),
          ...(updatedCaseCount > 0
            ? [tSafety('frameInbox.updatedCasesPill', { count: updatedCaseCount })]
            : []),
          t('frameInbox.people', { count: frame.cases.length }),
          frame.findingCount > 0
            ? t('frameInbox.findings', { count: frame.findingCount })
            : t('frameInbox.noPpeFindings'),
          ...(deniedCount > 0 ? [t('episodes.frameZoneDenials', { count: deniedCount })] : []),
          ...(laterDenials > 0
            ? [t('episodes.laterFrameZoneDenials', { count: laterDenials })]
            : []),
          ...(pendingZoneCount > 0
            ? [t('frameInbox.zonePendingCount', { count: pendingZoneCount })]
            : []),
          ...(unavailableZoneCount > 0
            ? [tSafety('frameInbox.zoneUnavailableCount', { count: unavailableZoneCount })]
            : []),
          t(expanded ? 'frameInbox.hideBreakdown' : 'frameInbox.showBreakdown'),
        ].join(' · ');

        return (
          <article
            key={key}
            className={`min-w-0 overflow-hidden rounded-2xl border transition-colors ${
              selectedFrameKeys[key] && frame.unread
                ? 'border-teal-700/70 border-l-4 border-l-teal-700 bg-teal-50/25 shadow-2xs'
                : frame.unread
                  ? 'border-slate-300 border-l-4 border-l-teal-700 bg-white shadow-2xs'
                  : 'border-slate-200 bg-white/90 hover:bg-white'
            }`}
          >
            <div className="flex flex-col gap-2.5 px-4 py-2.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-1 min-w-0 items-start gap-3 lg:items-center">
                {frame.unread && unreadFramesWithKeys.length > 1 && (
                  <input
                    type="checkbox"
                    checked={Boolean(selectedFrameKeys[key])}
                    disabled={read.isPending}
                    aria-label={tSafety('frameInbox.selectFrameAria', {
                      camera: frame.cameraName,
                      time: displayTimestamp,
                    })}
                    className="mt-1 lg:mt-0 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-400 accent-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
                    onChange={(event) =>
                      setSelectedFrameKeys((prev) => ({
                        ...prev,
                        [key]: event.target.checked,
                      }))
                    }
                  />
                )}
                <button
                  type="button"
                  aria-label={summaryAriaLabel}
                  data-testid="frame-triage-columns"
                  data-tour-anchor={
                    frameIndex === tourCardIndex ? 'frame-inbox-card-summary' : undefined
                  }
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => setOpen(expanded ? '' : key)}
                  className="group flex flex-1 min-w-0 flex-col gap-2 rounded-xl p-1 -m-1 text-left transition-colors hover:bg-slate-50/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 focus-visible:ring-4 focus-visible:ring-teal-700/20 xl:grid xl:grid-cols-[minmax(150px,1fr)_minmax(140px,auto)_minmax(170px,1.2fr)_auto] xl:items-center xl:gap-3 2xl:grid-cols-[minmax(220px,1.15fr)_minmax(195px,0.85fr)_minmax(260px,1.35fr)_auto] 2xl:gap-4"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div
                      title={frame.cameraName}
                      className="flex min-w-0 items-center gap-1.5 text-sm sm:text-[15px] font-semibold text-slate-950"
                    >
                      <IconCamera className="h-4 w-4 shrink-0 text-slate-500" />
                      <span className="truncate">{frame.cameraName}</span>
                    </div>
                    <div
                      title={frame.siteName}
                      className="flex min-w-0 items-center gap-1.5 text-xs sm:text-[13px] font-medium text-slate-600"
                    >
                      <IconBuilding className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="truncate">{frame.siteName}</span>
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-wrap items-center gap-1.5 xl:flex-col xl:items-start 2xl:flex-row 2xl:items-center 2xl:gap-2 text-xs sm:text-[13px] tabular-nums text-slate-700">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <IconClock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <time dateTime={frame.capturedAt}>{displayTimestamp}</time>
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${
                        frame.unread
                          ? 'border-teal-700/35 bg-teal-50 text-teal-950'
                          : 'border-slate-200 bg-slate-100 text-slate-600'
                      }`}
                    >
                      {frame.unread && (
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-teal-700" />
                      )}
                      {t(frame.unread ? 'episodes.unread' : 'episodes.read')}
                    </span>
                  </div>

                  <div className="min-w-0 space-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm tabular-nums">
                      {updatedCaseCount > 0 && (
                        <span
                          data-testid="frame-updated-cases-pill"
                          className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs sm:text-sm font-semibold text-indigo-950"
                        >
                          {tSafety('frameInbox.updatedCasesPill', { count: updatedCaseCount })}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs sm:text-sm font-semibold text-slate-900">
                        <IconUsers className="h-4 w-4 shrink-0 text-slate-500" />
                        <span data-testid="frame-summary-subjects-pill">
                          {t('frameInbox.people', { count: frame.cases.length })}
                        </span>
                      </span>
                      <span
                        data-testid="frame-summary-ppe-pill"
                        className={`inline-flex items-center gap-1.5 ${
                          frame.findingCount > 0
                            ? 'rounded-md border border-amber-300/90 bg-amber-50/90 px-2.5 py-0.5 text-xs sm:text-sm font-semibold text-amber-950'
                            : 'rounded-md border border-slate-200 bg-white px-2.5 py-0.5 text-xs sm:text-sm font-medium text-slate-600'
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
                        <span
                          data-testid="frame-summary-zone-denied-pill"
                          className="inline-flex items-center gap-1.5 rounded-md border border-rose-300/90 bg-rose-50/90 px-2.5 py-0.5 text-xs sm:text-sm font-semibold text-rose-950"
                        >
                          <IconAlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-700" />
                          <span>{t('episodes.frameZoneDenials', { count: deniedCount })}</span>
                        </span>
                      )}
                    </div>

                    {hasZoneQualifiers && (
                      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-slate-600">
                        {laterDenials > 0 && (
                          <span className="font-medium text-rose-900">
                            {t('episodes.laterFrameZoneDenials', { count: laterDenials })}
                          </span>
                        )}
                        {pendingZoneCount > 0 && (
                          <span
                            data-testid="frame-pending-zone-summary"
                            className="inline-flex items-center gap-1 rounded border border-dashed border-amber-400/90 bg-amber-50/75 px-2 py-0.5 font-medium text-amber-950"
                          >
                            <IconClock className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                            <span>
                              {t('frameInbox.zonePendingCount', { count: pendingZoneCount })}
                            </span>
                          </span>
                        )}
                        {unavailableZoneCount > 0 && (
                          <span
                            data-testid="frame-unavailable-zone-summary"
                            className="inline-flex items-center gap-1 font-medium text-slate-600"
                          >
                            <IconAlertTriangle className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span>
                              {tSafety('frameInbox.zoneUnavailableCount', {
                                count: unavailableZoneCount,
                              })}
                            </span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <span className="inline-flex min-h-9 w-fit shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap text-slate-800 transition-colors group-hover:border-slate-300 group-hover:bg-white group-focus-visible:border-teal-700 group-focus-visible:bg-teal-50 group-focus-visible:text-teal-950">
                    <span>
                      {t(expanded ? 'frameInbox.hideBreakdown' : 'frameInbox.showBreakdown')}
                    </span>
                    <IconChevronDown
                      className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
                    />
                  </span>
                </button>
              </div>

              {frame.unread && (
                <button
                  type="button"
                  disabled={read.isPending}
                  onClick={() => read.mutate(frame.cases)}
                  className="inline-flex min-h-9 w-full sm:w-auto lg:shrink-0 items-center justify-center gap-1.5 rounded-xl border border-teal-700/40 bg-teal-50/70 px-3 py-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap text-teal-950 transition-colors hover:bg-teal-100/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconCheck className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {read.isPending ? t('frameInbox.markingRead') : t('frameInbox.markRead')}
                  </span>
                </button>
              )}
            </div>

            {expanded && (
              <div
                id={panelId}
                data-testid="frame-expanded-workspace"
                className="min-w-0 border-t border-slate-200 bg-slate-50/55 p-4 sm:p-5 space-y-4"
              >
                <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
                  <div className="min-w-0 space-y-3 lg:col-span-5 lg:sticky lg:top-4">
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

                    <details
                      data-testid="frame-technical-details"
                      className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-600"
                    >
                      <summary className="min-h-6 cursor-pointer font-medium text-slate-700 hover:text-slate-950 select-none">
                        {tSafety('frameInbox.technicalSummary')}
                      </summary>
                      <div className="mt-1.5 font-mono text-xs text-slate-600 break-all">
                        {tSafety('frameInbox.frameKeyLabel')} {frame.frameKey}
                      </div>
                    </details>
                  </div>

                  <div className="min-w-0 space-y-3 lg:col-span-7">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h2 className="text-sm sm:text-base font-semibold text-slate-950">
                          {t('frameInbox.personBreakdown')}
                        </h2>
                        <details className="text-xs text-slate-600">
                          <summary className="cursor-pointer select-none font-medium text-teal-900 underline decoration-teal-700/50 underline-offset-2 hover:text-teal-950">
                            {t('episodes.technical')}
                          </summary>
                          <p
                            data-testid="frame-check-scope-note"
                            className="mt-1.5 rounded-lg border border-slate-200 bg-white p-2.5 text-xs leading-relaxed text-slate-600"
                          >
                            {tSafety(FRAME_INBOX_SCOPE_KEY)}
                          </p>
                        </details>
                      </div>
                      <p className="text-xs leading-relaxed text-slate-600">
                        {tSafety(
                          c02Enabled
                            ? 'frameInbox.caseIdentificationHint'
                            : 'frameInbox.caseReviewHint',
                        )}
                      </p>
                    </div>

                    <ul className="space-y-3">
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
                </div>
              </div>
            )}
          </article>
        );
      })}
    </>
  );
}
