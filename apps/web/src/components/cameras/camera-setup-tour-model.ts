import type { CameraResponse } from '@smartsite/contracts/management';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import type { SafetyTourStepSpec } from '../safety/safetyTaskTourModel';
import type { SavedVsAppliedState } from './camera-ppe-policy-model';

export const CAMERA_SETUP_WORKSPACE_TOUR_VERSION = 2;

const CAMERA_SETUP_TOUR_EN = {
  'cameraSetup.tour.scope.manager.title': 'Select Site & Camera',
  'cameraSetup.tour.scope.manager.body':
    'Choose your assigned site (use Load more when paged), then select a camera via Choose a camera on the Selected camera card or Select in the catalog below to inspect or update its setup.',
  'cameraSetup.tour.scope.emptyManager.title': 'Select Site & Start Camera Onboarding',
  'cameraSetup.tour.scope.emptyManager.body':
    'Choose your assigned site (use Load more when paged). No cameras are registered on this site yet—start with Step 1 (Configure PPE by Zone) and Step 2 (Register camera) below.',
  'cameraSetup.tour.scope.readOnly.title': 'Select Site & Camera (Read-Only)',
  'cameraSetup.tour.scope.readOnly.body':
    'Choose an authorized site (use Load more when paged) and select a camera below to review its configuration. Only the assigned Site Manager can edit setup.',
  'cameraSetup.tour.source.title': 'Register Provisioned Source',
  'cameraSetup.tour.source.body':
    'Use Register camera to save a camera code, display name, and an already-provisioned Source ID (never enter RTSP URLs or credentials). Registration records metadata only and does not provision streams or verify live connectivity.',
  'cameraSetup.tour.zoneDraw.manager.title': 'Configure Zone & Region PPE Modes',
  'cameraSetup.tour.zoneDraw.manager.body':
    'Open Configure PPE by Zone to define site zones before linking camera regions. Each region can inherit the camera default, override with custom PPE, or disable PPE checks with a reason. The guide never alters open drafts.',
  'cameraSetup.tour.zoneDraw.readOnly.title': 'Review Zone & Region PPE Modes (Read-Only)',
  'cameraSetup.tour.zoneDraw.readOnly.body':
    'Open View Zones or expand Camera PPE policy below to inspect site zones and per-region PPE modes without modifying configuration.',
  'cameraSetup.tour.ppePolicy.manager.title': 'Choose Inherited, Override, or Disabled PPE',
  'cameraSetup.tour.ppePolicy.manager.body':
    'Expand Camera PPE policy (or click Configure PPE policy on the selected camera) to set the camera default and choose each region rule: Use camera default (Inherited), Custom (Override selected PPE), or Disabled (with a documented reason), and verify effective PPE per region.',
  'cameraSetup.tour.ppePolicy.readOnly.title': 'Inspect Effective Region PPE (Read-Only)',
  'cameraSetup.tour.ppePolicy.readOnly.body':
    'Expand Camera PPE policy to inspect the camera default and each region rule—Use camera default (Inherited), Custom (Override), or Disabled—alongside saved vs worker-applied versions.',
  'cameraSetup.tour.regions.active.title': 'Capture Reference & Draw Small Region',
  'cameraSetup.tour.regions.active.body':
    'Open Edit observation regions to capture the current 5-minute reference image, draw a small non-crossing polygon (at least 3 points) tightly around the target work zone, choose its PPE mode on v2 cameras, tick confirmation, and click Save Region.',
  'cameraSetup.tour.regions.inactive.title': 'Enable Camera Before Capturing Reference',
  'cameraSetup.tour.regions.inactive.body':
    'This camera is Disabled in saved configuration. Open Manage (Edit camera settings) to enable it first, then open Regions to capture a 5-minute reference image and draw/save a small region polygon.',
  'cameraSetup.tour.save.manager.title': 'Saved Config vs Worker-Applied Receipt',
  'cameraSetup.tour.save.manager.body':
    'Compare the saved configuration version (vN) against the worker receipt here and in the setup checklist. Saving metadata, PPE policies, or polygons updates configuration only—worker-applied requires a fresh matching worker receipt.',
  'cameraSetup.tour.save.readOnly.title': 'Saved Config vs Worker-Applied Receipt',
  'cameraSetup.tour.save.readOnly.body':
    'Review the saved configuration version (vN) alongside the worker application receipt. Saved configuration alone does not confirm worker application or live video.',
  'cameraSetup.tour.checklist.empty.title': 'Persisted Setup Progress & Worker Status',
  'cameraSetup.tour.checklist.empty.body':
    'This checklist tracks real saved setup state—provisioned source registration, confirmed reference image & saved polygon, and saved config vs worker-applied receipt. Viewing this guide never marks setup complete.',
  'cameraSetup.checklist.heading': 'Persisted setup status',
  'cameraSetup.checklist.overall.incomplete': 'Setup incomplete',
  'cameraSetup.checklist.overall.savedOnly': 'Config saved (v{{version}}) · Not worker-applied',
  'cameraSetup.checklist.overall.applied': 'Setup complete · Saved & worker-applied (v{{version}})',
  'cameraSetup.checklist.step.scope': '1. Site & camera',
  'cameraSetup.checklist.step.source': '2. Provisioned source',
  'cameraSetup.checklist.step.polygon': '3. Reference & polygon',
  'cameraSetup.checklist.step.application': '4. Saved vs worker-applied',
  'cameraSetup.checklist.scope.selected': 'Saved · {{code}}',
  'cameraSetup.checklist.scope.noCamera': 'Site selected · No camera saved',
  'cameraSetup.checklist.source.active': 'Saved · Enabled (v{{version}})',
  'cameraSetup.checklist.source.inactive': 'Saved · Disabled (v{{version}})',
  'cameraSetup.checklist.source.missing': 'Not registered yet',
  'cameraSetup.checklist.polygon.saved': 'Saved · {{count}} active region(s)',
  'cameraSetup.checklist.polygon.empty': 'No active polygon saved yet',
  'cameraSetup.checklist.polygon.loading': 'Checking saved regions…',
  'cameraSetup.checklist.polygon.error': 'Saved region status unavailable',
  'cameraSetup.checklist.polygon.needsActiveCamera': 'Requires enabled camera',
  'cameraSetup.checklist.polygon.unverified': 'Saved region check unavailable',
  'cameraSetup.checklist.polygon.needsConfirmation':
    'Confirm active regions on the current camera view',
  'cameraSetup.checklist.app.applied': 'Worker-applied (v{{version}})',
  'cameraSetup.checklist.app.pending': 'Saved only (v{{version}}) · Waiting for worker',
  'cameraSetup.checklist.app.checking': 'Saved v{{version}} · Checking worker…',
  'cameraSetup.checklist.app.stale': 'Saved v{{version}} · Worker receipt stale',
  'cameraSetup.checklist.app.rejected': 'Saved v{{version}} · Worker rejected',
  'cameraSetup.checklist.app.unavailable': 'Saved only (v{{version}}) · Worker unavailable',
  'cameraSetup.checklist.app.none': 'No saved version yet',
  'cameraSetup.checklist.retryRegions': 'Retry region status',
} as const;

const CAMERA_SETUP_TOUR_VI: Record<keyof typeof CAMERA_SETUP_TOUR_EN, string> = {
  'cameraSetup.tour.scope.manager.title': 'Chọn Công trường & Camera',
  'cameraSetup.tour.scope.manager.body':
    'Chọn công trường được phân công (dùng Tải thêm khi có nhiều trang), sau đó chọn camera tại mục Chọn camera trên thẻ Camera đang chọn hoặc nút Chọn dưới danh mục để kiểm tra/cập nhật thiết lập.',
  'cameraSetup.tour.scope.emptyManager.title': 'Chọn Công trường & Bắt đầu Thiết lập Camera',
  'cameraSetup.tour.scope.emptyManager.body':
    'Chọn công trường được phân công (dùng Tải thêm khi có nhiều trang). Công trường này chưa có camera nào được đăng ký—hãy bắt đầu từ Bước 1 (Cấu hình PPE theo Khu vực) và Bước 2 (Đăng ký camera) bên dưới.',
  'cameraSetup.tour.scope.readOnly.title': 'Chọn Công trường & Camera (Chỉ xem)',
  'cameraSetup.tour.scope.readOnly.body':
    'Chọn công trường được phân quyền (dùng Tải thêm khi có nhiều trang) và chọn camera bên dưới để xem cấu hình. Chỉ Quản lý công trường được phân công mới được chỉnh sửa.',
  'cameraSetup.tour.source.title': 'Đăng ký Nguồn đã cấp phát',
  'cameraSetup.tour.source.body':
    'Dùng Đăng ký camera để lưu mã camera, tên hiển thị và Mã nguồn (Source ID) đã được cấp phát sẵn (không nhập URL RTSP hay mật khẩu). Đăng ký chỉ ghi nhận siêu dữ liệu, không cấp phát luồng hay xác nhận kết nối trực tiếp.',
  'cameraSetup.tour.zoneDraw.manager.title': 'Cấu hình Khu vực & Chế độ PPE Vùng',
  'cameraSetup.tour.zoneDraw.manager.body':
    'Mở Cấu hình PPE theo khu vực để tạo khu vực công trường trước khi gắn vùng camera. Mỗi vùng có thể kế thừa mặc định camera, tùy chỉnh PPE riêng hoặc tắt kiểm tra PPE kèm lý do. Hướng dẫn không làm thay đổi bản nháp đang mở.',
  'cameraSetup.tour.zoneDraw.readOnly.title': 'Xem Quy tắc PPE Khu vực & Vùng (Chỉ xem)',
  'cameraSetup.tour.zoneDraw.readOnly.body':
    'Mở Xem khu vực hoặc bảng Chính sách PPE camera bên dưới để kiểm tra khu vực và chế độ PPE từng vùng mà không thay đổi cấu hình.',
  'cameraSetup.tour.ppePolicy.manager.title': 'Chọn PPE Kế thừa, Tùy chỉnh hoặc Tắt',
  'cameraSetup.tour.ppePolicy.manager.body':
    'Mở Chính sách PPE camera (hoặc nhấn Cấu hình chính sách PPE trên camera đang chọn) để đặt mặc định camera và chọn quy tắc từng vùng: Dùng mặc định camera (Kế thừa), Tùy chỉnh (Ghi đè PPE bắt buộc) hoặc Tắt (kèm lý do), đồng thời xem PPE hiệu lực của từng vùng.',
  'cameraSetup.tour.ppePolicy.readOnly.title': 'Xem PPE Hiệu lực Từng vùng (Chỉ xem)',
  'cameraSetup.tour.ppePolicy.readOnly.body':
    'Mở Chính sách PPE camera để xem mặc định camera và quy tắc từng vùng—Dùng mặc định camera (Kế thừa), Tùy chỉnh (Ghi đè) hoặc Tắt—cùng trạng thái đã lưu so với biên nhận worker áp dụng.',
  'cameraSetup.tour.regions.active.title': 'Lấy Ảnh tham chiếu & Vẽ Vùng gọn',
  'cameraSetup.tour.regions.active.body':
    'Mở Sửa vùng quan sát để lấy ảnh tham chiếu 5 phút hiện tại, vẽ một đa giác gọn không tự cắt (tối thiểu 3 đỉnh) bao sát khu vực làm việc, chọn chế độ PPE trên camera v2, tích ô xác nhận rồi nhấn Lưu vùng.',
  'cameraSetup.tour.regions.inactive.title': 'Bật Camera Trước khi Lấy Ảnh tham chiếu',
  'cameraSetup.tour.regions.inactive.body':
    'Camera đang Tắt trong cấu hình đã lưu. Hãy mở Quản lý (Sửa cài đặt camera) để bật camera trước, sau đó mở Vùng quan sát để lấy ảnh tham chiếu 5 phút và vẽ/lưu đa giác vùng gọn.',
  'cameraSetup.tour.save.manager.title': 'Phân biệt Đã lưu & Biên nhận Worker áp dụng',
  'cameraSetup.tour.save.manager.body':
    'Đối chiếu phiên bản cấu hình đã lưu (vN) với biên nhận worker tại đây và trên thanh trạng thái thiết lập. Lưu thông tin, chính sách PPE hay đa giác chỉ cập nhật cấu hình—worker đã áp dụng cần biên nhận mới khớp phiên bản.',
  'cameraSetup.tour.save.readOnly.title': 'Phân biệt Đã lưu & Biên nhận Worker áp dụng',
  'cameraSetup.tour.save.readOnly.body':
    'Xem phiên bản cấu hình đã lưu (vN) cùng biên nhận áp dụng của worker. Cấu hình đã lưu không đồng nghĩa worker đã áp dụng hay có video trực tiếp.',
  'cameraSetup.tour.checklist.empty.title': 'Tiến độ Thiết lập Đã lưu & Trạng thái Worker',
  'cameraSetup.tour.checklist.empty.body':
    'Thanh trạng thái này chỉ phản ánh dữ liệu thực tế đã lưu—đăng ký nguồn cấp sẵn, xác nhận ảnh tham chiếu & lưu đa giác, và đối chiếu đã lưu với worker đã áp dụng. Xem hướng dẫn không đánh dấu hoàn tất thiết lập.',
  'cameraSetup.checklist.heading': 'Trạng thái thiết lập đã lưu',
  'cameraSetup.checklist.overall.incomplete': 'Chưa hoàn tất thiết lập',
  'cameraSetup.checklist.overall.savedOnly': 'Đã lưu cấu hình (v{{version}}) · Worker chưa áp dụng',
  'cameraSetup.checklist.overall.applied':
    'Hoàn tất thiết lập · Đã lưu & worker đã áp dụng (v{{version}})',
  'cameraSetup.checklist.step.scope': '1. Công trường & camera',
  'cameraSetup.checklist.step.source': '2. Nguồn đã cấp phát',
  'cameraSetup.checklist.step.polygon': '3. Ảnh tham chiếu & đa giác',
  'cameraSetup.checklist.step.application': '4. Đã lưu vs worker áp dụng',
  'cameraSetup.checklist.scope.selected': 'Đã lưu · {{code}}',
  'cameraSetup.checklist.scope.noCamera': 'Đã chọn công trường · Chưa có camera',
  'cameraSetup.checklist.source.active': 'Đã lưu · Đang bật (v{{version}})',
  'cameraSetup.checklist.source.inactive': 'Đã lưu · Đang tắt (v{{version}})',
  'cameraSetup.checklist.source.missing': 'Chưa đăng ký',
  'cameraSetup.checklist.polygon.saved': 'Đã lưu · {{count}} vùng đang bật',
  'cameraSetup.checklist.polygon.empty': 'Chưa lưu đa giác vùng đang bật',
  'cameraSetup.checklist.polygon.loading': 'Đang kiểm tra vùng đã lưu…',
  'cameraSetup.checklist.polygon.error': 'Không tải được trạng thái vùng đã lưu',
  'cameraSetup.checklist.polygon.needsActiveCamera': 'Cần camera đang bật',
  'cameraSetup.checklist.polygon.unverified': 'Chưa kiểm tra được vùng đã lưu',
  'cameraSetup.checklist.polygon.needsConfirmation':
    'Xác nhận các vùng đang bật trên góc camera hiện tại',
  'cameraSetup.checklist.app.applied': 'Worker đã áp dụng (v{{version}})',
  'cameraSetup.checklist.app.pending': 'Chỉ mới lưu (v{{version}}) · Chờ worker',
  'cameraSetup.checklist.app.checking': 'Đã lưu v{{version}} · Đang kiểm tra worker…',
  'cameraSetup.checklist.app.stale': 'Đã lưu v{{version}} · Biên nhận worker cũ',
  'cameraSetup.checklist.app.rejected': 'Đã lưu v{{version}} · Worker từ chối',
  'cameraSetup.checklist.app.unavailable': 'Chỉ mới lưu (v{{version}}) · Chưa rõ worker',
  'cameraSetup.checklist.app.none': 'Chưa có phiên bản đã lưu',
  'cameraSetup.checklist.retryRegions': 'Thử tải lại trạng thái vùng',
};

export function registerCameraSetupTourCopy(): void {
  registerFeatureCatalog({
    en: CAMERA_SETUP_TOUR_EN,
    vi: CAMERA_SETUP_TOUR_VI,
  });
}

registerCameraSetupTourCopy();

export interface CameraSetupWorkspaceTourOptions {
  hasSiteScope: boolean;
  canManageCameras: boolean;
  canAccessZones: boolean;
  hasSelectedCamera: boolean;
  isSelectedCameraActive: boolean;
}

export function buildCameraSetupWorkspaceTourSteps(
  options: CameraSetupWorkspaceTourOptions,
): readonly SafetyTourStepSpec[] {
  const scopePrefix = options.canManageCameras
    ? options.hasSelectedCamera
      ? 'cameraSetup.tour.scope.manager'
      : 'cameraSetup.tour.scope.emptyManager'
    : 'cameraSetup.tour.scope.readOnly';
  const zonePrefix = options.canManageCameras
    ? 'cameraSetup.tour.zoneDraw.manager'
    : 'cameraSetup.tour.zoneDraw.readOnly';
  const ppePolicyPrefix = options.canManageCameras
    ? 'cameraSetup.tour.ppePolicy.manager'
    : 'cameraSetup.tour.ppePolicy.readOnly';
  const regionsPrefix = options.isSelectedCameraActive
    ? 'cameraSetup.tour.regions.active'
    : 'cameraSetup.tour.regions.inactive';
  const savePrefix = options.canManageCameras
    ? 'cameraSetup.tour.save.manager'
    : 'cameraSetup.tour.save.readOnly';

  return [
    {
      id: 'camera-setup-scope',
      anchorSelector: '[data-tour-anchor="camera-setup-scope"]',
      titleKey: `${scopePrefix}.title`,
      bodyKey: `${scopePrefix}.body`,
      isAllowed: () => options.hasSiteScope,
    },
    {
      id: 'camera-setup-source',
      anchorSelector: '[data-tour-anchor="camera-setup-source"]',
      titleKey: 'cameraSetup.tour.source.title',
      bodyKey: 'cameraSetup.tour.source.body',
      isAllowed: () => options.hasSiteScope && options.canManageCameras,
    },
    {
      id: 'camera-setup-zone-draw',
      anchorSelector: '[data-tour-anchor="camera-setup-zone-draw"]',
      titleKey: `${zonePrefix}.title`,
      bodyKey: `${zonePrefix}.body`,
      isAllowed: () => options.hasSiteScope && (options.canManageCameras || options.canAccessZones),
    },
    {
      id: 'camera-setup-ppe-policy',
      anchorSelector: '[data-testid="camera-ppe-policy-panel"]',
      titleKey: `${ppePolicyPrefix}.title`,
      bodyKey: `${ppePolicyPrefix}.body`,
      isAllowed: () =>
        options.hasSiteScope &&
        options.hasSelectedCamera &&
        (options.canManageCameras || options.canAccessZones),
    },
    {
      id: 'camera-setup-regions',
      anchorSelector: '[data-tour-anchor="camera-setup-regions"]',
      titleKey: `${regionsPrefix}.title`,
      bodyKey: `${regionsPrefix}.body`,
      isAllowed: () =>
        options.hasSiteScope && options.canManageCameras && options.hasSelectedCamera,
    },
    {
      id: 'camera-setup-save',
      anchorSelector: '[data-tour-anchor="camera-setup-save"]',
      titleKey: `${savePrefix}.title`,
      bodyKey: `${savePrefix}.body`,
      isAllowed: () => options.hasSiteScope && options.hasSelectedCamera,
    },
    {
      id: 'camera-setup-checklist',
      anchorSelector: '[data-tour-anchor="camera-setup-checklist"]',
      titleKey: 'cameraSetup.tour.checklist.empty.title',
      bodyKey: 'cameraSetup.tour.checklist.empty.body',
      isAllowed: () => options.hasSiteScope && !options.hasSelectedCamera,
    },
  ];
}

export type CameraSetupOverallState = 'INCOMPLETE' | 'SAVED_NOT_APPLIED' | 'APPLIED';
export type CameraSetupMilestoneStatus = 'complete' | 'pending' | 'attention';
export type CameraSetupMilestoneId = 'scope' | 'source' | 'polygon' | 'application';

export interface CameraSetupMilestoneItem {
  readonly id: CameraSetupMilestoneId;
  readonly labelKey: keyof typeof CAMERA_SETUP_TOUR_EN;
  readonly valueKey: keyof typeof CAMERA_SETUP_TOUR_EN;
  readonly valueParams?: Record<string, string | number>;
  readonly status: CameraSetupMilestoneStatus;
}

export interface CameraSetupChecklistState {
  readonly overallState: CameraSetupOverallState;
  readonly overallKey: keyof typeof CAMERA_SETUP_TOUR_EN;
  readonly overallParams?: Record<string, string | number>;
  readonly isConfigSaved: boolean;
  readonly isWorkerApplied: boolean;
  readonly isSetupComplete: boolean;
  readonly items: readonly CameraSetupMilestoneItem[];
}

export function resolveCameraSetupChecklistState(input: {
  hasSite: boolean;
  selectedCamera: Pick<CameraResponse, 'id' | 'code' | 'status' | 'configurationVersion'> | null;
  regionsState: 'idle' | 'loading' | 'error' | 'needs-confirmation' | 'ready';
  activeRegionCount: number;
  savedVsApplied: SavedVsAppliedState;
}): CameraSetupChecklistState {
  const { hasSite, selectedCamera, regionsState, activeRegionCount, savedVsApplied } = input;
  const isCameraActive = selectedCamera?.status === 'ACTIVE';
  const version = selectedCamera?.configurationVersion ?? 0;

  const scopeItem: CameraSetupMilestoneItem =
    hasSite && selectedCamera
      ? {
          id: 'scope',
          labelKey: 'cameraSetup.checklist.step.scope',
          valueKey: 'cameraSetup.checklist.scope.selected',
          valueParams: { code: selectedCamera.code },
          status: 'complete',
        }
      : {
          id: 'scope',
          labelKey: 'cameraSetup.checklist.step.scope',
          valueKey: 'cameraSetup.checklist.scope.noCamera',
          status: 'pending',
        };

  const sourceItem: CameraSetupMilestoneItem = !selectedCamera
    ? {
        id: 'source',
        labelKey: 'cameraSetup.checklist.step.source',
        valueKey: 'cameraSetup.checklist.source.missing',
        status: 'pending',
      }
    : isCameraActive
      ? {
          id: 'source',
          labelKey: 'cameraSetup.checklist.step.source',
          valueKey: 'cameraSetup.checklist.source.active',
          valueParams: { version },
          status: 'complete',
        }
      : {
          id: 'source',
          labelKey: 'cameraSetup.checklist.step.source',
          valueKey: 'cameraSetup.checklist.source.inactive',
          valueParams: { version },
          status: 'attention',
        };

  const polygonItem: CameraSetupMilestoneItem =
    !selectedCamera || !isCameraActive
      ? {
          id: 'polygon',
          labelKey: 'cameraSetup.checklist.step.polygon',
          valueKey: 'cameraSetup.checklist.polygon.needsActiveCamera',
          status: 'pending',
        }
      : regionsState === 'loading'
        ? {
            id: 'polygon',
            labelKey: 'cameraSetup.checklist.step.polygon',
            valueKey: 'cameraSetup.checklist.polygon.loading',
            status: 'pending',
          }
        : regionsState === 'error'
          ? {
              id: 'polygon',
              labelKey: 'cameraSetup.checklist.step.polygon',
              valueKey: 'cameraSetup.checklist.polygon.error',
              status: 'attention',
            }
          : regionsState === 'idle'
            ? {
                id: 'polygon',
                labelKey: 'cameraSetup.checklist.step.polygon',
                valueKey: 'cameraSetup.checklist.polygon.unverified',
                status: 'pending',
              }
            : regionsState === 'needs-confirmation'
              ? {
                  id: 'polygon',
                  labelKey: 'cameraSetup.checklist.step.polygon',
                  valueKey: 'cameraSetup.checklist.polygon.needsConfirmation',
                  status: 'attention',
                }
              : activeRegionCount > 0
                ? {
                    id: 'polygon',
                    labelKey: 'cameraSetup.checklist.step.polygon',
                    valueKey: 'cameraSetup.checklist.polygon.saved',
                    valueParams: { count: activeRegionCount },
                    status: 'complete',
                  }
                : {
                    id: 'polygon',
                    labelKey: 'cameraSetup.checklist.step.polygon',
                    valueKey: 'cameraSetup.checklist.polygon.empty',
                    status: 'pending',
                  };

  const applicationItem: CameraSetupMilestoneItem = !selectedCamera
    ? {
        id: 'application',
        labelKey: 'cameraSetup.checklist.step.application',
        valueKey: 'cameraSetup.checklist.app.none',
        status: 'pending',
      }
    : savedVsApplied.kind === 'applied'
      ? {
          id: 'application',
          labelKey: 'cameraSetup.checklist.step.application',
          valueKey: 'cameraSetup.checklist.app.applied',
          valueParams: { version },
          status: 'complete',
        }
      : savedVsApplied.kind === 'checking'
        ? {
            id: 'application',
            labelKey: 'cameraSetup.checklist.step.application',
            valueKey: 'cameraSetup.checklist.app.checking',
            valueParams: { version },
            status: 'pending',
          }
        : savedVsApplied.kind === 'stale'
          ? {
              id: 'application',
              labelKey: 'cameraSetup.checklist.step.application',
              valueKey: 'cameraSetup.checklist.app.stale',
              valueParams: { version },
              status: 'attention',
            }
          : savedVsApplied.kind === 'rejected'
            ? {
                id: 'application',
                labelKey: 'cameraSetup.checklist.step.application',
                valueKey: 'cameraSetup.checklist.app.rejected',
                valueParams: { version },
                status: 'attention',
              }
            : savedVsApplied.kind === 'no-worker-status' ||
                savedVsApplied.kind === 'worker-unavailable'
              ? {
                  id: 'application',
                  labelKey: 'cameraSetup.checklist.step.application',
                  valueKey: 'cameraSetup.checklist.app.unavailable',
                  valueParams: { version },
                  status: 'pending',
                }
              : {
                  id: 'application',
                  labelKey: 'cameraSetup.checklist.step.application',
                  valueKey: 'cameraSetup.checklist.app.pending',
                  valueParams: { version },
                  status: 'pending',
                };

  const isConfigSaved = Boolean(
    hasSite && isCameraActive && regionsState === 'ready' && activeRegionCount > 0,
  );
  const isWorkerApplied = Boolean(selectedCamera && savedVsApplied.kind === 'applied');
  const isSetupComplete = isConfigSaved && isWorkerApplied;

  const overallState: CameraSetupOverallState = isSetupComplete
    ? 'APPLIED'
    : isConfigSaved
      ? 'SAVED_NOT_APPLIED'
      : 'INCOMPLETE';

  const overallKey =
    overallState === 'APPLIED'
      ? 'cameraSetup.checklist.overall.applied'
      : overallState === 'SAVED_NOT_APPLIED'
        ? 'cameraSetup.checklist.overall.savedOnly'
        : 'cameraSetup.checklist.overall.incomplete';

  return {
    overallState,
    overallKey,
    overallParams: selectedCamera ? { version } : undefined,
    isConfigSaved,
    isWorkerApplied,
    isSetupComplete,
    items: [scopeItem, sourceItem, polygonItem, applicationItem],
  };
}
