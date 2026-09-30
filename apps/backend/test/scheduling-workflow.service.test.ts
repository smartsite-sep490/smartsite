import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import { WorkerEntity } from '../src/database/entities/worker.entity.js';
import { WorkerScheduleEntity } from '../src/database/entities/worker-schedule.entity.js';
import type { AuthenticatedUser } from '../src/modules/auth/auth.service.js';
import type { CreateShiftChangeRequestDto } from '../src/modules/workforce/dto/scheduling-request.dto.js';
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
  const manager = {
    getRepository(entity: unknown) {
      if (entity === WorkerScheduleEntity)
        return { findOneBy: async () => schedule };
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

test('SchedulingWorkflowService denies Site Manager approval outside the assigned Site', async () => {
  const service = new SchedulingWorkflowService(undefined as unknown as DataSource);
  await assert.rejects(
    service.approveShiftChange(
      actor(randomUUID(), [{ role: UserRole.SITE_MANAGER, siteId: randomUUID() }]),
      randomUUID(),
      randomUUID(),
    ),
    publicCode('FORBIDDEN'),
  );
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
