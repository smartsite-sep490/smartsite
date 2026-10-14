import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import {
  command,
  conflict,
  invalid,
  knownUnique,
  missing,
  uuid,
} from '../../common/configuration/commands.js';
import {
  executeMainConfigurationCommand,
  type MainConfigurationCommandContext,
} from '../../common/configuration/main-configuration-authority.js';
import { ContractorEntity } from '../../database/entities/contractor.entity.js';
import { ContractorSiteParticipationEntity } from '../../database/entities/contractor-site-participation.entity.js';
import { UserEntity } from '../../database/entities/user.entity.js';
import { WorkerEntity } from '../../database/entities/worker.entity.js';
import { CreateWorkerDto } from './directory/dto/workforce.dto.js';
import { LinkWorkerAccountCommand } from './directory/workforce-configuration.service.js';

/** Site roster/account commands preserve MAIN enrollment rules and capture original actors. */
@Injectable()
export class MainWorkerRosterService {
  constructor(private readonly source: DataSource) {}

  async create(
    siteValue: string,
    input: CreateWorkerDto,
    context: MainConfigurationCommandContext,
  ): Promise<WorkerEntity> {
    const siteId = uuid(siteValue).toLowerCase();
    const value = command(CreateWorkerDto, input);
    if (!!value.contractorId !== !!value.userId)
      invalid('Worker contractor and user assignments must be set together');
    try {
      return await executeMainConfigurationCommand(
        this.source,
        context,
        'WORKER_ROSTER_CREATE',
        { siteId, ...value },
        async (manager) => {
          await this.requireSite(manager, siteId);
          if (value.contractorId && value.userId) {
            const contractor = await manager.getRepository(ContractorEntity).findOne({
              where: { id: value.contractorId, isActive: true },
              lock: { mode: 'pessimistic_read' },
            });
            const users = await manager.getRepository(UserEntity).findOne({
              where: { id: value.userId, isActive: true },
              lock: { mode: 'pessimistic_read' },
            });
            const roles = await manager.query(
              "SELECT id FROM user_role_assignment WHERE user_id=$1 AND role='WORKER' AND site_id=$2 FOR SHARE",
              [value.userId, siteId],
            );
            if (!contractor || !users || !roles.length) missing();
            const participations = await manager
              .getRepository(ContractorSiteParticipationEntity)
              .find({
                where: { contractorId: value.contractorId, siteId, isActive: true },
                lock: { mode: 'pessimistic_read' },
              });
            const now = Date.now();
            if (
              !participations.some(
                ({ validFrom, validUntil }) =>
                  validFrom.getTime() <= now && (validUntil === null || validUntil.getTime() > now),
              )
            )
              missing();
          }
          return manager.getRepository(WorkerEntity).save({
            id: randomUUID(),
            siteId,
            contractorId: value.contractorId ?? null,
            userId: value.userId ?? null,
            externalId: value.externalId,
            displayName: value.displayName,
            isActive: true,
          });
        },
      );
    } catch (error) {
      knownUnique(error, ['uq_worker_site_external_id', 'uq_worker_site_user']);
    }
  }

  async forAccount(
    siteValue: string,
    input: LinkWorkerAccountCommand,
    context: MainConfigurationCommandContext,
  ): Promise<WorkerEntity> {
    const siteId = uuid(siteValue).toLowerCase(),
      value = command(LinkWorkerAccountCommand, input);
    try {
      return await executeMainConfigurationCommand(
        this.source,
        context,
        'WORKER_ACCOUNT_PREPARE',
        { siteId, ...value },
        async (manager) => {
          // MAIN serializes account-first preparation on the active target account.
          const user = await this.requireAccount(manager, siteId, value.userId, true);
          await this.requireSite(manager, siteId);
          const existing = await manager
            .getRepository(WorkerEntity)
            .findOneBy({ siteId, userId: user.id });
          if (existing) {
            if (!existing.isActive) conflict('The linked worker is inactive');
            return existing;
          }
          return manager.getRepository(WorkerEntity).save({
            id: randomUUID(),
            siteId,
            userId: user.id,
            contractorId: null,
            externalId: `ACC-${user.id}`,
            displayName: user.displayName,
            isActive: true,
          });
        },
      );
    } catch (error) {
      knownUnique(error, ['uq_worker_site_user', 'uq_worker_site_external_id']);
    }
  }

  async linkAccount(
    siteValue: string,
    workerValue: string,
    input: LinkWorkerAccountCommand,
    context: MainConfigurationCommandContext,
  ): Promise<WorkerEntity> {
    const siteId = uuid(siteValue).toLowerCase(),
      workerId = uuid(workerValue).toLowerCase(),
      value = command(LinkWorkerAccountCommand, input);
    try {
      return await executeMainConfigurationCommand(
        this.source,
        context,
        'WORKER_ACCOUNT_LINK',
        { siteId, workerId, ...value },
        async (manager) => {
          const worker = await manager
            .getRepository(WorkerEntity)
            .findOne({ where: { id: workerId, siteId }, lock: { mode: 'pessimistic_write' } });
          if (!worker) missing();
          const user = await this.requireAccount(manager, siteId, value.userId, false);
          if (worker.userId && worker.userId !== user.id)
            conflict('Worker is already linked to another account');
          worker.userId = user.id;
          return manager.getRepository(WorkerEntity).save(worker);
        },
      );
    } catch (error) {
      knownUnique(error, ['uq_worker_site_user']);
    }
  }

  private async requireSite(manager: EntityManager, siteId: string): Promise<void> {
    if (!(await manager.query('SELECT id FROM site WHERE id=$1 FOR SHARE', [siteId])).length)
      missing();
  }

  private async requireAccount(
    manager: EntityManager,
    siteId: string,
    userId: string,
    writeLock: boolean,
  ): Promise<UserEntity> {
    const user = await manager.getRepository(UserEntity).findOne({
      where: { id: userId, isActive: true },
      lock: { mode: writeLock ? 'pessimistic_write' : 'pessimistic_read' },
    });
    const roles = await manager.query(
      "SELECT id FROM user_role_assignment WHERE user_id=$1 AND (site_id=$2 OR (role='ADMIN' AND site_id IS NULL)) FOR SHARE",
      [userId, siteId],
    );
    if (!user || !roles.length) conflict('An active account assigned to this site is required');
    return user;
  }
}
