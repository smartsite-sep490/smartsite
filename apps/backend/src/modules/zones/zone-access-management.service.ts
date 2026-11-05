import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { IsEnum, IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';
import { DataSource } from 'typeorm';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { command, conflict, missing, page, uuid } from '../../common/configuration/commands.js';
import {
  executeMainConfigurationCommand,
  type MainConfigurationCommandContext,
} from '../../common/configuration/main-configuration-authority.js';
import { siteManagerCommandAuthorization } from '../auth/site-manager.guard.js';
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
    context?: MainConfigurationCommandContext,
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
    const workerId = uuid(value.workerId);
    return executeMainConfigurationCommand(
      this.dataSource,
      context,
      'ZONE_DENY_CREATE',
      {
        siteId: scopedSiteId,
        zoneId: scopedZoneId,
        workerId,
        effect: value.effect,
        validFrom: validFrom.toISOString(),
        validUntil: validUntil?.toISOString() ?? null,
      },
      async (manager) => {
        const zone = await manager.getRepository(ZoneEntity).findOne({
          where: { id: scopedZoneId, siteId: scopedSiteId },
          lock: { mode: 'pessimistic_read' },
        });
        const worker = await manager.getRepository(WorkerEntity).findOne({
          where: { id: workerId, siteId: scopedSiteId, isActive: true },
          lock: { mode: 'pessimistic_read' },
        });
        if (!zone || !worker) missing();
        if (value.effect === ZoneAccessEffect.ALLOW)
          conflict('Use Contractor and Worker Zone permissions within approved assignment bounds');
        return manager.getRepository(ZoneAccessGrantEntity).save({
          id: randomUUID(),
          siteId: scopedSiteId,
          zoneId: scopedZoneId,
          workerId: worker.id,
          effect: value.effect,
          validFrom,
          validUntil,
          revokedAt: null,
        });
      },
      siteManagerCommandAuthorization(scopedSiteId, context?.actorUserId),
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
    revokedAt = new Date(),
    context?: MainConfigurationCommandContext,
  ): Promise<ZoneAccessGrantEntity> {
    const scope = { id: uuid(grantId), siteId: uuid(siteId), zoneId: uuid(zoneId) };
    return executeMainConfigurationCommand(
      this.dataSource,
      context,
      'ZONE_DENY_REVOKE',
      { ...scope, revokedAt: revokedAt.toISOString() },
      async (manager) => {
        const repository = manager.getRepository(ZoneAccessGrantEntity);
        const grant = await repository.findOne({
          where: scope,
          lock: { mode: 'pessimistic_write' },
        });
        if (!grant) missing();
        if (grant.revokedAt === null) {
          await repository.update({ id: grant.id }, { revokedAt });
          grant.revokedAt = revokedAt;
        }
        return grant;
      },
      siteManagerCommandAuthorization(scope.siteId, context?.actorUserId),
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
