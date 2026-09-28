import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { WorkerEntity } from '../../database/entities/worker.entity.js';
import { ZoneAccessGrantEntity } from '../../database/entities/zone-access-grant.entity.js';
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

    const grants = await manager.getRepository(ZoneAccessGrantEntity).findBy({
      siteId: input.siteId,
      zoneId: input.zoneId,
      workerId: worker.id,
    });
    return this.policy.authorizeZoneEntry(
      { restrictionPolicy },
      {
        candidateWorkerId: input.candidateWorkerId ?? worker.externalId,
        workerId: worker.id,
        evaluatedAt: input.evaluatedAt,
        authorizationDataAvailable: true,
        grants,
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
