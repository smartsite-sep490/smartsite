import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@smartsite/api-client';
import { IconAlertTriangle, IconMaximize } from './components/icons';
import { PpeDialog } from './components/ppe/PpeDialog';
import { Button } from './components/ui';
import { useManagementClient } from './features/auth/auth-session';
import './frame-inbox-catalog';
import { SAFETY_NAMESPACE } from './i18n/runtime';

export type FrameCase = Awaited<
  ReturnType<ReturnType<typeof useManagementClient>['listSafetyFrameInbox']>
>['items'][number]['cases'][number];

function useBlobObjectUrl(blob: Blob | undefined) {
  const [url, setUrl] = useState<{ blob: Blob; value: string }>();
  useEffect(() => {
    if (!blob) return;
    let active = true;
    const value = URL.createObjectURL(blob);
    queueMicrotask(() => {
      if (active) setUrl({ blob, value });
    });
    return () => {
      active = false;
      URL.revokeObjectURL(value);
    };
  }, [blob]);
  return blob && url?.blob === blob ? url.value : undefined;
}

function isMediaForbidden(error: unknown): boolean {
  return error instanceof ApiError && [401, 403].includes(error.status ?? 0);
}

export function FrameMissingEvidenceNotice() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      data-testid="frame-evidence-missing"
      className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50/90 p-3.5 text-sm text-amber-950"
    >
      <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
      <span>{t('frameInbox.frameEvidenceMissing')}</span>
    </div>
  );
}

export function FramePhoto({
  client,
  token,
  scope,
  siteId,
  frameCameraId,
  frameKey,
  entry,
}: {
  client: ReturnType<typeof useManagementClient>;
  token: string;
  scope: string;
  siteId: string;
  frameCameraId: string;
  frameKey: string;
  entry: FrameCase;
}) {
  const { t } = useTranslation();
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);
  const [originalOpen, setOriginalOpen] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string>();
  const photo = useQuery({
    queryKey: [
      'frame-photo',
      scope,
      siteId,
      frameCameraId,
      frameKey,
      entry.episodeId,
      entry.source,
    ],
    queryFn: async ({ signal }) => {
      if (!entry.source) throw new Error('Missing source');
      const { sha256, ...source } = entry.source;
      const response = await client.readTrackedEpisodeMedia(
        token,
        siteId,
        entry.episodeId,
        source,
        'FRAME',
        sha256,
        { signal },
      );
      if (response?.representation && response.representation !== 'FRAME') {
        throw new Error('Mismatched media representation');
      }
      return response;
    },
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const activeBlob = photo.isError ? undefined : photo.data?.blob;
  const objectUrl = useBlobObjectUrl(activeBlob);
  const decodeFailed = Boolean(objectUrl && failedUrl === objectUrl);
  const unavailableKey = isMediaForbidden(photo.error)
    ? 'frameInbox.photoForbidden'
    : 'frameInbox.photoUnavailable';

  return (
    <figure className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
      {photo.isPending ? (
        <div
          role="status"
          className="flex aspect-video w-full items-center justify-center rounded-lg bg-slate-100 p-4 text-sm text-slate-600"
        >
          {t('frameInbox.photoLoading')}
        </div>
      ) : photo.isError || decodeFailed ? (
        <div
          role="status"
          data-testid="frame-photo-unavailable"
          className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
        >
          <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <span>{t(unavailableKey)}</span>
        </div>
      ) : objectUrl ? (
        <div className="overflow-hidden rounded-lg bg-slate-950">
          <img
            src={objectUrl}
            alt={t('frameInbox.photoAlt')}
            onError={() => setFailedUrl(objectUrl)}
            className="aspect-video max-h-72 w-full object-contain"
          />
        </div>
      ) : null}
      <figcaption className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            data-testid="frame-whole-frame-badge"
            className="inline-flex items-center rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800"
          >
            {tSafety('frameInbox.wholeFrameBadge')}
          </span>
          <span className="leading-snug">{t('frameInbox.photoCaption')}</span>
        </div>
        {objectUrl && !photo.isError && !decodeFailed && (
          <button
            type="button"
            data-testid="open-original-frame-jpeg"
            onClick={() => setOriginalOpen(true)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs sm:text-sm font-semibold text-slate-900 shadow-2xs transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700/30"
          >
            <IconMaximize className="h-3.5 w-3.5 shrink-0" />
            <span>{t('frameInbox.openOriginalJpeg')}</span>
          </button>
        )}
      </figcaption>
      {objectUrl && !photo.isError && !decodeFailed && (
        <PpeDialog
          open={originalOpen}
          onClose={() => setOriginalOpen(false)}
          wide
          title={t('frameInbox.originalJpegTitle')}
          description={t('frameInbox.photoCaption')}
        >
          <div className="space-y-4">
            <img
              data-testid="original-frame-jpeg-modal-img"
              src={objectUrl}
              alt={t('frameInbox.photoAlt')}
              className="max-h-[72dvh] w-full rounded-xl bg-slate-950 object-contain"
            />
            <div className="flex justify-end">
              <Button variant="outline" size="lg" onClick={() => setOriginalOpen(false)}>
                {t('frameInbox.closeOriginalJpeg')}
              </Button>
            </div>
          </div>
        </PpeDialog>
      )}
    </figure>
  );
}

export function PersonPhoto({
  client,
  token,
  scope,
  siteId,
  frameCameraId,
  frameKey,
  entry,
  personNumber,
}: {
  client: ReturnType<typeof useManagementClient>;
  token: string;
  scope: string;
  siteId: string;
  frameCameraId: string;
  frameKey: string;
  entry: FrameCase;
  personNumber: number;
}) {
  const { t } = useTranslation();
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);
  const [failedUrl, setFailedUrl] = useState<string>();
  const photo = useQuery({
    queryKey: [
      'frame-person-photo',
      scope,
      siteId,
      frameCameraId,
      frameKey,
      entry.recipientId,
      entry.episodeId,
      entry.source,
    ],
    queryFn: async ({ signal }) => {
      if (!entry.source) throw new Error('Missing source');
      const { sha256, ...source } = entry.source;
      const response = await client.readTrackedEpisodeMedia(
        token,
        siteId,
        entry.episodeId,
        source,
        'SUBJECT',
        sha256,
        { signal },
      );
      if (response?.representation && response.representation !== 'SUBJECT') {
        throw new Error('Mismatched media representation');
      }
      return response;
    },
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const activeBlob = photo.isError ? undefined : photo.data?.blob;
  const objectUrl = useBlobObjectUrl(activeBlob);
  const decodeFailed = Boolean(objectUrl && failedUrl === objectUrl);
  const unavailableKey = isMediaForbidden(photo.error)
    ? 'frameInbox.photoForbidden'
    : 'frameInbox.photoUnavailable';

  return (
    <figure className="mt-3 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/90 p-3 sm:flex-row sm:items-center">
      {photo.isPending ? (
        <p role="status" className="text-xs text-slate-600">
          {t('frameInbox.photoLoading')}
        </p>
      ) : photo.isError || decodeFailed ? (
        <div
          role="status"
          data-testid={`person-photo-unavailable-${personNumber}`}
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950"
        >
          <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
          <span>{t(unavailableKey)}</span>
        </div>
      ) : objectUrl ? (
        <div className="overflow-hidden rounded-lg bg-slate-950 p-1 sm:w-36 sm:shrink-0">
          <img
            src={objectUrl}
            alt={t('frameInbox.personPhotoAlt', { number: personNumber })}
            onError={() => setFailedUrl(objectUrl)}
            className="max-h-40 w-full rounded object-contain"
          />
        </div>
      ) : null}
      <figcaption className="min-w-0 space-y-1 text-xs text-slate-600">
        <span
          data-testid={`subject-person-crop-badge-${personNumber}`}
          className="inline-flex items-center rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-950"
        >
          {tSafety('frameInbox.personCropBadge', { number: personNumber })}
        </span>
        <p className="leading-relaxed">{t('frameInbox.personPhotoCaption')}</p>
      </figcaption>
    </figure>
  );
}
