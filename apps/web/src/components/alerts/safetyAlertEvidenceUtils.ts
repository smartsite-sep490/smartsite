import { uiLocale } from '../../i18n';
import { translate as tr } from '../../i18n';
import { ApiError } from '@smartsite/api-client';
import { userErrorMessage } from '../../i18n/messages';

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
    if (error.status === 503)
      return tr('safety_alert_evidence_utils.evidence_is_temporarily_unavailable');
    return userErrorMessage(error);
  }
  return error instanceof Error
    ? userErrorMessage(error)
    : tr('safety_alert_evidence_utils.failed_to_load_evidence_image');
}
