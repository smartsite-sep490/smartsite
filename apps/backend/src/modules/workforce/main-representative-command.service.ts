import { randomUUID } from 'node:crypto';
import { authorizeMainSiteManager } from '../../common/configuration/main-site-manager-authority.js';
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import {
  command,
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
import { ContractorRepresentativeGrantEntity } from '../../database/entities/contractor-representative-grant.entity.js';
import { ContractorRepresentativeAssignmentEntity } from '../../database/entities/contractor-representative-assignment.entity.js';
import { ContractorSiteParticipationEntity } from '../../database/entities/contractor-site-participation.entity.js';
import { UserEntity } from '../../database/entities/user.entity.js';
import { GrantContractorRepresentativeCommand } from './directory/contractor-operations.service.js';
import { AssignContractorRepresentativeDto } from './directory/dto/workforce.dto.js';

/** MAIN representative membership provenance; neither Worker identity nor Zone permission. */
@Injectable()
export class MainRepresentativeCommandService {
  constructor(private readonly source: DataSource) {}

  async grant(
    contractorValue: string,
    input: GrantContractorRepresentativeCommand,
    context: MainConfigurationCommandContext,
  ): Promise<ContractorRepresentativeGrantEntity> {
    const contractorId = uuid(contractorValue).toLowerCase();
    const value = command(GrantContractorRepresentativeCommand, input);
    const userId = uuid(value.userId).toLowerCase();
    try {
      return await executeMainConfigurationCommand(
        this.source,
        context,
        'MAIN_REPRESENTATIVE_GRANT',
        { contractorId, userId },
        async (manager) => {
          // MAIN global grant checks existence and a Site REP role, not target active state.
          const contractor = await manager.getRepository(ContractorEntity).findOne({
            where: { id: contractorId },
            lock: { mode: 'pessimistic_read' },
          });
          const user = await manager.getRepository(UserEntity).findOne({
            where: { id: userId },
            lock: { mode: 'pessimistic_read' },
          });
          if (!contractor || !user) missing();
          const roles = await manager.query(
            "SELECT id FROM user_role_assignment WHERE user_id=$1 AND role='CONTRACTOR_REPRESENTATIVE' AND site_id IS NOT NULL FOR SHARE",
            [userId],
          );
          if (!roles.length) invalid('User must have a Contractor Representative Site role');
          return this.ensureGrant(manager, contractorId, userId);
        },
      );
    } catch (error) {
      // Known natural-key collisions stay public conflicts rather than leaking a driver500.
      knownUnique(error, ['uq_contractor_representative_grant']);
    }
  }

  async assign(
    siteValue: string,
    contractorValue: string,
    input: AssignContractorRepresentativeDto,
    context: MainConfigurationCommandContext,
  ): Promise<ContractorRepresentativeAssignmentEntity> {
    const siteId = uuid(siteValue).toLowerCase();
    const contractorId = uuid(contractorValue).toLowerCase();
    const value = command(AssignContractorRepresentativeDto, input);
    const userId = uuid(value.userId).toLowerCase();
    try {
      return await executeMainConfigurationCommand(
        this.source,
        context,
        'MAIN_REPRESENTATIVE_ASSIGN',
        { siteId, contractorId, userId },
        async (manager) => {
          const contractor = await manager.getRepository(ContractorEntity).findOne({
            where: { id: contractorId, isActive: true },
            lock: { mode: 'pessimistic_read' },
          });
          const user = await manager.getRepository(UserEntity).findOne({
            where: { id: userId, isActive: true },
            lock: { mode: 'pessimistic_read' },
          });
          const roles = await manager.query(
            "SELECT id FROM user_role_assignment WHERE user_id=$1 AND role='CONTRACTOR_REPRESENTATIVE' AND site_id=$2 FOR SHARE",
            [userId, siteId],
          );
          const participations = await manager
            .getRepository(ContractorSiteParticipationEntity)
            .find({
              where: { contractorId, siteId, isActive: true },
              lock: { mode: 'pessimistic_read' },
            });
          const now = Date.now();
          if (
            !contractor ||
            !user ||
            !roles.length ||
            !participations.some(
              ({ validFrom, validUntil }) =>
                validFrom.getTime() <= now && (validUntil === null || validUntil.getTime() > now),
            )
          )
            missing();
          // Preserve MAIN auto-grant, including when the Site assignment already exists.
          await this.ensureGrant(manager, contractorId, userId);
          const assignments = manager.getRepository(ContractorRepresentativeAssignmentEntity);
          const existing = await assignments.findOne({
            where: { siteId, contractorId, userId },
            lock: { mode: 'pessimistic_read' },
          });
          return existing ?? assignments.save({ id: randomUUID(), siteId, contractorId, userId });
        },
        (manager) => authorizeMainSiteManager(manager, context.actorUserId, siteId),
      );
    } catch (error) {
      knownUnique(error, [
        'uq_contractor_representative_assignment',
        'uq_contractor_representative_grant',
      ]);
    }
  }

  private async ensureGrant(manager: EntityManager, contractorId: string, userId: string) {
    const grants = manager.getRepository(ContractorRepresentativeGrantEntity);
    const existing = await grants.findOne({
      where: { contractorId, userId },
      lock: { mode: 'pessimistic_read' },
    });
    return existing ?? grants.save({ id: randomUUID(), contractorId, userId });
  }
}
