import { randomUUID } from 'node:crypto';
import {
  executeMainConfigurationCommand,
  type MainConfigurationCommandContext,
} from '../../../common/configuration/main-configuration-authority.js';
import { siteManagerCommandAuthorization } from '../../auth/site-manager.guard.js';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsString,
  IsUUID,
  IsOptional,
  IsInt,
  Min,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { DataSource, In, type EntityManager } from 'typeorm';
import {
  command,
  conflict,
  knownUnique,
  missing,
  uuid,
} from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { ContractorEntity } from '../../../database/entities/contractor.entity.js';
import { ContractorRepresentativeGrantEntity } from '../../../database/entities/contractor-representative-grant.entity.js';
import { ContractorSiteParticipationEntity } from '../../../database/entities/contractor-site-participation.entity.js';
import { SiteEntity } from '../../../database/entities/site.entity.js';
import { UserRoleAssignmentEntity } from '../../../database/entities/user-role-assignment.entity.js';
import { UserEntity, UserRole } from '../../../database/entities/user.entity.js';
import {
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
} from '../../../database/entities/worker-site-zone-assignment.entity.js';
import { WorkerEntity } from '../../../database/entities/worker.entity.js';
import { ZoneEntity } from '../../../database/entities/zone.entity.js';
import { auditAccess } from '../shared/access-audit.js';

export interface WorkforceActor {
  id: string;
  mustChangePassword: boolean;
  roleAssignments: Array<{ role: UserRole; siteId: string | null }>;
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateContractorCommand {
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,63}$/)
  code!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  name!: string;
}

export class CreateContractorParticipationCommand {
  @IsUUID()
  siteId!: string;

  @IsDateString({ strict: true })
  validFrom!: string;

  @ValidateIf((_object, value) => value !== null)
  @IsDateString({ strict: true })
  validUntil!: string | null;
}

export class GrantContractorRepresentativeCommand {
  @IsUUID()
  userId!: string;
}

export class CreateContractorWorkerCommand {
  @IsUUID()
  siteId!: string;

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

export class CreateWorkerSiteZoneAssignmentCommand {
  @IsUUID()
  siteId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(64)
  @IsUUID('4', { each: true })
  zoneIds!: string[];

  @IsDateString({ strict: true })
  validFrom!: string;

  @ValidateIf((_object, value) => value !== null)
  @IsDateString({ strict: true })
  validUntil!: string | null;
}

export class SiteManagerDecisionCommand {
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
  @IsBoolean()
  approve!: boolean;
}

export class RevokeWorkerAssignmentCommand {
  @IsInt() @Min(1) expectedVersion!: number;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(1000) reviewNote!: string;
}

function timeRange(
  validFrom: string,
  validUntil: string | null,
): { from: Date; until: Date | null } {
  const from = new Date(validFrom);
  const until = validUntil === null ? null : new Date(validUntil);
  if (until !== null && until.getTime() <= from.getTime())
    throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
      code: 'VALIDATION_FAILED',
      message: 'validUntil must be after validFrom',
    });
  return { from, until };
}

@Injectable()
export class ContractorOperationsService {
  constructor(private readonly dataSource: DataSource) {}

  private forbidden(): never {
    throw new PublicHttpException(HttpStatus.FORBIDDEN, {
      code: 'FORBIDDEN',
      message: 'Forbidden',
    });
  }

  private assertPasswordChanged(actor: WorkforceActor): void {
    if (actor.mustChangePassword)
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Password change required',
      });
  }

  private isAdmin(actor: WorkforceActor): boolean {
    return actor.roleAssignments.some(
      ({ role, siteId }) => role === UserRole.ADMIN && siteId === null,
    );
  }

  private assertAdmin(actor: WorkforceActor): void {
    this.assertPasswordChanged(actor);
    if (!this.isAdmin(actor)) this.forbidden();
  }

  private hasSiteRole(actor: WorkforceActor, siteId: string, role: UserRole): boolean {
    return actor.roleAssignments.some(
      (assignment) => assignment.role === role && assignment.siteId === siteId,
    );
  }

  private async requireContractorRepresentative(
    manager: EntityManager,
    actor: WorkforceActor,
    contractorId: string,
    siteId: string,
    lock = false,
  ): Promise<void> {
    this.assertPasswordChanged(actor);
    if (!this.hasSiteRole(actor, siteId, UserRole.CONTRACTOR_REPRESENTATIVE)) this.forbidden();
    const grants = manager.getRepository(ContractorRepresentativeGrantEntity);
    const where = { userId: actor.id, contractorId };
    const grant = lock
      ? await grants.findOne({ where, lock: { mode: 'pessimistic_read' } })
      : await grants.findOneBy(where);
    if (!grant) this.forbidden();
  }

  private async requireSiteRole(
    actor: WorkforceActor,
    siteId: string,
    role: UserRole.SAFETY_OFFICER | UserRole.SITE_MANAGER,
  ): Promise<void> {
    this.assertPasswordChanged(actor);
    if (!this.hasSiteRole(actor, siteId, role)) this.forbidden();
  }

  private async requireActiveParticipation(
    manager: EntityManager,
    contractorId: string,
    siteId: string,
    at: Date,
    lock = false,
  ): Promise<void> {
    const contractors = manager.getRepository(ContractorEntity);
    const contractor = lock
      ? await contractors.findOne({
          where: { id: contractorId },
          lock: { mode: 'pessimistic_read' },
        })
      : await contractors.findOneBy({ id: contractorId });
    if (!contractor) missing();
    if (!contractor.isActive) this.forbidden();
    const participations = manager.getRepository(ContractorSiteParticipationEntity);
    const where = { contractorId, siteId, isActive: true };
    const participation = lock
      ? await participations.find({ where, lock: { mode: 'pessimistic_read' } })
      : await participations.findBy(where);
    if (
      !participation.some(
        ({ validFrom, validUntil }) =>
          validFrom.getTime() <= at.getTime() &&
          (validUntil === null || validUntil.getTime() > at.getTime()),
      )
    )
      this.forbidden();
  }

  async requireWorkerEnrollmentAccess(
    manager: EntityManager,
    actor: WorkforceActor,
    workerIdValue: string,
  ): Promise<WorkerEntity> {
    const worker = await manager.getRepository(WorkerEntity).findOneBy({ id: uuid(workerIdValue) });
    if (!worker) missing();
    if (!worker.isActive) this.forbidden();
    if (!worker.contractorId) {
      this.forbidden();
    }
    await this.requireContractorRepresentative(manager, actor, worker.contractorId, worker.siteId);
    await this.requireActiveParticipation(manager, worker.contractorId, worker.siteId, new Date());
    return worker;
  }

  async createContractor(actor: WorkforceActor, input: CreateContractorCommand) {
    this.assertAdmin(actor);
    const value = command(CreateContractorCommand, input);
    try {
      return await this.dataSource.getRepository(ContractorEntity).save({
        id: randomUUID(),
        code: value.code,
        name: value.name,
        isActive: true,
      });
    } catch (error) {
      knownUnique(error, ['uq_contractor_code']);
    }
  }

  async createParticipation(
    actor: WorkforceActor,
    contractorIdValue: string,
    input: CreateContractorParticipationCommand,
    context?: MainConfigurationCommandContext,
  ) {
    const contractorId = uuid(contractorIdValue);
    const value = command(CreateContractorParticipationCommand, input);
    const siteId = uuid(value.siteId);
    if (context && uuid(context.actorUserId).toLowerCase() !== uuid(actor.id).toLowerCase())
      this.forbidden();
    await this.requireSiteRole(actor, siteId, UserRole.SITE_MANAGER);
    const range = timeRange(value.validFrom, value.validUntil);
    return executeMainConfigurationCommand(
      this.dataSource,
      context,
      'MAIN_PARTICIPATION_CREATE',
      {
        contractorId,
        siteId,
        validFrom: range.from.toISOString(),
        validUntil: range.until?.toISOString() ?? null,
      },
      async (manager) => {
        const contractor = await manager
          .getRepository(ContractorEntity)
          .findOne({ where: { id: contractorId }, lock: { mode: 'pessimistic_read' } });
        if (!contractor) missing();
        const site = await manager.getRepository(SiteEntity).findOneBy({ id: siteId });
        if (!site) missing();
        return manager.getRepository(ContractorSiteParticipationEntity).save({
          id: randomUUID(),
          contractorId,
          siteId,
          validFrom: range.from,
          validUntil: range.until,
          isActive: true,
        });
      },
      siteManagerCommandAuthorization(siteId, context?.actorUserId),
    );
  }

  async grantRepresentative(
    actor: WorkforceActor,
    contractorIdValue: string,
    input: GrantContractorRepresentativeCommand,
    context?: MainConfigurationCommandContext,
  ) {
    this.assertAdmin(actor);
    const contractorId = uuid(contractorIdValue);
    const value = command(GrantContractorRepresentativeCommand, input);
    const userId = uuid(value.userId);
    if (context && uuid(context.actorUserId).toLowerCase() !== uuid(actor.id).toLowerCase())
      this.forbidden();
    return executeMainConfigurationCommand(
      this.dataSource,
      context,
      'MAIN_REPRESENTATIVE_GRANT',
      { contractorId, userId },
      async (manager) => {
        const contractor = await manager.getRepository(ContractorEntity).findOne({
          where: { id: contractorId },
          lock: { mode: 'pessimistic_read' },
        });
        const user = await manager.getRepository(UserEntity).findOne({
          where: { id: userId },
          lock: { mode: 'pessimistic_read' },
        });
        if (!contractor || !user) missing();
        const roles = await manager
          .getRepository(UserRoleAssignmentEntity)
          .find({ where: { userId: user.id }, lock: { mode: 'pessimistic_read' } });
        if (
          !roles.some(({ role, siteId }) => role === UserRole.CONTRACTOR_REPRESENTATIVE && siteId)
        )
          throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
            code: 'VALIDATION_FAILED',
            message: 'User must have a Contractor Representative Site role',
          });
        const existing = await manager
          .getRepository(ContractorRepresentativeGrantEntity)
          .findOneBy({
            userId: user.id,
            contractorId,
          });
        if (existing) return existing;
        return manager.getRepository(ContractorRepresentativeGrantEntity).save({
          id: randomUUID(),
          userId: user.id,
          contractorId,
        });
      },
    );
  }

  async createWorker(
    actor: WorkforceActor,
    contractorIdValue: string,
    input: CreateContractorWorkerCommand,
    context?: MainConfigurationCommandContext,
  ) {
    const contractorId = uuid(contractorIdValue);
    const value = command(CreateContractorWorkerCommand, input);
    const siteId = uuid(value.siteId);
    if (context && uuid(context.actorUserId).toLowerCase() !== uuid(actor.id).toLowerCase())
      this.forbidden();
    return executeMainConfigurationCommand(
      this.dataSource,
      context,
      'CONTRACTOR_WORKER_CREATE',
      { contractorId, siteId, externalId: value.externalId },
      async (manager) => {
        await this.requireWorkerCreationAccess(manager, actor, contractorId, siteId, true);
        try {
          return await manager.getRepository(WorkerEntity).save({
            id: randomUUID(),
            contractorId,
            siteId,
            externalId: value.externalId,
            displayName: value.displayName,
            isActive: true,
          });
        } catch (error) {
          knownUnique(error, ['uq_worker_site_external_id']);
        }
      },
      context
        ? async (manager) => {
            const roles = await manager.query(
              "SELECT id FROM user_role_assignment WHERE user_id=$1 AND site_id=$2 AND role='CONTRACTOR_REPRESENTATIVE' FOR SHARE",
              [context.actorUserId, siteId],
            );
            if (!roles.length) this.forbidden();
          }
        : undefined,
    );
  }

  async requireWorkerCreationAccess(
    manager: EntityManager,
    actor: WorkforceActor,
    contractorId: string,
    siteId: string,
    lock = false,
  ): Promise<void> {
    await this.requireContractorRepresentative(manager, actor, contractorId, siteId, lock);
    await this.requireActiveParticipation(manager, contractorId, siteId, new Date(), lock);
  }

  async requestAssignment(
    actor: WorkforceActor,
    workerIdValue: string,
    input: CreateWorkerSiteZoneAssignmentCommand,
    context?: MainConfigurationCommandContext,
  ) {
    const workerId = uuid(workerIdValue);
    const value = command(CreateWorkerSiteZoneAssignmentCommand, input);
    const siteId = uuid(value.siteId);
    if (context && uuid(context.actorUserId).toLowerCase() !== uuid(actor.id).toLowerCase())
      this.forbidden();
    const zoneIds = [...new Set(value.zoneIds.map(uuid))];
    if (zoneIds.length !== value.zoneIds.length) conflict('Zone IDs must be unique');
    const range = timeRange(value.validFrom, value.validUntil);
    if (!range.until) conflict('Worker assignment requires an expiry');
    return executeMainConfigurationCommand(
      this.dataSource,
      context,
      'ASSIGNMENT_REQUEST',
      {
        workerId,
        siteId,
        zoneIds,
        validFrom: range.from.toISOString(),
        validUntil: range.until.toISOString(),
      },
      async (manager) => {
        const worker = await manager.getRepository(WorkerEntity).findOne({
          where: { id: workerId, siteId },
          lock: { mode: 'pessimistic_read' },
        });
        if (!worker?.contractorId || !worker.isActive) this.forbidden();
        await this.requireContractorRepresentative(
          manager,
          actor,
          worker.contractorId,
          siteId,
          true,
        );
        await this.requireActiveParticipation(
          manager,
          worker.contractorId,
          siteId,
          range.from,
          true,
        );
        const participations = await manager.getRepository(ContractorSiteParticipationEntity).find({
          where: { contractorId: worker.contractorId, siteId, isActive: true },
          lock: { mode: 'pessimistic_read' },
        });
        const participation = participations.find(
          (p) => p.validFrom <= range.from && (!p.validUntil || p.validUntil >= range.until!),
        );
        if (!participation) conflict('Assignment must fit the contractor participation interval');
        const zones = await manager.getRepository(ZoneEntity).find({
          where: { id: In(zoneIds), siteId },
          lock: { mode: 'pessimistic_read' },
        });
        if (zones.length !== zoneIds.length) this.forbidden();
        const assignment = await manager.getRepository(WorkerSiteZoneAssignmentEntity).save({
          id: randomUUID(),
          workerId,
          siteId,
          zoneIds,
          siteContractorId: participation.id,
          version: 1,
          status: WorkerSiteZoneAssignmentStatus.PENDING,
          validFrom: range.from,
          validUntil: range.until,
          requestedByUserId: actor.id,
          safetyReviewedByUserId: null,
          siteManagerDecidedByUserId: null,
        });
        await auditAccess(
          manager,
          actor.id,
          siteId,
          'WORKER_ASSIGNMENT_REQUESTED',
          'worker_assignment',
          assignment.id,
          null,
          { workerId, siteContractorId: participation.id },
        );
        return assignment;
      },
      context
        ? async (manager) => {
            const roles = await manager.query(
              "SELECT id FROM user_role_assignment WHERE user_id=$1 AND site_id=$2 AND role='CONTRACTOR_REPRESENTATIVE' FOR SHARE",
              [context.actorUserId, siteId],
            );
            if (!roles.length) this.forbidden();
          }
        : undefined,
    );
  }

  async safetyReview(
    actor: WorkforceActor,
    requestIdValue: string,
    context?: MainConfigurationCommandContext,
  ) {
    const requestId = uuid(requestIdValue);
    if (context && uuid(context.actorUserId).toLowerCase() !== uuid(actor.id).toLowerCase())
      this.forbidden();
    return executeMainConfigurationCommand(
      this.dataSource,
      context,
      'ASSIGNMENT_SAFETY_REVIEW',
      { requestId },
      async (manager) => {
        const request = await manager
          .getRepository(WorkerSiteZoneAssignmentEntity)
          .createQueryBuilder('assignment')
          .setLock('pessimistic_write')
          .where('assignment.id = :requestId', { requestId })
          .getOne();
        if (!request) missing();
        await this.requireSiteRole(actor, request.siteId, UserRole.SAFETY_OFFICER);
        if (request.requestedByUserId === actor.id) this.forbidden();
        if (request.status !== WorkerSiteZoneAssignmentStatus.PENDING)
          conflict('Assignment is not pending');
        request.status = WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED;
        request.safetyReviewedByUserId = actor.id;
        request.version += 1;
        await auditAccess(
          manager,
          actor.id,
          request.siteId,
          'WORKER_ASSIGNMENT_SAFETY_REVIEWED',
          'worker_assignment',
          request.id,
          null,
          { version: request.version },
        );
        return manager.getRepository(WorkerSiteZoneAssignmentEntity).save(request);
      },
      context
        ? async (manager) => {
            const scope = await manager
              .getRepository(WorkerSiteZoneAssignmentEntity)
              .findOneBy({ id: requestId });
            if (!scope) missing();
            const roles = await manager.query(
              "SELECT id FROM user_role_assignment WHERE user_id=$1 AND site_id=$2 AND role='SAFETY_OFFICER' FOR SHARE",
              [context.actorUserId, scope.siteId],
            );
            if (!roles.length) this.forbidden();
          }
        : undefined,
    );
  }

  async siteManagerDecision(
    actor: WorkforceActor,
    requestIdValue: string,
    input: SiteManagerDecisionCommand,
    context?: MainConfigurationCommandContext,
  ) {
    const requestId = uuid(requestIdValue);
    const value = command(SiteManagerDecisionCommand, input);
    if (context && uuid(context.actorUserId).toLowerCase() !== uuid(actor.id).toLowerCase())
      this.forbidden();
    return executeMainConfigurationCommand(
      this.dataSource,
      context,
      'ASSIGNMENT_DECISION',
      {
        requestId,
        approve: value.approve,
        expectedVersion: value.expectedVersion ?? null,
        reviewNote: value.reviewNote?.trim() || null,
      },
      async (manager) => {
        const request = await manager
          .getRepository(WorkerSiteZoneAssignmentEntity)
          .createQueryBuilder('assignment')
          .setLock('pessimistic_write')
          .where('assignment.id = :requestId', { requestId })
          .getOne();
        if (!request) missing();
        await this.requireSiteRole(actor, request.siteId, UserRole.SITE_MANAGER);
        if (request.requestedByUserId === actor.id) this.forbidden();
        if (
          ![
            WorkerSiteZoneAssignmentStatus.PENDING,
            WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED,
          ].includes(request.status)
        )
          conflict('Assignment has already been reviewed');
        if (value.expectedVersion !== undefined && request.version !== value.expectedVersion)
          conflict('Assignment changed. Reload before reviewing');
        if (value.approve) {
          const worker = await manager.getRepository(WorkerEntity).findOne({
            where: { id: request.workerId, siteId: request.siteId, isActive: true },
            lock: { mode: 'pessimistic_read' },
          });
          const participation = request.siteContractorId
            ? await manager.getRepository(ContractorSiteParticipationEntity).findOne({
                where: { id: request.siteContractorId, siteId: request.siteId, isActive: true },
                lock: { mode: 'pessimistic_read' },
              })
            : null;
          if (
            !worker ||
            worker.contractorId !== participation?.contractorId ||
            !request.validUntil ||
            request.validUntil <= new Date() ||
            !participation ||
            participation.validFrom > request.validFrom ||
            (participation.validUntil && participation.validUntil < request.validUntil)
          )
            conflict('Assignment participation or validity is unavailable');
        }
        request.status = value.approve
          ? WorkerSiteZoneAssignmentStatus.APPROVED
          : WorkerSiteZoneAssignmentStatus.REJECTED;
        request.siteManagerDecidedByUserId = actor.id;
        request.reviewedAt = new Date();
        request.reviewNote = value.reviewNote?.trim() || null;
        request.version += 1;
        await auditAccess(
          manager,
          actor.id,
          request.siteId,
          'WORKER_ASSIGNMENT_REVIEWED',
          'worker_assignment',
          request.id,
          request.reviewNote,
          { status: request.status, version: request.version },
        );
        return manager.getRepository(WorkerSiteZoneAssignmentEntity).save(request);
      },
      this.assignmentManagerAuthorization(requestId, context),
    );
  }

  async revokeAssignment(
    actor: WorkforceActor,
    requestIdValue: string,
    input: RevokeWorkerAssignmentCommand,
    context?: MainConfigurationCommandContext,
  ) {
    const requestId = uuid(requestIdValue);
    const value = command(RevokeWorkerAssignmentCommand, input);
    if (context && uuid(context.actorUserId).toLowerCase() !== uuid(actor.id).toLowerCase())
      this.forbidden();
    return executeMainConfigurationCommand(
      this.dataSource,
      context,
      'ASSIGNMENT_REVOKE',
      { requestId, expectedVersion: value.expectedVersion, reviewNote: value.reviewNote },
      async (manager) => {
        const assignment = await manager
          .getRepository(WorkerSiteZoneAssignmentEntity)
          .findOne({ where: { id: requestId }, lock: { mode: 'pessimistic_write' } });
        if (!assignment) missing();
        await this.requireSiteRole(actor, assignment.siteId, UserRole.SITE_MANAGER);
        if (
          assignment.status === WorkerSiteZoneAssignmentStatus.REVOKED &&
          assignment.siteManagerDecidedByUserId === actor.id &&
          assignment.reviewNote === value.reviewNote &&
          assignment.version === value.expectedVersion + 1
        )
          return assignment;
        if (
          assignment.version !== value.expectedVersion ||
          assignment.status !== WorkerSiteZoneAssignmentStatus.APPROVED
        )
          conflict('Assignment changed or is not approved');
        assignment.status = WorkerSiteZoneAssignmentStatus.REVOKED;
        assignment.version += 1;
        assignment.reviewedAt = new Date();
        assignment.reviewNote = value.reviewNote;
        assignment.siteManagerDecidedByUserId = actor.id;
        await manager.getRepository(WorkerSiteZoneAssignmentEntity).save(assignment);
        await auditAccess(
          manager,
          actor.id,
          assignment.siteId,
          'WORKER_ASSIGNMENT_REVOKED',
          'worker_assignment',
          assignment.id,
          value.reviewNote,
          { version: assignment.version },
        );
        return assignment;
      },
      this.assignmentManagerAuthorization(requestId, context),
    );
  }

  private assignmentManagerAuthorization(
    requestId: string,
    context?: MainConfigurationCommandContext,
  ) {
    if (!context) return undefined;
    return async (manager: EntityManager) => {
      const scope = await manager
        .getRepository(WorkerSiteZoneAssignmentEntity)
        .findOneBy({ id: requestId });
      if (!scope) missing();
      await siteManagerCommandAuthorization(scope.siteId, context.actorUserId)!(manager);
    };
  }
}
