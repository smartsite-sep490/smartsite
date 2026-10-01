import { useEffect, useState } from 'react';
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
}: SafetyAlertEvidencePanelProps) {
  const [selectedEvidenceIndex, setSelectedEvidenceIndex] = useState<number | null>(null);

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
        throw new Error('No evidence item selected.');
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
  });

  const handleToggle = (index: number) => {
    setSelectedEvidenceIndex((current) => (current === index ? null : index));
  };

  if (evidenceList.length === 0) {
    return (
      <div className="mt-2 border-t border-[#EAEAEA] pt-2">
        <div className="text-[11px] text-[#6B6B6B]">
          No evidence image retained for this observation.
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
          Evidence
        </span>
        <div className="flex flex-wrap gap-1.5">
          {evidenceList.map((item) => {
            const isSelected = selectedEvidenceIndex === item.index;
            const kindLabel = formatEvidenceKind(item.kind);
            const trackText = item.trackId !== undefined ? ` (Track #${item.trackId})` : '';

            if (!item.available) {
              return (
                <span
                  key={item.index}
                  className="inline-flex items-center rounded border border-[#EAEAEA] bg-[#F7F6F3] px-2 py-0.5 text-[11px] font-medium text-[#A3A09C] cursor-not-allowed"
                  title="Evidence is not available on storage"
                >
                  {kindLabel}
                  {trackText} · Unavailable
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
                {isSelected ? 'Hide' : 'View'} {kindLabel}
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
              <span>Loading evidence image…</span>
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
                Retry
              </button>
            </div>
          )}

          {evidenceQuery.isSuccess && evidenceQuery.data && selectedItem && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-center overflow-hidden rounded border border-[#EAEAEA] bg-[#F7F6F3]">
                <EvidenceImage
                  key={`${detection.eventId}:${selectedItem.index}:${evidenceQuery.dataUpdatedAt}`}
                  blob={evidenceQuery.data}
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
                  {selectedItem.trackId !== undefined ? ` · Track #${selectedItem.trackId}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedEvidenceIndex(null)}
                  className="font-semibold text-[#6B6B6B] hover:text-[#2F3437] cursor-pointer"
                >
                  Close image
                </button>
              </div>
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
            evidenceBlob={evidenceQuery.data ?? null}
          />
        </div>
      )}
    </div>
  );
}

function EvidenceImage({ blob, alt }: { blob: Blob; alt: string }) {
  const [blobUrlState, setBlobUrlState] = useState<{ blob: Blob; url: string } | null>(null);

  useEffect(() => {
    let active = true;
    let allocatedUrl: string | null = null;
    try {
      allocatedUrl = URL.createObjectURL(blob);
    } catch {
      allocatedUrl = null;
    }

    if (allocatedUrl) {
      const urlToSet = allocatedUrl;
      queueMicrotask(() => {
        if (active) {
          setBlobUrlState({ blob, url: urlToSet });
        }
      });
    }

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
        <span>Đang chuẩn bị ảnh bằng chứng…</span>
      </div>
    );
  }

  return <img src={activeObjectUrl} alt={alt} className="max-h-72 w-auto object-contain" />;
}
