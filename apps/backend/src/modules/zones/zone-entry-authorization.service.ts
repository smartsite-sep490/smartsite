import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { WorkerEntity } from '../../database/entities/worker.entity.js';
import { ZoneAccessEffect } from '../../database/entities/zone-access-grant.entity.js';
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
    if (!(input.candidateWorkerId ?? worker.externalId)) {
      return this.policy.authorizeZoneEntry({ restrictionPolicy });
    }
    const unavailable = () =>
      this.policy.authorizeZoneEntry(
        { restrictionPolicy },
        {
          candidateWorkerId: input.candidateWorkerId ?? worker.externalId,
          workerId: worker.id,
          evaluatedAt: input.evaluatedAt,
          authorizationDataAvailable: false,
          grants: [],
        },
      );
    if (!Number.isFinite(input.evaluatedAt.getTime())) return unavailable();

    // Retained-main current-state predicate. This is not captured-time history:
    // mutable eligibility rows do not certify their previous state at evaluatedAt.
    let permissions: { effect: ZoneAccessEffect | 'INVALID_TIME' }[];
    // A PostgreSQL missing-relation error aborts the caller's transaction.
    // Isolate this compatibility read so UNAVAILABLE can still be recorded.
    const runner = manager.queryRunner;
    const withinTransaction = runner?.isTransactionActive ?? false;
    if (withinTransaction) await runner!.startTransaction();
    try {
      permissions = await manager.query<{ effect: ZoneAccessEffect | 'INVALID_TIME' }[]>(
        `SELECT 'ALLOW' AS effect
      FROM worker_zone_permission wp
      JOIN worker_site_zone_assignment a ON a.id=wp.worker_assignment_id
      JOIN contractor_zone_permission cp ON cp.id=wp.contractor_zone_permission_id AND cp.site_contractor_id=a.site_contractor_id
      JOIN contractor_site_participation p ON p.id=a.site_contractor_id
      JOIN contractor c ON c.id=p.contractor_id
      WHERE a.worker_id=$1 AND a.site_id=$2 AND cp.zone_id=$3 AND p.site_id=a.site_id
        AND p.contractor_id=$4 AND p.is_active AND c.is_active AND a.status='APPROVED'
        AND a.valid_until IS NOT NULL AND isfinite(a.valid_from) AND isfinite(a.valid_until)
        AND isfinite(wp.valid_from) AND isfinite(wp.valid_until)
        AND isfinite(cp.valid_from) AND isfinite(cp.valid_until)
        AND isfinite(p.valid_from) AND (p.valid_until IS NULL OR isfinite(p.valid_until))
        AND a.valid_from<=$5 AND a.valid_until>$5
        AND wp.valid_from<=$5 AND wp.valid_until>$5 AND cp.valid_from<=$5 AND cp.valid_until>$5
        AND p.valid_from<=$5 AND (p.valid_until IS NULL OR p.valid_until>$5)
        AND wp.valid_from>=a.valid_from AND wp.valid_until<=a.valid_until
        AND wp.valid_from>=cp.valid_from AND wp.valid_until<=cp.valid_until
        AND wp.valid_from>=p.valid_from AND (p.valid_until IS NULL OR wp.valid_until<=p.valid_until)
        AND (wp.revoked_at IS NULL OR wp.revoked_at>$5) AND (cp.revoked_at IS NULL OR cp.revoked_at>$5)
      UNION ALL
      SELECT 'ALLOW' AS effect FROM team_zone_permission tp
      JOIN contractor_team t ON t.id=tp.team_id AND t.site_id=$2 AND t.contractor_id=$4 AND t.is_active
      JOIN contractor_team_membership tm ON tm.team_id=t.id AND tm.site_id=t.site_id AND tm.contractor_id=t.contractor_id AND tm.worker_id=$1 AND tm.joined_at<=$5 AND (tm.left_at IS NULL OR tm.left_at>$5)
      JOIN contractor_zone_permission cp ON cp.id=tp.contractor_zone_permission_id AND cp.zone_id=$3
      JOIN contractor_site_participation p ON p.id=cp.site_contractor_id AND p.site_id=t.site_id AND p.contractor_id=t.contractor_id AND p.is_active
      JOIN contractor c ON c.id=p.contractor_id AND c.is_active
      JOIN worker_site_zone_assignment a ON a.worker_id=$1 AND a.site_id=$2 AND a.site_contractor_id=p.id AND a.status='APPROVED' AND $3=ANY(a.zone_ids)
      WHERE tp.valid_from<=$5 AND tp.valid_until>$5 AND (tp.revoked_at IS NULL OR tp.revoked_at>$5)
      AND cp.valid_from<=$5 AND cp.valid_until>$5 AND (cp.revoked_at IS NULL OR cp.revoked_at>$5)
      AND p.valid_from<=$5 AND (p.valid_until IS NULL OR p.valid_until>$5)
      AND a.valid_from<=$5 AND a.valid_until>$5
      AND tp.valid_from>=cp.valid_from AND tp.valid_until<=cp.valid_until
      AND tp.valid_from>=p.valid_from AND (p.valid_until IS NULL OR tp.valid_until<=p.valid_until)
      UNION ALL
      SELECT 'DENY' AS effect FROM zone_access_grant d
      WHERE d.worker_id=$1 AND d.site_id=$2 AND d.zone_id=$3 AND d.effect='DENY'
        AND d.valid_from<=$5 AND (d.valid_until IS NULL OR d.valid_until>$5)
        AND (d.revoked_at IS NULL OR d.revoked_at>$5)
      UNION ALL
      SELECT 'INVALID_TIME' AS effect FROM zone_access_grant d
      WHERE d.worker_id=$1 AND d.site_id=$2 AND d.zone_id=$3 AND d.effect='DENY'
        AND (NOT isfinite(d.valid_from)
          OR (d.valid_until IS NOT NULL AND (NOT isfinite(d.valid_until) OR d.valid_until<=d.valid_from))
          OR (d.revoked_at IS NOT NULL AND NOT isfinite(d.revoked_at)))`,
        [worker.id, input.siteId, input.zoneId, worker.contractorId, input.evaluatedAt],
      );
      if (withinTransaction) await runner!.commitTransaction();
    } catch (error) {
      if (withinTransaction) await runner!.rollbackTransaction();
      // Unreconciled old schemas cannot fall back to legacy flat ALLOW grants.
      const code = (error as { code?: string }).code;
      if (code !== '42P01' && code !== '42703') throw error;
      return unavailable();
    }
    // PostgreSQL evaluates both effects in one statement snapshot with its full
    // timestamp precision. Do not round its interval endpoints through JS Date
    // or fabricate timestamps for these already evaluated permission effects.
    const effects: ZoneAccessEffect[] = [];
    for (const { effect } of permissions) {
      if (effect !== ZoneAccessEffect.ALLOW && effect !== ZoneAccessEffect.DENY)
        return unavailable();
      effects.push(effect);
    }
    return this.policy.authorizeActivePermissions(worker.id, effects);
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
