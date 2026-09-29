import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  type SafetyAlertDetectionResponse,
} from '@smartsite/api-client';
import {
  evidenceErrorMessage,
  formatEvidenceAltText,
  formatEvidenceKind,
} from './safetyAlertEvidenceUtils';

export interface SafetyAlertEvidencePanelProps {
  client: SmartSiteManagementClient;
  token: string;
  siteId: string;
  alertId: string;
  detection: SafetyAlertDetectionResponse;
}

export function SafetyAlertEvidencePanel({
  client,
  token,
  siteId,
  alertId,
  detection,
}: SafetyAlertEvidencePanelProps) {
  const [selectedEvidenceIndex, setSelectedEvidenceIndex] = useState<number | null>(null);
  const [prevScope, setPrevScope] = useState(`${alertId}:${detection.eventId}`);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  // Reset selected evidence during render when alert or detection changes to prevent displaying stale images
  if (prevScope !== `${alertId}:${detection.eventId}`) {
    setPrevScope(`${alertId}:${detection.eventId}`);
    setSelectedEvidenceIndex(null);
  }

  const evidenceList = detection.evidence ?? [];
  const selectedItem =
    selectedEvidenceIndex !== null
      ? evidenceList.find((item) => item.index === selectedEvidenceIndex)
      : null;

  const isSelectedAvailable = Boolean(selectedItem?.available);

  // Fetch only when the user explicitly clicks an available evidence item
  const evidenceQuery = useQuery({
    queryKey: ['safety-alert-evidence', siteId, alertId, detection.eventId, selectedEvidenceIndex],
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
    staleTime: 5 * 60 * 1000,
  });

  // Manage Object URL lifecycle: create on new Blob, revoke on change or unmount
  useEffect(() => {
    const blob = evidenceQuery.data;
    if (!blob) {
      return;
    }

    const url = URL.createObjectURL(blob);
    let active = true;

    queueMicrotask(() => {
      if (active) {
        setObjectUrl(url);
      }
    });

    return () => {
      active = false;
      URL.revokeObjectURL(url);
      setObjectUrl(null);
    };
  }, [evidenceQuery.data]);

  const handleToggle = (index: number) => {
    setSelectedEvidenceIndex((current) => (current === index ? null : index));
  };

  if (evidenceList.length === 0) {
    return (
      <div className="mt-2 border-t border-slate-200/80 pt-2 text-[11px] text-slate-400">
        No evidence image retained for this observation.
      </div>
    );
  }

  return (
    <div className="mt-2 border-t border-slate-200/80 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
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
                  className="inline-flex items-center rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-400 cursor-not-allowed"
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
                    ? 'bg-slate-900 text-white hover:bg-slate-800'
                    : 'border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-100'
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
        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2">
          {evidenceQuery.isPending && (
            <div
              role="status"
              aria-busy="true"
              className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500"
            >
              <span
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"
                aria-hidden="true"
              />
              <span>Loading evidence image…</span>
            </div>
          )}

          {evidenceQuery.isError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded bg-red-50 p-2 text-xs text-red-700"
            >
              <span>{evidenceErrorMessage(evidenceQuery.error)}</span>
              <button
                type="button"
                onClick={() => void evidenceQuery.refetch()}
                className="font-bold text-red-800 underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          )}

          {evidenceQuery.isSuccess && objectUrl && selectedItem && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-center overflow-hidden rounded border border-slate-100 bg-slate-950/5">
                <img
                  src={objectUrl}
                  alt={formatEvidenceAltText(
                    selectedItem.kind,
                    detection.cameraExternalId,
                    detection.capturedAt,
                  )}
                  className="max-h-72 w-auto object-contain"
                />
              </div>
              <div className="flex items-center justify-between px-0.5 text-[11px] text-slate-500">
                <span>
                  {formatEvidenceKind(selectedItem.kind)}
                  {selectedItem.trackId !== undefined ? ` · Track #${selectedItem.trackId}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedEvidenceIndex(null)}
                  className="font-semibold text-slate-400 hover:text-slate-700"
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
