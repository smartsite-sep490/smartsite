import {
  leaveNotice,
  timeRequestTimingIssue,
  TIME_REQUEST_TIMING_MESSAGES,
} from '@smartsite/contracts';
import { Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { randomUUID } from 'node:crypto';
import { requireWorkerDocuments } from '../documents/worker-compliance.js';
import { DataSource, In } from 'typeorm';
import type {
  AttendanceDaysResponse,
  AttendanceTimeRequestsResponse,
  AttendanceTimeRequestResponse,
  AttendanceDayDetailResponse,
  AttendanceTimesheetResponse,
} from '@smartsite/contracts';
import {
  AttendanceDayEntity,
  AttendanceSessionEntity,
  AttendanceEventEntity,
  AttendanceCorrectionEntity,
  AttendanceAbsenceReviewEntity,
  AccessAuditEntity,
  UserEntity,
  OvertimeRequestEntity,
  AbsenceRequestEntity,
  AbsenceRequestStatus,
  WorkerEntity,
  WorkerScheduleEntity,
  ShiftEntity,
} from '../../../database/entities/index.js';
import {
  command,
  conflict,
  invalid,
  missing,
  uuid,
  knownUnique,
} from '../../../common/configuration/commands.js';
import type { WorkforceActor } from '../directory/contractor-operations.service.js';
import { attendanceAccess } from './attendance-access.js';
import { canAcknowledgeEarlyCheckout } from './attendance-review-policy.js';
import { attendanceGateAbsenceContext, canConfirmGateAbsence } from './attendance-gate-review.js';
import {
  attendanceZoneReviewContext,
  canConfirmZoneHours,
  ZONE_HOURS_REVIEW_ACTION,
} from './attendance-zone-review.js';
import { AttendanceReconciliationService } from './attendance-reconciliation.service.js';
import {
  AttendanceDaysDto,
  AttendanceTimeRequestsDto,
  AttendanceTimeRequestDto,
  ReviewAttendanceDayDto,
  ConfirmAttendanceAbsenceDto,
  ConfirmAttendanceZoneHoursDto,
  IgnoreDuplicateAttendanceDto,
  ReviewAttendanceTimeDto,
} from './dto/attendance.dto.js';
import { auditAccess } from '../shared/access-audit.js';
import { workDateAt, scheduledShiftWindow } from './attendance-calculation.js';
import { assertWorkerLeaveAvailable, workerRequests } from './worker-requests.js';
import { WorkerRequestsDto } from './dto/attendance.dto.js';
import { coveredPendingLeaveSql } from '../shared/leave-display.js';

@Injectable()
export class AttendanceDaysService {
  constructor(
    private readonly source: DataSource,
    private readonly reconciliation: AttendanceReconciliationService,
  ) {}
  async myRequests(actor: WorkforceActor, siteIdValue: string, input: WorkerRequestsDto) {
    const siteId = uuid(siteIdValue),
      value = command(WorkerRequestsDto, input);
    const worker = await this.source
      .getRepository(WorkerEntity)
      .findOneBy({ siteId, userId: actor.id, isActive: true });
    if (!worker || (await attendanceAccess(this.source.manager, actor, worker)) !== 'SELF')
      throw new PublicHttpException(403, {
        code: 'FORBIDDEN',
        message: 'Worker request history is outside your scope',
      });
    return workerRequests(this.source.manager, worker, actor.id, value);
  }
  private duplicate(session: AttendanceSessionEntity) {
    return (
      session.status === 'NEEDS_REVIEW' &&
      !!session.checkInEventId &&
      !session.checkOutEventId &&
      !session.effectiveInAt &&
      !!session.effectiveOutAt
    );
  }
  async timeRequests(
    actor: WorkforceActor,
    siteIdValue: string,
    input: AttendanceTimeRequestsDto,
  ): Promise<AttendanceTimeRequestsResponse> {
    const siteId = uuid(siteIdValue),
      value = command(AttendanceTimeRequestsDto, input);
    const workers = await this.source.getRepository(WorkerEntity).findBy({
      siteId,
      isActive: true,
      ...(value.workerId ? { id: value.workerId } : {}),
    });
    const visible: WorkerEntity[] = [];
    const selfWorkerIds: string[] = [];
    for (const worker of workers) {
      try {
        const access = await attendanceAccess(this.source.manager, actor, worker);
        if (access === 'SELF') selfWorkerIds.push(worker.id);
        visible.push(worker);
      } catch (error) {
        if (!(error instanceof PublicHttpException && error.getStatus() === 403)) throw error;
      }
    }
    if (!visible.length) return { items: [], total: 0 };
    const where = {
      siteId,
      workerId: In(visible.map((w) => w.id)),
      ...(value.requestId ? { id: value.requestId } : {}),
    };
    const page = {
      skip: value.offset ?? 0,
      take: value.limit ?? 20,
      order: { createdAt: 'DESC' as const, id: 'ASC' as const },
    };
    if (value.kind === 'OVERTIME') {
      const [requests, total] = await this.source
        .getRepository(OvertimeRequestEntity)
        .findAndCount({
          where: { ...where, ...(value.status ? { status: value.status } : {}) },
          ...page,
        });
      return {
        total,
        items: requests.map((r) => ({
          id: r.id,
          kind: 'OVERTIME',
          createdAt: r.createdAt.toISOString(),
          requestedByUserId: r.requestedBy,
          workerId: r.workerId,
          workerName: visible.find((w) => w.id === r.workerId)!.displayName,
          scheduleId: r.scheduleId,
          startsAt: r.startsAt.toISOString(),
          endsAt: r.endsAt.toISOString(),
          reason: r.reason,
          status: r.status,
          reviewNote: r.reviewNote,
        })),
      };
    }
    const status =
      value.status === 'PENDING'
        ? AbsenceRequestStatus.PENDING_MANAGER
        : value.status === 'APPROVED'
          ? AbsenceRequestStatus.APPROVED
          : AbsenceRequestStatus.REJECTED;
    const leaveQuery = this.source
      .getRepository(AbsenceRequestEntity)
      .createQueryBuilder('request')
      .where({ ...where, ...(value.status ? { status } : {}) });
    if (!value.requestId && selfWorkerIds.length) {
      leaveQuery.andWhere(
        `NOT (request.worker_id IN (:...selfWorkerIds) AND ${coveredPendingLeaveSql('request')})`,
        { selfWorkerIds },
      );
    }
    const [requests, total] = await leaveQuery
      .orderBy('request.createdAt', 'DESC')
      .addOrderBy('request.id', 'ASC')
      .skip(page.skip)
      .take(page.take)
      .getManyAndCount();
    const schedules = requests.length
      ? await this.source.getRepository(WorkerScheduleEntity).findBy({
          siteId,
          id: In(requests.map((r) => r.workerScheduleId)),
        })
      : [];
    const shifts = requests.length
      ? await this.source.getRepository(ShiftEntity).findBy({
          siteId,
          id: In(requests.map((r) => r.shiftId)),
        })
      : [];
    return {
      total,
      items: requests.map((r) => {
        const schedule = schedules.find((s) => s.id === r.workerScheduleId);
        const template = shifts.find((s) => s.id === r.shiftId);
        if (!schedule || !template) missing();
        const shift = scheduledShiftWindow(template, schedule.workDate);
        return {
          id: r.id,
          kind: 'LEAVE' as const,
          noticeType: r.noticeType,
          shortNotice: r.shortNotice,
          createdAt: r.createdAt.toISOString(),
          requestedByUserId: r.requestedByUserId,
          submittedOnBehalf:
            visible.find((w) => w.id === r.workerId)!.userId !== r.requestedByUserId,
          workerId: r.workerId,
          workerName: visible.find((w) => w.id === r.workerId)!.displayName,
          scheduleId: r.workerScheduleId,
          startsAt: (r.startsAt ?? shift.startsAt).toISOString(),
          endsAt: (r.endsAt ?? shift.endsAt).toISOString(),
          reason: r.reason,
          status: r.status,
          reviewNote: r.reviewNote,
        };
      }),
    };
  }
  async ignoreDuplicate(
    actor: WorkforceActor,
    siteIdValue: string,
    idValue: string,
    input: IgnoreDuplicateAttendanceDto,
  ) {
    const siteId = uuid(siteIdValue),
      id = uuid(idValue),
      value = command(IgnoreDuplicateAttendanceDto, input);
    return this.source.transaction(async (manager) => {
      const seed = await manager.getRepository(AttendanceSessionEntity).findOneBy({ id, siteId });
      if (!seed?.dayId) missing();
      const worker = await manager
        .getRepository(WorkerEntity)
        .findOne({ where: { id: seed.workerId, siteId }, lock: { mode: 'pessimistic_write' } });
      if (!worker) missing();
      await attendanceAccess(manager, actor, worker, true);
      if (worker.userId === actor.id) conflict('Workers cannot review their own attendance');
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `mf03:${siteId}:${worker.id}`,
      ]);
      const session = await manager
        .getRepository(AttendanceSessionEntity)
        .findOne({ where: { id, siteId }, lock: { mode: 'pessimistic_write' } });
      if (!session?.dayId) missing();
      if (session.status === 'IGNORED') {
        if (
          session.ignoredBy === actor.id &&
          session.ignoreReason === value.reason &&
          session.version === value.expectedSessionVersion + 1
        )
          return { id };
        conflict('Duplicate entry has already been reviewed');
      }
      if (session.version !== value.expectedSessionVersion)
        conflict('Attendance changed; reload before reviewing');
      if (!this.duplicate(session)) conflict('Only an unresolved duplicate IN can be ignored');
      const event = await manager
        .getRepository(AttendanceEventEntity)
        .findOneBy({ id: session.checkInEventId!, siteId, workerId: worker.id, kind: 'CHECK_IN' });
      if (!event || +event.occurredAt !== +session.effectiveOutAt!)
        conflict('Duplicate evidence is inconsistent');
      if (
        await manager
          .getRepository(AttendanceCorrectionEntity)
          .existsBy({ attendanceSessionId: id, status: 'PENDING' })
      )
        conflict('Resolve the pending correction before ignoring this entry');
      session.status = 'IGNORED';
      session.ignoredBy = actor.id;
      session.ignoredAt = new Date();
      session.ignoreReason = value.reason;
      session.version += 1;
      await manager.getRepository(AttendanceSessionEntity).save(session);
      await auditAccess(
        manager,
        actor.id,
        siteId,
        'ATTENDANCE_DUPLICATE_IGNORED',
        'attendance_session',
        id,
        value.reason,
        {
          dayId: session.dayId,
          eventId: event.id,
          previousStatus: 'NEEDS_REVIEW',
          status: 'IGNORED',
          previousVersion: value.expectedSessionVersion,
          version: session.version,
        },
      );
      const day = await this.reconciliation.refresh(manager, session.dayId);
      await this.reconciliation.notificationsForRequest(
        manager,
        worker,
        session.id,
        'TIME_APPROVED',
        `Duplicate IN ignored: ${value.reason}`,
        day,
      );
      return { id };
    });
  }
  async list(
    actor: WorkforceActor,
    siteIdValue: string,
    input: AttendanceDaysDto,
  ): Promise<AttendanceDaysResponse> {
    const siteId = uuid(siteIdValue);
    const value = command(AttendanceDaysDto, input);
    if (value.fromDate && value.toDate && value.fromDate > value.toDate)
      invalid('Invalid date range');
    const workers = await this.source
      .getRepository(WorkerEntity)
      .findBy({ siteId, isActive: true, ...(value.workerId ? { id: value.workerId } : {}) });
    const visible: WorkerEntity[] = [];
    let canReview = false;
    let canRequest = false;
    for (const worker of workers) {
      try {
        const access = await attendanceAccess(this.source.manager, actor, worker);
        visible.push(worker);
        try {
          await attendanceAccess(this.source.manager, actor, worker, true);
          canReview = true;
        } catch (error) {
          if (!(error instanceof PublicHttpException && error.getStatus() === 403)) throw error;
        }
        if (access === 'SELF') canRequest = true;
      } catch (error) {
        if (!(error instanceof Error && 'getStatus' in error)) throw error;
      }
    }
    if (!visible.length)
      return { items: [], total: 0, requests: [], canReview: false, canRequest: false };
    const query = this.source
      .getRepository(AttendanceDayEntity)
      .createQueryBuilder('day')
      .where('day.site_id=:siteId AND day.worker_id IN (:...workers)', {
        siteId,
        workers: visible.map((w) => w.id),
      });
    if (value.fromDate) query.andWhere('day.work_date>=:from', { from: value.fromDate });
    if (value.toDate) query.andWhere('day.work_date<=:to', { to: value.toDate });
    if (value.status) query.andWhere('day.status=:status', { status: value.status });
    const [days, total] = await query
      .orderBy('day.workDate', 'DESC')
      .addOrderBy('day.id', 'ASC')
      .skip(value.offset ?? 0)
      .take(value.limit ?? 20)
      .getManyAndCount();
    const ids = visible.map((w) => w.id);
    const overtime = await this.source
      .getRepository(OvertimeRequestEntity)
      .find({ where: { siteId, workerId: In(ids) }, order: { createdAt: 'DESC' }, take: 100 });
    const leaves = await this.source
      .getRepository(AbsenceRequestEntity)
      .find({ where: { siteId, workerId: In(ids) }, order: { createdAt: 'DESC' }, take: 100 });
    const schedules = await this.source
      .getRepository(WorkerScheduleEntity)
      .findBy({ siteId, workerId: In(ids) });
    const shifts = schedules.length
      ? await this.source
          .getRepository(ShiftEntity)
          .findBy({ siteId, id: In(schedules.map((s) => s.shiftId)) })
      : [];
    const requests: AttendanceTimeRequestResponse[] = [
      ...overtime.map((r) => ({
        id: r.id,
        kind: 'OVERTIME' as const,
        createdAt: r.createdAt.toISOString(),
        requestedByUserId: r.requestedBy,
        workerId: r.workerId,
        workerName: visible.find((w) => w.id === r.workerId)!.displayName,
        scheduleId: r.scheduleId,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        reason: r.reason,
        status: r.status,
        reviewNote: r.reviewNote,
      })),
      ...leaves.flatMap((r) => {
        const template = shifts.find((s) => s.id === r.shiftId);
        const schedule = schedules.find((s) => s.id === r.workerScheduleId);
        const shift =
          template && schedule
            ? { ...template, ...scheduledShiftWindow(template, schedule.workDate) }
            : null;
        return shift
          ? [
              {
                id: r.id,
                kind: 'LEAVE' as const,
                noticeType: r.noticeType,
                shortNotice: r.shortNotice,
                createdAt: r.createdAt.toISOString(),
                requestedByUserId: r.requestedByUserId,
                submittedOnBehalf:
                  visible.find((w) => w.id === r.workerId)!.userId !== r.requestedByUserId,
                workerId: r.workerId,
                workerName: visible.find((w) => w.id === r.workerId)!.displayName,
                scheduleId: r.workerScheduleId,
                startsAt: (r.startsAt ?? shift.startsAt).toISOString(),
                endsAt: (r.endsAt ?? shift.endsAt).toISOString(),
                reason: r.reason,
                status: r.status,
                reviewNote: r.reviewNote,
              },
            ]
          : [];
      }),
    ];
    const open = days.length
      ? await this.source
          .getRepository(AttendanceSessionEntity)
          .createQueryBuilder('s')
          .where('s.day_id IN (:...ids) AND s.effective_out_at IS NULL', {
            ids: days.map((d) => d.id),
          })
          .getMany()
      : [];
    return {
      items: days.map((d) => {
        const w = visible.find((w) => w.id === d.workerId)!;
        return this.reconciliation.response(
          d,
          w,
          open.some((s) => s.dayId === d.id),
          w.userId === actor.id,
        );
      }),
      total,
      requests,
      canReview,
      canRequest,
    };
  }
  async detail(
    actor: WorkforceActor,
    siteIdValue: string,
    idValue: string,
  ): Promise<AttendanceDayDetailResponse> {
    const siteId = uuid(siteIdValue),
      id = uuid(idValue);
    const day = await this.source.getRepository(AttendanceDayEntity).findOneBy({ id, siteId });
    if (!day) missing();
    const worker = await this.source
      .getRepository(WorkerEntity)
      .findOneBy({ id: day.workerId, siteId });
    if (!worker) missing();
    const access = await attendanceAccess(this.source.manager, actor, worker);
    let canReview = false;
    try {
      await attendanceAccess(this.source.manager, actor, worker, true);
      canReview = true;
    } catch (error) {
      if (!(error instanceof PublicHttpException && error.getStatus() === 403)) throw error;
    }
    const schedule = day.scheduleId
      ? await this.source.getRepository(WorkerScheduleEntity).findOneBy({
          id: day.scheduleId,
          siteId,
          workerId: worker.id,
        })
      : null;
    const template = schedule
      ? await this.source.getRepository(ShiftEntity).findOneBy({
          id: schedule.shiftId,
          siteId,
        })
      : null;
    let currentSchedule: AttendanceDayDetailResponse['currentSchedule'] = null;
    if (schedule && template) {
      let window: ReturnType<typeof scheduledShiftWindow> | null = null;
      try {
        window = scheduledShiftWindow(template, schedule.workDate);
      } catch {
        /* Invalid shift stays unavailable. */
      }
      currentSchedule = {
        id: schedule.id,
        workDate: schedule.workDate,
        isActive: schedule.isActive,
        shiftName: template.name,
        timezone: template.timezone,
        startsAt: window?.startsAt.toISOString() ?? null,
        endsAt: window?.endsAt.toISOString() ?? null,
      };
    }
    const sessions = await this.source
      .getRepository(AttendanceSessionEntity)
      .find({ where: { dayId: id }, order: { createdAt: 'ASC' } });
    const eventIds = sessions
      .flatMap((s) => [s.checkInEventId, s.checkOutEventId])
      .filter((id): id is string => !!id);
    const rawEvents = eventIds.length
      ? await this.source.getRepository(AttendanceEventEntity).findBy({ id: In(eventIds) })
      : [];
    const gateReview = await attendanceGateAbsenceContext(this.source.manager, day);
    const zoneReview = await attendanceZoneReviewContext(this.source.manager, day);
    const zoneReviewer = zoneReview?.decision?.actorAccountId
      ? await this.source
          .getRepository(UserEntity)
          .findOneBy({ id: zoneReview.decision.actorAccountId })
      : null;
    return {
      currentSchedule,
      ...(zoneReview &&
      ((day.anomalies.includes('ZONE_ATTENDANCE_PENDING') &&
        zoneReview.complete &&
        !zoneReview.record) ||
        zoneReview.decision)
        ? {
            zoneAttendanceReview: {
              canConfirm:
                canReview &&
                worker.userId !== actor.id &&
                canConfirmZoneHours(day, zoneReview, new Date()),
              status: zoneReview.conflicted
                ? ('CONFLICTED' as const)
                : zoneReview.resolved || (zoneReview.decision && day.status === 'CONFIRMED')
                  ? ('CONFIRMED' as const)
                  : ('PENDING' as const),
              evidenceHash: zoneReview.evidenceHash,
              gateInCount: zoneReview.gateInCount,
              gateOutCount: zoneReview.gateOutCount,
              sessionCount: zoneReview.sessionCount,
              regularMinutes: day.regularMinutes,
              overtimeMinutes: day.overtimeMinutes,
              teamAttendanceStatus: zoneReview.record?.status ?? ('NOT_YET' as const),
              ...(zoneReview.decision
                ? {
                    decision: {
                      reviewedBy: zoneReview.decision.actorAccountId!,
                      ...(zoneReviewer ? { reviewedByName: zoneReviewer.displayName } : {}),
                      reviewedAt: zoneReview.decision.occurredAt.toISOString(),
                      reason: zoneReview.decision.reason!,
                    },
                  }
                : {}),
            },
          }
        : {}),
      ...(gateReview &&
      ((day.anomalies.includes('ZONE_GATE_MISSING') && gateReview.noEvidence) ||
        gateReview.decision)
        ? {
            gateAbsenceReview: {
              canConfirm:
                canReview &&
                worker.userId !== actor.id &&
                canConfirmGateAbsence(day, gateReview, new Date()),
              gateEventCount: gateReview.gateEventCount,
              attendanceEventCount: gateReview.attendanceEventCount,
              sessionCount: gateReview.sessionCount,
              status: gateReview.conflicted
                ? ('CONFLICTED' as const)
                : gateReview.resolved || (gateReview.decision && day.status === 'ABSENT')
                  ? ('CONFIRMED_ABSENT' as const)
                  : ('PENDING' as const),
              ...(gateReview.record
                ? {
                    teamAttendance: {
                      version: gateReview.record.version,
                      status: gateReview.record.status,
                      recordedBy: gateReview.record.updatedBy,
                      recordedAt: gateReview.record.updatedAt.toISOString(),
                    },
                  }
                : {}),
              ...(gateReview.decision
                ? {
                    decision: {
                      reviewedBy: gateReview.decision.reviewedBy,
                      reviewedAt: gateReview.decision.reviewedAt.toISOString(),
                      reason: gateReview.decision.reason,
                    },
                  }
                : {}),
            },
          }
        : {}),
      canAcknowledgeEarlyCheckout:
        canReview &&
        worker.userId !== actor.id &&
        day.status === 'NEEDS_REVIEW' &&
        canAcknowledgeEarlyCheckout(day.anomalies),
      day: this.reconciliation.response(
        day,
        worker,
        sessions.some((s) => s.effectiveInAt && !s.effectiveOutAt),
        access === 'SELF',
      ),
      sessions: sessions.map((s) => ({
        id: s.id,
        workerId: worker.id,
        workerName: worker.displayName,
        dayId: id,
        effectiveInAt: s.effectiveInAt?.toISOString() ?? null,
        effectiveOutAt: s.effectiveOutAt?.toISOString() ?? null,
        status: s.status,
        version: s.version,
        rawInAt:
          rawEvents.find((event) => event.id === s.checkInEventId)?.occurredAt.toISOString() ??
          null,
        rawOutAt:
          rawEvents.find((event) => event.id === s.checkOutEventId)?.occurredAt.toISOString() ??
          null,
        canIgnoreDuplicate: canReview && worker.userId !== actor.id && this.duplicate(s),
        ignoredBy: s.ignoredBy,
        ignoredAt: s.ignoredAt?.toISOString() ?? null,
        ignoreReason: s.ignoreReason,
        workedMinutes:
          s.effectiveInAt && s.effectiveOutAt
            ? Math.floor((+s.effectiveOutAt - +s.effectiveInAt) / 60000)
            : null,
      })),
    };
  }
  async timesheets(
    actor: WorkforceActor,
    siteIdValue: string,
    input: AttendanceDaysDto,
  ): Promise<AttendanceTimesheetResponse> {
    const siteId = uuid(siteIdValue),
      value = command(AttendanceDaysDto, input);
    if (value.fromDate && value.toDate && value.fromDate > value.toDate)
      invalid('Invalid date range');
    const workers = await this.source
      .getRepository(WorkerEntity)
      .findBy({ siteId, isActive: true, ...(value.workerId ? { id: value.workerId } : {}) });
    const visible: WorkerEntity[] = [];
    for (const worker of workers) {
      try {
        await attendanceAccess(this.source.manager, actor, worker);
        visible.push(worker);
      } catch (error) {
        if (!(error instanceof Error && 'getStatus' in error)) throw error;
      }
    }
    if (!visible.length) return { items: [] };
    const query = this.source
      .getRepository(AttendanceDayEntity)
      .createQueryBuilder('day')
      .select('day.worker_id', 'workerId')
      .addSelect('COUNT(*)', 'confirmedDays')
      .addSelect('SUM(day.regular_minutes)', 'regularMinutes')
      .addSelect('SUM(day.overtime_minutes)', 'overtimeMinutes')
      .addSelect('SUM(day.confirmed_minutes)', 'totalMinutes')
      .where("day.site_id=:siteId AND day.worker_id IN (:...ids) AND day.status='CONFIRMED'", {
        siteId,
        ids: visible.map((w) => w.id),
      })
      .groupBy('day.worker_id');
    if (value.fromDate) query.andWhere('day.work_date>=:from', { from: value.fromDate });
    if (value.toDate) query.andWhere('day.work_date<=:to', { to: value.toDate });
    const rows = await query.getRawMany<{
      workerId: string;
      confirmedDays: string;
      regularMinutes: string;
      overtimeMinutes: string;
      totalMinutes: string;
    }>();
    return {
      items: rows.map((r) => ({
        workerId: r.workerId,
        workerName: visible.find((w) => w.id === r.workerId)!.displayName,
        confirmedDays: Number(r.confirmedDays),
        regularMinutes: Number(r.regularMinutes),
        overtimeMinutes: Number(r.overtimeMinutes),
        totalMinutes: Number(r.totalMinutes),
      })),
    };
  }
  async request(actor: WorkforceActor, siteIdValue: string, input: AttendanceTimeRequestDto) {
    const siteId = uuid(siteIdValue),
      value = command(AttendanceTimeRequestDto, input);
    return this.source.transaction(async (manager) => {
      const schedule = await manager
        .getRepository(WorkerScheduleEntity)
        .findOneBy({ id: value.workerScheduleId, siteId });
      if (!schedule) missing();
      const worker = await manager
        .getRepository(WorkerEntity)
        .findOne({ where: { id: schedule.workerId, siteId }, lock: { mode: 'pessimistic_write' } });
      if (!worker) missing();
      const access = await attendanceAccess(manager, actor, worker);
      if (access !== 'SELF' && !(value.kind === 'LEAVE' && access === 'REPRESENTATIVE'))
        conflict('Workers submit their own time requests; representatives may record leave');
      if (access === 'SELF') await requireWorkerDocuments(manager, worker);
      if (value.kind === 'OVERTIME' && value.noticeType)
        invalid('Notice type is only applicable to leave');
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `mf03:${siteId}:${worker.id}`,
      ]);
      const template = await manager
        .getRepository(ShiftEntity)
        .findOneByOrFail({ id: schedule.shiftId, siteId });
      const shift = { ...template, ...scheduledShiftWindow(template, schedule.workDate) };
      const start = new Date(value.startsAt),
        end = new Date(value.endsAt);
      if (end <= start) invalid('Request end must follow start');
      const repo =
        value.kind === 'OVERTIME'
          ? manager.getRepository(OvertimeRequestEntity)
          : manager.getRepository(AbsenceRequestEntity);
      const old = await repo.findOneBy({ id: value.requestId });
      if (old) {
        const binding = 'scheduleId' in old ? old.scheduleId : old.workerScheduleId;
        const requester = 'requestedBy' in old ? old.requestedBy : old.requestedByUserId;
        if (
          binding !== schedule.id ||
          requester !== actor.id ||
          old.reason !== value.reason ||
          +old.startsAt! !== +start ||
          +old.endsAt! !== +end ||
          ('noticeType' in old && (old.noticeType ?? 'PLANNED') !== (value.noticeType ?? 'PLANNED'))
        )
          conflict('Request ID was used for different details');
        return { id: old.id };
      }
      if (!schedule.isActive) conflict('Schedule is inactive');
      const submittedAt = new Date();
      const timingIssue = timeRequestTimingIssue(shift, value.kind, value.noticeType, submittedAt);
      if (timingIssue) conflict(TIME_REQUEST_TIMING_MESSAGES[timingIssue]);
      if (value.kind === 'LEAVE' && access === 'SELF')
        await assertWorkerLeaveAvailable(manager, worker, actor.id);
      if (
        value.kind === 'OVERTIME' &&
        (start <= submittedAt || (start < shift.endsAt && end > shift.startsAt))
      )
        conflict(
          'Overtime must be requested and approved before it starts, outside the regular shift',
        );
      if (
        value.kind === 'OVERTIME' &&
        workDateAt(start, shift.timezone) !==
          workDateAt(start >= shift.endsAt ? shift.endsAt : shift.startsAt, shift.timezone)
      )
        conflict('Overtime must belong to the assigned shift day');
      if (value.kind === 'LEAVE' && (start < shift.startsAt || end > shift.endsAt))
        invalid('Leave must be inside the shift');
      const day = await this.reconciliation.ensureDay(
        manager,
        worker,
        shift.startsAt,
        schedule,
        shift,
      );
      if (value.kind === 'OVERTIME')
        await manager.getRepository(OvertimeRequestEntity).save({
          id: value.requestId,
          siteId,
          workerId: worker.id,
          scheduleId: schedule.id,
          expectedShiftId: shift.id,
          startsAt: start,
          endsAt: end,
          requestedBy: actor.id,
          reason: value.reason,
          status: 'PENDING',
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
        });
      else
        await manager.getRepository(AbsenceRequestEntity).save({
          ...leaveNotice(shift.startsAt, value.noticeType, submittedAt),
          id: value.requestId,
          siteId,
          workerId: worker.id,
          workerScheduleId: schedule.id,
          shiftId: shift.id,
          expectedScheduleVersionId: schedule.scheduleVersionId,
          replacementWorkerId: null,
          requestedByUserId: actor.id,
          reason: value.reason,
          status: AbsenceRequestStatus.PENDING_MANAGER,
          isUnderstaffed: false,
          reviewedByUserId: null,
          reviewedAt: null,
          startsAt: start,
          endsAt: end,
          reviewNote: null,
        });
      day.reviewedBy = null;
      day.reviewNote = null;
      day.reviewedAt = null;
      await manager.getRepository(AttendanceDayEntity).save(day);
      await this.reconciliation.notificationsForRequest(
        manager,
        worker,
        value.requestId,
        'TIME_REQUESTED',
        `${worker.displayName} requested ${value.kind.toLowerCase()}: ${value.reason}`,
        day,
      );
      await this.reconciliation.refresh(manager, day.id);
      await auditAccess(
        manager,
        actor.id,
        siteId,
        'ATTENDANCE_TIME_REQUESTED',
        value.kind === 'OVERTIME' ? 'overtime_request' : 'absence_request',
        value.requestId,
        value.reason,
        { dayId: day.id, submittedOnBehalf: worker.userId !== actor.id },
      );
      return { id: value.requestId };
    });
  }
  async review(
    actor: WorkforceActor,
    siteIdValue: string,
    idValue: string,
    kind: 'OVERTIME' | 'LEAVE',
    input: ReviewAttendanceTimeDto,
  ) {
    const siteId = uuid(siteIdValue),
      id = uuid(idValue),
      value = command(ReviewAttendanceTimeDto, input);
    const reviewNote = value.reviewNote ?? null;
    if (!['OVERTIME', 'LEAVE'].includes(kind)) invalid('Invalid request kind');
    return this.source.transaction(async (manager) => {
      const seed =
        kind === 'OVERTIME'
          ? await manager.getRepository(OvertimeRequestEntity).findOneBy({ id, siteId })
          : await manager.getRepository(AbsenceRequestEntity).findOneBy({ id, siteId });
      if (!seed) missing();
      const worker = await manager
        .getRepository(WorkerEntity)
        .findOne({ where: { id: seed.workerId, siteId }, lock: { mode: 'pessimistic_write' } });
      if (!worker) missing();
      await attendanceAccess(manager, actor, worker, true);
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `mf03:${siteId}:${worker.id}`,
      ]);
      const request =
        kind === 'OVERTIME'
          ? await manager
              .getRepository(OvertimeRequestEntity)
              .findOne({ where: { id, siteId }, lock: { mode: 'pessimistic_write' } })
          : await manager
              .getRepository(AbsenceRequestEntity)
              .findOne({ where: { id, siteId }, lock: { mode: 'pessimistic_write' } });
      if (!request) missing();
      const overtime = 'scheduleId' in request;
      const requester = overtime ? request.requestedBy : request.requestedByUserId;
      if (requester === actor.id) conflict('Requesters cannot review their own request');
      const status = value.approve ? 'APPROVED' : 'REJECTED';
      const reviewer = overtime ? request.reviewedBy : request.reviewedByUserId;
      if (request.status === status && reviewer === actor.id && request.reviewNote === reviewNote)
        return { id };
      if (request.status !== 'PENDING' && request.status !== 'PENDING_MANAGER')
        conflict('Request has already been reviewed');
      const schedule = await manager
        .getRepository(WorkerScheduleEntity)
        .findOneBy({ id: overtime ? request.scheduleId : request.workerScheduleId, siteId });
      if (!schedule) missing();
      if (
        value.approve &&
        (!schedule.isActive ||
          schedule.shiftId !== (overtime ? request.expectedShiftId : request.shiftId) ||
          (!overtime && schedule.scheduleVersionId !== request.expectedScheduleVersionId))
      )
        conflict('Schedule changed; submit a new request');
      const template = await manager
        .getRepository(ShiftEntity)
        .findOneByOrFail({ id: schedule.shiftId, siteId });
      const shift = { ...template, ...scheduledShiftWindow(template, schedule.workDate) };
      const start = request.startsAt ?? shift.startsAt,
        end = request.endsAt ?? shift.endsAt;
      if (
        value.approve &&
        overtime &&
        ((start < shift.endsAt && end > shift.startsAt) ||
          workDateAt(start, shift.timezone) !==
            workDateAt(start >= shift.endsAt ? shift.endsAt : shift.startsAt, shift.timezone))
      )
        conflict(
          'Schedule changed; overtime must remain outside the regular shift on its assigned day',
        );
      if (value.approve && !overtime && (start < shift.startsAt || end > shift.endsAt))
        conflict('Schedule changed; leave must remain inside the shift');
      if (value.approve && overtime && start <= new Date())
        conflict('Overtime approval must precede its start');
      if (value.approve) {
        const overlaps: unknown[] = await manager.query(
          `SELECT id FROM ${overtime ? 'overtime_request' : 'absence_request'} WHERE ${overtime ? 'schedule_id' : 'worker_schedule_id'}=$1 AND status='APPROVED' AND id<>$2 AND COALESCE(starts_at,$3)<$4 AND COALESCE(ends_at,$4)>$3`,
          [schedule.id, id, start, end],
        );
        if (overlaps.length) conflict('Approved time requests overlap');
      }
      request.reviewNote = reviewNote;
      if (overtime) {
        request.status = status;
        request.reviewedBy = actor.id;
        request.reviewedAt = new Date();
        await manager.getRepository(OvertimeRequestEntity).save(request);
      } else {
        request.status = value.approve
          ? AbsenceRequestStatus.APPROVED
          : AbsenceRequestStatus.REJECTED;
        request.reviewedByUserId = actor.id;
        request.reviewedAt = new Date();
        request.isUnderstaffed = value.approve;
        if (value.approve && start <= shift.startsAt && end >= shift.endsAt) {
          schedule.isActive = false;
          await manager.getRepository(WorkerScheduleEntity).save(schedule);
          if (request.replacementWorkerId) {
            const replacement = await manager.getRepository(WorkerEntity).findOneBy({
              id: request.replacementWorkerId,
              siteId,
              contractorId: worker.contractorId!,
              isActive: true,
            });
            if (
              !replacement ||
              (await manager.getRepository(WorkerScheduleEntity).existsBy({
                siteId,
                workerId: replacement.id,
                workDate: schedule.workDate,
                isActive: true,
              }))
            )
              conflict('Replacement worker is unavailable');
            await manager.getRepository(WorkerScheduleEntity).save({
              id: randomUUID(),
              siteId,
              workerId: replacement.id,
              shiftId: shift.id,
              scheduleVersionId: schedule.scheduleVersionId,
              workDate: schedule.workDate,
              isActive: true,
            });
            request.isUnderstaffed = false;
          }
        }
        await manager.getRepository(AbsenceRequestEntity).save(request);
      }
      const day = await this.reconciliation.ensureDay(
        manager,
        worker,
        shift.startsAt,
        schedule,
        shift,
      );
      await this.reconciliation.notificationsForRequest(
        manager,
        worker,
        id,
        value.approve ? 'TIME_APPROVED' : 'TIME_REJECTED',
        `${kind.toLowerCase()} ${status.toLowerCase()}${reviewNote ? `: ${reviewNote}` : ''}`,
        day,
      );
      await this.reconciliation.refresh(manager, day.id);
      await auditAccess(
        manager,
        actor.id,
        siteId,
        'ATTENDANCE_TIME_REVIEWED',
        overtime ? 'overtime_request' : 'absence_request',
        id,
        reviewNote,
        { status, dayId: day.id },
      );
      return { id };
    });
  }
  async confirmAbsence(
    actor: WorkforceActor,
    siteIdValue: string,
    idValue: string,
    input: ConfirmAttendanceAbsenceDto,
  ) {
    const siteId = uuid(siteIdValue),
      id = uuid(idValue),
      value = command(ConfirmAttendanceAbsenceDto, input);
    return this.source
      .transaction(async (manager) => {
        const seed = await manager.getRepository(AttendanceDayEntity).findOneBy({ id, siteId });
        if (!seed) missing();
        const worker = await manager
          .getRepository(WorkerEntity)
          .findOne({ where: { id: seed.workerId, siteId }, lock: { mode: 'pessimistic_write' } });
        if (!worker) missing();
        await attendanceAccess(manager, actor, worker, true);
        if (worker.userId === actor.id) conflict('Workers cannot review their own hours');
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `mf03:${siteId}:${worker.id}`,
        ]);
        const previous = await manager
          .getRepository(AttendanceAbsenceReviewEntity)
          .findOneBy({ id: value.requestId });
        if (previous) {
          if (
            previous.dayId !== id ||
            previous.reviewedBy !== actor.id ||
            previous.reason !== value.reason ||
            previous.expectedDayVersion !== value.expectedVersion ||
            previous.teamAttendanceVersion !== value.expectedTeamAttendanceVersion
          )
            conflict('Request ID was already used');
          return { id };
        }
        const day = await this.reconciliation.refresh(manager, id);
        if (day.version !== value.expectedVersion)
          conflict('Attendance changed; reload before reviewing');
        const context = await attendanceGateAbsenceContext(manager, day);
        if (
          !canConfirmGateAbsence(day, context, new Date()) ||
          !context?.record ||
          context.record.version !== value.expectedTeamAttendanceVersion
        )
          conflict(
            'Absence can only be confirmed after the shift ends with unchanged roll call and no Gate or attendance evidence',
          );
        await manager.getRepository(AttendanceAbsenceReviewEntity).save({
          id: value.requestId,
          dayId: id,
          expectedDayVersion: value.expectedVersion,
          teamAttendanceVersion: context.record.version,
          teamId: context.record.teamId,
          membershipId: context.record.membershipId,
          zoneId: context.record.zoneId,
          reviewedBy: actor.id,
          reason: value.reason,
        });
        await auditAccess(
          manager,
          actor.id,
          siteId,
          'ATTENDANCE_ABSENCE_CONFIRMED',
          'attendance_day',
          id,
          value.reason,
          {
            requestId: value.requestId,
            before: day.status,
            after: 'ABSENT',
            teamAttendanceVersion: context.record.version,
          },
        );
        await this.reconciliation.refresh(manager, id);
        return { id };
      })
      .catch((error: unknown) =>
        knownUnique(error, ['uq_absence_review_snapshot', 'attendance_absence_review_pkey']),
      );
  }
  async confirmZoneHours(
    actor: WorkforceActor,
    siteIdValue: string,
    idValue: string,
    input: ConfirmAttendanceZoneHoursDto,
  ) {
    const siteId = uuid(siteIdValue),
      id = uuid(idValue),
      value = command(ConfirmAttendanceZoneHoursDto, input);
    return this.source
      .transaction(async (manager) => {
        const seed = await manager.getRepository(AttendanceDayEntity).findOneBy({ id, siteId });
        if (!seed) missing();
        const worker = await manager
          .getRepository(WorkerEntity)
          .findOne({ where: { id: seed.workerId, siteId }, lock: { mode: 'pessimistic_write' } });
        if (!worker) missing();
        await attendanceAccess(manager, actor, worker, true);
        if (worker.userId === actor.id) conflict('Workers cannot review their own hours');
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `mf03:${siteId}:${worker.id}`,
        ]);
        const previous = await manager
          .getRepository(AccessAuditEntity)
          .findOneBy({ action: ZONE_HOURS_REVIEW_ACTION, entityId: value.requestId });
        if (previous) {
          if (
            previous.siteId !== siteId ||
            previous.entityType !== 'attendance_zone_review' ||
            previous.actorAccountId !== actor.id ||
            previous.reason !== value.reason ||
            previous.changes?.dayId !== id ||
            previous.changes.expectedVersion !== value.expectedVersion ||
            previous.changes.evidenceHash !== value.evidenceHash
          )
            conflict('Request ID was already used');
          await this.reconciliation.refresh(manager, id);
          return { id };
        }
        const day = await this.reconciliation.refresh(manager, id);
        if (day.version !== value.expectedVersion)
          conflict('Attendance changed; reload before reviewing');
        const context = await attendanceZoneReviewContext(manager, day);
        if (
          !canConfirmZoneHours(day, context, new Date()) ||
          !context ||
          context.evidenceHash !== value.evidenceHash
        )
          conflict(
            'Resolve incomplete Gate evidence, changed attendance and pending requests before confirming hours',
          );
        const requirement = day.zoneAttendanceRequirement!;
        const audit = await auditAccess(
          manager,
          actor.id,
          siteId,
          ZONE_HOURS_REVIEW_ACTION,
          'attendance_zone_review',
          value.requestId,
          value.reason,
          {
            dayId: id,
            expectedVersion: value.expectedVersion,
            evidenceHash: context.evidenceHash,
            teamId: requirement.teamId,
            membershipId: requirement.membershipId,
            zoneId: requirement.zoneId,
            teamAttendanceStatus: 'NOT_YET',
            regularMinutes: day.regularMinutes,
            overtimeMinutes: day.overtimeMinutes,
            approvedAnomalies: day.anomalies,
            evidence: context.evidence,
          },
        );
        day.zoneAttendanceReviewAuditId = audit.id;
        await manager.getRepository(AttendanceDayEntity).save(day);
        await this.reconciliation.refresh(manager, id);
        return { id };
      })
      .catch((error: unknown) => knownUnique(error, ['uq_zone_hours_review_request']));
  }
  async acknowledge(
    actor: WorkforceActor,
    siteIdValue: string,
    idValue: string,
    input: ReviewAttendanceDayDto,
  ) {
    const siteId = uuid(siteIdValue),
      id = uuid(idValue),
      value = command(ReviewAttendanceDayDto, input);
    return this.source.transaction(async (manager) => {
      const seed = await manager.getRepository(AttendanceDayEntity).findOneBy({ id, siteId });
      if (!seed) missing();
      const worker = await manager
        .getRepository(WorkerEntity)
        .findOne({ where: { id: seed.workerId, siteId }, lock: { mode: 'pessimistic_write' } });
      if (!worker) missing();
      await attendanceAccess(manager, actor, worker, true);
      if (worker.userId === actor.id) conflict('Workers cannot review their own hours');
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `mf03:${siteId}:${worker.id}`,
      ]);
      const day = await this.reconciliation.refresh(manager, id);
      if (day.reviewedBy === actor.id && day.reviewNote === value.reviewNote) return { id };
      if (day.version !== value.expectedVersion)
        conflict('Attendance changed; reload before reviewing');
      if (!canAcknowledgeEarlyCheckout(day.anomalies))
        conflict('Resolve missing events, schedules and pending requests before confirming hours');
      day.reviewedBy = actor.id;
      day.reviewedAt = new Date();
      day.reviewNote = value.reviewNote;
      day.version += 1;
      await manager.getRepository(AttendanceDayEntity).save(day);
      await this.reconciliation.refresh(manager, id);
      await auditAccess(
        manager,
        actor.id,
        siteId,
        'ATTENDANCE_HOURS_CONFIRMED',
        'attendance_day',
        id,
        value.reviewNote,
        { version: day.version },
      );
      return { id };
    });
  }
}
