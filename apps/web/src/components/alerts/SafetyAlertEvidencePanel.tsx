import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { useEffect, useState, type ReactNode } from 'react';
import { PpeDialog } from '../ppe/PpeDialog';
import { useQuery } from '@tanstack/react-query';
import {
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

export interface SafetyAlertEvidencePanelProps {
  client: SmartSiteManagementClient;
  apiUrl: string;
  sessionScope: string;
  token: string;
  siteId: string;
  alertId: string;
  detection: SafetyAlertDetectionResponse;
  canReviewIdentity?: boolean;
  autoOpenFrame?: boolean;
  children?: ReactNode;
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
  autoOpenFrame = false,
  children,
}: SafetyAlertEvidencePanelProps) {
  useTranslation();

  const [selection, setSelection] = useState<number | null>();

  const evidenceList = detection.evidence ?? [];
  const originalFrame = autoOpenFrame
    ? evidenceList.find((item) => item.kind === 'FRAME' && item.available)
    : undefined;
  const selectedEvidenceIndex =
    selection === undefined ? (originalFrame?.index ?? null) : selection;
  const selectedItem =
    selectedEvidenceIndex !== null
      ? evidenceList.find((item) => item.index === selectedEvidenceIndex)
      : null;

  const isSelectedAvailable = Boolean(selectedItem?.available);

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
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  const handleToggle = (index: number) => {
    setSelection(selectedEvidenceIndex === index ? null : index);
  };

  const identityReview = canReviewIdentity && (
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
        evidenceBlob={evidenceQuery.isSuccess ? evidenceQuery.data : null}
      />
    </div>
  );

  if (evidenceList.length === 0) {
    return (
      <div className="mt-2 border-t border-[#EAEAEA] pt-2">
        <div className="text-[11px] text-[#6B6B6B]">
          {tr('safety_alert_evidence_panel.no_evidence_image_retained_for_this_observation')}
        </div>
        {children}
        {identityReview}
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

      {autoOpenFrame && !originalFrame && (
        <p className="mt-2 text-xs text-[#6B6B6B]">{tr('frameInbox.photoUnavailable')}</p>
      )}
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
                onClick={() => void evidenceQuery.refetch()}
                className="font-bold text-[#9F2F2D] underline hover:no-underline"
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
                  allowEnlarge={selectedItem.kind === 'FRAME'}
                  onRetry={() => void evidenceQuery.refetch()}
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
                  onClick={() => setSelection(null)}
                  className="font-semibold text-[#6B6B6B] hover:text-[#2F3437] cursor-pointer"
                >
                  {tr('common.close_image')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {children}
      {identityReview}
    </div>
  );
}

function EvidenceImage({
  blob,
  alt,
  allowEnlarge,
  onRetry,
}: {
  blob: Blob;
  alt: string;
  allowEnlarge: boolean;
  onRetry(): void;
}) {
  useTranslation();
  const [enlarged, setEnlarged] = useState(false);
  const [failed, setFailed] = useState(false);

  const [blobUrlState, setBlobUrlState] = useState<{ blob: Blob; url: string } | null>(null);

  useEffect(() => {
    let active = true;
    let allocatedUrl: string | null = null;
    try {
      allocatedUrl = URL.createObjectURL(blob);
    } catch {
      allocatedUrl = null;
    }

    const urlToSet = allocatedUrl;
    queueMicrotask(() => {
      if (!active) return;
      if (urlToSet) setBlobUrlState({ blob, url: urlToSet });
      else setFailed(true);
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
  }, [blob]);

  const activeObjectUrl = blob && blobUrlState?.blob === blob ? blobUrlState.url : null;

  if (failed) {
    return (
      <div role="alert" className="flex w-full items-center justify-between gap-2 p-3 text-xs">
        <span>{tr('frameInbox.photoUnavailable')}</span>
        <button type="button" onClick={onRetry} className="font-semibold underline">
          {tr('common.retry')}
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
    <div className="w-full">
      <img
        src={activeObjectUrl}
        alt={alt}
        onError={() => setFailed(true)}
        className="mx-auto max-h-96 w-full bg-slate-950 object-contain"
      />
      {allowEnlarge && (
        <>
          <button
            type="button"
            className="m-2 rounded-md border border-[#EAEAEA] bg-white px-3 py-2 text-xs font-semibold"
            onClick={() => setEnlarged(true)}
          >
            {tr('safety_alert_evidence_panel.enlarge_image')}
          </button>
          <PpeDialog
            wide
            open={enlarged}
            title={tr('safety_alert_evidence_panel.enlarge_image')}
            onClose={() => setEnlarged(false)}
          >
            <img src={activeObjectUrl} alt={alt} className="max-h-[72dvh] w-full object-contain" />
          </PpeDialog>
        </>
      )}
    </div>
  );
}
