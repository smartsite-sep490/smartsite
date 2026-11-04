import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const en = {
  'ppe.admin.registerCamera': 'Register camera',
  'ppe.admin.manageCamera': 'Manage camera',
  'ppe.admin.registrationSuccess':
    'Camera metadata registered. Video availability is checked separately in monitoring.',
  'ppe.admin.dismissStatusAria': 'Dismiss status',
  'ppe.admin.dismiss': 'Dismiss',
  'zoneSetup.dialog.keepEditing': 'Keep editing',
  'zoneSetup.dialog.discardChanges': 'Discard changes',
  'zoneSetup.action.cancel': 'Cancel',
  'cameraSetup.discardPrompt': 'Discard unsaved camera changes?',
  'cameraSetup.field.code': 'Camera code',
  'cameraSetup.field.name': 'Camera name',
  'cameraSetup.field.externalId': 'Source ID',
  'cameraSetup.register.dialogDescription':
    'Register camera metadata for this site. Video availability is checked separately in monitoring.',
  'cameraSetup.register.authRequired':
    'A Site Manager session assigned to the selected Site is required to register a camera.',
  'cameraSetup.register.introPrefix': 'Register camera metadata for',
  'cameraSetup.register.introSuffix': 'This does not start video capture or AI processing.',
  'cameraSetup.register.sourceHelp':
    'Use the provisioned source identifier. Do not enter an RTSP URL, password or token.',
  'cameraSetup.register.submitting': 'Registering…',
  'cameraSetup.register.validation.code':
    'Camera code must contain 1–64 characters without control characters.',
  'cameraSetup.register.validation.name':
    'Camera name must contain 1–255 characters without control characters.',
  'cameraSetup.register.validation.externalId':
    'Enter an opaque provisioned Source ID (1–128 characters), without a camera URL or credentials.',
  'cameraSetup.register.validation.dtoCode': 'Check camera code and try again.',
  'cameraSetup.register.validation.dtoName': 'Check camera name and try again.',
  'cameraSetup.register.validation.dtoExternalId': 'Check source id and try again.',
  'cameraSetup.register.error.401': 'Your session has expired. Sign in again to register a camera.',
  'cameraSetup.register.error.403': 'You no longer have permission to register cameras.',
  'cameraSetup.register.error.404':
    'This Site is unavailable. Refresh the Site list before continuing.',
  'cameraSetup.register.error.400': 'Check the camera fields and try again.',
  'cameraSetup.register.error.409':
    'The camera code or Source ID is already registered. Verify the camera list before trying again.',
  'cameraSetup.register.error.429': 'Too many requests. Wait before trying again.',
  'cameraSetup.register.error.default':
    'Registration could not be confirmed. Verify the camera list before sending another registration.',
  'cameraSetup.manage.dialogDescription':
    'View camera details, update display name, and manage activation state.',
  'cameraSetup.manage.statusActive': 'ACTIVE',
  'cameraSetup.manage.statusInactive': 'INACTIVE',
  'cameraSetup.manage.metadataNote':
    'Metadata state only. Does not alter physical device power, camera source provisioning, or AI video pipeline.',
  'cameraSetup.manage.conflictNotice':
    'Metadata changed on server. Review fresh camera metadata to continue.',
  'cameraSetup.manage.refreshing': 'Refreshing…',
  'cameraSetup.manage.refreshCamera': 'Refresh camera',
  'cameraSetup.manage.activationHeading': 'Activation State',
  'cameraSetup.manage.deactivationNote':
    'Deactivation disables monitoring access and advances configuration revisions.',
  'cameraSetup.manage.activationNote':
    'Activation restores eligibility for monitoring. Video and AI availability remain separate.',
  'cameraSetup.manage.deactivateBtn': 'Deactivate camera',
  'cameraSetup.manage.activateBtn': 'Activate camera',
  'cameraSetup.manage.confirmDeactivatePrompt':
    'Confirm deactivation? This advances camera and active region revisions. Monitoring will be inactive.',
  'cameraSetup.manage.confirmActivatePrompt':
    'Confirm activation? This advances camera and active region revisions.',
  'cameraSetup.manage.updatingStatus': 'Updating…',
  'cameraSetup.manage.confirmDeactivateBtn': 'Confirm deactivation',
  'cameraSetup.manage.confirmActivateBtn': 'Confirm activation',
  'cameraSetup.manage.savingName': 'Saving name…',
  'cameraSetup.manage.feedback.renamed': 'Camera name updated.',
  'cameraSetup.manage.feedback.refreshed': 'Camera metadata refreshed.',
  'cameraSetup.manage.feedback.activated':
    'Camera activated. Configuration version advanced to v{version}.',
  'cameraSetup.manage.feedback.deactivated':
    'Camera deactivated. Configuration version advanced to v{version}.',
  'cameraSetup.manage.error.401': 'Your session has expired. Sign in again to manage this camera.',
  'cameraSetup.manage.error.403': 'You no longer have permission to manage this camera.',
  'cameraSetup.manage.error.404': 'This camera or Site is unavailable. Refresh before continuing.',
  'cameraSetup.manage.error.400': 'Check the camera name and try again.',
  'cameraSetup.manage.error.409':
    'Camera metadata conflict. Refresh camera metadata before retrying.',
  'cameraSetup.manage.error.429': 'Too many requests. Please wait before trying again.',
  'cameraSetup.manage.error.default':
    'Camera operation could not be completed. Refresh camera metadata and try again.',
};

const vi: Record<keyof typeof en, string> = {
  'ppe.admin.registerCamera': 'Đăng ký camera',
  'ppe.admin.manageCamera': 'Quản lý camera',
  'ppe.admin.registrationSuccess':
    'Đã đăng ký siêu dữ liệu camera. Tình trạng kết nối video được kiểm tra riêng khi giám sát.',
  'ppe.admin.dismissStatusAria': 'Đóng thông báo trạng thái',
  'ppe.admin.dismiss': 'Đóng',
  'zoneSetup.dialog.keepEditing': 'Tiếp tục chỉnh sửa',
  'zoneSetup.dialog.discardChanges': 'Hủy thay đổi',
  'zoneSetup.action.cancel': 'Hủy',
  'cameraSetup.discardPrompt': 'Hủy các thay đổi camera chưa lưu?',
  'cameraSetup.field.code': 'Mã camera',
  'cameraSetup.field.name': 'Tên camera',
  'cameraSetup.field.externalId': 'Mã nguồn (Source ID)',
  'cameraSetup.register.dialogDescription':
    'Đăng ký siêu dữ liệu camera cho công trường này. Tình trạng kết nối video được kiểm tra riêng khi giám sát.',
  'cameraSetup.register.authRequired':
    'Cần phiên Quản lý công trường được phân công tại công trường đã chọn để đăng ký camera.',
  'cameraSetup.register.introPrefix': 'Đăng ký siêu dữ liệu camera cho',
  'cameraSetup.register.introSuffix': 'Thao tác này không khởi chạy thu hình video hay xử lý AI.',
  'cameraSetup.register.sourceHelp':
    'Sử dụng mã định danh nguồn đã được cấp phát. Không nhập URL RTSP, mật khẩu hoặc token.',
  'cameraSetup.register.submitting': 'Đang đăng ký…',
  'cameraSetup.register.validation.code':
    'Mã camera phải có từ 1–64 ký tự và không chứa ký tự điều khiển.',
  'cameraSetup.register.validation.name':
    'Tên camera phải có từ 1–255 ký tự và không chứa ký tự điều khiển.',
  'cameraSetup.register.validation.externalId':
    'Nhập Mã nguồn (Source ID) định danh đã cấp (1–128 ký tự), không nhập URL camera hoặc thông tin xác thực.',
  'cameraSetup.register.validation.dtoCode': 'Vui lòng kiểm tra mã camera và thử lại.',
  'cameraSetup.register.validation.dtoName': 'Vui lòng kiểm tra tên camera và thử lại.',
  'cameraSetup.register.validation.dtoExternalId': 'Vui lòng kiểm tra mã nguồn và thử lại.',
  'cameraSetup.register.error.401':
    'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại để đăng ký camera.',
  'cameraSetup.register.error.403': 'Bạn không còn quyền đăng ký camera.',
  'cameraSetup.register.error.404':
    'Công trường này không khả dụng. Vui lòng làm mới danh sách công trường trước khi tiếp tục.',
  'cameraSetup.register.error.400': 'Vui lòng kiểm tra các trường thông tin camera và thử lại.',
  'cameraSetup.register.error.409':
    'Mã camera hoặc Mã nguồn đã được đăng ký. Vui lòng kiểm tra danh sách camera trước khi thử lại.',
  'cameraSetup.register.error.429': 'Quá nhiều yêu cầu. Vui lòng chờ trước khi thử lại.',
  'cameraSetup.register.error.default':
    'Không thể xác nhận kết quả đăng ký. Vui lòng kiểm tra danh sách camera trước khi gửi lại yêu cầu.',
  'cameraSetup.manage.dialogDescription':
    'Xem chi tiết camera, cập nhật tên hiển thị và quản lý trạng thái kích hoạt.',
  'cameraSetup.manage.statusActive': 'Đang hoạt động (ACTIVE)',
  'cameraSetup.manage.statusInactive': 'Ngừng hoạt động (INACTIVE)',
  'cameraSetup.manage.metadataNote':
    'Chỉ quản lý trạng thái siêu dữ liệu. Không thay đổi nguồn điện thiết bị vật lý, cấu hình nguồn phát hay luồng xử lý video AI.',
  'cameraSetup.manage.conflictNotice':
    'Siêu dữ liệu đã thay đổi trên máy chủ. Vui lòng tải lại siêu dữ liệu camera mới nhất để tiếp tục.',
  'cameraSetup.manage.refreshing': 'Đang làm mới…',
  'cameraSetup.manage.refreshCamera': 'Làm mới camera',
  'cameraSetup.manage.activationHeading': 'Trạng thái kích hoạt',
  'cameraSetup.manage.deactivationNote':
    'Ngừng kích hoạt sẽ tắt quyền giám sát camera này và tăng phiên bản cấu hình.',
  'cameraSetup.manage.activationNote':
    'Kích hoạt sẽ khôi phục điều kiện đưa vào giám sát. Tình trạng luồng video và AI được kiểm tra riêng.',
  'cameraSetup.manage.deactivateBtn': 'Ngừng kích hoạt camera',
  'cameraSetup.manage.activateBtn': 'Kích hoạt camera',
  'cameraSetup.manage.confirmDeactivatePrompt':
    'Xác nhận ngừng kích hoạt? Thao tác này sẽ tăng phiên bản cấu hình của camera và các vùng quan sát đang hoạt động. Giám sát sẽ ngừng hoạt động.',
  'cameraSetup.manage.confirmActivatePrompt':
    'Xác nhận kích hoạt? Thao tác này sẽ tăng phiên bản cấu hình của camera và các vùng quan sát đang hoạt động.',
  'cameraSetup.manage.updatingStatus': 'Đang cập nhật…',
  'cameraSetup.manage.confirmDeactivateBtn': 'Xác nhận ngừng kích hoạt',
  'cameraSetup.manage.confirmActivateBtn': 'Xác nhận kích hoạt',
  'cameraSetup.manage.savingName': 'Đang lưu tên…',
  'cameraSetup.manage.feedback.renamed': 'Đã cập nhật tên camera.',
  'cameraSetup.manage.feedback.refreshed': 'Đã làm mới siêu dữ liệu camera.',
  'cameraSetup.manage.feedback.activated':
    'Đã kích hoạt camera. Phiên bản cấu hình tăng lên v{version}.',
  'cameraSetup.manage.feedback.deactivated':
    'Đã ngừng kích hoạt camera. Phiên bản cấu hình tăng lên v{version}.',
  'cameraSetup.manage.error.401':
    'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại để quản lý camera này.',
  'cameraSetup.manage.error.403': 'Bạn không còn quyền quản lý camera này.',
  'cameraSetup.manage.error.404':
    'Camera hoặc công trường này không khả dụng. Vui lòng làm mới trước khi tiếp tục.',
  'cameraSetup.manage.error.400': 'Vui lòng kiểm tra tên camera và thử lại.',
  'cameraSetup.manage.error.409':
    'Xung đột siêu dữ liệu camera. Vui lòng làm mới siêu dữ liệu camera trước khi thử lại.',
  'cameraSetup.manage.error.429': 'Quá nhiều yêu cầu. Vui lòng chờ trước khi thử lại.',
  'cameraSetup.manage.error.default':
    'Không thể hoàn tất thao tác trên camera. Vui lòng làm mới siêu dữ liệu camera và thử lại.',
};

export function registerCameraDialogPrimitivesCopy(): void {
  registerFeatureCatalog({ en, vi });
}

registerCameraDialogPrimitivesCopy();

export type CameraDialogPrimitivesCopyKey = keyof typeof en;
export type CameraDialogTranslationKey = CameraDialogPrimitivesCopyKey | (string & {});
