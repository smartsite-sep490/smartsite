import React, { useMemo } from 'react';
import type { ZoneResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { SafetyTaskTour } from '../safety/SafetyTaskTour';
import type { SafetyTourStepSpec } from '../safety/safetyTaskTourModel';
import {
  type EditingRegionScope,
  getConfigurationReferenceIdentity,
  isConfigurationReferenceScopeMatched,
} from './cameraRegionReferenceUtils';
import type { CameraConfigurationReference } from './useCameraConfigurationReference';

const POLYGON_TOUR_VERSION = 1;

const stepSpec = (
  id: string,
  anchor: string,
  prefix: string,
  isAllowed?: () => boolean,
): SafetyTourStepSpec => ({
  id,
  anchorSelector: `[data-tour-anchor="${anchor}"]`,
  titleKey: `${prefix}.title`,
  bodyKey: `${prefix}.body`,
  ...(isAllowed ? { isAllowed } : {}),
});

function buildPolygonTourSteps(
  options: { isReferenceExpired?: boolean; isSaving?: boolean } = {},
): readonly SafetyTourStepSpec[] {
  const { isReferenceExpired = false, isSaving = false } = options;
  return [
    stepSpec('polygon-frozen-reference', 'polygon-frozen-reference', 'tour.polygon.reference'),
    stepSpec(
      'polygon-canvas',
      'polygon-canvas',
      'tour.polygon.canvas',
      () => !isReferenceExpired && !isSaving,
    ),
    stepSpec(
      'polygon-edit-controls',
      'polygon-edit-controls',
      'tour.polygon.controls',
      () => !isSaving,
    ),
    stepSpec('polygon-save-footer', 'polygon-save-footer', 'tour.polygon.save'),
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
}

function buildPolygonTourScopeKey(
  props: Omit<RegionPolygonTaskTourProps, 'isReferenceExpired' | 'isSaving' | 'tourUserId'>,
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

registerFeatureCatalog({
  en: {
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
      'Click Save Region to store the boundary, or Cancel (or Esc) to close. Saving a region updates configuration only and does not mean live camera monitoring is active.',
  },
  vi: {
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
      'Nhấn Lưu vùng để lưu ranh giới, hoặc Hủy (hoặc Esc) để đóng. Lưu vùng chỉ cập nhật cấu hình, không đồng nghĩa giám sát camera trực tiếp đã hoạt động.',
  },
});

export function RegionPolygonTaskTour(props: RegionPolygonTaskTourProps) {
  const { isReferenceExpired = false, isSaving = false } = props;
  const scopeKey = buildPolygonTourScopeKey(props);
  const steps = useMemo(
    () => buildPolygonTourSteps({ isReferenceExpired, isSaving }),
    [isReferenceExpired, isSaving],
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
