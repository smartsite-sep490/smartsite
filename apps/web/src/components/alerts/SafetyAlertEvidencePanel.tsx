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

export interface SafetyAlertEvidencePanelProps {
  client: SmartSiteManagementClient;
  apiUrl: string;
  sessionScope: string;
  token: string;
  siteId: string;
  alertId: string;
  detection: SafetyAlertDetectionResponse;
}

export function SafetyAlertEvidencePanel({
  client,
  apiUrl,
  sessionScope,
  token,
  siteId,
  alertId,
  detection,
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
    queryFn: () => {
      if (selectedEvidenceIndex === null) {
        throw new Error('No evidence item selected.');
      }
      return client.getSafetyAlertEvidence(
        token,
        siteId,
        alertId,
        detection.eventId,
        selectedEvidenceIndex,
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
      <div className="mt-2 border-t border-[#EAEAEA] pt-2 text-[11px] text-[#6B6B6B]">
        No evidence image retained for this observation.
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
                  className="font-semibold text-[#A3A09C] hover:text-[#2F3437]"
                >
                  Close image
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EvidenceImage({ blob, alt }: { blob: Blob; alt: string }) {
  const [objectUrl] = useState(() => URL.createObjectURL(blob));

  useEffect(
    () => () => {
      URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );

  return <img src={objectUrl} alt={alt} className="max-h-72 w-auto object-contain" />;
}
