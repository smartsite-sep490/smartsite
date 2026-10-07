import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { DataSource, In, IsNull, type EntityManager } from 'typeorm';
import type { AttendanceOverviewResponse, AttendanceSessionResponse } from '@smartsite/contracts';
import { command, conflict, missing, uuid } from '../../common/configuration/commands.js';
import {
  AccessAttemptEntity,
  AttendanceEventEntity,
  AttendanceSessionEntity,
  AttendanceCorrectionEntity,
  GateEventEntity,
  WorkerEntity,
  WorkerScheduleEntity,
  ShiftEntity,
  ContractorRepresentativeGrantEntity,
  UserRole,
} from '../../database/entities/index.js';
import type { WorkforceActor } from './contractor-operations.service.js';
import { requireSiteRole } from './qr-access.service.js';
import { auditAccess } from './access-audit.js';

export class RecordAttendanceCommand {
  @IsUUID() requestId!: string;
  @IsIn(['CHECK_IN', 'CHECK_OUT']) kind!: 'CHECK_IN' | 'CHECK_OUT';
}
export class RequestAttendanceCorrectionCommand {
  @IsUUID() requestId!: string;
  @IsInt() @Min(1) expectedSessionVersion!: number;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i)
  proposedInAt!: string;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i)
  proposedOutAt!: string;
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
export class ReviewAttendanceCorrectionCommand {
  @IsBoolean() approve!: boolean;
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reviewNote!: string;
}
function response(
  session: AttendanceSessionEntity,
  worker: WorkerEntity,
): AttendanceSessionResponse {
  return {
    id: session.id,
    workerId: worker.id,
    workerName: worker.displayName,
    effectiveInAt: session.effectiveInAt?.toISOString() ?? null,
    effectiveOutAt: session.effectiveOutAt?.toISOString() ?? null,
    status: session.status,
    version: session.version,
    workedMinutes:
      session.effectiveInAt && session.effectiveOutAt
        ? Math.floor((+session.effectiveOutAt - +session.effectiveInAt) / 60_000)
        : null,
  };
}
@Injectable()
export class AttendanceService {
  constructor(private readonly source: DataSource) {}
  private async requireSelf(
    manager: EntityManager,
    actor: WorkforceActor,
    siteId: string,
    workerId: string,
  ) {
    requireSiteRole(actor, siteId, [UserRole.WORKER], false);
    if (
      !(await manager
        .getRepository(WorkerEntity)
        .existsBy({ id: workerId, siteId, userId: actor.id }))
    )
      conflict('Worker can request corrections only for their own attendance');
  }
  async record(
    actor: WorkforceActor,
    siteId: string,
    gateEventId: string,
    input: RecordAttendanceCommand,
  ) {
    requireSiteRole(actor, siteId, [UserRole.SECURITY_OFFICER, UserRole.WORKER]);
    const value = command(RecordAttendanceCommand, input);
    uuid(gateEventId);
    return this.source.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `attendance:${value.requestId}`,
      ]);
      const passage = await manager
        .getRepository(GateEventEntity)
        .findOneBy({ id: gateEventId, siteId });
      if (
        !passage?.workerId ||
        passage.visitId ||
        passage.direction !== (value.kind === 'CHECK_IN' ? 'IN' : 'OUT')
      )
        conflict('Attendance must match the verified Worker passage direction');
      const worker = await manager
        .getRepository(WorkerEntity)
        .findOne({ where: { id: passage.workerId, siteId }, lock: { mode: 'pessimistic_write' } });
      if (!worker) missing();
      if (
        !actor.roleAssignments.some(
          (r) =>
            (r.role === UserRole.ADMIN && r.siteId === null) ||
            (r.role === UserRole.SECURITY_OFFICER && r.siteId === siteId),
        )
      )
        await this.requireSelf(manager, actor, siteId, worker.id);
      const oldEvent = await manager
        .getRepository(AttendanceEventEntity)
        .findOneBy({ gateEventId: passage.id });
      if (oldEvent) {
        if (
          oldEvent.id !== value.requestId ||
          oldEvent.kind !== value.kind ||
          oldEvent.recordedBy !== actor.id
        )
          conflict('This passage already has an attendance action');
        const oldSession = await manager
          .getRepository(AttendanceSessionEntity)
          .findOneBy([{ checkInEventId: oldEvent.id }, { checkOutEventId: oldEvent.id }]);
        if (!oldSession) conflict('Attendance session is unavailable');
        return response(oldSession, worker);
      }
      if (await manager.getRepository(AttendanceEventEntity).existsBy({ id: value.requestId }))
        conflict('Attendance request was used for a different passage');
      if (passage.occurredAt < new Date(Date.now() - 5 * 60_000))
        conflict('Use a current passage; historical changes require an attendance correction');
      const attempt = await manager
        .getRepository(AccessAttemptEntity)
        .findOneBy({ id: passage.accessAttemptId, status: 'USED' });
      if (!attempt) conflict('Confirmed access verification is required');
      const schedules = await manager
        .getRepository(WorkerScheduleEntity)
        .findBy({ workerId: worker.id, siteId, isActive: true });
      let scheduleId: string | null = null;
      for (const schedule of schedules) {
        const shift = await manager
          .getRepository(ShiftEntity)
          .findOneBy({ id: schedule.shiftId, siteId });
        if (shift && shift.startsAt <= passage.occurredAt && shift.endsAt > passage.occurredAt) {
          scheduleId = schedule.id;
          break;
        }
      }
      let session = await manager.getRepository(AttendanceSessionEntity).findOne({
        where: {
          siteId,
          workerId: worker.id,
          checkOutEventId: IsNull(),
          effectiveOutAt: IsNull(),
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (value.kind === 'CHECK_IN' && session)
        conflict(
          'Worker already has an open attendance session. Temporary re-entry is passage only',
        );
      const event = await manager.getRepository(AttendanceEventEntity).save({
        id: value.requestId,
        siteId,
        workerId: worker.id,
        workerAssignmentId: attempt.workerAssignmentId,
        shiftAssignmentId: scheduleId,
        kind: value.kind,
        method: attempt.method,
        gateEventId: passage.id,
        occurredAt: passage.occurredAt,
        recordedBy: actor.id,
        reasonCode: value.kind === 'CHECK_IN' ? 'NORMAL_CHECK_IN' : 'NORMAL_CHECK_OUT',
      });
      if (!session)
        session = manager.getRepository(AttendanceSessionEntity).create({
          id: randomUUID(),
          siteId,
          workerId: worker.id,
          shiftAssignmentId: scheduleId,
          checkInEventId: null,
          checkOutEventId: null,
          effectiveInAt: null,
          effectiveOutAt: null,
          appliedCorrectionId: null,
          version: 1,
        });
      else session.version += 1;
      if (value.kind === 'CHECK_IN') {
        session.checkInEventId = event.id;
        session.effectiveInAt = event.occurredAt;
        session.status = 'MISSING_OUT';
      } else {
        if (session.effectiveInAt && session.effectiveInAt > event.occurredAt)
          conflict('Checkout cannot precede check-in');
        session.checkOutEventId = event.id;
        session.effectiveOutAt = event.occurredAt;
        session.status = session.checkInEventId ? 'MATCHED' : 'MISSING_IN';
      }
      await manager.getRepository(AttendanceSessionEntity).save(session);
      await auditAccess(
        manager,
        actor.id,
        siteId,
        'ATTENDANCE_RECORDED',
        'attendance_session',
        session.id,
        null,
        { eventId: event.id, kind: event.kind, gateEventId: passage.id },
      );
      return response(session, worker);
    });
  }
  async overview(actor: WorkforceActor, siteId: string): Promise<AttendanceOverviewResponse> {
    requireSiteRole(actor, siteId, [
      UserRole.WORKER,
      UserRole.CONTRACTOR_REPRESENTATIVE,
      UserRole.SITE_MANAGER,
      UserRole.SECURITY_OFFICER,
    ]);
    const admin = actor.roleAssignments.some((r) => r.role === UserRole.ADMIN && r.siteId === null);
    const siteStaff =
      admin ||
      actor.roleAssignments.some(
        (r) =>
          r.siteId === siteId &&
          [UserRole.SITE_MANAGER, UserRole.SECURITY_OFFICER].includes(r.role),
      );
    const isRepresentative = actor.roleAssignments.some(
      (r) => r.siteId === siteId && r.role === UserRole.CONTRACTOR_REPRESENTATIVE,
    );
    const grants = isRepresentative
      ? await this.source
          .getRepository(ContractorRepresentativeGrantEntity)
          .findBy({ userId: actor.id })
      : [];
    const workers = (await this.source.getRepository(WorkerEntity).findBy({ siteId })).filter(
      (w) =>
        siteStaff || w.userId === actor.id || grants.some((g) => g.contractorId === w.contractorId),
    );
    const sessions = workers.length
      ? await this.source.getRepository(AttendanceSessionEntity).find({
          where: { siteId, workerId: In(workers.map((w) => w.id)) },
          order: { createdAt: 'DESC', id: 'DESC' },
          take: 100,
        })
      : [];
    const corrections = sessions.length
      ? await this.source.getRepository(AttendanceCorrectionEntity).find({
          where: { attendanceSessionId: In(sessions.map((s) => s.id)) },
          order: { createdAt: 'DESC', id: 'DESC' },
          take: 100,
        })
      : [];
    return {
      canRequestCorrection: actor.roleAssignments.some(
        (r) => r.role === UserRole.WORKER && r.siteId === siteId,
      ),
      canReviewCorrection: admin || isRepresentative,
      sessions: sessions.map((s) =>
        response(
          s,
          workers.find((w) => w.id === s.workerId)!,
        ),
      ),
      corrections: corrections.map((c) => ({
        id: c.id,
        attendanceSessionId: c.attendanceSessionId,
        workerName:
          workers.find(
            (w) => w.id === sessions.find((s) => s.id === c.attendanceSessionId)?.workerId,
          )?.displayName ?? '',
        proposedInAt: c.proposedInAt.toISOString(),
        proposedOutAt: c.proposedOutAt.toISOString(),
        reason: c.reason,
        status: c.status,
        reviewNote: c.reviewNote,
      })),
    };
  }
  async requestCorrection(
    actor: WorkforceActor,
    siteId: string,
    sessionId: string,
    input: RequestAttendanceCorrectionCommand,
  ) {
    const value = command(RequestAttendanceCorrectionCommand, input);
    uuid(sessionId);
    return this.source.transaction(async (manager) => {
      const session = await manager
        .getRepository(AttendanceSessionEntity)
        .findOne({ where: { id: sessionId, siteId }, lock: { mode: 'pessimistic_write' } });
      if (!session) missing();
      await this.requireSelf(manager, actor, siteId, session.workerId);
      const proposedInAt = new Date(value.proposedInAt),
        proposedOutAt = new Date(value.proposedOutAt);
      if (proposedOutAt < proposedInAt) conflict('Correction checkout cannot precede check-in');
      const existing = await manager
        .getRepository(AttendanceCorrectionEntity)
        .findOneBy({ id: value.requestId });
      if (existing) {
        if (
          existing.attendanceSessionId !== session.id ||
          existing.requestedBy !== actor.id ||
          existing.expectedSessionVersion !== value.expectedSessionVersion ||
          +existing.proposedInAt !== +proposedInAt ||
          +existing.proposedOutAt !== +proposedOutAt ||
          existing.reason !== value.reason
        )
          conflict('Correction request was used for different details');
        return { id: existing.id };
      }
      if (session.version !== value.expectedSessionVersion)
        conflict('Attendance changed. Reload before requesting a correction');
      const correction = await manager.getRepository(AttendanceCorrectionEntity).save({
        id: value.requestId,
        attendanceSessionId: session.id,
        requestedBy: actor.id,
        expectedSessionVersion: value.expectedSessionVersion,
        proposedInAt,
        proposedOutAt,
        reason: value.reason,
        status: 'PENDING',
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
      });
      await auditAccess(
        manager,
        actor.id,
        siteId,
        'ATTENDANCE_CORRECTION_REQUESTED',
        'attendance_correction',
        correction.id,
        value.reason,
        { sessionId: session.id, expectedVersion: session.version },
      );
      return { id: correction.id };
    });
  }
  async reviewCorrection(
    actor: WorkforceActor,
    siteId: string,
    correctionId: string,
    input: ReviewAttendanceCorrectionCommand,
  ) {
    requireSiteRole(actor, siteId, [UserRole.CONTRACTOR_REPRESENTATIVE]);
    uuid(correctionId);
    const value = command(ReviewAttendanceCorrectionCommand, input);
    return this.source.transaction(async (manager) => {
      const correction = await manager
        .getRepository(AttendanceCorrectionEntity)
        .findOne({ where: { id: correctionId }, lock: { mode: 'pessimistic_write' } });
      if (!correction) missing();
      const session = await manager.getRepository(AttendanceSessionEntity).findOne({
        where: { id: correction.attendanceSessionId, siteId },
        lock: { mode: 'pessimistic_write' },
      });
      const worker = session
        ? await manager.getRepository(WorkerEntity).findOneBy({ id: session.workerId, siteId })
        : null;
      if (!session || !worker) missing();
      if (correction.requestedBy === actor.id)
        conflict('A requester cannot review their own correction');
      if (
        !actor.roleAssignments.some((r) => r.role === UserRole.ADMIN && r.siteId === null) &&
        (!worker.contractorId ||
          !(await manager
            .getRepository(ContractorRepresentativeGrantEntity)
            .existsBy({ userId: actor.id, contractorId: worker.contractorId })))
      )
        conflict('Representative does not manage this Worker');
      const status = value.approve ? 'APPROVED' : 'REJECTED';
      if (
        correction.status === status &&
        correction.reviewedBy === actor.id &&
        correction.reviewNote === value.reviewNote
      )
        return { id: correction.id };
      if (correction.status !== 'PENDING') conflict('Correction has already been reviewed');
      if (value.approve && session.version !== correction.expectedSessionVersion)
        conflict('Attendance changed. A new correction request is required');
      correction.status = status;
      correction.reviewedBy = actor.id;
      correction.reviewedAt = new Date();
      correction.reviewNote = value.reviewNote;
      await manager.getRepository(AttendanceCorrectionEntity).save(correction);
      if (value.approve) {
        session.effectiveInAt = correction.proposedInAt;
        session.effectiveOutAt = correction.proposedOutAt;
        session.status = 'CORRECTED';
        session.appliedCorrectionId = correction.id;
        session.version += 1;
        await manager.getRepository(AttendanceSessionEntity).save(session);
      }
      await auditAccess(
        manager,
        actor.id,
        siteId,
        'ATTENDANCE_CORRECTION_REVIEWED',
        'attendance_correction',
        correction.id,
        value.reviewNote,
        { status, sessionId: session.id, sessionVersion: session.version },
      );
      return { id: correction.id };
    });
  }
}
