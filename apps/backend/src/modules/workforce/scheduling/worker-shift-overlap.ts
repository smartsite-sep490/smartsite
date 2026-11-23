import { In, type EntityManager } from 'typeorm';
import { conflict } from '../../../common/configuration/commands.js';
import {
  ShiftEntity,
  WorkerScheduleEntity,
  OvertimeRequestEntity,
} from '../../../database/entities/index.js';
import { scheduledShiftWindow } from '../attendance/attendance-calculation.js';

export async function assertWorkerIntervalsAvailable(
  manager: EntityManager,
  siteId: string,
  intervals: Array<{ workerId: string; start: Date; end: Date; excludedScheduleId?: string }>,
) {
  if (!intervals.length) return;
  const workerIds = [...new Set(intervals.map((i) => i.workerId))].sort();
  await manager.query(
    'SELECT pg_advisory_xact_lock(hashtext(key)) FROM unnest($1::text[]) AS keys(key) ORDER BY key',
    [workerIds.map((id) => `${siteId}${id}`)],
  );
  const schedules = await manager
    .getRepository(WorkerScheduleEntity)
    .findBy({ siteId, workerId: In(workerIds), isActive: true });
  const shifts = schedules.length
    ? await manager
        .getRepository(ShiftEntity)
        .findBy({ siteId, id: In([...new Set(schedules.map((s) => s.shiftId))]) })
    : [];
  const excluded = new Set(
    intervals.flatMap((i) => (i.excludedScheduleId ? [i.excludedScheduleId] : [])),
  );
  const windows = schedules
    .filter((s) => !excluded.has(s.id))
    .map((schedule) => {
      const shift = shifts.find((s) => s.id === schedule.shiftId);
      if (!shift) conflict('Assigned shift information unavailable');
      const window = scheduledShiftWindow(shift, schedule.workDate);
      return { workerId: schedule.workerId, start: window.startsAt, end: window.endsAt };
    });
  const overtime = await manager
    .getRepository(OvertimeRequestEntity)
    .findBy({ siteId, workerId: In(workerIds), status: 'APPROVED' });
  const proposed = [...intervals].sort(
    (a, b) => a.workerId.localeCompare(b.workerId) || +a.start - +b.start,
  );
  for (const [index, item] of proposed.entries()) {
    const previous = proposed[index - 1];
    if (previous?.workerId === item.workerId && previous.end > item.start)
      conflict('Worker shifts overlap');
    if (
      windows.some((w) => w.workerId === item.workerId && w.start < item.end && w.end > item.start)
    )
      conflict('Worker shifts overlap');
    if (
      overtime.some(
        (o) =>
          o.workerId === item.workerId &&
          o.scheduleId !== item.excludedScheduleId &&
          o.startsAt < item.end &&
          o.endsAt > item.start,
      )
    )
      conflict('Shift overlaps approved overtime');
  }
}

export async function assertWorkerIntervalAvailable(
  manager: EntityManager,
  siteId: string,
  workerId: string,
  start: Date,
  end: Date,
  excludedScheduleId?: string,
) {
  return assertWorkerIntervalsAvailable(manager, siteId, [
    { workerId, start, end, ...(excludedScheduleId ? { excludedScheduleId } : {}) },
  ]);
}
