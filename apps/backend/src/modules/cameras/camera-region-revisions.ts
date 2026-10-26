import type { EntityManager } from 'typeorm';
import type { CameraEntity } from '../../database/entities/camera.entity.js';
import type { CameraObservationRegionEntity } from '../../database/entities/camera-observation-region.entity.js';
import { CameraRegionGeometryRevisionEntity } from '../../database/entities/camera-region-geometry-revision.entity.js';
import type { RegionReferenceProvenance } from './camera-region-reference-write.js';
import {
  parseRegionGeometryConfirmation,
  type RegionGeometryConfirmation,
} from '@smartsite/contracts/camera-region-geometry-confirmation';

export type RegionMutationResult = CameraObservationRegionEntity & {
  configurationVersion: number;
  geometryConfirmation?: RegionGeometryConfirmation;
};

/** Use the provenance just appended in this command, never a later mutable Region read. */
export function regionMutationResult(
  region: CameraObservationRegionEntity,
  configurationVersion: number,
  provenance?: RegionReferenceProvenance,
): RegionMutationResult {
  return Object.assign(
    region,
    { configurationVersion },
    provenance
      ? {
          geometryConfirmation: parseRegionGeometryConfirmation({
            status: 'MANUALLY_CONFIRMED',
            referenceId: provenance.referenceId,
            viewRevision: Number(provenance.viewRevision),
            confirmedByUserId: provenance.confirmedByUserId,
            confirmedAt: provenance.confirmedAt.toISOString(),
          }),
        }
      : {},
  );
}

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
