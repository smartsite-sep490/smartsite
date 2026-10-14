import { translate as tr } from '../../../i18n';
import type {
  FaceGateReasonCode,
  FaceVerificationTechnicalOutcome,
  GateAuthorizationOutcome,
  FaceGateVerificationResponse,
} from '@smartsite/contracts';

/** Historical display only; never use a retained worker for authorization. Null explicitly clears it. */
export function retainGateWorker(
  previous: FaceGateVerificationResponse['worker'] | null,
  next: FaceGateVerificationResponse['worker'] | null,
): FaceGateVerificationResponse['worker'] | null {
  return next === undefined ? previous : next;
}

export type GateUiDecisionType =
  'ALLOWED' | 'DENIED' | 'MANUAL_REVIEW' | 'FALLBACK_REQUIRED' | 'RETRY';

export interface GateUiState {
  type: GateUiDecisionType;
  label: string;
  badgeClass: string;
  panelClass: string;
  canRecordInOut: boolean;
  canUseQrFallback: boolean;
  isRetry: boolean;
  safeDescription: string;
}

/**
 * Maps technical and backend authorization outcomes to UI display state
 * strictly following the UI handoff specification.
 *
 * Rules:
 * - The Backend remains authoritative for every access decision.
 * - UI never infers ALLOWED from a face match alone.
 * - MATCHED + ALLOWED -> Green result; enables Security Officer to record IN/OUT.
 * - MATCHED + DENIED -> Red result with safe reason; no QR fallback.
 * - MATCHED + MANUAL_REVIEW -> Neutral/amber manual review; no automatic access.
 * - UNKNOWN, LOW_CONFIDENCE, QUALITY_FAILED, AI_UNAVAILABLE -> Neutral failure state; exposes QR fallback.
 * - Network/upload error -> Retry state; do not show cached successful result.
 */
export function resolveGateUiState(params: {
  technicalOutcome?: FaceVerificationTechnicalOutcome | null;
  authorization?: GateAuthorizationOutcome | null;
  isNetworkError?: boolean;
}): GateUiState {
  if (params.isNetworkError) {
    return {
      type: 'RETRY',
      get label() {
        return tr('face_gate_utils.network_connection_error');
      },
      badgeClass: 'bg-red-100 text-red-800 border-red-200',
      panelClass: 'border-red-200 bg-red-50/70',
      canRecordInOut: false,
      canUseQrFallback: false,
      isRetry: true,
      safeDescription: tr(
        'face_gate_utils.cannot_verify_with_backend_service_please_check_network_connection_and_retry_scan',
      ),
    };
  }

  const { technicalOutcome, authorization } = params;

  // Unknown / Low confidence / Quality failed / AI unavailable -> Fallback required
  if (
    technicalOutcome === 'UNKNOWN' ||
    technicalOutcome === 'LOW_CONFIDENCE' ||
    technicalOutcome === 'QUALITY_FAILED' ||
    technicalOutcome === 'AI_UNAVAILABLE'
  ) {
    return {
      type: 'FALLBACK_REQUIRED',
      get label() {
        return technicalOutcome === 'AI_UNAVAILABLE'
          ? tr('common.ai_service_unavailable')
          : tr('common.face_verification_inconclusive');
      },
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
      panelClass: 'border-amber-200 bg-amber-50/70',
      canRecordInOut: false,
      canUseQrFallback: true,
      isRetry: false,
      safeDescription: tr(
        'face_gate_utils.face_scan_was_inconclusive_please_request_the_worker_to_present_their_dynamic_qr_c',
      ),
    };
  }

  // MATCHED + ALLOWED -> Green
  if (technicalOutcome === 'MATCHED' && authorization === 'ALLOWED') {
    return {
      type: 'ALLOWED',
      get label() {
        return tr('common.access_granted');
      },
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      panelClass: 'border-emerald-200 bg-emerald-50/70',
      canRecordInOut: true,
      canUseQrFallback: false,
      isRetry: false,
      safeDescription: tr(
        'face_gate_utils.worker_identity_and_site_zone_assignment_verified_security_officer_may_record_in_o',
      ),
    };
  }

  // MATCHED + DENIED -> Red
  if (technicalOutcome === 'MATCHED' && authorization === 'DENIED') {
    return {
      type: 'DENIED',
      get label() {
        return tr('common.access_denied');
      },
      badgeClass: 'bg-red-100 text-red-800 border-red-200',
      panelClass: 'border-red-200 bg-red-50/70',
      canRecordInOut: false,
      canUseQrFallback: false,
      isRetry: false,
      safeDescription: tr(
        'face_gate_utils.access_denied_by_backend_policy_qr_fallback_is_not_permitted_for_denied_credential',
      ),
    };
  }

  // MATCHED + MANUAL_REVIEW -> Amber / Neutral
  if (technicalOutcome === 'MATCHED' && authorization === 'MANUAL_REVIEW') {
    return {
      type: 'MANUAL_REVIEW',
      get label() {
        return tr('common.manual_review_required');
      },
      badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
      panelClass: 'border-blue-200 bg-blue-50/70',
      canRecordInOut: false,
      canUseQrFallback: false,
      isRetry: false,
      safeDescription: tr(
        'face_gate_utils.worker_record_flagged_for_manual_inspection_security_officer_must_perform_manual_i',
      ),
    };
  }

  // Default fallback state if data is incomplete
  return {
    type: 'FALLBACK_REQUIRED',
    get label() {
      return tr('common.awaiting_scan');
    },
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    panelClass: 'border-slate-200 bg-slate-50',
    canRecordInOut: false,
    canUseQrFallback: false,
    isRetry: false,
    safeDescription: tr(
      'face_gate_utils.position_face_in_frame_and_click_scan_face_to_verify_identity_and_access_rights',
    ),
  };
}

/**
 * Returns safe, human-readable reason text without surfacing raw embeddings
 * or raw similarity scores to the UI.
 */
export function getSafeReasonMessage(code?: FaceGateReasonCode | string | null): string {
  switch (code) {
    case 'NO_SCHEDULE':
      return tr('face_gate_utils.you_have_not_been_assigned_a_work_shift_for_today');
    case 'MATCH_CONFIRMED':
    case 'VALID_ASSIGNMENT':
      return tr('face_gate_utils.identity_confirmed_and_active_site_assignment_verified');
    case 'UNKNOWN_FACE':
      return tr(
        'face_gate_utils.no_enrolled_face_profile_matched_in_the_active_workforce_database',
      );
    case 'FACE_CONFIDENCE_LOW':
      return tr(
        'face_gate_utils.face_match_confidence_is_below_security_threshold_please_align_clearly_or_use_qr_f',
      );
    case 'FACE_QUALITY_FAILED':
      return tr(
        'face_gate_utils.image_quality_or_lighting_insufficient_ensure_adequate_front_facing_light_without',
      );
    case 'FACE_SERVICE_UNAVAILABLE':
      return tr('face_gate_utils.biometric_recognition_service_is_temporarily_unreachable');
    case 'AUTHORIZATION_UNAVAILABLE':
    case 'AUTHORIZATION_DATA_UNAVAILABLE':
      return tr(
        'face_gate_utils.authorization_policy_service_is_unreachable_automatic_clearance_cannot_be_determin',
      );
    case 'WORKER_INACTIVE':
      return tr('face_gate_utils.worker_profile_status_is_deactivated');
    case 'CONTRACTOR_INACTIVE':
      return tr('face_gate_utils.contractor_company_is_currently_deactivated');
    case 'CONTRACTOR_SITE_PARTICIPATION_INVALID':
      return tr(
        'face_gate_utils.contractor_participation_for_this_construction_site_is_inactive_or_expired',
      );
    case 'FACE_PROFILE_REVOKED':
      return tr('face_gate_utils.worker_biometric_profile_has_been_revoked_re_enrollment_required');
    case 'FACE_PROFILE_REENROLL_REQUIRED':
      return tr(
        'face_gate_utils.face_profile_requires_re_enrollment_due_to_policy_or_model_update',
      );
    case 'ASSIGNMENT_MISSING':
      return tr(
        'face_gate_utils.worker_does_not_have_an_approved_site_zone_assignment_for_this_gate',
      );
    case 'ASSIGNMENT_NOT_APPROVED':
      return tr(
        'face_gate_utils.site_zone_assignment_request_is_pending_and_has_not_been_approved_by_site_manager',
      );
    case 'ASSIGNMENT_EXPIRED':
      return tr('face_gate_utils.approved_site_assignment_validity_period_has_expired');
    case 'SITE_MISMATCH':
    case 'GATE_MISMATCH':
      return tr('face_gate_utils.worker_is_not_authorized_for_this_specific_site');
    default:
      return code
        ? tr('face_gate_utils.access_could_not_be_verified_please_contact_the_site_gate_operator')
        : tr('common.verification_result_recorded');
  }
}

/**
 * Captures exactly one explicit frame from an HTMLVideoElement and converts to JPEG Blob.
 * Validates maximum file size client-side for UX.
 */
export async function captureFrameBlob(
  video: HTMLVideoElement,
  options: { maxWidth?: number; quality?: number; maxBytes?: number } = {},
): Promise<Blob> {
  const { maxWidth = 1280, quality = 0.9, maxBytes = 4 * 1024 * 1024 } = options;

  if (video.videoWidth === 0 || video.videoHeight === 0) {
    throw new Error(tr('face_gate_utils.camera_feed_is_not_ready_or_has_zero_dimensions'));
  }

  const canvas = document.createElement('canvas');
  let width = video.videoWidth;
  let height = video.videoHeight;

  if (width > maxWidth) {
    height = Math.round((height * maxWidth) / width);
    width = maxWidth;
  }

  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error(tr('face_gate_utils.canvas_2d_context_could_not_be_created'));
  }

  context.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });

  if (!blob) {
    throw new Error(tr('face_gate_utils.failed_to_generate_image_blob_from_video_frame'));
  }

  if (blob.size > maxBytes) {
    throw new Error(
      tr('face_gate_utils.captured_frame_size_valuemb_exceeds_limit', {
        value1: (blob.size / (1024 * 1024)).toFixed(1),
      }),
    );
  }

  return blob;
}

/**
 * In-memory Object URL lifecycle management.
 * Revokes the previous URL to prevent memory leaks and never stores blobs in localStorage/sessionStorage.
 */
export function createSafePreviewUrl(blob: Blob, previousUrl?: string | null): string {
  if (previousUrl) {
    try {
      URL.revokeObjectURL(previousUrl);
    } catch {
      // Ignore URL revocation errors
    }
  }
  return URL.createObjectURL(blob);
}

export function revokeSafePreviewUrl(url?: string | null): void {
  if (url) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore URL revocation errors
    }
  }
}
