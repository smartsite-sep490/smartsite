import { useMemo } from 'react';
import type { ZoneResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import { registerSafetyTaskTourCatalog } from '../safety/safety-task-tour-catalog';
import { SafetyTaskTour } from '../safety/SafetyTaskTour';
import type { SafetyTourStepSpec } from '../safety/safetyTaskTourModel';
import {
  type EditingRegionScope,
  getConfigurationReferenceIdentity,
  isConfigurationReferenceScopeMatched,
} from './cameraRegionReferenceUtils';
import type { CameraConfigurationReference } from './useCameraConfigurationReference';

registerSafetyTaskTourCatalog();

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

export function RegionPolygonTaskTour(props: RegionPolygonTaskTourProps) {
  registerSafetyTaskTourCatalog();
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
