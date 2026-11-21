import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const en = {
  'ppe.admin.registerCamera': 'Register camera',
  'ppe.admin.registrationSuccess':
    'Camera saved in configuration (v1) — not yet verified or applied by the edge worker. Next: open Edit observation regions and click Get configuration image to check the source frame.',
  'zoneSetup.action.cancel': 'Cancel',
  'zoneSetup.dialog.keepEditing': 'Keep editing',
  'zoneSetup.dialog.discardChanges': 'Discard changes',
  'cameraSetup.discardPrompt': 'Discard unsaved camera changes?',
  'cameraSetup.field.code': 'Camera code',
  'cameraSetup.field.name': 'Camera name',
  'cameraSetup.field.externalId': 'Source ID',
  'cameraSetup.register.dialogDescription':
    'Bind a camera on this Site to an edge-provisioned Source ID (saves configuration only).',
  'cameraSetup.register.authRequired':
    'A Site Manager session assigned to the selected Site is required to register a camera.',
  'cameraSetup.register.introPrefix': 'Provisioned source for',
  'cameraSetup.register.introSuffix':
    'Binds to an existing edge worker source key — pasting an RTSP URL will not connect a stream, and Enabled (v1) does not mean live or applied.',
  'cameraSetup.register.nextStepGuide':
    'Next: open Edit observation regions → Get configuration image, set PPE policy, and check worker status (ask your edge operator first if no Source ID is provisioned).',
  'cameraSetup.register.nameHelp':
    'Human-readable name shown to operators across setup and alerts (for example, North Gate).',
  'cameraSetup.register.codeHelp': 'Short reference label on this Site (for example, CAM-01).',
  'cameraSetup.register.sourceHelp':
    'Technical source key already configured on the edge worker (for example, camera-a). Do not enter an RTSP/HTTP URL, IP stream address, password, or token.',
  'cameraSetup.register.submitting': 'Registering…',
  'cameraSetup.register.validation.code':
    'Camera code must contain 1–64 characters without control characters.',
  'cameraSetup.register.validation.name':
    'Camera name must contain 1–255 characters without control characters.',
  'cameraSetup.register.validation.externalId':
    'Enter the technical Source ID configured on the edge worker (1–128 characters, such as camera-a). Do not enter an RTSP/HTTP URL or credentials.',
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
    'Đã lưu camera vào cấu hình (v1) — chưa xác nhận khung hình hay được edge worker áp dụng. Tiếp theo: mở Sửa vùng quan sát và nhấn Lấy ảnh cấu hình để kiểm tra khung hình nguồn.',
  'zoneSetup.action.cancel': 'Hủy',
  'zoneSetup.dialog.keepEditing': 'Tiếp tục chỉnh sửa',
  'zoneSetup.dialog.discardChanges': 'Hủy thay đổi',
  'cameraSetup.discardPrompt': 'Hủy các thay đổi camera chưa lưu?',
  'cameraSetup.field.code': 'Mã camera',
  'cameraSetup.field.name': 'Tên camera',
  'cameraSetup.field.externalId': 'Mã nguồn (Source ID)',
  'cameraSetup.register.dialogDescription':
    'Gắn camera tại công trường này với Mã nguồn (Source ID) đã cấp trên edge worker (chỉ lưu cấu hình).',
  'cameraSetup.register.authRequired':
    'Cần phiên Quản lý công trường được phân công tại công trường đã chọn để đăng ký camera.',
  'cameraSetup.register.introPrefix': 'Nguồn đã cấp trên edge cho',
  'cameraSetup.register.introSuffix':
    'Gắn với khóa nguồn có sẵn trên edge worker — dán URL RTSP không tự kết nối luồng, và Đang bật (v1) chưa đồng nghĩa có video hay đã áp dụng.',
  'cameraSetup.register.nextStepGuide':
    'Tiếp theo: mở Sửa vùng quan sát → Lấy ảnh cấu hình, đặt PPE và xem trạng thái worker (nhờ bộ phận vận hành cấp Source ID trên edge worker trước nếu chưa có).',
  'cameraSetup.register.nameHelp':
    'Tên dễ hiểu hiển thị cho người vận hành trên màn thiết lập và cảnh báo (ví dụ: Cổng Bắc).',
  'cameraSetup.register.codeHelp': 'Mã ngắn gọn để tra cứu nhanh tại công trường (ví dụ: CAM-01).',
  'cameraSetup.register.sourceHelp':
    'Khóa kỹ thuật của nguồn đã cấu hình trên edge worker (ví dụ: camera-a). Không nhập URL RTSP/HTTP, địa chỉ luồng IP, mật khẩu hoặc token.',
  'cameraSetup.register.submitting': 'Đang đăng ký…',
  'cameraSetup.register.validation.code':
    'Mã camera phải có từ 1–64 ký tự và không chứa ký tự điều khiển.',
  'cameraSetup.register.validation.name':
    'Tên camera phải có từ 1–255 ký tự và không chứa ký tự điều khiển.',
  'cameraSetup.register.validation.externalId':
    'Nhập Mã nguồn (Source ID) kỹ thuật đã cấu hình trên edge worker (1–128 ký tự, ví dụ camera-a). Không nhập URL RTSP/HTTP hoặc thông tin đăng nhập.',
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
