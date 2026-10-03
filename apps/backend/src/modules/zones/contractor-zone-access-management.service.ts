import { randomUUID } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { IsEnum, IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';
import { DataSource, IsNull, type EntityManager } from 'typeorm';
import { command, invalid, missing, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { ContractorZoneAccessGrantEntity } from '../../database/entities/contractor-zone-access-grant.entity.js';
import { ZoneAccessEffect } from '../../database/entities/zone-access-grant.entity.js';
import { UserRoleAssignmentEntity } from '../../database/entities/user-role-assignment.entity.js';
import { UserRole } from '../../database/entities/user.entity.js';
import { ZoneAuthoritySourceKind } from '../../database/entities/zone-authority-fact-revision.entity.js';
import { ZoneEntity } from '../../database/entities/zone.entity.js';
import { hasActiveContractorParticipation } from '../workforce/contractor-participation.js';
import { executeZoneAuthorityCommand, type ZoneAuthorityActor } from './zone-authority-history.js';

export class CreateContractorZoneAccessGrantCommand {
  @IsUUID()
  contractorId!: string;

  @IsEnum(ZoneAccessEffect)
  effect!: ZoneAccessEffect;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i)
  validFrom!: string;

  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i)
  validUntil?: string | null;
}

/** Internal MF06 command boundary; no public endpoint or identity assertion. */
export class ContractorZoneAccessManagementService {
  constructor(private readonly dataSource: DataSource) {}

  private async writeGrant(
    operation: string,
    actor: ZoneAuthorityActor,
    request: Record<string, unknown>,
    mutate: (manager: EntityManager, at: Date) => Promise<ContractorZoneAccessGrantEntity>,
  ): Promise<ContractorZoneAccessGrantEntity> {
    let result: ContractorZoneAccessGrantEntity | undefined;
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
            sourceKind: ZoneAuthoritySourceKind.CONTRACTOR_ZONE_GRANT,
            sourceId: result.id,
            siteId: result.siteId,
            effectiveFrom: clock[0]!.now,
            effectiveTo: null,
            payload: {
              grantId: result.id,
              siteId: result.siteId,
              zoneId: result.zoneId,
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
    if (!result) throw new Error('Contractor Zone command did not produce a projection');
    return result;
  }

  async createGrant(
    siteId: string,
    zoneId: string,
    input: CreateContractorZoneAccessGrantCommand,
    actor: ZoneAuthorityActor,
  ): Promise<ContractorZoneAccessGrantEntity> {
    const scope = { siteId: uuid(siteId), zoneId: uuid(zoneId) };
    const value = command(CreateContractorZoneAccessGrantCommand, input);
    const validFrom = new Date(value.validFrom);
    const validUntil = value.validUntil ? new Date(value.validUntil) : null;
    if (validUntil && validUntil.getTime() <= validFrom.getTime())
      invalid('validUntil must be later than validFrom');
    return this.writeGrant(
      'CONTRACTOR_ZONE_GRANT_CREATE',
      actor,
      {
        ...scope,
        contractorId: value.contractorId,
        effect: value.effect,
        validFrom: value.validFrom,
        validUntil: value.validUntil ?? null,
      },
      async (manager, at) => {
        if (
          !(await manager
            .getRepository(ZoneEntity)
            .findOneBy({ id: scope.zoneId, siteId: scope.siteId }))
        )
          missing();
        // This is the owner's existing command-time eligibility query, not a
        // historical COMPLETE snapshot or full-interval Worker containment.
        if (
          !(await hasActiveContractorParticipation(manager, value.contractorId, scope.siteId, at))
        ) {
          throw new PublicHttpException(HttpStatus.FORBIDDEN, {
            code: 'FORBIDDEN',
            message: 'Contractor participation unavailable',
          });
        }
        return manager.getRepository(ContractorZoneAccessGrantEntity).save({
          id: randomUUID(),
          ...scope,
          contractorId: value.contractorId,
          effect: value.effect,
          validFrom,
          validUntil,
          revokedAt: null,
        });
      },
    );
  }

  async revokeGrant(
    siteId: string,
    zoneId: string,
    grantId: string,
    actor: ZoneAuthorityActor,
  ): Promise<ContractorZoneAccessGrantEntity> {
    const scope = { id: uuid(grantId), siteId: uuid(siteId), zoneId: uuid(zoneId) };
    return this.writeGrant('CONTRACTOR_ZONE_GRANT_REVOKE', actor, scope, async (manager, at) => {
      const repository = manager.getRepository(ContractorZoneAccessGrantEntity);
      const grant = await repository.findOne({ where: scope, lock: { mode: 'pessimistic_write' } });
      if (!grant) missing();
      // Disabling participation must never prevent an authorized Admin from
      // removing a ceiling. The first stored revocation remains immutable.
      if (grant.revokedAt === null) {
        grant.revokedAt = at;
        return repository.save(grant);
      }
      return grant;
    });
  }
}
