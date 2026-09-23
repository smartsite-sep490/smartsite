import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CameraObservationRegionEntity } from '../../database/entities/camera-observation-region.entity.js';
import { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraStatus, ZoneRestrictionPolicy, ZoneType } from '../../database/entities/enums.js';
import { SiteEntity } from '../../database/entities/site.entity.js';
import { ZoneEntity } from '../../database/entities/zone.entity.js';

export interface CreateSiteInput {
  code: string;
  name: string;
}

export interface CreateZoneInput {
  siteId: string;
  code: string;
  name: string;
  type: ZoneType;
  restrictionPolicy: ZoneRestrictionPolicy;
  requiredPpe?: string[];
}

export interface CreateCameraInput {
  siteId: string;
  externalId: string;
  code: string;
  name: string;
  status?: CameraStatus;
}

export interface CreateRegionInput {
  id?: string;
  cameraId: string;
  zoneId: string;
  coordinates: number[][];
  version?: number;
}

@Injectable()
export class CatalogService {
  constructor(private readonly dataSource: DataSource) {}

  createSite(input: CreateSiteInput): Promise<SiteEntity> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SiteEntity);
      const existing = await repo.findOneBy({ code: input.code });
      if (existing) {
        return existing;
      }
      const site = repo.create({ id: randomUUID(), code: input.code, name: input.name });
      await repo.insert(site);
      return site;
    });
  }

  createZone(input: CreateZoneInput): Promise<ZoneEntity> {
    return this.dataSource.transaction(async (manager) => {
      const sites = manager.getRepository(SiteEntity);
      const site = await sites.findOneBy({ id: input.siteId });
      if (!site) {
        throw new NotFoundException('Site not found');
      }
      const repo = manager.getRepository(ZoneEntity);
      const existing = await repo.findOneBy({ siteId: input.siteId, code: input.code });
      if (existing) {
        return existing;
      }
      const zone = repo.create({
        id: randomUUID(),
        siteId: input.siteId,
        code: input.code,
        name: input.name,
        type: input.type,
        restrictionPolicy: input.restrictionPolicy,
        requiredPpe: input.requiredPpe ?? [],
      });
      await repo.insert(zone);
      return zone;
    });
  }

  createCamera(input: CreateCameraInput): Promise<CameraEntity> {
    return this.dataSource.transaction(async (manager) => {
      const site = await manager.getRepository(SiteEntity).findOneBy({ id: input.siteId });
      if (!site) {
        throw new NotFoundException('Site not found');
      }
      const repo = manager.getRepository(CameraEntity);
      const existing = await repo.findOneBy({ externalId: input.externalId });
      if (existing) {
        return existing;
      }
      const camera = repo.create({
        id: randomUUID(),
        siteId: input.siteId,
        externalId: input.externalId,
        code: input.code,
        name: input.name,
        status: input.status ?? CameraStatus.ACTIVE,
      });
      await repo.insert(camera);
      return camera;
    });
  }

  async createRegion(input: CreateRegionInput): Promise<CameraObservationRegionEntity> {
    validatePolygon(input.coordinates);
    return this.dataSource.transaction(async (manager) => {
      const camera = await manager.getRepository(CameraEntity).findOneBy({ id: input.cameraId });
      const zone = await manager.getRepository(ZoneEntity).findOneBy({ id: input.zoneId });
      if (!camera) {
        throw new NotFoundException('Camera not found');
      }
      if (!zone) {
        throw new NotFoundException('Zone not found');
      }
      if (camera.siteId !== zone.siteId) {
        throw new BadRequestException('Camera and zone must belong to the same site');
      }
      const repo = manager.getRepository(CameraObservationRegionEntity);
      const id = input.id ?? randomUUID();
      const existing = await repo.findOneBy({ id });
      if (existing) {
        return existing;
      }
      const region = repo.create({
        id,
        cameraId: input.cameraId,
        zoneId: input.zoneId,
        polygon: { coordinates: input.coordinates },
        coordinateSpace: 'NORMALIZED_0_1',
        version: input.version ?? 1,
        isActive: true,
      });
      await repo.insert(region as never);
      return region;
    });
  }
}

function validatePolygon(coordinates: number[][]): void {
  if (coordinates.length < 3) {
    throw new BadRequestException('Polygon needs at least 3 points');
  }
  for (const point of coordinates) {
    if (point.length !== 2 || point.some((value) => value < 0 || value > 1)) {
      throw new BadRequestException('Polygon points must be normalized coordinates');
    }
  }
}
