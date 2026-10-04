import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import {
  command,
  conflict,
  knownUnique,
  missing,
  uuid,
} from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { ScheduleVersionEntity } from '../../database/entities/schedule-version.entity.js';
import { ShiftEntity } from '../../database/entities/shift.entity.js';
import { SiteEntity } from '../../database/entities/site.entity.js';
import { WorkerEntity } from '../../database/entities/worker.entity.js';
import { WorkerScheduleEntity } from '../../database/entities/worker-schedule.entity.js';
import { UserRole } from '../../database/entities/user.entity.js';
import { ContractorRepresentativeAssignmentEntity } from '../../database/entities/contractor-representative-assignment.entity.js';
import { ContractorShiftAssignmentEntity } from '../../database/entities/contractor-shift-assignment.entity.js';
import { ContractorEntity } from '../../database/entities/contractor.entity.js';
import { ContractorSiteParticipationEntity } from '../../database/entities/contractor-site-participation.entity.js';
import { AuthenticatedUser } from '../auth/auth.service.js';
import { page } from '../../common/configuration/commands.js';
import { hasActiveContractorParticipation } from './contractor-participation.js';
import {
  CreateScheduleVersionDto,
  CreateShiftDto,
  CreateWorkerScheduleDto,
  AssignShiftToContractorDto,
  ListWorkerSchedulesQueryDto,
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
    const isManager =
      this.isGlobalAdmin(user) || this.hasSiteRole(user, UserRole.SITE_MANAGER, scopedSiteId);
    const isWorker = this.hasSiteRole(user, UserRole.WORKER, scopedSiteId);
    const isRepresentative = this.hasSiteRole(
      user,
      UserRole.CONTRACTOR_REPRESENTATIVE,
      scopedSiteId,
    );
    if (!isManager && !isWorker && !isRepresentative) this.forbidden();

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
    if (!isManager && isRepresentative) {
      if (!worker.contractorId) this.forbidden();
      const representative = await this.dataSource
        .getRepository(ContractorRepresentativeAssignmentEntity)
        .findOneBy({ siteId: scopedSiteId, contractorId: worker.contractorId, userId: user.id });
      if (!representative) this.forbidden();
      if (
        !(await hasActiveContractorParticipation(
          this.dataSource.manager,
          worker.contractorId,
          scopedSiteId,
        ))
      )
        this.forbidden();
    } else if (!isManager && (worker.userId !== user.id || !worker.isActive)) {
      this.forbidden();
    }
    if (
      !isManager &&
      (!worker.contractorId ||
        !(await hasActiveContractorParticipation(
          this.dataSource.manager,
          worker.contractorId,
          scopedSiteId,
        )))
    )
      this.forbidden();
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
    if (!user.roleAssignments.some((r) => r.role === UserRole.ADMIN || r.siteId === siteId)) {
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'FORBIDDEN',
        message: 'Forbidden',
      });
    }
  }

  private assertScheduleWriter(user: AuthenticatedUser, siteId: string): void {
    this.assertPasswordChanged(user);
    if (!this.hasSiteRole(user, UserRole.SITE_MANAGER, siteId)) this.forbidden();
  }

  private async contractorScopeForReader(
    user: AuthenticatedUser,
    siteId: string,
  ): Promise<string | null> {
    this.assertPasswordChanged(user);
    if (this.isGlobalAdmin(user) || this.hasSiteRole(user, UserRole.SITE_MANAGER, siteId))
      return null;

    if (this.hasSiteRole(user, UserRole.CONTRACTOR_REPRESENTATIVE, siteId)) {
      const assignment = await this.dataSource
        .getRepository(ContractorRepresentativeAssignmentEntity)
        .findOneBy({ siteId, userId: user.id });
      if (
        assignment &&
        (await hasActiveContractorParticipation(
          this.dataSource.manager,
          assignment.contractorId,
          siteId,
        ))
      )
        return assignment.contractorId;
    }

    if (this.hasSiteRole(user, UserRole.WORKER, siteId)) {
      const worker = await this.dataSource.getRepository(WorkerEntity).findOneBy({
        siteId,
        userId: user.id,
        isActive: true,
      });
      if (
        worker?.contractorId &&
        (await hasActiveContractorParticipation(
          this.dataSource.manager,
          worker.contractorId,
          siteId,
        ))
      )
        return worker.contractorId;
    }

    this.forbidden();
  }

  private async assertWorkerScheduleWriter(
    manager: EntityManager,
    user: AuthenticatedUser,
    siteId: string,
    worker: WorkerEntity,
    shiftId: string,
  ): Promise<void> {
    this.assertPasswordChanged(user);
    if (!this.hasSiteRole(user, UserRole.CONTRACTOR_REPRESENTATIVE, siteId)) this.forbidden();
    if (!worker.contractorId) this.forbidden();

    const representative = await manager
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .findOneBy({ siteId, contractorId: worker.contractorId, userId: user.id });
    if (!representative) this.forbidden();
    if (!(await hasActiveContractorParticipation(manager, worker.contractorId, siteId)))
      this.forbidden();

    const shiftAssignment = await manager
      .getRepository(ContractorShiftAssignmentEntity)
      .findOneBy({ siteId, shiftId, contractorId: worker.contractorId });
    if (!shiftAssignment) this.forbidden();
  }

  async createShift(
    user: AuthenticatedUser,
    siteId: string,
    input: CreateShiftDto,
  ): Promise<ShiftEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    this.assertScheduleWriter(user, scopedSiteId);
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

  async deleteShift(user: AuthenticatedUser, siteId: string, shiftId: string): Promise<void> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    this.assertScheduleWriter(user, scopedSiteId);
    const scopedShiftId = uuid(shiftId);

    await this.dataSource.transaction(async (manager) => {
      const shiftRepository = manager.getRepository(ShiftEntity);
      const scheduleRepository = manager.getRepository(WorkerScheduleEntity);
      const shift = await shiftRepository.findOneBy({ id: scopedShiftId, siteId: scopedSiteId });
      if (!shift) missing();

      const assignedScheduleCount = await scheduleRepository.count({
        where: { siteId: scopedSiteId, shiftId: scopedShiftId },
      });
      if (assignedScheduleCount > 0) {
        conflict('Shift is already assigned to worker schedules and cannot be deleted');
      }

      const assignedContractorCount = await manager
        .getRepository(ContractorShiftAssignmentEntity)
        .count({ where: { siteId: scopedSiteId, shiftId: scopedShiftId } });
      if (assignedContractorCount > 0) {
        conflict('Shift is already assigned to contractors and cannot be deleted');
      }

      await shiftRepository.remove(shift);
    });
  }

  async createScheduleVersion(
    user: AuthenticatedUser,
    siteId: string,
    input: CreateScheduleVersionDto,
  ): Promise<ScheduleVersionEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    this.assertScheduleWriter(user, scopedSiteId);
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
    user: AuthenticatedUser,
    siteId: string,
    scheduleVersionId: string,
    input: CreateWorkerScheduleDto,
  ): Promise<WorkerScheduleEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    this.assertPasswordChanged(user);
    if (!this.hasSiteRole(user, UserRole.CONTRACTOR_REPRESENTATIVE, scopedSiteId)) this.forbidden();
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
      await this.assertWorkerScheduleWriter(manager, user, scopedSiteId, worker, shift.id);
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
          isActive: value.isActive ?? true,
        });
      } catch (error) {
        knownUnique(error, [
          'uq_worker_schedule_version_worker_shift_date',
          'uq_worker_schedule_active_worker_shift_date',
        ]);
      }
    });
  }

  async listShifts(
    user: AuthenticatedUser,
    siteId: string,
  ): Promise<{ items: ShiftEntity[]; total: number }> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const contractorId = await this.contractorScopeForReader(user, scopedSiteId);
    const query = this.dataSource
      .getRepository(ShiftEntity)
      .createQueryBuilder('shift')
      .where('shift.site_id = :siteId', { siteId: scopedSiteId });
    if (contractorId) {
      query
        .innerJoin(
          ContractorShiftAssignmentEntity,
          'assignment',
          'assignment.shift_id = shift.id AND assignment.site_id = shift.site_id',
        )
        .andWhere('assignment.contractor_id = :contractorId', { contractorId });
    }
    const [items, total] = await query
      .orderBy('shift.startsAt', 'ASC')
      .addOrderBy('shift.name', 'ASC')
      .getManyAndCount();
    return { items, total };
  }

  async assignShiftToContractor(
    user: AuthenticatedUser,
    siteId: string,
    shiftId: string,
    input: AssignShiftToContractorDto,
  ): Promise<ContractorShiftAssignmentEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const scopedShiftId = uuid(shiftId);
    this.assertScheduleWriter(user, scopedSiteId);
    const value = command(AssignShiftToContractorDto, input);
    const scopedContractorId = uuid(value.contractorId);

    return this.dataSource.transaction(async (manager) => {
      const [shift, contractor, participations] = await Promise.all([
        manager.getRepository(ShiftEntity).findOneBy({ id: scopedShiftId, siteId: scopedSiteId }),
        manager.getRepository(ContractorEntity).findOneBy({
          id: scopedContractorId,
          isActive: true,
        }),
        manager.getRepository(ContractorSiteParticipationEntity).findBy({
          contractorId: scopedContractorId,
          siteId: scopedSiteId,
          isActive: true,
        }),
      ]);
      const now = Date.now();
      if (
        !shift ||
        !contractor ||
        !participations.some(
          ({ validFrom, validUntil }) =>
            validFrom.getTime() <= now && (validUntil === null || validUntil.getTime() > now),
        )
      )
        missing();
      try {
        return await manager.getRepository(ContractorShiftAssignmentEntity).save({
          id: randomUUID(),
          siteId: scopedSiteId,
          shiftId: shift.id,
          contractorId: contractor.id,
        });
      } catch (error) {
        knownUnique(error, ['uq_contractor_shift_assignment']);
      }
    });
  }

  async listShiftContractorAssignments(
    user: AuthenticatedUser,
    siteId: string,
    offset = '0',
    limit = '50',
  ): Promise<{ items: ContractorShiftAssignmentEntity[]; total: number }> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const contractorId = await this.contractorScopeForReader(user, scopedSiteId);
    const pagination = page(Number(offset), Number(limit));
    const query = this.dataSource
      .getRepository(ContractorShiftAssignmentEntity)
      .createQueryBuilder('assignment')
      .where('assignment.site_id = :siteId', { siteId: scopedSiteId });
    if (contractorId) query.andWhere('assignment.contractor_id = :contractorId', { contractorId });
    const [items, total] = await query
      .orderBy('assignment.createdAt', 'DESC')
      .addOrderBy('assignment.id', 'ASC')
      .skip(pagination.offset)
      .take(pagination.limit)
      .getManyAndCount();
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
    input: ListWorkerSchedulesQueryDto = {},
  ): Promise<{ items: WorkerScheduleEntity[]; total: number }> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const pagination = page(Number(input.offset ?? '0'), Number(input.limit ?? '20'));
    if (input.fromDate && input.toDate && input.fromDate > input.toDate) {
      invalid('fromDate must be before or equal to toDate');
    }

    // Authorization check
    let contractorIdScope: string | undefined;
    let workerIdScope: string | undefined;
    if (
      !user.roleAssignments.some(
        (r) =>
          r.role === UserRole.ADMIN ||
          (r.siteId === scopedSiteId && r.role === UserRole.SITE_MANAGER),
      )
    ) {
      // Must be CONTRACTOR_REPRESENTATIVE or WORKER
      const rep = this.hasSiteRole(user, UserRole.CONTRACTOR_REPRESENTATIVE, scopedSiteId)
        ? await this.dataSource
            .getRepository(ContractorRepresentativeAssignmentEntity)
            .findOneBy({ siteId: scopedSiteId, userId: user.id })
        : null;
      if (rep) {
        if (
          !(await hasActiveContractorParticipation(
            this.dataSource.manager,
            rep.contractorId,
            scopedSiteId,
          ))
        )
          this.forbidden();
        contractorIdScope = rep.contractorId;
      } else {
        const worker = this.hasSiteRole(user, UserRole.WORKER, scopedSiteId)
          ? await this.dataSource
              .getRepository(WorkerEntity)
              .findOneBy({ siteId: scopedSiteId, userId: user.id })
          : null;
        if (
          worker?.isActive &&
          worker.contractorId &&
          (await hasActiveContractorParticipation(
            this.dataSource.manager,
            worker.contractorId,
            scopedSiteId,
          ))
        ) {
          workerIdScope = worker.id;
        } else {
          throw new PublicHttpException(HttpStatus.FORBIDDEN, {
            code: 'FORBIDDEN',
            message: 'Forbidden',
          });
        }
      }
    }

    const query = this.dataSource
      .getRepository(WorkerScheduleEntity)
      .createQueryBuilder('schedule')
      .where('schedule.site_id = :siteId', { siteId: scopedSiteId });

    if (contractorIdScope) {
      query
        .innerJoin('worker', 'w', 'schedule.worker_id = w.id')
        .andWhere('w.contractor_id = :contractorId', { contractorId: contractorIdScope });
    }
    if (workerIdScope)
      query.andWhere('schedule.worker_id = :workerId', { workerId: workerIdScope });
    if (input.workerId)
      query.andWhere('schedule.worker_id = :requestedWorkerId', {
        requestedWorkerId: uuid(input.workerId),
      });
    if (input.shiftId)
      query.andWhere('schedule.shift_id = :shiftId', { shiftId: uuid(input.shiftId) });
    if (input.fromDate)
      query.andWhere('schedule.work_date >= :fromDate', { fromDate: input.fromDate });
    if (input.toDate) query.andWhere('schedule.work_date <= :toDate', { toDate: input.toDate });
    if (input.status === 'ACTIVE') query.andWhere('schedule.is_active = true');
    if (input.status === 'INACTIVE') query.andWhere('schedule.is_active = false');
    if (input.searchName) {
      if (!contractorIdScope) {
        query.innerJoin('worker', 'w', 'schedule.worker_id = w.id');
      }
      query.andWhere('(w.display_name ILIKE :searchName OR w.external_id ILIKE :searchName)', {
        searchName: `%${input.searchName}%`,
      });
    }

    const [items, total] = await query
      .orderBy('schedule.workDate', 'ASC')
      .addOrderBy('schedule.id', 'ASC')
      .skip(pagination.offset)
      .take(pagination.limit)
      .getManyAndCount();

    return { items, total };
  }

  async listEligibleShifts(user: AuthenticatedUser, siteId: string, workerScheduleId: string) {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const { schedule, worker } = await this.activeScheduleForReader(
      user,
      scopedSiteId,
      workerScheduleId,
    );
    if (!worker.contractorId) return { items: [], total: 0 };
    const shifts = await this.dataSource
      .getRepository(ShiftEntity)
      .createQueryBuilder('shift')
      .innerJoin(
        ContractorShiftAssignmentEntity,
        'assignment',
        'assignment.shift_id = shift.id AND assignment.site_id = shift.site_id',
      )
      .where('shift.site_id = :siteId', { siteId: scopedSiteId })
      .andWhere('assignment.contractor_id = :contractorId', { contractorId: worker.contractorId })
      .orderBy('shift.startsAt', 'ASC')
      .addOrderBy('shift.name', 'ASC')
      .addOrderBy('shift.id', 'ASC')
      .getMany();
    const items = shifts
      .filter((shift) => shift.id !== schedule.shiftId)
      .map((shift) => this.shiftView(shift));
    return { items, total: items.length };
  }

  async listSwapCandidates(user: AuthenticatedUser, siteId: string, workerScheduleId: string) {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const { schedule, worker } = await this.activeScheduleForReader(
      user,
      scopedSiteId,
      workerScheduleId,
    );
    // A worker without a contractor has no valid coworker scope. Fail closed.
    if (!worker.contractorId) return { items: [], total: 0 };
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
      .addSelect('CAST(candidateSchedule.work_date AS TEXT)', 'workDate')
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
      .andWhere('candidateWorker.contractor_id = :contractorId', {
        contractorId: worker.contractorId,
      })
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
