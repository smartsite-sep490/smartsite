import type { EntityManager } from 'typeorm';
import type { CameraEntity } from '../../database/entities/camera.entity.js';
import type { CameraObservationRegionEntity } from '../../database/entities/camera-observation-region.entity.js';
import { CameraRegionGeometryRevisionEntity } from '../../database/entities/camera-region-geometry-revision.entity.js';
import type { RegionReferenceProvenance } from './camera-region-reference-write.js';

export async function recordRegionRevision(
  manager: EntityManager,
  camera: CameraEntity,
  region: CameraObservationRegionEntity,
  preserveReference: boolean,
  provenance?: RegionReferenceProvenance,
): Promise<void> {
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('Region revision requires a transaction');
  const repository = manager.getRepository(CameraRegionGeometryRevisionEntity);
  const previous = preserveReference
    ? await repository.findOneBy({ regionId: region.id, geometryVersion: region.version - 1 })
    : null;
  await repository
    .createQueryBuilder()
    .insert()
    .values({
      regionId: region.id,
      geometryVersion: region.version,
      cameraId: camera.id,
      zoneId: region.zoneId,
      configurationVersion: String(camera.configurationVersion),
      coordinateSpace: region.coordinateSpace,
      polygon: () => 'CAST(:polygon AS jsonb)',
      isActive: region.isActive,
      isCutoverBaseline: false,
      referenceId: provenance?.referenceId ?? previous?.referenceId ?? null,
      viewRevision: provenance?.viewRevision ?? previous?.viewRevision ?? null,
      confirmedByUserId: provenance?.confirmedByUserId ?? previous?.confirmedByUserId ?? null,
      confirmedAt: provenance?.confirmedAt ?? previous?.confirmedAt ?? null,
    })
    .setParameter('polygon', JSON.stringify(region.polygon))
    .execute();
}
