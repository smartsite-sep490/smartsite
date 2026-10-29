import type { UpdateReferenceRegionPolygonCommand } from '@smartsite/contracts/camera-region-reference';
import type { EntityManager } from 'typeorm';
import { conflict, uuid } from '../../common/configuration/commands.js';
import type { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraStatus } from '../../database/entities/enums.js';
import {
  CameraConfigurationReferenceEntity,
  CameraViewRevisionEntity,
} from '../../database/entities/camera-configuration-reference.entity.js';

export interface ReferenceRegionWrite {
  command: UpdateReferenceRegionPolygonCommand;
  token: string;
}

export interface RegionReferenceProvenance {
  referenceId: string;
  viewRevision: string;
  confirmedByUserId: string;
  confirmedAt: Date;
}

/** Caller holds the camera lock; reference issuance uses the same camera -> view order. */
export async function resolveRegionReference(
  manager: EntityManager,
  camera: CameraEntity,
  binding: ReferenceRegionWrite,
  actorUserId: string,
): Promise<RegionReferenceProvenance> {
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('Region reference requires a transaction');
  if (camera.status !== CameraStatus.ACTIVE) conflict('Camera is inactive');
  const view = await manager
    .getRepository(CameraViewRevisionEntity)
    .createQueryBuilder('view')
    .setLock('pessimistic_write')
    .where('view.cameraId=:cameraId AND view.siteId=:siteId AND view.isCurrent=true', {
      cameraId: camera.id,
      siteId: camera.siteId,
    })
    .getOne();
  const reference = await manager.getRepository(CameraConfigurationReferenceEntity).findOneBy({
    id: binding.command.referenceId,
    cameraId: camera.id,
    siteId: camera.siteId,
  });
  const [{ now }] = await manager.query('SELECT clock_timestamp() AS now');
  if (
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    !view ||
    !reference ||
    view.retiredAt !== null ||
    reference.viewRevision !== view.revision ||
    String(binding.command.viewRevision) !== view.revision ||
    Number(reference.configurationVersion) !== camera.configurationVersion ||
    binding.command.expectedConfigurationVersion !== camera.configurationVersion ||
    reference.sessionId !== view.sessionId ||
    reference.sourceKind !== view.sourceKind ||
    reference.width !== view.width ||
    reference.height !== view.height ||
    reference.issuedAt > now ||
    reference.expiresAt <= now
  )
    conflict('Camera configuration reference is no longer valid');
  return {
    referenceId: reference.id,
    viewRevision: view.revision,
    confirmedByUserId: uuid(actorUserId).toLowerCase(),
    confirmedAt: now,
  };
}
