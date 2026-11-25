import {
  hasRegisteredFeatureKey,
  registerFeatureCatalog,
} from '../../i18n/feature-catalog-registry';

export const ZONE_MONITOR_EN = {
  'zoneMonitor.header.subtitle':
    'Monitor restricted area boundaries and camera status for the selected site.',
  'zoneMonitor.toolbar.boundarySummary': 'AI boundary info',
  'zoneMonitor.toolbar.editPolygon': 'Edit zone polygon',
  'zoneMonitor.inspectorRail.regionLabel': 'Region #{{index}} ({{status}})',
  'zoneMonitor.inspectorRail.regionActive': 'Active',
  'zoneMonitor.inspectorRail.regionInactive': 'Inactive',
  'zoneMonitor.inspectorRail.aiBoundaryNote':
    'Saved region boundaries are stored in site configuration and apply on the camera only after the edge worker confirms that revision. Assigned Site Managers edit zone polygons in Camera Setup.',
  'zoneMonitor.inspectorRail.monitorStatus': 'Monitor status',
  'zoneMonitor.inspectorRail.liveVideo': 'Live video stage',
  'zoneMonitor.region.zoneUnavailable': 'Zone unavailable',
  'zoneMonitor.region.policyProhibited': 'Prohibited',
  'zoneMonitor.region.policyAuthorizationRequired': 'Authorization required',
  'zoneMonitor.region.policyNone': 'No entry restriction',
  'zoneMonitor.region.policyUnavailable': 'Policy unavailable',
  'zoneMonitor.region.tag': 'Region #{{ordinal}} · v{{version}}',
  'zoneMonitor.region.option': '{{zone}} · {{policy}} · Region #{{ordinal}} (v{{version}})',
  'zoneMonitor.region.optionInactive':
    '{{zone}} · {{policy}} · Region #{{ordinal}} (v{{version}} · Inactive)',
  'zoneMonitor.region.noneConfigured': 'No regions configured on this camera',
  'zoneMonitor.status.savedConfig': 'Saved config v{{version}}',
  'zoneMonitor.status.aiPaused': 'AI paused',
  'zoneMonitor.status.workerLoaded': 'AI has received configuration',
  'zoneMonitor.status.workerPending': 'Waiting for AI application',
  'zoneMonitor.status.workerUnconfirmed': 'AI has not confirmed yet',
  'zoneMonitor.status.workerStale': 'No recent confirmation from AI',
  'zoneMonitor.status.workerRejected': 'AI could not apply configuration',
  'zoneMonitor.status.workerChecking': 'Checking AI…',
  'zoneMonitor.status.workerUnavailable': 'Unable to confirm AI',
  'zoneMonitor.standalone.title': 'Site camera region configuration',
  'zoneMonitor.standalone.signInHint':
    'Sign in as an assigned Site Manager to load site regions and save polygon changes to Backend configuration.',
  'zoneMonitor.standalone.usernameLabel': 'Site Manager username',
  'zoneMonitor.standalone.signInButton': 'Sign in as Site Manager',
  'zoneMonitor.standalone.roleRequired': 'An assigned Site Manager role for a site is required.',
  'zoneMonitor.standalone.signInBeforeSave':
    'Sign in as an assigned Site Manager before saving to Backend.',
  'zoneMonitor.standalone.sessionActive': 'Site Manager Session Active',
  'zoneMonitor.standalone.sessionNote':
    'Assigned Site Manager verified. Polygons saved here update Backend configuration version only; live enforcement requires worker confirmation.',
  'zoneMonitor.empty.loading': 'Loading site and camera availability…',
  'zoneMonitor.empty.sitesErrorTitle': 'Could not load authorized sites.',
  'zoneMonitor.empty.camerasErrorTitle': 'Could not load monitoring cameras for this site.',
  'zoneMonitor.empty.errorHint': 'Check your connection and retry.',
  'zoneMonitor.empty.retry': 'Retry',
  'zoneMonitor.empty.deniedTitle': 'Camera access is restricted for this session.',
  'zoneMonitor.empty.deniedHint':
    'Your account does not have permission to view cameras for this site.',
  'zoneMonitor.empty.linkedSiteTitle': 'The linked site is unavailable.',
  'zoneMonitor.empty.linkedSiteHint': 'Select an available site to continue.',
  'zoneMonitor.empty.switchAvailableSite': 'Switch to available site',
  'zoneMonitor.empty.noSitesTitle': 'No sites available.',
  'zoneMonitor.empty.noSitesHint': 'No assigned site is available for this account.',
  'zoneMonitor.empty.linkedCameraTitle': 'The linked camera is unavailable for zone monitoring.',
  'zoneMonitor.empty.linkedCameraHint':
    'It may be disabled in configuration, assigned to a gate, or belong to another site.',
  'zoneMonitor.empty.showAvailableCamera': 'Show available camera',
  'zoneMonitor.empty.allInactiveTitle': 'No active zone cameras on this site.',
  'zoneMonitor.empty.allInactiveDetail':
    '{{count}} zone camera(s) are saved as Disabled in configuration.',
  'zoneMonitor.empty.noZoneCamerasTitle': 'No zone cameras registered for this site.',
  'zoneMonitor.empty.noZoneCamerasGateNote':
    '{{count}} gate camera(s) are managed separately in Site Setup and do not monitor restricted zones.',
  'zoneMonitor.empty.managerHint':
    'Configure a camera source and enable a zone camera in Camera Setup to start monitoring.',
  'zoneMonitor.empty.officerHint':
    'Camera registration and enabling are managed by the assigned Site Manager.',
  'zoneMonitor.empty.openCameraSetup': 'Open Camera Setup',
} as const;

export type ZoneMonitorKey = keyof typeof ZONE_MONITOR_EN;

export const ZONE_MONITOR_VI: Record<ZoneMonitorKey, string> = {
  'zoneMonitor.header.subtitle':
    'Theo dõi ranh giới khu vực hạn chế và trạng thái camera theo công trường đang chọn.',
  'zoneMonitor.toolbar.boundarySummary': 'Thông tin vùng AI',
  'zoneMonitor.toolbar.editPolygon': 'Sửa đa giác vùng',
  'zoneMonitor.inspectorRail.regionLabel': 'Vùng #{{index}} ({{status}})',
  'zoneMonitor.inspectorRail.regionActive': 'Đang bật',
  'zoneMonitor.inspectorRail.regionInactive': 'Đang tắt',
  'zoneMonitor.inspectorRail.aiBoundaryNote':
    'Ranh giới vùng được lưu trong cấu hình công trường và chỉ có hiệu lực trên camera sau khi edge worker xác nhận phiên bản đó. Quản lý công trường được phân công chỉnh sửa đa giác vùng tại Thiết lập camera.',
  'zoneMonitor.inspectorRail.monitorStatus': 'Trạng thái giám sát',
  'zoneMonitor.inspectorRail.liveVideo': 'Hình ảnh trực tiếp',
  'zoneMonitor.region.zoneUnavailable': 'Chưa có tên khu vực',
  'zoneMonitor.region.policyProhibited': 'Cấm vào',
  'zoneMonitor.region.policyAuthorizationRequired': 'Cần cấp phép',
  'zoneMonitor.region.policyNone': 'Không hạn chế ra vào',
  'zoneMonitor.region.policyUnavailable': 'Chưa rõ chính sách',
  'zoneMonitor.region.tag': 'Vùng #{{ordinal}} · v{{version}}',
  'zoneMonitor.region.option': '{{zone}} · {{policy}} · Vùng #{{ordinal}} (v{{version}})',
  'zoneMonitor.region.optionInactive':
    '{{zone}} · {{policy}} · Vùng #{{ordinal}} (v{{version}} · Đang tắt)',
  'zoneMonitor.region.noneConfigured': 'Chưa cấu hình vùng nào trên camera này',
  'zoneMonitor.status.savedConfig': 'Cấu hình đã lưu v{{version}}',
  'zoneMonitor.status.aiPaused': 'AI đang tạm dừng',
  'zoneMonitor.status.workerLoaded': 'Máy AI đã nhận cấu hình',
  'zoneMonitor.status.workerPending': 'Chờ máy AI áp dụng',
  'zoneMonitor.status.workerUnconfirmed': 'Máy AI chưa xác nhận',
  'zoneMonitor.status.workerStale': 'Chưa có xác nhận mới từ máy AI',
  'zoneMonitor.status.workerRejected': 'Máy AI không áp dụng được cấu hình',
  'zoneMonitor.status.workerChecking': 'Đang kiểm tra máy AI…',
  'zoneMonitor.status.workerUnavailable': 'Chưa xác nhận được máy AI',
  'zoneMonitor.standalone.title': 'Cấu hình vùng camera công trường',
  'zoneMonitor.standalone.signInHint':
    'Đăng nhập bằng tài khoản Quản lý công trường được phân công để tải vùng công trường và lưu thay đổi đa giác lên cấu hình Backend.',
  'zoneMonitor.standalone.usernameLabel': 'Tên đăng nhập Quản lý công trường',
  'zoneMonitor.standalone.signInButton': 'Đăng nhập Quản lý công trường',
  'zoneMonitor.standalone.roleRequired':
    'Cần quyền Quản lý công trường được phân công cho một công trường.',
  'zoneMonitor.standalone.signInBeforeSave':
    'Đăng nhập bằng tài khoản Quản lý công trường trước khi lưu lên Backend.',
  'zoneMonitor.standalone.sessionActive': 'Phiên Quản lý công trường đang hoạt động',
  'zoneMonitor.standalone.sessionNote':
    'Đã xác thực Quản lý công trường được phân công. Đa giác lưu tại đây chỉ cập nhật phiên bản cấu hình Backend; việc áp dụng trực tiếp cần xác nhận từ worker.',
  'zoneMonitor.empty.loading': 'Đang tải danh sách công trường và camera…',
  'zoneMonitor.empty.sitesErrorTitle': 'Không tải được danh sách công trường được phân quyền.',
  'zoneMonitor.empty.camerasErrorTitle':
    'Không tải được danh sách camera giám sát của công trường này.',
  'zoneMonitor.empty.errorHint': 'Kiểm tra kết nối và thử lại.',
  'zoneMonitor.empty.retry': 'Thử lại',
  'zoneMonitor.empty.deniedTitle': 'Phiên hiện tại không có quyền xem camera này.',
  'zoneMonitor.empty.deniedHint':
    'Tài khoản này chưa được cấp quyền xem camera tại công trường đang chọn.',
  'zoneMonitor.empty.linkedSiteTitle': 'Công trường trong liên kết không khả dụng.',
  'zoneMonitor.empty.linkedSiteHint': 'Chọn một công trường khả dụng để tiếp tục.',
  'zoneMonitor.empty.switchAvailableSite': 'Chuyển sang công trường khả dụng',
  'zoneMonitor.empty.noSitesTitle': 'Không có công trường khả dụng.',
  'zoneMonitor.empty.noSitesHint': 'Tài khoản này chưa được phân công công trường khả dụng.',
  'zoneMonitor.empty.linkedCameraTitle':
    'Camera trong liên kết không khả dụng để giám sát khu vực.',
  'zoneMonitor.empty.linkedCameraHint':
    'Camera có thể đang tắt trong cấu hình, là camera cổng, hoặc thuộc công trường khác.',
  'zoneMonitor.empty.showAvailableCamera': 'Xem camera khả dụng',
  'zoneMonitor.empty.allInactiveTitle': 'Chưa có camera khu vực nào đang hoạt động.',
  'zoneMonitor.empty.allInactiveDetail':
    'Có {{count}} camera khu vực đang ở trạng thái Đang tắt trong cấu hình.',
  'zoneMonitor.empty.noZoneCamerasTitle':
    'Chưa có camera khu vực nào được đăng ký cho công trường này.',
  'zoneMonitor.empty.noZoneCamerasGateNote':
    'Có {{count}} camera cổng được quản lý riêng tại Thiết lập công trường và không dùng để giám sát khu vực hạn chế.',
  'zoneMonitor.empty.managerHint':
    'Cấu hình nguồn camera và bật camera khu vực trong Thiết lập camera để bắt đầu giám sát.',
  'zoneMonitor.empty.officerHint':
    'Việc đăng ký và bật camera thuộc quyền của Quản lý công trường được phân công.',
  'zoneMonitor.empty.openCameraSetup': 'Mở Thiết lập camera',
};

export function registerZoneMonitorCatalog(): void {
  if (hasRegisteredFeatureKey('zoneMonitor.status.savedConfig')) {
    return;
  }
  registerFeatureCatalog({
    en: ZONE_MONITOR_EN,
    vi: ZONE_MONITOR_VI,
  });
}

registerZoneMonitorCatalog();
