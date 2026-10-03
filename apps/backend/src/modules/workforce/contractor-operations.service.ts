import { randomUUID } from 'node:crypto';
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
} from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { ContractorEntity } from '../../database/entities/contractor.entity.js';
import { ContractorRepresentativeGrantEntity } from '../../database/entities/contractor-representative-grant.entity.js';
import { ContractorSiteParticipationEntity } from '../../database/entities/contractor-site-participation.entity.js';
import { SiteEntity } from '../../database/entities/site.entity.js';
import { UserRoleAssignmentEntity } from '../../database/entities/user-role-assignment.entity.js';
import { UserEntity, UserRole } from '../../database/entities/user.entity.js';
import {
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
} from '../../database/entities/worker-site-zone-assignment.entity.js';
import { WorkerEntity } from '../../database/entities/worker.entity.js';
import { ZoneEntity } from '../../database/entities/zone.entity.js';

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
  @IsBoolean()
  approve!: boolean;
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
  ): Promise<void> {
    this.assertPasswordChanged(actor);
    if (this.isAdmin(actor)) return;
    if (!this.hasSiteRole(actor, siteId, UserRole.CONTRACTOR_REPRESENTATIVE)) this.forbidden();
    const grant = await manager.getRepository(ContractorRepresentativeGrantEntity).findOneBy({
      userId: actor.id,
      contractorId,
    });
    if (!grant) this.forbidden();
  }

  private async requireSiteRole(
    actor: WorkforceActor,
    siteId: string,
    role: UserRole.SAFETY_OFFICER | UserRole.SITE_MANAGER,
  ): Promise<void> {
    this.assertPasswordChanged(actor);
    if (!this.isAdmin(actor) && !this.hasSiteRole(actor, siteId, role)) this.forbidden();
  }

  /**
   * Site-roster workers are created by the administrative workforce surface and
   * intentionally have no contractor yet.  Face enrollment is still an
   * operator action, so keep it limited to the global administrator or a
   * trusted operator assigned to that worker's site.
   */
  private assertWorkerEnrollmentOperator(actor: WorkforceActor, siteId: string): void {
    this.assertPasswordChanged(actor);
    if (this.isAdmin(actor)) return;
    const allowed = actor.roleAssignments.some(
      ({ role, siteId: assignedSiteId }) =>
        assignedSiteId === siteId &&
        (role === UserRole.SITE_MANAGER ||
          role === UserRole.SAFETY_OFFICER ||
          role === UserRole.SECURITY_OFFICER),
    );
    if (!allowed) this.forbidden();
  }

  private async requireActiveParticipation(
    manager: EntityManager,
    contractorId: string,
    siteId: string,
    at: Date,
    until?: Date | null,
  ): Promise<void> {
    const contractor = await manager
      .getRepository(ContractorEntity)
      .findOneBy({ id: contractorId });
    if (!contractor) missing();
    if (!contractor.isActive) this.forbidden();
    const participation = await manager.getRepository(ContractorSiteParticipationEntity).findBy({
      contractorId,
      siteId,
      isActive: true,
    });
    if (until === undefined) {
      if (
        !participation.some(
          ({ validFrom, validUntil }) =>
            validFrom.getTime() <= at.getTime() &&
            (validUntil === null || validUntil.getTime() > at.getTime()),
        )
      )
        this.forbidden();
      return;
    }

    // An assignment needs continuous coverage for its entire [from, until)
    // interval. Checking only its start lets it outlive contractor participation.
    const intervals = participation.map(({ validFrom, validUntil }) => {
      const from = validFrom instanceof Date ? validFrom.getTime() : Number.NaN;
      const end =
        validUntil === null
          ? Number.POSITIVE_INFINITY
          : validUntil instanceof Date
            ? validUntil.getTime()
            : Number.NaN;
      if (!Number.isFinite(from) || Number.isNaN(end) || end <= from) this.forbidden();
      return { from, end };
    });
    intervals.sort((left, right) => left.from - right.from);
    const requestedEnd = until === null ? Number.POSITIVE_INFINITY : until.getTime();
    let coveredUntil = at.getTime();
    for (const interval of intervals) {
      if (interval.from > coveredUntil) break;
      coveredUntil = Math.max(coveredUntil, interval.end);
      if (coveredUntil >= requestedEnd) return;
    }
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
      this.assertWorkerEnrollmentOperator(actor, worker.siteId);
      return worker;
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
  ) {
    this.assertAdmin(actor);
    const contractorId = uuid(contractorIdValue);
    const value = command(CreateContractorParticipationCommand, input);
    const range = timeRange(value.validFrom, value.validUntil);
    return this.dataSource.transaction(async (manager) => {
      const contractor = await manager
        .getRepository(ContractorEntity)
        .findOneBy({ id: contractorId });
      if (!contractor) missing();
      const siteId = uuid(value.siteId);
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
    });
  }

  async grantRepresentative(
    actor: WorkforceActor,
    contractorIdValue: string,
    input: GrantContractorRepresentativeCommand,
  ) {
    this.assertAdmin(actor);
    const contractorId = uuid(contractorIdValue);
    const value = command(GrantContractorRepresentativeCommand, input);
    return this.dataSource.transaction(async (manager) => {
      const [contractor, user] = await Promise.all([
        manager.getRepository(ContractorEntity).findOneBy({ id: contractorId }),
        manager.getRepository(UserEntity).findOneBy({ id: uuid(value.userId) }),
      ]);
      if (!contractor || !user) missing();
      const roles = await manager
        .getRepository(UserRoleAssignmentEntity)
        .findBy({ userId: user.id });
      if (!roles.some(({ role, siteId }) => role === UserRole.CONTRACTOR_REPRESENTATIVE && siteId))
        throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
          code: 'VALIDATION_FAILED',
          message: 'User must have a Contractor Representative Site role',
        });
      const existing = await manager.getRepository(ContractorRepresentativeGrantEntity).findOneBy({
        userId: user.id,
        contractorId,
      });
      if (existing) return existing;
      return manager.getRepository(ContractorRepresentativeGrantEntity).save({
        id: randomUUID(),
        userId: user.id,
        contractorId,
      });
    });
  }

  async createWorker(
    actor: WorkforceActor,
    contractorIdValue: string,
    input: CreateContractorWorkerCommand,
  ) {
    const contractorId = uuid(contractorIdValue);
    const value = command(CreateContractorWorkerCommand, input);
    const siteId = uuid(value.siteId);
    return this.dataSource.transaction(async (manager) => {
      await this.requireContractorRepresentative(manager, actor, contractorId, siteId);
      await this.requireActiveParticipation(manager, contractorId, siteId, new Date());
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
    });
  }

  async requestAssignment(
    actor: WorkforceActor,
    workerIdValue: string,
    input: CreateWorkerSiteZoneAssignmentCommand,
  ) {
    const workerId = uuid(workerIdValue);
    const value = command(CreateWorkerSiteZoneAssignmentCommand, input);
    const siteId = uuid(value.siteId);
    const zoneIds = [...new Set(value.zoneIds.map(uuid))];
    if (zoneIds.length !== value.zoneIds.length) conflict('Zone IDs must be unique');
    const range = timeRange(value.validFrom, value.validUntil);
    return this.dataSource.transaction(async (manager) => {
      const worker = await manager.getRepository(WorkerEntity).findOneBy({ id: workerId, siteId });
      if (!worker?.contractorId || !worker.isActive) this.forbidden();
      await this.requireContractorRepresentative(manager, actor, worker.contractorId, siteId);
      await this.requireActiveParticipation(
        manager,
        worker.contractorId,
        siteId,
        range.from,
        range.until,
      );
      const zones = await manager.getRepository(ZoneEntity).findBy({ id: In(zoneIds), siteId });
      if (zones.length !== zoneIds.length) this.forbidden();
      return manager.getRepository(WorkerSiteZoneAssignmentEntity).save({
        id: randomUUID(),
        workerId,
        siteId,
        zoneIds,
        status: WorkerSiteZoneAssignmentStatus.PENDING,
        validFrom: range.from,
        validUntil: range.until,
        requestedByUserId: actor.id,
        safetyReviewedByUserId: null,
        siteManagerDecidedByUserId: null,
      });
    });
  }

  /** Recheck mutable eligibility before a positive review, not just at submission.
   * This is not historical ownership or serialization of other domain writers.
   * Assignment remains a work allocation; this check never creates Zone grants.
   */
  private async requireAssignmentEligibility(
    manager: EntityManager,
    request: WorkerSiteZoneAssignmentEntity,
  ): Promise<void> {
    const worker = await manager.getRepository(WorkerEntity).findOneBy({
      id: request.workerId,
      siteId: request.siteId,
    });
    if (!worker?.contractorId || !worker.isActive) this.forbidden();
    await this.requireActiveParticipation(
      manager,
      worker.contractorId,
      request.siteId,
      request.validFrom,
      request.validUntil,
    );
    const zones = await manager.getRepository(ZoneEntity).findBy({
      id: In(request.zoneIds),
      siteId: request.siteId,
    });
    if (zones.length !== request.zoneIds.length) this.forbidden();
  }

  async safetyReview(actor: WorkforceActor, requestIdValue: string) {
    const requestId = uuid(requestIdValue);
    return this.dataSource.transaction(async (manager) => {
      const request = await manager
        .getRepository(WorkerSiteZoneAssignmentEntity)
        .createQueryBuilder('assignment')
        .setLock('pessimistic_write')
        .where('assignment.id = :requestId', { requestId })
        .getOne();
      if (!request) missing();
      await this.requireSiteRole(actor, request.siteId, UserRole.SAFETY_OFFICER);
      if (request.status !== WorkerSiteZoneAssignmentStatus.PENDING)
        conflict('Assignment is not pending');
      await this.requireAssignmentEligibility(manager, request);
      request.status = WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED;
      request.safetyReviewedByUserId = actor.id;
      return manager.getRepository(WorkerSiteZoneAssignmentEntity).save(request);
    });
  }

  async siteManagerDecision(
    actor: WorkforceActor,
    requestIdValue: string,
    input: SiteManagerDecisionCommand,
  ) {
    const requestId = uuid(requestIdValue);
    const value = command(SiteManagerDecisionCommand, input);
    return this.dataSource.transaction(async (manager) => {
      const request = await manager
        .getRepository(WorkerSiteZoneAssignmentEntity)
        .createQueryBuilder('assignment')
        .setLock('pessimistic_write')
        .where('assignment.id = :requestId', { requestId })
        .getOne();
      if (!request) missing();
      await this.requireSiteRole(actor, request.siteId, UserRole.SITE_MANAGER);
      if (request.status !== WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED)
        conflict('Assignment requires Safety review');
      if (value.approve) await this.requireAssignmentEligibility(manager, request);
      request.status = value.approve
        ? WorkerSiteZoneAssignmentStatus.APPROVED
        : WorkerSiteZoneAssignmentStatus.REJECTED;
      request.siteManagerDecidedByUserId = actor.id;
      return manager.getRepository(WorkerSiteZoneAssignmentEntity).save(request);
    });
  }
}
