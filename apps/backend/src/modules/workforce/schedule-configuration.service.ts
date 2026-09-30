import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { command, conflict, knownUnique, missing, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { ScheduleVersionEntity } from '../../database/entities/schedule-version.entity.js';
import { ShiftEntity } from '../../database/entities/shift.entity.js';
import { SiteEntity } from '../../database/entities/site.entity.js';
import { WorkerEntity } from '../../database/entities/worker.entity.js';
import { WorkerScheduleEntity } from '../../database/entities/worker-schedule.entity.js';
import { UserRole } from '../../database/entities/user.entity.js';
import { ContractorRepresentativeAssignmentEntity } from '../../database/entities/contractor-representative-assignment.entity.js';
import { AuthenticatedUser } from '../auth/auth.service.js';
import { page } from '../../common/configuration/commands.js';
import {
  CreateScheduleVersionDto,
  CreateShiftDto,
  CreateWorkerScheduleDto,
} from './dto/schedule-configuration.dto.js';

function invalid(message: string): never {
  throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
    code: 'VALIDATION_FAILED',
    message,
  });
}

@Injectable()
export class ScheduleConfigurationService {
  constructor(private readonly dataSource: DataSource) {}

  private forbidden(): never {
    throw new PublicHttpException(HttpStatus.FORBIDDEN, {
      code: 'FORBIDDEN',
      message: 'Forbidden',
    });
  }

  private assertPasswordChanged(user: AuthenticatedUser): void {
    if (user.mustChangePassword)
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Password change required',
      });
  }

  private isGlobalAdmin(user: AuthenticatedUser): boolean {
    return user.roleAssignments.some(
      (assignment) => assignment.role === UserRole.ADMIN && assignment.siteId === null,
    );
  }

  private hasSiteRole(user: AuthenticatedUser, role: UserRole, siteId: string): boolean {
    return user.roleAssignments.some(
      (assignment) => assignment.role === role && assignment.siteId === siteId,
    );
  }

  private async activeScheduleForReader(
    user: AuthenticatedUser,
    siteId: string,
    workerScheduleId: string,
  ): Promise<{ schedule: WorkerScheduleEntity; worker: WorkerEntity }> {
    this.assertPasswordChanged(user);
    const scopedSiteId = uuid(siteId).toLowerCase();
    const scopedWorkerScheduleId = uuid(workerScheduleId);
    const isManager = this.isGlobalAdmin(user) || this.hasSiteRole(user, UserRole.SITE_MANAGER, scopedSiteId);
    const isWorker = this.hasSiteRole(user, UserRole.WORKER, scopedSiteId);
    if (!isManager && !isWorker) this.forbidden();

    const schedule = await this.dataSource.getRepository(WorkerScheduleEntity).findOneBy({
      id: scopedWorkerScheduleId,
      siteId: scopedSiteId,
    });
    if (!schedule) missing();

    const worker = await this.dataSource.getRepository(WorkerEntity).findOneBy({
      id: schedule.workerId,
      siteId: scopedSiteId,
    });
    if (!worker) missing();
    if (!isManager && (worker.userId !== user.id || !worker.isActive)) this.forbidden();
    if (!schedule.isActive) conflict('Worker schedule is inactive');
    if (!worker.isActive) conflict('Worker is inactive');
    return { schedule, worker };
  }

  private shiftView(shift: ShiftEntity) {
    return {
      id: shift.id,
      name: shift.name,
      startsAt: shift.startsAt.toISOString(),
      endsAt: shift.endsAt.toISOString(),
      timezone: shift.timezone,
    };
  }

  private assertSiteAccess(user: AuthenticatedUser, siteId: string) {
    if (!user.roleAssignments.some(r => r.role === UserRole.ADMIN || r.siteId === siteId)) {
      throw new PublicHttpException(HttpStatus.FORBIDDEN, { code: 'FORBIDDEN', message: 'Forbidden' });
    }
  }

  async createShift(siteId: string, input: CreateShiftDto): Promise<ShiftEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const value = command(CreateShiftDto, input);
    const startsAt = new Date(value.startsAt);
    const endsAt = new Date(value.endsAt);
    if (endsAt <= startsAt) invalid('Shift end must be after its start');
    const site = await this.dataSource.getRepository(SiteEntity).findOneBy({ id: scopedSiteId });
    if (!site) missing();
    return this.dataSource.getRepository(ShiftEntity).save({
      id: randomUUID(),
      siteId: scopedSiteId,
      name: value.name,
      startsAt,
      endsAt,
      timezone: value.timezone,
    });
  }

  async createScheduleVersion(
    siteId: string,
    input: CreateScheduleVersionDto,
  ): Promise<ScheduleVersionEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const value = command(CreateScheduleVersionDto, input);
    const effectiveFrom = new Date(value.effectiveFrom);
    const effectiveUntil = value.effectiveUntil ? new Date(value.effectiveUntil) : null;
    if (effectiveUntil && effectiveUntil <= effectiveFrom)
      invalid('Schedule version effective until must be after effective from');
    return this.dataSource.transaction(async (manager) => {
      const site = await manager.getRepository(SiteEntity).findOneBy({ id: scopedSiteId });
      if (!site) missing();
      const latest = await manager
        .getRepository(ScheduleVersionEntity)
        .createQueryBuilder('scheduleVersion')
        .setLock('pessimistic_write')
        .where('scheduleVersion.site_id = :siteId', { siteId: scopedSiteId })
        .orderBy('scheduleVersion.version', 'DESC')
        .getOne();
      try {
        return await manager.getRepository(ScheduleVersionEntity).save({
          id: randomUUID(),
          siteId: scopedSiteId,
          version: (latest?.version ?? 0) + 1,
          effectiveFrom,
          effectiveUntil,
        });
      } catch (error) {
        knownUnique(error, ['uq_schedule_version_site_version']);
      }
    });
  }

  async createWorkerSchedule(
    siteId: string,
    scheduleVersionId: string,
    input: CreateWorkerScheduleDto,
  ): Promise<WorkerScheduleEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const scopedScheduleVersionId = uuid(scheduleVersionId);
    const value = command(CreateWorkerScheduleDto, input);
    return this.dataSource.transaction(async (manager) => {
      const [version, worker, shift] = await Promise.all([
        manager.getRepository(ScheduleVersionEntity).findOneBy({
          id: scopedScheduleVersionId,
          siteId: scopedSiteId,
        }),
        manager.getRepository(WorkerEntity).findOneBy({
          id: value.workerId,
          siteId: scopedSiteId,
          isActive: true,
        }),
        manager.getRepository(ShiftEntity).findOneBy({ id: value.shiftId, siteId: scopedSiteId }),
      ]);
      if (!version || !worker || !shift) missing();
      const fromDate = version.effectiveFrom.toISOString().slice(0, 10);
      const untilDate = version.effectiveUntil?.toISOString().slice(0, 10) ?? null;
      if (value.workDate < fromDate || (untilDate && value.workDate >= untilDate))
        conflict('Work date is outside the schedule version effective period');
      try {
        return await manager.getRepository(WorkerScheduleEntity).save({
          id: randomUUID(),
          siteId: scopedSiteId,
          scheduleVersionId: version.id,
          workerId: worker.id,
          shiftId: shift.id,
          workDate: value.workDate,
          isActive: true,
        });
      } catch (error) {
        knownUnique(error, [
          'uq_worker_schedule_version_worker_shift_date',
          'uq_worker_schedule_active_worker_date',
        ]);
      }
    });
  }

  async listShifts(
    user: AuthenticatedUser,
    siteId: string,
  ): Promise<{ items: ShiftEntity[]; total: number }> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    this.assertSiteAccess(user, scopedSiteId);
    const [items, total] = await this.dataSource.getRepository(ShiftEntity).findAndCount({
      where: { siteId: scopedSiteId },
      order: { startsAt: 'ASC', name: 'ASC' },
    });
    return { items, total };
  }

  async listScheduleVersions(
    user: AuthenticatedUser,
    siteId: string,
  ): Promise<{ items: ScheduleVersionEntity[]; total: number }> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    this.assertSiteAccess(user, scopedSiteId);
    const [items, total] = await this.dataSource.getRepository(ScheduleVersionEntity).findAndCount({
      where: { siteId: scopedSiteId },
      order: { version: 'DESC' },
    });
    return { items, total };
  }

  async listWorkerSchedules(
    user: AuthenticatedUser,
    siteId: string,
    offset = '0',
    limit = '50',
  ): Promise<{ items: WorkerScheduleEntity[]; total: number }> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const pagination = page(Number(offset), Number(limit));

    // Authorization check
    let contractorIdScope: string | undefined;
    let workerIdScope: string | undefined;
    if (!user.roleAssignments.some(r => r.role === UserRole.ADMIN || (r.siteId === scopedSiteId && r.role === UserRole.SITE_MANAGER))) {
      // Must be CONTRACTOR_REPRESENTATIVE or WORKER
      const rep = await this.dataSource.getRepository(ContractorRepresentativeAssignmentEntity).findOneBy({ siteId: scopedSiteId, userId: user.id });
      if (rep) {
        contractorIdScope = rep.contractorId;
      } else {
        const worker = await this.dataSource.getRepository(WorkerEntity).findOneBy({ siteId: scopedSiteId, userId: user.id });
        if (worker) {
          workerIdScope = worker.id;
        } else {
          throw new PublicHttpException(HttpStatus.FORBIDDEN, { code: 'FORBIDDEN', message: 'Forbidden' });
        }
      }
    }

    const query = this.dataSource.getRepository(WorkerScheduleEntity).createQueryBuilder('schedule')
      .where('schedule.site_id = :siteId', { siteId: scopedSiteId });

    if (contractorIdScope) {
      query.innerJoin('worker', 'w', 'schedule.worker_id = w.id')
           .andWhere('w.contractor_id = :contractorId', { contractorId: contractorIdScope });
    }
    if (workerIdScope)
      query.andWhere('schedule.worker_id = :workerId', { workerId: workerIdScope });

    const [items, total] = await query
      .orderBy('schedule.workDate', 'DESC')
      .addOrderBy('schedule.id', 'ASC')
      .skip(pagination.offset)
      .take(pagination.limit)
      .getManyAndCount();

    return { items, total };
  }

  async listEligibleShifts(
    user: AuthenticatedUser,
    siteId: string,
    workerScheduleId: string,
  ) {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const { schedule } = await this.activeScheduleForReader(user, scopedSiteId, workerScheduleId);
    const shifts = await this.dataSource.getRepository(ShiftEntity).find({
      where: { siteId: scopedSiteId },
      order: { startsAt: 'ASC', name: 'ASC', id: 'ASC' },
    });
    const items = shifts
      .filter((shift) => shift.id !== schedule.shiftId)
      .map((shift) => this.shiftView(shift));
    return { items, total: items.length };
  }

  async listSwapCandidates(
    user: AuthenticatedUser,
    siteId: string,
    workerScheduleId: string,
  ) {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const { schedule } = await this.activeScheduleForReader(user, scopedSiteId, workerScheduleId);
    type SwapCandidateRow = {
      candidateWorkerId: string;
      candidateWorkerDisplayName: string;
      candidateWorkerScheduleId: string;
      workDate: string;
      currentShiftId: string;
      currentShiftName: string;
      currentShiftStartsAt: Date;
      currentShiftEndsAt: Date;
      currentShiftTimezone: string;
    };

    const rows = await this.dataSource
      .getRepository(WorkerScheduleEntity)
      .createQueryBuilder('candidateSchedule')
      .innerJoin(
        WorkerEntity,
        'candidateWorker',
        'candidateWorker.id = candidateSchedule.worker_id AND candidateWorker.site_id = candidateSchedule.site_id',
      )
      .innerJoin(
        ShiftEntity,
        'candidateShift',
        'candidateShift.id = candidateSchedule.shift_id AND candidateShift.site_id = candidateSchedule.site_id',
      )
      .select('candidateWorker.id', 'candidateWorkerId')
      .addSelect('candidateWorker.display_name', 'candidateWorkerDisplayName')
      .addSelect('candidateSchedule.id', 'candidateWorkerScheduleId')
      .addSelect('candidateSchedule.work_date', 'workDate')
      .addSelect('candidateShift.id', 'currentShiftId')
      .addSelect('candidateShift.name', 'currentShiftName')
      .addSelect('candidateShift.starts_at', 'currentShiftStartsAt')
      .addSelect('candidateShift.ends_at', 'currentShiftEndsAt')
      .addSelect('candidateShift.timezone', 'currentShiftTimezone')
      .where('candidateSchedule.site_id = :siteId', { siteId: scopedSiteId })
      .andWhere('candidateSchedule.schedule_version_id = :scheduleVersionId', {
        scheduleVersionId: schedule.scheduleVersionId,
      })
      .andWhere('candidateSchedule.work_date = :workDate', { workDate: schedule.workDate })
      .andWhere('candidateSchedule.worker_id <> :workerId', { workerId: schedule.workerId })
      .andWhere('candidateSchedule.shift_id <> :shiftId', { shiftId: schedule.shiftId })
      .andWhere('candidateSchedule.is_active = true')
      .andWhere('candidateWorker.is_active = true')
      .orderBy('candidateWorker.display_name', 'ASC')
      .addOrderBy('candidateSchedule.id', 'ASC')
      .getRawMany<SwapCandidateRow>();

    const items = rows.map((row) => ({
      candidateWorkerId: row.candidateWorkerId,
      candidateWorkerDisplayName: row.candidateWorkerDisplayName,
      candidateWorkerScheduleId: row.candidateWorkerScheduleId,
      workDate: row.workDate,
      currentShift: {
        id: row.currentShiftId,
        name: row.currentShiftName,
        startsAt: new Date(row.currentShiftStartsAt).toISOString(),
        endsAt: new Date(row.currentShiftEndsAt).toISOString(),
        timezone: row.currentShiftTimezone,
      },
    }));
    return { items, total: items.length };
  }
}
