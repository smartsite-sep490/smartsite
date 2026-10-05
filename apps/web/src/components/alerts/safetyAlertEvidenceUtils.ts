import { ApiError } from '@smartsite/api-client';

export function buildEvidenceQueryKey(
  apiUrl: string,
  sessionScope: string,
  siteId: string,
  alertId: string,
  eventId: string,
  evidenceIndex: number | null,
) {
  return [
    'safety-alert-evidence',
    apiUrl,
    sessionScope,
    siteId,
    alertId,
    eventId,
    evidenceIndex,
  ] as const;
}

export function formatEvidenceKind(kind: string): string {
  switch (kind.toUpperCase()) {
    case 'FRAME':
      return 'Frame';
    case 'CROP':
      return 'Crop';
    case 'SNAPSHOT':
      return 'Snapshot';
    default:
      return kind
        .toLowerCase()
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
  }
}

export function formatEvidenceAltText(
  kind: string,
  cameraExternalId: string,
  capturedAt: string,
): string {
  const date = new Date(capturedAt);
  const formattedDate = Number.isNaN(date.getTime()) ? capturedAt : date.toLocaleString();
  return `Evidence ${kind.toLowerCase()} from camera ${cameraExternalId} captured at ${formattedDate}`;
}

export function evidenceErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Your session is no longer valid. Sign in again.';
    if (error.status === 403) return 'This account cannot view evidence for the selected Site.';
    if (error.status === 404) return 'The requested evidence image is no longer available.';
    if (error.status === 503) return 'Evidence is temporarily unavailable.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'Failed to load evidence image.';
}

export function formatCandidateSubtype(value: string): string {
  switch (value) {
    case 'PPE_HARD_HAT_MISSING':
      return 'Missing Hard Hat';
    case 'PPE_SAFETY_VEST_MISSING':
      return 'Missing Safety Vest';
    case 'PPE_GLOVES_MISSING':
      return 'Missing Gloves';
    case 'PPE_BOOTS_MISSING':
      return 'Missing Boots';
    case 'PPE_GOGGLES_MISSING':
      return 'Missing Goggles';
    case 'ZONE_ENTRY_VIOLATION':
      return 'Zone Entry Violation';
    case 'ZONE_ENTRY_UNAUTHORIZED':
      return 'Unauthorized Zone Entry';
    case 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE':
      return 'Authorization Unavailable';
    case 'RESTRICTED_ZONE_INTRUSION':
      return 'Restricted Zone Intrusion';
    default:
      return value
        .toLowerCase()
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
  }
}
