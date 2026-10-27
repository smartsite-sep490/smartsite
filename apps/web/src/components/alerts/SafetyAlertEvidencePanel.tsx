import { SAFETY_NAMESPACE, translate as tr } from '../../i18n';
import '../../i18n/ppe-catalog';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ApiError,
  SmartSiteManagementClient,
  type SafetyAlertDetectionResponse,
} from '@smartsite/api-client';
import {
  buildEvidenceQueryKey,
  evidenceErrorMessage,
  formatEvidenceAltText,
  formatEvidenceKind,
} from './safetyAlertEvidenceUtils';
import { ObservationIdentityReviewPanel } from './ObservationIdentityReviewPanel';

function isUnauthorizedError(error: unknown): boolean {
  if (error instanceof ApiError && error.status === 401) return true;
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    (error as { status: unknown }).status === 401
  ) {
    return true;
  }
  return false;
}

export interface SafetyAlertEvidencePanelProps {
  client: SmartSiteManagementClient;
  apiUrl: string;
  sessionScope: string;
  token: string;
  siteId: string;
  alertId: string;
  detection: SafetyAlertDetectionResponse;
  canReviewIdentity?: boolean;
  onUnauthorized?: () => void;
}

export function SafetyAlertEvidencePanel({
  client,
  apiUrl,
  sessionScope,
  token,
  siteId,
  alertId,
  detection,
  canReviewIdentity = false,
  onUnauthorized,
}: SafetyAlertEvidencePanelProps) {
  useTranslation();

  const [selectedEvidenceIndex, setSelectedEvidenceIndex] = useState<number | null>(null);
  const [unavailableImageBlob, setUnavailableImageBlob] = useState<Blob | null>(null);
  const handleImageUnavailable = useCallback((blob: Blob) => setUnavailableImageBlob(blob), []);

  const evidenceList = detection.evidence ?? [];
  const selectedItem =
    selectedEvidenceIndex !== null
      ? evidenceList.find((item) => item.index === selectedEvidenceIndex)
      : null;

  const isSelectedAvailable = Boolean(selectedItem?.available);

  // Fetch only when the user explicitly clicks an available evidence item
  const evidenceQuery = useQuery({
    queryKey: buildEvidenceQueryKey(
      apiUrl,
      sessionScope,
      siteId,
      alertId,
      detection.eventId,
      selectedEvidenceIndex,
    ),
    queryFn: ({ signal }) => {
      if (selectedEvidenceIndex === null) {
        throw new Error(tr('safety_alert_evidence_panel.no_evidence_item_selected'));
      }
      return client.getSafetyAlertEvidence(
        token,
        siteId,
        alertId,
        detection.eventId,
        selectedEvidenceIndex,
        { signal },
      );
    },
    enabled:
      Boolean(token) &&
      Boolean(siteId) &&
      Boolean(alertId) &&
      Boolean(detection.eventId) &&
      selectedEvidenceIndex !== null &&
      isSelectedAvailable,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // TanStack retains the last successful data after a refetch fails. That blob
  // must not remain usable for identity review once access/availability is lost.
  const reviewedEvidenceBlob =
    isSelectedAvailable && evidenceQuery.isSuccess && evidenceQuery.data !== unavailableImageBlob
      ? (evidenceQuery.data ?? null)
      : null;
  const isAccessDenied =
    evidenceQuery.error instanceof ApiError &&
    (evidenceQuery.error.status === 401 || evidenceQuery.error.status === 403);

  useEffect(() => {
    if (isUnauthorizedError(evidenceQuery.error)) {
      onUnauthorized?.();
    }
  }, [evidenceQuery.error, onUnauthorized]);

  const handleToggle = (index: number) => {
    setSelectedEvidenceIndex((current) => (current === index ? null : index));
  };

  if (evidenceList.length === 0) {
    return (
      <div className="mt-2 border-t border-[#EAEAEA] pt-2">
        <div className="text-[11px] text-[#6B6B6B]">
          {tr('safety_alert_evidence_panel.no_evidence_image_retained_for_this_observation')}
        </div>
        {canReviewIdentity && (
          <div className="mt-3 border-t border-[#EAEAEA] pt-3">
            <ObservationIdentityReviewPanel
              client={client}
              apiUrl={apiUrl}
              sessionScope={sessionScope}
              token={token}
              siteId={siteId}
              alertId={alertId}
              detection={detection}
              evidenceIndex={null}
              evidenceBlob={null}
              onUnauthorized={onUnauthorized}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 border-t border-[#EAEAEA] pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6B6B]">
          {tr('common.evidence')}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {evidenceList.map((item) => {
            const isSelected = selectedEvidenceIndex === item.index;
            const kindLabel = formatEvidenceKind(item.kind);
            const trackText =
              item.trackId !== undefined
                ? tr('messages.1e50a92b018d', { value1: item.trackId })
                : '';

            if (!item.available) {
              return (
                <span
                  key={item.index}
                  className="inline-flex items-center rounded border border-[#EAEAEA] bg-[#F7F6F3] px-2 py-0.5 text-[11px] font-medium text-[#A3A09C] cursor-not-allowed"
                  title={tr('safety_alert_evidence_panel.evidence_is_not_available_on_storage')}
                >
                  {tr('common.valuevalue_unavailable', { value1: kindLabel, value2: trackText })}
                </span>
              );
            }

            return (
              <button
                key={item.index}
                type="button"
                aria-expanded={isSelected}
                onClick={() => handleToggle(item.index)}
                className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                  isSelected
                    ? 'bg-[#111111] text-white hover:bg-[#333333]'
                    : 'border border-[#EAEAEA] bg-white text-[#2F3437] hover:border-[#2F3437]/20 hover:bg-[#F7F6F3]'
                }`}
              >
                {isSelected ? tr('common.hide') : tr('common.view')} {kindLabel}
                {trackText}
              </button>
            );
          })}
        </div>
      </div>

      {selectedEvidenceIndex !== null && isSelectedAvailable && (
        <div className="mt-2 rounded-md border border-[#EAEAEA] bg-white p-2">
          {evidenceQuery.isPending && (
            <div
              role="status"
              aria-busy="true"
              className="flex items-center justify-center gap-2 py-6 text-xs text-[#6B6B6B]"
            >
              <span
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#EAEAEA] border-t-transparent"
                aria-hidden="true"
              />
              <span>{tr('common.loading_evidence_image')}</span>
            </div>
          )}

          {evidenceQuery.isError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded bg-[#FDEBEC] p-2 text-xs text-[#9F2F2D]"
            >
              <span>{evidenceErrorMessage(evidenceQuery.error)}</span>
              <button
                type="button"
                disabled={isAccessDenied || evidenceQuery.isFetching}
                onClick={() => {
                  if (!isAccessDenied && !evidenceQuery.isFetching) void evidenceQuery.refetch();
                }}
                className="font-bold text-[#9F2F2D] underline hover:no-underline disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9F2F2D]"
              >
                {tr('common.retry')}
              </button>
            </div>
          )}

          {evidenceQuery.isSuccess && evidenceQuery.data && selectedItem && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-center overflow-hidden rounded border border-[#EAEAEA] bg-[#F7F6F3]">
                <EvidenceImage
                  key={`${detection.eventId}:${selectedItem.index}:${evidenceQuery.dataUpdatedAt}`}
                  blob={evidenceQuery.data}
                  onUnavailable={handleImageUnavailable}
                  onRetry={() => {
                    if (!evidenceQuery.isFetching) void evidenceQuery.refetch();
                  }}
                  isRetrying={evidenceQuery.isFetching}
                  alt={formatEvidenceAltText(
                    selectedItem.kind,
                    detection.cameraExternalId,
                    detection.capturedAt,
                  )}
                />
              </div>
              <div className="flex items-center justify-between px-0.5 text-[11px] text-[#6B6B6B]">
                <span>
                  {formatEvidenceKind(selectedItem.kind)}
                  {selectedItem.trackId !== undefined
                    ? tr('common.track_value_2a54ba', { value1: selectedItem.trackId })
                    : ''}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedEvidenceIndex(null)}
                  className="font-semibold text-[#6B6B6B] hover:text-[#2F3437] cursor-pointer"
                >
                  {tr('common.close_image')}
                </button>
              </div>
              {selectedItem.kind === 'FRAME' && (
                <p className="px-0.5 text-[11px] leading-relaxed text-[#6B6B6B]">
                  {tr('safety.evidence.frameCaptionBase', { ns: SAFETY_NAMESPACE })}{' '}
                  {canReviewIdentity
                    ? tr('safety.evidence.frameCaptionIdentityReview', { ns: SAFETY_NAMESPACE })
                    : tr('safety.evidence.frameCaptionSourceObservations', {
                        ns: SAFETY_NAMESPACE,
                      })}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {canReviewIdentity && (
        <div className="mt-3 border-t border-[#EAEAEA] pt-3">
          <ObservationIdentityReviewPanel
            client={client}
            apiUrl={apiUrl}
            sessionScope={sessionScope}
            token={token}
            siteId={siteId}
            alertId={alertId}
            detection={detection}
            evidenceIndex={selectedEvidenceIndex}
            evidenceBlob={reviewedEvidenceBlob}
            onUnauthorized={onUnauthorized}
          />
        </div>
      )}
    </div>
  );
}

function EvidenceImage({
  blob,
  alt,
  onUnavailable,
  onRetry,
  isRetrying,
}: {
  blob: Blob;
  alt: string;
  onUnavailable: (blob: Blob) => void;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  useTranslation();

  const [blobUrlState, setBlobUrlState] = useState<{ blob: Blob; url: string | null } | null>(null);
  const [failedImageBlob, setFailedImageBlob] = useState<Blob | null>(null);

  useEffect(() => {
    if (failedImageBlob === blob) return;
    let active = true;
    let allocatedUrl: string | null = null;
    try {
      allocatedUrl = URL.createObjectURL(blob);
    } catch {
      allocatedUrl = null;
    }

    const urlToSet = allocatedUrl;
    queueMicrotask(() => {
      if (active) {
        setBlobUrlState({ blob, url: urlToSet });
        if (!urlToSet) onUnavailable(blob);
      }
    });

    return () => {
      active = false;
      if (allocatedUrl) {
        try {
          URL.revokeObjectURL(allocatedUrl);
        } catch {
          // ignore
        }
      }
    };
  }, [blob, failedImageBlob, onUnavailable]);

  const activeObjectUrl = blob && blobUrlState?.blob === blob ? blobUrlState.url : null;

  if (failedImageBlob === blob || (blobUrlState?.blob === blob && !blobUrlState.url)) {
    return (
      <div
        role="alert"
        className="flex min-h-32 w-full flex-col items-center justify-center gap-3 p-4 text-center text-xs text-[#9F2F2D]"
      >
        <span>{tr('safety.evidence.unreadableImageMessage', { ns: SAFETY_NAMESPACE })}</span>
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className="rounded border border-[#9F2F2D]/30 px-3 py-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9F2F2D]"
        >
          {isRetrying
            ? tr('safety.evidence.loadingImage', { ns: SAFETY_NAMESPACE })
            : tr('safety.evidence.retryImage', { ns: SAFETY_NAMESPACE })}
        </button>
      </div>
    );
  }

  if (!activeObjectUrl) {
    return (
      <div
        role="status"
        aria-busy="true"
        className="flex h-48 w-full items-center justify-center text-xs text-[#6B6B6B]"
      >
        <span
          className="mr-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#EAEAEA] border-t-transparent"
          aria-hidden="true"
        />
        <span>{tr('safety_alert_evidence_panel.ang_chuan_bi_anh_bang_chung')}</span>
      </div>
    );
  }

  return (
    <img
      src={activeObjectUrl}
      alt={alt}
      onError={() => {
        setFailedImageBlob(blob);
        onUnavailable(blob);
      }}
      className="max-h-72 w-auto object-contain"
    />
  );
}
