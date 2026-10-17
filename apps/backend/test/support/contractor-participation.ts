import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { ContractorSiteParticipationEntity } from '../../src/database/entities/index.js';

/** Organization creation and Site participation are separate business steps. */
export async function participateContractor(
  source: DataSource,
  siteId: string,
  contractorId: string,
) {
  return source.getRepository(ContractorSiteParticipationEntity).save({
    id: randomUUID(),
    siteId,
    contractorId,
    isActive: true,
    validFrom: new Date('2020-01-01T00:00:00Z'),
    validUntil: null,
  });
}
