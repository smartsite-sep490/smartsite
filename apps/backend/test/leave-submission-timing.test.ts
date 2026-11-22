import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { DataSource, EntityManager } from 'typeorm';
import {
  AbsenceRequestEntity,
  ContractorEntity,
  ContractorRepresentativeAssignmentEntity,
  ContractorSiteParticipationEntity,
  ShiftEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  WorkerEntity,
  WorkerScheduleEntity,
} from '../src/database/entities/index.js';
import { AttendanceDaysService } from '../src/modules/workforce/attendance/attendance-days.service.js';
import type { AttendanceReconciliationService } from '../src/modules/workforce/attendance/attendance-reconciliation.service.js';
import { SchedulingWorkflowService } from '../src/modules/workforce/scheduling/scheduling-workflow.service.js';

for (const scenario of [
  {
    workDate: '2026-11-21',
    now: '2026-11-21T10:00:00Z',
    noticeType: 'EMERGENCY',
    error: /shift that has ended/,
  },
  {
    workDate: '2026-11-21',
    now: '2026-11-20T01:00:00.001Z',
    noticeType: 'PLANNED',
    error: /at least 24 hours/,
  },
  {
    workDate: '2026-11-22',
    now: '2026-11-21T01:00:00Z',
    noticeType: 'EMERGENCY',
    error: /shifts taking place today/,
  },
] as const) {
  test(`both leave entry points reject ${scenario.noticeType} at ${scenario.now} before writing`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse(scenario.now) });
    const siteId = randomUUID(),
      userId = randomUUID(),
      workerId = randomUUID(),
      contractorId = randomUUID(),
      scheduleId = randomUUID();
    const actor = {
      id: userId,
      username: 'synthetic-rep',
      displayName: 'Synthetic Representative',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ siteId, role: UserRole.CONTRACTOR_REPRESENTATIVE }],
    };
    const schedule = {
      id: scheduleId,
      siteId,
      workerId,
      shiftId: randomUUID(),
      scheduleVersionId: randomUUID(),
      isActive: true,
      workDate: scenario.workDate,
    };
    const worker = { id: workerId, siteId, userId: randomUUID(), contractorId, isActive: true };
    const shift = {
      id: schedule.shiftId,
      siteId,
      startsAt: new Date('2026-01-01T01:00:00Z'),
      endsAt: new Date('2026-01-01T10:00:00Z'),
      timezone: 'Asia/Ho_Chi_Minh',
    };
    const rows = new Map<unknown, unknown>([
      [WorkerScheduleEntity, schedule],
      [WorkerEntity, worker],
      [ShiftEntity, shift],
      [UserEntity, actor],
      [ContractorEntity, { isActive: true }],
      [ContractorRepresentativeAssignmentEntity, { userId, siteId, contractorId }],
      [AbsenceRequestEntity, null],
    ]);
    let writes = 0;
    const manager = {
      query: async () => [],
      getRepository: (entity: unknown) => ({
        findOneBy: async () => rows.get(entity),
        findOneByOrFail: async () => rows.get(entity),
        findOne: async () => rows.get(entity),
        existsBy: async () => !!rows.get(entity),
        findBy: async () =>
          entity === UserRoleAssignmentEntity
            ? actor.roleAssignments
            : entity === ContractorSiteParticipationEntity
              ? [{ validFrom: new Date(0), validUntil: null }]
              : [],
        save: async () => {
          writes++;
          throw Error('Unexpected write before timing rejection');
        },
      }),
    } as unknown as EntityManager;
    const source = {
      transaction: async <T>(work: (em: EntityManager) => Promise<T>) => work(manager),
    } as DataSource;
    const fullShift = new SchedulingWorkflowService(source);
    const hourly = new AttendanceDaysService(source, {} as AttendanceReconciliationService);
    const reason = 'Synthetic timing regression';
    await assert.rejects(
      fullShift.createAbsence(actor, siteId, {
        workerScheduleId: scheduleId,
        reason,
        noticeType: scenario.noticeType,
      }),
      scenario.error,
    );
    await assert.rejects(
      hourly.request(actor, siteId, {
        requestId: randomUUID(),
        workerScheduleId: scheduleId,
        kind: 'LEAVE',
        reason,
        noticeType: scenario.noticeType,
        startsAt: scenario.workDate + 'T01:00:00Z',
        endsAt: scenario.workDate + 'T10:00:00Z',
      }),
      scenario.error,
    );
    assert.equal(writes, 0);
  });
}
