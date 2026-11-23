import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { DataSource, EntityManager } from 'typeorm';
import {
  ContractorEntity,
  ContractorSiteParticipationEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  ContractorRepresentativeAssignmentEntity,
  ScheduleAssignmentBatchEntity,
  WorkerScheduleEntity,
} from '../src/database/entities/index.js';
import { ScheduleAssignmentService } from '../src/modules/workforce/scheduling/schedule-assignment.service.js';
import { SchedulingNotificationService } from '../src/modules/workforce/notifications/scheduling-notification.service.js';
import type { AuthenticatedUser } from '../src/modules/auth/auth.service.js';

test('batch list returns current partial changes and cancellations, scoped to its page and Site', async () => {
  const siteId = randomUUID(),
    contractorId = randomUUID(),
    userId = randomUUID();
  const originalShift = randomUUID(),
    newShift = randomUUID();
  const rows = [
    { id: randomUUID(), workDate: '2099-01-02', shiftId: newShift, isActive: true },
    { id: randomUUID(), workDate: '2099-01-02', shiftId: originalShift, isActive: false },
    { id: randomUUID(), workDate: '2099-01-03', shiftId: originalShift, isActive: true },
  ];
  const batch = {
    id: randomUUID(),
    siteId,
    contractorId,
    version: 3,
    input: {
      contractorId,
      shiftId: originalShift,
      target: 'TEAM',
      fromDate: '2099-01-02',
      toDate: '2099-01-03',
    },
    preview: { targetName: 'Synthetic crew', dates: ['2099-01-02', '2099-01-03'], members: [] },
    scheduleIds: rows.map((row) => row.id),
    createdAt: new Date('2098-12-01'),
  };
  const actor = { id: userId, mustChangePassword: false } as AuthenticatedUser;
  let authorized = true,
    batchReads = 0,
    scheduleReads = 0,
    empty = false;
  const manager = {
    getRepository(entity: unknown) {
      if (entity === UserEntity)
        return {
          findOneBy: async () => ({ id: userId, isActive: true, mustChangePassword: false }),
        };
      if (entity === UserRoleAssignmentEntity)
        return {
          findBy: async () =>
            authorized ? [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId }] : [],
        };
      if (entity === ContractorRepresentativeAssignmentEntity)
        return { existsBy: async () => true };
      if (entity === ContractorEntity) return { findOneBy: async () => ({ id: contractorId }) };
      if (entity === ContractorSiteParticipationEntity)
        return { findBy: async () => [{ validFrom: new Date('2020-01-01'), validUntil: null }] };
      if (entity === ScheduleAssignmentBatchEntity)
        return {
          findAndCount: async (options: { where: unknown; skip: number; take: number }) => {
            batchReads++;
            assert.deepEqual(options.where, { siteId, contractorId });
            assert.equal(options.skip, 8);
            assert.equal(options.take, 8);
            return [empty ? [] : [batch], empty ? 0 : 1];
          },
        };
      if (entity === WorkerScheduleEntity)
        return {
          find: async (options: { where: { siteId: string; id: { value: string[] } } }) => {
            scheduleReads++;
            assert.equal(options.where.siteId, siteId);
            assert.deepEqual(options.where.id.value, batch.scheduleIds);
            return rows;
          },
        };
      throw new Error('Unexpected repository');
    },
  } as unknown as EntityManager;
  const source = {
    transaction: async (isolation: string, run: (m: EntityManager) => Promise<unknown>) => {
      assert.equal(isolation, 'REPEATABLE READ');
      return run(manager);
    },
  } as unknown as DataSource;
  const service = new ScheduleAssignmentService(source, new SchedulingNotificationService(source));
  const listed = await service.list(actor, siteId, contractorId, 8, 8);
  assert.equal(listed.items[0]!.input.shiftId, originalShift);
  assert.equal(listed.items[0]!.version, 3);
  const current = listed.items[0]!.currentSchedules!;
  assert.deepEqual(
    current.find((row) => row.shiftId === newShift),
    { workDate: '2099-01-02', shiftId: newShift, activeCount: 1, cancelledCount: 0 },
  );
  assert.deepEqual(
    current.find((row) => row.workDate === '2099-01-02' && row.shiftId === originalShift),
    { workDate: '2099-01-02', shiftId: originalShift, activeCount: 0, cancelledCount: 1 },
  );
  rows.forEach((row) => {
    row.isActive = false;
  });
  const cancelled = await service.list(actor, siteId, contractorId, 8, 8);
  assert.equal(
    cancelled.items[0]!.currentSchedules!.reduce((n, row) => n + row.activeCount, 0),
    0,
  );
  assert.equal(
    cancelled.items[0]!.currentSchedules!.reduce((n, row) => n + row.cancelledCount, 0),
    3,
  );
  empty = true;
  assert.deepEqual(await service.list(actor, siteId, contractorId, 8, 8), { items: [], total: 0 });
  assert.equal(scheduleReads, 2, 'an empty page must not read other schedules');
  authorized = false;
  await assert.rejects(service.list(actor, siteId, contractorId, 8, 8));
  assert.equal(batchReads, 3, 'denied callers cannot read batches or live schedules');
});
