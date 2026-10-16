import { randomUUID } from 'node:crypto';
import { authorizeMainSiteManager } from '../../common/configuration/main-site-manager-authority.js';
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import {
  command,
  conflict,
  knownUnique,
  missing,
  uuid,
} from '../../common/configuration/commands.js';
import {
  executeMainConfigurationCommand,
  type MainConfigurationCommandContext,
} from '../../common/configuration/main-configuration-authority.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { ContractorEntity } from '../../database/entities/contractor.entity.js';
import { ContractorSiteParticipationEntity } from '../../database/entities/contractor-site-participation.entity.js';
import { WorkerEntity } from '../../database/entities/worker.entity.js';
import {
  CreateContractorCommand,
  CreateContractorWorkerCommand,
} from './directory/contractor-operations.service.js';
import { CreateContractorDto } from './directory/dto/workforce.dto.js';

function forbidden(): never {
  throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
}

/** Existing public enrollment semantics with retained-main, actor-bound journal hooks. */
@Injectable()
export class MainWorkforceCreateService {
  constructor(private readonly source: DataSource) {}

  async createSiteContractor(
    siteIdValue: string,
    input: CreateContractorDto,
    context: MainConfigurationCommandContext,
  ): Promise<ContractorEntity> {
    const siteId = uuid(siteIdValue).toLowerCase();
    const validated = command(CreateContractorDto, input);
    const value = { ...validated, code: validated.code ?? `CTR-${randomUUID().toUpperCase()}` };
    try {
      return await executeMainConfigurationCommand(
        this.source,
        context,
        'SITE_CONTRACTOR_CREATE',
        { siteId, ...value },
        async (manager) => {
          const sites = await manager.query('SELECT id FROM site WHERE id=$1 FOR SHARE', [siteId]);
          if (!sites.length) missing();
          let contractor = await manager.getRepository(ContractorEntity).findOne({
            where: { code: value.code },
            lock: { mode: 'pessimistic_read' },
          });
          if (contractor && (contractor.name !== value.name || !contractor.isActive))
            conflict('Contractor code belongs to another name or an inactive contractor');
          contractor ??= await manager.getRepository(ContractorEntity).save({
            id: randomUUID(),
            ...value,
            isActive: true,
          });
          const participations = await manager
            .getRepository(ContractorSiteParticipationEntity)
            .createQueryBuilder('participation')
            .where(
              'participation.contractor_id=:contractorId AND participation.site_id=:siteId AND participation.is_active=TRUE',
              { contractorId: contractor.id, siteId },
            )
            .setLock('pessimistic_read')
            .getMany();
          // Preserve MAIN's Date-based current interval check and open-ended auto-enrollment.
          const at = new Date();
          if (
            !participations.some(
              ({ validFrom, validUntil }) =>
                validFrom.getTime() <= at.getTime() &&
                (validUntil === null || validUntil.getTime() > at.getTime()),
            )
          ) {
            await manager.getRepository(ContractorSiteParticipationEntity).save({
              id: randomUUID(),
              contractorId: contractor.id,
              siteId,
              validFrom: at,
              validUntil: null,
              isActive: true,
            });
          }
          return contractor;
        },
        (manager) => authorizeMainSiteManager(manager, context.actorUserId, siteId),
      );
    } catch (error) {
      knownUnique(error, ['uq_contractor_code']);
    }
  }

  async createContractor(input: CreateContractorCommand, context: MainConfigurationCommandContext) {
    const value = command(CreateContractorCommand, input);
    try {
      return await executeMainConfigurationCommand(
        this.source,
        context,
        'CONTRACTOR_CREATE',
        value,
        (manager) =>
          manager
            .getRepository(ContractorEntity)
            .save({ id: randomUUID(), ...value, isActive: true }),
      );
    } catch (error) {
      knownUnique(error, ['uq_contractor_code']);
    }
  }

  async createWorker(
    contractorIdValue: string,
    input: CreateContractorWorkerCommand,
    context: MainConfigurationCommandContext,
  ) {
    const contractorId = uuid(contractorIdValue).toLowerCase();
    const value = command(CreateContractorWorkerCommand, input);
    const siteId = uuid(value.siteId).toLowerCase();
    try {
      return await executeMainConfigurationCommand(
        this.source,
        context,
        'CONTRACTOR_WORKER_CREATE',
        { contractorId, ...value, siteId },
        async (manager) => {
          // Retained main: even a global Admin needs an active Contractor participation.
          // Lock the source rows so a concurrent eligibility change cannot go unnoticed.
          const contractor = (
            await manager.query('SELECT id,is_active FROM contractor WHERE id=$1 FOR SHARE', [
              contractorId,
            ])
          )[0];
          if (!contractor) missing();
          if (!contractor.is_active) forbidden();
          const at = new Date();
          const participation = await manager.query(
            'SELECT id FROM contractor_site_participation WHERE contractor_id=$1 AND site_id=$2 AND is_active AND valid_from<=$3::timestamptz AND (valid_until IS NULL OR valid_until>$3::timestamptz) FOR SHARE',
            [contractorId, siteId, at],
          );
          if (!participation.length) forbidden();
          return manager.getRepository(WorkerEntity).save({
            id: randomUUID(),
            contractorId,
            siteId,
            externalId: value.externalId,
            displayName: value.displayName,
            isActive: true,
          });
        },
        (manager) =>
          this.authorizeRepresentative(manager, context.actorUserId, contractorId, siteId),
      );
    } catch (error) {
      knownUnique(error, ['uq_worker_site_external_id']);
    }
  }

  private async authorizeRepresentative(
    manager: EntityManager,
    actorValue: string,
    contractorId: string,
    siteId: string,
  ): Promise<void> {
    const actor = uuid(actorValue).toLowerCase();
    const roles = await manager.query(
      "SELECT role,site_id FROM user_role_assignment WHERE user_id=$1 AND ((role='ADMIN' AND site_id IS NULL) OR (role='CONTRACTOR_REPRESENTATIVE' AND site_id=$2)) FOR SHARE",
      [actor, siteId],
    );
    if (
      roles.some(
        (row: { role: string; site_id: string | null }) =>
          row.role === 'ADMIN' && row.site_id === null,
      )
    )
      return;
    if (!roles.length) forbidden();
    const grants = await manager.query(
      'SELECT id FROM contractor_representative_grant WHERE user_id=$1 AND contractor_id=$2 FOR SHARE',
      [actor, contractorId],
    );
    if (!grants.length) forbidden();
  }
}
