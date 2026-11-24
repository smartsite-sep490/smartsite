import type { PPE_FAMILY_CATALOG, PpeFamily, PpeItem } from '@smartsite/contracts/ppe-items';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const en = {
  title: 'Camera PPE policy',
  subtitle: 'Set camera or region PPE rules and compare saved vs applied state.',
  referenceRequired:
    'First get a reference image in observation-region setup. Then return here to save PPE rules. Your draft stays here.',
  referenceRevalidationRequired:
    'Camera view or active regions need confirmation on a fresh reference image before saving PPE changes. Open observation-region setup, confirm the reference view, then return here — your draft stays preserved.',
  openReference: 'Set up reference image',
  refreshWorkerStatus: 'Refresh worker status',
  jumpToApplyWorker: 'Go to apply on worker',
  modelCapabilityDistinction:
    'Required PPE vs model support: editing checkboxes saves the desired PPE policy revision on Backend only; actual detection depends on the classes supported by the active worker model artifact (no per-camera model weights are changed here).',
  target: 'Policy scope',
  camera: 'Camera default',
  region: 'Region',
  mode: 'Policy mode',
  choose: 'Choose mode',
  EXPLICIT: 'Custom PPE',
  DISABLED: 'Disable PPE',
  INHERIT: 'Camera default',
  reason: 'Reason',
  save: 'Save PPE policy',
  loading: 'Loading saved PPE policy…',
  error: 'Could not load the PPE policy.',
  retry: 'Retry',
  failed: 'Could not save the PPE policy. Retry or refresh the configuration.',
  failed400:
    'Invalid PPE policy input. Verify the selected PPE items or disable reason and try again.',
  failed403: 'You do not have permission to modify PPE policies for this Site.',
  failed404:
    'Target camera or observation region was not found. Refresh the catalog and try again.',
  failed409:
    'Could not save: the configuration changed or the camera view needs confirmation. Check the reference image and latest policy, then try again. Your draft is preserved.',
  failed429: 'Too many policy save requests. Wait a moment before trying again.',
  unsavedDraftBadge: 'Unsaved draft',
  preservedRegionDrafts:
    '{{count}} per-region draft(s) preserved after reload — select each region in Policy scope to review and save, or click Reset draft.',
  resetDraft: 'Reset draft',
  saved: 'Saved revision {{revision}}. Check worker status separately.',
  current: 'Saved revision {{revision}}',
  absent: 'No saved v2 policy for this scope.',
  initialize: 'Initialize PPE policies',
  activation: 'Activate region with this policy',
  'item.HARD_HAT': 'Hard hat',
  'item.SAFETY_VEST': 'Safety vest',
  'item.GLOVES': 'Gloves',
  'item.BOOTS': 'Boots',
  'item.GOGGLES': 'Goggles',
  'item.MASK': 'Mask',
  'item.FULL_BODY_HARNESS': 'Full-body harness',
  'item.LANYARD_HOOK': 'Lanyard hook',
  requiredItemsGroup: 'Required PPE items',
  readinessCoreBadge: 'Core',
  readinessExperimentalBadge: 'Experimental',
  readinessGuidanceNote:
    'Hard hat, vest: baseline; gloves, boots, goggles: experimental. Saved changes apply once camera confirms.',
  catalogUnsupportedSummary:
    'Unsupported PPE types ({{unsupportedCount}} of {{totalCount}}): {{names}}',
  catalogSemanticsPresentOnly: 'Presence only',
  catalogSemanticsContractPending: 'Not configurable yet',
  'catalogReason.NOT_IN_POLICY_CONTRACT': 'Cannot be selected as a required monitoring rule yet.',
  'catalogReason.PRESENT_ONLY_SAFETY_BOUNDARY':
    'Shows equipment presence only; does not confirm proper wearing or tie-off and cannot trigger automatic alerts.',
  catalogBoundaryNote:
    '{{totalCount}} PPE types in total: {{selectableCount}} can be selected for rules today, {{unsupportedCount}} are not selectable yet. Listing an item here does not mean the AI model is running or verified for it.',
  capabilityNoteSummary: 'Policy vs AI model capability notes',
  validationExplicitEmpty: 'Select at least one PPE item before saving this custom policy.',
  validationDisabledReasonRequired: 'Enter a reason for turning off PPE checks before saving.',
  validationDisabledReasonInvalid:
    'Enter a valid reason (up to 500 characters, without control characters) before saving.',
  'modeBadge.INHERIT': 'Use camera default',
  'modeBadge.EXPLICIT': 'Custom',
  'modeBadge.DISABLED': 'Disabled',
  'modeBadge.UNCONFIGURED': 'Not configured',
  cameraSummaryHeading: 'Camera default policy',
  cameraUninitializedNote:
    'Camera default PPE policy (v2) is not initialized yet. Effective PPE is unavailable until configured.',
  editCameraDefault: 'Edit camera default',
  regionsHeading: 'Regions on this camera ({{count}})',
  regionsEmpty: 'No observation regions linked to this camera yet.',
  effectivePpeLabel: 'Effective PPE',
  effectiveFromCamera: 'From camera default',
  effectiveFromRegion: 'Custom on this region',
  effectiveDisabled: 'PPE checks disabled',
  effectiveDisabledByCamera: 'PPE checks disabled (via camera default)',
  effectiveReason: 'Reason: {{reason}}',
  effectiveUnknownUninitialized:
    'Effective PPE unavailable — this region has no saved v2 PPE policy.',
  effectiveUnknownCameraDefault:
    'Effective PPE unavailable — camera default policy is not initialized.',
  effectiveLoading: 'Loading region policy…',
  effectiveError: 'Could not load saved policy for this region.',
  previewHeading: 'Effective PPE if saved',
  previewRequiresCameraInit:
    'Select or save a valid camera default policy to preview inherited PPE.',
  impactHeading: 'Affected regions on this camera',
  impactInheriting: 'Inherits camera default ({{count}}): {{names}}',
  impactNoneInheriting:
    'No active regions currently inherit the camera default (applies outside region overrides).',
  impactUnaffected: 'Keeps custom or disabled rule ({{count}}): {{names}}',
  impactPreviewEffective: 'Effective PPE for inheriting regions & unzoned camera area:',
  regionActive: 'Active',
  regionInactive: 'Inactive',
  regionVersionMeta: 'Region v{{version}}',
  regionNumberBadge: 'Region #{{index}}',
  regionUnresolvedLabel: 'Observation region #{{index}}',
  zoneMetadataUnavailable: 'Zone metadata unavailable',
  technicalIdsSummary: 'Technical IDs',
  technicalZoneCode: 'Zone code: {{code}}',
  technicalRegionId: 'Region ID: {{id}}',
  technicalZoneId: 'Zone ID: {{id}}',
  capabilityTruthNote:
    'Saved PPE selections record desired policy configuration only. Live enforcement requires a matching worker-applied receipt and depends on the PPE classes supported by the active worker model (no per-camera model-quality badges are reported here).',
  editRegion: 'Edit',
  editRegionAria: 'Edit policy for {{target}}',
  readOnlyNotice:
    'Read-only mode: Site Manager role is required to modify camera or region PPE policies.',
  editorHeading: 'Edit policy scope',
  savedConfigMeta: 'Config v{{configVersion}} · Policy rev {{revision}}',
  savedConfigOnlyMeta: 'Saved config v{{configVersion}} · No saved v2 policy',
  syncHeading: 'Saved vs worker-applied status',
  syncSavedVersion: 'Saved config: v{{version}}',
  syncSavedUnknown: 'Saved config: unavailable',
  syncApplied: 'Applied by worker (ACK v{{reported}})',
  syncNotYetApplied: 'Saved only · Not yet applied to this revision (worker ACK: {{reported}})',
  syncPending: 'Saved only · Applying / awaiting worker ACK (reported: {{reported}})',
  syncUnconfirmed: 'Saved only · Not confirmed by worker (no ACK yet)',
  syncStale:
    'Worker ACK stale · Saved revision is not currently confirmed (last ACK: {{reported}})',
  syncRejected: 'Worker rejected configuration ({{reason}})',
  syncUnavailable: 'Saved configuration only · Worker application status unavailable',
  syncNoContext: 'Saved configuration only · Check camera worker status separately',
  syncChecking: 'Checking worker application status…',
  syncNoneReported: 'none',
  regionSyncApplied: 'Worker applied (v{{version}})',
  regionSyncInactive: 'Saved v{{version}} · Region inactive',
  regionSyncNotApplied: 'Saved v{{version}} · Not yet confirmed by worker',
  regionSyncUnavailable: 'Saved v{{version}} · Worker ACK unavailable',
  regionSyncUnconfigured: 'Not saved in v2',
} as const;

const vi: Record<keyof typeof en, string> = {
  title: 'Chính sách PPE',
  subtitle: 'Cấu hình PPE cho camera hoặc vùng, đối chiếu trạng thái đã áp dụng.',
  referenceRequired:
    'Trước tiên, lấy ảnh tham chiếu trong phần vùng quan sát. Sau đó quay lại đây để lưu yêu cầu PPE. Bản nháp được giữ nguyên.',
  referenceRevalidationRequired:
    'Góc nhìn camera hoặc vùng quan sát đang bật cần xác nhận lại trên ảnh tham chiếu mới trước khi lưu thay đổi PPE. Mở phần vùng quan sát để xác nhận rồi quay lại đây — bản nháp vẫn được giữ nguyên.',
  openReference: 'Thiết lập ảnh tham chiếu',
  refreshWorkerStatus: 'Làm mới trạng thái worker',
  jumpToApplyWorker: 'Đi tới áp dụng cho worker',
  modelCapabilityDistinction:
    'Phân biệt PPE bắt buộc và năng lực mô hình: thay đổi ở đây chỉ lưu phiên bản chính sách PPE mong muốn trên máy chủ; khả năng nhận diện thực tế vẫn phụ thuộc các lớp PPE mà tệp mô hình của worker đang nạp hỗ trợ (không thay đổi trọng số mô hình theo từng camera).',
  target: 'Phạm vi chính sách',
  camera: 'Mặc định camera',
  region: 'Vùng',
  mode: 'Chế độ chính sách',
  choose: 'Chọn chế độ',
  EXPLICIT: 'Tùy chỉnh PPE',
  DISABLED: 'Tắt kiểm tra',
  INHERIT: 'Theo mặc định',
  reason: 'Lý do',
  save: 'Lưu chính sách PPE',
  loading: 'Đang tải chính sách PPE…',
  error: 'Không tải được chính sách PPE.',
  retry: 'Thử lại',
  failed: 'Không lưu được chính sách PPE. Hãy thử lại hoặc tải lại cấu hình.',
  failed400:
    'Dữ liệu chính sách PPE chưa hợp lệ. Hãy kiểm tra danh sách PPE đã chọn hoặc lý do tắt rồi thử lại.',
  failed403: 'Bạn không có quyền thay đổi chính sách PPE tại công trường này.',
  failed404:
    'Không tìm thấy camera hoặc vùng quan sát mục tiêu. Vui lòng làm mới danh mục và thử lại.',
  failed409:
    'Chưa lưu được: cấu hình đã thay đổi hoặc góc nhìn camera cần xác nhận. Kiểm tra ảnh tham chiếu và chính sách mới nhất rồi thử lại. Bản nháp được giữ nguyên.',
  failed429: 'Quá nhiều yêu cầu lưu chính sách. Vui lòng chờ giây lát rồi thử lại.',
  unsavedDraftBadge: 'Bản nháp chưa lưu',
  preservedRegionDrafts:
    'Đã giữ nguyên {{count}} bản nháp theo vùng sau khi tải lại — hãy chọn từng vùng tại Phạm vi chính sách để xem và lưu, hoặc nhấn Đặt lại bản nháp.',
  resetDraft: 'Đặt lại bản nháp',
  saved: 'Đã lưu phiên bản {{revision}}. Xem riêng trạng thái worker.',
  current: 'Phiên bản đã lưu {{revision}}',
  absent: 'Phạm vi này chưa có chính sách PPE v2.',
  initialize: 'Khởi tạo chính sách PPE',
  activation: 'Bật vùng với chính sách này',
  'item.HARD_HAT': 'Mũ bảo hộ',
  'item.SAFETY_VEST': 'Áo phản quang',
  'item.GLOVES': 'Găng tay',
  'item.BOOTS': 'Giày bảo hộ',
  'item.GOGGLES': 'Kính bảo hộ',
  'item.MASK': 'Khẩu trang',
  'item.FULL_BODY_HARNESS': 'Dây đai an toàn toàn thân',
  'item.LANYARD_HOOK': 'Móc dây an toàn',
  requiredItemsGroup: 'Các hạng mục PPE bắt buộc',
  readinessCoreBadge: 'Cơ bản',
  readinessExperimentalBadge: 'Thử nghiệm',
  readinessGuidanceNote:
    'Mũ, áo: cơ bản; găng, giày, kính: thử nghiệm. Bản đã lưu chỉ áp dụng sau khi camera xác nhận.',
  catalogUnsupportedSummary:
    'Thiết bị chưa hỗ trợ ({{unsupportedCount}} / {{totalCount}}): {{names}}',
  catalogSemanticsPresentOnly: 'Chỉ ghi nhận trang bị',
  catalogSemanticsContractPending: 'Chưa hỗ trợ cấu hình',
  'catalogReason.NOT_IN_POLICY_CONTRACT': 'Hiện chưa thể chọn làm yêu cầu giám sát tự động.',
  'catalogReason.PRESENT_ONLY_SAFETY_BOUNDARY':
    'Chỉ ghi nhận trang bị; không xác nhận đeo hoặc móc đúng và không tự động báo vi phạm.',
  catalogBoundaryNote:
    'Tổng {{totalCount}} loại PPE: hiện chọn được {{selectableCount}} loại cho quy tắc giám sát, {{unsupportedCount}} loại chưa thể chọn. Hiển thị tại đây không đồng nghĩa máy AI đã chạy đủ hoặc đạt độ chính xác.',
  capabilityNoteSummary: 'Lưu ý về chính sách và năng lực máy AI',
  validationExplicitEmpty: 'Chọn ít nhất một hạng mục PPE trước khi lưu chính sách tùy chỉnh.',
  validationDisabledReasonRequired: 'Nhập lý do tắt kiểm tra PPE trước khi lưu.',
  validationDisabledReasonInvalid:
    'Nhập lý do hợp lệ (tối đa 500 ký tự, không chứa ký tự điều khiển) trước khi lưu.',
  'modeBadge.INHERIT': 'Dùng mặc định camera',
  'modeBadge.EXPLICIT': 'Tùy chỉnh',
  'modeBadge.DISABLED': 'Tắt',
  'modeBadge.UNCONFIGURED': 'Chưa cấu hình',
  cameraSummaryHeading: 'Chính sách mặc định của camera',
  cameraUninitializedNote:
    'Chính sách PPE mặc định của camera (v2) chưa được khởi tạo. Chưa thể xác định PPE hiệu lực cho đến khi cấu hình.',
  editCameraDefault: 'Sửa mặc định camera',
  regionsHeading: 'Các vùng quan sát trên camera ({{count}})',
  regionsEmpty: 'Chưa có vùng quan sát nào được gắn với camera này.',
  effectivePpeLabel: 'PPE hiệu lực',
  effectiveFromCamera: 'Theo mặc định của camera',
  effectiveFromRegion: 'Tùy chỉnh riêng của vùng',
  effectiveDisabled: 'Đã tắt kiểm tra PPE',
  effectiveDisabledByCamera: 'Đã tắt kiểm tra PPE (theo mặc định camera)',
  effectiveReason: 'Lý do: {{reason}}',
  effectiveUnknownUninitialized:
    'Chưa xác định PPE hiệu lực — vùng này chưa có chính sách PPE v2 đã lưu.',
  effectiveUnknownCameraDefault: 'Chưa xác định PPE hiệu lực — mặc định camera chưa được khởi tạo.',
  effectiveLoading: 'Đang tải chính sách của vùng…',
  effectiveError: 'Không tải được chính sách đã lưu của vùng này.',
  previewHeading: 'PPE hiệu lực dự kiến sau khi lưu',
  previewRequiresCameraInit:
    'Cần chọn hoặc lưu chính sách mặc định camera hợp lệ để xem PPE kế thừa.',
  impactHeading: 'Các vùng bị ảnh hưởng trên camera này',
  impactInheriting: 'Kế thừa mặc định camera ({{count}}): {{names}}',
  impactNoneInheriting:
    'Hiện chưa có vùng đang bật nào kế thừa mặc định camera (áp dụng ngoài các vùng ghi đè).',
  impactUnaffected: 'Giữ quy tắc tùy chỉnh hoặc tắt riêng ({{count}}): {{names}}',
  impactPreviewEffective: 'PPE hiệu lực cho vùng kế thừa & phần khung hình ngoài vùng:',
  regionActive: 'Đang bật',
  regionInactive: 'Đang tắt',
  regionVersionMeta: 'Vùng v{{version}}',
  regionNumberBadge: 'Vùng #{{index}}',
  regionUnresolvedLabel: 'Vùng quan sát #{{index}}',
  zoneMetadataUnavailable: 'Chưa có thông tin khu vực',
  technicalIdsSummary: 'Mã định danh kỹ thuật',
  technicalZoneCode: 'Mã định danh khu vực (Zone code): {{code}}',
  technicalRegionId: 'Mã vùng (Region ID): {{id}}',
  technicalZoneId: 'Mã khu vực (Zone ID): {{id}}',
  capabilityTruthNote:
    'Các lựa chọn PPE đã lưu chỉ ghi nhận cấu hình chính sách mong muốn. Việc giám sát thực tế cần biên nhận worker đã áp dụng khớp phiên bản và phụ thuộc các lớp PPE mà mô hình worker đang chạy hỗ trợ (màn hình này không hiển thị nhãn chất lượng mô hình tĩnh theo từng camera).',
  editRegion: 'Chỉnh sửa',
  editRegionAria: 'Chỉnh sửa chính sách cho {{target}}',
  readOnlyNotice:
    'Chế độ chỉ đọc: Cần quyền Quản lý công trường để thay đổi chính sách PPE của camera hoặc vùng.',
  editorHeading: 'Chỉnh sửa phạm vi chính sách',
  savedConfigMeta: 'Cấu hình v{{configVersion}} · Phiên bản chính sách {{revision}}',
  savedConfigOnlyMeta: 'Cấu hình đã lưu v{{configVersion}} · Chưa có chính sách v2',
  syncHeading: 'Trạng thái đã lưu so với đã áp dụng',
  syncSavedVersion: 'Cấu hình đã lưu: v{{version}}',
  syncSavedUnknown: 'Cấu hình đã lưu: chưa có',
  syncApplied: 'Worker đã áp dụng (ACK v{{reported}})',
  syncNotYetApplied: 'Mới lưu · Chưa áp dụng bản hiện tại (worker ACK: {{reported}})',
  syncPending: 'Mới lưu · Đang chờ worker áp dụng (đã báo: {{reported}})',
  syncUnconfirmed: 'Mới lưu · Chưa có xác nhận áp dụng (chưa có ACK từ worker)',
  syncStale: 'ACK của worker đã cũ · Chưa xác nhận bản hiện tại (ACK gần nhất: {{reported}})',
  syncRejected: 'Worker từ chối cấu hình ({{reason}})',
  syncUnavailable: 'Chỉ hiển thị cấu hình đã lưu · Không lấy được trạng thái áp dụng của worker',
  syncNoContext: 'Chỉ hiển thị cấu hình đã lưu · Xem riêng trạng thái worker',
  syncChecking: 'Đang kiểm tra trạng thái áp dụng của worker…',
  syncNoneReported: 'chưa có',
  regionSyncApplied: 'Worker đã áp dụng (v{{version}})',
  regionSyncInactive: 'Đã lưu v{{version}} · Vùng đang tắt',
  regionSyncNotApplied: 'Đã lưu v{{version}} · Worker chưa xác nhận áp dụng',
  regionSyncUnavailable: 'Đã lưu v{{version}} · Chưa có ACK từ worker',
  regionSyncUnconfigured: 'Chưa lưu bản v2',
};

export type CameraPpeCopyKey = `cameraPpe.${keyof typeof en}`;

export type PpeCatalogUnsupportedReasonCode = Exclude<
  (typeof PPE_FAMILY_CATALOG)[number]['unsupportedReasonCode'],
  null
>;

export const PPE_ITEM_LABEL_KEY: Record<PpeItem, CameraPpeCopyKey> = {
  HARD_HAT: 'cameraPpe.item.HARD_HAT',
  SAFETY_VEST: 'cameraPpe.item.SAFETY_VEST',
  GLOVES: 'cameraPpe.item.GLOVES',
  BOOTS: 'cameraPpe.item.BOOTS',
  GOGGLES: 'cameraPpe.item.GOGGLES',
};

export const PPE_FAMILY_LABEL_KEY: Record<PpeFamily, CameraPpeCopyKey> = {
  ...PPE_ITEM_LABEL_KEY,
  MASK: 'cameraPpe.item.MASK',
  FULL_BODY_HARNESS: 'cameraPpe.item.FULL_BODY_HARNESS',
  LANYARD_HOOK: 'cameraPpe.item.LANYARD_HOOK',
};

export const PPE_UNSUPPORTED_REASON_KEY: Record<PpeCatalogUnsupportedReasonCode, CameraPpeCopyKey> =
  {
    NOT_IN_POLICY_CONTRACT: 'cameraPpe.catalogReason.NOT_IN_POLICY_CONTRACT',
    PRESENT_ONLY_SAFETY_BOUNDARY: 'cameraPpe.catalogReason.PRESENT_ONLY_SAFETY_BOUNDARY',
  };

const CORE_BASELINE_PPE_ITEMS: ReadonlySet<PpeItem> = new Set<PpeItem>(['HARD_HAT', 'SAFETY_VEST']);

export function isCoreBaselinePpeItem(item: PpeItem): boolean {
  return CORE_BASELINE_PPE_ITEMS.has(item);
}

let registered = false;

export function registerCameraPpePolicyCopy(): void {
  if (registered) return;
  registered = true;
  registerFeatureCatalog({
    en: Object.fromEntries(Object.entries(en).map(([key, value]) => [`cameraPpe.${key}`, value])),
    vi: Object.fromEntries(Object.entries(vi).map(([key, value]) => [`cameraPpe.${key}`, value])),
  });
}
