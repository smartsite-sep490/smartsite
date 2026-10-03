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
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
} from '../src/database/entities/worker-site-zone-assignment.entity.js';
import { ZoneEntity } from '../src/database/entities/zone.entity.js';
import {
  ContractorOperationsService,
  type WorkforceActor,
} from '../src/modules/workforce/contractor-operations.service.js';

const IDs = {
  actor: '00000000-0000-4000-8000-000000000001',
  contractor: '00000000-0000-4000-8000-000000000002',
  site: '00000000-0000-4000-8000-000000000003',
  worker: '00000000-0000-4000-8000-000000000004',
  zone: '00000000-0000-4000-8000-000000000005',
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
          findOneBy: async () => null,
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

function enrollmentServiceFor(worker: Partial<WorkerEntity>, actor: WorkforceActor) {
  const manager = {
    getRepository(target: unknown) {
      if (target === WorkerEntity) return { findOneBy: async () => worker };
      throw new Error('Unexpected repository');
    },
  } as unknown as EntityManager;
  const service = new ContractorOperationsService({} as never);
  return service.requireWorkerEnrollmentAccess(manager, actor, worker.id!);
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

test('ContractorOperationsService allows a global admin to enroll an unassigned site worker', async () => {
  const worker = {
    id: '00000000-0000-4000-8000-000000000010',
    siteId: IDs.site,
    contractorId: null,
    isActive: true,
  } as WorkerEntity;
  const result = await enrollmentServiceFor(worker, {
    id: IDs.actor,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  });
  assert.equal(result, worker);
});

test('ContractorOperationsService denies enrollment of an unassigned site worker to an unrelated role', async () => {
  const worker = {
    id: '00000000-0000-4000-8000-000000000010',
    siteId: IDs.site,
    contractorId: null,
    isActive: true,
  } as WorkerEntity;
  await assert.rejects(
    enrollmentServiceFor(worker, representative()),
    (error: unknown) =>
      error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN',
  );
});

function participation(from: string, until: string | null) {
  return {
    validFrom: new Date(from),
    validUntil: until === null ? null : new Date(until),
  };
}

function assignmentServiceFor(participations: ReturnType<typeof participation>[]) {
  const savedAssignments: Array<Record<string, unknown>> = [];
  const manager = {
    getRepository(target: unknown) {
      if (target === ContractorRepresentativeGrantEntity)
        return { findOneBy: async () => ({ id: 'grant' }) };
      if (target === ContractorEntity)
        return { findOneBy: async () => ({ id: IDs.contractor, isActive: true }) };
      if (target === WorkerEntity)
        return {
          findOneBy: async () => ({
            id: IDs.worker,
            contractorId: IDs.contractor,
            siteId: IDs.site,
            isActive: true,
          }),
        };
      if (target === ContractorSiteParticipationEntity)
        return {
          findBy: async (scope: unknown) => {
            assert.deepEqual(scope, {
              contractorId: IDs.contractor,
              siteId: IDs.site,
              isActive: true,
            });
            return participations;
          },
        };
      if (target === ZoneEntity) return { findBy: async () => [{ id: IDs.zone }] };
      if (target === WorkerSiteZoneAssignmentEntity)
        return {
          save: async (value: Record<string, unknown>) => {
            savedAssignments.push(value);
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
  return { service, savedAssignments };
}

const assignmentStart = '2026-10-03T08:00:00.000Z';
const assignmentEnd = '2026-10-03T17:00:00.000Z';

for (const scenario of [
  {
    name: 'assignment outlives contractor participation',
    rows: [participation(assignmentStart, '2026-10-03T10:00:00.000Z')],
    until: assignmentEnd,
  },
  {
    name: 'open-ended assignment has only finite participation',
    rows: [participation(assignmentStart, assignmentEnd)],
    until: null,
  },
  {
    name: 'participation contains a one millisecond gap',
    rows: [
      participation(assignmentStart, '2026-10-03T10:00:00.000Z'),
      participation('2026-10-03T10:00:00.001Z', assignmentEnd),
    ],
    until: assignmentEnd,
  },
  {
    name: 'participation starts after assignment',
    rows: [participation('2026-10-03T09:00:00.000Z', null)],
    until: assignmentEnd,
  },
  {
    name: 'participation ends exactly at assignment start',
    rows: [participation('2026-10-03T07:00:00.000Z', assignmentStart)],
    until: assignmentEnd,
  },
  {
    name: 'there is no active participation',
    rows: [],
    until: assignmentEnd,
  },
  {
    name: 'an invalid participation date accompanies a covering row',
    rows: [participation(assignmentStart, null), participation('invalid', null)],
    until: assignmentEnd,
  },
  {
    name: 'an inverted participation interval accompanies a covering row',
    rows: [participation(assignmentStart, null), participation(assignmentEnd, assignmentStart)],
    until: assignmentEnd,
  },
]) {
  test(`ContractorOperationsService rejects assignment when ${scenario.name}`, async () => {
    const { service, savedAssignments } = assignmentServiceFor(scenario.rows);
    await assert.rejects(
      service.requestAssignment(representative(), IDs.worker, {
        siteId: IDs.site,
        zoneIds: [IDs.zone],
        validFrom: assignmentStart,
        validUntil: scenario.until,
      }),
      (error: unknown) =>
        error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN',
    );
    assert.equal(savedAssignments.length, 0);
  });
}

for (const scenario of [
  {
    name: 'participation covers exactly the requested half-open interval',
    rows: [participation(assignmentStart, assignmentEnd)],
    until: assignmentEnd,
  },
  {
    name: 'unordered adjacent participations cover the full interval',
    rows: [
      participation('2026-10-03T10:00:00.000Z', assignmentEnd),
      participation(assignmentStart, '2026-10-03T10:00:00.000Z'),
    ],
    until: assignmentEnd,
  },
  {
    name: 'overlapping participations cover the full interval',
    rows: [
      participation(assignmentStart, '2026-10-03T12:00:00.000Z'),
      participation('2026-10-03T10:00:00.000Z', assignmentEnd),
    ],
    until: assignmentEnd,
  },
  {
    name: 'finite participation continues into open-ended participation',
    rows: [
      participation(assignmentStart, '2026-10-03T10:00:00.000Z'),
      participation('2026-10-03T10:00:00.000Z', null),
    ],
    until: null,
  },
]) {
  test(`ContractorOperationsService accepts a pending assignment when ${scenario.name}`, async () => {
    const { service, savedAssignments } = assignmentServiceFor(scenario.rows);
    await service.requestAssignment(representative(), IDs.worker, {
      siteId: IDs.site,
      zoneIds: [IDs.zone],
      validFrom: assignmentStart,
      validUntil: scenario.until,
    });
    assert.equal(savedAssignments.length, 1);
    assert.equal(savedAssignments[0]?.status, WorkerSiteZoneAssignmentStatus.PENDING);
    assert.deepEqual(savedAssignments[0]?.validFrom, new Date(assignmentStart));
    assert.deepEqual(
      savedAssignments[0]?.validUntil,
      scenario.until === null ? null : new Date(scenario.until),
    );
  });
}
