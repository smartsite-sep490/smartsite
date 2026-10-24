// Frozen historical test fixture from Product 587faebbd1e7f9481d485d97ede92d507c51ccce.
// Test-only legacy24 protocol; never import into production modules.
import type { EntityManager } from 'typeorm';
import { ContractorEntity } from './entities/contractor.entity.js';
import { ContractorSiteParticipationEntity } from './entities/contractor-site-participation.entity.js';

export async function hasActiveContractorParticipation(
  manager: EntityManager,
  contractorId: string,
  siteId: string,
  at = new Date(),
): Promise<boolean> {
  // The caller may supply a transaction manager backed by one pg connection.
  const contractor = await manager
    .getRepository(ContractorEntity)
    .findOneBy({ id: contractorId, isActive: true });
  const participations = await manager.getRepository(ContractorSiteParticipationEntity).findBy({
    contractorId,
    siteId,
    isActive: true,
  });
  return (
    !!contractor &&
    participations.some(
      ({ validFrom, validUntil }) =>
        validFrom.getTime() <= at.getTime() &&
        (validUntil === null || validUntil.getTime() > at.getTime()),
    )
  );
}
