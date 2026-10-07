import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { WorkerEntity } from '../../database/entities/worker.entity.js';
import {
  ZoneAccessGrantEntity,
  ZoneAccessEffect,
} from '../../database/entities/zone-access-grant.entity.js';
import { ZoneEntryDecisionEntity } from '../../database/entities/zone-entry-decision.entity.js';
import { ZoneRestrictionPolicy } from '../../database/entities/enums.js';
import type { ZoneAuthorizationResult } from './zone-authorization.interface.js';
import { ZoneAuthorizationService } from './zone-authorization.service.js';

export interface ZoneEntryDecisionInput {
  eventId: string;
  siteId: string;
  zoneId: string;
  candidateWorkerId?: string;
  /** Trusted backend identity. An AI IDENTITY_CANDIDATE must never populate this field. */
  verifiedWorkerId?: string;
  trackId: number;
  evaluatedAt: Date;
  restrictionPolicy?: ZoneRestrictionPolicy;
}

@Injectable()
export class ZoneEntryAuthorizationService {
  constructor(private readonly policy: ZoneAuthorizationService = new ZoneAuthorizationService()) {}

  async decide(
    manager: EntityManager,
    input: ZoneEntryDecisionInput,
  ): Promise<ZoneAuthorizationResult> {
    const restrictionPolicy =
      input.restrictionPolicy ?? ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED;
    if (restrictionPolicy !== ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED) {
      return this.policy.authorizeZoneEntry({ restrictionPolicy });
    }
    if (!input.verifiedWorkerId) {
      return this.policy.authorizeZoneEntry({ restrictionPolicy });
    }

    const worker = await manager.getRepository(WorkerEntity).findOneBy({
      id: input.verifiedWorkerId,
      siteId: input.siteId,
      isActive: true,
    });
    if (!worker) return this.policy.authorizeZoneEntry({ restrictionPolicy });

    const permissions = await manager.query<{ validFrom: Date; validUntil: Date }[]>(
      `SELECT wp.valid_from AS "validFrom",wp.valid_until AS "validUntil"
      FROM worker_zone_permission wp
      JOIN worker_site_zone_assignment a ON a.id=wp.worker_assignment_id
      JOIN contractor_zone_permission cp ON cp.id=wp.contractor_zone_permission_id AND cp.site_contractor_id=a.site_contractor_id
      JOIN contractor_site_participation p ON p.id=a.site_contractor_id
      JOIN contractor c ON c.id=p.contractor_id
      WHERE a.worker_id=$1 AND a.site_id=$2 AND cp.zone_id=$3 AND p.site_id=a.site_id
        AND p.contractor_id=$4 AND p.is_active AND c.is_active AND a.status='APPROVED'
        AND a.valid_until IS NOT NULL AND a.valid_from<=$5 AND a.valid_until>$5
        AND wp.valid_from<=$5 AND wp.valid_until>$5 AND cp.valid_from<=$5 AND cp.valid_until>$5
        AND p.valid_from<=$5 AND (p.valid_until IS NULL OR p.valid_until>$5)
        AND wp.valid_from>=a.valid_from AND wp.valid_until<=a.valid_until
        AND wp.valid_from>=cp.valid_from AND wp.valid_until<=cp.valid_until
        AND wp.valid_from>=p.valid_from AND (p.valid_until IS NULL OR wp.valid_until<=p.valid_until)
        AND (wp.revoked_at IS NULL OR wp.revoked_at>$5) AND (cp.revoked_at IS NULL OR cp.revoked_at>$5)`,
      [worker.id, input.siteId, input.zoneId, worker.contractorId, input.evaluatedAt],
    );
    const grants = permissions.map((p) => ({
      effect: 'ALLOW' as const,
      validFrom: p.validFrom,
      validUntil: p.validUntil,
      revokedAt: null,
    }));
    const denies = await manager.getRepository(ZoneAccessGrantEntity).findBy({
      siteId: input.siteId,
      zoneId: input.zoneId,
      workerId: worker.id,
      effect: ZoneAccessEffect.DENY,
    });
    return this.policy.authorizeZoneEntry(
      { restrictionPolicy },
      {
        candidateWorkerId: input.candidateWorkerId ?? worker.externalId,
        workerId: worker.id,
        evaluatedAt: input.evaluatedAt,
        authorizationDataAvailable: true,
        grants: [...grants, ...denies],
      },
    );
  }

  async record(
    manager: EntityManager,
    input: Omit<ZoneEntryDecisionInput, 'restrictionPolicy'>,
    result: ZoneAuthorizationResult,
  ): Promise<ZoneEntryDecisionEntity> {
    const repository = manager.getRepository(ZoneEntryDecisionEntity);
    await repository
      .createQueryBuilder()
      .insert()
      .values({
        id: randomUUID(),
        eventId: input.eventId,
        siteId: input.siteId,
        zoneId: input.zoneId,
        workerId: result.workerId ?? null,
        candidateWorkerId: input.candidateWorkerId ?? null,
        trackId: input.trackId,
        status: result.status,
        reasonCode: result.reasonCode ?? 'AUTHORIZATION_DATA_UNAVAILABLE',
        evaluatedAt: input.evaluatedAt,
      })
      .orIgnore()
      .execute();
    return (await repository.findOneBy({
      eventId: input.eventId,
      trackId: input.trackId,
      zoneId: input.zoneId,
    }))!;
  }
}
