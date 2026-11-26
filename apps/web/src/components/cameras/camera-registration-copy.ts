import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const en = {
  'ppe.admin.registerCamera': 'Register camera',
  'ppe.admin.registrationSuccess':
    'Camera saved (not connected or ready yet). Next: open Connect camera to test and connect its video source.',
  'zoneSetup.action.cancel': 'Cancel',
  'zoneSetup.dialog.keepEditing': 'Keep editing',
  'zoneSetup.dialog.discardChanges': 'Discard changes',
  'cameraSetup.discardPrompt': 'Discard unsaved camera changes?',
  'cameraSetup.field.code': 'Camera code',
  'cameraSetup.field.name': 'Camera name',
  'cameraSetup.field.externalId': 'Camera connection ID',
  'cameraSetup.register.dialogDescription':
    'Save a camera record for this site. Connecting the live video source is a separate step.',
  'cameraSetup.register.authRequired':
    'A Site Manager session assigned to the selected Site is required to register a camera.',
  'cameraSetup.register.introPrefix': 'Add a camera to',
  'cameraSetup.register.introSuffix':
    'Saving creates the camera record only — it does not connect video or make the camera connected and ready.',
  'cameraSetup.register.nextStepGuide':
    'Next: open Connect camera to test and connect a video source, then configure monitoring areas and PPE. Do not paste RTSP URLs or passwords here.',
  'cameraSetup.register.nameHelp':
    'Clear display name shown across setup, monitoring, and alerts (for example, Floor 3 Entrance).',
  'cameraSetup.register.codeHelp': 'Short unique label on this site (for example, CAM-03).',
  'cameraSetup.register.sourceHelp':
    'Connection identifier required to save this camera record until automatic binding is available (for example, cam-floor-3). Entering an ID here saves the record only and does not establish a running connection—do not enter an RTSP/HTTP URL, password, or token.',
  'cameraSetup.register.submitting': 'Registering…',
  'cameraSetup.register.validation.code':
    'Camera code must contain 1–64 characters without control characters.',
  'cameraSetup.register.validation.name':
    'Camera name must contain 1–255 characters without control characters.',
  'cameraSetup.register.validation.externalId':
    'Enter a camera connection ID (1–128 characters, such as cam-floor-3) without a camera URL or credentials.',
  'cameraSetup.register.validation.dtoCode': 'Check camera code and try again.',
  'cameraSetup.register.validation.dtoName': 'Check camera name and try again.',
  'cameraSetup.register.validation.dtoExternalId': 'Check camera connection ID and try again.',
  'cameraSetup.register.error.401': 'Your session has expired. Sign in again to register a camera.',
  'cameraSetup.register.error.403': 'You no longer have permission to register cameras.',
  'cameraSetup.register.error.404':
    'This Site is unavailable. Refresh the Site list before continuing.',
  'cameraSetup.register.error.400': 'Check the camera fields and try again.',
  'cameraSetup.register.error.409':
    'This camera code or connection ID is already saved. Verify the camera list before trying again.',
  'cameraSetup.register.error.429': 'Too many requests. Wait before trying again.',
  'cameraSetup.register.error.default':
    'Registration could not be confirmed. Verify the camera list before sending another registration.',
};

const vi: Record<keyof typeof en, string> = {
  'ppe.admin.registerCamera': 'Đăng ký camera',
  'ppe.admin.registrationSuccess':
    'Đã lưu camera (chưa kết nối và chưa sẵn sàng giám sát). Tiếp theo: mở mục Kết nối camera để kiểm tra và nối nguồn hình.',
  'zoneSetup.action.cancel': 'Hủy',
  'zoneSetup.dialog.keepEditing': 'Tiếp tục chỉnh sửa',
  'zoneSetup.dialog.discardChanges': 'Hủy thay đổi',
  'cameraSetup.discardPrompt': 'Hủy các thay đổi camera chưa lưu?',
  'cameraSetup.field.code': 'Mã camera',
  'cameraSetup.field.name': 'Tên camera',
  'cameraSetup.field.externalId': 'Mã kết nối camera',
  'cameraSetup.register.dialogDescription':
    'Lưu hồ sơ camera cho công trường này. Việc kết nối nguồn hình trực tiếp được thực hiện riêng sau khi lưu.',
  'cameraSetup.register.authRequired':
    'Cần phiên Quản lý công trường được phân công tại công trường đã chọn để đăng ký camera.',
  'cameraSetup.register.introPrefix': 'Thêm camera cho',
  'cameraSetup.register.introSuffix':
    'Thao tác lưu chỉ tạo hồ sơ camera — chưa kết nối luồng hình và chưa chuyển camera sang trạng thái đã kết nối và sẵn sàng.',
  'cameraSetup.register.nextStepGuide':
    'Tiếp theo: mở Kết nối camera để kiểm tra và nối nguồn hình, rồi cấu hình vùng giám sát và PPE. Không dán địa chỉ RTSP hay mật khẩu tại đây.',
  'cameraSetup.register.nameHelp':
    'Tên dễ hiểu hiển thị trên màn thiết lập, giám sát và cảnh báo (ví dụ: Lối vào tầng 3).',
  'cameraSetup.register.codeHelp':
    'Mã ngắn gọn để phân biệt camera trong công trường (ví dụ: CAM-03).',
  'cameraSetup.register.sourceHelp':
    'Mã định danh kết nối bắt buộc khi lưu hồ sơ camera cho tới khi có bước gán tự động (ví dụ: cam-tang-3). Nhập mã tại đây chỉ lưu hồ sơ, chưa tạo kết nối video đang chạy — không nhập URL RTSP/HTTP, mật khẩu hoặc token.',
  'cameraSetup.register.submitting': 'Đang đăng ký…',
  'cameraSetup.register.validation.code':
    'Mã camera phải có từ 1–64 ký tự và không chứa ký tự điều khiển.',
  'cameraSetup.register.validation.name':
    'Tên camera phải có từ 1–255 ký tự và không chứa ký tự điều khiển.',
  'cameraSetup.register.validation.externalId':
    'Nhập mã kết nối camera (1–128 ký tự, ví dụ cam-tang-3), không nhập địa chỉ URL camera hoặc thông tin đăng nhập.',
  'cameraSetup.register.validation.dtoCode': 'Vui lòng kiểm tra mã camera và thử lại.',
  'cameraSetup.register.validation.dtoName': 'Vui lòng kiểm tra tên camera và thử lại.',
  'cameraSetup.register.validation.dtoExternalId':
    'Vui lòng kiểm tra mã kết nối camera và thử lại.',
  'cameraSetup.register.error.401':
    'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại để đăng ký camera.',
  'cameraSetup.register.error.403': 'Bạn không còn quyền đăng ký camera.',
  'cameraSetup.register.error.404':
    'Công trường này không khả dụng. Vui lòng làm mới danh sách công trường trước khi tiếp tục.',
  'cameraSetup.register.error.400': 'Vui lòng kiểm tra các trường thông tin camera và thử lại.',
  'cameraSetup.register.error.409':
    'Mã camera hoặc mã kết nối camera này đã được lưu. Vui lòng kiểm tra danh sách camera trước khi thử lại.',
  'cameraSetup.register.error.429': 'Quá nhiều yêu cầu. Vui lòng chờ trước khi thử lại.',
  'cameraSetup.register.error.default':
    'Không thể xác nhận kết quả đăng ký. Vui lòng kiểm tra danh sách camera trước khi gửi lại yêu cầu.',
};

export function registerCameraRegistrationCopy(): void {
  registerFeatureCatalog({ en, vi });
}

registerCameraRegistrationCopy();

export type CameraRegistrationCopyKey = keyof typeof en;
