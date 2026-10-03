import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type {
  ContractorEntity,
  ContractorSiteParticipationEntity,
  WorkerEntity,
  WorkerSiteZoneAssignmentEntity,
} from '../../database/entities/index.js';
import { ZoneAuthoritySourceKind } from '../../database/entities/zone-authority-fact-revision.entity.js';
import {
  executeZoneAuthorityCommand,
  type ZoneAuthorityActor,
  type ZoneAuthorityFact,
} from '../zones/zone-authority-history.js';

/** Shared only by existing Workforce writers; returns their projection after audit commits. */
export async function writeWorkforceAuthority<T>(
  source: DataSource,
  actor: ZoneAuthorityActor,
  operation: string,
  request: Record<string, unknown>,
  mutate: (
    manager: EntityManager,
    effectiveFrom: Date,
  ) => Promise<{ result: T; facts: readonly ZoneAuthorityFact[] }>,
): Promise<T> {
  let output: { result: T } | undefined;
  await executeZoneAuthorityCommand(
    source,
    { commandId: randomUUID(), operation, actor, request },
    async (manager) => {
      const clock: { now: Date }[] = await manager.query('SELECT statement_timestamp() AS now');
      const value = await mutate(manager, clock[0]!.now);
      output = { result: value.result };
      return value.facts;
    },
  );
  if (!output) throw new Error('Workforce authority command did not produce a projection');
  return output.result;
}

export function contractorFact(row: ContractorEntity, effectiveFrom: Date): ZoneAuthorityFact {
  return {
    sourceKind: ZoneAuthoritySourceKind.CONTRACTOR_STATE,
    sourceId: row.id,
    siteId: null,
    effectiveFrom,
    effectiveTo: null,
    payload: { contractorId: row.id, isActive: row.isActive },
  };
}
export function participationFact(
  row: ContractorSiteParticipationEntity,
  effectiveFrom: Date,
): ZoneAuthorityFact {
  return {
    sourceKind: ZoneAuthoritySourceKind.PARTICIPATION,
    sourceId: row.id,
    siteId: row.siteId,
    effectiveFrom,
    effectiveTo: null,
    payload: {
      participationId: row.id,
      siteId: row.siteId,
      contractorId: row.contractorId,
      isActive: row.isActive,
      validFrom: row.validFrom.toISOString(),
      validUntil: row.validUntil?.toISOString() ?? null,
    },
  };
}
export function workerMembershipFact(row: WorkerEntity, effectiveFrom: Date): ZoneAuthorityFact {
  return {
    sourceKind: ZoneAuthoritySourceKind.WORKER_MEMBERSHIP,
    sourceId: row.id,
    siteId: row.siteId,
    effectiveFrom,
    effectiveTo: null,
    payload: {
      workerId: row.id,
      siteId: row.siteId,
      contractorId: row.contractorId ?? null,
      isActive: row.isActive,
    },
  };
}
export function assignmentFact(
  row: WorkerSiteZoneAssignmentEntity,
  effectiveFrom: Date,
): ZoneAuthorityFact {
  return {
    sourceKind: ZoneAuthoritySourceKind.ASSIGNMENT,
    sourceId: row.id,
    siteId: row.siteId,
    effectiveFrom,
    effectiveTo: null,
    payload: {
      assignmentId: row.id,
      workerId: row.workerId,
      siteId: row.siteId,
      contractorId: row.contractorId ?? null,
      zoneIds: row.zoneIds,
      status: row.status,
      validFrom: row.validFrom.toISOString(),
      validUntil: row.validUntil?.toISOString() ?? null,
    },
  };
}
