import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { command, knownUnique, missing, page, uuid } from '../../common/configuration/commands.js';
import { SiteEntity } from '../../database/entities/site.entity.js';
import { WorkerEntity } from '../../database/entities/worker.entity.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateWorkerCommand {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  externalId!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  displayName!: string;
}

@Injectable()
export class WorkforceConfigurationService {
  constructor(private readonly dataSource: DataSource) {}

  async create(siteId: string, input: CreateWorkerCommand): Promise<WorkerEntity> {
    const scopedSiteId = uuid(siteId);
    const value = command(CreateWorkerCommand, input);
    const site = await this.dataSource.getRepository(SiteEntity).findOneBy({ id: scopedSiteId });
    if (!site) missing();
    try {
      return await this.dataSource.getRepository(WorkerEntity).save({
        id: randomUUID(),
        siteId: scopedSiteId,
        externalId: value.externalId,
        displayName: value.displayName,
        isActive: true,
      });
    } catch (error) {
      knownUnique(error, ['uq_worker_site_external_id']);
    }
  }

  async list(
    siteId: string,
    offset = 0,
    limit = 20,
  ): Promise<{ items: WorkerEntity[]; total: number }> {
    const pagination = page(offset, limit);
    const [items, total] = await this.dataSource.getRepository(WorkerEntity).findAndCount({
      where: { siteId: uuid(siteId) },
      order: { externalId: 'ASC', id: 'ASC' },
      skip: pagination.offset,
      take: pagination.limit,
    });
    return { items, total };
  }
}
