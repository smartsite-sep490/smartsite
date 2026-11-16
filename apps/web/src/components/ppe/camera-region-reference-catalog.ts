import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const CAMERA_REGION_REFERENCE_EN = {
  'regionSetup.validation.alreadySaved': 'This polygon draft has already been saved.',
  'regionSetup.error.referenceExpired':
    'Configuration reference image has expired. Review and accept a new reference image before saving.',
  'regionSetup.error.cancelled': 'Operation cancelled.',
  'regionSetup.error.cameraChangedOrInactive':
    'Camera metadata changed or became inactive. Operation cancelled.',
  'regionSetup.error.wrongScope':
    'Region was created with an unexpected camera or zone scope. Please refresh.',
  'regionSetup.reference.heading': 'Authoring Reference Image',
  'regionSetup.reference.purposeNote':
    'Obtains a frozen camera frame for region authoring only. Does not run AI inference or live compliance monitoring.',
  'regionSetup.reference.detailsDisclosure': 'Reference details & timestamps',
  'regionSetup.reference.getBtn': 'Get configuration image',
  'regionSetup.reference.loadingBtn': 'Loading configuration image…',
  'regionSetup.reference.reviewNewBtn': 'Review new reference',
  'regionSetup.reference.loadingCandidateBtn': 'Loading new reference…',
  'regionSetup.reference.capturedAt': 'Captured: {time}',
  'regionSetup.reference.expiresAt': 'Expires: {time}',
  'regionSetup.reference.revisionBadge': 'Config v{version}',
  'regionSetup.reference.expiredBadge': 'Expired',
  'regionSetup.reference.noneLoadedHint':
    'Request a configuration image for the selected active camera before drawing or editing a region.',
  'regionSetup.reference.expiredHint':
    'The configuration reference image has expired. Request a fresh configuration image to continue.',
  'regionSetup.reference.revisionChangedHint':
    'Camera configuration changed (now v{version}). Request a fresh configuration image to continue.',
  'regionSetup.reference.candidateHeading': 'Review Candidate Reference Image',
  'regionSetup.reference.candidateDescription':
    'Inspect how your current draft points align on the new reference frame (v{version}) before replacing the active reference.',
  'regionSetup.reference.candidateCanvasAria': 'Candidate Reference Preview Canvas',
  'regionSetup.reference.candidateExpiredNotice':
    'Candidate reference image has expired. Request another reference image to review.',
  'regionSetup.reference.useNewBtn': 'Use new reference',
  'regionSetup.reference.cancelReviewBtn': 'Keep current reference',
  'regionSetup.reference.confirmViewCheckboxLabel':
    'I checked that the drawn region matches this reference image',
  'regionSetup.reference.error.401':
    'Session expired or unauthorized. Please sign in again to load a configuration image.',
  'regionSetup.reference.error.403':
    'You do not have permission to request a camera configuration image.',
  'regionSetup.reference.error.404':
    'Camera configuration image source was not found for this scope.',
  'regionSetup.reference.error.409':
    'Camera configuration changed while loading the reference image. Please request a fresh image.',
  'regionSetup.reference.error.429':
    'Too many configuration image requests. Please wait before trying again.',
  'regionSetup.reference.error.503':
    'Camera configuration image source is currently unavailable. Verify that the capture observer is active and try again.',
  'regionSetup.reference.error.timeout': 'Configuration image request timed out. Please try again.',
  'regionSetup.reference.error.default':
    'Could not load camera configuration image. Please try again.',
} as const;

const CAMERA_REGION_REFERENCE_VI: Record<keyof typeof CAMERA_REGION_REFERENCE_EN, string> = {
  'regionSetup.validation.alreadySaved': 'Bản nháp đa giác này đã được lưu trước đó.',
  'regionSetup.error.referenceExpired':
    'Ảnh tham chiếu cấu hình đã hết hạn. Vui lòng xem xét và xác nhận ảnh tham chiếu mới trước khi lưu.',
  'regionSetup.error.cancelled': 'Đã hủy thao tác.',
  'regionSetup.error.cameraChangedOrInactive':
    'Siêu dữ liệu camera đã thay đổi hoặc camera ngừng hoạt động. Đã hủy thao tác.',
  'regionSetup.error.wrongScope':
    'Vùng quan sát được tạo với phạm vi camera hoặc khu vực không khớp. Vui lòng làm mới.',
  'regionSetup.reference.heading': 'Ảnh tham chiếu cấu hình vùng quan sát',
  'regionSetup.reference.purposeNote':
    'Lấy khung hình camera tĩnh chỉ phục vụ vẽ vùng quan sát. Không chạy suy luận AI hay giám sát tuân thủ trực tiếp.',
  'regionSetup.reference.detailsDisclosure': 'Chi tiết & thời gian ảnh tham chiếu',
  'regionSetup.reference.getBtn': 'Lấy ảnh cấu hình',
  'regionSetup.reference.loadingBtn': 'Đang tải ảnh cấu hình…',
  'regionSetup.reference.reviewNewBtn': 'Xem xét ảnh tham chiếu mới',
  'regionSetup.reference.loadingCandidateBtn': 'Đang tải ảnh tham chiếu mới…',
  'regionSetup.reference.capturedAt': 'Chụp lúc: {time}',
  'regionSetup.reference.expiresAt': 'Hết hạn: {time}',
  'regionSetup.reference.revisionBadge': 'Cấu hình v{version}',
  'regionSetup.reference.expiredBadge': 'Đã hết hạn',
  'regionSetup.reference.noneLoadedHint':
    'Hãy lấy ảnh cấu hình cho camera đang hoạt động đã chọn trước khi vẽ hoặc sửa vùng quan sát.',
  'regionSetup.reference.expiredHint':
    'Ảnh tham chiếu cấu hình đã hết hạn. Hãy lấy ảnh cấu hình mới để tiếp tục.',
  'regionSetup.reference.revisionChangedHint':
    'Cấu hình camera đã thay đổi (hiện là v{version}). Hãy lấy ảnh cấu hình mới để tiếp tục.',
  'regionSetup.reference.candidateHeading': 'Xem xét ảnh tham chiếu ứng viên mới',
  'regionSetup.reference.candidateDescription':
    'Kiểm tra vị trí các điểm nháp hiện tại trên khung hình tham chiếu mới (v{version}) trước khi thay thế ảnh tham chiếu đang dùng.',
  'regionSetup.reference.candidateCanvasAria': 'Khung xem trước ảnh tham chiếu ứng viên',
  'regionSetup.reference.candidateExpiredNotice':
    'Ảnh tham chiếu ứng viên đã hết hạn. Hãy tải ảnh tham chiếu khác để xem xét.',
  'regionSetup.reference.useNewBtn': 'Sử dụng ảnh tham chiếu mới',
  'regionSetup.reference.cancelReviewBtn': 'Giữ ảnh tham chiếu hiện tại',
  'regionSetup.reference.confirmViewCheckboxLabel':
    'Tôi đã kiểm tra vùng vừa vẽ khớp với ảnh tham chiếu này',
  'regionSetup.reference.error.401':
    'Phiên làm việc đã hết hạn hoặc chưa được xác thực. Vui lòng đăng nhập lại để tải ảnh cấu hình.',
  'regionSetup.reference.error.403': 'Bạn không có quyền yêu cầu ảnh cấu hình camera.',
  'regionSetup.reference.error.404': 'Không tìm thấy nguồn ảnh cấu hình camera cho phạm vi này.',
  'regionSetup.reference.error.409':
    'Cấu hình camera đã thay đổi trong lúc tải ảnh tham chiếu. Vui lòng yêu cầu lại ảnh mới.',
  'regionSetup.reference.error.429':
    'Quá nhiều yêu cầu tải ảnh cấu hình. Vui lòng chờ trước khi thử lại.',
  'regionSetup.reference.error.503':
    'Nguồn ảnh cấu hình camera hiện không khả dụng. Hãy kiểm tra tiến trình thu hình và thử lại.',
  'regionSetup.reference.error.timeout':
    'Yêu cầu tải ảnh cấu hình đã quá thời gian chờ. Vui lòng thử lại.',
  'regionSetup.reference.error.default': 'Không thể tải ảnh cấu hình camera. Vui lòng thử lại.',
};

export type CameraRegionReferenceCatalogKey = keyof typeof CAMERA_REGION_REFERENCE_EN;

export type CameraRegionReferenceErrorKey =
  | 'regionSetup.reference.error.401'
  | 'regionSetup.reference.error.403'
  | 'regionSetup.reference.error.404'
  | 'regionSetup.reference.error.409'
  | 'regionSetup.reference.error.429'
  | 'regionSetup.reference.error.503'
  | 'regionSetup.reference.error.timeout'
  | 'regionSetup.reference.error.default';

export function registerCameraRegionReferenceCatalog(): void {
  registerFeatureCatalog({
    en: CAMERA_REGION_REFERENCE_EN,
    vi: CAMERA_REGION_REFERENCE_VI,
  });
}

registerCameraRegionReferenceCatalog();
