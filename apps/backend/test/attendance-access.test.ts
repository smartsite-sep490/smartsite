import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { EntityManager } from 'typeorm';
import { attendanceAccess } from '../src/modules/workforce/attendance/attendance-access.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import {
  ContractorEntity,
  ContractorRepresentativeAssignmentEntity,
  ContractorSiteParticipationEntity,
  UserEntity,
  UserRoleAssignmentEntity,
  UserRole,
  WorkerEntity,
} from '../src/database/entities/index.js';

test('attendance review requires current representative role, matching scope and active participation', async () => {
  const worker = {
    id: 'worker',
    siteId: 'site',
    contractorId: 'contractor',
    userId: 'worker-user',
    isActive: true,
  } as WorkerEntity;
  const actor = {
    id: 'rep',
    username: 'rep',
    displayName: 'Representative',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: 'site' }],
  };
  for (const scenario of [
    'allowed',
    'manager',
    'wrong-site',
    'wrong-contractor',
    'no-role',
    'no-grant',
    'no-participation',
    'inactive-contractor',
    'inactive-account',
    'unavailable',
  ] as const) {
    const manager = {
      getRepository(entity: unknown) {
        if (entity === UserEntity)
          return {
            findOneBy: async () => (scenario === 'inactive-account' ? null : { id: actor.id }),
          };
        if (entity === UserRoleAssignmentEntity)
          return {
            findBy: async () =>
              scenario === 'no-role'
                ? []
                : [
                    {
                      role:
                        scenario === 'manager'
                          ? UserRole.SITE_MANAGER
                          : UserRole.CONTRACTOR_REPRESENTATIVE,
                      siteId: scenario === 'wrong-site' ? 'other-site' : 'site',
                    },
                  ],
          };
        if (entity === ContractorRepresentativeAssignmentEntity)
          return {
            existsBy: async (where: { contractorId: string }) => {
              if (scenario === 'unavailable') throw new Error('Permission data unavailable');
              return (
                scenario !== 'no-grant' &&
                where.contractorId ===
                  (scenario === 'wrong-contractor' ? 'other-contractor' : 'contractor')
              );
            },
          };
        if (entity === ContractorEntity)
          return { findOneBy: async () => (scenario === 'inactive-contractor' ? null : {}) };
        if (entity === ContractorSiteParticipationEntity)
          return {
            findBy: async () =>
              scenario === 'no-participation' ? [] : [{ validFrom: new Date(0), validUntil: null }],
          };
        throw new Error('Unexpected repository');
      },
    } as unknown as EntityManager;
    if (scenario === 'allowed')
      assert.equal(await attendanceAccess(manager, actor, worker, true), 'REPRESENTATIVE');
    else if (scenario === 'unavailable')
      await assert.rejects(
        attendanceAccess(manager, actor, worker, true),
        /Permission data unavailable/,
      );
    else
      await assert.rejects(
        attendanceAccess(manager, actor, worker, true),
        (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 403,
        scenario,
      );
  }
});
