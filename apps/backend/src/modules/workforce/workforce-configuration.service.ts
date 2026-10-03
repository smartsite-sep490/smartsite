import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import {
  ArrayContains,
  DataSource,
  IsNull,
  type EntityManager,
  type FindOptionsWhere,
} from 'typeorm';
import {
  command,
  conflict,
  knownUnique,
  missing,
  page,
  uuid,
} from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { ContractorRepresentativeAssignmentEntity } from '../../database/entities/contractor-representative-assignment.entity.js';
import { ContractorRepresentativeGrantEntity } from '../../database/entities/contractor-representative-grant.entity.js';
import { ContractorSiteParticipationEntity } from '../../database/entities/contractor-site-participation.entity.js';
import { ContractorEntity } from '../../database/entities/contractor.entity.js';
import { SiteEntity } from '../../database/entities/site.entity.js';
import { UserRoleAssignmentEntity } from '../../database/entities/user-role-assignment.entity.js';
import { UserEntity, UserRole } from '../../database/entities/user.entity.js';
import { WorkerEntity } from '../../database/entities/worker.entity.js';
import {
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
} from '../../database/entities/worker-site-zone-assignment.entity.js';
import { AuthenticatedUser } from '../auth/auth.service.js';
import {
  AssignContractorRepresentativeDto,
  CreateContractorDto,
  CreateWorkerDto,
} from './dto/workforce.dto.js';
import { hasActiveContractorParticipation } from './contractor-participation.js';
import type { ZoneAuthorityActor } from '../zones/zone-authority-history.js';
import {
  contractorFact,
  participationFact,
  workerMembershipFact,
  writeWorkforceAuthority,
} from './workforce-authority-history.js';

/** Safe read projection; account, face, and contractor data stay in their owning workflows. */
export type WorkerReviewReference = Pick<
  WorkerEntity,
  'id' | 'siteId' | 'externalId' | 'displayName' | 'isActive'
>;

export interface ZoneGrantWorkforcePrerequisites {
  siteId: string;
  workerId: string;
  contractorId: string;
  participationIntervals: Array<{
    siteId: string;
    contractorId: string;
    validFrom: Date;
    validUntil: Date | null;
    revokedAt: null;
  }>;
  assignmentIntervals: Array<{
    siteId: string;
    contractorId: string;
    workerId: string;
    zoneId: string;
    validFrom: Date;
    validUntil: Date | null;
    revokedAt: null;
  }>;
}

/** Exported owner query for grant creation only. It cannot establish historical/live identity. */
export async function readZoneGrantWorkforcePrerequisites(
  manager: EntityManager,
  siteId: string,
  zoneId: string,
  workerId: string,
): Promise<ZoneGrantWorkforcePrerequisites | null> {
  const scope = { siteId: uuid(siteId), zoneId: uuid(zoneId), workerId: uuid(workerId) };
  const worker = await manager.getRepository(WorkerEntity).findOne({
    where: { id: scope.workerId, siteId: scope.siteId, isActive: true },
    lock: { mode: 'pessimistic_read' },
  });
  if (!worker?.contractorId) return null;
  const contractor = await manager.getRepository(ContractorEntity).findOne({
    where: { id: worker.contractorId, isActive: true },
    lock: { mode: 'pessimistic_read' },
  });
  if (!contractor) return null;
  const participations = await manager.getRepository(ContractorSiteParticipationEntity).find({
    where: { siteId: scope.siteId, contractorId: contractor.id, isActive: true },
    order: { id: 'ASC' },
    lock: { mode: 'pessimistic_read' },
  });
  const assignments = await manager.getRepository(WorkerSiteZoneAssignmentEntity).find({
    where: {
      siteId: scope.siteId,
      workerId: worker.id,
      contractorId: contractor.id,
      status: WorkerSiteZoneAssignmentStatus.APPROVED,
      zoneIds: ArrayContains([scope.zoneId]),
    },
    order: { id: 'ASC' },
    lock: { mode: 'pessimistic_read' },
  });
  return {
    siteId: scope.siteId,
    workerId: worker.id,
    contractorId: contractor.id,
    participationIntervals: participations.map((row) => ({
      siteId: row.siteId,
      contractorId: row.contractorId,
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      revokedAt: null,
    })),
    assignmentIntervals: assignments.map((row) => ({
      siteId: row.siteId,
      contractorId: row.contractorId!,
      workerId: row.workerId,
      zoneId: scope.zoneId,
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      revokedAt: null,
    })),
  };
}
const workerReviewFields = {
  id: true,
  siteId: true,
  externalId: true,
  displayName: true,
  isActive: true,
} as const;
function workerReviewReference(worker: WorkerEntity): WorkerReviewReference {
  return {
    id: worker.id,
    siteId: worker.siteId,
    externalId: worker.externalId,
    displayName: worker.displayName,
    isActive: worker.isActive,
  };
}

export class LinkWorkerAccountCommand {
  @IsUUID()
  userId!: string;
}

@Injectable()
export class WorkforceConfigurationService {
  constructor(private readonly dataSource: DataSource) {}

  private async assertAdminActor(manager: EntityManager, actor: ZoneAuthorityActor): Promise<void> {
    if (actor.kind === 'SERVICE') return;
    if (
      !(await manager.getRepository(UserRoleAssignmentEntity).existsBy({
        userId: actor.userId,
        role: UserRole.ADMIN,
        siteId: IsNull(),
      }))
    )
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'FORBIDDEN',
        message: 'Forbidden',
      });
  }

  private async assertWorkerAssignment(
    manager: EntityManager,
    siteId: string,
    contractorId: string,
    userId: string,
    at: Date,
  ) {
    const contractor = await manager
      .getRepository(ContractorEntity)
      .findOneBy({ id: contractorId, isActive: true });
    const user = await manager.getRepository(UserEntity).findOneBy({ id: userId, isActive: true });
    const assignment = await manager
      .getRepository(UserRoleAssignmentEntity)
      .findOneBy({ userId, role: UserRole.WORKER, siteId });
    if (!contractor || !user || !assignment) missing();
    const participations = await manager.getRepository(ContractorSiteParticipationEntity).findBy({
      contractorId,
      siteId,
      isActive: true,
    });
    const now = at.getTime();
    if (
      !participations.some(
        ({ validFrom, validUntil }) =>
          validFrom.getTime() <= now && (validUntil === null || validUntil.getTime() > now),
      )
    )
      missing();
  }

  /** Account-first enrollment used by Face/Identity flows; remains idempotent. */
  async forAccount(
    siteIdValue: string,
    input: LinkWorkerAccountCommand,
    actor: ZoneAuthorityActor = { kind: 'SERVICE', subject: 'WORKFORCE_CONFIGURATION' },
  ) {
    const siteId = uuid(siteIdValue);
    const value = command(LinkWorkerAccountCommand, input);
    return writeWorkforceAuthority(
      this.dataSource,
      actor,
      'WORKER_ACCOUNT_PREPARE',
      { siteId, ...value },
      async (manager, at) => {
        const user = await manager
          .getRepository(UserEntity)
          .createQueryBuilder('user')
          .setLock('pessimistic_write')
          .where('user.id = :id AND user.is_active = TRUE', { id: value.userId })
          .getOne();
        const assignment = await manager.getRepository(UserRoleAssignmentEntity).findOneBy([
          { userId: value.userId, siteId },
          { userId: value.userId, siteId: IsNull(), role: UserRole.ADMIN },
        ]);
        if (!user || !assignment) conflict('An active account assigned to this site is required');
        if (!(await manager.getRepository(SiteEntity).existsBy({ id: siteId }))) missing();
        const existing = await manager
          .getRepository(WorkerEntity)
          .findOneBy({ siteId, userId: user.id });
        if (existing) {
          if (!existing.isActive) conflict('The linked worker is inactive');
          return { result: existing, facts: [workerMembershipFact(existing, at)] };
        }
        const worker = await manager.getRepository(WorkerEntity).save({
          id: randomUUID(),
          siteId,
          userId: user.id,
          contractorId: null,
          externalId: `ACC-${user.id}`,
          displayName: user.displayName,
          isActive: true,
        });
        return { result: worker, facts: [workerMembershipFact(worker, at)] };
      },
    );
  }

  async linkAccount(
    siteIdValue: string,
    workerIdValue: string,
    input: LinkWorkerAccountCommand,
    actor: ZoneAuthorityActor = { kind: 'SERVICE', subject: 'WORKFORCE_CONFIGURATION' },
  ) {
    const siteId = uuid(siteIdValue);
    const workerId = uuid(workerIdValue);
    const value = command(LinkWorkerAccountCommand, input);
    try {
      return await writeWorkforceAuthority(
        this.dataSource,
        actor,
        'WORKER_ACCOUNT_LINK',
        { siteId, workerId, ...value },
        async (manager, at) => {
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
          const saved = await manager.getRepository(WorkerEntity).save(worker);
          return { result: saved, facts: [workerMembershipFact(saved, at)] };
        },
      );
    } catch (error) {
      knownUnique(error, ['uq_worker_site_user']);
    }
  }

  async create(
    siteId: string,
    input: CreateWorkerDto,
    actor: ZoneAuthorityActor = { kind: 'SERVICE', subject: 'WORKFORCE_CONFIGURATION' },
  ): Promise<WorkerEntity> {
    const scopedSiteId = uuid(siteId);
    const value = command(CreateWorkerDto, input);
    if (!!value.contractorId !== !!value.userId)
      throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
        code: 'VALIDATION_FAILED',
        message: 'Worker contractor and user assignments must be set together',
      });
    try {
      return await writeWorkforceAuthority(
        this.dataSource,
        actor,
        'WORKER_CREATE',
        {
          siteId: scopedSiteId,
          externalId: value.externalId,
          displayName: value.displayName,
          contractorId: value.contractorId ?? null,
          userId: value.userId ?? null,
        },
        async (manager, at) => {
          await this.assertAdminActor(manager, actor);
          if (!(await manager.getRepository(SiteEntity).existsBy({ id: scopedSiteId }))) missing();
          if (value.contractorId && value.userId)
            await this.assertWorkerAssignment(
              manager,
              scopedSiteId,
              value.contractorId,
              value.userId,
              at,
            );
          const worker = await manager.getRepository(WorkerEntity).save({
            id: randomUUID(),
            siteId: scopedSiteId,
            contractorId: value.contractorId ?? null,
            userId: value.userId ?? null,
            externalId: value.externalId,
            displayName: value.displayName,
            isActive: true,
          });
          return { result: worker, facts: [workerMembershipFact(worker, at)] };
        },
      );
    } catch (error) {
      knownUnique(error, ['uq_worker_site_external_id', 'uq_worker_site_user']);
    }
  }

  async createContractor(
    siteId: string,
    input: CreateContractorDto,
    actor: ZoneAuthorityActor = { kind: 'SERVICE', subject: 'WORKFORCE_CONFIGURATION' },
  ): Promise<ContractorEntity> {
    const scopedSiteId = uuid(siteId);
    const value = command(CreateContractorDto, input);
    try {
      return await writeWorkforceAuthority(
        this.dataSource,
        actor,
        'SITE_CONTRACTOR_CREATE',
        { siteId: scopedSiteId, ...value },
        async (manager, at) => {
          await this.assertAdminActor(manager, actor);
          const site = await manager.getRepository(SiteEntity).findOneBy({ id: scopedSiteId });
          if (!site) missing();
          let contractor = await manager
            .getRepository(ContractorEntity)
            .findOneBy({ code: value.code });
          if (contractor && (contractor.name !== value.name || !contractor.isActive))
            conflict('Contractor code belongs to another name or an inactive contractor');
          contractor ??= await manager.getRepository(ContractorEntity).save({
            id: randomUUID(),
            code: value.code,
            name: value.name,
            isActive: true,
          });
          const participations = await manager
            .getRepository(ContractorSiteParticipationEntity)
            .findBy({
              contractorId: contractor.id,
              siteId: scopedSiteId,
              isActive: true,
            });
          let participation = participations.find(
            ({ validFrom, validUntil }) =>
              validFrom.getTime() <= at.getTime() &&
              (validUntil === null || validUntil.getTime() > at.getTime()),
          );
          if (!participation) {
            participation = await manager.getRepository(ContractorSiteParticipationEntity).save({
              id: randomUUID(),
              contractorId: contractor.id,
              siteId: scopedSiteId,
              validFrom: at,
              validUntil: null,
              isActive: true,
            });
          }
          return {
            result: contractor,
            facts: [contractorFact(contractor, at), participationFact(participation, at)],
          };
        },
      );
    } catch (error) {
      knownUnique(error, ['uq_contractor_code']);
    }
  }

  async assignRepresentative(
    siteId: string,
    contractorId: string,
    input: AssignContractorRepresentativeDto,
  ): Promise<ContractorRepresentativeAssignmentEntity> {
    const scopedSiteId = uuid(siteId);
    const scopedContractorId = uuid(contractorId);
    const value = command(AssignContractorRepresentativeDto, input);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const [contractor, user, assignment, participations] = await Promise.all([
          manager
            .getRepository(ContractorEntity)
            .findOneBy({ id: scopedContractorId, isActive: true }),
          manager.getRepository(UserEntity).findOneBy({ id: value.userId, isActive: true }),
          manager.getRepository(UserRoleAssignmentEntity).findOneBy({
            userId: value.userId,
            role: UserRole.CONTRACTOR_REPRESENTATIVE,
            siteId: scopedSiteId,
          }),
          manager.getRepository(ContractorSiteParticipationEntity).findBy({
            contractorId: scopedContractorId,
            siteId: scopedSiteId,
            isActive: true,
          }),
        ]);
        const now = Date.now();
        if (
          !contractor ||
          !user ||
          !assignment ||
          !participations.some(
            ({ validFrom, validUntil }) =>
              validFrom.getTime() <= now && (validUntil === null || validUntil.getTime() > now),
          )
        )
          missing();
        const grants = manager.getRepository(ContractorRepresentativeGrantEntity);
        if (!(await grants.existsBy({ userId: value.userId, contractorId: scopedContractorId })))
          await grants.save({
            id: randomUUID(),
            userId: value.userId,
            contractorId: scopedContractorId,
          });
        const assignments = manager.getRepository(ContractorRepresentativeAssignmentEntity);
        const existing = await assignments.findOneBy({
          siteId: scopedSiteId,
          contractorId: scopedContractorId,
          userId: value.userId,
        });
        return (
          existing ??
          assignments.save({
            id: randomUUID(),
            siteId: scopedSiteId,
            contractorId: scopedContractorId,
            userId: value.userId,
          })
        );
      });
    } catch (error) {
      knownUnique(error, [
        'uq_contractor_representative_assignment',
        'uq_contractor_representative_grant',
      ]);
    }
  }

  async listRepresentativeAssignments(
    siteId: string,
    offset = 0,
    limit = 50,
  ): Promise<{ items: ContractorRepresentativeAssignmentEntity[]; total: number }> {
    const pagination = page(offset, limit);
    const [items, total] = await this.dataSource
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .findAndCount({
        where: { siteId: uuid(siteId) },
        order: { createdAt: 'ASC', id: 'ASC' },
        skip: pagination.offset,
        take: pagination.limit,
      });
    return { items, total };
  }

  async listContractors(
    user: AuthenticatedUser,
    siteId: string,
    offset = 0,
    limit = 50,
  ): Promise<{ items: ContractorEntity[]; total: number }> {
    const scopedSiteId = uuid(siteId);
    // Authorization check
    let contractorIdScope: string | undefined;
    if (
      !user.roleAssignments.some(
        (r) =>
          r.role === UserRole.ADMIN ||
          (r.siteId === scopedSiteId && r.role === UserRole.SITE_MANAGER),
      )
    ) {
      // Must be CONTRACTOR_REPRESENTATIVE or WORKER
      const rep = user.roleAssignments.some(
        (r) => r.role === UserRole.CONTRACTOR_REPRESENTATIVE && r.siteId === scopedSiteId,
      )
        ? await this.dataSource
            .getRepository(ContractorRepresentativeAssignmentEntity)
            .findOneBy({ siteId: scopedSiteId, userId: user.id })
        : null;
      if (rep) {
        if (
          !(await hasActiveContractorParticipation(
            this.dataSource.manager,
            rep.contractorId,
            scopedSiteId,
          ))
        )
          throw new PublicHttpException(HttpStatus.FORBIDDEN, {
            code: 'FORBIDDEN',
            message: 'Forbidden',
          });
        contractorIdScope = rep.contractorId;
      } else {
        const worker = user.roleAssignments.some(
          (r) => r.role === UserRole.WORKER && r.siteId === scopedSiteId,
        )
          ? await this.dataSource
              .getRepository(WorkerEntity)
              .findOneBy({ siteId: scopedSiteId, userId: user.id })
          : null;
        if (worker && worker.contractorId) {
          contractorIdScope = worker.contractorId;
        } else {
          throw new PublicHttpException(HttpStatus.FORBIDDEN, {
            code: 'FORBIDDEN',
            message: 'Forbidden',
          });
        }
      }
    }

    const pagination = page(offset, limit);
    const now = new Date();
    const query = this.dataSource
      .getRepository(ContractorEntity)
      .createQueryBuilder('contractor')
      .innerJoin(
        ContractorSiteParticipationEntity,
        'participation',
        'participation.contractor_id = contractor.id AND participation.site_id = :siteId AND participation.is_active = TRUE AND participation.valid_from <= :now AND (participation.valid_until IS NULL OR participation.valid_until > :now)',
        { siteId: scopedSiteId, now },
      )
      .distinct(true)
      .orderBy('contractor.name', 'ASC')
      .skip(pagination.offset)
      .take(pagination.limit);
    if (contractorIdScope)
      query.andWhere('contractor.id = :contractorIdScope', { contractorIdScope });
    const [items, total] = await query.getManyAndCount();
    return { items, total };
  }

  async list(
    user: AuthenticatedUser,
    siteId: string,
    offset = 0,
    limit = 20,
  ): Promise<{ items: WorkerEntity[]; total: number }> {
    const scopedSiteId = uuid(siteId);

    // Authorization check
    let contractorIdScope: string | undefined;
    let workerIdScope: string | undefined;
    if (
      !user.roleAssignments.some(
        (r) =>
          r.role === UserRole.ADMIN ||
          (r.siteId === scopedSiteId && r.role === UserRole.SITE_MANAGER),
      )
    ) {
      const rep = user.roleAssignments.some(
        (r) => r.role === UserRole.CONTRACTOR_REPRESENTATIVE && r.siteId === scopedSiteId,
      )
        ? await this.dataSource
            .getRepository(ContractorRepresentativeAssignmentEntity)
            .findOneBy({ siteId: scopedSiteId, userId: user.id })
        : null;
      if (rep) {
        if (
          !(await hasActiveContractorParticipation(
            this.dataSource.manager,
            rep.contractorId,
            scopedSiteId,
          ))
        )
          throw new PublicHttpException(HttpStatus.FORBIDDEN, {
            code: 'FORBIDDEN',
            message: 'Forbidden',
          });
        contractorIdScope = rep.contractorId;
      } else {
        const worker = user.roleAssignments.some(
          (r) => r.role === UserRole.WORKER && r.siteId === scopedSiteId,
        )
          ? await this.dataSource
              .getRepository(WorkerEntity)
              .findOneBy({ siteId: scopedSiteId, userId: user.id })
          : null;
        if (worker) {
          workerIdScope = worker.id;
        } else {
          throw new PublicHttpException(HttpStatus.FORBIDDEN, {
            code: 'FORBIDDEN',
            message: 'Forbidden',
          });
        }
      }
    }

    const pagination = page(offset, limit);
    const where: FindOptionsWhere<WorkerEntity> = { siteId: scopedSiteId };
    if (contractorIdScope) where.contractorId = contractorIdScope;
    if (workerIdScope) where.id = workerIdScope;

    const [items, total] = await this.dataSource.getRepository(WorkerEntity).findAndCount({
      where,
      order: { externalId: 'ASC', id: 'ASC' },
      skip: pagination.offset,
      take: pagination.limit,
    });
    return { items, total };
  }

  async listCoworkers(
    user: AuthenticatedUser,
    siteId: string,
    offset = 0,
    limit = 50,
  ): Promise<{ items: Partial<WorkerEntity>[]; total: number }> {
    const scopedSiteId = uuid(siteId);

    let contractorIdScope: string | undefined;
    if (
      !user.roleAssignments.some(
        (r) =>
          r.role === UserRole.ADMIN ||
          (r.siteId === scopedSiteId && r.role === UserRole.SITE_MANAGER),
      )
    ) {
      const rep = user.roleAssignments.some(
        (r) => r.role === UserRole.CONTRACTOR_REPRESENTATIVE && r.siteId === scopedSiteId,
      )
        ? await this.dataSource
            .getRepository(ContractorRepresentativeAssignmentEntity)
            .findOneBy({ siteId: scopedSiteId, userId: user.id })
        : null;
      if (rep) {
        if (
          !(await hasActiveContractorParticipation(
            this.dataSource.manager,
            rep.contractorId,
            scopedSiteId,
          ))
        )
          throw new PublicHttpException(HttpStatus.FORBIDDEN, {
            code: 'FORBIDDEN',
            message: 'Forbidden',
          });
        contractorIdScope = rep.contractorId;
      } else {
        const worker = user.roleAssignments.some(
          (r) => r.role === UserRole.WORKER && r.siteId === scopedSiteId,
        )
          ? await this.dataSource
              .getRepository(WorkerEntity)
              .findOneBy({ siteId: scopedSiteId, userId: user.id })
          : null;
        if (worker && worker.contractorId) {
          contractorIdScope = worker.contractorId;
        } else {
          throw new PublicHttpException(HttpStatus.FORBIDDEN, {
            code: 'FORBIDDEN',
            message: 'Forbidden',
          });
        }
      }
    }

    const pagination = page(offset, limit);
    const where: FindOptionsWhere<WorkerEntity> = { siteId: scopedSiteId, isActive: true };
    if (contractorIdScope) where.contractorId = contractorIdScope;

    const [items, total] = await this.dataSource.getRepository(WorkerEntity).findAndCount({
      where,
      select: { id: true, displayName: true, externalId: true },
      order: { displayName: 'ASC' },
      skip: pagination.offset,
      take: pagination.limit,
    });
    return { items, total };
  }

  /** Uses the caller's transaction so RESOLVE and a concurrent Worker disable serialize. */
  async findForReview(
    manager: EntityManager,
    siteId: string,
    workerId: string,
    lockForResolution: boolean,
  ): Promise<WorkerReviewReference | null> {
    const worker = await manager.getRepository(WorkerEntity).findOne({
      where: { id: uuid(workerId), siteId: uuid(siteId) },
      select: workerReviewFields,
      ...(lockForResolution ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    return worker ? workerReviewReference(worker) : null;
  }

  async listForReview(
    siteId: string,
    offset = 0,
    limit = 20,
  ): Promise<{ items: WorkerReviewReference[]; total: number }> {
    const pagination = page(offset, limit);
    const [workers, total] = await this.dataSource.getRepository(WorkerEntity).findAndCount({
      where: { siteId: uuid(siteId) },
      select: workerReviewFields,
      order: { externalId: 'ASC', id: 'ASC' },
      skip: pagination.offset,
      take: pagination.limit,
    });
    return { items: workers.map(workerReviewReference), total };
  }
}
