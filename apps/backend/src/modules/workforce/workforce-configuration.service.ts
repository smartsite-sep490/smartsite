import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { DataSource, In, IsNull, type EntityManager, type FindOptionsWhere } from 'typeorm';
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
import { AuthenticatedUser } from '../auth/auth.service.js';
import {
  AssignContractorRepresentativeDto,
  CreateContractorDto,
  CreateWorkerDto,
} from './dto/workforce.dto.js';
import { hasActiveContractorParticipation } from './contractor-participation.js';

/** Safe read projection; account, face, and contractor data stay in their owning workflows. */
export type WorkerReviewReference = Pick<
  WorkerEntity,
  'id' | 'siteId' | 'externalId' | 'displayName' | 'isActive'
>;
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

  /** Labels for an authorized Incident; historical subjects need not remain active. */
  async incidentLabels(
    manager: EntityManager,
    siteId: string,
    contractorId: string | null,
    workerIds: string[],
  ) {
    const contractor = contractorId
      ? await manager.getRepository(ContractorEntity).findOneBy({ id: contractorId })
      : null;
    const workers = workerIds.length
      ? await manager.getRepository(WorkerEntity).findBy({ siteId, id: In(workerIds) })
      : [];
    return {
      contractorName: contractor?.name ?? null,
      workers: workers.map(({ id, displayName, externalId }) => ({ id, displayName, externalId })),
    };
  }
  /** Safety owns decisions; Workforce supplies current Site/Contractor membership. */
  async requireIncidentContractor(manager: EntityManager, siteId: string, contractorId: string) {
    await manager
      .getRepository(ContractorEntity)
      .findOne({ where: { id: uuid(contractorId) }, lock: { mode: 'pessimistic_read' } });
    await manager
      .getRepository(ContractorSiteParticipationEntity)
      .find({ where: { contractorId, siteId: uuid(siteId) }, lock: { mode: 'pessimistic_read' } });
    if (!(await hasActiveContractorParticipation(manager, uuid(contractorId), uuid(siteId))))
      conflict('An active contractor participating in this Site is required');
  }
  async requireIncidentWorkers(
    manager: EntityManager,
    siteId: string,
    contractorId: string,
    workerIds: string[],
  ) {
    await this.requireIncidentContractor(manager, siteId, contractorId);
    for (const id of [...workerIds].sort()) {
      const worker = await manager.getRepository(WorkerEntity).findOne({
        where: { id: uuid(id), siteId, contractorId, isActive: true },
        lock: { mode: 'pessimistic_read' },
      });
      if (!worker)
        conflict('Every confirmed Worker must belong to the Incident contractor and Site');
    }
  }
  async incidentRepresentativeAllowed(
    manager: EntityManager,
    siteId: string,
    contractorId: string,
    userId: string,
  ) {
    const contractor = await manager
      .getRepository(ContractorEntity)
      .findOne({ where: { id: contractorId, isActive: true }, lock: { mode: 'pessimistic_read' } });
    if (!contractor) return false;
    await manager
      .getRepository(ContractorSiteParticipationEntity)
      .find({ where: { contractorId, siteId }, lock: { mode: 'pessimistic_read' } });
    if (!(await hasActiveContractorParticipation(manager, contractorId, siteId))) return false;
    return (
      !!(await manager
        .getRepository(UserEntity)
        .findOne({ where: { id: userId, isActive: true }, lock: { mode: 'pessimistic_read' } })) &&
      !!(await manager.getRepository(UserRoleAssignmentEntity).findOne({
        where: { userId, siteId, role: UserRole.CONTRACTOR_REPRESENTATIVE },
        lock: { mode: 'pessimistic_read' },
      })) &&
      !!(await manager
        .getRepository(ContractorRepresentativeGrantEntity)
        .findOne({ where: { userId, contractorId }, lock: { mode: 'pessimistic_read' } }))
    );
  }
  async requireSingleIncidentContractor(
    manager: EntityManager,
    siteId: string,
    workerIds: string[],
  ) {
    const contractors = new Set<string>();
    for (const id of workerIds) {
      const worker = await manager
        .getRepository(WorkerEntity)
        .findOneBy({ id, siteId, isActive: true });
      if (!worker?.contractorId) conflict('Verified subject has unavailable contractor membership');
      contractors.add(worker!.contractorId!);
    }
    if (contractors.size > 1)
      conflict('Confirmed Workers from different contractors need separate Incidents');
  }
  async incidentRepresentativeContractors(manager: EntityManager, siteId: string, userId: string) {
    const grants = await manager
      .getRepository(ContractorRepresentativeGrantEntity)
      .findBy({ userId });
    const ids: string[] = [];
    for (const grant of grants)
      if (await this.incidentRepresentativeAllowed(manager, siteId, grant.contractorId, userId))
        ids.push(grant.contractorId);
    return ids;
  }
  async incidentContractors(manager: EntityManager, siteId: string, offset: number, limit: number) {
    const paging = page(offset, limit);
    const query = manager
      .getRepository(ContractorEntity)
      .createQueryBuilder('c')
      .where('c.isActive = TRUE')
      .andWhere(
        `EXISTS(SELECT 1 FROM contractor_site_participation p WHERE p.contractor_id=c.id AND p.site_id=:siteId AND p.is_active=TRUE AND p.valid_from<=CURRENT_TIMESTAMP AND (p.valid_until IS NULL OR p.valid_until>CURRENT_TIMESTAMP))`,
        { siteId },
      );
    const [rows, total] = await query
      .orderBy('c.name', 'ASC')
      .addOrderBy('c.id', 'ASC')
      .skip(paging.offset)
      .take(paging.limit)
      .getManyAndCount();
    return { items: rows.map(({ id, name }) => ({ id, name })), total };
  }
  async incidentWorkers(
    manager: EntityManager,
    siteId: string,
    contractorId: string,
    offset: number,
    limit: number,
  ) {
    await this.requireIncidentContractor(manager, siteId, contractorId);
    const paging = page(offset, limit);
    const [rows, total] = await manager.getRepository(WorkerEntity).findAndCount({
      where: { siteId, contractorId, isActive: true },
      order: { displayName: 'ASC', id: 'ASC' },
      skip: paging.offset,
      take: paging.limit,
    });
    return {
      items: rows.map(({ id, displayName, externalId }) => ({ id, displayName, externalId })),
      total,
    };
  }
  async incidentRepresentatives(
    manager: EntityManager,
    siteId: string,
    contractorId: string | undefined,
    offset: number,
    limit: number,
  ) {
    if (contractorId) await this.requireIncidentContractor(manager, siteId, contractorId);
    const paging = page(offset, limit);
    const [rows, total] = await manager
      .getRepository(UserEntity)
      .createQueryBuilder('u')
      .where('u.isActive=TRUE')
      .andWhere(
        `EXISTS(SELECT 1 FROM user_role_assignment r WHERE r.user_id=u.id AND r.site_id=:siteId AND r.role=:role)`,
        { siteId, role: UserRole.CONTRACTOR_REPRESENTATIVE },
      )
      .andWhere(
        `EXISTS(SELECT 1 FROM contractor_representative_grant g JOIN contractor c ON c.id=g.contractor_id AND c.is_active=TRUE JOIN contractor_site_participation p ON p.contractor_id=c.id AND p.site_id=:siteId AND p.is_active=TRUE AND p.valid_from<=CURRENT_TIMESTAMP AND (p.valid_until IS NULL OR p.valid_until>CURRENT_TIMESTAMP) WHERE g.user_id=u.id ${contractorId ? 'AND g.contractor_id=:contractorId' : ''})`,
        { siteId, ...(contractorId ? { contractorId } : {}) },
      )
      .orderBy('u.displayName', 'ASC')
      .addOrderBy('u.id', 'ASC')
      .skip(paging.offset)
      .take(paging.limit)
      .getManyAndCount();
    return { items: rows.map(({ id, displayName }) => ({ id, displayName })), total };
  }
  private async assertWorkerAssignment(siteId: string, contractorId: string, userId: string) {
    const [contractor, user, assignment] = await Promise.all([
      this.dataSource
        .getRepository(ContractorEntity)
        .findOneBy({ id: contractorId, isActive: true }),
      this.dataSource.getRepository(UserEntity).findOneBy({ id: userId, isActive: true }),
      this.dataSource
        .getRepository(UserRoleAssignmentEntity)
        .findOneBy({ userId, role: UserRole.WORKER, siteId }),
    ]);
    if (!contractor || !user || !assignment) missing();
    const participations = await this.dataSource
      .getRepository(ContractorSiteParticipationEntity)
      .findBy({
        contractorId,
        siteId,
        isActive: true,
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

  /** Account-first enrollment used by Face/Identity flows; remains idempotent. */
  async forAccount(siteIdValue: string, input: LinkWorkerAccountCommand) {
    const siteId = uuid(siteIdValue);
    const value = command(LinkWorkerAccountCommand, input);
    return this.dataSource.transaction(async (manager) => {
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
        return existing;
      }
      return manager.getRepository(WorkerEntity).save({
        id: randomUUID(),
        siteId,
        userId: user.id,
        externalId: `ACC-${user.id}`,
        displayName: user.displayName,
        isActive: true,
      });
    });
  }

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

  async create(siteId: string, input: CreateWorkerDto): Promise<WorkerEntity> {
    const scopedSiteId = uuid(siteId);
    const value = command(CreateWorkerDto, input);
    const site = await this.dataSource.getRepository(SiteEntity).findOneBy({ id: scopedSiteId });
    if (!site) missing();
    if (!!value.contractorId !== !!value.userId)
      throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
        code: 'VALIDATION_FAILED',
        message: 'Worker contractor and user assignments must be set together',
      });
    if (value.contractorId && value.userId)
      await this.assertWorkerAssignment(scopedSiteId, value.contractorId, value.userId);
    try {
      return await this.dataSource.getRepository(WorkerEntity).save({
        id: randomUUID(),
        siteId: scopedSiteId,
        contractorId: value.contractorId ?? null,
        userId: value.userId ?? null,
        externalId: value.externalId,
        displayName: value.displayName,
        isActive: true,
      });
    } catch (error) {
      knownUnique(error, ['uq_worker_site_external_id', 'uq_worker_site_user']);
    }
  }

  async createContractor(siteId: string, input: CreateContractorDto): Promise<ContractorEntity> {
    const scopedSiteId = uuid(siteId);
    const value = command(CreateContractorDto, input);
    try {
      return await this.dataSource.transaction(async (manager) => {
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
        const now = new Date();
        if (
          !participations.some(
            ({ validFrom, validUntil }) =>
              validFrom.getTime() <= now.getTime() &&
              (validUntil === null || validUntil.getTime() > now.getTime()),
          )
        ) {
          await manager.getRepository(ContractorSiteParticipationEntity).save({
            id: randomUUID(),
            contractorId: contractor.id,
            siteId: scopedSiteId,
            validFrom: now,
            validUntil: null,
            isActive: true,
          });
        }
        return contractor;
      });
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
    let contractorIdsScope: string[] | undefined;
    let workerIdScope: string | undefined;
    if (
      !user.roleAssignments.some(
        (r) =>
          (r.role === UserRole.ADMIN && r.siteId === null) ||
          (r.siteId === scopedSiteId &&
            [UserRole.SITE_MANAGER, UserRole.SAFETY_OFFICER, UserRole.SECURITY_OFFICER].includes(
              r.role,
            )),
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
        const grants = user.roleAssignments.some(
          (r) => r.role === UserRole.CONTRACTOR_REPRESENTATIVE && r.siteId === scopedSiteId,
        )
          ? await this.dataSource
              .getRepository(ContractorRepresentativeGrantEntity)
              .findBy({ userId: user.id })
          : [];
        const participations = grants.length
          ? await this.dataSource.getRepository(ContractorSiteParticipationEntity).findBy({
              siteId: scopedSiteId,
              contractorId: In(grants.map((g) => g.contractorId)),
              isActive: true,
            })
          : [];
        contractorIdsScope = participations
          .filter((p) => p.validFrom <= new Date() && (!p.validUntil || p.validUntil > new Date()))
          .map((p) => p.contractorId);
        if (!contractorIdsScope.length) {
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
    }

    const pagination = page(offset, limit);
    const where: FindOptionsWhere<WorkerEntity> = { siteId: scopedSiteId };
    if (contractorIdScope) where.contractorId = contractorIdScope;
    if (contractorIdsScope?.length) where.contractorId = In(contractorIdsScope);
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
