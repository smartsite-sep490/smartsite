import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { IsEnum, IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';
import { DataSource, IsNull, type EntityManager } from 'typeorm';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import {
  command,
  conflict,
  invalid,
  missing,
  page,
  uuid,
} from '../../common/configuration/commands.js';
import { WorkerEntity } from '../../database/entities/worker.entity.js';
import {
  ZoneAccessEffect,
  ZoneAccessGrantEntity,
} from '../../database/entities/zone-access-grant.entity.js';
import {
  ZoneEntryDecisionEntity,
  type ZoneEntryDecisionStatus,
} from '../../database/entities/zone-entry-decision.entity.js';
import { ZoneEntity } from '../../database/entities/zone.entity.js';
import { UserRoleAssignmentEntity } from '../../database/entities/user-role-assignment.entity.js';
import { UserRole } from '../../database/entities/user.entity.js';
import { ZoneAuthoritySourceKind } from '../../database/entities/zone-authority-fact-revision.entity.js';
import { executeZoneAuthorityCommand, type ZoneAuthorityActor } from './zone-authority-history.js';
import { ContractorZoneAccessGrantEntity } from '../../database/entities/contractor-zone-access-grant.entity.js';
import { readZoneGrantWorkforcePrerequisites } from '../workforce/workforce-configuration.service.js';
import { checkCurrentWorkerZoneAllowPrerequisites } from './zone-authority-chain.policy.js';

export class CreateZoneAccessGrantCommand {
  @IsUUID()
  workerId!: string;

  @IsEnum(ZoneAccessEffect)
  effect!: ZoneAccessEffect;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i)
  validFrom!: string;

  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i)
  validUntil!: string | null;
}

export interface ZoneEntryDecisionFilters {
  zoneId?: string;
  status?: ZoneEntryDecisionStatus;
  offset?: number;
  limit?: number;
}

export type OriginalZoneDecisionSummary = Pick<
  ZoneEntryDecisionEntity,
  'id' | 'zoneId' | 'status' | 'reasonCode' | 'evaluatedAt'
>;

@Injectable()
export class ZoneAccessManagementService {
  constructor(private readonly dataSource: DataSource) {}

  /** These existing MF06 commands commit their grant and history together. */
  private async writeGrant(
    operation: string,
    actor: ZoneAuthorityActor,
    request: Record<string, unknown>,
    mutate: (manager: EntityManager, at: Date) => Promise<ZoneAccessGrantEntity>,
  ): Promise<ZoneAccessGrantEntity> {
    let result: ZoneAccessGrantEntity | undefined;
    await executeZoneAuthorityCommand(
      this.dataSource,
      { commandId: randomUUID(), operation, actor, request },
      async (manager) => {
        if (
          actor.kind === 'USER' &&
          !(await manager
            .getRepository(UserRoleAssignmentEntity)
            .existsBy({ userId: actor.userId, role: UserRole.ADMIN, siteId: IsNull() }))
        ) {
          throw new PublicHttpException(HttpStatus.FORBIDDEN, {
            code: 'FORBIDDEN',
            message: 'Forbidden',
          });
        }
        const clock: { now: Date }[] = await manager.query('SELECT statement_timestamp() AS now');
        result = await mutate(manager, clock[0]!.now);
        return [
          {
            sourceKind: ZoneAuthoritySourceKind.WORKER_ZONE_GRANT,
            sourceId: result.id,
            siteId: result.siteId,
            effectiveFrom: clock[0]!.now,
            effectiveTo: null,
            payload: {
              grantId: result.id,
              siteId: result.siteId,
              zoneId: result.zoneId,
              workerId: result.workerId,
              contractorId: result.contractorId,
              effect: result.effect,
              validFrom: result.validFrom.toISOString(),
              validUntil: result.validUntil?.toISOString() ?? null,
              revokedAt: result.revokedAt?.toISOString() ?? null,
            },
          },
        ];
      },
    );
    if (!result) throw new Error('Zone grant command did not produce a projection');
    return result;
  }

  /** Historical policy outcomes only; manual identity review must not recalculate authorization. */
  async listObservationDecisions(
    siteId: string,
    eventId: string,
    trackId: number,
    offset = 0,
    limit = 20,
  ): Promise<{ items: OriginalZoneDecisionSummary[]; total: number }> {
    const scope = uuid(siteId);
    const event = uuid(eventId);
    const pagination = page(offset, limit);
    if (!Number.isSafeInteger(trackId) || trackId < 0) {
      throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
        code: 'VALIDATION_FAILED',
        message: 'Invalid observation Track ID',
      });
    }
    const [decisions, total] = await this.dataSource
      .getRepository(ZoneEntryDecisionEntity)
      .findAndCount({
        where: { siteId: scope, eventId: event, trackId },
        order: { evaluatedAt: 'ASC', id: 'ASC' },
        skip: pagination.offset,
        take: pagination.limit,
      });
    return {
      items: decisions.map(({ id, zoneId, status, reasonCode, evaluatedAt }) => ({
        id,
        zoneId,
        status,
        reasonCode,
        evaluatedAt,
      })),
      total,
    };
  }

  async createGrant(
    siteId: string,
    zoneId: string,
    input: CreateZoneAccessGrantCommand,
    actor: ZoneAuthorityActor = { kind: 'SERVICE', subject: 'ZONE_ACCESS_MANAGEMENT' },
  ): Promise<ZoneAccessGrantEntity> {
    const scopedSiteId = uuid(siteId);
    const scopedZoneId = uuid(zoneId);
    const value = command(CreateZoneAccessGrantCommand, input);
    const validFrom = new Date(value.validFrom);
    const validUntil =
      value.validUntil === null || value.validUntil === undefined
        ? null
        : new Date(value.validUntil);
    if (validUntil !== null && validUntil.getTime() <= validFrom.getTime()) {
      throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
        code: 'VALIDATION_FAILED',
        message: 'validUntil must be later than validFrom',
      });
    }
    return this.writeGrant(
      'WORKER_ZONE_GRANT_CREATE',
      actor,
      {
        siteId: scopedSiteId,
        zoneId: scopedZoneId,
        workerId: value.workerId,
        effect: value.effect,
        validFrom: value.validFrom,
        validUntil: value.validUntil ?? null,
      },
      async (manager, at) => {
        const zone = await manager
          .getRepository(ZoneEntity)
          .findOneBy({ id: scopedZoneId, siteId: scopedSiteId });
        const worker = await manager
          .getRepository(WorkerEntity)
          .findOneBy({ id: uuid(value.workerId), siteId: scopedSiteId, isActive: true });
        if (!zone || !worker) missing();
        if (value.effect === ZoneAccessEffect.ALLOW) {
          const workforce = await readZoneGrantWorkforcePrerequisites(
            manager,
            scopedSiteId,
            scopedZoneId,
            worker.id,
          );
          if (!workforce) conflict('Worker grant prerequisites are unavailable');
          const contractorGrants = await manager
            .getRepository(ContractorZoneAccessGrantEntity)
            .find({
              where: {
                siteId: scopedSiteId,
                zoneId: scopedZoneId,
                contractorId: workforce.contractorId,
              },
              order: { id: 'ASC' },
              lock: { mode: 'pessimistic_read' },
            });
          const containment = checkCurrentWorkerZoneAllowPrerequisites(
            {
              ...workforce,
              zoneId: scopedZoneId,
              purpose: 'GRANT_CREATION',
              checkedAt: at,
              contractorGrants,
            },
            {
              siteId: scopedSiteId,
              zoneId: scopedZoneId,
              workerId: worker.id,
              contractorId: worker.contractorId,
              validFrom,
              validUntil,
            },
          );
          if (containment.status !== 'CONTAINED')
            conflict(
              'Worker ALLOW exceeds available Contractor, participation or assignment authority',
            );
        }
        return manager.getRepository(ZoneAccessGrantEntity).save({
          id: randomUUID(),
          siteId: scopedSiteId,
          zoneId: scopedZoneId,
          workerId: worker.id,
          contractorId: worker.contractorId,
          effect: value.effect,
          validFrom,
          validUntil,
          revokedAt: null,
        });
      },
    );
  }

  async listGrants(
    siteId: string,
    zoneId: string,
    offset = 0,
    limit = 20,
  ): Promise<{ items: ZoneAccessGrantEntity[]; total: number }> {
    const pagination = page(offset, limit);
    const [items, total] = await this.dataSource.getRepository(ZoneAccessGrantEntity).findAndCount({
      where: { siteId: uuid(siteId), zoneId: uuid(zoneId) },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: pagination.offset,
      take: pagination.limit,
    });
    return { items, total };
  }

  async revokeGrant(
    siteId: string,
    zoneId: string,
    grantId: string,
    revokedAt?: Date,
    actor: ZoneAuthorityActor = { kind: 'SERVICE', subject: 'ZONE_ACCESS_MANAGEMENT' },
  ): Promise<ZoneAccessGrantEntity> {
    if (
      revokedAt !== undefined &&
      (!(revokedAt instanceof Date) || !Number.isFinite(revokedAt.getTime()))
    ) {
      invalid('Invalid revocation timestamp');
    }
    const scope = {
      id: uuid(grantId),
      siteId: uuid(siteId),
      zoneId: uuid(zoneId),
    };
    return this.writeGrant(
      'WORKER_ZONE_GRANT_REVOKE',
      actor,
      { ...scope, revokedAt: revokedAt?.toISOString() ?? null },
      async (manager, at) => {
        const repository = manager.getRepository(ZoneAccessGrantEntity);
        const grant = await repository.findOne({
          where: scope,
          lock: { mode: 'pessimistic_write' },
        });
        if (!grant) missing();
        // First successful revocation wins. New commands confirm the persisted
        // value; they never rewrite it with a later caller's proposed timestamp.
        if (grant.revokedAt === null) {
          grant.revokedAt = revokedAt ?? at;
          return repository.save(grant);
        }
        return grant;
      },
    );
  }

  async listDecisions(
    siteId: string,
    filters: ZoneEntryDecisionFilters = {},
  ): Promise<{ items: ZoneEntryDecisionEntity[]; total: number }> {
    const pagination = page(filters.offset, filters.limit);
    const where: { siteId: string; zoneId?: string; status?: ZoneEntryDecisionStatus } = {
      siteId: uuid(siteId),
    };
    if (filters.zoneId !== undefined) where.zoneId = uuid(filters.zoneId);
    if (filters.status !== undefined) {
      if (!['ALLOWED', 'DENIED', 'UNAVAILABLE'].includes(filters.status)) {
        throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
          code: 'VALIDATION_FAILED',
          message: 'Invalid decision status',
        });
      }
      where.status = filters.status;
    }
    const [items, total] = await this.dataSource
      .getRepository(ZoneEntryDecisionEntity)
      .findAndCount({
        where,
        order: { evaluatedAt: 'DESC', id: 'DESC' },
        skip: pagination.offset,
        take: pagination.limit,
      });
    return { items, total };
  }
}
