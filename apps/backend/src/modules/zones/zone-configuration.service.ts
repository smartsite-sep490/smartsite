import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { DataSource, type EntityManager } from 'typeorm';
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
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  code!: string;
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
  @IsIn(['HARD_HAT', 'SAFETY_VEST'], { each: true })
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
  @IsIn(['HARD_HAT', 'SAFETY_VEST'], { each: true })
  requiredPpe!: string[];
}

@Injectable()
export class ZoneConfigurationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sites: SiteConfigurationService,
  ) {}

  async create(siteId: string, input: CreateZoneCommand): Promise<ZoneEntity> {
    const value = command(CreateZoneCommand, input);
    await this.sites.get(siteId);
    try {
      return await this.dataSource.getRepository(ZoneEntity).save({
        id: randomUUID(),
        siteId,
        ...value,
        requiredPpe: [...value.requiredPpe].sort(),
        configurationLocked: false,
      });
    } catch (error) {
      knownUnique(error, ['uq_zone_site_code']);
    }
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

  async rename(siteId: string, zoneId: string, input: RenameZoneCommand): Promise<ZoneEntity> {
    const value = command(RenameZoneCommand, input);
    const zone = await this.get(siteId, zoneId);
    if (zone.name === value.name) return zone;
    await this.dataSource
      .getRepository(ZoneEntity)
      .update({ id: zone.id, siteId }, { name: value.name });
    zone.name = value.name;
    return zone;
  }

  async updatePolicy(
    siteId: string,
    zoneId: string,
    input: UpdateZonePolicyCommand,
  ): Promise<ZoneEntity> {
    const value = command(UpdateZonePolicyCommand, input);
    uuid(siteId);
    uuid(zoneId);
    return await this.dataSource.transaction(async (manager) => {
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
    });
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
