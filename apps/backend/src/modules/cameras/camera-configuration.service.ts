import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  parseCameraRegionConfigurationPayload,
  type CameraRegionConfiguration,
} from '@smartsite/contracts';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  NotContains,
} from 'class-validator';
import { DataSource, type EntityManager } from 'typeorm';
import {
  command,
  conflict,
  invalid,
  knownUnique,
  missing,
  page,
  uuid,
} from '../../common/configuration/commands.js';
import { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraObservationRegionEntity } from '../../database/entities/camera-observation-region.entity.js';
import { CameraStatus } from '../../database/entities/enums.js';
import { SiteConfigurationService } from '../sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../zones/zone-configuration.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateCameraCommand {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  code!: string;
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[^\p{Cs}]+$/u)
  @NotContains('\0')
  externalId!: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  name!: string;
}

export class RenameCameraCommand {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  name!: string;
}

class ExpectedConfigurationCommand {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedConfigurationVersion!: number;
}

export class SetCameraStatusCommand extends ExpectedConfigurationCommand {
  @IsEnum(CameraStatus)
  status!: CameraStatus;
}

export class CreateRegionCommand extends ExpectedConfigurationCommand {
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/u)
  zoneId!: string;
  @IsObject()
  polygon!: unknown;
}

export class UpdateRegionPolygonCommand extends ExpectedConfigurationCommand {
  @IsObject()
  polygon!: unknown;
}

export class SetRegionActiveCommand extends ExpectedConfigurationCommand {
  @IsBoolean()
  isActive!: boolean;
}

@Injectable()
export class CameraConfigurationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly zones: ZoneConfigurationService,
    private readonly sites: SiteConfigurationService,
  ) {}

  async create(siteId: string, input: CreateCameraCommand): Promise<CameraEntity> {
    const value = command(CreateCameraCommand, input);
    await this.sites.get(siteId);
    try {
      return await this.dataSource.getRepository(CameraEntity).save({
        id: randomUUID(),
        siteId,
        ...value,
        status: CameraStatus.ACTIVE,
        configurationVersion: 1,
      });
    } catch (error) {
      knownUnique(error, ['uq_camera_external_id', 'uq_camera_site_code']);
    }
  }

  async get(siteId: string, cameraId: string): Promise<CameraEntity> {
    const camera = await this.dataSource
      .getRepository(CameraEntity)
      .findOneBy({ siteId: uuid(siteId), id: uuid(cameraId) });
    return camera ?? missing();
  }

  async list(
    siteId: string,
    offset = 0,
    limit = 20,
  ): Promise<{ items: CameraEntity[]; total: number }> {
    await this.sites.get(siteId);
    const pagination = page(offset, limit);
    const [items, total] = await this.dataSource.getRepository(CameraEntity).findAndCount({
      where: { siteId },
      order: { code: 'ASC', id: 'ASC' },
      skip: pagination.offset,
      take: pagination.limit,
    });
    return { items, total };
  }

  async rename(
    siteId: string,
    cameraId: string,
    input: RenameCameraCommand,
  ): Promise<CameraEntity> {
    const value = command(RenameCameraCommand, input);
    const camera = await this.get(siteId, cameraId);
    if (camera.name === value.name) return camera;
    await this.dataSource
      .getRepository(CameraEntity)
      .update({ id: camera.id, siteId }, { name: value.name });
    camera.name = value.name;
    return camera;
  }

  private async lockCamera(
    manager: EntityManager,
    siteId: string,
    cameraId: string,
    expected: number,
  ): Promise<CameraEntity> {
    const camera = await manager
      .getRepository(CameraEntity)
      .createQueryBuilder('camera')
      .setLock('pessimistic_write')
      .where('camera.id = :cameraId AND camera.siteId = :siteId', {
        cameraId: uuid(cameraId),
        siteId: uuid(siteId),
      })
      .getOne();
    if (!camera) missing();
    if (camera.configurationVersion !== expected) conflict('Configuration version changed');
    return camera;
  }

  private async bump(manager: EntityManager, camera: CameraEntity): Promise<void> {
    if (camera.configurationVersion >= Number.MAX_SAFE_INTEGER)
      conflict('Configuration version exhausted');
    camera.configurationVersion += 1;
    await manager
      .getRepository(CameraEntity)
      .update(
        { id: camera.id },
        { status: camera.status, configurationVersion: camera.configurationVersion },
      );
  }

  private bumpRegion(region: CameraObservationRegionEntity): void {
    if (region.version >= 2_147_483_647) conflict('Region version exhausted');
    region.version += 1;
  }

  private checkPolygon(polygon: unknown): void {
    const probe = {
      schemaVersion: '1.0.0',
      configurationVersion: 1,
      cameraExternalId: 'probe',
      regions: [
        { regionId: randomUUID(), geometryVersion: 1, coordinateSpace: 'NORMALIZED_0_1', polygon },
      ],
    };
    try {
      if (!parseCameraRegionConfigurationPayload(JSON.stringify(probe)).isValid)
        invalid('Invalid region polygon');
    } catch {
      invalid('Invalid region polygon');
    }
  }

  private async snapshot(
    manager: EntityManager,
    camera: CameraEntity,
    allowInactive = false,
  ): Promise<CameraRegionConfiguration> {
    if (!allowInactive && camera.status !== CameraStatus.ACTIVE) conflict('Camera is inactive');
    const regions = await manager.getRepository(CameraObservationRegionEntity).find({
      where: { cameraId: camera.id, isActive: true },
      order: { id: 'ASC' },
    });
    const payload = {
      schemaVersion: '1.0.0',
      configurationVersion: camera.configurationVersion,
      cameraExternalId: camera.externalId,
      regions: regions.map((region) => ({
        regionId: region.id,
        geometryVersion: region.version,
        coordinateSpace: region.coordinateSpace,
        polygon: region.polygon,
      })),
    };
    const parsed = parseCameraRegionConfigurationPayload(JSON.stringify(payload));
    if (!parsed.isValid || !parsed.value) conflict('Stored camera configuration is invalid');
    return parsed.value;
  }

  async buildConfiguration(siteId: string, cameraId: string): Promise<CameraRegionConfiguration> {
    uuid(siteId);
    uuid(cameraId);
    return await this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const camera = await manager.getRepository(CameraEntity).findOneBy({ siteId, id: cameraId });
      if (!camera) missing();
      return await this.snapshot(manager, camera);
    });
  }

  async buildConfigurationForCamera(cameraId: string): Promise<CameraRegionConfiguration> {
    uuid(cameraId);
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const camera = await manager.getRepository(CameraEntity).findOneBy({ id: cameraId });
      if (!camera) missing();
      return this.snapshot(manager, camera);
    });
  }

  async setStatus(
    siteId: string,
    cameraId: string,
    input: SetCameraStatusCommand,
  ): Promise<CameraEntity> {
    const value = command(SetCameraStatusCommand, input);
    return await this.dataSource.transaction(async (manager) => {
      const camera = await this.lockCamera(
        manager,
        siteId,
        cameraId,
        value.expectedConfigurationVersion,
      );
      if (camera.status === value.status) return camera;
      const activeRegions = await manager.getRepository(CameraObservationRegionEntity).find({
        where: { cameraId, isActive: true },
        order: { id: 'ASC' },
      });
      for (const region of activeRegions) {
        this.bumpRegion(region);
        await manager.getRepository(CameraObservationRegionEntity).save(region);
      }
      camera.status = value.status;
      await this.bump(manager, camera);
      await this.snapshot(manager, camera, true);
      return camera;
    });
  }

  async listRegions(
    siteId: string,
    cameraId: string,
    offset = 0,
    limit = 20,
  ): Promise<{ items: CameraObservationRegionEntity[]; total: number }> {
    await this.get(siteId, cameraId);
    const pagination = page(offset, limit);
    const [items, total] = await this.dataSource
      .getRepository(CameraObservationRegionEntity)
      .findAndCount({
        where: { cameraId },
        order: { id: 'ASC' },
        skip: pagination.offset,
        take: pagination.limit,
      });
    return { items, total };
  }

  async getRegion(
    siteId: string,
    cameraId: string,
    regionId: string,
  ): Promise<CameraObservationRegionEntity> {
    await this.get(siteId, cameraId);
    const region = await this.dataSource
      .getRepository(CameraObservationRegionEntity)
      .findOneBy({ id: uuid(regionId), cameraId });
    return region ?? missing();
  }

  async createRegion(
    siteId: string,
    cameraId: string,
    input: CreateRegionCommand,
  ): Promise<CameraObservationRegionEntity & { configurationVersion: number }> {
    const value = command(CreateRegionCommand, input);
    uuid(value.zoneId);
    this.checkPolygon(value.polygon);
    return await this.dataSource.transaction(async (manager) => {
      const camera = await this.lockCamera(
        manager,
        siteId,
        cameraId,
        value.expectedConfigurationVersion,
      );
      const zone = await this.zones.lockForRegion(manager, siteId, value.zoneId);
      const count = await manager
        .getRepository(CameraObservationRegionEntity)
        .countBy({ cameraId, isActive: true });
      if (count >= 64) conflict('Camera has the maximum number of active regions');
      const region = await manager.getRepository(CameraObservationRegionEntity).save({
        id: randomUUID(),
        cameraId,
        zoneId: zone.id,
        polygon: value.polygon,
        coordinateSpace: 'NORMALIZED_0_1',
        version: 1,
        isActive: true,
      });
      await this.zones.markLinked(manager, zone);
      await this.bump(manager, camera);
      await this.snapshot(manager, camera, true);
      return Object.assign(region, { configurationVersion: camera.configurationVersion });
    });
  }

  async updatePolygon(
    siteId: string,
    cameraId: string,
    regionId: string,
    input: UpdateRegionPolygonCommand,
  ): Promise<CameraObservationRegionEntity & { configurationVersion: number }> {
    const value = command(UpdateRegionPolygonCommand, input);
    this.checkPolygon(value.polygon);
    return await this.changeRegion(
      siteId,
      cameraId,
      regionId,
      value.expectedConfigurationVersion,
      (region) => {
        if (JSON.stringify(region.polygon) === JSON.stringify(value.polygon)) return false;
        region.polygon = value.polygon;
        return true;
      },
    );
  }

  async setRegionActive(
    siteId: string,
    cameraId: string,
    regionId: string,
    input: SetRegionActiveCommand,
  ): Promise<CameraObservationRegionEntity & { configurationVersion: number }> {
    const value = command(SetRegionActiveCommand, input);
    return await this.changeRegion(
      siteId,
      cameraId,
      regionId,
      value.expectedConfigurationVersion,
      (region) => {
        if (region.isActive === value.isActive) return false;
        region.isActive = value.isActive;
        return true;
      },
    );
  }

  private async changeRegion(
    siteId: string,
    cameraId: string,
    regionId: string,
    expected: number,
    change: (region: CameraObservationRegionEntity) => boolean,
  ): Promise<CameraObservationRegionEntity & { configurationVersion: number }> {
    return await this.dataSource.transaction(async (manager) => {
      const camera = await this.lockCamera(manager, siteId, cameraId, expected);
      const repo = manager.getRepository(CameraObservationRegionEntity);
      const region = await repo.findOneBy({ id: uuid(regionId), cameraId });
      if (!region) missing();
      const wasActive = region.isActive;
      if (!change(region))
        return Object.assign(region, { configurationVersion: camera.configurationVersion });
      if (region.isActive) {
        const count = await repo.countBy({ cameraId, isActive: true });
        if (count + Number(!wasActive) > 64)
          conflict('Camera has the maximum number of active regions');
      }
      this.bumpRegion(region);
      await repo.save(region);
      await this.bump(manager, camera);
      await this.snapshot(manager, camera, true);
      return Object.assign(region, { configurationVersion: camera.configurationVersion });
    });
  }
}
