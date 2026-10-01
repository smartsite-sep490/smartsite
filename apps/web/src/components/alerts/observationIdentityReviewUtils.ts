import {
  ApiError,
  type ObservationIdentityContextResponse,
  type ObservationIdentityDecisionCommand,
} from '@smartsite/api-client';

export type ObservationIdentitySubjectResponse =
  ObservationIdentityContextResponse['subjects'][number];
export type ObservationIdentityResolveBlockReason =
  ObservationIdentitySubjectResponse['resolveBlockReason'];
export type ObservationIdentityClearBlockReason =
  ObservationIdentitySubjectResponse['clearBlockReason'];

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type ObservationIdentityCommandInput = DistributiveOmit<
  ObservationIdentityDecisionCommand,
  'commandId'
>;

export interface ObservationIdentityCommandScope {
  apiUrl: string;
  sessionScope: string;
  siteId: string;
  alertId: string;
  eventId: string;
  personObservationIndex: number;
}

const MAX_BLOB_SIZE_BYTES = 1048576; // 1 MiB

/**
 * Calculates SHA-256 of the viewed evidence JPEG Blob using the Web Crypto API.
 * Enforces maximum size <= 1MiB, non-empty, and exact image/jpeg MIME type.
 * Error messages use user-facing terms without technical jargon like Blob or MIME.
 */
export async function computeViewedEvidenceSha256(blob: Blob): Promise<string> {
  if (blob.size === 0) {
    throw new Error('Ảnh bằng chứng không có dữ liệu.');
  }

  if (blob.size > MAX_BLOB_SIZE_BYTES) {
    throw new Error('Ảnh bằng chứng vượt quá dung lượng cho phép (tối đa 1MB).');
  }

  const mime = blob.type.toLowerCase();
  if (mime !== 'image/jpeg') {
    throw new Error('Định dạng ảnh bằng chứng không hợp lệ (yêu cầu định dạng JPEG).');
  }

  const buffer = await blob.arrayBuffer();
  const digestBuffer = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(digestBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Builds TanStack Query cache key for identity context.
 * Strict cache isolation: includes apiUrl, sessionScope, siteId, alertId, eventId.
 * Never includes authorization tokens.
 */
export function buildObservationIdentityContextQueryKey(
  apiUrl: string,
  sessionScope: string,
  siteId: string,
  alertId: string,
  eventId: string,
) {
  return ['observation-identity-context', apiUrl, sessionScope, siteId, alertId, eventId] as const;
}

/**
 * Builds TanStack Query cache key for worker directory lookup.
 * Scoped by apiUrl, sessionScope, siteId, alertId, eventId and pagination.
 */
export function buildObservationIdentityWorkersQueryKey(
  apiUrl: string,
  sessionScope: string,
  siteId: string,
  alertId: string,
  eventId: string,
  offset = 0,
  limit = 20,
) {
  return [
    'observation-identity-workers',
    apiUrl,
    sessionScope,
    siteId,
    alertId,
    eventId,
    offset,
    limit,
  ] as const;
}

/**
 * Builds TanStack Query cache key for decisions audit history.
 * Scoped by subject key (eventId, personObservationIndex).
 */
export function buildObservationIdentityDecisionsQueryKey(
  apiUrl: string,
  sessionScope: string,
  siteId: string,
  alertId: string,
  eventId: string,
  personObservationIndex: number,
  offset = 0,
  limit = 20,
) {
  return [
    'observation-identity-decisions',
    apiUrl,
    sessionScope,
    siteId,
    alertId,
    eventId,
    personObservationIndex,
    offset,
    limit,
  ] as const;
}

export interface ReasonValidationResult {
  valid: boolean;
  error?: string;
  trimmed: string;
}

/**
 * Validates reason input: 5..1000 Unicode code points after trimming.
 * Checks for null bytes or unpaired surrogates.
 */
export function validateReason(reason: string): ReasonValidationResult {
  const trimmed = reason.trim();
  const codePoints = Array.from(trimmed).length;

  if (
    trimmed.includes('\u0000') ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(trimmed)
  ) {
    return {
      valid: false,
      error: 'Reason contains invalid characters.',
      trimmed,
    };
  }

  if (codePoints < 5) {
    return {
      valid: false,
      error: 'Reason must be at least 5 characters after trimming.',
      trimmed,
    };
  }

  if (codePoints > 1000) {
    return {
      valid: false,
      error: 'Reason must not exceed 1000 characters.',
      trimmed,
    };
  }

  return {
    valid: true,
    trimmed,
  };
}

export interface CommandStateTracker {
  signature: string;
  commandId: string;
}

/**
 * Creates a normalized signature string incorporating full subject/session scope
 * and command inputs with normalized UUID case and trimmed reason.
 */
export function computeCommandSignature(
  scope: ObservationIdentityCommandScope,
  command: ObservationIdentityCommandInput,
): string {
  const normalizedScope = {
    apiUrl: scope.apiUrl.trim(),
    sessionScope: scope.sessionScope.trim(),
    siteId: scope.siteId.trim().toLowerCase(),
    alertId: scope.alertId.trim().toLowerCase(),
    eventId: scope.eventId.trim().toLowerCase(),
    personObservationIndex: scope.personObservationIndex,
  };

  if (command.action === 'RESOLVE') {
    return JSON.stringify({
      scope: normalizedScope,
      action: 'RESOLVE',
      expectedRevision: command.expectedRevision,
      expectedEventHash: command.expectedEventHash.trim().toLowerCase(),
      reason: command.reason.trim(),
      workerId: command.workerId.trim().toLowerCase(),
      evidenceIndex: command.evidenceIndex,
      expectedEvidenceSha256: command.expectedEvidenceSha256.trim().toLowerCase(),
    });
  }

  return JSON.stringify({
    scope: normalizedScope,
    action: 'CLEAR',
    expectedRevision: command.expectedRevision,
    expectedEventHash: command.expectedEventHash.trim().toLowerCase(),
    reason: command.reason.trim(),
    workerId: null,
    evidenceIndex: null,
    expectedEvidenceSha256: null,
  });
}

/**
 * Returns existing commandId if identical scope and parameters are re-sent (transport retry),
 * or generates a new UUIDv4 if any scope or parameter changes.
 */
export function getOrGenerateCommandId(
  prev: CommandStateTracker | null,
  scope: ObservationIdentityCommandScope,
  command: ObservationIdentityCommandInput,
): CommandStateTracker {
  const currentSignature = computeCommandSignature(scope, command);
  if (prev && prev.signature === currentSignature) {
    return prev;
  }
  return {
    signature: currentSignature,
    commandId: globalThis.crypto.randomUUID(),
  };
}

export interface BoxOverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
  renderedWidth: number;
  renderedHeight: number;
  offsetX: number;
  offsetY: number;
  valid: boolean;
}

/**
 * Computes exact pixel overlay coordinates from normalized box coordinates [0, 1]
 * with object-contain letterboxing/pillarboxing offset compensation.
 * Rejects nonpositive dimensions, NaN/Infinity, or invalid/inverted boxes.
 */
export function computeBoxOverlayRect(
  box: { x1: number; y1: number; x2: number; y2: number } | null | undefined,
  naturalWidth: number,
  naturalHeight: number,
  containerWidth: number,
  containerHeight: number,
): BoxOverlayRect {
  const invalidResult: BoxOverlayRect = {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    renderedWidth: 0,
    renderedHeight: 0,
    offsetX: 0,
    offsetY: 0,
    valid: false,
  };

  if (
    !box ||
    typeof box.x1 !== 'number' ||
    typeof box.y1 !== 'number' ||
    typeof box.x2 !== 'number' ||
    typeof box.y2 !== 'number' ||
    !Number.isFinite(box.x1) ||
    !Number.isFinite(box.y1) ||
    !Number.isFinite(box.x2) ||
    !Number.isFinite(box.y2) ||
    box.x1 < 0 ||
    box.y1 < 0 ||
    box.x2 > 1 ||
    box.y2 > 1 ||
    box.x1 >= box.x2 ||
    box.y1 >= box.y2
  ) {
    return invalidResult;
  }

  if (
    typeof naturalWidth !== 'number' ||
    typeof naturalHeight !== 'number' ||
    typeof containerWidth !== 'number' ||
    typeof containerHeight !== 'number' ||
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    !Number.isFinite(containerWidth) ||
    !Number.isFinite(containerHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0 ||
    containerWidth <= 0 ||
    containerHeight <= 0
  ) {
    return invalidResult;
  }

  const imgAspect = naturalWidth / naturalHeight;
  const contAspect = containerWidth / containerHeight;

  let renderedWidth: number;
  let renderedHeight: number;
  let offsetX: number;
  let offsetY: number;

  if (contAspect > imgAspect) {
    // Container is wider than image -> pillarboxing (bars left/right)
    renderedHeight = containerHeight;
    renderedWidth = containerHeight * imgAspect;
    offsetX = (containerWidth - renderedWidth) / 2;
    offsetY = 0;
  } else {
    // Container is taller than image -> letterboxing (bars top/bottom)
    renderedWidth = containerWidth;
    renderedHeight = containerWidth / imgAspect;
    offsetX = 0;
    offsetY = (containerHeight - renderedHeight) / 2;
  }

  const left = offsetX + box.x1 * renderedWidth;
  const top = offsetY + box.y1 * renderedHeight;
  const width = (box.x2 - box.x1) * renderedWidth;
  const height = (box.y2 - box.y1) * renderedHeight;

  return {
    left,
    top,
    width,
    height,
    renderedWidth,
    renderedHeight,
    offsetX,
    offsetY,
    valid: true,
  };
}

/**
 * Human-readable Vietnamese formatting for backend error messages.
 */
export function formatIdentityErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const rawMessage = error.message || error.backendError?.message || '';
    if (rawMessage.includes('Observation identity revision is stale')) {
      return 'Phiên bản xem xét đã thay đổi bởi người khác. Vui lòng làm mới dữ liệu và xem lại.';
    }
    if (rawMessage.includes('Worker is inactive')) {
      return 'Nhân viên đã ngừng hoạt động trên công trường. Vui lòng chọn nhân viên khác.';
    }
    if (error.status === 409 || error.backendError?.code === 'CONFLICT') {
      return 'Xung đột dữ liệu hoặc phiên bản đã cũ. Vui lòng làm mới và thử lại.';
    }
    if (
      error.status === 403 ||
      error.backendError?.code === 'FORBIDDEN' ||
      rawMessage.toLowerCase().includes('forbidden') ||
      (error.code as string) === 'forbidden'
    ) {
      return 'Bạn không có thẩm quyền thực hiện thao tác nhận diện tại công trường này.';
    }
    if (error.status === 404 || error.backendError?.code === 'NOT_FOUND') {
      return 'Không tìm thấy đối tượng hoặc bằng chứng được yêu cầu.';
    }
    if (error.status === 503 || error.backendError?.code === 'SERVICE_UNAVAILABLE') {
      return 'Dịch vụ nhận diện tạm thời không khả dụng. Vui lòng thử lại sau.';
    }
    return rawMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Đã xảy ra lỗi không xác định trong quá trình xử lý nhận diện.';
}

/**
 * Formats resolve block reasons in clear human-readable Vietnamese.
 */
export function formatResolveBlockReason(
  reason: ObservationIdentityResolveBlockReason | null,
): string {
  if (!reason) return '';
  switch (reason) {
    case 'FRAME_UNAVAILABLE':
      return 'Ảnh bằng chứng (full frame) không khả dụng hoặc đã hết hạn trên hệ thống lưu trữ.';
    case 'EVENT_INCONSISTENT':
      return 'Dữ liệu sự kiện không nhất quán với bằng chứng gốc.';
    case 'SUBJECT_UNAVAILABLE':
      return 'Đối tượng không khả dụng để xác minh.';
    case 'WORKER_READER_UNAVAILABLE':
      return 'Hệ thống danh bạ nhân viên tạm thời không khả dụng.';
    case 'REVISION_EXHAUSTED':
      return 'Đã đạt giới hạn tối đa số lần sửa đổi cho đối tượng này.';
    case 'STATE_INCONSISTENT':
      return 'Trạng thái nhận diện không nhất quán để xác nhận.';
    default:
      return 'Không thể xác nhận danh tính đối tượng vào thời điểm này.';
  }
}

/**
 * Formats clear block reasons in clear human-readable Vietnamese.
 */
export function formatClearBlockReason(reason: ObservationIdentityClearBlockReason | null): string {
  if (!reason) return '';
  switch (reason) {
    case 'NO_ACTIVE_RESOLUTION':
      return 'Chưa có quyết định xác minh thủ công nào đang hoạt động để thu hồi.';
    case 'STATE_INCONSISTENT':
      return 'Trạng thái nhận diện không nhất quán để thu hồi.';
    case 'REVISION_EXHAUSTED':
      return 'Đã đạt giới hạn tối đa số lần sửa đổi cho đối tượng này.';
    default:
      return 'Không thể thu hồi quyết định nhận diện vào thời điểm này.';
  }
}

/**
 * Formats technical identity status badge.
 */
export function formatTechnicalStatus(
  status: 'CANDIDATE' | 'UNKNOWN' | 'UNAVAILABLE' | 'CONFLICTED',
): string {
  switch (status) {
    case 'CANDIDATE':
      return 'Gợi ý AI';
    case 'UNKNOWN':
      return 'Chưa xác định';
    case 'UNAVAILABLE':
      return 'Không khả dụng';
    case 'CONFLICTED':
      return 'Xung đột kỹ thuật';
  }
}
