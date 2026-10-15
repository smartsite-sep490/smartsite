import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EntityManager } from 'typeorm';
import {
  ZoneAccessEffect,
  type ZoneAccessGrantEntity,
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
    userId: null,
    siteId,
    contractorId: null,
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

interface TeamZoneBindingFixture {
  siteId: string;
  contractorId: string;
  workerId: string;
  zoneId: string;
  zoneIds: string[];
  teamActive: boolean;
  participationActive: boolean;
  contractorActive: boolean;
  assignmentStatus: string;
  joinedAt: Date;
  leftAt: Date | null;
  validFrom: Date;
  validUntil: Date;
  revokedAt: Date | null;
}

function teamZoneBinding(overrides: Partial<TeamZoneBindingFixture> = {}): TeamZoneBindingFixture {
  return {
    siteId,
    contractorId: '88888888-8888-4888-8888-888888888888',
    workerId,
    zoneId,
    zoneIds: [zoneId],
    teamActive: true,
    participationActive: true,
    contractorActive: true,
    assignmentStatus: 'APPROVED',
    joinedAt: new Date('2026-09-28T06:00:00.000Z'),
    leftAt: null,
    validFrom: new Date('2026-09-28T07:00:00.000Z'),
    validUntil: new Date('2026-09-28T09:00:00.000Z'),
    revokedAt: null,
    ...overrides,
  };
}

function createManager(
  workers: WorkerEntity[],
  grants: ReturnType<typeof allowGrant>[],
  permissions: { effect: ZoneAccessEffect | 'INVALID_TIME' }[] = [],
  teamBindings: TeamZoneBindingFixture[] = [],
) {
  const workerQueries: Record<string, unknown>[] = [];
  const grantQueries: Record<string, unknown>[] = [];
  const permissionQueries: unknown[][] = [];
  const manager = {
    query: async (sql: string, parameters: unknown[]) => {
      permissionQueries.push(parameters);
      assert.match(sql, /FROM worker_zone_permission wp/);
      assert.match(sql, /FROM team_zone_permission tp/);
      assert.match(
        sql,
        /JOIN contractor_team t ON t\.id=tp\.team_id AND t\.site_id=\$2 AND t\.contractor_id=\$4 AND t\.is_active/,
      );
      assert.match(sql, /JOIN contractor_team_membership tm ON tm\.team_id=t\.id/);
      assert.match(sql, /\$3=ANY\(a\.zone_ids\)/);
      assert.match(sql, /UNION ALL/);
      assert.match(sql, /FROM zone_access_grant d/);
      assert.match(sql, /d\.valid_from<=\$5/);
      assert.match(sql, /d\.revoked_at IS NULL OR d\.revoked_at>\$5/);
      assert.match(sql, /SELECT 'INVALID_TIME' AS effect FROM zone_access_grant d/);
      assert.doesNotMatch(sql, /mf06_authority_/);
      const [verifiedWorkerId, requestedSite, requestedZone, verifiedContractorId, rawEvaluatedAt] =
        parameters;
      const evaluatedTime = rawEvaluatedAt instanceof Date ? rawEvaluatedAt.getTime() : Number.NaN;
      const teamEffects = teamBindings
        .filter(
          (binding) =>
            verifiedContractorId !== null &&
            binding.contractorId === verifiedContractorId &&
            binding.workerId === verifiedWorkerId &&
            binding.siteId === requestedSite &&
            binding.zoneId === requestedZone &&
            binding.teamActive &&
            binding.participationActive &&
            binding.contractorActive &&
            binding.assignmentStatus === 'APPROVED' &&
            binding.zoneIds.includes(String(requestedZone)) &&
            binding.joinedAt.getTime() <= evaluatedTime &&
            (binding.leftAt === null || binding.leftAt.getTime() > evaluatedTime) &&
            binding.validFrom.getTime() <= evaluatedTime &&
            binding.validUntil.getTime() > evaluatedTime &&
            (binding.revokedAt === null || binding.revokedAt.getTime() > evaluatedTime),
        )
        .map(() => ({ effect: ZoneAccessEffect.ALLOW }));
      const denyEffects = grants
        .filter((item) =>
          matches(item, {
            workerId: verifiedWorkerId,
            siteId: requestedSite,
            zoneId: requestedZone,
            effect: ZoneAccessEffect.DENY,
          }),
        )
        .flatMap((item): { effect: ZoneAccessEffect | 'INVALID_TIME' }[] => {
          const fromMs = item.validFrom.getTime();
          const untilMs = item.validUntil?.getTime();
          const revokedMs = item.revokedAt?.getTime();
          if (
            !Number.isFinite(fromMs) ||
            (untilMs !== undefined && (!Number.isFinite(untilMs) || untilMs <= fromMs)) ||
            (revokedMs !== undefined && !Number.isFinite(revokedMs))
          ) {
            return [{ effect: 'INVALID_TIME' }];
          }
          if (
            fromMs <= evaluatedTime &&
            (untilMs === undefined || untilMs > evaluatedTime) &&
            (revokedMs === undefined || revokedMs > evaluatedTime)
          ) {
            return [{ effect: ZoneAccessEffect.DENY }];
          }
          return [];
        });
      // Effects represent the PostgreSQL result, not millisecond-rounded rows.
      return [...permissions, ...teamEffects, ...denyEffects];
    },
    getRepository(target: unknown) {
      if (target === WorkerEntity) {
        return {
          findOneBy: async (criteria: Record<string, unknown>) => {
            workerQueries.push({ ...criteria });
            return workers.find((item) => matches(item, criteria)) ?? null;
          },
        };
      }
      throw new Error('Unexpected entity target in mock getRepository');
    },
  } as unknown as EntityManager;
  return { manager, workerQueries, grantQueries, permissionQueries };
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

test('main permission semantics: a legacy flat ALLOW is not an anchored worker Zone permission', async () => {
  const { manager } = createManager([worker()], [allowGrant()]);
  Object.assign(manager, { query: async () => [] });
  const result = await service().decide(manager, decisionInput({ verifiedWorkerId: workerId }));
  assert.equal(result.status, 'DENIED');
  assert.equal(result.reasonCode, 'NO_VALID_ALLOW');
});

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

test('ZoneEntryAuthorizationService: retained-main anchored permission authorizes an active same-site verified worker', async () => {
  const contractorId = '88888888-8888-4888-8888-888888888888';
  const { manager, workerQueries, grantQueries, permissionQueries } = createManager(
    [worker({ contractorId })],
    [],
    [
      {
        effect: ZoneAccessEffect.ALLOW,
      },
    ],
  );

  const result = await service().decide(manager, decisionInput({ verifiedWorkerId: workerId }));

  assert.equal(result.status, 'ALLOWED');
  assert.equal(result.reasonCode, 'VALID_ALLOW');
  assert.equal(result.workerId, workerId);
  assert.deepEqual(workerQueries, [{ id: workerId, siteId, isActive: true }]);
  assert.deepEqual(grantQueries, []);
  assert.deepEqual(permissionQueries, [[workerId, siteId, zoneId, contractorId, evaluatedAt]]);
});

test('a separate active DENY has priority over an anchored permission', async () => {
  const { manager } = createManager(
    [worker()],
    [allowGrant({ effect: ZoneAccessEffect.DENY })],
    [
      {
        effect: ZoneAccessEffect.ALLOW,
      },
    ],
  );
  assert.equal(
    (await service().decide(manager, decisionInput({ verifiedWorkerId: workerId }))).reasonCode,
    'EXPLICIT_DENY',
  );
});

test('missing main schema returns unavailable and never falls back to flat permissions', async () => {
  for (const code of ['42P01', '42703']) {
    const { manager, grantQueries } = createManager([worker()], [allowGrant()]);
    Object.assign(manager, {
      query: async () => {
        throw Object.assign(new Error('Synthetic schema gap'), { code });
      },
    });
    const result = await service().decide(manager, decisionInput({ verifiedWorkerId: workerId }));
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.reasonCode, 'AUTHORIZATION_DATA_UNAVAILABLE');
    assert.deepEqual(grantQueries, []);
  }
});

test('operational SQL failures are not disguised as empty authority', async () => {
  const { manager } = createManager([worker()], []);
  const failure = Object.assign(new Error('Synthetic serialization failure'), { code: '40001' });
  Object.assign(manager, {
    query: async () => {
      throw failure;
    },
  });
  await assert.rejects(
    service().decide(manager, decisionInput({ verifiedWorkerId: workerId })),
    (error) => error === failure,
  );
});

test('invalid evaluated time is unavailable without sending an invalid PostgreSQL date', async () => {
  const { manager, permissionQueries, grantQueries } = createManager([worker()], []);
  const result = await service().decide(
    manager,
    decisionInput({ verifiedWorkerId: workerId, evaluatedAt: new Date(NaN) }),
  );
  assert.equal(result.reasonCode, 'AUTHORIZATION_DATA_UNAVAILABLE');
  assert.deepEqual(permissionQueries, []);
  assert.deepEqual(grantQueries, []);
});

test('an explicitly empty candidate reference retains the identity-unavailable boundary', async () => {
  const { manager } = createManager([worker()], [], [{ effect: ZoneAccessEffect.ALLOW }]);
  const result = await service().decide(
    manager,
    decisionInput({ verifiedWorkerId: workerId, candidateWorkerId: '' }),
  );
  assert.equal(result.reasonCode, 'IDENTITY_UNAVAILABLE');
});

test('ZoneEntryAuthorizationService: canonical Main team zone permission authorizes an active same-site verified worker when membership and assignment zone_ids match', async () => {
  const contractorId = '88888888-8888-4888-8888-888888888888';
  const allowedSetup = createManager(
    [worker({ contractorId })],
    [],
    [],
    [teamZoneBinding({ contractorId })],
  );
  const allowedResult = await service().decide(
    allowedSetup.manager,
    decisionInput({ verifiedWorkerId: workerId }),
  );
  assert.equal(allowedResult.status, 'ALLOWED');
  assert.equal(allowedResult.reasonCode, 'VALID_ALLOW');
  assert.equal(allowedResult.workerId, workerId);
  assert.deepEqual(allowedSetup.permissionQueries, [
    [workerId, siteId, zoneId, contractorId, evaluatedAt],
  ]);

  const missingZoneInAssignment = createManager(
    [worker({ contractorId })],
    [],
    [],
    [teamZoneBinding({ contractorId, zoneIds: ['99999999-9999-4999-8999-999999999999'] })],
  );
  const missingZoneResult = await service().decide(
    missingZoneInAssignment.manager,
    decisionInput({ verifiedWorkerId: workerId }),
  );
  assert.equal(missingZoneResult.status, 'DENIED');
  assert.equal(missingZoneResult.candidateSubtype, 'ZONE_ENTRY_UNAUTHORIZED');
  assert.equal(missingZoneResult.reasonCode, 'NO_VALID_ALLOW');

  const departedMembership = createManager(
    [worker({ contractorId })],
    [],
    [],
    [teamZoneBinding({ contractorId, leftAt: evaluatedAt })],
  );
  const departedResult = await service().decide(
    departedMembership.manager,
    decisionInput({ verifiedWorkerId: workerId }),
  );
  assert.equal(departedResult.status, 'DENIED');
  assert.equal(departedResult.reasonCode, 'NO_VALID_ALLOW');

  const revokedTeamGrant = createManager(
    [worker({ contractorId })],
    [],
    [],
    [teamZoneBinding({ contractorId, revokedAt: evaluatedAt })],
  );
  const revokedResult = await service().decide(
    revokedTeamGrant.manager,
    decisionInput({ verifiedWorkerId: workerId }),
  );
  assert.equal(revokedResult.status, 'DENIED');
  assert.equal(revokedResult.reasonCode, 'NO_VALID_ALLOW');
});

test('ZoneEntryAuthorizationService: an independent active DENY overrides a canonical Main team zone permission while a revoked DENY does not', async () => {
  const contractorId = '88888888-8888-4888-8888-888888888888';
  const activeDenySetup = createManager(
    [worker({ contractorId })],
    [allowGrant({ effect: ZoneAccessEffect.DENY })],
    [],
    [teamZoneBinding({ contractorId })],
  );
  const activeDenyResult = await service().decide(
    activeDenySetup.manager,
    decisionInput({ verifiedWorkerId: workerId }),
  );
  assert.equal(activeDenyResult.status, 'DENIED');
  assert.equal(activeDenyResult.candidateSubtype, 'ZONE_ENTRY_UNAUTHORIZED');
  assert.equal(activeDenyResult.reasonCode, 'EXPLICIT_DENY');
  assert.equal(activeDenyResult.workerId, workerId);

  const revokedDenySetup = createManager(
    [worker({ contractorId })],
    [allowGrant({ effect: ZoneAccessEffect.DENY, revokedAt: evaluatedAt })],
    [],
    [teamZoneBinding({ contractorId })],
  );
  const revokedDenyResult = await service().decide(
    revokedDenySetup.manager,
    decisionInput({ verifiedWorkerId: workerId }),
  );
  assert.equal(revokedDenyResult.status, 'ALLOWED');
  assert.equal(revokedDenyResult.reasonCode, 'VALID_ALLOW');
  assert.equal(revokedDenyResult.workerId, workerId);
});

test('ZoneEntryAuthorizationService: malformed independent DENY interval yields UNAVAILABLE (not ZONE_ENTRY_UNAUTHORIZED) even when an ALLOW permission exists', async () => {
  const contractorId = '88888888-8888-4888-8888-888888888888';
  const { manager } = createManager(
    [worker({ contractorId })],
    [
      allowGrant({
        effect: ZoneAccessEffect.DENY,
        validFrom: new Date('2026-09-28T09:00:00.000Z'),
        validUntil: new Date('2026-09-28T07:00:00.000Z'),
      }),
    ],
    [{ effect: ZoneAccessEffect.ALLOW }],
    [teamZoneBinding({ contractorId })],
  );
  const result = await service().decide(manager, decisionInput({ verifiedWorkerId: workerId }));
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.candidateSubtype, 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE');
  assert.notEqual(result.candidateSubtype, 'ZONE_ENTRY_UNAUTHORIZED');
  assert.equal(result.reasonCode, 'AUTHORIZATION_DATA_UNAVAILABLE');
  assert.equal(result.workerId, workerId);
});

test('ZoneEntryAuthorizationService: transaction-active queryRunner isolates subtransaction commit and schema-error rollback', async () => {
  const contractorId = '88888888-8888-4888-8888-888888888888';
  const commitEvents: string[] = [];
  const { manager } = createManager(
    [worker({ contractorId })],
    [],
    [],
    [teamZoneBinding({ contractorId })],
  );
  Object.assign(manager, {
    queryRunner: {
      isTransactionActive: true,
      startTransaction: async () => {
        commitEvents.push('start');
      },
      commitTransaction: async () => {
        commitEvents.push('commit');
      },
      rollbackTransaction: async () => {
        commitEvents.push('rollback');
      },
    },
  });
  const okResult = await service().decide(manager, decisionInput({ verifiedWorkerId: workerId }));
  assert.equal(okResult.status, 'ALLOWED');
  assert.deepEqual(commitEvents, ['start', 'commit']);

  const rollbackEvents: string[] = [];
  const rollbackSetup = createManager([worker({ contractorId })], []);
  Object.assign(rollbackSetup.manager, {
    queryRunner: {
      isTransactionActive: true,
      startTransaction: async () => {
        rollbackEvents.push('start');
      },
      commitTransaction: async () => {
        rollbackEvents.push('commit');
      },
      rollbackTransaction: async () => {
        rollbackEvents.push('rollback');
      },
    },
    query: async () => {
      throw Object.assign(new Error('Synthetic missing table'), { code: '42P01' });
    },
  });
  const unavailableResult = await service().decide(
    rollbackSetup.manager,
    decisionInput({ verifiedWorkerId: workerId }),
  );
  assert.equal(unavailableResult.status, 'UNAVAILABLE');
  assert.equal(unavailableResult.reasonCode, 'AUTHORIZATION_DATA_UNAVAILABLE');
  assert.deepEqual(rollbackEvents, ['start', 'rollback']);
});
