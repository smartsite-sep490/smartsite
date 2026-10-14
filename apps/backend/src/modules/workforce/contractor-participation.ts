import type { EntityManager } from 'typeorm';
import { ContractorEntity } from '../../database/entities/contractor.entity.js';
import { ContractorSiteParticipationEntity } from '../../database/entities/contractor-site-participation.entity.js';

export async function hasActiveContractorParticipation(
  manager: EntityManager,
  contractorId: string,
  siteId: string,
  at = new Date(),
): Promise<boolean> {
  // The caller may supply a transaction manager backed by one pg connection.
  const contractor = await manager.getRepository(ContractorEntity)
    .findOneBy({ id: contractorId, isActive: true });
  const participations = await manager.getRepository(ContractorSiteParticipationEntity).findBy({
    contractorId, siteId, isActive: true,
  });
  return !!contractor && participations.some(({ validFrom, validUntil }) =>
    validFrom.getTime() <= at.getTime() &&
    (validUntil === null || validUntil.getTime() > at.getTime()));
}
