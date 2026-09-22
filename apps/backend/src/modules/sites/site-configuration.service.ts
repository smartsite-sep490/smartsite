import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { SiteEntity } from '../../database/entities/site.entity.js';
import { command, knownUnique, missing, page, uuid } from '../../common/configuration/commands.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateSiteCommand {
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
}

export class RenameSiteCommand {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  name!: string;
}

@Injectable()
export class SiteConfigurationService {
  constructor(private readonly dataSource: DataSource) {}

  async create(input: CreateSiteCommand): Promise<SiteEntity> {
    const value = command(CreateSiteCommand, input);
    try {
      return await this.dataSource.getRepository(SiteEntity).save({ id: randomUUID(), ...value });
    } catch (error) {
      knownUnique(error, ['uq_site_code']);
    }
  }

  async get(siteId: string): Promise<SiteEntity> {
    const site = await this.dataSource.getRepository(SiteEntity).findOneBy({ id: uuid(siteId) });
    return site ?? missing();
  }

  async list(offset = 0, limit = 20): Promise<{ items: SiteEntity[]; total: number }> {
    const pagination = page(offset, limit);
    const [items, total] = await this.dataSource.getRepository(SiteEntity).findAndCount({
      order: { code: 'ASC', id: 'ASC' },
      skip: pagination.offset,
      take: pagination.limit,
    });
    return { items, total };
  }

  async rename(siteId: string, input: RenameSiteCommand): Promise<SiteEntity> {
    const value = command(RenameSiteCommand, input);
    const site = await this.get(siteId);
    if (site.name === value.name) return site;
    await this.dataSource.getRepository(SiteEntity).update({ id: site.id }, { name: value.name });
    site.name = value.name;
    return site;
  }
}
