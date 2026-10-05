import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import { WorkerEntity } from '../src/database/entities/worker.entity.js';
import { WorkerScheduleEntity } from '../src/database/entities/worker-schedule.entity.js';
import type { AuthenticatedUser } from '../src/modules/auth/auth.service.js';
import type {
  CreateAbsenceRequestDto,
  CreateShiftChangeRequestDto,
  CreateShiftSwapRequestDto,
} from '../src/modules/workforce/dto/scheduling-request.dto.js';
import { SchedulingWorkflowService } from '../src/modules/workforce/scheduling-workflow.service.js';

function actor(
  id: string,
  assignments: Array<{ role: UserRole; siteId: string | null }>,
  mustChangePassword = false,
): AuthenticatedUser {
  return {
    id,
    username: 'test-user',
    displayName: 'Test User',
    isActive: true,
    mustChangePassword,
    roleAssignments: assignments,
  };
}

function publicCode(code: string) {
  return (error: unknown) =>
    error instanceof PublicHttpException && error.publicPayload.code === code;
}

test('SchedulingWorkflowService validates shift-change input before database access', async () => {
  const service = new SchedulingWorkflowService(undefined as unknown as DataSource);
  await assert.rejects(
    service.createShiftChange(
      actor(randomUUID(), []),
      randomUUID(),
      { workerScheduleId: 'not-a-uuid', toShiftId: randomUUID(), reason: 'x' } as never,
    ),
    publicCode('VALIDATION_FAILED'),
  );
});

test('SchedulingWorkflowService rejects scheduling reasons shorter than five characters', async () => {
  const service = new SchedulingWorkflowService(undefined as unknown as DataSource);
  const siteId = randomUUID();
  const scheduleId = randomUUID();
  const shiftId = randomUUID();

  await assert.rejects(
    service.createShiftChange(
      actor(randomUUID(), []),
      siteId,
      { workerScheduleId: scheduleId, toShiftId: shiftId, reason: 'abcd' } as CreateShiftChangeRequestDto,
    ),
    publicCode('VALIDATION_FAILED'),
  );
  await assert.rejects(
    service.createShiftSwap(
      actor(randomUUID(), []),
      siteId,
      {
        requesterWorkerScheduleId: scheduleId,
        coworkerWorkerScheduleId: randomUUID(),
        reason: 'abcd',
      } as CreateShiftSwapRequestDto,
    ),
    publicCode('VALIDATION_FAILED'),
  );
  await assert.rejects(
    service.createAbsence(
      actor(randomUUID(), []),
      siteId,
      { workerScheduleId: scheduleId, reason: 'abcd' } as CreateAbsenceRequestDto,
    ),
    publicCode('VALIDATION_FAILED'),
  );
});

test('SchedulingWorkflowService denies a Worker who attempts to request a change for another Worker', async () => {
  const siteId = randomUUID();
  const actorId = randomUUID();
  const assignedUserId = randomUUID();
  const workerId = randomUUID();
  const scheduleId = randomUUID();
  const schedule = {
    id: scheduleId,
    siteId,
    scheduleVersionId: randomUUID(),
    workerId,
    shiftId: randomUUID(),
    workDate: '2026-10-01',
    isActive: true,
    createdAt: new Date(),
  } as WorkerScheduleEntity;
  const worker = {
    id: workerId,
    siteId,
    contractorId: randomUUID(),
    userId: assignedUserId,
    externalId: 'WORKER-001',
    displayName: 'Worker One',
    isActive: true,
    createdAt: new Date(),
  } as WorkerEntity;
  const scheduleRepository = {
    findOneBy: async () => schedule,
    createQueryBuilder() {
      const builder = {
        scheduleId: '',
        setLock() {
          return builder;
        },
        where(_query: string, params: { id: string }) {
          builder.scheduleId = params.id;
          return builder;
        },
        getOne: async () => (builder.scheduleId === scheduleId ? schedule : null),
      };
      return builder;
    },
  };
  const manager = {
    getRepository(entity: unknown) {
      if (entity === WorkerScheduleEntity) return scheduleRepository;
      if (entity === WorkerEntity) return { findOneBy: async () => worker };
      throw new Error('Unexpected repository access');
    },
  };
  const source = {
    transaction: async (callback: (value: typeof manager) => Promise<unknown>) => callback(manager),
  } as unknown as DataSource;
  const service = new SchedulingWorkflowService(source);

  await assert.rejects(
    service.createShiftChange(
      actor(actorId, [{ role: UserRole.WORKER, siteId }]),
      siteId,
      {
        workerScheduleId: scheduleId,
        toShiftId: randomUUID(),
        reason: 'Need a different shift',
      } as CreateShiftChangeRequestDto,
    ),
    publicCode('FORBIDDEN'),
  );
});

test('SchedulingWorkflowService rejects a shift swap across contractors', async () => {
  const siteId = randomUUID();
  const actorId = randomUUID();
  const requesterWorkerId = randomUUID();
  const coworkerWorkerId = randomUUID();
  const requesterScheduleId = randomUUID();
  const coworkerScheduleId = randomUUID();
  const requesterContractorId = randomUUID();
  const coworkerContractorId = randomUUID();
  const shiftId = randomUUID();
  const otherShiftId = randomUUID();
  const versionId = randomUUID();
  const requesterSchedule = {
    id: requesterScheduleId,
    siteId,
    scheduleVersionId: versionId,
    workerId: requesterWorkerId,
    shiftId,
    workDate: '2026-10-01',
    isActive: true,
  } as WorkerScheduleEntity;
  const coworkerSchedule = {
    ...requesterSchedule,
    id: coworkerScheduleId,
    workerId: coworkerWorkerId,
    shiftId: otherShiftId,
  } as WorkerScheduleEntity;
  const requester = {
    id: requesterWorkerId,
    siteId,
    contractorId: requesterContractorId,
    userId: actorId,
    isActive: true,
  } as WorkerEntity;
  const coworker = {
    id: coworkerWorkerId,
    siteId,
    contractorId: coworkerContractorId,
    userId: null,
    isActive: true,
  } as WorkerEntity;
  const scheduleRepository = {
    createQueryBuilder() {
      const builder = {
        scheduleId: '',
        setLock() {
          return builder;
        },
        where(_query: string, params: { id: string }) {
          builder.scheduleId = params.id;
          return builder;
        },
        getOne: async () =>
          builder.scheduleId === requesterScheduleId
            ? requesterSchedule
            : builder.scheduleId === coworkerScheduleId
              ? coworkerSchedule
              : null,
      };
      return builder;
    },
  };
  const manager = {
    getRepository(entity: unknown) {
      if (entity === WorkerScheduleEntity) return scheduleRepository;
      if (entity === WorkerEntity)
        return {
          findOneBy: async ({ id }: { id: string }) => id === requesterWorkerId ? requester : coworker,
        };
      throw new Error('Unexpected repository access');
    },
  };
  const source = {
    transaction: async (callback: (value: typeof manager) => Promise<unknown>) => callback(manager),
  } as unknown as DataSource;
  const service = new SchedulingWorkflowService(source);

  await assert.rejects(
    service.createShiftSwap(
      actor(actorId, [{ role: UserRole.WORKER, siteId }]),
      siteId,
      {
        requesterWorkerScheduleId: requesterScheduleId,
        coworkerWorkerScheduleId: coworkerScheduleId,
        reason: 'Need to swap shifts',
      },
    ),
    (error: unknown) =>
      error instanceof PublicHttpException &&
      error.getStatus() === 409 &&
      error.publicPayload.code === 'CONFLICT',
  );
});

test('SchedulingWorkflowService allows only Contractor Representatives to review change and swap requests', async () => {
  const service = new SchedulingWorkflowService(undefined as unknown as DataSource);
  const siteId = randomUUID();
  const requestId = randomUUID();
  const reviewReason = { reason: 'Coverage is not available' } as never;

  for (const reviewer of [
    actor(randomUUID(), [{ role: UserRole.ADMIN, siteId: null }]),
    actor(randomUUID(), [{ role: UserRole.SITE_MANAGER, siteId }]),
  ]) {
    await assert.rejects(service.approveShiftChange(reviewer, siteId, requestId), publicCode('FORBIDDEN'));
    await assert.rejects(service.rejectShiftChange(reviewer, siteId, requestId, reviewReason), publicCode('FORBIDDEN'));
    await assert.rejects(service.approveShiftSwap(reviewer, siteId, requestId), publicCode('FORBIDDEN'));
    await assert.rejects(service.rejectShiftSwap(reviewer, siteId, requestId, reviewReason), publicCode('FORBIDDEN'));
  }
});

test('SchedulingWorkflowService requires a changed password before any scheduling action', async () => {
  const service = new SchedulingWorkflowService(undefined as unknown as DataSource);
  await assert.rejects(
    service.approveShiftSwap(
      actor(randomUUID(), [{ role: UserRole.SITE_MANAGER, siteId: randomUUID() }], true),
      randomUUID(),
      randomUUID(),
    ),
    publicCode('PASSWORD_CHANGE_REQUIRED'),
  );
});

test('SchedulingWorkflowService requires a reason when a change or swap is rejected', async () => {
  const service = new SchedulingWorkflowService(undefined as unknown as DataSource);
  const actorValue = actor(randomUUID(), [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: randomUUID() }]);
  const siteId = randomUUID();

  await assert.rejects(
    service.rejectShiftChange(actorValue, siteId, randomUUID(), { reason: 'abcd' } as never),
    publicCode('VALIDATION_FAILED'),
  );
  await assert.rejects(
    service.rejectShiftSwap(actorValue, siteId, randomUUID(), { reason: 'abcd' } as never),
    publicCode('VALIDATION_FAILED'),
  );
  await assert.rejects(
    service.declineShiftSwap(
      actor(randomUUID(), [{ role: UserRole.WORKER, siteId }]),
      siteId,
      randomUUID(),
      { reason: 'abcd' } as never,
    ),
    publicCode('VALIDATION_FAILED'),
  );
});
