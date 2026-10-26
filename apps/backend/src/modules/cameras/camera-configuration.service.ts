import { mainSiteManagerAuthorization } from '../../common/configuration/main-site-manager-authority.js';
import { randomUUID } from 'node:crypto';
import { recordCameraConfigurationBundle } from './camera-configuration-bundles.js';
import { readIssuedCameraConfigurationBundle } from './camera-configuration-bundle-reader.js';
import { recordCameraConfigurationAcknowledgement } from './camera-configuration-acknowledgement.js';
import { readCameraObservationZones } from './camera-observation-zones.query.js';
import {
  recordRegionRevision,
  regionMutationResult,
  type RegionMutationResult,
} from './camera-region-revisions.js';
import {
  attachRegionConfirmations,
  type ConfirmedRegionEntity,
} from './camera-region-confirmation.query.js';
import {
  referenceActor,
  resolveRegionReference,
  type ReferenceRegionWrite,
} from './camera-region-reference-write.js';
import {
  parseCreateReferenceRegionCommand,
  parseUpdateReferenceRegionPolygonCommand,
} from '@smartsite/contracts/camera-region-reference';
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
import {
  executeMainConfigurationCommand,
  executeMainMetadataMutation,
  type MainConfigurationCommandContext,
} from '../../common/configuration/main-configuration-authority.js';

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

  async create(
    siteId: string,
    input: CreateCameraCommand,
    context?: MainConfigurationCommandContext,
  ): Promise<CameraEntity> {
    const value = command(CreateCameraCommand, input);
    await this.sites.get(siteId);
    try {
      return await executeMainConfigurationCommand(
        this.dataSource,
        context,
        'CAMERA_CREATE',
        { siteId, value },
        (manager) =>
          manager.getRepository(CameraEntity).save({
            id: randomUUID(),
            siteId,
            ...value,
            status: CameraStatus.ACTIVE,
            configurationVersion: 1,
          }),
        mainSiteManagerAuthorization(context, siteId),
      );
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

  async safetyZoneCameras(
    manager: EntityManager,
    siteId: string,
    zoneIds: string[],
  ): Promise<import('@smartsite/contracts').SafetyOverviewCamera[]> {
    if (!zoneIds.length) return [];
    return manager.query(
      `SELECT DISTINCT c.id,c.code,c.name,c.external_id AS "externalId",c.status,r.zone_id AS "zoneId" FROM camera c JOIN camera_observation_region r ON r.camera_id=c.id AND r.is_active JOIN zone z ON z.id=r.zone_id AND z.site_id=c.site_id WHERE c.site_id=$1 AND r.zone_id=ANY($2::uuid[]) ORDER BY c.name,c.id`,
      [siteId, zoneIds],
    );
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
    context?: MainConfigurationCommandContext,
  ): Promise<CameraEntity> {
    const value = command(RenameCameraCommand, input);
    return executeMainMetadataMutation(
      this.dataSource,
      context,
      async (manager) => {
        const repository = manager.getRepository(CameraEntity);
        const camera = await repository.findOne({
          where: { id: uuid(cameraId), siteId: uuid(siteId) },
          lock: { mode: 'pessimistic_write' },
        });
        if (!camera) return missing();
        if (camera.name === value.name) return camera;
        await repository.update({ id: camera.id, siteId: camera.siteId }, { name: value.name });
        camera.name = value.name;
        return camera;
      },
      mainSiteManagerAuthorization(context, siteId),
    );
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

  async readConfigurationBundleForCamera(cameraId: string) {
    return readIssuedCameraConfigurationBundle(this.dataSource, uuid(cameraId).toLowerCase());
  }

  async acknowledgeConfigurationForCamera(cameraId: string, secret: string, input: unknown) {
    return recordCameraConfigurationAcknowledgement(this.dataSource, cameraId, secret, input);
  }

  async setStatus(
    siteId: string,
    cameraId: string,
    input: SetCameraStatusCommand,
    context?: MainConfigurationCommandContext,
  ): Promise<CameraEntity> {
    const value = command(SetCameraStatusCommand, input);
    return await executeMainConfigurationCommand(
      this.dataSource,
      context,
      'CAMERA_STATUS_UPDATE',
      { siteId, cameraId, value },
      async (manager) => {
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
        for (const region of activeRegions)
          await recordRegionRevision(manager, camera, region, true);
        await recordCameraConfigurationBundle(
          manager,
          camera,
          await this.snapshot(manager, camera, true),
          this.zones,
        );
        return camera;
      },
      mainSiteManagerAuthorization(context, siteId),
    );
  }

  async listRegions(
    siteId: string,
    cameraId: string,
    offset = 0,
    limit = 20,
  ): Promise<{ items: ConfirmedRegionEntity[]; total: number }> {
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
    return {
      items: await attachRegionConfirmations(this.dataSource, siteId, cameraId, items),
      total,
    };
  }

  async observationZones(siteId: string, cameraId: string, offset: number, limit: number) {
    return readCameraObservationZones(this.dataSource, this.zones, siteId, cameraId, offset, limit);
  }

  async getRegion(
    siteId: string,
    cameraId: string,
    regionId: string,
  ): Promise<ConfirmedRegionEntity> {
    await this.get(siteId, cameraId);
    const region = await this.dataSource
      .getRepository(CameraObservationRegionEntity)
      .findOneBy({ id: uuid(regionId), cameraId });
    if (!region) missing();
    return (await attachRegionConfirmations(this.dataSource, siteId, cameraId, [region]))[0]!;
  }

  async createRegion(
    siteId: string,
    cameraId: string,
    input: CreateRegionCommand,
    context?: MainConfigurationCommandContext,
  ): Promise<CameraObservationRegionEntity & { configurationVersion: number }> {
    return this.createRegionMutation(siteId, cameraId, input, context);
  }

  async createReferenceRegion(
    siteId: string,
    cameraId: string,
    input: unknown,
    context?: MainConfigurationCommandContext,
  ): Promise<RegionMutationResult> {
    const actorUserId = referenceActor(context);
    let value;
    try {
      value = parseCreateReferenceRegionCommand(input);
    } catch {
      return invalid();
    }
    return this.createRegionMutation(
      siteId,
      cameraId,
      {
        zoneId: value.zoneId,
        polygon: value.polygon,
        expectedConfigurationVersion: value.expectedConfigurationVersion,
      },
      context,
      { command: value, actorUserId },
    );
  }

  private async createRegionMutation(
    siteId: string,
    cameraId: string,
    input: CreateRegionCommand,
    context: MainConfigurationCommandContext | undefined,
    reference?: ReferenceRegionWrite,
  ): Promise<CameraObservationRegionEntity & { configurationVersion: number }> {
    const value = command(CreateRegionCommand, input);
    uuid(value.zoneId);
    this.checkPolygon(value.polygon);
    return await executeMainConfigurationCommand(
      this.dataSource,
      context,
      'REGION_CREATE',
      { siteId, cameraId, value, ...(reference ? { reference: reference.command } : {}) },
      async (manager) => {
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
        const provenance = reference
          ? await resolveRegionReference(manager, camera, reference)
          : undefined;
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
        await recordRegionRevision(manager, camera, region, false, provenance);
        await recordCameraConfigurationBundle(
          manager,
          camera,
          await this.snapshot(manager, camera, true),
          this.zones,
        );
        return regionMutationResult(region, camera.configurationVersion, provenance);
      },
      mainSiteManagerAuthorization(context, siteId),
    );
  }

  async updatePolygon(
    siteId: string,
    cameraId: string,
    regionId: string,
    input: UpdateRegionPolygonCommand,
    context?: MainConfigurationCommandContext,
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
      context,
      'REGION_POLYGON_UPDATE',
      { siteId, cameraId, regionId, value },
    );
  }

  async updateReferencePolygon(
    siteId: string,
    cameraId: string,
    regionId: string,
    input: unknown,
    context?: MainConfigurationCommandContext,
  ): Promise<RegionMutationResult> {
    const actorUserId = referenceActor(context);
    let value;
    try {
      value = parseUpdateReferenceRegionPolygonCommand(input);
    } catch {
      return invalid();
    }
    return this.changeRegion(
      siteId,
      cameraId,
      regionId,
      value.expectedConfigurationVersion,
      (region) => {
        region.polygon = value.polygon;
        return true;
      },
      context,
      'REGION_POLYGON_UPDATE',
      { siteId, cameraId, regionId, value },
      { command: value, actorUserId },
    );
  }

  async setRegionActive(
    siteId: string,
    cameraId: string,
    regionId: string,
    input: SetRegionActiveCommand,
    context?: MainConfigurationCommandContext,
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
      context,
      'REGION_STATUS_UPDATE',
      { siteId, cameraId, regionId, value },
    );
  }

  private async changeRegion(
    siteId: string,
    cameraId: string,
    regionId: string,
    expected: number,
    change: (region: CameraObservationRegionEntity) => boolean,
    context: MainConfigurationCommandContext | undefined,
    operation: 'REGION_POLYGON_UPDATE' | 'REGION_STATUS_UPDATE',
    request: object,
    reference?: ReferenceRegionWrite,
  ): Promise<CameraObservationRegionEntity & { configurationVersion: number }> {
    return await executeMainConfigurationCommand(
      this.dataSource,
      context,
      operation,
      request,
      async (manager) => {
        const camera = await this.lockCamera(manager, siteId, cameraId, expected);
        const repo = manager.getRepository(CameraObservationRegionEntity);
        const region = await repo.findOneBy({ id: uuid(regionId), cameraId });
        if (!region) missing();
        const provenance = reference
          ? await resolveRegionReference(manager, camera, reference)
          : undefined;
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
        await recordRegionRevision(
          manager,
          camera,
          region,
          operation === 'REGION_STATUS_UPDATE',
          provenance,
        );
        await recordCameraConfigurationBundle(
          manager,
          camera,
          await this.snapshot(manager, camera, true),
          this.zones,
        );
        return regionMutationResult(region, camera.configurationVersion, provenance);
      },
      mainSiteManagerAuthorization(context, siteId),
    );
  }
}
