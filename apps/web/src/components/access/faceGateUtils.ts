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
      label: 'Network / Connection Error',
      badgeClass: 'bg-red-100 text-red-800 border-red-200',
      panelClass: 'border-red-200 bg-red-50/70',
      canRecordInOut: false,
      canUseQrFallback: false,
      isRetry: true,
      safeDescription:
        'Cannot verify with backend service. Please check network connection and retry scan.',
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
      label:
        technicalOutcome === 'AI_UNAVAILABLE'
          ? 'AI Service Unavailable'
          : 'Face Verification Inconclusive',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
      panelClass: 'border-amber-200 bg-amber-50/70',
      canRecordInOut: false,
      canUseQrFallback: true,
      isRetry: false,
      safeDescription:
        'Face scan was inconclusive. Please request the Worker to present their dynamic QR code for fallback verification.',
    };
  }

  // MATCHED + ALLOWED -> Green
  if (technicalOutcome === 'MATCHED' && authorization === 'ALLOWED') {
    return {
      type: 'ALLOWED',
      label: 'Access Granted',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      panelClass: 'border-emerald-200 bg-emerald-50/70',
      canRecordInOut: true,
      canUseQrFallback: false,
      isRetry: false,
      safeDescription:
        'Worker identity and site zone assignment verified. Security Officer may record IN or OUT.',
    };
  }

  // MATCHED + DENIED -> Red
  if (technicalOutcome === 'MATCHED' && authorization === 'DENIED') {
    return {
      type: 'DENIED',
      label: 'Access Denied',
      badgeClass: 'bg-red-100 text-red-800 border-red-200',
      panelClass: 'border-red-200 bg-red-50/70',
      canRecordInOut: false,
      canUseQrFallback: false,
      isRetry: false,
      safeDescription:
        'Access denied by backend policy. QR fallback is not permitted for denied credentials.',
    };
  }

  // MATCHED + MANUAL_REVIEW -> Amber / Neutral
  if (technicalOutcome === 'MATCHED' && authorization === 'MANUAL_REVIEW') {
    return {
      type: 'MANUAL_REVIEW',
      label: 'Manual Review Required',
      badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
      panelClass: 'border-blue-200 bg-blue-50/70',
      canRecordInOut: false,
      canUseQrFallback: false,
      isRetry: false,
      safeDescription:
        'Worker record flagged for manual inspection. Security Officer must perform manual identity review before granting clearance.',
    };
  }

  // Default fallback state if data is incomplete
  return {
    type: 'FALLBACK_REQUIRED',
    label: 'Awaiting Scan',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    panelClass: 'border-slate-200 bg-slate-50',
    canRecordInOut: false,
    canUseQrFallback: false,
    isRetry: false,
    safeDescription:
      'Position face in frame and click "Scan face" to verify identity and access rights.',
  };
}

/**
 * Returns safe, human-readable reason text without surfacing raw embeddings
 * or raw similarity scores to the UI.
 */
export function getSafeReasonMessage(code?: FaceGateReasonCode | string | null): string {
  switch (code) {
    case 'MATCH_CONFIRMED':
    case 'VALID_ASSIGNMENT':
      return 'Identity confirmed and active site assignment verified.';
    case 'UNKNOWN_FACE':
      return 'No enrolled face profile matched in the active workforce database.';
    case 'FACE_CONFIDENCE_LOW':
      return 'Face match confidence is below security threshold. Please align clearly or use QR fallback.';
    case 'FACE_QUALITY_FAILED':
      return 'Image quality or lighting insufficient. Ensure adequate front-facing light without occlusion.';
    case 'FACE_SERVICE_UNAVAILABLE':
      return 'Biometric recognition service is temporarily unreachable.';
    case 'AUTHORIZATION_UNAVAILABLE':
    case 'AUTHORIZATION_DATA_UNAVAILABLE':
      return 'Authorization policy service is unreachable. Automatic clearance cannot be determined.';
    case 'WORKER_INACTIVE':
      return 'Worker profile status is deactivated.';
    case 'CONTRACTOR_INACTIVE':
      return 'Contractor company is currently deactivated.';
    case 'CONTRACTOR_SITE_PARTICIPATION_INVALID':
      return 'Contractor participation for this construction site is inactive or expired.';
    case 'FACE_PROFILE_REVOKED':
      return 'Worker biometric profile has been revoked. Re-enrollment required.';
    case 'FACE_PROFILE_REENROLL_REQUIRED':
      return 'Face profile requires re-enrollment due to policy or model update.';
    case 'ASSIGNMENT_MISSING':
      return 'Worker does not have an approved site zone assignment for this gate.';
    case 'ASSIGNMENT_NOT_APPROVED':
      return 'Site zone assignment request is pending and has not been approved by Site Manager.';
    case 'ASSIGNMENT_EXPIRED':
      return 'Approved site assignment validity period has expired.';
    case 'SITE_MISMATCH':
    case 'GATE_MISMATCH':
      return 'Worker is not authorized for this specific site.';
    default:
      return code ? `Decision code: ${code}` : 'Verification result recorded.';
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
    throw new Error('Camera feed is not ready or has zero dimensions.');
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
    throw new Error('Canvas 2D context could not be created.');
  }

  context.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });

  if (!blob) {
    throw new Error('Failed to generate image blob from video frame.');
  }

  if (blob.size > maxBytes) {
    throw new Error(
      `Captured frame size (${(blob.size / (1024 * 1024)).toFixed(1)}MB) exceeds limit.`,
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
