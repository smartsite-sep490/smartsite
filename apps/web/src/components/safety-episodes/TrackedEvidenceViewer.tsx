import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useInRouterContext } from 'react-router-dom';
import type { TrackedEpisodeMediaRepresentation } from '@smartsite/contracts/tracked-episode-frames';
import { IconAlertCircle, IconEye, IconLoader, IconRefresh, IconUser } from '../icons';
import { PpeDialog } from '../ppe/PpeDialog';
import { Badge, Button } from '../ui';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import './tracked-evidence-viewer-catalog';

export type TrackedEvidenceViewerStatus = 'LOADING' | 'READY' | 'ERROR' | 'FORBIDDEN';

export interface TrackedEvidenceViewerMedia {
  scopeKey: string;
  selectionKey: string;
  blob: Blob;
}

export interface TrackedEvidenceViewerProps {
  open: boolean;
  scopeKey: string;
  selectionKey: string;
  representation: TrackedEpisodeMediaRepresentation;
  status: TrackedEvidenceViewerStatus;
  media: TrackedEvidenceViewerMedia | null;
  identityContent?: ReactNode;
  returnToFrameHref?: string;
  onClose(): void;
  onRetry(): void;
}

interface AllocatedBlobUrlState {
  scopeKey: string;
  selectionKey: string;
  blob: Blob;
  url: string | null;
  allocationFailed: boolean;
}

interface LoadedImageState {
  scopeKey: string;
  selectionKey: string;
  blob: Blob;
  url: string;
}

const MAX_JPEG_BYTES = 1_048_576;

function getAcceptedJpegBlob(
  open: boolean,
  status: TrackedEvidenceViewerStatus,
  scopeKey: string,
  selectionKey: string,
  media: TrackedEvidenceViewerMedia | null,
): Blob | null {
  if (!open || status !== 'READY' || !media || !scopeKey || !selectionKey) {
    return null;
  }
  if (media.scopeKey !== scopeKey || media.selectionKey !== selectionKey) {
    return null;
  }
  const { blob } = media;
  if (!blob || !(blob instanceof Blob)) {
    return null;
  }
  if (blob.type.trim().toLowerCase() !== 'image/jpeg') {
    return null;
  }
  if (
    typeof blob.size !== 'number' ||
    !Number.isFinite(blob.size) ||
    blob.size <= 0 ||
    blob.size > MAX_JPEG_BYTES
  ) {
    return null;
  }
  return blob;
}

export function TrackedEvidenceViewer(props: TrackedEvidenceViewerProps) {
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);
  if (!props.open) {
    return null;
  }
  const isSubject = props.representation === 'SUBJECT';
  const dialogTitle = tSafety(
    isSubject ? 'trackedViewer.titleSubject' : 'trackedViewer.titleFrame',
  );

  return (
    <PpeDialog open={props.open} onClose={props.onClose} title={dialogTitle} wide={true}>
      <TrackedEvidenceViewerContent key={`${props.scopeKey}::${props.selectionKey}`} {...props} />
    </PpeDialog>
  );
}

function TrackedEvidenceViewerContent({
  open,
  scopeKey,
  selectionKey,
  representation,
  status,
  media,
  identityContent,
  returnToFrameHref,
  onClose,
  onRetry,
}: TrackedEvidenceViewerProps) {
  const { t } = useTranslation();
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);
  const inRouterContext = useInRouterContext();
  const normalizedReturnToFrameHref = returnToFrameHref?.trim() ?? '';
  const [blobUrlState, setBlobUrlState] = useState<AllocatedBlobUrlState | null>(null);
  const [loadedImageState, setLoadedImageState] = useState<LoadedImageState | null>(null);
  const [failedBlobUrl, setFailedBlobUrl] = useState<string | null>(null);
  const [isTechnicalOpen, setIsTechnicalOpen] = useState(false);

  const acceptedBlob = getAcceptedJpegBlob(open, status, scopeKey, selectionKey, media);

  useEffect(() => {
    if (!acceptedBlob) {
      return;
    }
    let active = true;
    let allocatedUrl: string | null = null;
    let allocationFailed = false;

    try {
      if (typeof URL.createObjectURL === 'function') {
        const candidate = URL.createObjectURL(acceptedBlob);
        if (typeof candidate === 'string' && candidate.length > 0) {
          allocatedUrl = candidate;
        } else {
          allocationFailed = true;
        }
      } else {
        allocationFailed = true;
      }
    } catch {
      allocatedUrl = null;
      allocationFailed = true;
    }

    const snapshotUrl = allocatedUrl;
    const snapshotFailed = allocationFailed;
    queueMicrotask(() => {
      if (active) {
        setBlobUrlState({
          scopeKey,
          selectionKey,
          blob: acceptedBlob,
          url: snapshotUrl,
          allocationFailed: snapshotFailed,
        });
      }
    });

    return () => {
      active = false;
      if (snapshotUrl && typeof URL.revokeObjectURL === 'function') {
        try {
          URL.revokeObjectURL(snapshotUrl);
        } catch {
          // Ignore revoke errors
        }
      }
    };
  }, [acceptedBlob, scopeKey, selectionKey]);

  const matchingUrlState =
    acceptedBlob !== null &&
    blobUrlState !== null &&
    blobUrlState.scopeKey === scopeKey &&
    blobUrlState.selectionKey === selectionKey &&
    blobUrlState.blob === acceptedBlob
      ? blobUrlState
      : null;

  const activeObjectUrl = matchingUrlState?.url ?? null;
  const isUrlCreationFailed = matchingUrlState?.allocationFailed === true;
  const isDecodeFailed = activeObjectUrl !== null && failedBlobUrl === activeObjectUrl;
  const isImageLoaded =
    acceptedBlob !== null &&
    activeObjectUrl !== null &&
    !isDecodeFailed &&
    loadedImageState !== null &&
    loadedImageState.scopeKey === scopeKey &&
    loadedImageState.selectionKey === selectionKey &&
    loadedImageState.blob === acceptedBlob &&
    loadedImageState.url === activeObjectUrl;
  const isReadyUnavailable =
    status === 'READY' && (acceptedBlob === null || isUrlCreationFailed || isDecodeFailed);
  const isPreparingReadyUrl =
    status === 'READY' && acceptedBlob !== null && matchingUrlState === null;

  const isSubject = representation === 'SUBJECT';
  const imageAlt = tSafety(isSubject ? 'trackedViewer.altSubject' : 'trackedViewer.altFrame');
  const technicalPanelId = 'tracked-viewer-technical-panel';

  return (
    <div className="space-y-4" data-testid="tracked-viewer-body">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant={isSubject ? 'default' : 'neutral'} data-testid="tracked-viewer-badge">
          {isSubject ? <IconUser className="h-3 w-3" /> : <IconEye className="h-3 w-3" />}
          <span>
            {tSafety(isSubject ? 'trackedViewer.badgeSubject' : 'trackedViewer.badgeFrame')}
          </span>
        </Badge>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={isTechnicalOpen}
          aria-controls={technicalPanelId}
          onClick={() => setIsTechnicalOpen((prev) => !prev)}
        >
          {tSafety(isTechnicalOpen ? 'trackedViewer.hideTechnical' : 'trackedViewer.showTechnical')}
        </Button>
      </div>

      <p data-testid="tracked-viewer-crop-note" className="text-xs font-medium text-slate-700">
        {tSafety('trackedViewer.cropDisclaimer')}
      </p>

      {status === 'LOADING' && (
        <div
          role="status"
          aria-live="polite"
          data-testid="tracked-viewer-loading"
          className="flex min-h-[220px] items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-700"
        >
          <IconLoader className="h-4 w-4 animate-spin text-slate-600" />
          <span>{tSafety('trackedViewer.loading')}</span>
        </div>
      )}

      {isPreparingReadyUrl && (
        <div
          role="status"
          aria-live="polite"
          data-testid="tracked-viewer-preparing"
          className="flex min-h-[220px] items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-700"
        >
          <IconLoader className="h-4 w-4 animate-spin text-slate-600" />
          <span>{tSafety('trackedViewer.preparing')}</span>
        </div>
      )}

      {status === 'FORBIDDEN' && (
        <div
          role="alert"
          data-testid="tracked-viewer-forbidden"
          className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950"
        >
          <IconAlertCircle className="h-4 w-4 shrink-0 text-amber-700" />
          <span>{tSafety('trackedViewer.forbidden')}</span>
        </div>
      )}

      {status === 'ERROR' && (
        <div
          role="alert"
          data-testid="tracked-viewer-error"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-900"
        >
          <div className="flex items-center gap-2">
            <IconAlertCircle className="h-4 w-4 shrink-0 text-rose-700" />
            <span>{tSafety('trackedViewer.error')}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRetry()}
            leftIcon={<IconRefresh className="h-3.5 w-3.5" />}
          >
            {tSafety('trackedViewer.retry')}
          </Button>
        </div>
      )}

      {isReadyUnavailable && (
        <div
          role="alert"
          data-testid="tracked-viewer-unavailable"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-900"
        >
          <div className="flex items-center gap-2">
            <IconAlertCircle className="h-4 w-4 shrink-0 text-rose-700" />
            <span>
              {tSafety(isDecodeFailed ? 'trackedViewer.decodeError' : 'trackedViewer.unavailable')}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRetry()}
            leftIcon={<IconRefresh className="h-3.5 w-3.5" />}
          >
            {tSafety('trackedViewer.retry')}
          </Button>
        </div>
      )}

      {status === 'READY' && activeObjectUrl !== null && !isDecodeFailed && (
        <>
          <div
            data-testid="tracked-viewer-stage"
            className="flex min-h-[240px] max-h-[60vh] w-full items-center justify-center overflow-auto rounded-xl border border-slate-200 bg-slate-950/95 p-3"
          >
            <img
              src={activeObjectUrl}
              alt={imageAlt}
              data-testid="tracked-viewer-image"
              onLoad={() => {
                if (acceptedBlob !== null && activeObjectUrl !== null) {
                  setLoadedImageState({
                    scopeKey,
                    selectionKey,
                    blob: acceptedBlob,
                    url: activeObjectUrl,
                  });
                }
              }}
              onError={() => {
                setLoadedImageState(null);
                setFailedBlobUrl(activeObjectUrl);
              }}
              className="max-h-[56vh] w-auto max-w-full object-contain"
            />
          </div>
          {isImageLoaded && identityContent !== undefined && identityContent !== null && (
            <div data-testid="tracked-viewer-identity-slot">{identityContent}</div>
          )}
        </>
      )}

      {isTechnicalOpen && (
        <dl
          id={technicalPanelId}
          data-testid="tracked-viewer-technical"
          className="grid gap-2 rounded-xl border border-slate-200/80 bg-slate-50 p-3 text-xs text-slate-700 sm:grid-cols-2"
        >
          {[
            { label: tSafety('trackedViewer.scopeKey'), value: scopeKey },
            { label: tSafety('trackedViewer.selectionKey'), value: selectionKey },
            { label: tSafety('trackedViewer.representation'), value: representation },
            ...(acceptedBlob
              ? [{ label: tSafety('trackedViewer.byteSize'), value: String(acceptedBlob.size) }]
              : []),
          ].map((entry) => (
            <div key={entry.label} className="min-w-0">
              <dt className="font-semibold text-slate-600">{entry.label}</dt>
              <dd className="mt-0.5 break-all font-mono tabular-nums text-slate-900">
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div
        className={`flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 ${
          normalizedReturnToFrameHref ? 'justify-between' : 'justify-end'
        }`}
      >
        {normalizedReturnToFrameHref ? (
          inRouterContext ? (
            <Link
              to={normalizedReturnToFrameHref}
              data-testid="tracked-viewer-back-to-frame"
              className="inline-flex items-center rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-900"
            >
              {t('frameInbox.backToFrame')}
            </Link>
          ) : (
            <a
              href={normalizedReturnToFrameHref}
              data-testid="tracked-viewer-back-to-frame"
              className="inline-flex items-center rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-900"
            >
              {t('frameInbox.backToFrame')}
            </a>
          )
        ) : null}
        <Button variant="outline" onClick={() => onClose()}>
          {tSafety('trackedViewer.close')}
        </Button>
      </div>
    </div>
  );
}
