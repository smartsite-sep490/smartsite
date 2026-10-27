import type { CameraResponse, Mf06AssessmentResponse } from '@smartsite/api-client';
import { areUuidsEqual } from './mf06AssessmentDetailBinding';

export type Mf06CameraCatalogItem = Pick<CameraResponse, 'id' | 'siteId' | 'code' | 'name'>;
export type Mf06CameraCatalog = ReadonlyArray<Mf06CameraCatalogItem>;

export function resolveMf06CurrentCameraLabel(
  record: Pick<Mf06AssessmentResponse, 'siteId' | 'cameraId'>,
  cameraCatalog?: Mf06CameraCatalog,
): string | null {
  if (!cameraCatalog || cameraCatalog.length === 0) {
    return null;
  }
  const match = cameraCatalog.find(
    (camera) =>
      areUuidsEqual(camera.siteId, record.siteId) && areUuidsEqual(camera.id, record.cameraId),
  );
  if (!match) {
    return null;
  }
  const code = typeof match.code === 'string' ? match.code.trim() : '';
  const name = typeof match.name === 'string' ? match.name.trim() : '';
  if (!code || !name) {
    return null;
  }
  return `${code} · ${name}`;
}
