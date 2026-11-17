import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@smartsite/api-client';
import { IconAlertTriangle, IconMaximize } from './components/icons';
import { PpeDialog } from './components/ppe/PpeDialog';
import { Button } from './components/ui';
import { useManagementClient } from './features/auth/auth-session';

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
      className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50/90 p-3 text-xs sm:text-sm text-amber-950"
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
  entry,
}: {
  client: ReturnType<typeof useManagementClient>;
  token: string;
  scope: string;
  siteId: string;
  entry: FrameCase;
}) {
  const { t } = useTranslation();
  const [originalOpen, setOriginalOpen] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string>();
  const photo = useQuery({
    queryKey: ['frame-photo', scope, siteId, entry.episodeId, entry.source],
    queryFn: ({ signal }) => {
      if (!entry.source) throw new Error('Missing source');
      const { sha256, ...source } = entry.source;
      return client.readTrackedEpisodeMedia(
        token,
        siteId,
        entry.episodeId,
        source,
        'FRAME',
        sha256,
        { signal },
      );
    },
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const objectUrl = useBlobObjectUrl(photo.data?.blob);
  const decodeFailed = Boolean(objectUrl && failedUrl === objectUrl);
  const unavailableKey = isMediaForbidden(photo.error)
    ? 'frameInbox.photoForbidden'
    : 'frameInbox.photoUnavailable';

  return (
    <figure className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      {photo.isPending ? (
        <p role="status" className="text-xs text-slate-600">
          {t('frameInbox.photoLoading')}
        </p>
      ) : photo.isError || decodeFailed ? (
        <div
          role="status"
          data-testid="frame-photo-unavailable"
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950"
        >
          <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <span>{t(unavailableKey)}</span>
        </div>
      ) : objectUrl ? (
        <img
          src={objectUrl}
          alt={t('frameInbox.photoAlt')}
          onError={() => setFailedUrl(objectUrl)}
          className="max-h-80 w-full rounded-lg bg-slate-900/5 object-contain"
        />
      ) : null}
      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span>{t('frameInbox.photoCaption')}</span>
        {objectUrl && !photo.isError && !decodeFailed && (
          <button
            type="button"
            data-testid="open-original-frame-jpeg"
            onClick={() => setOriginalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 shadow-2xs transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700/30"
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
              className="max-h-[72dvh] w-full rounded-xl bg-slate-950/5 object-contain"
            />
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setOriginalOpen(false)}>
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
  entry,
  personNumber,
}: {
  client: ReturnType<typeof useManagementClient>;
  token: string;
  scope: string;
  siteId: string;
  entry: FrameCase;
  personNumber: number;
}) {
  const { t } = useTranslation();
  const [failedUrl, setFailedUrl] = useState<string>();
  const photo = useQuery({
    queryKey: ['frame-person-photo', scope, siteId, entry.episodeId, entry.source],
    queryFn: ({ signal }) => {
      if (!entry.source) throw new Error('Missing source');
      const { sha256, ...source } = entry.source;
      return client.readTrackedEpisodeMedia(
        token,
        siteId,
        entry.episodeId,
        source,
        'SUBJECT',
        sha256,
        { signal },
      );
    },
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const objectUrl = useBlobObjectUrl(photo.data?.blob);
  const decodeFailed = Boolean(objectUrl && failedUrl === objectUrl);
  const unavailableKey = isMediaForbidden(photo.error)
    ? 'frameInbox.photoForbidden'
    : 'frameInbox.photoUnavailable';

  return (
    <figure className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      {photo.isPending ? (
        <p role="status" className="text-xs text-slate-600">
          {t('frameInbox.photoLoading')}
        </p>
      ) : photo.isError || decodeFailed ? (
        <div
          role="status"
          data-testid={`person-photo-unavailable-${personNumber}`}
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950"
        >
          <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
          <span>{t(unavailableKey)}</span>
        </div>
      ) : objectUrl ? (
        <img
          src={objectUrl}
          alt={t('frameInbox.personPhotoAlt', { number: personNumber })}
          onError={() => setFailedUrl(objectUrl)}
          className="max-h-56 w-full sm:w-auto rounded-md bg-slate-900/5 object-contain"
        />
      ) : null}
      <figcaption className="mt-1.5 text-xs text-slate-600">
        {t('frameInbox.personPhotoCaption')}
      </figcaption>
    </figure>
  );
}
