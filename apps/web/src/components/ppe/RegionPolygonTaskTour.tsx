import { useMemo } from 'react';
import type { ZoneResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { registerSafetyTaskTourCatalog } from '../safety/safety-task-tour-catalog';
import { SafetyTaskTour } from '../safety/SafetyTaskTour';
import type { SafetyTourStepSpec } from '../safety/safetyTaskTourModel';
import {
  type EditingRegionScope,
  getConfigurationReferenceIdentity,
  isConfigurationReferenceScopeMatched,
} from './cameraRegionReferenceUtils';
import type { CameraConfigurationReference } from './useCameraConfigurationReference';

const POLYGON_TOUR_EN = {
  'regionPolygon.tour.cameraScope.title': 'Confirm Selected Camera & Zone',
  'regionPolygon.tour.cameraScope.body':
    'Verify the active camera and target zone above before drawing. Switching the selected camera or zone resets the region draft for that scope.',
  'regionPolygon.tour.reference.active.title': 'Confirm Current Reference Image',
  'regionPolygon.tour.reference.active.body':
    'Verify the frozen 5-minute camera reference frame captured for the current configuration version, or click Review new reference above to capture a newer snapshot. Tick the confirmation checkbox before saving.',
  'regionPolygon.tour.reference.expired.title': 'Capture Fresh Reference Image (Expired)',
  'regionPolygon.tour.reference.expired.body':
    'This 5-minute reference image has expired, so drawing and confirmation are paused. Click Review new reference above to capture and accept a fresh reference frame before continuing.',
  'regionPolygon.tour.ppePolicy.title': 'Choose Inherited, Override, or Disabled PPE',
  'regionPolygon.tour.ppePolicy.body':
    'Select how this region enforces PPE: Use camera default (Inherited), Custom (Override with specific required PPE items), or Disabled (turn off PPE checks here with a documented reason), and verify the effective PPE preview.',
  'regionPolygon.tour.canvas.title': 'Draw a Small Non-Crossing Region',
  'regionPolygon.tour.canvas.body':
    'Click at least 3 corner points on the image to draw a small, tight polygon around the target work zone—exclude adjacent walkways and avoid crossing lines. Opening this guide never changes your current drawing.',
  'regionPolygon.tour.controls.title': 'Adjust Points & Canvas View',
  'regionPolygon.tour.controls.body':
    'Use Undo, Delete Point, Reset, Zoom, Pan, or the X/Y inputs to fine-tune corners. Editing buttons lock while a save is in progress.',
  'regionPolygon.tour.save.create.title': 'Save Config vs Worker-Applied Receipt',
  'regionPolygon.tour.save.create.body':
    'Check the readiness hint, tick the reference confirmation checkbox, and click Save Region (or Cancel Drawing / Esc). Saving stores a new camera configuration version (vN) only—check Camera Setup for the worker-applied receipt before live monitoring uses it.',
  'regionPolygon.tour.save.edit.title': 'Save Config vs Worker-Applied Receipt',
  'regionPolygon.tour.save.edit.body':
    'Re-tick the reference confirmation checkbox after any point edit, then click Save Region. Saving updates geometry in configuration (vN) only—adjust Inherited/Override/Disabled PPE and verify the worker-applied receipt on Camera Setup.',
} as const;

const POLYGON_TOUR_VI: Record<keyof typeof POLYGON_TOUR_EN, string> = {
  'regionPolygon.tour.cameraScope.title': 'Kiểm tra Camera & Khu vực Đang chọn',
  'regionPolygon.tour.cameraScope.body':
    'Kiểm tra đúng camera đang bật và khu vực mục tiêu ở trên trước khi vẽ. Đổi camera hoặc khu vực sẽ đặt lại bản nháp theo phạm vi mới.',
  'regionPolygon.tour.reference.active.title': 'Xác nhận Ảnh tham chiếu Hiện tại',
  'regionPolygon.tour.reference.active.body':
    'Kiểm tra khung hình tham chiếu 5 phút của phiên bản cấu hình hiện tại, hoặc nhấn Xem xét ảnh tham chiếu mới ở trên để chụp ảnh mới. Cần tích ô xác nhận khớp ảnh tham chiếu trước khi lưu.',
  'regionPolygon.tour.reference.expired.title': 'Lấy Ảnh tham chiếu Mới (Đã hết hạn)',
  'regionPolygon.tour.reference.expired.body':
    'Ảnh tham chiếu 5 phút này đã hết hạn nên thao tác vẽ và xác nhận đang tạm khóa. Hãy nhấn Xem xét ảnh tham chiếu mới ở trên để chụp và chấp nhận khung hình mới trước khi tiếp tục.',
  'regionPolygon.tour.ppePolicy.title': 'Chọn PPE Kế thừa, Tùy chỉnh hoặc Tắt',
  'regionPolygon.tour.ppePolicy.body':
    'Chọn cách vùng này kiểm tra PPE: Dùng mặc định camera (Kế thừa), Tùy chỉnh (Ghi đè danh mục PPE bắt buộc riêng), hoặc Tắt (tắt kiểm tra PPE tại vùng này kèm lý do), và đối chiếu hộp xem trước PPE hiệu lực.',
  'regionPolygon.tour.canvas.title': 'Vẽ Vùng Quan sát Gọn & Không tự cắt',
  'regionPolygon.tour.canvas.body':
    'Nhấn tối thiểu 3 đỉnh trên ảnh để vẽ một vùng đa giác gọn bao sát khu vực làm việc—loại trừ lối đi lân cận và không để các cạnh tự cắt nhau. Mở hướng dẫn không làm thay đổi bản vẽ hiện tại.',
  'regionPolygon.tour.controls.title': 'Tinh chỉnh Đỉnh & Khung nhìn',
  'regionPolygon.tour.controls.body':
    'Dùng Hoàn tác, Xóa điểm, Đặt lại, Thu phóng, Kéo khung hoặc ô tọa độ X/Y để chỉnh chính xác các góc. Nút chỉnh sửa sẽ khóa khi đang lưu.',
  'regionPolygon.tour.save.create.title': 'Lưu Cấu hình vs Biên nhận Worker áp dụng',
  'regionPolygon.tour.save.create.body':
    'Kiểm tra dòng trạng thái sẵn sàng, tích ô xác nhận ảnh tham chiếu rồi nhấn Lưu vùng (hoặc Hủy vẽ / Esc). Thao tác lưu chỉ tạo phiên bản cấu hình camera mới (vN)—hãy kiểm tra biên nhận worker áp dụng trên màn Thiết lập Camera.',
  'regionPolygon.tour.save.edit.title': 'Lưu Cấu hình vs Biên nhận Worker áp dụng',
  'regionPolygon.tour.save.edit.body':
    'Tích lại ô xác nhận ảnh tham chiếu sau khi chỉnh đỉnh rồi nhấn Lưu vùng. Thao tác lưu chỉ cập nhật hình học trong cấu hình (vN)—hãy chỉnh PPE Kế thừa/Tùy chỉnh/Tắt và kiểm tra biên nhận worker áp dụng tại Thiết lập Camera.',
};

function registerRegionPolygonTourCopy(): void {
  registerFeatureCatalog({
    en: POLYGON_TOUR_EN,
    vi: POLYGON_TOUR_VI,
  });
}

registerSafetyTaskTourCatalog();
registerRegionPolygonTourCopy();

const POLYGON_TOUR_VERSION = 1;

function buildPolygonTourSteps(
  options: {
    isReferenceExpired?: boolean;
    isSaving?: boolean;
    isEditingRegion?: boolean;
    hasPpePolicyControls?: boolean;
  } = {},
): readonly SafetyTourStepSpec[] {
  const {
    isReferenceExpired = false,
    isSaving = false,
    isEditingRegion = false,
    hasPpePolicyControls = true,
  } = options;
  const referencePrefix = isReferenceExpired
    ? 'regionPolygon.tour.reference.expired'
    : 'regionPolygon.tour.reference.active';
  const savePrefix = isEditingRegion
    ? 'regionPolygon.tour.save.edit'
    : 'regionPolygon.tour.save.create';

  return [
    {
      id: 'polygon-camera-scope',
      anchorSelector: '[data-select-for="select-camera-link"]',
      titleKey: 'regionPolygon.tour.cameraScope.title',
      bodyKey: 'regionPolygon.tour.cameraScope.body',
      isAllowed: () => !isSaving,
    },
    {
      id: 'polygon-frozen-reference',
      anchorSelector: '[data-tour-anchor="polygon-frozen-reference"]',
      titleKey: `${referencePrefix}.title`,
      bodyKey: `${referencePrefix}.body`,
    },
    {
      id: 'polygon-ppe-policy',
      anchorSelector: '[data-tour-anchor="polygon-frozen-reference"] > fieldset',
      titleKey: 'regionPolygon.tour.ppePolicy.title',
      bodyKey: 'regionPolygon.tour.ppePolicy.body',
      isAllowed: () => !isEditingRegion && !isSaving && hasPpePolicyControls,
    },
    {
      id: 'polygon-canvas',
      anchorSelector: '[data-tour-anchor="polygon-canvas"]',
      titleKey: 'regionPolygon.tour.canvas.title',
      bodyKey: 'regionPolygon.tour.canvas.body',
      isAllowed: () => !isReferenceExpired && !isSaving,
    },
    {
      id: 'polygon-edit-controls',
      anchorSelector: '[data-tour-anchor="polygon-edit-controls"]',
      titleKey: 'regionPolygon.tour.controls.title',
      bodyKey: 'regionPolygon.tour.controls.body',
      isAllowed: () => !isReferenceExpired && !isSaving,
    },
    {
      id: 'polygon-save-footer',
      anchorSelector: '[data-tour-anchor="polygon-save-footer"]',
      titleKey: `${savePrefix}.title`,
      bodyKey: `${savePrefix}.body`,
    },
  ];
}

export interface RegionPolygonTaskTourProps {
  apiUrl: string;
  sessionScope: string;
  credentialId: number;
  internalNonce: number;
  siteId: string;
  selectedCamera: CameraResponse;
  selectedZone: ZoneResponse;
  frozenReference: CameraConfigurationReference;
  editingRegion?: EditingRegionScope | null;
  tourUserId?: string | null;
  isReferenceExpired?: boolean;
  isSaving?: boolean;
  hasPpePolicyControls?: boolean;
}

function buildPolygonTourScopeKey(
  props: Omit<
    RegionPolygonTaskTourProps,
    'isReferenceExpired' | 'isSaving' | 'tourUserId' | 'hasPpePolicyControls'
  >,
): string {
  const referenceIdentity = getConfigurationReferenceIdentity(props.frozenReference);
  const editingRegionKey = props.editingRegion
    ? `${props.editingRegion.id}:${props.editingRegion.version}:${props.editingRegion.expectedConfigurationVersion}`
    : 'create';
  return [
    props.apiUrl.trim(),
    props.sessionScope.trim(),
    String(props.credentialId),
    String(props.internalNonce),
    props.siteId.trim(),
    props.selectedCamera.id.trim(),
    props.selectedCamera.externalId.trim(),
    String(props.selectedCamera.configurationVersion),
    props.selectedZone.id.trim(),
    referenceIdentity,
    editingRegionKey,
  ].join('::');
}

export function RegionPolygonTaskTour(props: RegionPolygonTaskTourProps) {
  registerSafetyTaskTourCatalog();
  registerRegionPolygonTourCopy();
  const { isReferenceExpired = false, isSaving = false, hasPpePolicyControls = true } = props;
  const isEditingRegion = Boolean(props.editingRegion);
  const scopeKey = buildPolygonTourScopeKey(props);
  const steps = useMemo(
    () =>
      buildPolygonTourSteps({
        isReferenceExpired,
        isSaving,
        isEditingRegion,
        hasPpePolicyControls,
      }),
    [hasPpePolicyControls, isReferenceExpired, isSaving, isEditingRegion],
  );
  const isAuthorized = Boolean(
    props.apiUrl.trim() &&
    props.sessionScope.trim() &&
    Number.isFinite(props.credentialId) &&
    Number.isFinite(props.internalNonce) &&
    props.siteId.trim() &&
    props.selectedCamera.id.trim() &&
    props.selectedZone.id.trim() &&
    isConfigurationReferenceScopeMatched(props.frozenReference, props.siteId, props.selectedCamera),
  );

  if (!isAuthorized) return null;

  return (
    <div className="flex items-center justify-end">
      <SafetyTaskTour
        taskId="polygon"
        tourVersion={POLYGON_TOUR_VERSION}
        userId={props.tourUserId ?? null}
        scopeKey={scopeKey}
        isAuthorized={isAuthorized}
        steps={steps}
      />
    </div>
  );
}
