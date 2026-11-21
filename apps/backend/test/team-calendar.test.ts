import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { DataSource, EntityManager } from 'typeorm';
import { ScheduleAssignmentService } from '../src/modules/workforce/scheduling/schedule-assignment.service.js';
import type { SchedulingNotificationService } from '../src/modules/workforce/notifications/scheduling-notification.service.js';
import {
  ContractorEntity,
  ContractorRepresentativeAssignmentEntity,
  ContractorSiteParticipationEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
} from '../src/database/entities/index.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';

test('team calendar checks persisted account, contractor/site scope and date bounds before querying schedules', async () => {
  const siteId = randomUUID(),
    contractorId = randomUUID(),
    actorId = randomUUID();
  const actor = {
    id: actorId,
    username: 'synthetic',
    displayName: 'Synthetic representative',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ siteId, role: UserRole.CONTRACTOR_REPRESENTATIVE }],
  };
  for (const scenario of [
    'allowed',
    'inactive',
    'stale-role',
    'wrong-grant',
    'no-participation',
    'unavailable',
  ] as const) {
    let queries = 0;
    const m = {
      getRepository(entity: unknown) {
        if (entity === UserEntity)
          return {
            findOneBy: async () =>
              scenario === 'inactive' ? null : { id: actorId, mustChangePassword: false },
          };
        if (entity === UserRoleAssignmentEntity)
          return {
            findBy: async () =>
              scenario === 'stale-role'
                ? []
                : [{ siteId, role: UserRole.CONTRACTOR_REPRESENTATIVE }],
          };
        if (entity === ContractorRepresentativeAssignmentEntity)
          return {
            existsBy: async () => {
              if (scenario === 'unavailable') throw new Error('Synthetic permission unavailable');
              return scenario !== 'wrong-grant';
            },
          };
        if (entity === ContractorEntity) return { findOneBy: async () => ({}) };
        if (entity === ContractorSiteParticipationEntity)
          return {
            findBy: async () =>
              scenario === 'no-participation' ? [] : [{ validFrom: new Date(0), validUntil: null }],
          };
        throw new Error('Unexpected repository');
      },
      query: async (_sql: string, parameters: unknown[]) => {
        queries += 1;
        assert.deepEqual(parameters, [siteId, contractorId, '2026-11-09', '2026-11-15']);
        return [];
      },
    } as unknown as EntityManager;
    const source = {
      transaction: async (_isolation: unknown, action: (manager: EntityManager) => unknown) =>
        action(m),
    } as unknown as DataSource;
    const service = new ScheduleAssignmentService(source, {} as SchedulingNotificationService);
    const input = { contractorId, fromDate: '2026-11-09', toDate: '2026-11-15' };
    if (scenario === 'allowed') {
      assert.deepEqual(await service.teamCalendar(actor, siteId, input), {
        items: [],
        unassignedScheduleCount: 0,
      });
      assert.equal(queries, 1);
      for (const bad of [
        { ...input, fromDate: '2026-11-20' },
        { ...input, toDate: '2028-01-01' },
        { ...input, fromDate: '2026-02-30' },
        { ...input, contractorId: 'invalid' },
      ])
        await assert.rejects(service.teamCalendar(actor, siteId, bad));
      assert.equal(queries, 1);
    } else {
      await assert.rejects(
        service.teamCalendar(actor, siteId, input),
        scenario === 'unavailable'
          ? /Synthetic permission unavailable/
          : (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 403,
      );
      assert.equal(queries, 0);
    }
  }
});
