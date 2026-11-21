import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SafetyFrameInboxPage } from '@smartsite/api-client';
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconHardHat,
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

  const hasMultiUnread = unreadFramesWithKeys.length > 1;
  const hasSelection = selectedUnreadFrames.length > 0;
  const rowOuterGridClass = hasMultiUnread
    ? 'grid grid-cols-1 lg:grid-cols-[20px_minmax(0,1fr)_36px] lg:items-center gap-2.5 lg:gap-3'
    : 'grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_36px] lg:items-center gap-2.5 lg:gap-3';
  const rowColumnsGridClass =
    'grid w-full min-w-0 grid-cols-1 gap-2 lg:grid-cols-[132px_minmax(175px,1.15fr)_122px_minmax(220px,1.55fr)_104px] lg:items-center lg:gap-4';

  return (
    <>
      {read.isError && (
        <div className="p-4 border-b border-slate-200">
          <p
            role="alert"
            className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-950"
          >
            {t('frameInbox.readError')}
          </p>
        </div>
      )}
      {frames.length > 0 && (
        <div className="divide-y divide-slate-200/80">
          {hasMultiUnread && hasSelection ? (
            <div
              data-testid="frame-inbox-batch-bar"
              className="flex flex-wrap items-center justify-between gap-3 bg-[#0F172A] px-4 py-2.5 text-white sm:px-5"
            >
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="inline-flex cursor-pointer select-none items-center gap-2.5 font-medium">
                  <input
                    type="checkbox"
                    checked={allPageUnreadSelected}
                    disabled={read.isPending}
                    aria-label={tSafety('frameInbox.selectAllUnreadPage', {
                      count: unreadFramesWithKeys.length,
                    })}
                    className="h-4 w-4 rounded border-slate-400 accent-teal-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
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
                  <span className="tabular-nums">
                    {tSafety('frameInbox.selectedFramesCount', {
                      count: selectedUnreadFrames.length,
                    })}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => setSelectedFrameKeys({})}
                  className="text-xs font-medium text-slate-300 underline decoration-slate-500 underline-offset-2 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  {tSafety('frameInbox.clearFrameSelection')}
                </button>
              </div>
              <button
                type="button"
                data-testid="frame-inbox-mark-visible-read"
                disabled={read.isPending || batchTargetCases.length === 0}
                onClick={() => read.mutate(batchTargetCases)}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white px-3.5 text-sm font-semibold whitespace-nowrap text-slate-950 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IconCheck className="h-4 w-4 shrink-0 text-teal-700" />
                <span>
                  {read.isPending
                    ? t('frameInbox.markingRead')
                    : tSafety('frameInbox.markSelectedRead', {
                        count: selectedUnreadFrames.length,
                      })}
                </span>
              </button>
            </div>
          ) : (
            <div
              data-testid={hasMultiUnread ? 'frame-inbox-batch-bar' : undefined}
              className="bg-slate-50/90 px-4 py-2.5 sm:px-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 lg:hidden">
                {hasMultiUnread && (
                  <>
                    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-sm font-medium text-slate-700">
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
                        {tSafety('frameInbox.selectAllUnreadPage', {
                          count: unreadFramesWithKeys.length,
                        })}
                      </span>
                    </label>
                    <button
                      type="button"
                      disabled={read.isPending || batchTargetCases.length === 0}
                      onClick={() => read.mutate(batchTargetCases)}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-200/70 hover:text-slate-950 disabled:opacity-50"
                    >
                      <IconCheck className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        {read.isPending
                          ? t('frameInbox.markingRead')
                          : tSafety('frameInbox.markPageReadShort')}
                      </span>
                    </button>
                  </>
                )}
              </div>

              <div
                className={`hidden lg:grid ${rowOuterGridClass} border-l-[3px] border-l-transparent`}
              >
                {hasMultiUnread && (
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={allPageUnreadSelected}
                      disabled={read.isPending}
                      aria-label={tSafety('frameInbox.selectAllUnreadPage', {
                        count: unreadFramesWithKeys.length,
                      })}
                      title={tSafety('frameInbox.selectAllUnreadPage', {
                        count: unreadFramesWithKeys.length,
                      })}
                      className="h-4 w-4 cursor-pointer rounded border-slate-400 accent-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
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
                  </div>
                )}
                <div
                  className={`${rowColumnsGridClass} text-xs font-semibold text-slate-600`}
                  aria-hidden="true"
                >
                  <span>{tSafety('frameInbox.colTime')}</span>
                  <span>{tSafety('frameInbox.colLocation')}</span>
                  <span>{tSafety('frameInbox.colPeople')}</span>
                  <span>{tSafety('frameInbox.colObservations')}</span>
                  <span className="text-right">{tSafety('frameInbox.colActions')}</span>
                </div>
                <div className="flex items-center justify-end">
                  {hasMultiUnread && (
                    <button
                      type="button"
                      data-testid="frame-inbox-mark-visible-read"
                      disabled={read.isPending || batchTargetCases.length === 0}
                      title={tSafety('frameInbox.markVisiblePageRead', {
                        count: unreadFramesWithKeys.length,
                      })}
                      aria-label={tSafety('frameInbox.markVisiblePageRead', {
                        count: unreadFramesWithKeys.length,
                      })}
                      onClick={() => read.mutate(batchTargetCases)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200/80 hover:text-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <IconCheck className="h-4 w-4 shrink-0" />
                    </button>
                  )}
                </div>
              </div>
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
            const hasSecondarySignals =
              updatedCaseCount > 0 ||
              laterDenials > 0 ||
              pendingZoneCount > 0 ||
              unavailableZoneCount > 0;
            const sharedEvidenceEntry = frame.cases.find((entry) => entry.source);
            const capturedDate = new Date(frame.capturedAt);
            const displayTime = capturedDate.toLocaleTimeString(uiLocale(), {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            });
            const displayDate = capturedDate.toLocaleDateString(uiLocale());
            const displayTimestamp = capturedDate.toLocaleString(uiLocale());
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
                className={`min-w-0 border-l-[3px] transition-colors ${
                  selectedFrameKeys[key] && frame.unread
                    ? 'border-l-teal-700 bg-teal-50/40'
                    : expanded
                      ? 'border-l-slate-900 bg-slate-50/40'
                      : frame.unread
                        ? 'border-l-teal-700 bg-white hover:bg-slate-50/70'
                        : 'border-l-transparent bg-white hover:bg-slate-50/70'
                }`}
              >
                <div className={`${rowOuterGridClass} px-4 py-3.5 sm:px-5`}>
                  {hasMultiUnread && (
                    <div className="flex items-center">
                      {frame.unread ? (
                        <input
                          type="checkbox"
                          checked={Boolean(selectedFrameKeys[key])}
                          disabled={read.isPending}
                          aria-label={tSafety('frameInbox.selectFrameAria', {
                            camera: frame.cameraName,
                            time: displayTimestamp,
                          })}
                          className="h-4 w-4 shrink-0 cursor-pointer rounded border-slate-400 accent-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
                          onChange={(event) =>
                            setSelectedFrameKeys((prev) => ({
                              ...prev,
                              [key]: event.target.checked,
                            }))
                          }
                        />
                      ) : (
                        <span aria-hidden="true" className="hidden lg:block h-4 w-4 shrink-0" />
                      )}
                    </div>
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
                    className={`group ${rowColumnsGridClass} rounded-lg py-0.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800`}
                  >
                    {/* Col 1: Time & Read State */}
                    <div className="min-w-0 space-y-0.5 tabular-nums">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            frame.unread ? 'bg-teal-700' : 'bg-slate-300'
                          }`}
                        />
                        <time
                          dateTime={frame.capturedAt}
                          className={`text-sm ${
                            frame.unread
                              ? 'font-semibold text-slate-950'
                              : 'font-medium text-slate-700'
                          }`}
                        >
                          {displayTime}
                        </time>
                        <span className="sr-only">
                          {t(frame.unread ? 'episodes.unread' : 'episodes.read')}
                        </span>
                      </div>
                      <div className="pl-4 text-xs text-slate-500">{displayDate}</div>
                    </div>

                    {/* Col 2: Location (Camera + Site) */}
                    <div className="min-w-0 space-y-0.5">
                      <div
                        title={frame.cameraName}
                        className={`text-sm leading-snug break-words ${
                          frame.unread
                            ? 'font-semibold text-slate-950'
                            : 'font-medium text-slate-800'
                        }`}
                      >
                        {frame.cameraName}
                      </div>
                      <div
                        title={frame.siteName}
                        className="text-xs leading-snug text-slate-600 break-words"
                      >
                        {frame.siteName}
                      </div>
                    </div>

                    {/* Col 3: Distinct Flagged People */}
                    <div className="min-w-0 tabular-nums">
                      <span
                        data-testid="frame-summary-subjects-pill"
                        className={`block text-sm leading-snug ${
                          frame.unread
                            ? 'font-semibold text-slate-950'
                            : 'font-medium text-slate-700'
                        }`}
                      >
                        {t('frameInbox.people', { count: frame.cases.length })}
                      </span>
                    </div>

                    {/* Col 4: Observations Needing Attention */}
                    <div className="min-w-0 space-y-1 tabular-nums">
                      <div className="flex flex-col gap-1">
                        {deniedCount > 0 && (
                          <span
                            data-testid="frame-summary-zone-denied-pill"
                            className="inline-flex items-start gap-1.5 text-sm font-semibold leading-snug text-rose-700"
                          >
                            <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                            <span>{t('episodes.frameZoneDenials', { count: deniedCount })}</span>
                          </span>
                        )}
                        <span
                          data-testid="frame-summary-ppe-pill"
                          className={`inline-flex items-start gap-1.5 text-sm leading-snug ${
                            frame.findingCount > 0 ? 'font-medium text-slate-950' : 'text-slate-500'
                          }`}
                        >
                          {frame.findingCount > 0 && (
                            <IconHardHat className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                          )}
                          <span>
                            {frame.findingCount > 0
                              ? t('frameInbox.findings', { count: frame.findingCount })
                              : t('frameInbox.noPpeFindings')}
                          </span>
                        </span>
                      </div>

                      {hasSecondarySignals && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
                          {updatedCaseCount > 0 && (
                            <span
                              data-testid="frame-updated-cases-pill"
                              className="inline-flex items-center gap-1 font-medium text-teal-800"
                            >
                              <span
                                aria-hidden="true"
                                className="h-1.5 w-1.5 rounded-full bg-teal-700"
                              />
                              <span>
                                {tSafety('frameInbox.updatedCasesPill', {
                                  count: updatedCaseCount,
                                })}
                              </span>
                            </span>
                          )}
                          {laterDenials > 0 && (
                            <span className="font-medium text-rose-700">
                              {t('episodes.laterFrameZoneDenials', { count: laterDenials })}
                            </span>
                          )}
                          {pendingZoneCount > 0 && (
                            <span
                              data-testid="frame-pending-zone-summary"
                              className="inline-flex items-center gap-1 font-medium text-amber-800"
                            >
                              <IconClock className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                              <span>
                                {t('frameInbox.zonePendingCount', { count: pendingZoneCount })}
                              </span>
                            </span>
                          )}
                          {unavailableZoneCount > 0 && (
                            <span
                              data-testid="frame-unavailable-zone-summary"
                              className="inline-flex items-center gap-1 text-slate-500"
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

                    {/* Col 5: Single Primary Investigation Action */}
                    <div className="flex lg:justify-end">
                      <span
                        className={`inline-flex h-9 w-fit shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium whitespace-nowrap transition-colors ${
                          expanded
                            ? 'border-slate-900 bg-[#0F172A] text-white'
                            : 'border-slate-200 bg-white text-slate-900 group-hover:border-slate-300 group-hover:bg-slate-50'
                        }`}
                      >
                        <span>
                          {tSafety(
                            expanded ? 'frameInbox.collapseAction' : 'frameInbox.inspectAction',
                          )}
                        </span>
                        <IconChevronDown
                          className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
                        />
                      </span>
                    </div>
                  </button>

                  {/* Trailing Quiet Per-Row Mark-Read Utility */}
                  <div className="flex items-center lg:justify-end">
                    {frame.unread ? (
                      <button
                        type="button"
                        disabled={read.isPending || hasSelection}
                        aria-label={
                          read.isPending ? t('frameInbox.markingRead') : t('frameInbox.markRead')
                        }
                        title={
                          read.isPending ? t('frameInbox.markingRead') : t('frameInbox.markRead')
                        }
                        onClick={() => read.mutate(frame.cases)}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <IconCheck className="h-4 w-4 shrink-0" />
                      </button>
                    ) : (
                      <span aria-hidden="true" className="hidden lg:block h-9 w-9 shrink-0" />
                    )}
                  </div>
                </div>

                {expanded && (
                  <div
                    id={panelId}
                    data-testid="frame-expanded-workspace"
                    className="min-w-0 border-t border-slate-200 bg-slate-50/70 px-4 py-4 sm:px-5 sm:py-5 space-y-4"
                  >
                    <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
                      <div className="min-w-0 space-y-3 lg:col-span-5 lg:sticky lg:top-4">
                        <div
                          data-tour-anchor={
                            frameIndex === firstExpandedIndex
                              ? 'frame-inbox-media-evidence'
                              : undefined
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
                          className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-600"
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
                            <h2 className="text-base font-semibold text-slate-950">
                              {t('frameInbox.personBreakdown')}
                            </h2>
                            <details className="text-xs text-slate-600">
                              <summary className="cursor-pointer select-none font-medium text-slate-600 underline decoration-slate-400 underline-offset-2 hover:text-slate-950">
                                {t('episodes.technical')}
                              </summary>
                              <p
                                data-testid="frame-check-scope-note"
                                className="mt-1.5 rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600"
                              >
                                {tSafety(FRAME_INBOX_SCOPE_KEY)}
                              </p>
                            </details>
                          </div>
                          <p className="text-xs sm:text-[13px] leading-relaxed text-slate-600">
                            {tSafety(
                              c02Enabled
                                ? 'frameInbox.caseIdentificationHint'
                                : 'frameInbox.caseReviewHint',
                            )}
                          </p>
                        </div>

                        <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-200/80">
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
        </div>
      )}
    </>
  );
}
