import { SAFETY_NAMESPACE, translate as tr, uiLocale } from '../../i18n';
import { localizedLabel } from '../../i18n/labels';
import '../../i18n/ppe-catalog';
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
      return tr('common.frame');
    case 'CROP':
      return tr('common.crop');
    case 'SNAPSHOT':
      return tr('common.snapshot');
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
  const formattedDate = Number.isNaN(date.getTime()) ? capturedAt : date.toLocaleString(uiLocale());
  return tr('safety_alert_evidence_utils.evidence_value_from_camera_value_captured_at_value', {
    value1: kind.toLowerCase(),
    value2: cameraExternalId,
    value3: formattedDate,
  });
}

export function evidenceErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return tr('safety_alert_evidence_utils.your_session_is_no_longer_valid_sign_in_again');
    if (error.status === 403)
      return tr(
        'safety_alert_evidence_utils.this_account_cannot_view_evidence_for_the_selected_site',
      );
    if (error.status === 404)
      return tr('safety_alert_evidence_utils.the_requested_evidence_image_is_no_longer_available');
    if (error.status === 429) return tr('safety.evidence.error.429', { ns: SAFETY_NAMESPACE });
    if (error.status === 503)
      return tr('safety_alert_evidence_utils.evidence_is_temporarily_unavailable');
    if (error.code === 'network')
      return tr('safety.evidence.error.network', { ns: SAFETY_NAMESPACE });
    if (error.code === 'timeout')
      return tr('safety.evidence.error.timeout', { ns: SAFETY_NAMESPACE });
    if (error.code === 'cancelled')
      return tr('safety.evidence.error.cancelled', { ns: SAFETY_NAMESPACE });
    if (error.code === 'invalid-response')
      return tr('safety.evidence.error.invalidResponse', { ns: SAFETY_NAMESPACE });
  }
  return tr('safety_alert_evidence_utils.failed_to_load_evidence_image');
}

export function formatCandidateSubtype(value: string): string {
  switch (value) {
    case 'PPE_HARD_HAT_MISSING':
      return tr('safety.subtype.PPE_HARD_HAT_MISSING', { ns: SAFETY_NAMESPACE });
    case 'PPE_SAFETY_VEST_MISSING':
      return tr('safety.subtype.PPE_SAFETY_VEST_MISSING', { ns: SAFETY_NAMESPACE });
    case 'PPE_GLOVES_MISSING':
      return tr('safety.subtype.PPE_GLOVES_MISSING', { ns: SAFETY_NAMESPACE });
    case 'PPE_BOOTS_MISSING':
      return tr('safety.subtype.PPE_BOOTS_MISSING', { ns: SAFETY_NAMESPACE });
    case 'PPE_GOGGLES_MISSING':
      return tr('safety.subtype.PPE_GOGGLES_MISSING', { ns: SAFETY_NAMESPACE });
    case 'ZONE_ENTRY_VIOLATION':
      return tr('safety.subtype.ZONE_ENTRY_VIOLATION', { ns: SAFETY_NAMESPACE });
    case 'ZONE_ENTRY_UNAUTHORIZED':
      return tr('safety.subtype.ZONE_ENTRY_UNAUTHORIZED', { ns: SAFETY_NAMESPACE });
    case 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE':
      return tr('safety.subtype.ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE', { ns: SAFETY_NAMESPACE });
    case 'RESTRICTED_ZONE_INTRUSION':
      return tr('safety.subtype.RESTRICTED_ZONE_INTRUSION', { ns: SAFETY_NAMESPACE });
    default: {
      const translated = localizedLabel(value);
      return translated !== value
        ? translated
        : value
            .toLowerCase()
            .split('_')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }
  }
}
