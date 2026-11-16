import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const en = {
  'ppe.admin.registerCamera': 'Register camera',
  'ppe.admin.registrationSuccess':
    'Camera metadata registered. Video availability is checked separately in monitoring.',
  'zoneSetup.action.cancel': 'Cancel',
  'zoneSetup.dialog.keepEditing': 'Keep editing',
  'zoneSetup.dialog.discardChanges': 'Discard changes',
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
};

const vi: Record<keyof typeof en, string> = {
  'ppe.admin.registerCamera': 'Đăng ký camera',
  'ppe.admin.registrationSuccess':
    'Đã đăng ký siêu dữ liệu camera. Tình trạng kết nối video được kiểm tra riêng khi giám sát.',
  'zoneSetup.action.cancel': 'Hủy',
  'zoneSetup.dialog.keepEditing': 'Tiếp tục chỉnh sửa',
  'zoneSetup.dialog.discardChanges': 'Hủy thay đổi',
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
};

export function registerCameraRegistrationCopy(): void {
  registerFeatureCatalog({ en, vi });
}

registerCameraRegistrationCopy();

export type CameraRegistrationCopyKey = keyof typeof en;
