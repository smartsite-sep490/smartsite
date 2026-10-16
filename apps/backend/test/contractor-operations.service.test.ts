import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import type { MainConfigurationCommandContext } from '../src/common/configuration/main-configuration-authority.js';
import { AccessAuditEntity } from '../src/database/entities/access-audit.entity.js';
import { ContractorEntity } from '../src/database/entities/contractor.entity.js';
import { ContractorRepresentativeGrantEntity } from '../src/database/entities/contractor-representative-grant.entity.js';
import { ContractorSiteParticipationEntity } from '../src/database/entities/contractor-site-participation.entity.js';
import { SiteEntity } from '../src/database/entities/site.entity.js';
import { UserEntity, UserRole } from '../src/database/entities/user.entity.js';
import { UserRoleAssignmentEntity } from '../src/database/entities/user-role-assignment.entity.js';
import { WorkerEntity } from '../src/database/entities/worker.entity.js';
import {
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
} from '../src/database/entities/worker-site-zone-assignment.entity.js';
import { ZoneEntity } from '../src/database/entities/zone.entity.js';
import {
  ContractorOperationsService,
  type WorkforceActor,
} from '../src/modules/workforce/directory/contractor-operations.service.js';
import { MainWorkforceCreateService } from '../src/modules/workforce/main-workforce-create.service.js';
import { MainAssignmentCommandService } from '../src/modules/zones/main-assignment-command.service.js';

const IDs = {
  actor: '00000000-0000-4000-8000-000000000001',
  contractor: '00000000-0000-4000-8000-000000000002',
  site: '00000000-0000-4000-8000-000000000003',
  worker: '00000000-0000-4000-8000-000000000004',
  zone: '00000000-0000-4000-8000-000000000005',
  otherSite: '00000000-0000-4000-8000-000000000006',
  participation: '00000000-0000-4000-8000-000000000007',
  otherContractor: '00000000-0000-4000-8000-000000000008',
  representativeUser: '00000000-0000-4000-8000-000000000009',
  assignment: '00000000-0000-4000-8000-000000000011',
  command1: '00000000-0000-4000-8000-000000000021',
  command2: '00000000-0000-4000-8000-000000000022',
};

const assignmentStart = '2099-10-03T08:00:00.000Z';
const assignmentEnd = '2099-10-03T17:00:00.000Z';
const fixedClockIso = '2099-10-03T09:00:00.000Z';

function dataSourceFor(
  manager: EntityManager,
  options?: {
    onSourceQuery?: (sql: string, params: unknown[]) => Promise<unknown>;
    onTransaction?: (isolation: string) => void;
  },
): DataSource {
  return {
    manager: {
      query: async (sql: string) => {
        assert.match(sql, /pg_class.*JOIN pg_namespace/s);
        return []; // Explicit historical profile; canonical guards use real PostgreSQL tests.
      },
    },
    transaction: async <T>(
      isolationOrWork: string | ((tx: EntityManager) => Promise<T>),
      maybeWork?: (tx: EntityManager) => Promise<T>,
    ): Promise<T> => {
      const isolation = typeof isolationOrWork === 'string' ? isolationOrWork : 'DEFAULT';
      const work = typeof isolationOrWork === 'function' ? isolationOrWork : maybeWork!;
      options?.onTransaction?.(isolation);
      return work(manager);
    },
    getRepository: (target: unknown) => manager.getRepository(target as never),
    query: async (sql: string, params: unknown[] = []) => {
      if (options?.onSourceQuery) return options.onSourceQuery(sql, params);
      throw new Error(`Unexpected DataSource.query: ${sql}`);
    },
  } as unknown as DataSource;
}

function globalAdmin(): WorkforceActor {
  return {
    id: IDs.actor,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  };
}

function representative(): WorkforceActor {
  return {
    id: IDs.actor,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: IDs.site }],
  };
}

function safetyOfficer(): WorkforceActor {
  return {
    id: IDs.actor,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SAFETY_OFFICER, siteId: IDs.site }],
  };
}

function siteManager(): WorkforceActor {
  return {
    id: IDs.actor,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: IDs.site }],
  };
}

function participation(
  from: string,
  until: string | null,
  id: string = IDs.participation,
  contractorId: string = IDs.contractor,
) {
  return {
    id,
    contractorId,
    siteId: IDs.site,
    isActive: true,
    validFrom: new Date(from),
    validUntil: until === null ? null : new Date(until),
  };
}

function workerCreationServiceFor({
  hasGrant,
  contractorActive = true,
  participations = [participation('2020-01-01T00:00:00.000Z', null)],
}: {
  hasGrant: boolean;
  contractorActive?: boolean;
  participations?: ReturnType<typeof participation>[];
}) {
  const savedWorkers: Array<Record<string, unknown>> = [];
  const locks: string[] = [];
  const lookups: string[] = [];
  const manager = {
    getRepository(target: unknown) {
      if (target === ContractorRepresentativeGrantEntity)
        return {
          findOneBy: async () => {
            lookups.push('grant:findOneBy');
            return hasGrant ? { id: 'grant' } : null;
          },
          findOne: async (options: { lock?: { mode?: string } }) => {
            lookups.push('grant:findOne');
            if (options.lock?.mode) locks.push(`grant:${options.lock.mode}`);
            return hasGrant ? { id: 'grant' } : null;
          },
        };
      if (target === ContractorEntity)
        return {
          findOneBy: async () => {
            lookups.push('contractor:findOneBy');
            return contractorActive
              ? { id: IDs.contractor, isActive: true }
              : { id: IDs.contractor, isActive: false };
          },
          findOne: async (options: { lock?: { mode?: string } }) => {
            lookups.push('contractor:findOne');
            if (options.lock?.mode) locks.push(`contractor:${options.lock.mode}`);
            return contractorActive
              ? { id: IDs.contractor, isActive: true }
              : { id: IDs.contractor, isActive: false };
          },
        };
      if (target === ContractorSiteParticipationEntity)
        return {
          findBy: async () => {
            lookups.push('participation:findBy');
            return participations;
          },
          find: async (options: { lock?: { mode?: string } }) => {
            lookups.push('participation:find');
            if (options.lock?.mode) locks.push(`participation:${options.lock.mode}`);
            return participations;
          },
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
  const service = new ContractorOperationsService(dataSourceFor(manager));
  return { service, manager, savedWorkers, locks, lookups };
}

function enrollmentServiceFor(worker: Partial<WorkerEntity>, actor: WorkforceActor) {
  const manager = {
    getRepository(target: unknown) {
      if (target === WorkerEntity) return { findOneBy: async () => worker };
      throw new Error('Unexpected repository');
    },
  } as unknown as EntityManager;
  const service = new ContractorOperationsService(dataSourceFor(manager));
  return service.requireWorkerEnrollmentAccess(manager, actor, worker.id!);
}

test('ContractorOperationsService assertAdmin allows only global ADMIN without mustChangePassword for contractor, participation, and representative commands', async () => {
  const savedContractors: Array<Record<string, unknown>> = [];
  const savedParticipations: Array<Record<string, unknown>> = [];
  const savedGrants: Array<Record<string, unknown>> = [];
  const manager = {
    getRepository(target: unknown) {
      if (target === ContractorEntity)
        return {
          findOneBy: async (where: { code?: string; id?: string }) =>
            where.id ? { id: IDs.contractor, code: 'CTR-01', isActive: true } : null,
          save: async (value: Record<string, unknown>) => {
            savedContractors.push(value);
            return value;
          },
        };
      if (target === SiteEntity)
        return {
          findOneBy: async () => ({ id: IDs.site, isActive: true }),
        };
      if (target === ContractorSiteParticipationEntity)
        return {
          save: async (value: Record<string, unknown>) => {
            savedParticipations.push(value);
            return value;
          },
        };
      if (target === UserEntity)
        return {
          findOneBy: async () => ({ id: IDs.representativeUser, isActive: true }),
        };
      if (target === UserRoleAssignmentEntity)
        return {
          findBy: async () => [
            {
              userId: IDs.representativeUser,
              role: UserRole.CONTRACTOR_REPRESENTATIVE,
              siteId: IDs.site,
            },
          ],
        };
      if (target === ContractorRepresentativeGrantEntity)
        return {
          findOneBy: async () => null,
          save: async (value: Record<string, unknown>) => {
            savedGrants.push(value);
            return value;
          },
        };
      throw new Error('Unexpected repository');
    },
  } as unknown as EntityManager;
  const service = new ContractorOperationsService(dataSourceFor(manager));

  for (const nonAdmin of [
    siteManager(),
    representative(),
    {
      id: IDs.actor,
      mustChangePassword: false,
      roleAssignments: [{ role: UserRole.ADMIN, siteId: IDs.site }],
    },
  ]) {
    await assert.rejects(
      service.createContractor(nonAdmin, { code: 'CTR-01', name: 'Alpha Contractor' }),
      (error: unknown) =>
        error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN',
    );
    await assert.rejects(
      service.createParticipation(nonAdmin, IDs.contractor, {
        siteId: IDs.site,
        validFrom: assignmentStart,
        validUntil: assignmentEnd,
      }),
      (error: unknown) =>
        error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN',
    );
    await assert.rejects(
      service.grantRepresentative(nonAdmin, IDs.contractor, { userId: IDs.representativeUser }),
      (error: unknown) =>
        error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN',
    );
  }

  await assert.rejects(
    service.createContractor(
      { ...globalAdmin(), mustChangePassword: true },
      { code: 'CTR-01', name: 'Alpha Contractor' },
    ),
    (error: unknown) =>
      error instanceof PublicHttpException &&
      error.publicPayload.code === 'PASSWORD_CHANGE_REQUIRED',
  );

  await service.createContractor(globalAdmin(), { code: 'CTR-01', name: 'Alpha Contractor' });
  await service.createParticipation(globalAdmin(), IDs.contractor, {
    siteId: IDs.site,
    validFrom: assignmentStart,
    validUntil: assignmentEnd,
  });
  await service.grantRepresentative(globalAdmin(), IDs.contractor, {
    userId: IDs.representativeUser,
  });

  assert.equal(savedContractors.length, 1);
  assert.equal(savedParticipations.length, 1);
  assert.equal(savedGrants.length, 1);
});

test('ContractorOperationsService creates a worker only inside the actor contractor grant and active Site participation', async () => {
  const { service, savedWorkers, lookups } = workerCreationServiceFor({ hasGrant: true });

  await service.createWorker(representative(), IDs.contractor, {
    siteId: IDs.site,
    externalId: 'W-001',
    displayName: 'Worker One',
  });

  assert.equal(savedWorkers.length, 1);
  assert.equal(savedWorkers[0]?.contractorId, IDs.contractor);
  assert.equal(savedWorkers[0]?.siteId, IDs.site);
  assert.deepEqual(lookups, ['grant:findOneBy', 'contractor:findOneBy', 'participation:findBy']);
});

test('ContractorOperationsService denies a representative without a grant for the target contractor', async () => {
  const { service, savedWorkers, lookups } = workerCreationServiceFor({ hasGrant: false });

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
  assert.deepEqual(lookups, ['grant:findOneBy']);
});

test('ContractorOperationsService requireWorkerCreationAccess acquires pessimistic_read locks when requested by workforce coordinator', async () => {
  const { service, manager, locks } = workerCreationServiceFor({ hasGrant: true });

  await service.requireWorkerCreationAccess(
    manager,
    representative(),
    IDs.contractor,
    IDs.site,
    true,
  );

  assert.deepEqual(locks, [
    'grant:pessimistic_read',
    'contractor:pessimistic_read',
    'participation:pessimistic_read',
  ]);
});

test('ContractorOperationsService allows a global admin to enroll an unassigned site worker', async () => {
  const worker = {
    id: '00000000-0000-4000-8000-000000000010',
    siteId: IDs.site,
    contractorId: null,
    isActive: true,
  } as WorkerEntity;
  const result = await enrollmentServiceFor(worker, globalAdmin());
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

function domainAssignmentServiceFor(options: {
  participations: ReturnType<typeof participation>[];
  hasGrant?: boolean;
  contractorActive?: boolean;
  workerActive?: boolean;
  zones?: Array<{ id: string }>;
}) {
  const savedAssignments: Array<Record<string, unknown>> = [];
  const savedAudits: Array<Record<string, unknown>> = [];
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const lookups: string[] = [];
  const manager = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return [];
    },
    getRepository(target: unknown) {
      if (target === ContractorRepresentativeGrantEntity)
        return {
          findOneBy: async () => {
            lookups.push('grant:findOneBy');
            return options.hasGrant === false ? null : { id: 'grant' };
          },
        };
      if (target === ContractorEntity)
        return {
          findOneBy: async () => {
            lookups.push('contractor:findOneBy');
            return options.contractorActive === false
              ? { id: IDs.contractor, isActive: false }
              : { id: IDs.contractor, isActive: true };
          },
        };
      if (target === WorkerEntity)
        return {
          findOneBy: async () => {
            lookups.push('worker:findOneBy');
            return {
              id: IDs.worker,
              contractorId: IDs.contractor,
              siteId: IDs.site,
              isActive: options.workerActive ?? true,
            };
          },
        };
      if (target === ContractorSiteParticipationEntity)
        return {
          findBy: async (scope: unknown) => {
            lookups.push('participation:findBy');
            assert.deepEqual(scope, {
              contractorId: IDs.contractor,
              siteId: IDs.site,
              isActive: true,
            });
            return options.participations;
          },
          findOneBy: async (scope: unknown) => {
            lookups.push('participation:findOneBy');
            assert.deepEqual(scope, {
              contractorId: IDs.contractor,
              siteId: IDs.site,
              isActive: true,
            });
            return options.participations[0] ?? null;
          },
        };
      if (target === ZoneEntity)
        return {
          findBy: async () => {
            lookups.push('zone:findBy');
            return options.zones ?? [{ id: IDs.zone }];
          },
        };
      if (target === WorkerSiteZoneAssignmentEntity)
        return {
          save: async (value: Record<string, unknown>) => {
            savedAssignments.push(value);
            return value;
          },
        };
      if (target === AccessAuditEntity)
        return {
          save: async (value: Record<string, unknown>) => {
            savedAudits.push(value);
            return value;
          },
        };
      throw new Error('Unexpected repository');
    },
  } as unknown as EntityManager;
  const service = new ContractorOperationsService(dataSourceFor(manager));
  return { service, savedAssignments, savedAudits, queries, lookups };
}

test('ContractorOperationsService requestAssignment records version 1 PENDING assignment and WORKER_ASSIGNMENT_REQUESTED audit without bumping site policy version', async () => {
  const { service, savedAssignments, savedAudits, queries, lookups } = domainAssignmentServiceFor({
    participations: [participation(assignmentStart, assignmentEnd)],
  });

  const created = await service.requestAssignment(representative(), IDs.worker, {
    siteId: IDs.site,
    zoneIds: [IDs.zone],
    validFrom: assignmentStart,
    validUntil: assignmentEnd,
  });

  assert.equal(savedAssignments.length, 1);
  assert.equal(created.status, WorkerSiteZoneAssignmentStatus.PENDING);
  assert.equal(created.version, 1);
  assert.equal(created.siteContractorId, IDs.participation);
  assert.deepEqual(lookups, [
    'worker:findOneBy',
    'grant:findOneBy',
    'contractor:findOneBy',
    'participation:findBy',
    'participation:findOneBy',
    'zone:findBy',
  ]);
  assert.equal(savedAudits.length, 1);
  assert.equal(savedAudits[0]?.actorAccountId, IDs.actor);
  assert.equal(savedAudits[0]?.siteId, IDs.site);
  assert.equal(savedAudits[0]?.action, 'WORKER_ASSIGNMENT_REQUESTED');
  assert.equal(savedAudits[0]?.entityType, 'worker_assignment');
  assert.equal(savedAudits[0]?.entityId, created.id);
  assert.equal(savedAudits[0]?.reason, null);
  assert.deepEqual(savedAudits[0]?.changes, {
    workerId: IDs.worker,
    siteContractorId: IDs.participation,
  });
  assert.equal(queries.length, 0);
});

for (const scenario of [
  {
    name: 'participation starts after assignment start',
    participations: [participation('2099-10-03T09:00:00.000Z', assignmentEnd)],
    until: assignmentEnd,
    expectedCode: 'FORBIDDEN',
    expectedLookup: 'participation:findBy',
  },
  {
    name: 'participation ends exactly at assignment start',
    participations: [participation('2099-10-03T07:00:00.000Z', assignmentStart)],
    until: assignmentEnd,
    expectedCode: 'FORBIDDEN',
    expectedLookup: 'participation:findBy',
  },
  {
    name: 'there is no active participation',
    participations: [],
    until: assignmentEnd,
    expectedCode: 'FORBIDDEN',
    expectedLookup: 'participation:findBy',
  },
  {
    name: 'assignment outlives contractor participation',
    participations: [participation(assignmentStart, '2099-10-03T10:00:00.000Z')],
    until: assignmentEnd,
    expectedCode: 'CONFLICT',
    expectedLookup: 'participation:findOneBy',
  },
  {
    name: 'assignment omits required expiry validUntil',
    participations: [participation(assignmentStart, assignmentEnd)],
    until: null,
    expectedCode: 'CONFLICT',
    expectedLookup: null,
  },
]) {
  test(`ContractorOperationsService requestAssignment rejects when ${scenario.name}`, async () => {
    const { service, savedAssignments, savedAudits, lookups } = domainAssignmentServiceFor({
      participations: scenario.participations,
    });

    await assert.rejects(
      service.requestAssignment(representative(), IDs.worker, {
        siteId: IDs.site,
        zoneIds: [IDs.zone],
        validFrom: assignmentStart,
        validUntil: scenario.until,
      }),
      (error: unknown) =>
        error instanceof PublicHttpException && error.publicPayload.code === scenario.expectedCode,
    );
    if (scenario.expectedLookup) {
      assert.ok(
        lookups.includes(scenario.expectedLookup),
        `Expected domain lookup ${scenario.expectedLookup} in [${lookups.join(', ')}]`,
      );
    }
    assert.equal(savedAssignments.length, 0);
    assert.equal(savedAudits.length, 0);
  });
}

function domainReviewFixtureFor(options: {
  status: WorkerSiteZoneAssignmentStatus;
  version?: number;
  validUntil?: string | null;
  workerActive?: boolean;
  missingWorker?: boolean;
  workerContractorId?: string | null;
  participationRow?: ReturnType<typeof participation> | null;
}) {
  const request = {
    id: IDs.zone,
    workerId: IDs.worker,
    siteId: IDs.site,
    siteContractorId: IDs.participation,
    zoneIds: [IDs.zone],
    version: options.version ?? 1,
    status: options.status,
    validFrom: new Date(assignmentStart),
    validUntil: options.validUntil === null ? null : new Date(options.validUntil ?? assignmentEnd),
    requestedByUserId: IDs.actor,
    safetyReviewedByUserId: null as string | null,
    siteManagerDecidedByUserId: null as string | null,
    reviewedAt: null as Date | null,
    reviewNote: null as string | null,
  };
  let saves = 0;
  const savedAudits: Array<Record<string, unknown>> = [];
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const lookups: string[] = [];
  const defaultParticipation =
    options.participationRow === undefined
      ? participation(assignmentStart, assignmentEnd)
      : options.participationRow;

  const manager = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return [];
    },
    getRepository(target: unknown) {
      if (target === WorkerSiteZoneAssignmentEntity) {
        const builder = {
          setLock: (mode: string) => {
            lookups.push(`assignment:lock:${mode}`);
            return builder;
          },
          where: () => builder,
          getOne: async () => request,
        };
        return {
          createQueryBuilder: () => builder,
          findOne: async (opts?: { lock?: { mode?: string } }) => {
            if (opts?.lock?.mode) lookups.push(`assignment:lock:${opts.lock.mode}`);
            return request;
          },
          save: async (value: unknown) => {
            saves++;
            return value;
          },
        };
      }
      if (target === WorkerEntity)
        return {
          findOneBy: async () => {
            lookups.push('worker:findOneBy');
            if (options.missingWorker || options.workerActive === false) return null;
            return {
              id: IDs.worker,
              siteId: IDs.site,
              contractorId:
                options.workerContractorId === undefined
                  ? IDs.contractor
                  : options.workerContractorId,
              isActive: true,
            };
          },
        };
      if (target === ContractorSiteParticipationEntity)
        return {
          findOneBy: async () => {
            lookups.push('participation:findOneBy');
            return defaultParticipation;
          },
        };
      if (target === AccessAuditEntity)
        return {
          save: async (value: Record<string, unknown>) => {
            savedAudits.push(value);
            return value;
          },
        };
      throw new Error('Unexpected repository');
    },
  } as unknown as EntityManager;

  return {
    service: new ContractorOperationsService(dataSourceFor(manager)),
    request,
    saves: () => saves,
    savedAudits,
    queries,
    lookups,
  };
}

test('ContractorOperationsService safetyReview increments version and records WORKER_ASSIGNMENT_SAFETY_REVIEWED audit without bumping site policy version', async () => {
  const fixture = domainReviewFixtureFor({
    status: WorkerSiteZoneAssignmentStatus.PENDING,
    version: 1,
  });

  await fixture.service.safetyReview(safetyOfficer(), IDs.zone);

  assert.equal(fixture.saves(), 1);
  assert.equal(fixture.request.status, WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED);
  assert.equal(fixture.request.safetyReviewedByUserId, IDs.actor);
  assert.equal(fixture.request.version, 2);
  assert.deepEqual(fixture.lookups, ['assignment:lock:pessimistic_write']);
  assert.equal(fixture.savedAudits.length, 1);
  assert.equal(fixture.savedAudits[0]?.actorAccountId, IDs.actor);
  assert.equal(fixture.savedAudits[0]?.siteId, IDs.site);
  assert.equal(fixture.savedAudits[0]?.action, 'WORKER_ASSIGNMENT_SAFETY_REVIEWED');
  assert.equal(fixture.savedAudits[0]?.entityType, 'worker_assignment');
  assert.equal(fixture.savedAudits[0]?.entityId, IDs.zone);
  assert.equal(fixture.savedAudits[0]?.reason, null);
  assert.deepEqual(fixture.savedAudits[0]?.changes, { version: 2 });
  assert.equal(fixture.queries.length, 0);
});

for (const scenario of [
  { name: 'worker was disabled', workerActive: false },
  { name: 'worker is missing', missingWorker: true },
  {
    name: 'worker contractor no longer matches participation contractor',
    workerContractorId: IDs.otherContractor,
  },
  { name: 'participation was withdrawn', participationRow: null },
  {
    name: 'participation was shortened before assignment end',
    participationRow: participation(assignmentStart, '2099-10-03T10:00:00.000Z'),
  },
  {
    name: 'participation starts after assignment start',
    participationRow: participation('2099-10-03T09:00:00.000Z', assignmentEnd),
  },
  {
    name: 'assignment validity has already expired',
    validUntil: '2020-01-01T00:00:00.000Z',
  },
]) {
  test(`ContractorOperationsService siteManagerDecision approval revalidates and rejects when ${scenario.name}`, async () => {
    const fixture = domainReviewFixtureFor({
      status: WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED,
      ...scenario,
    });

    await assert.rejects(
      fixture.service.siteManagerDecision(siteManager(), IDs.zone, { approve: true }),
      (error: unknown) =>
        error instanceof PublicHttpException &&
        error.publicPayload.code === 'CONFLICT' &&
        error.publicPayload.message === 'Assignment participation or validity is unavailable',
    );
    assert.deepEqual(fixture.lookups, [
      'assignment:lock:pessimistic_write',
      'worker:findOneBy',
      'participation:findOneBy',
    ]);
    assert.equal(fixture.saves(), 0);
    assert.equal(fixture.savedAudits.length, 0);
    assert.equal(fixture.queries.length, 0);
    assert.equal(fixture.request.status, WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED);
  });
}

test('ContractorOperationsService siteManagerDecision enforces expectedVersion, increments version, bumps site access_policy_version, and records audit', async () => {
  const fixture = domainReviewFixtureFor({
    status: WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED,
    version: 2,
  });

  await assert.rejects(
    fixture.service.siteManagerDecision(siteManager(), IDs.zone, {
      approve: true,
      expectedVersion: 1,
    }),
    (error: unknown) =>
      error instanceof PublicHttpException &&
      error.publicPayload.code === 'CONFLICT' &&
      error.publicPayload.message === 'Assignment changed. Reload before reviewing',
  );
  assert.equal(fixture.saves(), 0);

  await fixture.service.siteManagerDecision(siteManager(), IDs.zone, {
    approve: true,
    expectedVersion: 2,
    reviewNote: '  Approved for shift  ',
  });

  assert.equal(fixture.saves(), 1);
  assert.equal(fixture.request.status, WorkerSiteZoneAssignmentStatus.APPROVED);
  assert.equal(fixture.request.version, 3);
  assert.equal(fixture.request.siteManagerDecidedByUserId, IDs.actor);
  assert.equal(fixture.request.reviewNote, 'Approved for shift');
  assert.equal(fixture.queries.length, 1);
  assert.match(
    fixture.queries[0]!.sql,
    /UPDATE site SET access_policy_version = access_policy_version \+ 1/,
  );
  assert.deepEqual(fixture.queries[0]!.params, [IDs.site]);
  assert.equal(fixture.savedAudits.length, 1);
  assert.equal(fixture.savedAudits[0]?.actorAccountId, IDs.actor);
  assert.equal(fixture.savedAudits[0]?.siteId, IDs.site);
  assert.equal(fixture.savedAudits[0]?.action, 'WORKER_ASSIGNMENT_REVIEWED');
  assert.equal(fixture.savedAudits[0]?.entityType, 'worker_assignment');
  assert.equal(fixture.savedAudits[0]?.entityId, IDs.zone);
  assert.equal(fixture.savedAudits[0]?.reason, 'Approved for shift');
  assert.deepEqual(fixture.savedAudits[0]?.changes, {
    status: WorkerSiteZoneAssignmentStatus.APPROVED,
    version: 3,
  });
});

test('ContractorOperationsService allows Site Manager to reject an assignment even after participation was withdrawn', async () => {
  const fixture = domainReviewFixtureFor({
    status: WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED,
    participationRow: null,
  });

  await fixture.service.siteManagerDecision(siteManager(), IDs.zone, {
    approve: false,
    reviewNote: 'Participation withdrawn',
  });

  assert.equal(fixture.saves(), 1);
  assert.equal(fixture.request.status, WorkerSiteZoneAssignmentStatus.REJECTED);
  assert.equal(fixture.request.version, 2);
  assert.equal(fixture.queries.length, 1);
  assert.equal(fixture.savedAudits.length, 1);
  assert.equal(fixture.savedAudits[0]?.action, 'WORKER_ASSIGNMENT_REVIEWED');
  assert.equal(fixture.savedAudits[0]?.entityType, 'worker_assignment');
  assert.equal(fixture.savedAudits[0]?.entityId, IDs.zone);
  assert.equal(fixture.savedAudits[0]?.reason, 'Participation withdrawn');
  assert.deepEqual(fixture.savedAudits[0]?.changes, {
    status: WorkerSiteZoneAssignmentStatus.REJECTED,
    version: 2,
  });
});

test('ContractorOperationsService revokeAssignment enforces expectedVersion, bumps access_policy_version, and supports idempotent retry', async () => {
  const fixture = domainReviewFixtureFor({
    status: WorkerSiteZoneAssignmentStatus.APPROVED,
    version: 3,
  });

  await assert.rejects(
    fixture.service.revokeAssignment(siteManager(), IDs.zone, {
      expectedVersion: 2,
      reviewNote: 'Revoke stale',
    }),
    (error: unknown) =>
      error instanceof PublicHttpException &&
      error.publicPayload.code === 'CONFLICT' &&
      error.publicPayload.message === 'Assignment changed or is not approved',
  );
  assert.equal(fixture.saves(), 0);

  const revoked = await fixture.service.revokeAssignment(siteManager(), IDs.zone, {
    expectedVersion: 3,
    reviewNote: 'Shift ended early',
  });

  assert.equal(revoked.status, WorkerSiteZoneAssignmentStatus.REVOKED);
  assert.equal(revoked.version, 4);
  assert.equal(fixture.saves(), 1);
  assert.equal(fixture.queries.length, 1);
  assert.equal(fixture.savedAudits.length, 1);
  assert.equal(fixture.savedAudits[0]?.action, 'WORKER_ASSIGNMENT_REVOKED');
  assert.equal(fixture.savedAudits[0]?.entityType, 'worker_assignment');
  assert.equal(fixture.savedAudits[0]?.entityId, IDs.zone);
  assert.equal(fixture.savedAudits[0]?.reason, 'Shift ended early');
  assert.deepEqual(fixture.savedAudits[0]?.changes, { version: 4 });

  const retried = await fixture.service.revokeAssignment(siteManager(), IDs.zone, {
    expectedVersion: 3,
    reviewNote: 'Shift ended early',
  });

  assert.equal(retried.status, WorkerSiteZoneAssignmentStatus.REVOKED);
  assert.equal(retried.version, 4);
  assert.equal(fixture.saves(), 1);
  assert.equal(fixture.savedAudits.length, 1);
});

interface CoordinatorHarnessOptions {
  status?: WorkerSiteZoneAssignmentStatus;
  version?: number;
  validFrom?: string;
  validUntil?: string | null;
  role?: UserRole;
  actorActive?: boolean;
  actorMustChangePassword?: boolean;
  actorRoleRows?: Array<{ role: UserRole; site_id: string | null }>;
  hasGrant?: boolean;
  workerActive?: boolean;
  missingWorker?: boolean;
  workerSiteId?: string;
  workerContractorId?: string | null;
  contractorActive?: boolean;
  missingContractor?: boolean;
  missingZone?: boolean;
  participations?: ReturnType<typeof participation>[];
  reauthorize?: (manager: EntityManager) => Promise<void>;
}

function coordinatorHarnessFor(options: CoordinatorHarnessOptions = {}) {
  const role = options.role ?? UserRole.SITE_MANAGER;
  const actorActive = options.actorActive ?? true;
  const actorMustChangePassword = options.actorMustChangePassword ?? false;
  const actorRoles = options.actorRoleRows ?? [
    {
      role,
      site_id: role === UserRole.ADMIN ? null : IDs.site,
    },
  ];
  const participations = options.participations ?? [participation(assignmentStart, assignmentEnd)];
  const clockNow = new Date(fixedClockIso);

  const assignmentState = {
    id: IDs.assignment,
    workerId: IDs.worker,
    siteId: IDs.site,
    siteContractorId: IDs.participation as string | null,
    zoneIds: [IDs.zone],
    gateId: null as string | null,
    status: options.status ?? WorkerSiteZoneAssignmentStatus.PENDING,
    version: options.version ?? 1,
    validFrom: options.validFrom ?? assignmentStart,
    validUntil: options.validUntil === undefined ? assignmentEnd : options.validUntil,
    requestedByUserId: IDs.actor,
    safetyReviewedByUserId: null as string | null,
    siteManagerDecidedByUserId: null as string | null,
    reviewedAt: null as string | null,
    reviewNote: null as string | null,
    createdAt: assignmentStart,
  };

  const serializeAssignment = () => ({ ...assignmentState });

  const observedTags: string[] = [];
  const isolations: string[] = [];
  const savedAudits: Array<Record<string, unknown>> = [];
  const savedWorkers: Array<Record<string, unknown>> = [];
  const savedContractors: Array<Record<string, unknown>> = [];
  const witnesses: string[] = [];
  const recordedCommands = new Map<
    string,
    { commandId: string; actor_user_id: string; operation: string; request_hash: string }
  >();
  const commandResults = new Map<
    string,
    { result_json: ReturnType<typeof serializeAssignment>; contractor_id: string | null }
  >();
  let currentCommandId = '';
  let assignmentWrites = 0;
  let policyBumps = 0;

  const manager = {
    query: async (sql: string, params: unknown[] = []) => {
      if (
        sql ===
        'SELECT id FROM app_user WHERE id=$1 AND is_active AND (NOT must_change_password OR $2) FOR SHARE'
      ) {
        observedTags.push('auth:app_user');
        const allowTemp = params[1] === true;
        if (!actorActive || (actorMustChangePassword && !allowTemp)) return [];
        return [{ id: params[0] }];
      }
      if (
        sql ===
        'SELECT id FROM app_user WHERE id=$1 AND is_active AND NOT must_change_password FOR SHARE'
      ) {
        observedTags.push('auth:app_user');
        if (!actorActive || actorMustChangePassword) return [];
        return [{ id: params[0] }];
      }
      if (
        sql ===
        "SELECT id FROM user_role_assignment WHERE user_id=$1 AND role='ADMIN' AND site_id IS NULL FOR SHARE"
      ) {
        observedTags.push('auth:user_role_assignment');
        return actorRoles.some((r) => r.role === UserRole.ADMIN && r.site_id === null)
          ? [{ id: 'admin-role' }]
          : [];
      }
      if (
        sql ===
        "SELECT role,site_id FROM user_role_assignment WHERE user_id=$1 AND ((role='ADMIN' AND site_id IS NULL) OR (role=$2 AND site_id=$3)) FOR SHARE"
      ) {
        observedTags.push('auth:user_role_assignment');
        const targetRole = params[1] as string;
        const targetSite = params[2] as string;
        return actorRoles.filter(
          (r) =>
            (r.role === UserRole.ADMIN && r.site_id === null) ||
            (r.role === targetRole && r.site_id === targetSite),
        );
      }
      if (
        sql ===
        "SELECT role,site_id FROM user_role_assignment WHERE user_id=$1 AND ((role='ADMIN' AND site_id IS NULL) OR (role='CONTRACTOR_REPRESENTATIVE' AND site_id=$2)) FOR SHARE"
      ) {
        observedTags.push('auth:user_role_assignment');
        const targetSite = params[1] as string;
        return actorRoles.filter(
          (r) =>
            (r.role === UserRole.ADMIN && r.site_id === null) ||
            (r.role === UserRole.CONTRACTOR_REPRESENTATIVE && r.site_id === targetSite),
        );
      }
      if (
        sql ===
        'SELECT id FROM contractor_representative_grant WHERE user_id=$1 AND contractor_id=$2 FOR SHARE'
      ) {
        observedTags.push('check:grant_for_share');
        return options.hasGrant === false ? [] : [{ id: 'grant-row' }];
      }
      if (
        sql.includes('FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace') &&
        sql.includes("c.relkind='r'")
      ) {
        observedTags.push('journal:check_relations');
        const requested = (params[0] as string[]) ?? [];
        return [{ n: requested.length }];
      }
      if (sql.includes("SELECT current_setting('session_replication_role')='origin'")) {
        observedTags.push('journal:capture_preflight');
        return [{ valid: true }];
      }
      if (sql === "SELECT current_setting('smartsite.mf06_command_id',true) AS value") {
        observedTags.push('journal:check_nested');
        return [{ value: currentCommandId }];
      }
      if (
        sql ===
        'INSERT INTO mf06_authority_command(command_id,actor_user_id,operation,request_hash) VALUES($1,$2,$3,$4)'
      ) {
        observedTags.push('journal:command_insert');
        const [commandId, actor_user_id, operation, request_hash] = params as [
          string,
          string,
          string,
          string,
        ];
        recordedCommands.set(commandId, { commandId, actor_user_id, operation, request_hash });
        return [];
      }
      if (
        sql ===
        'INSERT INTO mf06_authority_command(command_id,actor_user_id,operation,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT(command_id) DO NOTHING RETURNING command_id'
      ) {
        observedTags.push('journal:command_insert');
        const [commandId, actor_user_id, operation, request_hash] = params as [
          string,
          string,
          string,
          string,
        ];
        if (recordedCommands.has(commandId)) return [];
        recordedCommands.set(commandId, { commandId, actor_user_id, operation, request_hash });
        return [{ command_id: commandId }];
      }
      if (
        sql ===
        'SELECT request_hash,operation,actor_user_id FROM mf06_authority_command WHERE command_id=$1'
      ) {
        observedTags.push('journal:command_lookup');
        const existing = recordedCommands.get(params[0] as string);
        return existing ? [existing] : [];
      }
      if (sql === "SELECT set_config('smartsite.mf06_command_id',$1,true)") {
        currentCommandId = params[0] as string;
        return [];
      }
      if (sql === "SELECT set_config('smartsite.mf06_command_id','',true)") {
        currentCommandId = '';
        return [];
      }
      if (
        sql ===
        'SELECT isfinite($1::timestamptz) AND isfinite($2::timestamptz) AND $2::timestamptz>$1::timestamptz AS valid'
      ) {
        observedTags.push('check:time_range');
        const from = new Date(params[0] as string).getTime();
        const until = new Date(params[1] as string).getTime();
        return [{ valid: Number.isFinite(from) && Number.isFinite(until) && until > from }];
      }
      if (
        sql ===
        'SELECT contractor_id FROM worker WHERE id=$1 AND site_id=$2 AND is_active FOR SHARE'
      ) {
        observedTags.push('check:worker_for_share');
        const workerSite = options.workerSiteId ?? IDs.site;
        if (
          options.missingWorker ||
          options.workerActive === false ||
          params[0] !== IDs.worker ||
          params[1] !== workerSite
        ) {
          return [];
        }
        return [
          {
            contractor_id:
              options.workerContractorId === undefined
                ? IDs.contractor
                : options.workerContractorId,
          },
        ];
      }
      if (sql === 'SELECT id FROM contractor WHERE id=$1 AND is_active FOR SHARE') {
        observedTags.push('check:contractor_for_share');
        if (options.missingContractor || options.contractorActive === false) return [];
        return [{ id: params[0] }];
      }
      if (sql === 'SELECT id,is_active FROM contractor WHERE id=$1 FOR SHARE') {
        observedTags.push('check:contractor_for_share');
        if (options.missingContractor) return [];
        return [{ id: params[0], is_active: options.contractorActive ?? true }];
      }
      if (
        sql ===
        'SELECT id FROM contractor_site_participation WHERE contractor_id=$1 AND site_id=$2 AND is_active AND valid_from<=$3::timestamptz AND (valid_until IS NULL OR valid_until>$3::timestamptz) FOR SHARE'
      ) {
        observedTags.push('check:participation_start_for_share');
        const at = new Date(params[2] as string | Date).getTime();
        return participations
          .filter(
            (row) =>
              row.contractorId === params[0] &&
              row.siteId === params[1] &&
              row.isActive &&
              row.validFrom.getTime() <= at &&
              (row.validUntil === null || row.validUntil.getTime() > at),
          )
          .map((row) => ({ id: row.id }));
      }
      if (
        sql ===
        'SELECT id,($3::timestamptz<=valid_until OR valid_until IS NULL) AS contained FROM contractor_site_participation WHERE contractor_id=$1 AND site_id=$2 AND is_active LIMIT 1 FOR SHARE'
      ) {
        observedTags.push('check:participation_end_for_share');
        const until = new Date(params[2] as string).getTime();
        const first = participations.find(
          (row) => row.contractorId === params[0] && row.siteId === params[1] && row.isActive,
        );
        if (!first) return [];
        return [
          {
            id: first.id,
            contained: first.validUntil === null || until <= first.validUntil.getTime(),
          },
        ];
      }
      if (sql === 'SELECT id FROM zone WHERE site_id=$1 AND id=ANY($2::uuid[]) FOR SHARE') {
        observedTags.push('check:zone_for_share');
        if (options.missingZone || params[0] !== IDs.site) return [];
        return (params[1] as string[]).map((zoneId) => ({ id: zoneId }));
      }
      if (
        sql ===
        "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,zone_ids,site_contractor_id,status,version,valid_from,valid_until,requested_by_user_id) VALUES($1,$2,$3,$4,$5,'PENDING',1,$6,$7,$8)"
      ) {
        observedTags.push('write:assignment_insert');
        assignmentWrites++;
        assignmentState.id = params[0] as string;
        assignmentState.workerId = params[1] as string;
        assignmentState.siteId = params[2] as string;
        assignmentState.zoneIds = params[3] as string[];
        assignmentState.siteContractorId = params[4] as string;
        assignmentState.status = WorkerSiteZoneAssignmentStatus.PENDING;
        assignmentState.version = 1;
        assignmentState.validFrom = params[5] as string;
        assignmentState.validUntil = params[6] as string | null;
        assignmentState.requestedByUserId = params[7] as string;
        return [];
      }
      if (
        sql.includes('FROM worker_site_zone_assignment WHERE id=$1 AND site_id=$2') &&
        sql.includes("jsonb_build_object('id',id")
      ) {
        if (sql.endsWith('FOR UPDATE')) {
          observedTags.push('lock:assignment_for_update');
        } else {
          observedTags.push('read:assignment');
        }
        if (params[0] !== assignmentState.id || params[1] !== assignmentState.siteId) return [];
        return [{ value: serializeAssignment() }];
      }
      if (
        sql ===
        "UPDATE worker_site_zone_assignment SET status='SAFETY_REVIEWED',safety_reviewed_by_user_id=$2,version=version+1 WHERE id=$1"
      ) {
        observedTags.push('write:assignment_update');
        assignmentWrites++;
        assignmentState.status = WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED;
        assignmentState.safetyReviewedByUserId = params[1] as string;
        assignmentState.version += 1;
        return [];
      }
      if (
        sql ===
        'SELECT contractor_id,isfinite(valid_from) AND (valid_until IS NULL OR isfinite(valid_until)) AND valid_from<=$3::timestamptz AND (valid_until IS NULL OR valid_until>=$4::timestamptz) AND isfinite($3::timestamptz) AND isfinite($4::timestamptz) AND $4::timestamptz>clock_timestamp() AS valid FROM contractor_site_participation WHERE id=$1 AND site_id=$2 AND is_active FOR SHARE'
      ) {
        observedTags.push('check:participation_approvable_for_share');
        const row = participations.find(
          (item) => item.id === params[0] && item.siteId === params[1] && item.isActive,
        );
        if (!row) return [];
        const fromTime = new Date(params[2] as string).getTime();
        const untilTime = new Date(params[3] as string).getTime();
        const valid =
          Number.isFinite(fromTime) &&
          Number.isFinite(untilTime) &&
          row.validFrom.getTime() <= fromTime &&
          (row.validUntil === null || row.validUntil.getTime() >= untilTime) &&
          untilTime > clockNow.getTime();
        return [{ contractor_id: row.contractorId, valid }];
      }
      if (
        sql ===
        'UPDATE worker_site_zone_assignment SET status=$2,version=version+1,site_manager_decided_by_user_id=$3,reviewed_at=clock_timestamp(),review_note=$4 WHERE id=$1'
      ) {
        observedTags.push('write:assignment_update');
        assignmentWrites++;
        assignmentState.status = params[1] as WorkerSiteZoneAssignmentStatus;
        assignmentState.version += 1;
        assignmentState.siteManagerDecidedByUserId = params[2] as string;
        assignmentState.reviewedAt = fixedClockIso;
        assignmentState.reviewNote = (params[3] as string | null) ?? null;
        return [];
      }
      if (
        sql ===
        "UPDATE worker_site_zone_assignment SET status='REVOKED',version=version+1,site_manager_decided_by_user_id=$2,reviewed_at=clock_timestamp(),review_note=$3 WHERE id=$1"
      ) {
        observedTags.push('write:assignment_update');
        assignmentWrites++;
        assignmentState.status = WorkerSiteZoneAssignmentStatus.REVOKED;
        assignmentState.version += 1;
        assignmentState.siteManagerDecidedByUserId = params[1] as string;
        assignmentState.reviewedAt = fixedClockIso;
        assignmentState.reviewNote = params[2] as string;
        return [];
      }
      if (sql === 'UPDATE site SET access_policy_version=access_policy_version+1 WHERE id=$1') {
        observedTags.push('write:site_policy_bump');
        policyBumps++;
        return [];
      }
      if (
        sql ===
        "INSERT INTO audit_log(id,actor_account_id,site_id,action,entity_type,entity_id,reason,changes,occurred_at) VALUES($1,$2,$3,$4,'worker_assignment',$5,$6,$7,clock_timestamp())"
      ) {
        observedTags.push('write:audit_log');
        savedAudits.push({
          id: params[0],
          actorAccountId: params[1],
          siteId: params[2],
          action: params[3],
          entityType: 'worker_assignment',
          entityId: params[4],
          reason: params[5],
          changes: params[6],
        });
        return [];
      }
      if (
        sql ===
        "INSERT INTO mf06_assignment_command_result(command_id,source_id,contractor_id,result_json,result_hash) SELECT $1,a.id,p.contractor_id,mf06_assignment_response(a.id),'' FROM worker_site_zone_assignment a LEFT JOIN contractor_site_participation p ON p.id=a.site_contractor_id WHERE a.id=$2"
      ) {
        observedTags.push('journal:command_result_insert');
        const commandId = params[0] as string;
        commandResults.set(commandId, {
          result_json: serializeAssignment(),
          contractor_id: IDs.contractor,
        });
        return [];
      }
      if (
        sql ===
        "SELECT result_json,contractor_id,result_hash=encode(sha256(convert_to(result_json::text,'UTF8')),'hex') AS hash_valid FROM mf06_assignment_command_result WHERE command_id=$1"
      ) {
        observedTags.push('journal:command_result_read');
        const stored = commandResults.get(params[0] as string);
        if (!stored) return [];
        return [
          {
            result_json: stored.result_json,
            contractor_id: stored.contractor_id,
            hash_valid: true,
          },
        ];
      }
      throw new Error(`Unexpected EntityManager SQL query: ${sql}`);
    },
    getRepository(target: unknown) {
      if (target === ContractorEntity)
        return {
          save: async (value: Record<string, unknown>) => {
            observedTags.push('repo:contractor_save');
            savedContractors.push(value);
            return value;
          },
        };
      if (target === WorkerEntity)
        return {
          save: async (value: Record<string, unknown>) => {
            observedTags.push('repo:worker_save');
            savedWorkers.push(value);
            return value;
          },
        };
      throw new Error('Unexpected repository on coordinator manager');
    },
  } as unknown as EntityManager;

  const source = dataSourceFor(manager, {
    onTransaction: (isolation) => {
      isolations.push(isolation);
      observedTags.push(`tx:${isolation}`);
    },
    onSourceQuery: async (sql, params) => {
      if (sql === 'SELECT site_id FROM worker_site_zone_assignment WHERE id=$1') {
        observedTags.push('scope:lookup_assignment_site');
        if (params[0] !== assignmentState.id) return [];
        return [{ site_id: assignmentState.siteId }];
      }
      if (sql.startsWith('INSERT INTO mf06_authority_commit_witness(command_id,transaction_id)')) {
        observedTags.push('journal:commit_witness');
        witnesses.push(params[0] as string);
        return [];
      }
      throw new Error(`Unexpected DataSource SQL query: ${sql}`);
    },
  });

  const context: MainConfigurationCommandContext = {
    actorUserId: IDs.actor,
    reauthorize: async (tx) => {
      observedTags.push('auth:reauthorize_callback');
      await options.reauthorize?.(tx);
    },
  };

  return {
    assignmentService: new MainAssignmentCommandService(source),
    workforceCreateService: new MainWorkforceCreateService(source),
    context,
    assignmentState,
    observedTags,
    isolations,
    savedAudits,
    savedWorkers,
    savedContractors,
    witnesses,
    assignmentWrites: () => assignmentWrites,
    policyBumps: () => policyBumps,
  };
}

test('MainAssignmentCommandService publicRequest accepts a valid assignment inside SERIALIZABLE and records authority command, audit, and witness', async () => {
  const harness = coordinatorHarnessFor({
    role: UserRole.CONTRACTOR_REPRESENTATIVE,
  });

  const created = await harness.assignmentService.publicRequest(
    IDs.worker,
    {
      siteId: IDs.site,
      zoneIds: [IDs.zone],
      validFrom: assignmentStart,
      validUntil: assignmentEnd,
    },
    harness.context,
  );

  assert.deepEqual(harness.isolations, ['SERIALIZABLE']);
  assert.equal(harness.assignmentWrites(), 1);
  assert.equal(created.status, 'PENDING');
  assert.equal(created.version, 1);
  assert.equal(created.siteContractorId, IDs.participation);
  assert.equal(harness.savedAudits.length, 1);
  assert.equal(harness.savedAudits[0]?.action, 'WORKER_ASSIGNMENT_REQUESTED');
  assert.equal(harness.savedAudits[0]?.entityType, 'worker_assignment');
  assert.equal(harness.savedAudits[0]?.entityId, created.id);
  assert.deepEqual(harness.savedAudits[0]?.changes, {
    workerId: IDs.worker,
    siteContractorId: IDs.participation,
  });
  assert.equal(harness.policyBumps(), 0);
  assert.equal(harness.witnesses.length, 1);
});

for (const scenario of [
  {
    name: 'worker was disabled',
    options: { workerActive: false },
    expectedCode: 'FORBIDDEN',
    expectedTag: 'check:worker_for_share',
  },
  {
    name: 'worker is missing',
    options: { missingWorker: true },
    expectedCode: 'FORBIDDEN',
    expectedTag: 'check:worker_for_share',
  },
  {
    name: 'worker now belongs to another Site',
    options: { workerSiteId: IDs.otherSite },
    expectedCode: 'FORBIDDEN',
    expectedTag: 'check:worker_for_share',
  },
  {
    name: 'representative lacks contractor grant',
    options: { hasGrant: false },
    expectedCode: 'FORBIDDEN',
    expectedTag: 'check:grant_for_share',
  },
  {
    name: 'contractor was disabled',
    options: { contractorActive: false },
    expectedCode: 'FORBIDDEN',
    expectedTag: 'check:contractor_for_share',
  },
  {
    name: 'contractor is missing',
    options: { missingContractor: true },
    expectedCode: 'FORBIDDEN',
    expectedTag: 'check:contractor_for_share',
  },
  {
    name: 'participation was withdrawn',
    options: { participations: [] },
    expectedCode: 'FORBIDDEN',
    expectedTag: 'check:participation_start_for_share',
  },
  {
    name: 'participation was shortened before assignment end',
    options: {
      participations: [participation(assignmentStart, '2099-10-03T10:00:00.000Z')],
    },
    expectedCode: 'CONFLICT',
    expectedTag: 'check:participation_end_for_share',
  },
  {
    name: 'zone no longer belongs to the target Site',
    options: { missingZone: true },
    expectedCode: 'FORBIDDEN',
    expectedTag: 'check:zone_for_share',
  },
]) {
  test(`MainAssignmentCommandService publicRequest revalidates and rejects when ${scenario.name}`, async () => {
    const harness = coordinatorHarnessFor({
      role: UserRole.CONTRACTOR_REPRESENTATIVE,
      ...scenario.options,
    });

    await assert.rejects(
      harness.assignmentService.publicRequest(
        IDs.worker,
        {
          siteId: IDs.site,
          zoneIds: [IDs.zone],
          validFrom: assignmentStart,
          validUntil: assignmentEnd,
        },
        harness.context,
      ),
      (error: unknown) =>
        error instanceof PublicHttpException && error.publicPayload.code === scenario.expectedCode,
    );
    assert.ok(
      harness.observedTags.includes('journal:command_insert'),
      `Expected request to pass DTO validation and reach journaled transaction: [${harness.observedTags.join(', ')}]`,
    );
    assert.ok(
      harness.observedTags.includes(scenario.expectedTag),
      `Expected domain SQL check ${scenario.expectedTag} in [${harness.observedTags.join(', ')}]`,
    );
    assert.equal(harness.assignmentWrites(), 0);
    assert.equal(harness.savedAudits.length, 0);
    assert.equal(harness.witnesses.length, 0);
  });
}

test('MainAssignmentCommandService publicSafetyReview transitions PENDING assignment and rejects non-PENDING state with FOR UPDATE lock', async () => {
  const harness = coordinatorHarnessFor({
    role: UserRole.SAFETY_OFFICER,
    status: WorkerSiteZoneAssignmentStatus.PENDING,
    version: 1,
  });

  const reviewed = await harness.assignmentService.publicSafetyReview(
    IDs.assignment,
    harness.context,
  );

  assert.deepEqual(harness.isolations, ['SERIALIZABLE']);
  assert.ok(harness.observedTags.includes('lock:assignment_for_update'));
  assert.equal(harness.assignmentWrites(), 1);
  assert.equal(reviewed.status, 'SAFETY_REVIEWED');
  assert.equal(reviewed.version, 2);
  assert.equal(reviewed.safetyReviewedByUserId, IDs.actor);
  assert.equal(harness.savedAudits.length, 1);
  assert.equal(harness.savedAudits[0]?.action, 'WORKER_ASSIGNMENT_SAFETY_REVIEWED');
  assert.equal(harness.savedAudits[0]?.entityType, 'worker_assignment');
  assert.equal(harness.savedAudits[0]?.entityId, IDs.assignment);
  assert.deepEqual(harness.savedAudits[0]?.changes, { version: 2 });
  assert.equal(harness.policyBumps(), 0);
  assert.equal(harness.witnesses.length, 1);

  await assert.rejects(
    harness.assignmentService.publicSafetyReview(IDs.assignment, harness.context),
    (error: unknown) =>
      error instanceof PublicHttpException &&
      error.publicPayload.code === 'CONFLICT' &&
      error.publicPayload.message === 'Assignment is not pending',
  );
  assert.equal(harness.assignmentWrites(), 1);
});

for (const scenario of [
  { name: 'worker was disabled', workerActive: false },
  { name: 'worker is missing', missingWorker: true },
  { name: 'worker now belongs to another Site', workerSiteId: IDs.otherSite },
  {
    name: 'worker contractor no longer matches participation contractor',
    workerContractorId: IDs.otherContractor,
  },
  { name: 'participation was withdrawn', participations: [] },
  {
    name: 'participation was shortened',
    participations: [participation(assignmentStart, '2099-10-03T10:00:00.000Z')],
  },
  {
    name: 'assignment validity has already expired at approval time',
    validFrom: '2020-01-01T08:00:00.000Z',
    validUntil: '2020-01-01T17:00:00.000Z',
    participations: [participation('2020-01-01T00:00:00.000Z', null)],
  },
]) {
  test(`MainAssignmentCommandService publicDecision approval revalidates when ${scenario.name}`, async () => {
    const harness = coordinatorHarnessFor({
      role: UserRole.SITE_MANAGER,
      status: WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED,
      version: 2,
      ...scenario,
    });

    await assert.rejects(
      harness.assignmentService.publicDecision(
        IDs.assignment,
        { approve: true, expectedVersion: 2 },
        harness.context,
      ),
      (error: unknown) =>
        error instanceof PublicHttpException &&
        error.publicPayload.code === 'CONFLICT' &&
        error.publicPayload.message === 'Assignment participation or validity is unavailable',
    );
    assert.ok(harness.observedTags.includes('lock:assignment_for_update'));
    assert.ok(harness.observedTags.includes('check:worker_for_share'));
    assert.ok(harness.observedTags.includes('check:participation_approvable_for_share'));
    assert.equal(harness.assignmentWrites(), 0);
    assert.equal(harness.savedAudits.length, 0);
    assert.equal(harness.policyBumps(), 0);
    assert.equal(harness.witnesses.length, 0);
    assert.equal(harness.assignmentState.status, WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED);
  });
}

test('MainAssignmentCommandService publicDecision accepts a still-valid assignment, bumps site policy version, and records audit and witness', async () => {
  const harness = coordinatorHarnessFor({
    role: UserRole.SITE_MANAGER,
    status: WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED,
    version: 2,
  });

  const approved = await harness.assignmentService.publicDecision(
    IDs.assignment,
    { approve: true, expectedVersion: 2, reviewNote: '  Cleared for entry  ' },
    harness.context,
  );

  assert.deepEqual(harness.isolations, ['SERIALIZABLE']);
  assert.ok(harness.observedTags.includes('check:worker_for_share'));
  assert.ok(harness.observedTags.includes('check:participation_approvable_for_share'));
  assert.equal(harness.assignmentWrites(), 1);
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.version, 3);
  assert.equal(approved.siteManagerDecidedByUserId, IDs.actor);
  assert.equal(approved.reviewNote, 'Cleared for entry');
  assert.equal(harness.policyBumps(), 1);
  assert.equal(harness.savedAudits.length, 1);
  assert.equal(harness.savedAudits[0]?.action, 'WORKER_ASSIGNMENT_REVIEWED');
  assert.equal(harness.savedAudits[0]?.entityType, 'worker_assignment');
  assert.equal(harness.savedAudits[0]?.entityId, IDs.assignment);
  assert.equal(harness.savedAudits[0]?.reason, 'Cleared for entry');
  assert.deepEqual(harness.savedAudits[0]?.changes, { status: 'APPROVED', version: 3 });
  assert.equal(harness.witnesses.length, 1);
});

test('MainAssignmentCommandService allows Site Manager to reject an assignment even after participation was withdrawn', async () => {
  const harness = coordinatorHarnessFor({
    role: UserRole.SITE_MANAGER,
    status: WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED,
    version: 2,
    participations: [],
  });

  const rejected = await harness.assignmentService.publicDecision(
    IDs.assignment,
    { approve: false, reviewNote: 'Withdrawn participation' },
    harness.context,
  );

  assert.equal(harness.assignmentWrites(), 1);
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.version, 3);
  assert.equal(harness.policyBumps(), 1);
  assert.equal(harness.savedAudits.length, 1);
  assert.equal(harness.savedAudits[0]?.action, 'WORKER_ASSIGNMENT_REVIEWED');
  assert.deepEqual(harness.savedAudits[0]?.changes, { status: 'REJECTED', version: 3 });
});

test('MainAssignmentCommandService serialized safetyReview and decision validate strict command payloads and support idempotent commandId replay', async () => {
  const harness = coordinatorHarnessFor({
    role: UserRole.SAFETY_OFFICER,
    // Both operations are authorized before the command-reuse assertion.
    // A Safety-only actor must receive403 on decision, not reach its409 receipt check.
    actorRoleRows: [
      { role: UserRole.SAFETY_OFFICER, site_id: IDs.site },
      { role: UserRole.SITE_MANAGER, site_id: IDs.site },
    ],
    status: WorkerSiteZoneAssignmentStatus.PENDING,
    version: 1,
  });

  const firstReview = await harness.assignmentService.safetyReview({
    commandId: IDs.command1,
    actorUserId: IDs.actor,
    siteId: IDs.site,
    assignmentId: IDs.assignment,
  });
  assert.equal(firstReview.replayed, false);
  assert.equal(firstReview.assignment.status, 'SAFETY_REVIEWED');
  assert.equal(firstReview.assignment.version, 2);
  assert.equal(harness.assignmentWrites(), 1);

  const replayedReview = await harness.assignmentService.safetyReview({
    commandId: IDs.command1,
    actorUserId: IDs.actor,
    siteId: IDs.site,
    assignmentId: IDs.assignment,
  });
  assert.equal(replayedReview.replayed, true);
  assert.equal(replayedReview.assignment.status, 'SAFETY_REVIEWED');
  assert.equal(replayedReview.assignment.version, 2);
  assert.equal(harness.assignmentWrites(), 1);

  await assert.rejects(
    harness.assignmentService.decision({
      commandId: IDs.command1,
      actorUserId: IDs.actor,
      siteId: IDs.site,
      assignmentId: IDs.assignment,
      approve: true,
    }),
    (error: unknown) =>
      error instanceof PublicHttpException &&
      error.publicPayload.code === 'CONFLICT' &&
      error.publicPayload.message === 'Command ID was already used for another request',
  );
});

test('MainAssignmentCommandService and MainWorkforceCreateService enforce transactional session, account, and role reauthorization before mutating state', async () => {
  const inactiveHarness = coordinatorHarnessFor({
    role: UserRole.SAFETY_OFFICER,
    status: WorkerSiteZoneAssignmentStatus.PENDING,
    actorActive: false,
  });
  await assert.rejects(
    inactiveHarness.assignmentService.publicSafetyReview(IDs.assignment, inactiveHarness.context),
    (error: unknown) =>
      error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN',
  );
  assert.deepEqual(inactiveHarness.observedTags, [
    'scope:lookup_assignment_site',
    'tx:SERIALIZABLE',
    'auth:reauthorize_callback',
    'auth:app_user',
  ]);
  assert.equal(inactiveHarness.assignmentWrites(), 0);

  const tempPasswordHarness = coordinatorHarnessFor({
    role: UserRole.SAFETY_OFFICER,
    status: WorkerSiteZoneAssignmentStatus.PENDING,
    actorMustChangePassword: true,
  });
  await assert.rejects(
    tempPasswordHarness.assignmentService.publicSafetyReview(
      IDs.assignment,
      tempPasswordHarness.context,
    ),
    (error: unknown) =>
      error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN',
  );
  assert.deepEqual(tempPasswordHarness.observedTags, [
    'scope:lookup_assignment_site',
    'tx:SERIALIZABLE',
    'auth:reauthorize_callback',
    'auth:app_user',
  ]);
  assert.equal(tempPasswordHarness.assignmentWrites(), 0);

  const revokedRoleHarness = coordinatorHarnessFor({
    role: UserRole.SAFETY_OFFICER,
    status: WorkerSiteZoneAssignmentStatus.PENDING,
    actorRoleRows: [],
  });
  await assert.rejects(
    revokedRoleHarness.assignmentService.publicSafetyReview(
      IDs.assignment,
      revokedRoleHarness.context,
    ),
    (error: unknown) =>
      error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN',
  );
  assert.deepEqual(revokedRoleHarness.observedTags, [
    'scope:lookup_assignment_site',
    'tx:SERIALIZABLE',
    'auth:reauthorize_callback',
    'auth:app_user',
    'auth:app_user',
    'auth:user_role_assignment',
  ]);
  assert.equal(revokedRoleHarness.assignmentWrites(), 0);

  const revokedSessionHarness = coordinatorHarnessFor({
    role: UserRole.ADMIN,
    reauthorize: async () => {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Session was revoked',
      });
    },
  });
  await assert.rejects(
    revokedSessionHarness.workforceCreateService.createContractor(
      { code: 'CTR-99', name: 'Revoked Session Contractor' },
      revokedSessionHarness.context,
    ),
    (error: unknown) => error instanceof UnauthorizedException,
  );
  assert.deepEqual(revokedSessionHarness.observedTags, [
    'tx:SERIALIZABLE',
    'auth:reauthorize_callback',
  ]);
  assert.equal(revokedSessionHarness.savedContractors.length, 0);

  await assert.rejects(
    revokedSessionHarness.assignmentService.publicSafetyReview(
      IDs.assignment,
      revokedSessionHarness.context,
    ),
    (error: unknown) => error instanceof UnauthorizedException,
  );
  assert.equal(revokedSessionHarness.assignmentWrites(), 0);

  const validWorkforceHarness = coordinatorHarnessFor({
    role: UserRole.CONTRACTOR_REPRESENTATIVE,
    hasGrant: true,
    // Worker creation needs participation active NOW; assignment fixtures use2099.
    participations: [participation('2020-01-01T00:00:00.000Z', null)],
  });
  const createdWorker = await validWorkforceHarness.workforceCreateService.createWorker(
    IDs.contractor,
    {
      siteId: IDs.site,
      externalId: 'W-100',
      displayName: 'Authorized Worker',
    },
    validWorkforceHarness.context,
  );
  assert.equal(createdWorker?.contractorId, IDs.contractor);
  assert.equal(validWorkforceHarness.savedWorkers.length, 1);
  assert.ok(validWorkforceHarness.observedTags.includes('check:grant_for_share'));
  assert.ok(validWorkforceHarness.observedTags.includes('check:contractor_for_share'));
  assert.ok(validWorkforceHarness.observedTags.includes('check:participation_start_for_share'));
  assert.equal(validWorkforceHarness.witnesses.length, 1);
});
