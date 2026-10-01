import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { DataSource, IsNull } from 'typeorm';
import {
  command,
  conflict,
  knownUnique,
  missing,
  page,
  uuid,
} from '../../common/configuration/commands.js';
import { UserEntity, UserRole } from '../../database/entities/user.entity.js';
import { UserRoleAssignmentEntity } from '../../database/entities/user-role-assignment.entity.js';
import { SiteEntity } from '../../database/entities/site.entity.js';
import { WorkerEntity } from '../../database/entities/worker.entity.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class LinkWorkerAccountCommand {
  @IsUUID()
  userId!: string;
}

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

  async linkAccount(siteIdValue: string, workerIdValue: string, input: LinkWorkerAccountCommand) {
    const siteId = uuid(siteIdValue);
    const workerId = uuid(workerIdValue);
    const value = command(LinkWorkerAccountCommand, input);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const worker = await manager
          .getRepository(WorkerEntity)
          .createQueryBuilder('worker')
          .setLock('pessimistic_write')
          .where('worker.id = :workerId AND worker.site_id = :siteId', { workerId, siteId })
          .getOne();
        if (!worker) missing();
        const user = await manager
          .getRepository(UserEntity)
          .findOneBy({ id: value.userId, isActive: true });
        const assignment = await manager.getRepository(UserRoleAssignmentEntity).findOneBy([
          { userId: value.userId, siteId },
          { userId: value.userId, siteId: IsNull(), role: UserRole.ADMIN },
        ]);
        if (!user || !assignment) conflict('An active account assigned to this site is required');
        if (worker.userId && worker.userId !== user.id)
          conflict('Worker is already linked to another account');
        worker.userId = user.id;
        return manager.getRepository(WorkerEntity).save(worker);
      });
    } catch (error) {
      knownUnique(error, ['uq_worker_site_user']);
    }
  }

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
