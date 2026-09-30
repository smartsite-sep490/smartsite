import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import type {
  CreateShiftDto,
  CreateWorkerScheduleDto,
} from '../src/modules/workforce/dto/schedule-configuration.dto.js';
import { ScheduleConfigurationService } from '../src/modules/workforce/schedule-configuration.service.js';

function publicCode(code: string) {
  return (error: unknown) =>
    error instanceof PublicHttpException && error.publicPayload.code === code;
}

test('ScheduleConfigurationService validates shift input before database access', async () => {
  const service = new ScheduleConfigurationService(undefined as unknown as DataSource);
  await assert.rejects(
    service.createShift(randomUUID(), {
      name: 'Day shift',
      startsAt: 'not-a-date',
      endsAt: '2026-10-01T17:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
    } as CreateShiftDto),
    publicCode('VALIDATION_FAILED'),
  );
});

test('ScheduleConfigurationService rejects a shift ending before it starts', async () => {
  const service = new ScheduleConfigurationService(undefined as unknown as DataSource);
  await assert.rejects(
    service.createShift(randomUUID(), {
      name: 'Invalid shift',
      startsAt: '2026-10-01T17:00:00.000Z',
      endsAt: '2026-10-01T08:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
    } as CreateShiftDto),
    publicCode('VALIDATION_FAILED'),
  );
});

test('ScheduleConfigurationService validates worker schedule fields before database access', async () => {
  const service = new ScheduleConfigurationService(undefined as unknown as DataSource);
  await assert.rejects(
    service.createWorkerSchedule(randomUUID(), randomUUID(), {
      workerId: randomUUID(),
      shiftId: randomUUID(),
      workDate: '01-10-2026',
    } as CreateWorkerScheduleDto),
    publicCode('VALIDATION_FAILED'),
  );
});
