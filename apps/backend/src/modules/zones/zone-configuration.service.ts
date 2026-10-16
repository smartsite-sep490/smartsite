import { randomUUID } from 'node:crypto';
import { authorizeMainSiteManager } from '../../common/configuration/main-site-manager-authority.js';
import { Injectable } from '@nestjs/common';
import { PPE_ITEMS } from '@smartsite/contracts';
import {
  executeMainConfigurationCommand,
  executeMainMetadataMutation,
  type MainConfigurationCommandContext,
} from '../../common/configuration/main-configuration-authority.js';
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { DataSource, In, type EntityManager } from 'typeorm';
import {
  command,
  conflict,
  knownUnique,
  missing,
  page,
  uuid,
} from '../../common/configuration/commands.js';
import { ZoneRestrictionPolicy, ZoneType } from '../../database/entities/enums.js';
import { ZoneEntity } from '../../database/entities/zone.entity.js';
import { SiteConfigurationService } from '../sites/site-configuration.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateZoneCommand {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  code?: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  name!: string;
  @IsEnum(ZoneType)
  type!: ZoneType;
  @IsEnum(ZoneRestrictionPolicy)
  restrictionPolicy!: ZoneRestrictionPolicy;
  @IsArray()
  @ArrayUnique()
  @IsIn(PPE_ITEMS, { each: true })
  requiredPpe!: string[];
}

export class RenameZoneCommand {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  name!: string;
}

export class UpdateZonePolicyCommand {
  @IsEnum(ZoneType)
  type!: ZoneType;
  @IsEnum(ZoneRestrictionPolicy)
  restrictionPolicy!: ZoneRestrictionPolicy;
  @IsArray()
  @ArrayUnique()
  @IsIn(PPE_ITEMS, { each: true })
  requiredPpe!: string[];
}

@Injectable()
export class ZoneConfigurationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sites: SiteConfigurationService,
  ) {}

  async create(
    siteId: string,
    input: CreateZoneCommand,
    context?: MainConfigurationCommandContext,
  ): Promise<ZoneEntity> {
    const value = command(CreateZoneCommand, input);
    await this.sites.get(siteId);
    try {
      return await executeMainConfigurationCommand(
        this.dataSource,
        context,
        'ZONE_CREATE',
        { siteId, value },
        (manager) =>
          manager.getRepository(ZoneEntity).save({
            id: randomUUID(),
            siteId,
            ...value,
            code: value.code ?? `ZONE-${randomUUID().toUpperCase()}`,
            requiredPpe: [...value.requiredPpe].sort(),
            configurationLocked: false,
          }),
        context
          ? (manager) => authorizeMainSiteManager(manager, context.actorUserId, siteId)
          : undefined,
      );
    } catch (error) {
      knownUnique(error, ['uq_zone_site_code']);
    }
  }

  async referenceName(siteId: string, zoneId: string | null): Promise<string | null> {
    if (!zoneId) return null;
    return (
      (await this.dataSource.getRepository(ZoneEntity).findOneBy({ siteId, id: zoneId }))?.name ??
      null
    );
  }
  async observationReferences(manager: EntityManager, siteId: string, zoneIds: string[]) {
    uuid(siteId);
    if (zoneIds.length > 64) conflict('Too many observation Zone references');
    if (zoneIds.length === 0) return [];
    zoneIds.forEach(uuid);
    return manager.getRepository(ZoneEntity).find({
      where: { siteId, id: In(zoneIds) },
      select: { id: true, code: true, name: true },
      order: { id: 'ASC' },
    });
  }
  async get(siteId: string, zoneId: string): Promise<ZoneEntity> {
    const zone = await this.dataSource
      .getRepository(ZoneEntity)
      .findOneBy({ siteId: uuid(siteId), id: uuid(zoneId) });
    return zone ?? missing();
  }

  async list(
    siteId: string,
    offset = 0,
    limit = 20,
  ): Promise<{ items: ZoneEntity[]; total: number }> {
    await this.sites.get(siteId);
    const pagination = page(offset, limit);
    const [items, total] = await this.dataSource.getRepository(ZoneEntity).findAndCount({
      where: { siteId },
      order: { code: 'ASC', id: 'ASC' },
      skip: pagination.offset,
      take: pagination.limit,
    });
    return { items, total };
  }

  async rename(
    siteId: string,
    zoneId: string,
    input: RenameZoneCommand,
    context?: MainConfigurationCommandContext,
  ): Promise<ZoneEntity> {
    const value = command(RenameZoneCommand, input);
    return executeMainMetadataMutation(
      this.dataSource,
      context,
      async (manager) => {
        const repository = manager.getRepository(ZoneEntity);
        const zone = await repository.findOne({
          where: { id: uuid(zoneId), siteId: uuid(siteId) },
          lock: { mode: 'pessimistic_write' },
        });
        if (!zone) return missing();
        if (zone.name === value.name) return zone;
        await repository.update({ id: zone.id, siteId: zone.siteId }, { name: value.name });
        zone.name = value.name;
        return zone;
      },
      context
        ? (manager) => authorizeMainSiteManager(manager, context.actorUserId, siteId)
        : undefined,
    );
  }

  async updatePolicy(
    siteId: string,
    zoneId: string,
    input: UpdateZonePolicyCommand,
    context?: MainConfigurationCommandContext,
  ): Promise<ZoneEntity> {
    const value = command(UpdateZonePolicyCommand, input);
    uuid(siteId);
    uuid(zoneId);
    return await executeMainConfigurationCommand(
      this.dataSource,
      context,
      'ZONE_POLICY_UPDATE',
      { siteId, zoneId, value },
      async (manager) => {
        const zone = await this.lockForRegion(manager, siteId, zoneId);
        const requiredPpe = [...value.requiredPpe].sort();
        if (
          zone.type === value.type &&
          zone.restrictionPolicy === value.restrictionPolicy &&
          JSON.stringify([...zone.requiredPpe].sort()) === JSON.stringify(requiredPpe)
        )
          return zone;
        if (zone.configurationLocked) conflict('Zone policy is locked after a region is linked');
        await manager.getRepository(ZoneEntity).update(
          { id: zone.id },
          {
            type: value.type,
            restrictionPolicy: value.restrictionPolicy,
            requiredPpe,
          },
        );
        zone.type = value.type;
        zone.restrictionPolicy = value.restrictionPolicy;
        zone.requiredPpe = requiredPpe;
        return zone;
      },
      context
        ? (manager) => authorizeMainSiteManager(manager, context.actorUserId, siteId)
        : undefined,
    );
  }

  async lockForRegion(manager: EntityManager, siteId: string, zoneId: string): Promise<ZoneEntity> {
    const zone = await manager
      .getRepository(ZoneEntity)
      .createQueryBuilder('zone')
      .setLock('pessimistic_write')
      .where('zone.id = :zoneId AND zone.siteId = :siteId', {
        zoneId: uuid(zoneId),
        siteId: uuid(siteId),
      })
      .getOne();
    return zone ?? missing();
  }

  async markLinked(manager: EntityManager, zone: ZoneEntity): Promise<void> {
    if (zone.configurationLocked) return;
    await manager.getRepository(ZoneEntity).update({ id: zone.id }, { configurationLocked: true });
    zone.configurationLocked = true;
  }
}
