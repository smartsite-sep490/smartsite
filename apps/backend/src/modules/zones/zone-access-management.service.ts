import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { IsEnum, IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';
import { DataSource, QueryFailedError } from 'typeorm';
import {
  executeMainConfigurationCommand,
  type MainConfigurationCommandContext,
} from '../../common/configuration/main-configuration-authority.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import {
  command,
  conflict,
  invalid,
  missing,
  page,
  uuid,
} from '../../common/configuration/commands.js';
import {
  ZoneAccessEffect,
  ZoneAccessGrantEntity,
} from '../../database/entities/zone-access-grant.entity.js';
import {
  ZoneEntryDecisionEntity,
  type ZoneEntryDecisionStatus,
} from '../../database/entities/zone-entry-decision.entity.js';

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

// Explicit retained-main columns: the old branch entity's contractor_id does not exist on main.
const grantColumns =
  'id,site_id AS "siteId",zone_id AS "zoneId",worker_id AS "workerId",NULL::uuid AS "contractorId",effect,valid_from AS "validFrom",valid_until AS "validUntil",revoked_at AS "revokedAt",created_at AS "createdAt"';

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
    const scopedSiteId = uuid(siteId),
      scopedZoneId = uuid(zoneId);
    const value = command(CreateZoneAccessGrantCommand, input);
    return executeMainConfigurationCommand(
      this.dataSource,
      context,
      'ZONE_DENY_CREATE',
      {
        siteId: scopedSiteId,
        zoneId: scopedZoneId,
        ...value,
      },
      async (manager) => {
        // PostgreSQL compares the input instants at its actual microsecond precision.
        // The existing public Date projection is unchanged; it is not a microsecond wire claim.
        let interval: { valid: boolean }[];
        try {
          interval = await manager.query(
            'SELECT isfinite($1::timestamptz) AND ($2::timestamptz IS NULL OR (isfinite($2::timestamptz) AND $2::timestamptz>$1::timestamptz)) AS valid',
            [value.validFrom, value.validUntil ?? null],
          );
        } catch (error) {
          const code =
            error instanceof QueryFailedError
              ? (error.driverError as { code?: string }).code
              : undefined;
          if (code === '22007' || code === '22008') invalid('Invalid grant interval');
          throw error;
        }
        if (!interval[0]?.valid) invalid('validUntil must be later than validFrom');
        const zones = await manager.query(
          'SELECT id FROM zone WHERE id=$1 AND site_id=$2 FOR SHARE',
          [scopedZoneId, scopedSiteId],
        );
        const workers = await manager.query(
          'SELECT id FROM worker WHERE id=$1 AND site_id=$2 AND is_active FOR SHARE',
          [value.workerId, scopedSiteId],
        );
        if (!zones.length || !workers.length) missing();
        if (value.effect === ZoneAccessEffect.ALLOW)
          conflict('Use Contractor and Worker Zone permissions within approved assignment bounds');
        const rows: ZoneAccessGrantEntity[] = await manager.query(
          `INSERT INTO zone_access_grant(id,site_id,zone_id,worker_id,effect,valid_from,valid_until,revoked_at) VALUES($1,$2,$3,$4,'DENY',$5::timestamptz,$6::timestamptz,NULL) RETURNING ${grantColumns}`,
          [
            randomUUID(),
            scopedSiteId,
            scopedZoneId,
            value.workerId,
            value.validFrom,
            value.validUntil ?? null,
          ],
        );
        return rows[0]!;
      },
    );
  }

  async listGrants(
    siteId: string,
    zoneId: string,
    offset = 0,
    limit = 20,
  ): Promise<{ items: ZoneAccessGrantEntity[]; total: number }> {
    const pagination = page(offset, limit),
      scope = [uuid(siteId), uuid(zoneId)];
    const items: ZoneAccessGrantEntity[] = await this.dataSource.query(
      `SELECT ${grantColumns} FROM zone_access_grant WHERE site_id=$1 AND zone_id=$2 ORDER BY created_at DESC,id DESC OFFSET $3 LIMIT $4`,
      [...scope, pagination.offset, pagination.limit],
    );
    const count = await this.dataSource.query(
      'SELECT count(*)::int AS n FROM zone_access_grant WHERE site_id=$1 AND zone_id=$2',
      scope,
    );
    return { items, total: count[0].n };
  }

  async revokeGrant(
    siteId: string,
    zoneId: string,
    grantId: string,
    revokedAt?: Date,
    context?: MainConfigurationCommandContext,
  ): Promise<ZoneAccessGrantEntity> {
    if (
      revokedAt !== undefined &&
      (!(revokedAt instanceof Date) || !Number.isFinite(revokedAt.getTime()))
    )
      invalid('Invalid revocation timestamp');
    const scope = { id: uuid(grantId), siteId: uuid(siteId), zoneId: uuid(zoneId) };
    return executeMainConfigurationCommand(
      this.dataSource,
      context,
      'ZONE_DENY_REVOKE',
      {
        ...scope,
        revokedAt: revokedAt?.toISOString() ?? null,
      },
      async (manager) => {
        const rows: ZoneAccessGrantEntity[] = await manager.query(
          `SELECT ${grantColumns} FROM zone_access_grant WHERE id=$1 AND site_id=$2 AND zone_id=$3 FOR UPDATE`,
          [scope.id, scope.siteId, scope.zoneId],
        );
        const grant = rows[0];
        if (!grant) missing();
        // A retry/no-op confirms the first persisted revocation without rewriting it.
        if (grant.revokedAt !== null) return grant;
        const updated: ZoneAccessGrantEntity[] = await manager.query(
          `WITH changed AS (UPDATE zone_access_grant SET revoked_at=COALESCE($4::timestamptz,statement_timestamp()) WHERE id=$1 AND site_id=$2 AND zone_id=$3 RETURNING *) SELECT ${grantColumns} FROM changed`,
          [scope.id, scope.siteId, scope.zoneId, revokedAt?.toISOString() ?? null],
        );
        return updated[0]!;
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
