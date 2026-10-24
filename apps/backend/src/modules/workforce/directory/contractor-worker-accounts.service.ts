import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsDefined,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { DataSource, In, type EntityManager } from 'typeorm';
import {
  executeMainConfigurationCommand,
  type MainConfigurationCommandContext,
} from '../../../common/configuration/main-configuration-authority.js';
import { WORKER_DEFAULT_TEMPORARY_PASSWORD } from '@smartsite/contracts/management';
import type {
  CreateContractorWorkerAccountCommand as WorkerAccountCommand,
  ContractorWorkerAccountResponse,
  ContractorWorkerAccountOptionsResponse,
  WorkerProfileSnapshot,
  UpdateContractorWorkerCommand as WorkerUpdateCommand,
  WorkerResponse,
} from '@smartsite/contracts/management';
import {
  command,
  conflict,
  knownUnique,
  missing,
  uuid,
} from '../../../common/configuration/commands.js';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
  PASSWORD_POLICY_PATTERN,
} from '../../../common/configuration/password-policy.js';
import { WorkerEntity } from '../../../database/entities/worker.entity.js';
import { WorkerComplianceProfileEntity } from '../../../database/entities/worker-document.entity.js';
import { ContractorEntity } from '../../../database/entities/contractor.entity.js';
import { ContractorRepresentativeGrantEntity } from '../../../database/entities/contractor-representative-grant.entity.js';
import { ContractorSiteParticipationEntity } from '../../../database/entities/contractor-site-participation.entity.js';
import { UserRole } from '../../../database/entities/user.entity.js';
import { UsersService } from '../../users/users.service.js';
import {
  ContractorOperationsService,
  type WorkforceActor,
} from './contractor-operations.service.js';
import { auditAccess } from '../shared/access-audit.js';
import { requireSiteRole } from '../access/qr-access.service.js';

export class CreateContractorWorkerAccountCommand implements WorkerAccountCommand {
  @IsIn(['MALE', 'FEMALE', 'OTHER']) gender!: 'MALE' | 'FEMALE' | 'OTHER';
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  address!: string;
  @IsString()
  @Matches(/^[0-9]{12}$/)
  nationalId!: string;

  @IsString()
  @Matches(/^\+?[0-9]{9,15}$/)
  phoneNumber!: string;

  @IsUUID()
  siteId!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  externalId?: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  displayName!: string;

  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/)
  username!: string;

  @ValidateIf(
    (_object, value) => value !== undefined && value !== WORKER_DEFAULT_TEMPORARY_PASSWORD,
  )
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_POLICY_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  temporaryPassword?: string;
}

class WorkerProfileFields implements WorkerProfileSnapshot {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  externalId!: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  displayName!: string;

  @IsBoolean()
  isActive!: boolean;
}

export class UpdateContractorWorkerCommand
  extends WorkerProfileFields
  implements WorkerUpdateCommand
{
  @IsDefined()
  @ValidateNested()
  @Type(() => WorkerProfileFields)
  expectedSnapshot!: WorkerProfileFields;
}

function profileSnapshot(worker: WorkerProfileSnapshot): WorkerProfileSnapshot {
  return {
    externalId: worker.externalId,
    displayName: worker.displayName,
    isActive: worker.isActive,
  };
}

function sameProfile(left: WorkerProfileSnapshot, right: WorkerProfileSnapshot) {
  return (
    left.externalId === right.externalId &&
    left.displayName === right.displayName &&
    left.isActive === right.isActive
  );
}

@Injectable()
export class ContractorWorkerAccountsService {
  constructor(
    private readonly source: DataSource,
    private readonly operations: ContractorOperationsService,
    private readonly users: UsersService,
  ) {}

  private assertCommandActor(actor: WorkforceActor, context: MainConfigurationCommandContext) {
    if (
      !actor?.id ||
      !context?.actorUserId ||
      uuid(actor.id).toLowerCase() !== uuid(context.actorUserId).toLowerCase()
    )
      throw new UnauthorizedException();
  }

  /** Account/session validity is checked by the coordinator before this role read. */
  private async currentActor(
    manager: EntityManager,
    context: MainConfigurationCommandContext,
  ): Promise<WorkforceActor> {
    const id = uuid(context.actorUserId).toLowerCase();
    const roles = await manager.query<{ role: UserRole; site_id: string | null }[]>(
      'SELECT role,site_id FROM user_role_assignment WHERE user_id=$1 FOR SHARE',
      [id],
    );
    return {
      id,
      mustChangePassword: false,
      roleAssignments: roles.map(({ role, site_id }) => ({ role, siteId: site_id })),
    };
  }

  async update(
    actor: WorkforceActor,
    siteIdValue: string,
    contractorIdValue: string,
    workerIdValue: string,
    input: UpdateContractorWorkerCommand,
    context: MainConfigurationCommandContext,
  ): Promise<WorkerResponse> {
    this.assertCommandActor(actor, context);
    const siteId = uuid(siteIdValue);
    const contractorId = uuid(contractorIdValue);
    const workerId = uuid(workerIdValue);
    const value = command(UpdateContractorWorkerCommand, input);
    let writeActor = actor;
    try {
      return await executeMainConfigurationCommand(
        this.source,
        context,
        'WORKER_PROFILE_UPDATE',
        { siteId, contractorId, workerId, ...value },
        async (manager) => {
          const repo = manager.getRepository(WorkerEntity);
          const worker = await repo.findOne({
            where: { id: workerId, siteId, contractorId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!worker) missing();
          // A retry of an already-applied state is a no-op, including its audit.
          if (sameProfile(worker, value))
            return { ...worker, createdAt: worker.createdAt.toISOString() };
          if (!sameProfile(worker, value.expectedSnapshot))
            conflict('Worker profile changed. Reload it before editing again.');
          const before = profileSnapshot(worker);
          Object.assign(worker, profileSnapshot(value));
          await repo.save(worker);
          await auditAccess(
            manager,
            writeActor.id,
            siteId,
            'WORKER_PROFILE_UPDATED',
            'worker',
            workerId,
            null,
            {
              contractorId,
              before,
              after: profileSnapshot(worker),
            },
          );
          return { ...worker, createdAt: worker.createdAt.toISOString() };
        },
        async (manager) => {
          writeActor = await this.currentActor(manager, context);
          await this.operations.requireWorkerCreationAccess(
            manager,
            writeActor,
            contractorId,
            siteId,
            true,
          );
        },
      );
    } catch (error) {
      knownUnique(error, ['uq_worker_site_external_id']);
    }
  }

  async options(
    actor: WorkforceActor,
    siteIdValue: string,
  ): Promise<ContractorWorkerAccountOptionsResponse> {
    const siteId = uuid(siteIdValue);
    requireSiteRole(actor, siteId, [UserRole.CONTRACTOR_REPRESENTATIVE], false);
    const grants = await this.source
      .getRepository(ContractorRepresentativeGrantEntity)
      .findBy({ userId: actor.id });
    if (!grants.length) return { contractors: [] };
    const participations = await this.source
      .getRepository(ContractorSiteParticipationEntity)
      .findBy({
        siteId,
        contractorId: In(grants.map((g) => g.contractorId)),
        isActive: true,
      });
    const now = new Date();
    const ids = [
      ...new Set(
        participations
          .filter((p) => p.validFrom <= now && (!p.validUntil || p.validUntil > now))
          .map((p) => p.contractorId),
      ),
    ];
    if (!ids.length) return { contractors: [] };
    const contractors = await this.source.getRepository(ContractorEntity).find({
      where: { id: In(ids), isActive: true },
      order: { name: 'ASC', id: 'ASC' },
    });
    return { contractors: contractors.map(({ id, name }) => ({ id, name })) };
  }

  async create(
    actor: WorkforceActor,
    contractorIdValue: string,
    input: CreateContractorWorkerAccountCommand,
    context: MainConfigurationCommandContext,
  ): Promise<ContractorWorkerAccountResponse> {
    this.assertCommandActor(actor, context);
    const contractorId = uuid(contractorIdValue);
    const value = command(CreateContractorWorkerAccountCommand, input);
    const siteId = uuid(value.siteId);
    // Reject unauthorized callers before expensive password hashing.
    await this.source.transaction((manager) =>
      this.operations.requireWorkerCreationAccess(manager, actor, contractorId, siteId),
    );
    const prepared = await this.users.prepareWorkerAccount(value);
    let writeActor = actor;
    try {
      return await executeMainConfigurationCommand(
        this.source,
        context,
        'USER_CONTRACTOR_WORKER_ACCOUNT_CREATE',
        {
          contractorId,
          siteId,
          externalId: value.externalId ?? null,
          nationalId: value.nationalId,
          phoneNumber: value.phoneNumber,
          gender: value.gender,
          address: value.address,
          username: prepared.username,
          displayName: prepared.displayName,
        },
        async (manager) => {
          const account = await this.users.createWorkerAccount(manager, prepared);
          const workers = manager.getRepository(WorkerEntity);
          let externalId = value.externalId;
          if (externalId === undefined) {
            // PostgreSQL sequences allocate distinct values across concurrent transactions.
            // Gaps after a rollback are intentional; codes must never be recycled.
            do {
              const [allocated] = await manager.query<{ number: string }[]>(
                "SELECT nextval('worker_code_seq')::text AS number",
              );
              externalId = `W${allocated!.number.padStart(6, '0')}`;
            } while (await workers.existsBy({ siteId, externalId }));
          }
          const worker = await workers.save({
            id: randomUUID(),
            contractorId,
            siteId,
            userId: account.id,
            externalId,
            displayName: value.displayName,
            isActive: true,
          });
          await manager.getRepository(WorkerComplianceProfileEntity).save({
            workerId: worker.id,
            nationalId: value.nationalId,
            phoneNumber: value.phoneNumber,
            gender: value.gender,
            address: value.address,
            identityRequired: true,
          });
          await auditAccess(
            manager,
            writeActor.id,
            siteId,
            'WORKER_ACCOUNT_CREATED',
            'worker',
            worker.id,
            null,
            { contractorId, userId: account.id },
          );
          return { account, worker: { ...worker, createdAt: worker.createdAt.toISOString() } };
        },
        async (manager) => {
          // Preserve the locked second eligibility check after password preparation,
          // with current DB roles rather than the original request's cached roles.
          writeActor = await this.currentActor(manager, context);
          await this.operations.requireWorkerCreationAccess(
            manager,
            writeActor,
            contractorId,
            siteId,
            true,
          );
        },
      );
    } catch (error) {
      // Retrying the same username/code returns CONFLICT without partial accounts or a reset.
      knownUnique(error, [
        'uq_app_user_username',
        'uq_worker_site_external_id',
        'uq_worker_site_user',
      ]);
    }
  }
}
