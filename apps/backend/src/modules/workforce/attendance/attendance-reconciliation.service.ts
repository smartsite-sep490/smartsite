import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { DataSource, In, MoreThan, type EntityManager } from 'typeorm';
import type { AttendanceDayResponse, AttendanceNotificationEvent } from '@smartsite/contracts';
import {
  AttendanceDayEntity,
  AttendanceEventEntity,
  AttendanceSessionEntity,
  AttendanceCorrectionEntity,
  OvertimeRequestEntity,
  AbsenceRequestEntity,
  GateEventEntity,
  AccessAttemptEntity,
  WorkerEntity,
  WorkerScheduleEntity,
  ShiftEntity,
} from '../../../database/entities/index.js';
import { auditAccess } from '../shared/access-audit.js';
import { SchedulingNotificationService } from '../notifications/scheduling-notification.service.js';
import {
  workedMilliseconds,
  workDateAt,
  scheduledShiftWindow,
  type WorkInterval,
} from './attendance-calculation.js';

@Injectable()
export class AttendanceReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttendanceReconciliationService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly source: DataSource,
    private readonly notifications: SchedulingNotificationService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.runDue(), 60_000);
    this.timer.unref();
    void this.runDue();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async runDue(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      let cursor: string | undefined;
      while (true) {
        const days = await this.source.getRepository(AttendanceDayEntity).find({
          ...(cursor ? { where: { id: MoreThan(cursor) } } : {}),
          order: { id: 'ASC' },
          take: 500,
        });
        if (!days.length) break;
        for (const day of days) {
          try {
            await this.source.transaction(async (manager) => {
              await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
                `mf03:${day.siteId}:${day.workerId}`,
              ]);
              await this.refresh(manager, day.id, now);
            });
          } catch {
            this.logger.error({
              action: 'attendance.reconcile.day_failed',
              dayId: day.id,
              siteId: day.siteId,
            });
          }
        }
        cursor = days[days.length - 1]!.id;
        if (days.length < 500) break;
      }
    } catch {
      this.logger.error({ action: 'attendance.reconcile.failed' });
    } finally {
      this.running = false;
    }
  }
  async notify(
    manager: EntityManager,
    worker: WorkerEntity,
    id: string,
    event: AttendanceNotificationEvent,
    message: string,
    representatives: boolean,
    workDate: string,
    dayId?: string,
  ) {
    await this.notifications.recordAttendance(manager, {
      worker,
      id,
      event,
      message,
      representatives,
      workDate,
      ...(dayId ? { dayId } : {}),
    });
  }
  async notificationsForRequest(
    manager: EntityManager,
    worker: WorkerEntity,
    id: string,
    event: AttendanceNotificationEvent,
    message: string,
    day: AttendanceDayEntity,
  ) {
    await this.notifications.recordAttendance(manager, {
      worker,
      id,
      event,
      message,
      representatives: event === 'TIME_REQUESTED',
      workDate: day.workDate,
      dayId: day.id,
    });
  }
  async ensureDay(
    manager: EntityManager,
    worker: WorkerEntity,
    at: Date,
    schedule?: WorkerScheduleEntity,
    shift?: ShiftEntity,
  ): Promise<AttendanceDayEntity> {
    if (schedule && shift) shift = { ...shift, ...scheduledShiftWindow(shift, schedule.workDate) };
    const timezone = shift?.timezone ?? 'Asia/Ho_Chi_Minh';
    const workDate = schedule?.workDate ?? workDateAt(at, timezone);
    let day = await manager
      .getRepository(AttendanceDayEntity)
      .findOneBy({ siteId: worker.siteId, workerId: worker.id, workDate });
    if (!day)
      day = await manager.getRepository(AttendanceDayEntity).save({
        id: randomUUID(),
        siteId: worker.siteId,
        workerId: worker.id,
        workDate,
        timezone,
        scheduleId: schedule?.id ?? null,
        shiftName: shift?.name ?? null,
        startsAt: shift?.startsAt ?? null,
        endsAt: shift?.endsAt ?? null,
        breakStartsAt: shift?.breakStartsAt ?? null,
        breakEndsAt: shift?.breakEndsAt ?? null,
        status: 'IN_PROGRESS',
        regularMinutes: 0,
        overtimeMinutes: 0,
        provisionalMinutes: 0,
        confirmedMinutes: null,
        anomalies: [],
        version: 1,
        reviewNote: null,
        reviewedBy: null,
        reviewedAt: null,
      });
    return day;
  }
  async recordPassage(
    manager: EntityManager,
    passage: GateEventEntity,
    attempt: AccessAttemptEntity,
    worker: WorkerEntity,
  ) {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `mf03:${worker.siteId}:${worker.id}`,
    ]);
    const existing = await manager
      .getRepository(AttendanceEventEntity)
      .findOneBy({ gateEventId: passage.id });
    if (existing) return;
    const schedules = await manager
      .getRepository(WorkerScheduleEntity)
      .findBy({ workerId: worker.id, siteId: worker.siteId, isActive: true });
    const shifts = schedules.length
      ? await manager
          .getRepository(ShiftEntity)
          .findBy({ id: In(schedules.map((s) => s.shiftId)), siteId: worker.siteId })
      : [];
    const approvedOvertime = schedules.length
      ? await manager
          .getRepository(OvertimeRequestEntity)
          .findBy({ scheduleId: In(schedules.map((s) => s.id)), status: 'APPROVED' })
      : [];
    const choices = schedules
      .flatMap((schedule) => {
        const template = shifts.find((s) => s.id === schedule.shiftId);
        if (!template) return [];
        try {
          return [
            {
              schedule,
              shift: { ...template, ...scheduledShiftWindow(template, schedule.workDate) },
            },
          ];
        } catch {
          this.logger.warn({ action: 'attendance.shift.invalid', scheduleId: schedule.id });
          return [];
        }
      })
      .filter(
        (v) =>
          v.shift &&
          (v.schedule.workDate === workDateAt(passage.occurredAt, v.shift.timezone) ||
            (v.shift.startsAt <= passage.occurredAt && passage.occurredAt <= v.shift.endsAt) ||
            approvedOvertime.some(
              (r) =>
                r.scheduleId === v.schedule.id &&
                r.startsAt <= passage.occurredAt &&
                r.endsAt >= passage.occurredAt,
            )),
      );
    let open = await manager
      .getRepository(AttendanceSessionEntity)
      .createQueryBuilder('session')
      .where(
        'session.site_id=:siteId AND session.worker_id=:workerId AND session.effective_out_at IS NULL AND session.check_out_event_id IS NULL',
        { siteId: worker.siteId, workerId: worker.id },
      )
      .setLock('pessimistic_write')
      .orderBy('session.effectiveInAt', 'DESC')
      .addOrderBy('session.id', 'DESC')
      .getOne();
    const active = choices.filter(
      (v) =>
        (v.shift.startsAt <= passage.occurredAt && v.shift.endsAt > passage.occurredAt) ||
        approvedOvertime.some(
          (r) =>
            r.scheduleId === v.schedule.id &&
            r.startsAt <= passage.occurredAt &&
            r.endsAt > passage.occurredAt,
        ),
    );
    const selected =
      active.length === 1 ? active[0] : choices.length === 1 ? choices[0] : undefined;
    if (open && !open.dayId) {
      const timezone = selected?.shift.timezone ?? 'Asia/Ho_Chi_Minh';
      const newDate = selected?.schedule.workDate ?? workDateAt(passage.occurredAt, timezone);
      if (!open.effectiveInAt || workDateAt(open.effectiveInAt, timezone) !== newDate) open = null;
    }
    if (open?.dayId) {
      const previousDay = await manager
        .getRepository(AttendanceDayEntity)
        .findOneByOrFail({ id: open.dayId });
      const previousEnd = Math.max(
        previousDay.endsAt ? +previousDay.endsAt : 0,
        ...approvedOvertime
          .filter((r) => r.scheduleId === previousDay.scheduleId)
          .map((r) => +r.endsAt),
      );
      const newDate =
        selected?.schedule.workDate ?? workDateAt(passage.occurredAt, previousDay.timezone);
      if (newDate !== previousDay.workDate && +passage.occurredAt >= previousEnd) {
        // Neither IN nor OUT on a new workday repairs yesterday's missing checkout.
        // A still-running overnight shift or approved overtime retains its workday.
        open = null;
      }
    }
    const day = open?.dayId
      ? await manager.getRepository(AttendanceDayEntity).findOneByOrFail({ id: open.dayId })
      : await this.ensureDay(
          manager,
          worker,
          passage.occurredAt,
          selected?.schedule,
          selected?.shift,
        );
    const event = await manager.getRepository(AttendanceEventEntity).save({
      id: randomUUID(),
      siteId: worker.siteId,
      workerId: worker.id,
      workerAssignmentId: attempt.workerAssignmentId,
      shiftAssignmentId: day.scheduleId,
      kind: passage.direction === 'IN' ? 'CHECK_IN' : 'CHECK_OUT',
      method: attempt.method,
      gateEventId: passage.id,
      occurredAt: passage.occurredAt,
      recordedBy: passage.recordedBy,
      reasonCode: passage.direction === 'IN' ? 'NORMAL_CHECK_IN' : 'NORMAL_CHECK_OUT',
    });
    if (
      (passage.direction === 'IN' && open) ||
      (passage.direction === 'OUT' && open?.effectiveInAt && open.effectiveInAt > event.occurredAt)
    ) {
      await manager.getRepository(AttendanceSessionEntity).save({
        id: randomUUID(),
        siteId: worker.siteId,
        workerId: worker.id,
        dayId: day.id,
        shiftAssignmentId: day.scheduleId,
        checkInEventId: passage.direction === 'IN' ? event.id : null,
        checkOutEventId: passage.direction === 'OUT' ? event.id : null,
        effectiveInAt: null,
        effectiveOutAt: event.occurredAt,
        status: passage.direction === 'IN' ? 'NEEDS_REVIEW' : 'MISSING_IN',
        version: 1,
        appliedCorrectionId: null,
      });
    } else {
      if (!open)
        open = manager.getRepository(AttendanceSessionEntity).create({
          id: randomUUID(),
          siteId: worker.siteId,
          workerId: worker.id,
          dayId: day.id,
          shiftAssignmentId: day.scheduleId,
          checkInEventId: null,
          checkOutEventId: null,
          effectiveInAt: null,
          effectiveOutAt: null,
          version: 0,
          appliedCorrectionId: null,
        });
      open.dayId = day.id;
      open.version += 1;
      if (passage.direction === 'IN') {
        open.checkInEventId = event.id;
        open.effectiveInAt = event.occurredAt;
        open.status = 'MISSING_OUT';
      } else {
        open.checkOutEventId = event.id;
        open.effectiveOutAt = event.occurredAt;
        open.status = open.effectiveInAt ? 'MATCHED' : 'MISSING_IN';
      }
      await manager.getRepository(AttendanceSessionEntity).save(open);
    }
    day.reviewedBy = null;
    day.reviewNote = null;
    day.reviewedAt = null;
    await manager.getRepository(AttendanceDayEntity).save(day);
    if (passage.direction === 'OUT' && day.endsAt && passage.occurredAt < day.endsAt)
      await this.notify(
        manager,
        worker,
        event.id,
        'EARLY_EXIT',
        'You left the site before the shift ended. Work time is paused until you return.',
        false,
        day.workDate,
        day.id,
      );
    if (!day.scheduleId)
      await this.notify(
        manager,
        worker,
        day.id,
        'UNSCHEDULED_ENTRY',
        'No assigned shift was found. Attendance is recorded but work hours await schedule reconciliation.',
        true,
        day.workDate,
      );
    await this.refresh(manager, day.id, passage.occurredAt);
    await auditAccess(
      manager,
      passage.recordedBy,
      worker.siteId,
      'ATTENDANCE_RECORDED',
      'attendance_session',
      open?.id ?? day.id,
      null,
      { eventId: event.id, gateEventId: passage.id, dayId: day.id },
    );
  }
  async refresh(
    manager: EntityManager,
    id: string,
    now = new Date(),
  ): Promise<AttendanceDayEntity> {
    const day = await manager
      .getRepository(AttendanceDayEntity)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!day) throw new Error('Attendance day unavailable');
    const before = JSON.stringify([
      day.status,
      day.regularMinutes,
      day.overtimeMinutes,
      day.provisionalMinutes,
      day.confirmedMinutes,
      day.anomalies,
      day.scheduleId,
    ]);
    const worker = await manager
      .getRepository(WorkerEntity)
      .findOneByOrFail({ id: day.workerId, siteId: day.siteId });
    const schedules = await manager.getRepository(WorkerScheduleEntity).findBy({
      workerId: day.workerId,
      siteId: day.siteId,
      workDate: day.workDate,
      isActive: true,
    });
    if (!day.scheduleId && schedules.length === 1 && schedules[0]) {
      try {
        const template = await manager
          .getRepository(ShiftEntity)
          .findOneByOrFail({ id: schedules[0].shiftId, siteId: day.siteId });
        const shift = { ...template, ...scheduledShiftWindow(template, schedules[0].workDate) };
        day.scheduleId = schedules[0].id;
        day.startsAt = shift.startsAt;
        day.endsAt = shift.endsAt;
        day.breakStartsAt = shift.breakStartsAt;
        day.breakEndsAt = shift.breakEndsAt;
        day.timezone = shift.timezone;
        day.shiftName = shift.name;
        await manager
          .getRepository(AttendanceSessionEntity)
          .update({ dayId: day.id }, { shiftAssignmentId: day.scheduleId });
      } catch {
        this.logger.warn({ action: 'attendance.shift.invalid', dayId: day.id });
      }
    }
    const sessions = await manager
      .getRepository(AttendanceSessionEntity)
      .find({ where: { dayId: id }, order: { effectiveInAt: 'ASC' } });
    const overtime = day.scheduleId
      ? await manager.getRepository(OvertimeRequestEntity).findBy({ scheduleId: day.scheduleId })
      : [];
    const leaves = day.scheduleId
      ? await manager
          .getRepository(AbsenceRequestEntity)
          .findBy({ workerScheduleId: day.scheduleId })
      : [];
    const approvedOvertime = overtime.filter((r) => r.status === 'APPROVED');
    const regular: WorkInterval[] =
      day.startsAt && day.endsAt ? [{ start: +day.startsAt, end: +day.endsAt }] : [];
    const overtimeWindows = approvedOvertime.map((r) => ({ start: +r.startsAt, end: +r.endsAt }));
    const leave = leaves
      .filter((r) => r.status === 'APPROVED')
      .flatMap((r) =>
        day.startsAt && day.endsAt
          ? [{ start: +(r.startsAt ?? day.startsAt), end: +(r.endsAt ?? day.endsAt) }]
          : [],
      );
    const end = Math.max(day.endsAt ? +day.endsAt : 0, ...overtimeWindows.map((w) => w.end));
    const closed = sessions
      .filter((s) => s.status !== 'IGNORED' && s.effectiveInAt && s.effectiveOutAt)
      .map((s) => ({ start: +s.effectiveInAt!, end: +s.effectiveOutAt! }));
    const provisional = sessions
      .filter((s) => s.status !== 'IGNORED' && s.effectiveInAt)
      .map((s) => ({ start: +s.effectiveInAt!, end: s.effectiveOutAt ? +s.effectiveOutAt : +now }));
    const regularExclusions = [
      ...leave,
      ...(day.breakStartsAt && day.breakEndsAt
        ? [{ start: +day.breakStartsAt, end: +day.breakEndsAt }]
        : []),
    ];
    const regularMs = workedMilliseconds(closed, regular, regularExclusions);
    const overtimeMs = workedMilliseconds(closed, overtimeWindows, leave);
    day.regularMinutes = Math.floor(regularMs / 60000);
    day.overtimeMinutes = Math.floor((regularMs + overtimeMs) / 60000) - day.regularMinutes;
    day.provisionalMinutes = Math.floor(
      (workedMilliseconds(provisional, regular, regularExclusions) +
        workedMilliseconds(provisional, overtimeWindows, leave)) /
        60000,
    );
    const anomalies: string[] = [];
    if (!day.scheduleId) anomalies.push('NO_SCHEDULE');
    if (schedules.length > 1) anomalies.push('MULTIPLE_SHIFTS');
    const currentSchedule = day.scheduleId
      ? await manager.getRepository(WorkerScheduleEntity).findOneBy({ id: day.scheduleId })
      : null;
    const fullLeave = leave.some(
      (l) => day.startsAt && day.endsAt && l.start <= +day.startsAt && l.end >= +day.endsAt,
    );
    if (currentSchedule && !fullLeave) {
      const template = await manager
        .getRepository(ShiftEntity)
        .findOneBy({ id: currentSchedule.shiftId });
      let shift: ShiftEntity | null = null;
      try {
        shift = template
          ? { ...template, ...scheduledShiftWindow(template, currentSchedule.workDate) }
          : null;
      } catch {
        this.logger.warn({ action: 'attendance.shift.invalid', dayId: day.id });
      }
      if (
        !currentSchedule.isActive ||
        !shift ||
        +shift.startsAt !== +(day.startsAt ?? 0) ||
        +shift.endsAt !== +(day.endsAt ?? 0) ||
        +(shift.breakStartsAt ?? 0) !== +(day.breakStartsAt ?? 0) ||
        +(shift.breakEndsAt ?? 0) !== +(day.breakEndsAt ?? 0)
      )
        anomalies.push('SCHEDULE_CHANGED');
    }
    if (sessions.some((s) => s.status === 'MISSING_IN')) anomalies.push('MISSING_IN');
    if (sessions.some((s) => s.status === 'NEEDS_REVIEW')) anomalies.push('DUPLICATE_IN');
    const open = sessions.some((s) => s.effectiveInAt && !s.effectiveOutAt);
    if (+now >= end && open) anomalies.push('MISSING_OUT');
    const finalOut = Math.max(
      0,
      ...sessions.filter((s) => s.effectiveOutAt && s.effectiveInAt).map((s) => +s.effectiveOutAt!),
    );
    const requiredEnd = [...leave]
      .sort((a, b) => b.end - a.end)
      .reduce((last, l) => (l.end >= last && l.start < last ? l.start : last), end);
    if (day.scheduleId && +now >= end && !open && !fullLeave && finalOut < requiredEnd)
      anomalies.push('EARLY_CHECKOUT');
    const correctionPending = sessions.length
      ? await manager
          .getRepository(AttendanceCorrectionEntity)
          .existsBy({ attendanceSessionId: In(sessions.map((s) => s.id)), status: 'PENDING' })
      : false;
    if (
      correctionPending ||
      overtime.some((r) => r.status === 'PENDING') ||
      leaves.some((r) => r.status === 'PENDING_MANAGER')
    )
      anomalies.push('PENDING_REQUEST');
    day.anomalies = anomalies;
    const blocking = anomalies.filter((a) => !(a === 'EARLY_CHECKOUT' && day.reviewedBy));
    day.status = blocking.length ? 'NEEDS_REVIEW' : +now < end ? 'IN_PROGRESS' : 'CONFIRMED';
    day.confirmedMinutes =
      day.status === 'CONFIRMED' ? Math.floor((regularMs + overtimeMs) / 60000) : null;
    const after = JSON.stringify([
      day.status,
      day.regularMinutes,
      day.overtimeMinutes,
      day.provisionalMinutes,
      day.confirmedMinutes,
      day.anomalies,
      day.scheduleId,
    ]);
    if (before !== after) day.version += 1;
    await manager.getRepository(AttendanceDayEntity).save(day);
    if (day.confirmedMinutes !== null)
      await manager.query(
        `INSERT INTO timesheet(id,site_id,worker_id,period_start,period_end,total_minutes,status,attendance_day_id) VALUES($1,$2,$3,$4,$4,$5,'APPROVED',$6) ON CONFLICT(attendance_day_id) DO UPDATE SET total_minutes=EXCLUDED.total_minutes,status='APPROVED'`,
        [randomUUID(), day.siteId, day.workerId, day.workDate, day.confirmedMinutes, day.id],
      );
    else
      await manager.query(
        "UPDATE timesheet SET total_minutes=0,status='DRAFT' WHERE attendance_day_id=$1",
        [day.id],
      );
    if (open && day.endsAt && +now >= end + 5 * 60000)
      await this.notify(
        manager,
        worker,
        day.id,
        'MISSING_CHECKOUT',
        'The shift ended more than five minutes ago and checkout is missing. Hours remain provisional.',
        true,
        day.workDate,
      );
    return day;
  }
  response(
    day: AttendanceDayEntity,
    worker: WorkerEntity,
    inside: boolean,
    canRequest: boolean,
  ): AttendanceDayResponse {
    return {
      id: day.id,
      workerId: worker.id,
      workerName: worker.displayName,
      workDate: day.workDate,
      timezone: day.timezone,
      scheduleId: day.scheduleId,
      shiftName: day.shiftName,
      startsAt: day.startsAt?.toISOString() ?? null,
      endsAt: day.endsAt?.toISOString() ?? null,
      breakStartsAt: day.breakStartsAt?.toISOString() ?? null,
      breakEndsAt: day.breakEndsAt?.toISOString() ?? null,
      status: day.status,
      regularMinutes: day.regularMinutes,
      overtimeMinutes: day.overtimeMinutes,
      provisionalMinutes: day.provisionalMinutes,
      confirmedMinutes: day.confirmedMinutes,
      presence: inside ? 'INSIDE' : 'OUTSIDE',
      anomalies: day.anomalies,
      version: day.version,
      canRequest,
    };
  }
}
