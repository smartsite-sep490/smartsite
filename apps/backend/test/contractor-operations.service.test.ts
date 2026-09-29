import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EntityManager } from 'typeorm';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { ContractorEntity } from '../src/database/entities/contractor.entity.js';
import { ContractorRepresentativeGrantEntity } from '../src/database/entities/contractor-representative-grant.entity.js';
import { ContractorSiteParticipationEntity } from '../src/database/entities/contractor-site-participation.entity.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import { WorkerEntity } from '../src/database/entities/worker.entity.js';
import {
  ContractorOperationsService,
  type WorkforceActor,
} from '../src/modules/workforce/contractor-operations.service.js';

const IDs = {
  actor: '00000000-0000-4000-8000-000000000001',
  contractor: '00000000-0000-4000-8000-000000000002',
  site: '00000000-0000-4000-8000-000000000003',
};

function representative(): WorkforceActor {
  return {
    id: IDs.actor,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: IDs.site }],
  };
}

function serviceFor({ hasGrant }: { hasGrant: boolean }) {
  const savedWorkers: Array<Record<string, unknown>> = [];
  const manager = {
    getRepository(target: unknown) {
      if (target === ContractorRepresentativeGrantEntity)
        return { findOneBy: async () => (hasGrant ? { id: 'grant' } : null) };
      if (target === ContractorEntity)
        return { findOneBy: async () => ({ id: IDs.contractor, isActive: true }) };
      if (target === ContractorSiteParticipationEntity)
        return {
          findBy: async () => [
            {
              validFrom: new Date('2020-01-01T00:00:00.000Z'),
              validUntil: null,
            },
          ],
        };
      if (target === WorkerEntity)
        return {
          save: async (value: Record<string, unknown>) => {
            savedWorkers.push(value);
            return value;
          },
        };
      throw new Error('Unexpected repository');
    },
  } as unknown as EntityManager;
  const service = new ContractorOperationsService({
    transaction: async (callback: (transactionManager: EntityManager) => Promise<unknown>) =>
      callback(manager),
  } as never);
  return { service, savedWorkers };
}

test('ContractorOperationsService creates a worker only inside the actor contractor grant and active Site participation', async () => {
  const { service, savedWorkers } = serviceFor({ hasGrant: true });

  await service.createWorker(representative(), IDs.contractor, {
    siteId: IDs.site,
    externalId: 'W-001',
    displayName: 'Worker One',
  });

  assert.equal(savedWorkers.length, 1);
  assert.equal(savedWorkers[0]?.contractorId, IDs.contractor);
  assert.equal(savedWorkers[0]?.siteId, IDs.site);
});

test('ContractorOperationsService denies a representative without a grant for the target contractor', async () => {
  const { service, savedWorkers } = serviceFor({ hasGrant: false });

  await assert.rejects(
    service.createWorker(representative(), IDs.contractor, {
      siteId: IDs.site,
      externalId: 'W-001',
      displayName: 'Worker One',
    }),
    (error: unknown) =>
      error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN',
  );
  assert.equal(savedWorkers.length, 0);
});
