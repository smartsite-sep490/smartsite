import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraObservationRegionEntity } from '../../database/entities/camera-observation-region.entity.js';
import { CameraStatus } from '../../database/entities/enums.js';
import { ZoneEntity } from '../../database/entities/zone.entity.js';
import { ZonePolicyRevisionEntity } from '../../database/entities/zone-policy-revision.entity.js';
import type { CameraConfigurationBundle } from '@smartsite/contracts';

export interface ResolvedObservationContext {
  cameraId: string;
  siteId: string;
  regionId: string;
  zoneId: string;
  zone: ZoneEntity;
  geometryVersion: number;
}

@Injectable()
export class ObservationContextResolverService {
  /** Issuance must already be authenticated; metadata names are current, policy is immutable. */
  async resolveIssuedRegion(
    manager: EntityManager,
    siteId: string,
    bundle: CameraConfigurationBundle,
    regionId: string,
    geometryVersion: number,
  ): Promise<ResolvedObservationContext | undefined> {
    const binding = bundle.regions.find(
      (row) => row.regionId === regionId && row.geometryVersion === geometryVersion,
    );
    if (!binding) return undefined;
    const policy = await manager.getRepository(ZonePolicyRevisionEntity).findOneBy({
      zoneId: binding.zoneId,
      siteId,
      policyRevision: String(binding.policyRevision),
    });
    const metadata = await manager
      .getRepository(ZoneEntity)
      .findOneBy({ id: binding.zoneId, siteId });
    if (!policy || !metadata) return undefined;
    const zone = Object.assign(new ZoneEntity(), metadata, {
      type: policy.zoneType,
      restrictionPolicy: policy.restrictionPolicy,
      requiredPpe: [...binding.requiredPpe],
    });
    return {
      cameraId: bundle.cameraId,
      siteId,
      regionId,
      zoneId: binding.zoneId,
      zone,
      geometryVersion,
    };
  }
  async resolveCamera(
    manager: EntityManager,
    cameraExternalId: string,
    lockForAssessment = false,
  ): Promise<CameraEntity | undefined> {
    const where = {
      externalId: cameraExternalId,
      status: CameraStatus.ACTIVE,
    };
    const repository = manager.getRepository(CameraEntity);
    const camera = lockForAssessment
      ? await repository.findOne({ where, lock: { mode: 'pessimistic_read' } })
      : await repository.findOneBy(where);
    return camera ?? undefined;
  }

  async resolve(
    manager: EntityManager,
    cameraExternalId: string,
    regionId: string,
    geometryVersion: number,
    lockForAssessment = false,
  ): Promise<ResolvedObservationContext | undefined> {
    const camera = await this.resolveCamera(manager, cameraExternalId, lockForAssessment);
    if (!camera) {
      return undefined;
    }

    const regions = manager.getRepository(CameraObservationRegionEntity);
    const region = lockForAssessment
      ? await regions.findOne({ where: { id: regionId }, lock: { mode: 'pessimistic_read' } })
      : await regions.findOneBy({ id: regionId });

    if (!region) {
      return undefined;
    }

    if (region.cameraId !== camera.id) {
      return undefined;
    }

    if (!region.isActive) {
      return undefined;
    }

    if (region.version !== geometryVersion) {
      return undefined;
    }

    const zoneWhere = {
      id: region.zoneId,
      siteId: camera.siteId,
    };
    const zones = manager.getRepository(ZoneEntity);
    const zone = lockForAssessment
      ? await zones.findOne({ where: zoneWhere, lock: { mode: 'pessimistic_read' } })
      : await zones.findOneBy(zoneWhere);

    if (!zone) {
      return undefined;
    }

    return {
      cameraId: camera.id,
      siteId: camera.siteId,
      regionId: region.id,
      zoneId: zone.id,
      zone,
      geometryVersion: region.version,
    };
  }
}
