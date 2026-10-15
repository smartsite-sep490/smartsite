import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { command } from '../src/common/configuration/commands.js';
import {
  AttendanceReportDto,
  AttendanceWorkersDto,
} from '../src/modules/workforce/attendance/dto/attendance-report.dto.js';
import { AttendanceReportsService } from '../src/modules/workforce/attendance/attendance-reports.service.js';
import { AttendanceReportsController } from '../src/modules/workforce/attendance/attendance-reports.controller.js';
import { UserAuthGuard } from '../src/modules/auth/user-auth.guard.js';
import type { AuthenticatedRequest } from '../src/modules/auth/auth.service.js';

const range = { fromDate: '2026-10-05', toDate: '2026-10-11' };
test('report HTTP queries transform pagination/booleans and reject spoofed authority, invalid dates, enums and bounds', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const value = await pipe.transform(
    { ...range, limit: '50', offset: '0', includeDaily: 'false' },
    { type: 'query', metatype: AttendanceWorkersDto },
  );
  assert.equal(command(AttendanceWorkersDto, value).includeDaily, false);
  assert.equal(value.limit, 50);
  for (const query of [
    {},
    { ...range, fromDate: '2026-02-30' },
    { ...range, limit: '101' },
    { ...range, includeDaily: 'yes' },
    { ...range, workerId: 'bad' },
    { ...range, todayStatus: 'ALL' },
    { ...range, asOf: '2026-10-20' },
    { ...range, userId: 'forged' },
  ]) {
    await assert.rejects(pipe.transform(query, { type: 'query', metatype: AttendanceWorkersDto }));
  }
  assert.throws(() => command(AttendanceReportDto, { ...range, includeDaily: true }));
});
test('report controller requires UserAuthGuard and passes only authenticated context to the service', async () => {
  const actor = { id: 'actor' };
  const service = {
    summary: async (user: unknown, site: string, query: unknown) => {
      assert.equal(user, actor);
      assert.equal(site, 'site');
      assert.deepEqual(query, range);
      return {};
    },
  } as unknown as AttendanceReportsService;
  assert.deepEqual(Reflect.getMetadata('__guards__', AttendanceReportsController), [UserAuthGuard]);
  await new AttendanceReportsController(service).summary(
    { user: actor } as AuthenticatedRequest,
    'site',
    range,
  );
});
test('unavailable permission data propagates and never returns a successful empty report', async () => {
  const service = new AttendanceReportsService({
    transaction: async () => {
      throw new Error('synthetic unavailable');
    },
  } as unknown as DataSource);
  await assert.rejects(
    service.summary(
      { id: 'actor', mustChangePassword: false, roleAssignments: [] },
      '00000000-0000-4000-8000-000000000001',
      range,
    ),
    /synthetic unavailable/,
  );
});
