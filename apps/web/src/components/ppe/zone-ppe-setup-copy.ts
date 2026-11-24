import type { PPE_FAMILY_CATALOG, PpeFamily } from '@smartsite/contracts/ppe-items';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const en = {
  'zoneSetup.title': 'Configure PPE by Zone',
  'zoneSetup.subtitlePrefix': 'Define mandatory PPE requirements for hazardous zones at',
  'zoneSetup.subtitleSuffix': '.',
  'zoneSetup.closeAria': 'Close',

  'zoneSetup.field.codeLabel': 'Zone Code',
  'zoneSetup.field.codePlaceholder': 'e.g. ZONE-HAZ-01',
  'zoneSetup.field.nameLabel': 'Zone Name',
  'zoneSetup.field.namePlaceholder': 'e.g. Scaffold Work Area',
  'zoneSetup.field.ppeLegend': 'Required PPE Selection',

  'zoneSetup.ppe.HARD_HAT': 'Hard Hat / Helmet',
  'zoneSetup.ppe.SAFETY_VEST': 'Safety Vest',
  'zoneSetup.ppe.GLOVES': 'Gloves',
  'zoneSetup.ppe.BOOTS': 'Boots',
  'zoneSetup.ppe.GOGGLES': 'Goggles',
  'zoneSetup.ppe.MASK': 'Mask',
  'zoneSetup.ppe.FULL_BODY_HARNESS': 'Full-body harness',
  'zoneSetup.ppe.LANYARD_HOOK': 'Lanyard hook',
  'zoneSetup.ppe.coreTag': '(Core)',
  'zoneSetup.ppe.experimentalTag': '(Experimental)',
  'zoneSetup.ppe.experimentalNote': 'Technical capability · experimental',
  'zoneSetup.ppe.notSelectableHeading':
    'Not selectable as a zone requirement yet ({{unsupportedCount}} of {{totalCount}} PPE types)',
  'zoneSetup.ppe.notSelectableBadge': 'Not selectable',
  'zoneSetup.ppe.semantics.PRESENT_ONLY': 'Presence only',
  'zoneSetup.ppe.semantics.CONTRACT_PENDING': 'Not configurable yet',
  'zoneSetup.ppe.reason.NOT_IN_POLICY_CONTRACT':
    'Cannot be selected as a required monitoring rule yet.',
  'zoneSetup.ppe.reason.PRESENT_ONLY_SAFETY_BOUNDARY':
    'Shows equipment presence only; does not confirm proper wearing or tie-off and cannot trigger automatic alerts.',
  'zoneSetup.ppe.catalogBoundaryNote':
    '{{totalCount}} PPE types in total: {{selectableCount}} can be selected today, {{unsupportedCount}} are not selectable yet. Listing an item here does not mean the AI model is running or verified for it.',

  'zoneSetup.action.cancel': 'Cancel',
  'zoneSetup.action.clearForm': 'Clear form',
  'zoneSetup.action.saving': 'Saving...',
  'zoneSetup.action.saveZonePpe': 'Save Zone PPE',

  'zoneSetup.validation.codeRequired': 'Zone Code is required.',
  'zoneSetup.validation.codeControlChars': 'Zone Code must not contain control characters.',
  'zoneSetup.validation.codeMaxLength': 'Zone Code must not exceed 64 characters.',
  'zoneSetup.validation.nameRequired': 'Zone Name is required.',
  'zoneSetup.validation.nameControlChars': 'Zone Name must not contain control characters.',
  'zoneSetup.validation.nameMaxLength': 'Zone Name must not exceed 255 characters.',
  'zoneSetup.validation.ppeRequired': 'At least one PPE item must be selected.',

  'zoneSetup.error.401': 'Session expired or unauthorized. Please sign in again.',
  'zoneSetup.error.403': 'You do not have permission to perform this action.',
  'zoneSetup.create.error.wrongScope':
    'Zone was created with an unexpected site scope. Please refresh.',
  'zoneSetup.create.error.409': 'A zone with this code already exists for this site.',
  'zoneSetup.create.error.default':
    'Failed to create zone. Please verify your inputs and network connection.',
  'zoneSetup.create.success':
    'Zone "{code}" created successfully. Link this zone to a camera observation region when ready.',

  'zoneSetup.rename.validation.controlChars':
    'Zone name must not contain control characters or surrogates.',
  'zoneSetup.rename.validation.required': 'Zone name is required.',
  'zoneSetup.rename.validation.maxLength': 'Zone name must not exceed 255 characters.',
  'zoneSetup.rename.error.wrongScope': 'Zone was updated with an unexpected scope or zone.',
  'zoneSetup.rename.error.409':
    'This zone cannot be updated right now. Reload the zone list and try again.',
  'zoneSetup.rename.error.default':
    'Failed to rename zone. Please verify your network connection and try again.',
  'zoneSetup.rename.success': 'Zone name updated to "{name}".',

  'zoneSetup.list.heading': 'Configured Zones for this Site',
  'zoneSetup.list.showingCount': 'Showing {shown} of {total} zones',
  'zoneSetup.list.countOne': '{count} zone',
  'zoneSetup.list.countOther': '{count} zones',
  'zoneSetup.list.loading': 'Loading configured zones...',
  'zoneSetup.list.initialError': 'Could not load configured zones for this site.',
  'zoneSetup.list.retrying': 'Retrying...',
  'zoneSetup.list.retryInitial': 'Retry loading zones',
  'zoneSetup.list.authRevokedError':
    'Could not load configured zones for this site. Access denied or session expired.',
  'zoneSetup.list.nextPageError':
    'Could not load additional zones. Please check your network and try again.',
  'zoneSetup.list.retryNextPage': 'Retry loading more zones',
  'zoneSetup.list.empty': 'No zones configured for this site yet.',
  'zoneSetup.list.emptyReadOnly':
    'No zones configured for this site yet. An assigned Site Manager must create zones before camera regions can be linked.',
  'zoneSetup.list.loadingMore': 'Loading more zones...',
  'zoneSetup.list.loadMore': 'Load more zones',
  'zoneSetup.readOnly.notice':
    'Zone catalog is read-only for your role. Only the assigned Site Manager can create or rename zones for this site.',

  'zoneSetup.rename.headingPrefix': 'Renaming zone:',
  'zoneSetup.rename.policyLockedBadge': 'Policy locked · Name editable',
  'zoneSetup.rename.lockedPpeGuidance':
    'Zone-level template PPE locks once linked to a camera region. To edit active required PPE after setup, open Camera PPE policy on the selected camera.',
  'zoneSetup.rename.newNameLabel': 'New zone name',
  'zoneSetup.rename.cancelBtn': 'Cancel rename',
  'zoneSetup.rename.savingBtn': 'Saving name...',
  'zoneSetup.rename.saveBtn': 'Save name',
  'zoneSetup.rename.triggerBtn': 'Rename {code}',

  'zoneSetup.regionLink.emptyHint':
    'Configure and save at least one zone above to enable Camera Observation Region linking.',
  'zoneSetup.regionLink.emptyReadOnlyHint':
    'An assigned Site Manager must create and save at least one zone above to enable Camera Observation Region linking.',
  'zoneSetup.regionLink.emptyTaskHint':
    'Create and save an area policy in step 1 before linking observation regions.',

  'regionSetup.title': 'Link Zone to Camera Region',
  'regionSetup.subtitle': 'Draw and bind camera observation polygon geometry to the selected zone.',
} as const;

export type ZonePpeSetupCopyKey = keyof typeof en;

const vi: Record<ZonePpeSetupCopyKey, string> = {
  'zoneSetup.title': 'Cấu hình PPE theo Khu vực',
  'zoneSetup.subtitlePrefix':
    'Thiết lập trang bị bảo hộ (PPE) bắt buộc cho các khu vực nguy hiểm tại',
  'zoneSetup.subtitleSuffix': '.',
  'zoneSetup.closeAria': 'Đóng',

  'zoneSetup.field.codeLabel': 'Mã khu vực',
  'zoneSetup.field.codePlaceholder': 'VD: ZONE-HAZ-01',
  'zoneSetup.field.nameLabel': 'Tên khu vực',
  'zoneSetup.field.namePlaceholder': 'VD: Khu vực giàn giáo',
  'zoneSetup.field.ppeLegend': 'Chọn PPE bắt buộc',

  'zoneSetup.ppe.HARD_HAT': 'Mũ bảo hộ',
  'zoneSetup.ppe.SAFETY_VEST': 'Áo phản quang',
  'zoneSetup.ppe.GLOVES': 'Găng tay',
  'zoneSetup.ppe.BOOTS': 'Giày bảo hộ',
  'zoneSetup.ppe.GOGGLES': 'Kính bảo hộ',
  'zoneSetup.ppe.MASK': 'Khẩu trang',
  'zoneSetup.ppe.FULL_BODY_HARNESS': 'Dây đai an toàn toàn thân',
  'zoneSetup.ppe.LANYARD_HOOK': 'Móc dây an toàn',
  'zoneSetup.ppe.coreTag': '(Cơ bản)',
  'zoneSetup.ppe.experimentalTag': '(Thử nghiệm)',
  'zoneSetup.ppe.experimentalNote': 'Năng lực kỹ thuật · thử nghiệm',
  'zoneSetup.ppe.notSelectableHeading':
    'Chưa hỗ trợ cấu hình cho khu vực ({{unsupportedCount}} / {{totalCount}} loại PPE)',
  'zoneSetup.ppe.notSelectableBadge': 'Chưa chọn được',
  'zoneSetup.ppe.semantics.PRESENT_ONLY': 'Chỉ ghi nhận trang bị',
  'zoneSetup.ppe.semantics.CONTRACT_PENDING': 'Chưa hỗ trợ cấu hình',
  'zoneSetup.ppe.reason.NOT_IN_POLICY_CONTRACT': 'Hiện chưa thể chọn làm yêu cầu giám sát tự động.',
  'zoneSetup.ppe.reason.PRESENT_ONLY_SAFETY_BOUNDARY':
    'Chỉ ghi nhận trang bị; không xác nhận đeo hoặc móc đúng và không tự động báo vi phạm.',
  'zoneSetup.ppe.catalogBoundaryNote':
    'Tổng {{totalCount}} loại PPE: hiện chọn được {{selectableCount}} loại, {{unsupportedCount}} loại chưa thể chọn. Hiển thị tại đây không đồng nghĩa máy AI đã chạy đủ hoặc đạt độ chính xác.',

  'zoneSetup.action.cancel': 'Hủy',
  'zoneSetup.action.clearForm': 'Xóa nháp',
  'zoneSetup.action.saving': 'Đang lưu...',
  'zoneSetup.action.saveZonePpe': 'Lưu PPE Khu vực',

  'zoneSetup.validation.codeRequired': 'Mã khu vực là bắt buộc.',
  'zoneSetup.validation.codeControlChars': 'Mã khu vực không được chứa ký tự điều khiển.',
  'zoneSetup.validation.codeMaxLength': 'Mã khu vực không được vượt quá 64 ký tự.',
  'zoneSetup.validation.nameRequired': 'Tên khu vực là bắt buộc.',
  'zoneSetup.validation.nameControlChars': 'Tên khu vực không được chứa ký tự điều khiển.',
  'zoneSetup.validation.nameMaxLength': 'Tên khu vực không được vượt quá 255 ký tự.',
  'zoneSetup.validation.ppeRequired': 'Phải chọn ít nhất một hạng mục PPE.',

  'zoneSetup.error.401':
    'Phiên làm việc đã hết hạn hoặc chưa được xác thực. Vui lòng đăng nhập lại.',
  'zoneSetup.error.403': 'Bạn không có quyền thực hiện thao tác này.',
  'zoneSetup.create.error.wrongScope':
    'Khu vực được tạo với phạm vi công trường không khớp. Vui lòng làm mới.',
  'zoneSetup.create.error.409': 'Mã khu vực này đã tồn tại trong công trường.',
  'zoneSetup.create.error.default':
    'Không thể tạo khu vực. Vui lòng kiểm tra thông tin nhập và kết nối mạng.',
  'zoneSetup.create.success':
    'Đã tạo khu vực "{code}" thành công. Hãy gắn khu vực này với vùng quan sát của camera khi sẵn sàng.',

  'zoneSetup.rename.validation.controlChars':
    'Tên khu vực không được chứa ký tự điều khiển hoặc mã đại diện không hợp lệ.',
  'zoneSetup.rename.validation.required': 'Tên khu vực là bắt buộc.',
  'zoneSetup.rename.validation.maxLength': 'Tên khu vực không được vượt quá 255 ký tự.',
  'zoneSetup.rename.error.wrongScope':
    'Khu vực được cập nhật với phạm vi hoặc mã khu vực không khớp.',
  'zoneSetup.rename.error.409':
    'Không thể cập nhật khu vực này lúc này. Vui lòng tải lại danh sách khu vực và thử lại.',
  'zoneSetup.rename.error.default':
    'Không thể đổi tên khu vực. Vui lòng kiểm tra kết nối mạng và thử lại.',
  'zoneSetup.rename.success': 'Đã cập nhật tên khu vực thành "{name}".',

  'zoneSetup.list.heading': 'Các khu vực đã cấu hình cho công trường này',
  'zoneSetup.list.showingCount': 'Hiển thị {shown} / {total} khu vực',
  'zoneSetup.list.countOne': '{count} khu vực',
  'zoneSetup.list.countOther': '{count} khu vực',
  'zoneSetup.list.loading': 'Đang tải danh sách khu vực đã cấu hình...',
  'zoneSetup.list.initialError': 'Không thể tải danh sách khu vực đã cấu hình cho công trường này.',
  'zoneSetup.list.retrying': 'Đang thử lại...',
  'zoneSetup.list.retryInitial': 'Thử tải lại khu vực',
  'zoneSetup.list.authRevokedError':
    'Không thể tải danh sách khu vực đã cấu hình cho công trường này. Quyền truy cập bị từ chối hoặc phiên đã hết hạn.',
  'zoneSetup.list.nextPageError':
    'Không thể tải thêm khu vực. Vui lòng kiểm tra kết nối mạng và thử lại.',
  'zoneSetup.list.retryNextPage': 'Thử tải thêm khu vực',
  'zoneSetup.list.empty': 'Chưa có khu vực nào được cấu hình cho công trường này.',
  'zoneSetup.list.emptyReadOnly':
    'Chưa có khu vực nào được cấu hình cho công trường này. Chỉ huy công trường (Site Manager) được phân công cần tạo khu vực trước khi liên kết vùng quan sát camera.',
  'zoneSetup.list.loadingMore': 'Đang tải thêm khu vực...',
  'zoneSetup.list.loadMore': 'Tải thêm khu vực',
  'zoneSetup.readOnly.notice':
    'Danh mục khu vực ở chế độ chỉ đọc đối với vai trò của bạn. Chỉ Chỉ huy công trường (Site Manager) được phân công mới có quyền tạo hoặc đổi tên khu vực cho công trường này.',

  'zoneSetup.rename.headingPrefix': 'Đang đổi tên khu vực:',
  'zoneSetup.rename.policyLockedBadge': 'Đã khóa chính sách · Có thể đổi tên',
  'zoneSetup.rename.lockedPpeGuidance':
    'PPE mẫu cấp khu vực sẽ khóa sau khi gắn vùng quan sát camera. Để sửa yêu cầu PPE đang áp dụng sau khi thiết lập, hãy mở Chính sách PPE trên camera đang chọn.',
  'zoneSetup.rename.newNameLabel': 'Tên khu vực mới',
  'zoneSetup.rename.cancelBtn': 'Hủy đổi tên',
  'zoneSetup.rename.savingBtn': 'Đang lưu tên...',
  'zoneSetup.rename.saveBtn': 'Lưu tên',
  'zoneSetup.rename.triggerBtn': 'Đổi tên {code}',

  'zoneSetup.regionLink.emptyHint':
    'Hãy cấu hình và lưu ít nhất một khu vực ở trên để bật liên kết Vùng quan sát của camera.',
  'zoneSetup.regionLink.emptyReadOnlyHint':
    'Chỉ huy công trường (Site Manager) được phân công cần tạo và lưu ít nhất một khu vực ở trên để bật liên kết Vùng quan sát của camera.',
  'zoneSetup.regionLink.emptyTaskHint':
    'Tạo và lưu chính sách khu vực ở bước 1 trước khi gắn vùng quan sát.',

  'regionSetup.title': 'Liên kết Khu vực với Vùng quan sát Camera',
  'regionSetup.subtitle': 'Vẽ và gắn đa giác vùng quan sát của camera vào khu vực đã chọn.',
};

export type ZonePpeUnsupportedReasonCode = Exclude<
  (typeof PPE_FAMILY_CATALOG)[number]['unsupportedReasonCode'],
  null
>;

export const ZONE_PPE_FAMILY_LABEL_KEY: Record<PpeFamily, ZonePpeSetupCopyKey> = {
  HARD_HAT: 'zoneSetup.ppe.HARD_HAT',
  SAFETY_VEST: 'zoneSetup.ppe.SAFETY_VEST',
  GLOVES: 'zoneSetup.ppe.GLOVES',
  BOOTS: 'zoneSetup.ppe.BOOTS',
  GOGGLES: 'zoneSetup.ppe.GOGGLES',
  MASK: 'zoneSetup.ppe.MASK',
  FULL_BODY_HARNESS: 'zoneSetup.ppe.FULL_BODY_HARNESS',
  LANYARD_HOOK: 'zoneSetup.ppe.LANYARD_HOOK',
};

export const ZONE_PPE_UNSUPPORTED_REASON_KEY: Record<
  ZonePpeUnsupportedReasonCode,
  ZonePpeSetupCopyKey
> = {
  NOT_IN_POLICY_CONTRACT: 'zoneSetup.ppe.reason.NOT_IN_POLICY_CONTRACT',
  PRESENT_ONLY_SAFETY_BOUNDARY: 'zoneSetup.ppe.reason.PRESENT_ONLY_SAFETY_BOUNDARY',
};

let registered = false;

export function registerZonePpeSetupCopy(): void {
  if (registered) return;
  registered = true;
  registerFeatureCatalog({ en, vi });
}
