import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { command } from '../src/common/configuration/commands.js';
import { ReviewAttendanceCorrectionCommand } from '../src/modules/workforce/attendance/attendance.service.js';
import { CreateShiftDto } from '../src/modules/workforce/scheduling/dto/schedule-configuration.dto.js';
import {
  AttendanceDaysDto,
  AttendanceTimeRequestsDto,
  ReviewAttendanceTimeDto,
} from '../src/modules/workforce/attendance/dto/attendance.dto.js';

test('exit policy validates integer minutes 0-120 and counts 0-10 at the HTTP boundary', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const shift = {
    name: 'Day',
    startsAt: '2026-10-15T08:00:00Z',
    endsAt: '2026-10-15T17:00:00Z',
    timezone: 'UTC',
  };
  for (const policy of [
    {},
    { allowedExitMinutes: 0, maxExitCount: 0 },
    { allowedExitMinutes: 120, maxExitCount: 10 },
  ]) {
    await pipe.transform({ ...shift, ...policy }, { type: 'body', metatype: CreateShiftDto });
  }
  for (const policy of [
    { allowedExitMinutes: -1 },
    { allowedExitMinutes: 121 },
    { allowedExitMinutes: 1.5 },
    { allowedExitMinutes: '15' },
    { maxExitCount: -1 },
    { maxExitCount: 11 },
    { maxExitCount: 1.5 },
  ]) {
    await assert.rejects(
      pipe.transform({ ...shift, ...policy }, { type: 'body', metatype: CreateShiftDto }),
    );
  }
});

test('attendance query can be revalidated after the HTTP pipe without inventing pagination values', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  for (const query of [{}, { limit: '20', offset: '0' }, { fromDate: '2026-10-08' }]) {
    const input = await pipe.transform(query, { type: 'query', metatype: AttendanceDaysDto });
    const result = command(AttendanceDaysDto, input);
    assert.equal(result.limit, 'limit' in query ? 20 : undefined);
    assert.equal(result.offset, 'offset' in query ? 0 : undefined);
  }
  for (const query of [{ limit: 'invalid' }, { offset: '-1' }, { unexpected: 'value' }]) {
    await assert.rejects(pipe.transform(query, { type: 'query', metatype: AttendanceDaysDto }));
  }
});

test('time approval allows no note; rejection requires a nonempty reason and rejects malformed authority', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  for (const input of [
    { approve: true },
    { approve: true, reviewNote: 'Legacy approval note' },
    { approve: false, reviewNote: 'Not needed' },
  ]) {
    for (const metatype of [ReviewAttendanceTimeDto, ReviewAttendanceCorrectionCommand]) {
      const value = await pipe.transform(input, { type: 'body', metatype });
      assert.equal(command(metatype, value).approve, input.approve);
    }
  }
  for (const input of [
    { approve: false },
    { approve: false, reviewNote: '   ' },
    { approve: false, reviewNote: null },
    { approve: 'true' },
    { approve: true, reviewNote: 1 },
    { approve: true, reviewerId: 'forged' },
  ]) {
    await assert.rejects(
      pipe.transform(input, { type: 'body', metatype: ReviewAttendanceTimeDto }),
    );
    assert.throws(() => command(ReviewAttendanceTimeDto, input));
    await assert.rejects(
      pipe.transform(input, { type: 'body', metatype: ReviewAttendanceCorrectionCommand }),
    );
    assert.throws(() => command(ReviewAttendanceCorrectionCommand, input));
  }
});
test('time request pagination validates kind, status, scope IDs and bounded page sizes', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const input = await pipe.transform(
    { kind: 'LEAVE', status: 'PENDING', offset: '100', limit: '20' },
    { type: 'query', metatype: AttendanceTimeRequestsDto },
  );
  assert.equal(command(AttendanceTimeRequestsDto, input).offset, 100);
  for (const query of [
    {},
    { kind: 'INVALID' },
    { kind: 'LEAVE', status: 'PENDING_MANAGER' },
    { kind: 'OVERTIME', offset: '-1' },
    { kind: 'LEAVE', limit: '101' },
    { kind: 'LEAVE', workerId: 'invalid' },
    { kind: 'LEAVE', unexpected: 'value' },
  ]) {
    await assert.rejects(
      pipe.transform(query, { type: 'query', metatype: AttendanceTimeRequestsDto }),
    );
  }
});
