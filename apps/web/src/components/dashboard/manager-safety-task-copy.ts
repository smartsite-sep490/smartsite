import { ApiError } from '@smartsite/api-client';
import { sanitizeSafetyQueryId } from '../safety-episodes/safetyUrlParams';

export type C02TaskErrorKind =
  | 'feature-unavailable'
  | 'temporarily-unavailable'
  | 'unauthorized'
  | 'forbidden'
  | 'retriable-error';

export type CameraCheckErrorKind = 'unauthorized' | 'forbidden' | 'retriable-error';

export interface ManagerSafetyTaskCopy {
  panelTitle: string;
  panelSubtitle: (siteName?: string) => string;
  c02Heading: string;
  c02Loading: string;
  c02OpenCountBadge: (total: number) => string;
  c02EmptyBadge: string;
  c02EmptyBody: string;
  c02ShowingSubset: (shown: number, total: number) => string;
  c02DueLabel: (formattedDue: string) => string;
  c02SubjectTracked: string;
  c02SubjectSingle: string;
  c02TechnicalDetails: string;
  c02OpenQueueAction: string;
  c02RouteDisabledTitle: string;
  c02RouteDisabledBody: string;
  c02FeatureUnavailableTitle: string;
  c02FeatureUnavailableBody: string;
  c02TemporarilyUnavailableTitle: string;
  c02TemporarilyUnavailableBody: string;
  c02UnauthorizedBody: string;
  c02ForbiddenBody: string;
  c02ErrorTitle: string;
  c02RetryAction: string;
  cameraHeading: string;
  cameraLoading: string;
  cameraConfiguredBadge: (total: number) => string;
  cameraEmptyBadge: string;
  cameraEmptyPrompt: string;
  cameraConfiguredBody: string;
  cameraAllInactiveNote: string;
  cameraTruthfulnessNote: string;
  cameraEmptyAction: string;
  cameraConfiguredAction: string;
  cameraUnauthorizedBody: string;
  cameraForbiddenBody: string;
  cameraErrorTitle: string;
  cameraRetryAction: string;
}

const COPY_EN: ManagerSafetyTaskCopy = {
  panelTitle: 'Site operational tasks',
  panelSubtitle: (siteName) =>
    siteName
      ? `Scoped safety follow-up and camera setup for ${siteName}.`
      : 'Scoped safety follow-up and camera setup for the selected site.',
  c02Heading: 'Pending identification requests',
  c02Loading: 'Loading open identification requests...',
  c02OpenCountBadge: (total) => (total === 1 ? '1 open request' : `${total} open requests`),
  c02EmptyBadge: 'Queue clear',
  c02EmptyBody:
    'No open identification requests are waiting for a Site Manager response on this site.',
  c02ShowingSubset: (shown, total) =>
    `Previewing ${shown} pending ${shown === 1 ? 'item' : 'items'}; open the queue to review all ${total}.`,
  c02DueLabel: (formattedDue) => `Due ${formattedDue}`,
  c02SubjectTracked: 'Tracked episode',
  c02SubjectSingle: 'Single observation',
  c02TechnicalDetails: 'Technical reference',
  c02OpenQueueAction: 'Open identification queue',
  c02RouteDisabledTitle: 'Identification workspace is unavailable',
  c02RouteDisabledBody: 'Identification follow-up is not available from this screen right now.',
  c02FeatureUnavailableTitle: 'Identification requests are unavailable right now',
  c02FeatureUnavailableBody:
    'Open identification requests cannot be shown for this site right now. Contact an administrator if you expect pending requests here.',
  c02TemporarilyUnavailableTitle: 'Identification requests are temporarily unavailable',
  c02TemporarilyUnavailableBody:
    'This is a temporary interruption. Please retry in a moment to check open requests.',
  c02UnauthorizedBody:
    'Session expired while checking identification requests. Sign in again to continue.',
  c02ForbiddenBody: 'Access to identification requests is denied for this site.',
  c02ErrorTitle: 'Could not load open identification requests',
  c02RetryAction: 'Retry identification queue',
  cameraHeading: 'Camera & Zone Setup',
  cameraLoading: 'Checking configured cameras for this site...',
  cameraConfiguredBadge: (total) =>
    total === 1 ? '1 configured camera' : `${total} configured cameras`,
  cameraEmptyBadge: 'Setup needed',
  cameraEmptyPrompt:
    'No cameras are registered for this site yet. Open Camera & Zone Setup to register a camera source, capture a reference image, and configure observation regions and PPE rules.',
  cameraConfiguredBody:
    'Review registered camera sources, reference images, observation regions, and PPE rules for this site.',
  cameraAllInactiveNote:
    'Registered cameras on this site are currently inactive. Open setup to review or enable them.',
  cameraTruthfulnessNote:
    'Shows saved camera setup only; live video and active monitoring are not shown here.',
  cameraEmptyAction: 'Set up site cameras',
  cameraConfiguredAction: 'Open Camera & Zone Setup',
  cameraUnauthorizedBody: 'Session expired while checking site camera configuration.',
  cameraForbiddenBody: 'Access to camera configuration is denied for this site.',
  cameraErrorTitle: 'Could not check camera setup status',
  cameraRetryAction: 'Retry camera setup check',
};

const COPY_VI: ManagerSafetyTaskCopy = {
  panelTitle: 'Tác vụ vận hành công trường',
  panelSubtitle: (siteName) =>
    siteName
      ? `Xử lý xác minh an toàn và thiết lập camera theo phạm vi ${siteName}.`
      : 'Xử lý xác minh an toàn và thiết lập camera cho công trường đang chọn.',
  c02Heading: 'Yêu cầu xác minh chờ phản hồi',
  c02Loading: 'Đang tải yêu cầu xác minh đang mở...',
  c02OpenCountBadge: (total) => `${total} yêu cầu đang mở`,
  c02EmptyBadge: 'Không có yêu cầu mở',
  c02EmptyBody:
    'Chưa có yêu cầu xác minh đang mở nào cần Chỉ huy công trường phản hồi tại công trường này.',
  c02ShowingSubset: (shown, total) =>
    `Hiển thị nhanh ${shown} mục chờ phản hồi; mở hàng đợi để xem toàn bộ ${total} mục.`,
  c02DueLabel: (formattedDue) => `Hạn phản hồi: ${formattedDue}`,
  c02SubjectTracked: 'Chuỗi theo dõi',
  c02SubjectSingle: 'Quan sát đơn',
  c02TechnicalDetails: 'Mã tham chiếu kỹ thuật',
  c02OpenQueueAction: 'Mở hàng đợi xác minh',
  c02RouteDisabledTitle: 'Mục xác minh hiện không khả dụng',
  c02RouteDisabledBody: 'Chức năng xử lý yêu cầu xác minh hiện chưa mở trên màn hình này.',
  c02FeatureUnavailableTitle: 'Yêu cầu xác minh hiện không khả dụng',
  c02FeatureUnavailableBody:
    'Hiện chưa thể hiển thị yêu cầu xác minh cho công trường này. Vui lòng liên hệ quản trị viên nếu bạn đang chờ xử lý yêu cầu.',
  c02TemporarilyUnavailableTitle: 'Yêu cầu xác minh đang tạm thời gián đoạn',
  c02TemporarilyUnavailableBody:
    'Sự cố chỉ mang tính tạm thời. Vui lòng thử lại sau ít phút để kiểm tra yêu cầu đang mở.',
  c02UnauthorizedBody:
    'Phiên đăng nhập đã hết hạn khi kiểm tra yêu cầu xác minh. Vui lòng đăng nhập lại.',
  c02ForbiddenBody: 'Quyền truy cập yêu cầu xác minh bị từ chối đối với công trường này.',
  c02ErrorTitle: 'Không thể tải danh sách yêu cầu xác minh đang mở',
  c02RetryAction: 'Thử lại hàng đợi xác minh',
  cameraHeading: 'Thiết lập Camera & Khu vực',
  cameraLoading: 'Đang kiểm tra thiết lập camera của công trường...',
  cameraConfiguredBadge: (total) => `${total} camera đã cấu hình`,
  cameraEmptyBadge: 'Cần thiết lập',
  cameraEmptyPrompt:
    'Chưa có camera nào được đăng ký cho công trường này. Mở Thiết lập Camera & Khu vực để đăng ký nguồn camera, chụp ảnh tham chiếu và cấu hình vùng quan sát cùng quy tắc PPE.',
  cameraConfiguredBody:
    'Rà soát nguồn camera đã đăng ký, ảnh tham chiếu, vùng quan sát và quy tắc PPE của công trường này.',
  cameraAllInactiveNote:
    'Các camera đã đăng ký tại công trường này hiện đang tạm ngưng. Mở thiết lập để kiểm tra hoặc bật lại.',
  cameraTruthfulnessNote:
    'Chỉ hiển thị thiết lập camera đã lưu; không phát video trực tiếp hay xác nhận giám sát đang chạy tại đây.',
  cameraEmptyAction: 'Thiết lập camera công trường',
  cameraConfiguredAction: 'Mở Thiết lập Camera & Khu vực',
  cameraUnauthorizedBody: 'Phiên đăng nhập đã hết hạn khi kiểm tra thiết lập camera công trường.',
  cameraForbiddenBody: 'Quyền truy cập thiết lập camera bị từ chối đối với công trường này.',
  cameraErrorTitle: 'Không thể kiểm tra thiết lập camera',
  cameraRetryAction: 'Thử lại kiểm tra camera',
};

export function getManagerSafetyTaskCopy(language?: string | null): ManagerSafetyTaskCopy {
  const normalized = typeof language === 'string' ? language.trim().toLowerCase() : '';
  return normalized.startsWith('vi') ? COPY_VI : COPY_EN;
}

export function buildScopedIdentificationQueueHref(siteId: string): string | null {
  const safeSiteId = sanitizeSafetyQueryId(siteId);
  if (!safeSiteId) return null;
  const params = new URLSearchParams({
    tab: 'identification',
    siteId: safeSiteId,
  });
  return `/incidents?${params.toString()}`;
}

export function buildScopedCameraSetupHref(siteId: string): string | null {
  const safeSiteId = sanitizeSafetyQueryId(siteId);
  if (!safeSiteId) return null;
  const params = new URLSearchParams({
    siteId: safeSiteId,
  });
  return `/camera-setup?${params.toString()}`;
}

export function classifyC02TaskError(error: unknown): C02TaskErrorKind {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'feature-unavailable';
    if (error.status === 503) return 'temporarily-unavailable';
    if (error.status === 401) return 'unauthorized';
    if (error.status === 403) return 'forbidden';
  }
  return 'retriable-error';
}

export function isNonPollingC02Error(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status === 401 || error.status === 403 || error.status === 404;
}

export function classifyCameraCheckError(error: unknown): CameraCheckErrorKind {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'unauthorized';
    if (error.status === 403) return 'forbidden';
  }
  return 'retriable-error';
}

export function formatTaskDueTimestamp(
  iso: string | null | undefined,
  language?: string | null,
): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  const locale = language?.trim().toLowerCase().startsWith('vi') ? 'vi-VN' : 'en-US';
  return new Date(parsed).toLocaleString(locale, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
