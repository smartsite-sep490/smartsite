import {
  ContractorEntity,
  ContractorSiteParticipationEntity,
  WorkerEntity,
  WorkerSiteZoneAssignmentEntity,
  ZoneAuthorityFactRevisionEntity,
  ZoneAuthoritySourceKind,
} from '../../database/entities/index.js';
import { uuid } from '../../common/configuration/commands.js';
import {
  AUTHORITY_HISTORY_FACT_LIMIT,
  AuthorityHistoryLimitError,
  type WorkforceAuthorityHistoryQuery,
  type AuthorityHistoryRow,
} from '../zones/zone-authority-reader.port.js';
import {
  contractorFact,
  participationFact,
  workerMembershipFact,
  assignmentFact,
} from './workforce-authority-history.js';

/** Owner read only; does not certify historical completeness or live identity. */
export const readWorkforceZoneAuthorityHistory: WorkforceAuthorityHistoryQuery = async (
  manager,
  input,
) => {
  const siteId = uuid(input.siteId),
    workerId = uuid(input.workerId);
  const contractorId = input.contractorId === undefined ? undefined : uuid(input.contractorId);
  // All queries share the caller manager. No active/current-Site filter can hide movement.
  const worker = await manager.getRepository(WorkerEntity).findOneBy({ id: workerId });
  const assignments = await manager
    .getRepository(WorkerSiteZoneAssignmentEntity)
    .find({ where: { workerId }, take: AUTHORITY_HISTORY_FACT_LIMIT + 1, order: { id: 'ASC' } });
  const participations = contractorId
    ? await manager.getRepository(ContractorSiteParticipationEntity).find({
        where: { siteId, contractorId },
        take: AUTHORITY_HISTORY_FACT_LIMIT + 1,
        order: { id: 'ASC' },
      })
    : [];
  const contractor = contractorId
    ? await manager.getRepository(ContractorEntity).findOneBy({ id: contractorId })
    : null;
  if (
    assignments.length + participations.length + (worker ? 1 : 0) + (contractor ? 1 : 0) >
    AUTHORITY_HISTORY_FACT_LIMIT
  )
    throw new AuthorityHistoryLimitError();
  const at = new Date(0); // Used only by projection helpers; never serialized as historical time.
  const sources = [
    ...(worker ? [workerMembershipFact(worker, at)] : []),
    ...assignments.map((row) => assignmentFact(row, at)),
    ...(contractor ? [contractorFact(contractor, at)] : []),
    ...participations.map((row) => participationFact(row, at)),
  ].map(({ sourceKind, sourceId, siteId: sourceSite, payload }) => ({
    sourceKind,
    sourceId,
    siteId: sourceSite,
    payload,
  }));
  const query = manager
    .getRepository(ZoneAuthorityFactRevisionEntity)
    .createQueryBuilder('fact')
    .where('(fact.sourceKind = :membership AND fact.sourceId = :workerId)', {
      membership: ZoneAuthoritySourceKind.WORKER_MEMBERSHIP,
      workerId,
    })
    .orWhere(
      "(fact.sourceKind = :assignment AND fact.payload->>'workerId' = CAST(:workerId AS text))",
      { assignment: ZoneAuthoritySourceKind.ASSIGNMENT },
    );
  if (assignments.length)
    query.orWhere('(fact.sourceKind = :assignment AND fact.sourceId IN (:...assignmentIds))', {
      assignmentIds: assignments.map((row) => row.id),
    });
  if (contractorId) {
    query
      .orWhere('(fact.sourceKind = :contractor AND fact.sourceId = :contractorId)', {
        contractor: ZoneAuthoritySourceKind.CONTRACTOR_STATE,
        contractorId,
      })
      .orWhere(
        "(fact.sourceKind = :participation AND fact.siteId = :siteId AND fact.payload->>'contractorId' = CAST(:contractorId AS text))",
        { participation: ZoneAuthoritySourceKind.PARTICIPATION, siteId },
      );
    if (participations.length)
      query.orWhere(
        '(fact.sourceKind = :participation AND fact.sourceId IN (:...participationIds))',
        { participationIds: participations.map((row) => row.id) },
      );
  }
  const facts = await query
    .orderBy('fact.sourceKind', 'ASC')
    .addOrderBy('fact.sourceId', 'ASC')
    .addOrderBy('fact.revision', 'ASC')
    .take(AUTHORITY_HISTORY_FACT_LIMIT + 1)
    .getMany();
  if (facts.length > AUTHORITY_HISTORY_FACT_LIMIT) throw new AuthorityHistoryLimitError();
  // Registry persistence envelope is returned through this explicit owner query.
  // The Zone assembler must validate closed payloads and source/command coverage.
  return { facts: facts as AuthorityHistoryRow[], sources };
};
