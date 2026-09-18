import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraObservationRegionEntity } from '../../database/entities/camera-observation-region.entity.js';
import { ZoneEntity } from '../../database/entities/zone.entity.js';

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
  async resolveCamera(
    manager: EntityManager,
    cameraExternalId: string,
  ): Promise<CameraEntity | undefined> {
    const camera = await manager.getRepository(CameraEntity).findOneBy({
      externalId: cameraExternalId,
    });
    return camera ?? undefined;
  }

  async resolve(
    manager: EntityManager,
    cameraExternalId: string,
    regionId: string,
    geometryVersion: number,
  ): Promise<ResolvedObservationContext | undefined> {
    const camera = await this.resolveCamera(manager, cameraExternalId);
    if (!camera) {
      return undefined;
    }

    const region = await manager.getRepository(CameraObservationRegionEntity).findOneBy({
      id: regionId,
    });

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

    const zone = await manager.getRepository(ZoneEntity).findOneBy({
      id: region.zoneId,
      siteId: camera.siteId,
    });

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
