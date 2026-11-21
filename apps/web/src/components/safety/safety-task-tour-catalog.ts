import {
  hasRegisteredFeatureKey,
  registerFeatureCatalog,
} from '../../i18n/feature-catalog-registry';

const SAFETY_TASK_TOUR_EN = {
  'tour.triggerBtn': 'Guided help',
  'tour.replayBtn': 'Replay guide',
  'tour.resetBtn': 'Reset guide',
  'tour.invite.aria': 'First-use guided help',
  'tour.invite.prompt': 'New to this workspace? Take a quick guided tour.',
  'tour.invite.startBtn': 'Start guide',
  'tour.invite.skipBtn': 'Skip',
  'tour.regionAria': 'Guided task tour',
  'tour.stepCounter': 'Step {{current}} of {{total}}',
  'tour.nextBtn': 'Next',
  'tour.backBtn': 'Back',
  'tour.skipBtn': 'Skip tour',
  'tour.doneBtn': 'Done',
  'tour.closeAria': 'Close guided tour',
  'tour.monitor.scope.title': 'Choose Site & Camera',
  'tour.monitor.scope.body':
    'Select an authorized site and camera scope. Use Load more when your site or camera list spans multiple pages.',
  'tour.monitor.viewMode.title': 'Single Focus vs 4-Source Wall',
  'tour.monitor.viewMode.body':
    'Switch between the 4-camera wall and a single focused camera without losing your selected camera.',
  'tour.monitor.enlarge.title': 'Enlarge & Fullscreen',
  'tour.monitor.enlarge.body':
    'Enlarge any camera tile or enter fullscreen. Press Escape or Back to 4-source grid to return and restore focus.',
  'tour.monitor.evidence.title': 'On-Demand Evidence Inspector',
  'tour.monitor.evidence.body':
    'Keep the live camera canvas primary and open PPE evidence or observation details only when needed.',
  'tour.monitor.setup.title': 'Camera & Zone Setup',
  'tour.monitor.setup.body':
    'Open the permitted setup link for the selected site. Configuring cameras and zones requires the assigned Site Manager; monitoring access does not grant setup permissions.',
  'tour.alerts.queueFilter.title': 'Filter Alert Queue',
  'tour.alerts.queueFilter.body':
    'Filter safety alerts for the selected site by review status or alert type, then select an alert in the queue to inspect its details.',
  'tour.alerts.caseSummary.title': 'Case Summary & Evidence',
  'tour.alerts.caseSummary.body':
    'Review the selected alert summary, captured camera frames, and other findings for the same person in that image without leaving your current selection.',
  'tour.alerts.actionBar.title': 'Record Review Decision',
  'tour.alerts.actionBar.body':
    'Enter a clear reason and confirm the violation, dismiss the alert, or request more evidence. The guide never modifies your draft or submits a decision.',
  'tour.alerts.followup.title': 'Work Context & Incident Follow-up',
  'tour.alerts.followup.body':
    'Review the work context recorded at event time (such as teams with recorded zone grants at that time, without confirming current active schedules or worker identity), or open the incident workflow for a confirmed alert.',
  'tour.cameraSetup.scope.title': 'Select Site & Camera',
  'tour.cameraSetup.scope.body':
    'Choose an authorized site (use Load more when paged) and select a camera from the catalog below. Only the assigned Site Manager can edit setup; other authorized roles have read-only access.',
  'tour.cameraSetup.source.title': 'Register or Manage Camera',
  'tour.cameraSetup.source.body':
    'Register a new camera or open Manage on an existing camera to update its name, status, or source identifier. Saving camera details updates configuration only and does not confirm a live connection.',
  'tour.cameraSetup.zoneDraw.title': 'Zone PPE Policies & Camera Regions',
  'tour.cameraSetup.zoneDraw.body':
    'Review area PPE policies, or if you are the assigned Site Manager, configure zone PPE rules and camera observation regions on a reference image. Read-only access does not allow editing, and the guide never alters open drafts.',
  'tour.cameraSetup.save.title': 'Saved Configuration & Status',
  'tour.cameraSetup.save.body':
    'Check the selected camera status and saved configuration version. A saved configuration does not confirm changes are applied or that the camera is live.',
  'tour.polygon.reference.title': 'Check Reference Image',
  'tour.polygon.reference.body':
    'Confirm the frozen camera image for the selected zone before drawing. If the reference expires, accept a new image before saving.',
  'tour.polygon.canvas.title': 'Place Region Points',
  'tour.polygon.canvas.body':
    'Click on the image to place corner points around the target area without crossing lines. Opening this guide never changes your current drawing.',
  'tour.polygon.controls.title': 'Adjust Points & View',
  'tour.polygon.controls.body':
    'Use Undo, Reset, Delete Point, Zoom, Pan, or the X/Y inputs to fine-tune corners. Editing buttons lock while a save is in progress.',
  'tour.polygon.save.title': 'Save or Cancel',
  'tour.polygon.save.body':
    'Review the drawn region against the reference image, tick the confirmation checkbox, then click Save Region (or Cancel / Esc to close). Any point edit or new reference image requires ticking confirmation again. Saving updates configuration only and does not mean live camera monitoring is active.',
  'tour.frameInbox.filters.title': 'Filter by Site & Camera',
  'tour.frameInbox.filters.body':
    'Narrow the Frame Inbox by authorized Site and Camera, or clear active filters to return to all assigned scopes.',
  'tour.frameInbox.frameSummary.title': 'One Grouped Frame vs Per-Person Cases',
  'tour.frameInbox.frameSummary.body':
    'Each card groups one camera timestamp with separate per-case read acknowledgement and PPE findings. Counts reflect only flagged cases (affected people with recorded checks in this frame) — never a healthy-person total or current live person count.',
  'tour.frameInbox.mediaEvidence.title': 'Original Frame JPEG vs Person Crop',
  'tour.frameInbox.mediaEvidence.body':
    'Open the shared original frame JPEG for full scene context, or toggle an individual person crop to inspect PPE details without treating crops as verified identity.',
  'tour.frameInbox.subjectStatus.title': 'Pending, Denied & Unconfirmed Identity',
  'tour.frameInbox.subjectStatus.body':
    'Identity stays Unconfirmed (Unknown) until human review. Zone checks distinguish Pending assessment (awaiting authorization check, not denied) from confirmed Denied entries and Insufficient evidence (not a confirmed violation).',
  'tour.frameInbox.caseReview.title': 'Open Case & Return to Frame',
  'tour.frameInbox.caseReview.body':
    'Open a person’s case to inspect full episode evidence and findings, then use Back to this frame to return with your Site and Camera filters preserved.',
  'tour.frameInbox.caseHandoff.title': 'Open Case, Request Identification & Return',
  'tour.frameInbox.caseHandoff.body':
    'Open a person’s case to inspect full episode evidence (and request Site Manager identification when enabled), then use Back to this frame to return with your Site and Camera filters preserved.',
} as const;

const SAFETY_TASK_TOUR_VI: Record<keyof typeof SAFETY_TASK_TOUR_EN, string> = {
  'tour.triggerBtn': 'Hướng dẫn nhanh',
  'tour.replayBtn': 'Xem lại hướng dẫn',
  'tour.resetBtn': 'Đặt lại hướng dẫn',
  'tour.invite.aria': 'Hướng dẫn sử dụng lần đầu',
  'tour.invite.prompt': 'Mới dùng màn hình này? Xem hướng dẫn nhanh các bước chính.',
  'tour.invite.startBtn': 'Bắt đầu hướng dẫn',
  'tour.invite.skipBtn': 'Bỏ qua',
  'tour.regionAria': 'Hướng dẫn thao tác',
  'tour.stepCounter': 'Bước {{current}} / {{total}}',
  'tour.nextBtn': 'Tiếp theo',
  'tour.backBtn': 'Quay lại',
  'tour.skipBtn': 'Bỏ qua',
  'tour.doneBtn': 'Hoàn tất',
  'tour.closeAria': 'Đóng hướng dẫn',
  'tour.monitor.scope.title': 'Chọn Công trường & Camera',
  'tour.monitor.scope.body':
    'Chọn công trường và camera được cấp quyền. Dùng Tải thêm khi danh sách có nhiều trang.',
  'tour.monitor.viewMode.title': 'Xem đơn hoặc Lưới 4 nguồn',
  'tour.monitor.viewMode.body':
    'Chuyển đổi giữa lưới 4 camera và khung phóng to đơn lẻ mà vẫn giữ nguyên camera đang chọn.',
  'tour.monitor.enlarge.title': 'Phóng to & Toàn màn hình',
  'tour.monitor.enlarge.body':
    'Phóng to từng ô camera hoặc bật toàn màn hình. Nhấn Escape hoặc Quay lại lưới 4 nguồn để trở về đúng vị trí.',
  'tour.monitor.evidence.title': 'Chi tiết Bằng chứng theo yêu cầu',
  'tour.monitor.evidence.body':
    'Giữ khung hình camera làm trọng tâm và chỉ mở hộp thoại bằng chứng PPE khi cần kiểm tra.',
  'tour.monitor.setup.title': 'Thiết lập Camera & Khu vực',
  'tour.monitor.setup.body':
    'Mở liên kết thiết lập được phép cho công trường đang chọn. Việc cấu hình camera và vùng giám sát yêu cầu Quản lý công trường được phân công; quyền xem giám sát không cấp quyền thiết lập.',
  'tour.alerts.queueFilter.title': 'Lọc Hàng đợi Cảnh báo',
  'tour.alerts.queueFilter.body':
    'Lọc cảnh báo an toàn của công trường đang chọn theo trạng thái duyệt hoặc loại cảnh báo, sau đó chọn một cảnh báo trong danh sách để xem chi tiết.',
  'tour.alerts.caseSummary.title': 'Tóm tắt Ca việc & Bằng chứng',
  'tour.alerts.caseSummary.body':
    'Xem tóm tắt cảnh báo đang chọn, hình ảnh từ camera và các phát hiện khác của cùng một người trong khung hình đó mà không làm mất lựa chọn hiện tại.',
  'tour.alerts.actionBar.title': 'Ghi nhận Quyết định Duyệt',
  'tour.alerts.actionBar.body':
    'Nhập lý do rõ ràng để xác nhận vi phạm, bác bỏ cảnh báo hoặc yêu cầu thêm bằng chứng. Hướng dẫn không làm thay đổi bản nháp hay tự gửi quyết định.',
  'tour.alerts.followup.title': 'Ngữ cảnh Công việc & Xử lý Sự cố',
  'tour.alerts.followup.body':
    'Xem ngữ cảnh công việc được ghi nhận tại thời điểm sự kiện (như các đội có quyền vào khu vực được ghi nhận lúc đó, không xác nhận lịch làm việc hiện tại hay danh tính công nhân), hoặc mở quy trình sự cố đối với cảnh báo đã xác nhận.',
  'tour.cameraSetup.scope.title': 'Chọn Công trường & Camera',
  'tour.cameraSetup.scope.body':
    'Chọn công trường được cấp quyền (dùng Tải thêm khi danh sách có nhiều trang) và chọn camera bên dưới. Chỉ Quản lý công trường được phân công mới được chỉnh sửa; các vai trò được phép khác chỉ xem.',
  'tour.cameraSetup.source.title': 'Đăng ký hoặc Quản lý Camera',
  'tour.cameraSetup.source.body':
    'Đăng ký camera mới hoặc mở Quản lý trên camera hiện có để cập nhật tên, trạng thái hoặc mã nguồn. Việc lưu thông tin chỉ cập nhật cấu hình, không xác nhận camera đang kết nối trực tiếp.',
  'tour.cameraSetup.zoneDraw.title': 'Chính sách PPE & Vùng quan sát',
  'tour.cameraSetup.zoneDraw.body':
    'Xem chính sách PPE theo khu vực, hoặc nếu bạn là Quản lý công trường được phân công, thiết lập quy tắc PPE và vùng quan sát trên ảnh tham chiếu. Quyền chỉ xem không cho phép chỉnh sửa và hướng dẫn không làm thay đổi bản nháp đang mở.',
  'tour.cameraSetup.save.title': 'Cấu hình Đã lưu & Trạng thái',
  'tour.cameraSetup.save.body':
    'Kiểm tra trạng thái camera đang chọn và phiên bản cấu hình đã lưu. Cấu hình đã lưu không xác nhận thay đổi đã được áp dụng hoặc camera đang hoạt động trực tiếp.',
  'tour.polygon.reference.title': 'Kiểm tra Ảnh tham chiếu',
  'tour.polygon.reference.body':
    'Kiểm tra ảnh tĩnh của camera cho khu vực đang chọn trước khi vẽ. Nếu ảnh hết hạn, hãy chấp nhận ảnh mới trước khi lưu.',
  'tour.polygon.canvas.title': 'Đặt Điểm góc cho Vùng',
  'tour.polygon.canvas.body':
    'Nhấp lên ảnh để đặt các điểm bao quanh khu vực cần giám sát mà không để các cạnh cắt nhau. Mở hướng dẫn này không làm thay đổi hình đang vẽ.',
  'tour.polygon.controls.title': 'Chỉnh Điểm & Khung nhìn',
  'tour.polygon.controls.body':
    'Dùng Hoàn tác, Đặt lại, Xóa điểm, Thu phóng, Kéo khung hoặc ô nhập X/Y để tinh chỉnh góc. Các nút chỉnh sửa sẽ khóa khi đang lưu.',
  'tour.polygon.save.title': 'Lưu hoặc Hủy',
  'tour.polygon.save.body':
    'Kiểm tra vùng vừa vẽ khớp với ảnh tham chiếu, tích ô xác nhận rồi nhấn Lưu vùng (hoặc Hủy / Esc để đóng). Mọi chỉnh sửa điểm hoặc ảnh tham chiếu mới đều cần tích xác nhận lại. Lưu vùng chỉ cập nhật cấu hình, không đồng nghĩa giám sát camera trực tiếp đã hoạt động.',
  'tour.frameInbox.filters.title': 'Lọc theo Công trường & Camera',
  'tour.frameInbox.filters.body':
    'Thu hẹp Hộp thư khung hình theo Công trường và Camera được phân quyền, hoặc xóa bộ lọc đang bật để xem lại toàn bộ phạm vi được giao.',
  'tour.frameInbox.frameSummary.title': 'Một Khung hình Gộp & Hồ sơ Từng người',
  'tour.frameInbox.frameSummary.body':
    'Mỗi thẻ gộp một thời điểm chụp camera với trạng thái xác nhận đã đọc riêng cho từng ca và phát hiện PPE. Số lượng chỉ tính số ca được gắn cờ (người có ghi nhận kiểm tra cần xem xét trong khung hình này — không báo số người trực tiếp hiện tại, tổng số người an toàn hay tổng quân số tại hiện trường).',
  'tour.frameInbox.mediaEvidence.title': 'Ảnh Gốc Toàn Khung & Ảnh Cắt Từng Người',
  'tour.frameInbox.mediaEvidence.body':
    'Mở ảnh JPEG gốc dùng chung để xem toàn cảnh hiện trường, hoặc bật ảnh cắt riêng của từng người để kiểm tra PPE mà không coi ảnh cắt là danh tính đã xác minh.',
  'tour.frameInbox.subjectStatus.title': 'Đang chờ, Từ chối & Danh tính Chưa xác nhận',
  'tour.frameInbox.subjectStatus.body':
    'Danh tính luôn ở trạng thái Chưa xác nhận (Unknown) cho đến khi có đối chiếu của con người. Kiểm tra vùng phân biệt rõ Đang chờ đánh giá (chưa kết luận từ chối) với Không được phép đã xác nhận và Chưa đủ bằng chứng.',
  'tour.frameInbox.caseReview.title': 'Mở Hồ sơ & Quay lại Khung hình',
  'tour.frameInbox.caseReview.body':
    'Mở hồ sơ của từng người để xem toàn bộ bằng chứng và phát hiện ca việc, rồi dùng liên kết Quay lại khung hình này để trở về mà vẫn giữ nguyên bộ lọc Công trường và Camera.',
  'tour.frameInbox.caseHandoff.title': 'Mở Hồ sơ, Yêu cầu Xác minh & Quay lại',
  'tour.frameInbox.caseHandoff.body':
    'Mở hồ sơ của từng người để xem toàn bộ bằng chứng ca việc (và gửi yêu cầu Quản lý công trường xác minh danh tính khi tính năng được bật), rồi dùng liên kết Quay lại khung hình này để trở về mà vẫn giữ nguyên bộ lọc Công trường và Camera.',
};

export type SafetyTaskTourCatalogKey = keyof typeof SAFETY_TASK_TOUR_EN;

export function registerSafetyTaskTourCatalog(): void {
  if (hasRegisteredFeatureKey('tour.triggerBtn')) {
    return;
  }
  registerFeatureCatalog({
    en: SAFETY_TASK_TOUR_EN,
    vi: SAFETY_TASK_TOUR_VI,
  });
}

registerSafetyTaskTourCatalog();
