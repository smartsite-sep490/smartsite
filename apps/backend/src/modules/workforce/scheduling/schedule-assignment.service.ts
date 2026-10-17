import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, In, IsNull, type EntityManager } from 'typeorm';
import type {
  ScheduleAssignmentInput,
  ScheduleAssignmentPreview,
  ScheduleAssignmentBatchResponse,
} from '@smartsite/contracts';
import {
  command,
  conflict,
  invalid,
  missing,
  page,
  uuid,
} from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import {
  ScheduleAssignmentBatchEntity,
  ScheduleVersionEntity,
  ShiftEntity,
  WorkerEntity,
  WorkerScheduleEntity,
  ContractorTeamEntity,
  ContractorTeamMembershipEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  ContractorRepresentativeAssignmentEntity,
  ContractorShiftAssignmentEntity,
  AttendanceDayEntity,
  AccessAuditEntity,
} from '../../../database/entities/index.js';
import type { AuthenticatedUser } from '../../auth/auth.service.js';
import { hasActiveContractorParticipation } from '../shared/contractor-participation.js';
import { auditAccess } from '../shared/access-audit.js';
import { scheduledShiftWindow } from '../attendance/attendance-calculation.js';
import { assignmentDates } from './schedule-assignment-dates.js';
import { SchedulingNotificationService } from '../notifications/scheduling-notification.service.js';
import {
  ChangeScheduleAssignmentDto,
  CreateScheduleAssignmentDto,
  ScheduleAssignmentDto,
} from './dto/schedule-assignment.dto.js';

// JSONB reorders object keys; canonicalize both command and persisted replay data.
const hash = (value: unknown) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_key, item: unknown) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
          : item,
      ),
    )
    .digest('hex');
function normalized(input: ScheduleAssignmentInput): ScheduleAssignmentInput {
  return {
    contractorId: input.contractorId,
    scheduleVersionId: input.scheduleVersionId,
    shiftId: input.shiftId,
    target: input.target,
    ...(input.teamId ? { teamId: input.teamId } : {}),
    ...(input.workerId ? { workerId: input.workerId } : {}),
    ...(input.selectedWorkerIds ? { selectedWorkerIds: [...input.selectedWorkerIds].sort() } : {}),
    mode: input.mode,
    fromDate: input.fromDate,
    toDate: input.toDate,
    weekdays: [...input.weekdays].sort((a, b) => a - b),
  };
}
@Injectable()
export class ScheduleAssignmentService {
  constructor(
    private readonly source: DataSource,
    private readonly notifications: SchedulingNotificationService,
  ) {}
  private async scope(
    m: EntityManager,
    actor: AuthenticatedUser,
    siteId: string,
    contractorId: string,
    readOnly = false,
  ) {
    const user = await m.getRepository(UserEntity).findOneBy({ id: actor.id, isActive: true });
    const roles = await m.getRepository(UserRoleAssignmentEntity).findBy({ userId: actor.id });
    const manager = roles.some((r) => r.role === UserRole.SITE_MANAGER && r.siteId === siteId);
    const representativeRead =
      readOnly &&
      roles.some((r) => r.role === UserRole.CONTRACTOR_REPRESENTATIVE && r.siteId === siteId) &&
      (await m
        .getRepository(ContractorRepresentativeAssignmentEntity)
        .existsBy({ userId: actor.id, siteId, contractorId }));
    if (
      !user ||
      actor.mustChangePassword ||
      user.mustChangePassword ||
      (!manager && !representativeRead) ||
      !(await hasActiveContractorParticipation(m, contractorId, siteId))
    )
      throw new PublicHttpException(403, {
        code: 'FORBIDDEN',
        message: 'Schedule assignment is outside your Site scope',
      });
  }
  private view(batch: ScheduleAssignmentBatchEntity): ScheduleAssignmentBatchResponse {
    return {
      id: batch.id,
      version: batch.version,
      teamId: batch.input.teamId ?? null,
      targetName: batch.preview.targetName,
      input: batch.input,
      members: batch.preview.members,
      dates: batch.preview.dates,
      createdAt: batch.createdAt.toISOString(),
    };
  }
  private async resolve(
    m: EntityManager,
    actor: AuthenticatedUser,
    siteId: string,
    input: ScheduleAssignmentInput,
    lock: boolean,
  ): Promise<{ preview: ScheduleAssignmentPreview; shift: ShiftEntity }> {
    await this.scope(m, actor, siteId, input.contractorId);
    const dates = assignmentDates(input);
    const version = await m.getRepository(ScheduleVersionEntity).findOne({
      where: { id: input.scheduleVersionId, siteId },
      ...(lock ? { lock: { mode: 'pessimistic_read' as const } } : {}),
    });
    const shift = await m.getRepository(ShiftEntity).findOne({
      where: { id: input.shiftId, siteId },
      ...(lock ? { lock: { mode: 'pessimistic_read' as const } } : {}),
    });
    if (!version || !shift) missing();
    if (shift.archivedAt) conflict('Archived shifts cannot receive assignments');
    if (
      !(await m
        .getRepository(ContractorShiftAssignmentEntity)
        .existsBy({ contractorId: input.contractorId, siteId, shiftId: shift.id }))
    )
      throw new PublicHttpException(403, {
        code: 'FORBIDDEN',
        message: 'This shift is not assigned to your contractor',
      });
    let targetName = '';
    let memberships: ContractorTeamMembershipEntity[] = [];
    let workerIds: string[];
    if (input.target === 'TEAM') {
      const team = await m.getRepository(ContractorTeamEntity).findOne({
        where: { id: input.teamId!, siteId, contractorId: input.contractorId, isActive: true },
      });
      if (!team) missing();
      targetName = team.name;
      memberships = await m.getRepository(ContractorTeamMembershipEntity).find({
        where: { teamId: team.id, siteId, contractorId: input.contractorId, leftAt: IsNull() },
        order: { workerId: 'ASC' },
      });
      workerIds = input.selectedWorkerIds ?? memberships.map((member) => member.workerId);
      if (workerIds.some((id) => !memberships.some((member) => member.workerId === id)))
        conflict('Team members changed. Reload the team');
    } else workerIds = [input.workerId!];
    const workers = workerIds.length
      ? await m.getRepository(WorkerEntity).find({
          where: { id: In(workerIds), siteId, contractorId: input.contractorId, isActive: true },
          order: { id: 'ASC' },
          ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
        })
      : [];
    if (
      !workers.length ||
      ((input.target === 'WORKER' || input.selectedWorkerIds) &&
        workers.length !== workerIds.length)
    )
      conflict('Select an active worker or a team with active members');
    if (lock && input.teamId) {
      const team = await m.getRepository(ContractorTeamEntity).findOne({
        where: { id: input.teamId, siteId, contractorId: input.contractorId, isActive: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!team) conflict('Team changed. Preview again');
      const current = await m.getRepository(ContractorTeamMembershipEntity).find({
        where: { teamId: team.id, siteId, contractorId: input.contractorId, leftAt: IsNull() },
        order: { workerId: 'ASC' },
      });
      if (
        hash(current.map((member) => [member.id, member.workerId])) !==
        hash(memberships.map((member) => [member.id, member.workerId]))
      )
        conflict('Team members changed. Preview again');
    }
    if (workers.length * dates.length > 5000)
      invalid('Assign at most 5000 worker-days per request');
    if (input.target === 'WORKER') targetName = workers[0]!.displayName;
    for (const date of dates) {
      if (
        date < version.effectiveFrom.toISOString().slice(0, 10) ||
        (version.effectiveUntil && date >= version.effectiveUntil.toISOString().slice(0, 10))
      )
        conflict('Work date is outside the schedule version effective period');
      if (scheduledShiftWindow(shift, date).endsAt <= new Date())
        conflict('Cannot assign a shift that has already ended');
    }
    if (lock)
      await m.query(
        'SELECT pg_advisory_xact_lock(hashtext(key)) FROM unnest($1::text[]) AS keys(key) ORDER BY key',
        [workers.flatMap((worker) => dates.map((date) => `${siteId}${worker.id}${date}`))],
      );
    const schedules = await m.getRepository(WorkerScheduleEntity).find({
      where: { siteId, workerId: In(workers.map((worker) => worker.id)), workDate: In(dates) },
      order: { id: 'ASC' },
    });
    // Inactive rows also retain the version/worker/shift/date unique key.
    const conflicts = schedules
      .filter((s) => s.isActive || (s.scheduleVersionId === version.id && s.shiftId === shift.id))
      .map((s) => ({
        workerId: s.workerId,
        workerName: workers.find((w) => w.id === s.workerId)!.displayName,
        workDate: s.workDate,
        scheduleId: s.id,
        shiftName: s.shiftId,
      }));
    const conflictingShifts = conflicts.length
      ? await m
          .getRepository(ShiftEntity)
          .findBy({ siteId, id: In([...new Set(conflicts.map((item) => item.shiftName))]) })
      : [];
    for (const item of conflicts)
      item.shiftName =
        conflictingShifts.find((shift) => shift.id === item.shiftName)?.name ?? 'Existing shift';
    const members = workers.map((w) => ({
      workerId: w.id,
      workerName: w.displayName,
      membershipId: memberships.find((member) => member.workerId === w.id)?.id ?? null,
    }));
    const fingerprint = hash({
      input: normalized(input),
      members,
      dates,
      conflicts,
      version: [version.effectiveFrom, version.effectiveUntil],
      shift: [shift.startsAt, shift.endsAt, shift.timezone, shift.breakStartsAt, shift.breakEndsAt],
    });
    return {
      shift,
      preview: {
        fingerprint,
        targetName,
        members,
        dates,
        assignmentCount: workers.length * dates.length,
        conflicts,
      },
    };
  }
  async preview(actor: AuthenticatedUser, site: string, input: ScheduleAssignmentDto) {
    const siteId = uuid(site);
    const value = command(ScheduleAssignmentDto, input);
    return this.source.transaction(
      'REPEATABLE READ',
      async (m) => (await this.resolve(m, actor, siteId, value, false)).preview,
    );
  }
  async create(actor: AuthenticatedUser, site: string, input: CreateScheduleAssignmentDto) {
    const siteId = uuid(site),
      value = command(CreateScheduleAssignmentDto, input),
      selected = normalized(value);
    return this.source.transaction(async (m) => {
      await this.scope(m, actor, siteId, value.contractorId);
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `schedule-batch:${value.requestId}`,
      ]);
      const existing = await m
        .getRepository(ScheduleAssignmentBatchEntity)
        .findOneBy({ id: value.requestId });
      if (existing) {
        if (
          existing.siteId !== siteId ||
          existing.createdBy !== actor.id ||
          hash(existing.input) !== hash(selected) ||
          existing.preview.fingerprint !== value.expectedFingerprint
        )
          conflict('Request ID was used for different assignment details');
        return this.view(existing);
      }
      const { preview } = await this.resolve(m, actor, siteId, selected, true);
      if (preview.fingerprint !== value.expectedFingerprint)
        conflict('Assignment preview changed. Preview again before saving');
      if (preview.conflicts.length)
        conflict('Existing schedules conflict. No assignments were saved');
      const rows = preview.members.flatMap((member) =>
        preview.dates.map((workDate) => ({
          id: randomUUID(),
          siteId,
          workerId: member.workerId,
          scheduleVersionId: selected.scheduleVersionId,
          shiftId: selected.shiftId,
          workDate,
          isActive: true,
        })),
      );
      await m.getRepository(WorkerScheduleEntity).insert(rows);
      const batch = await m.getRepository(ScheduleAssignmentBatchEntity).save({
        id: value.requestId,
        siteId,
        contractorId: selected.contractorId,
        createdBy: actor.id,
        version: 1,
        input: selected,
        preview,
        scheduleIds: rows.map((row) => row.id),
      });
      await auditAccess(
        m,
        actor.id,
        siteId,
        'SCHEDULE_BATCH_CREATED',
        'schedule_assignment_batch',
        batch.id,
        null,
        {
          target: selected.target,
          teamId: selected.teamId ?? null,
          workerIds: preview.members.map((member) => member.workerId),
          dates: preview.dates,
          shiftId: selected.shiftId,
          count: rows.length,
        },
      );
      return this.view(batch);
    });
  }
  async list(actor: AuthenticatedUser, site: string, contractor: string, offset = 0, limit = 20) {
    const siteId = uuid(site),
      contractorId = uuid(contractor),
      pagination = page(offset, limit);
    return this.source.transaction(async (m) => {
      await this.scope(m, actor, siteId, contractorId, true);
      const [items, total] = await m.getRepository(ScheduleAssignmentBatchEntity).findAndCount({
        where: { siteId, contractorId },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: pagination.offset,
        take: pagination.limit,
      });
      return { items: items.map((batch) => this.view(batch)), total };
    });
  }
  async change(
    actor: AuthenticatedUser,
    site: string,
    id: string,
    input: ChangeScheduleAssignmentDto,
  ) {
    const siteId = uuid(site),
      batchId = uuid(id),
      value = command(ChangeScheduleAssignmentDto, input);
    return this.source.transaction(async (m) => {
      const batch = await m
        .getRepository(ScheduleAssignmentBatchEntity)
        .findOne({ where: { id: batchId, siteId }, lock: { mode: 'pessimistic_write' } });
      if (!batch) missing();
      await this.scope(m, actor, siteId, batch.contractorId);
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `schedule-batch-change:${value.requestId}`,
      ]);
      const replay = await m.getRepository(AccessAuditEntity).findOneBy({ id: value.requestId });
      if (replay) {
        if (
          replay.actorAccountId !== actor.id ||
          replay.siteId !== siteId ||
          replay.entityId !== id ||
          replay.changes?.fingerprint !== hash(value)
        )
          conflict('Request ID was used for different changes');
        return {
          id: batch.id,
          version: Number(replay.changes!.version),
          ...(replay.changes!.changedCount !== undefined
            ? {
                changedCount: Number(replay.changes!.changedCount),
                skippedCount: Number(replay.changes!.skippedCount),
              }
            : {}),
        };
      }
      if (batch.version !== value.expectedVersion) conflict('Batch changed. Reload before editing');
      const all = await m.getRepository(WorkerScheduleEntity).find({
        where: { id: In(batch.scheduleIds), siteId },
        order: { workerId: 'ASC', workDate: 'ASC' },
      });
      let rows = all.filter(
        (row) =>
          row.isActive &&
          (value.scope === 'UNSTARTED' ||
            (value.scope === 'DAY'
              ? row.workDate === value.workDate
              : row.workDate >= value.workDate)) &&
          (!value.workerId || value.workerId === row.workerId),
      );
      if (!rows.length) conflict('No active schedules match this selection');
      const workers = [...new Set(rows.map((row) => row.workerId))];
      const scopedWorkers = await m.getRepository(WorkerEntity).find({
        where: { id: In(workers), siteId, contractorId: batch.contractorId },
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      if (scopedWorkers.length !== workers.length)
        conflict('Worker scope changed. Reload before editing');
      await m.query(
        'SELECT pg_advisory_xact_lock(hashtext(key)) FROM unnest($1::text[]) AS keys(key) ORDER BY key',
        [rows.map((row) => `${siteId}${row.workerId}${row.workDate}`)],
      );
      const replacement =
        value.action === 'CHANGE_SHIFT' && value.shiftId
          ? await m
              .getRepository(ShiftEntity)
              .findOne({ where: { id: value.shiftId, siteId }, lock: { mode: 'pessimistic_read' } })
          : null;
      if (value.action === 'CHANGE_SHIFT' && (!replacement || replacement.archivedAt))
        invalid('Select an available replacement shift');
      if (
        replacement &&
        !(await m
          .getRepository(ContractorShiftAssignmentEntity)
          .existsBy({ siteId, contractorId: batch.contractorId, shiftId: replacement.id }))
      )
        throw new PublicHttpException(403, {
          code: 'FORBIDDEN',
          message: 'Replacement shift is outside contractor scope',
        });
      const rowIds = rows.map((row) => row.id);
      const currentRows = await m.getRepository(WorkerScheduleEntity).find({
        where: { id: In(rowIds), siteId, isActive: true },
        order: { workerId: 'ASC', workDate: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        currentRows.length !== rows.length ||
        currentRows.some(
          (current) => current.shiftId !== rows.find((row) => row.id === current.id)?.shiftId,
        )
      )
        conflict('Schedule changed. Reload before editing');
      const currentShifts = await m
        .getRepository(ShiftEntity)
        .findBy({ id: In([...new Set(rows.map((row) => row.shiftId))]), siteId });
      const attendance = await m.getRepository(AttendanceDayEntity).findBy({
        siteId,
        workerId: In(workers),
        workDate: In([...new Set(rows.map((row) => row.workDate))]),
      });
      const now = new Date();
      let skippedCount = 0;
      if (value.scope === 'UNSTARTED') {
        rows = rows.filter((row) => {
          const shift = currentShifts.find((shift) => shift.id === row.shiftId);
          // Missing shift configuration must fail closed, not become editable.
          if (!shift) conflict('Schedule shift is unavailable. Reload before editing');
          const protectedRow =
            scheduledShiftWindow(shift, row.workDate).startsAt <= now ||
            attendance.some(
              (day) => day.workerId === row.workerId && day.workDate === row.workDate,
            );
          if (protectedRow) skippedCount += 1;
          return !protectedRow;
        });
        if (!rows.length)
          conflict('No unstarted schedules without attendance remain in this batch');
      }
      for (const row of rows) {
        const shift = currentShifts.find((shift) => shift.id === row.shiftId);
        if (
          !shift ||
          scheduledShiftWindow(shift, row.workDate).startsAt <= now ||
          (replacement && scheduledShiftWindow(replacement, row.workDate).startsAt <= now) ||
          attendance.some((day) => day.workerId === row.workerId && day.workDate === row.workDate)
        )
          conflict('Started shifts or days with attendance cannot be changed or cancelled');
      }
      const requests = await m.query(
        `SELECT 1 FROM overtime_request WHERE schedule_id=ANY($1::uuid[]) AND status IN ('PENDING','APPROVED') UNION ALL SELECT 1 FROM absence_request WHERE worker_schedule_id=ANY($1::uuid[]) AND status IN ('PENDING_MANAGER','APPROVED') UNION ALL SELECT 1 FROM shift_change_request WHERE worker_schedule_id=ANY($1::uuid[]) AND status IN ('DRAFT','PENDING_MANAGER','APPROVED','APPLIED') UNION ALL SELECT 1 FROM shift_swap_request WHERE (requester_worker_schedule_id=ANY($1::uuid[]) OR coworker_worker_schedule_id=ANY($1::uuid[])) AND status IN ('DRAFT','PENDING_COWORKER','PENDING_MANAGER','APPROVED','APPLIED') LIMIT 1`,
        [rows.map((row) => row.id)],
      );
      if (requests.length)
        conflict('Resolve linked scheduling requests before changing this schedule');
      if (replacement) {
        const history = await m.getRepository(WorkerScheduleEntity).findBy({
          siteId,
          workerId: In(workers),
          shiftId: replacement.id,
          workDate: In([...new Set(rows.map((row) => row.workDate))]),
        });
        if (
          rows.some((row) =>
            history.some(
              (other) =>
                other.id !== row.id &&
                other.workerId === row.workerId &&
                other.workDate === row.workDate &&
                (other.isActive || other.scheduleVersionId === row.scheduleVersionId),
            ),
          )
        )
          conflict('Replacement conflicts with existing schedule history');
      }
      await m
        .getRepository(WorkerScheduleEntity)
        .update(
          { id: In(rows.map((row) => row.id)), siteId },
          replacement ? { shiftId: replacement.id } : { isActive: false },
        );
      batch.version += 1;
      await m.getRepository(ScheduleAssignmentBatchEntity).save(batch);
      await this.notifications.recordScheduleChange(m, {
        requestId: value.requestId,
        workers: scopedWorkers,
        schedules: rows,
        shifts: currentShifts,
        replacement,
        reason: value.reason,
      });
      await m.getRepository(AccessAuditEntity).save({
        id: value.requestId,
        actorAccountId: actor.id,
        siteId,
        action: 'SCHEDULE_BATCH_CHANGED',
        entityType: 'schedule_assignment_batch',
        entityId: batch.id,
        reason: value.reason,
        changes: {
          fingerprint: hash(value),
          version: batch.version,
          action: value.action,
          scope: value.scope,
          scheduleIds: rows.map((row) => row.id),
          shiftId: replacement?.id ?? null,
          changedCount: rows.length,
          skippedCount,
        },
        occurredAt: new Date(),
      });
      return { id: batch.id, version: batch.version, changedCount: rows.length, skippedCount };
    });
  }
}
