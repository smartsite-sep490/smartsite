import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import type { AuthenticatedUser } from '../src/modules/auth/auth.service.js';
import type {
  CreateShiftDto,
  CreateWorkerScheduleDto,
} from '../src/modules/workforce/dto/schedule-configuration.dto.js';
import { ScheduleConfigurationService } from '../src/modules/workforce/schedule-configuration.service.js';

function publicCode(code: string) {
  return (error: unknown) =>
    error instanceof PublicHttpException && error.publicPayload.code === code;
}

function siteManagerActor(siteId: string): AuthenticatedUser {
  return {
    id: randomUUID(),
    username: 'test-site-manager',
    displayName: 'Test Site Manager',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId }],
  };
}

function adminActor(): AuthenticatedUser {
  return {
    id: randomUUID(),
    username: 'test-admin',
    displayName: 'Test Admin',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  };
}

function contractorRepresentativeActor(siteId: string): AuthenticatedUser {
  return {
    id: randomUUID(),
    username: 'test-contractor-representative',
    displayName: 'Test Contractor Representative',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId }],
  };
}

test('ScheduleConfigurationService validates shift input before database access', async () => {
  const service = new ScheduleConfigurationService(undefined as unknown as DataSource);
  const siteId = randomUUID();
  await assert.rejects(
    service.createShift(siteManagerActor(siteId), siteId, {
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
  const siteId = randomUUID();
  await assert.rejects(
    service.createShift(siteManagerActor(siteId), siteId, {
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
  const siteId = randomUUID();
  await assert.rejects(
    service.createWorkerSchedule(contractorRepresentativeActor(siteId), siteId, randomUUID(), {
      workerId: randomUUID(),
      shiftId: randomUUID(),
      workDate: '01-10-2026',
    } as CreateWorkerScheduleDto),
    publicCode('VALIDATION_FAILED'),
  );
});

test('ScheduleConfigurationService does not allow a Global Admin to assign a worker schedule', async () => {
  const service = new ScheduleConfigurationService(undefined as unknown as DataSource);
  const siteId = randomUUID();

  await assert.rejects(
    service.createWorkerSchedule(adminActor(), siteId, randomUUID(), {
      workerId: randomUUID(),
      shiftId: randomUUID(),
      workDate: '2026-10-01',
    }),
    publicCode('FORBIDDEN'),
  );
});

test('ScheduleConfigurationService denies a Site Manager outside the assigned Site', async () => {
  const service = new ScheduleConfigurationService(undefined as unknown as DataSource);
  const assignedSiteId = randomUUID();
  const otherSiteId = randomUUID();
  const siteManager: AuthenticatedUser = {
    id: randomUUID(),
    username: 'site-manager',
    displayName: 'Site Manager',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: assignedSiteId }],
  };

  await assert.rejects(
    service.createShift(siteManager, otherSiteId, {
      name: 'Morning',
      startsAt: '2026-10-01T01:00:00.000Z',
      endsAt: '2026-10-01T09:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
    }),
    publicCode('FORBIDDEN'),
  );

  await assert.rejects(
    service.deleteShift(siteManager, otherSiteId, randomUUID()),
    publicCode('FORBIDDEN'),
  );
});

test('ScheduleConfigurationService does not allow a Site Manager to assign a worker schedule', async () => {
  const service = new ScheduleConfigurationService(undefined as unknown as DataSource);
  const siteId = randomUUID();
  const siteManager: AuthenticatedUser = {
    id: randomUUID(),
    username: 'site-manager',
    displayName: 'Site Manager',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId }],
  };

  await assert.rejects(
    service.createWorkerSchedule(siteManager, siteId, randomUUID(), {
      workerId: randomUUID(),
      shiftId: randomUUID(),
      workDate: '2026-10-01',
    }),
    publicCode('FORBIDDEN'),
  );
});
