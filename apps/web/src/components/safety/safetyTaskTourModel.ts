import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

export const SAFETY_TOUR_STORAGE_KEY = 'smartsite.safetyTaskTour.v1';
export const MONITOR_TOUR_VERSION = 1;
export const ALERTS_TOUR_VERSION = 1;
export const CAMERA_SETUP_TOUR_VERSION = 1;

export type SafetyTaskId = 'monitor' | 'alerts' | 'camera-setup' | 'polygon';

export type SafetyTourProgressStatus = 'COMPLETED' | 'SKIPPED';

export interface SafetyTourStepSpec {
  id: string;
  anchorSelector: string;
  titleKey: string;
  bodyKey: string;
  isAllowed?: () => boolean;
}

export interface SafetyTaskTourProps {
  taskId: SafetyTaskId;
  tourVersion?: number;
  userId?: string | null;
  scopeKey: string;
  isAuthorized?: boolean;
  steps?: readonly SafetyTourStepSpec[];
}

const stepSpec = (id: string, anchor: string, prefix: string): SafetyTourStepSpec => ({
  id,
  anchorSelector: `[data-tour-anchor="${anchor}"]`,
  titleKey: `${prefix}.title`,
  bodyKey: `${prefix}.body`,
});

export const MONITOR_TOUR_STEPS: readonly SafetyTourStepSpec[] = [
  stepSpec('monitor-scope', 'monitor-scope', 'tour.monitor.scope'),
  stepSpec('monitor-view-mode', 'monitor-view-mode', 'tour.monitor.viewMode'),
  stepSpec('monitor-enlarge', 'monitor-enlarge', 'tour.monitor.enlarge'),
  stepSpec('monitor-evidence', 'monitor-evidence', 'tour.monitor.evidence'),
  stepSpec('monitor-setup', 'monitor-setup', 'tour.monitor.setup'),
];

export const ALERTS_TOUR_STEPS: readonly SafetyTourStepSpec[] = [
  stepSpec('alerts-queue-filter', 'alerts-queue-filter', 'tour.alerts.queueFilter'),
  stepSpec('alerts-case-summary', 'alerts-case-summary', 'tour.alerts.caseSummary'),
  stepSpec('alerts-action-bar', 'alerts-action-bar', 'tour.alerts.actionBar'),
  stepSpec('alerts-followup', 'alerts-followup', 'tour.alerts.followup'),
];

export const PROPOSED_ALERTS_TOUR_ANCHORS: readonly SafetyTourStepSpec[] = ALERTS_TOUR_STEPS;

export interface AlertsTourStepOptions {
  hasQueueFilter: boolean;
  hasSelectedCase: boolean;
  canRecordReview: boolean;
  hasFollowupContext: boolean;
}

export function buildAlertsTourSteps(
  options: AlertsTourStepOptions,
): readonly SafetyTourStepSpec[] {
  return ALERTS_TOUR_STEPS.map((step) => {
    if (step.id === 'alerts-queue-filter') {
      return { ...step, isAllowed: () => options.hasQueueFilter };
    }
    if (step.id === 'alerts-case-summary') {
      return { ...step, isAllowed: () => options.hasSelectedCase };
    }
    if (step.id === 'alerts-action-bar') {
      return { ...step, isAllowed: () => options.canRecordReview };
    }
    if (step.id === 'alerts-followup') {
      return { ...step, isAllowed: () => options.hasFollowupContext };
    }
    return step;
  });
}

export const CAMERA_SETUP_TOUR_STEPS: readonly SafetyTourStepSpec[] = [
  stepSpec('camera-setup-scope', 'camera-setup-scope', 'tour.cameraSetup.scope'),
  stepSpec('camera-setup-source', 'camera-setup-source', 'tour.cameraSetup.source'),
  stepSpec('camera-setup-zone-draw', 'camera-setup-zone-draw', 'tour.cameraSetup.zoneDraw'),
  stepSpec('camera-setup-save', 'camera-setup-save', 'tour.cameraSetup.save'),
];

export const PROPOSED_CAMERA_SETUP_TOUR_ANCHORS: readonly SafetyTourStepSpec[] =
  CAMERA_SETUP_TOUR_STEPS;

export interface CameraSetupTourStepOptions {
  canManageCameras: boolean;
  canAccessZones: boolean;
  hasCameraContext: boolean;
}

export function buildCameraSetupTourSteps(
  options: CameraSetupTourStepOptions,
): readonly SafetyTourStepSpec[] {
  return CAMERA_SETUP_TOUR_STEPS.map((step) => {
    if (step.id === 'camera-setup-source') {
      return { ...step, isAllowed: () => options.canManageCameras };
    }
    if (step.id === 'camera-setup-zone-draw') {
      return { ...step, isAllowed: () => options.canManageCameras || options.canAccessZones };
    }
    if (step.id === 'camera-setup-save') {
      return { ...step, isAllowed: () => options.hasCameraContext };
    }
    return step;
  });
}

const en = {
  'tour.triggerBtn': 'Guided help',
  'tour.replayBtn': 'Replay guide',
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
};

const vi: Record<keyof typeof en, string> = {
  'tour.triggerBtn': 'Hướng dẫn nhanh',
  'tour.replayBtn': 'Xem lại hướng dẫn',
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
};

registerFeatureCatalog({ en, vi });

export function sanitizeTourUserId(userId: string | null | undefined): string | null {
  if (typeof userId !== 'string') return null;
  const trimmed = userId.trim();
  if (!trimmed || trimmed.length > 128 || /[\s.:/]/.test(trimmed) || /^bearer\b/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function readSafetyTourProgress(
  userId: string | null | undefined,
  taskId: string,
  tourVersion: number,
): SafetyTourProgressStatus | null {
  const safeUser = sanitizeTourUserId(userId);
  if (!safeUser || !Number.isSafeInteger(tourVersion) || tourVersion < 1) return null;
  try {
    const raw = window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    const entry = parsed?.[`${safeUser}:${taskId}:v${tourVersion}`] as
      { status?: unknown; tourVersion?: unknown } | undefined;
    return entry?.tourVersion === tourVersion &&
      (entry.status === 'COMPLETED' || entry.status === 'SKIPPED')
      ? entry.status
      : null;
  } catch {
    return null;
  }
}

export function writeSafetyTourProgress(
  userId: string | null | undefined,
  taskId: string,
  tourVersion: number,
  status: SafetyTourProgressStatus,
): boolean {
  const safeUser = sanitizeTourUserId(userId);
  if (!safeUser || !Number.isSafeInteger(tourVersion) || tourVersion < 1) return false;
  try {
    const raw = window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const safeStore: Record<string, { status: SafetyTourProgressStatus; tourVersion: number }> = {};
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        const rec = v as { status?: unknown; tourVersion?: unknown } | null;
        if (
          rec &&
          (rec.status === 'COMPLETED' || rec.status === 'SKIPPED') &&
          typeof rec.tourVersion === 'number'
        ) {
          safeStore[k] = { status: rec.status, tourVersion: rec.tourVersion };
        }
      }
    }
    safeStore[`${safeUser}:${taskId}:v${tourVersion}`] = { status, tourVersion };
    window.localStorage.setItem(SAFETY_TOUR_STORAGE_KEY, JSON.stringify(safeStore));
    return true;
  } catch {
    return false;
  }
}

export function isElementAvailable(el: HTMLElement | null): el is HTMLElement {
  if (!el || !el.isConnected || el.closest('[hidden], [inert], [aria-hidden="true"], .sr-only')) {
    return false;
  }
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      return false;
    }
  }
  return true;
}
