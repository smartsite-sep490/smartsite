import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TrackedEpisodeMediaRepresentation } from '@smartsite/contracts/tracked-episode-frames';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { IconAlertCircle, IconEye, IconLoader, IconRefresh, IconUser } from '../icons';
import { PpeDialog } from '../ppe/PpeDialog';
import { Badge, Button } from '../ui';
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
  const { t } = useTranslation(SAFETY_NAMESPACE);
  if (!props.open) {
    return null;
  }
  const isSubject = props.representation === 'SUBJECT';
  const dialogTitle = t(isSubject ? 'trackedViewer.titleSubject' : 'trackedViewer.titleFrame');

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
  onClose,
  onRetry,
}: TrackedEvidenceViewerProps) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const [blobUrlState, setBlobUrlState] = useState<AllocatedBlobUrlState | null>(null);
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
  const isReadyUnavailable =
    status === 'READY' && (acceptedBlob === null || isUrlCreationFailed || isDecodeFailed);
  const isPreparingReadyUrl =
    status === 'READY' && acceptedBlob !== null && matchingUrlState === null;

  const isSubject = representation === 'SUBJECT';
  const imageAlt = t(isSubject ? 'trackedViewer.altSubject' : 'trackedViewer.altFrame');
  const technicalPanelId = 'tracked-viewer-technical-panel';

  return (
    <div className="space-y-4" data-testid="tracked-viewer-body">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant={isSubject ? 'default' : 'neutral'} data-testid="tracked-viewer-badge">
          {isSubject ? <IconUser className="h-3 w-3" /> : <IconEye className="h-3 w-3" />}
          <span>{t(isSubject ? 'trackedViewer.badgeSubject' : 'trackedViewer.badgeFrame')}</span>
        </Badge>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={isTechnicalOpen}
          aria-controls={technicalPanelId}
          onClick={() => setIsTechnicalOpen((prev) => !prev)}
        >
          {t(isTechnicalOpen ? 'trackedViewer.hideTechnical' : 'trackedViewer.showTechnical')}
        </Button>
      </div>

      <p data-testid="tracked-viewer-crop-note" className="text-xs font-medium text-slate-700">
        {t('trackedViewer.cropDisclaimer')}
      </p>

      {status === 'LOADING' && (
        <div
          role="status"
          aria-live="polite"
          data-testid="tracked-viewer-loading"
          className="flex min-h-[220px] items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-700"
        >
          <IconLoader className="h-4 w-4 animate-spin text-slate-600" />
          <span>{t('trackedViewer.loading')}</span>
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
          <span>{t('trackedViewer.preparing')}</span>
        </div>
      )}

      {status === 'FORBIDDEN' && (
        <div
          role="alert"
          data-testid="tracked-viewer-forbidden"
          className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950"
        >
          <IconAlertCircle className="h-4 w-4 shrink-0 text-amber-700" />
          <span>{t('trackedViewer.forbidden')}</span>
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
            <span>{t('trackedViewer.error')}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRetry()}
            leftIcon={<IconRefresh className="h-3.5 w-3.5" />}
          >
            {t('trackedViewer.retry')}
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
              {t(isDecodeFailed ? 'trackedViewer.decodeError' : 'trackedViewer.unavailable')}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRetry()}
            leftIcon={<IconRefresh className="h-3.5 w-3.5" />}
          >
            {t('trackedViewer.retry')}
          </Button>
        </div>
      )}

      {status === 'READY' && activeObjectUrl !== null && !isDecodeFailed && (
        <div
          data-testid="tracked-viewer-stage"
          className="flex min-h-[240px] max-h-[60vh] w-full items-center justify-center overflow-auto rounded-xl border border-slate-200 bg-slate-950/95 p-3"
        >
          <img
            src={activeObjectUrl}
            alt={imageAlt}
            data-testid="tracked-viewer-image"
            onError={() => setFailedBlobUrl(activeObjectUrl)}
            className="max-h-[56vh] w-auto max-w-full object-contain"
          />
        </div>
      )}

      {isTechnicalOpen && (
        <dl
          id={technicalPanelId}
          data-testid="tracked-viewer-technical"
          className="grid gap-2 rounded-xl border border-slate-200/80 bg-slate-50 p-3 text-xs text-slate-700 sm:grid-cols-2"
        >
          {[
            { label: t('trackedViewer.scopeKey'), value: scopeKey },
            { label: t('trackedViewer.selectionKey'), value: selectionKey },
            { label: t('trackedViewer.representation'), value: representation },
            ...(acceptedBlob
              ? [{ label: t('trackedViewer.byteSize'), value: String(acceptedBlob.size) }]
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

      <div className="flex justify-end border-t border-slate-100 pt-3">
        <Button variant="outline" onClick={() => onClose()}>
          {t('trackedViewer.close')}
        </Button>
      </div>
    </div>
  );
}
