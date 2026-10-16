import { ArrayContains, In, type EntityManager } from 'typeorm';
import { uuid } from '../../common/configuration/commands.js';
import { WorkerEntity } from '../../database/entities/worker.entity.js';
import { ContractorEntity } from '../../database/entities/contractor.entity.js';
import { ContractorSiteParticipationEntity } from '../../database/entities/contractor-site-participation.entity.js';
import {
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
} from '../../database/entities/worker-site-zone-assignment.entity.js';

// Preserve legacy import identity without a second obsolete injectable implementation.
export {
  LinkWorkerAccountCommand,
  WorkforceConfigurationService,
} from './directory/workforce-configuration.service.js';
export type { WorkerReviewReference } from './directory/workforce-configuration.service.js';

export interface ZoneGrantWorkforcePrerequisites {
  siteId: string;
  workerId: string;
  contractorId: string;
  participationIntervals: Array<{
    siteId: string;
    contractorId: string;
    validFrom: Date;
    validUntil: Date | null;
    revokedAt: null;
  }>;
  assignmentIntervals: Array<{
    siteId: string;
    contractorId: string;
    workerId: string;
    zoneId: string;
    validFrom: Date;
    validUntil: Date | null;
    revokedAt: null;
  }>;
}

/** Exported owner query for grant creation only. It cannot establish historical/live identity. */
export async function readZoneGrantWorkforcePrerequisites(
  manager: EntityManager,
  siteId: string,
  zoneId: string,
  workerId: string,
): Promise<ZoneGrantWorkforcePrerequisites | null> {
  const scope = { siteId: uuid(siteId), zoneId: uuid(zoneId), workerId: uuid(workerId) };
  const worker = await manager.getRepository(WorkerEntity).findOne({
    where: { id: scope.workerId, siteId: scope.siteId, isActive: true },
    lock: { mode: 'pessimistic_read' },
  });
  if (!worker?.contractorId) return null;
  const contractor = await manager.getRepository(ContractorEntity).findOne({
    where: { id: worker.contractorId, isActive: true },
    lock: { mode: 'pessimistic_read' },
  });
  if (!contractor) return null;
  const participations = await manager.getRepository(ContractorSiteParticipationEntity).find({
    where: { siteId: scope.siteId, contractorId: contractor.id, isActive: true },
    order: { id: 'ASC' },
    lock: { mode: 'pessimistic_read' },
  });
  const participationById = new Map(participations.map((row) => [row.id, row]));
  const assignments =
    participations.length === 0
      ? []
      : await manager.getRepository(WorkerSiteZoneAssignmentEntity).find({
          where: {
            siteId: scope.siteId,
            workerId: worker.id,
            siteContractorId: In([...participationById.keys()]),
            status: WorkerSiteZoneAssignmentStatus.APPROVED,
            zoneIds: ArrayContains([scope.zoneId]),
          },
          order: { id: 'ASC' },
          lock: { mode: 'pessimistic_read' },
        });
  return {
    siteId: scope.siteId,
    workerId: worker.id,
    contractorId: contractor.id,
    participationIntervals: participations.map((row) => ({
      siteId: row.siteId,
      contractorId: row.contractorId,
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      revokedAt: null,
    })),
    assignmentIntervals: assignments.flatMap((row) => {
      // Main assignments reference a participation row, not a Contractor ID.
      const participation = row.siteContractorId
        ? participationById.get(row.siteContractorId)
        : undefined;
      if (!participation) return [];
      const effectiveFrom =
        row.validFrom.getTime() >= participation.validFrom.getTime()
          ? row.validFrom
          : participation.validFrom;
      const effectiveUntil =
        row.validUntil === null
          ? participation.validUntil
          : participation.validUntil === null
            ? row.validUntil
            : row.validUntil.getTime() <= participation.validUntil.getTime()
              ? row.validUntil
              : participation.validUntil;
      if (effectiveUntil !== null && effectiveFrom.getTime() >= effectiveUntil.getTime()) return [];
      return [
        {
          siteId: row.siteId,
          contractorId: participation.contractorId,
          workerId: row.workerId,
          zoneId: scope.zoneId,
          validFrom: effectiveFrom,
          validUntil: effectiveUntil,
          revokedAt: null,
        },
      ];
    }),
  };
}
