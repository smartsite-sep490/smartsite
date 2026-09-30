import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EntityManager } from 'typeorm';
import {
  ZoneAccessEffect,
  ZoneAccessGrantEntity,
} from '../src/database/entities/zone-access-grant.entity.js';
import { WorkerEntity } from '../src/database/entities/worker.entity.js';
import { ZoneRestrictionPolicy } from '../src/database/entities/enums.js';
import { ZoneAuthorizationService } from '../src/modules/zones/zone-authorization.service.js';
import {
  ZoneEntryAuthorizationService,
  type ZoneEntryDecisionInput,
} from '../src/modules/zones/zone-entry-authorization.service.js';

const siteId = '22222222-2222-4222-8222-222222222222';
const otherSiteId = '33333333-3333-4333-8333-333333333333';
const zoneId = '44444444-4444-4444-8444-444444444444';
const workerId = '55555555-5555-4555-8555-555555555555';
const evaluatedAt = new Date('2026-09-28T08:00:00.000Z');

function worker(overrides: Partial<WorkerEntity> = {}): WorkerEntity {
  return {
    id: workerId,
    siteId,
    externalId: 'WORKER-001',
    displayName: 'Worker 001',
    isActive: true,
    createdAt: evaluatedAt,
    ...overrides,
  };
}

function allowGrant(overrides: Partial<ZoneAccessGrantEntity> = {}): ZoneAccessGrantEntity {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    siteId,
    zoneId,
    workerId,
    effect: ZoneAccessEffect.ALLOW,
    validFrom: new Date('2026-09-28T07:00:00.000Z'),
    validUntil: new Date('2026-09-28T09:00:00.000Z'),
    revokedAt: null,
    createdAt: evaluatedAt,
    ...overrides,
  };
}

function matches(row: object, criteria: Record<string, unknown>): boolean {
  return Object.entries(criteria).every(
    ([key, value]) => (row as Record<string, unknown>)[key] === value,
  );
}

function createManager(workers: WorkerEntity[], grants: ZoneAccessGrantEntity[]) {
  const workerQueries: Record<string, unknown>[] = [];
  const grantQueries: Record<string, unknown>[] = [];
  const manager = {
    getRepository(target: unknown) {
      if (target === WorkerEntity) {
        return {
          findOneBy: async (criteria: Record<string, unknown>) => {
            workerQueries.push({ ...criteria });
            return workers.find((item) => matches(item, criteria)) ?? null;
          },
        };
      }
      if (target === ZoneAccessGrantEntity) {
        return {
          findBy: async (criteria: Record<string, unknown>) => {
            grantQueries.push({ ...criteria });
            return grants.filter((item) => matches(item, criteria));
          },
        };
      }
      throw new Error('Unexpected entity target in mock getRepository');
    },
  } as unknown as EntityManager;
  return { manager, workerQueries, grantQueries };
}

function decisionInput(overrides: Partial<ZoneEntryDecisionInput> = {}): ZoneEntryDecisionInput {
  return {
    eventId: '77777777-7777-4777-8777-777777777777',
    siteId,
    zoneId,
    trackId: 7,
    evaluatedAt,
    restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
    ...overrides,
  };
}

function service(): ZoneEntryAuthorizationService {
  return new ZoneEntryAuthorizationService(new ZoneAuthorizationService());
}

test('ZoneEntryAuthorizationService: an inactive verified worker cannot use an allow grant', async () => {
  const { manager, workerQueries, grantQueries } = createManager(
    [worker({ isActive: false })],
    [allowGrant()],
  );

  const result = await service().decide(
    manager,
    decisionInput({ verifiedWorkerId: workerId, candidateWorkerId: 'WORKER-001' }),
  );

  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.candidateSubtype, 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE');
  assert.equal(result.reasonCode, 'IDENTITY_UNAVAILABLE');
  assert.equal(result.workerId, undefined);
  assert.deepEqual(workerQueries, [{ id: workerId, siteId, isActive: true }]);
  assert.deepEqual(grantQueries, []);
});

test('ZoneEntryAuthorizationService: a verified worker on another site cannot use an allow grant', async () => {
  const { manager, workerQueries, grantQueries } = createManager(
    [worker({ siteId: otherSiteId, isActive: true })],
    [allowGrant({ siteId: otherSiteId })],
  );

  const result = await service().decide(
    manager,
    decisionInput({ verifiedWorkerId: workerId, candidateWorkerId: 'WORKER-001' }),
  );

  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.candidateSubtype, 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE');
  assert.equal(result.reasonCode, 'IDENTITY_UNAVAILABLE');
  assert.equal(result.workerId, undefined);
  assert.deepEqual(workerQueries, [{ id: workerId, siteId, isActive: true }]);
  assert.deepEqual(grantQueries, []);
});

test('ZoneEntryAuthorizationService: a candidate id cannot use an allow grant without a verified worker', async () => {
  const { manager, workerQueries, grantQueries } = createManager([worker()], [allowGrant()]);

  const result = await service().decide(
    manager,
    decisionInput({ candidateWorkerId: 'WORKER-001' }),
  );

  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.candidateSubtype, 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE');
  assert.equal(result.reasonCode, 'IDENTITY_UNAVAILABLE');
  assert.equal(result.workerId, undefined);
  assert.deepEqual(workerQueries, []);
  assert.deepEqual(grantQueries, []);
});

test('ZoneEntryAuthorizationService: an active same-site verified worker with a valid allow is authorized', async () => {
  const { manager, workerQueries, grantQueries } = createManager([worker()], [allowGrant()]);

  const result = await service().decide(manager, decisionInput({ verifiedWorkerId: workerId }));

  assert.equal(result.status, 'ALLOWED');
  assert.equal(result.reasonCode, 'VALID_ALLOW');
  assert.equal(result.workerId, workerId);
  assert.deepEqual(workerQueries, [{ id: workerId, siteId, isActive: true }]);
  assert.deepEqual(grantQueries, [{ siteId, zoneId, workerId }]);
});
