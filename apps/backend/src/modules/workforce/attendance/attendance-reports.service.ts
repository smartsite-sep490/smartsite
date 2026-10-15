import { Injectable } from '@nestjs/common';
import { DataSource, In, type EntityManager } from 'typeorm';
import type {
  AttendanceSummaryResponse,
  AttendanceWorkersResponse,
  AttendanceWorkerReport,
} from '@smartsite/contracts';
import { command, invalid, missing, page, uuid } from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import {
  AttendanceDayEntity,
  AttendanceSessionEntity,
  AbsenceRequestEntity,
  AbsenceRequestStatus,
  WorkerEntity,
  WorkerScheduleEntity,
  ShiftEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  ContractorRepresentativeAssignmentEntity,
  SiteEntity,
} from '../../../database/entities/index.js';
import type { WorkforceActor } from '../directory/contractor-operations.service.js';
import { hasActiveContractorParticipation } from '../shared/contractor-participation.js';
import { workDateAt } from './attendance-calculation.js';
import {
  attendancePercentage,
  emptyReportMetrics,
  reportDates,
  workerAttendanceReport,
} from './attendance-report-calculation.js';
import { AttendanceReportDto, AttendanceWorkersDto } from './dto/attendance-report.dto.js';

const forbidden = (): never => {
  throw new PublicHttpException(403, {
    code: 'FORBIDDEN',
    message: 'Attendance reports are outside your scope',
  });
};

@Injectable()
export class AttendanceReportsService {
  constructor(private readonly source: DataSource) {}

  private range(value: AttendanceReportDto, now: Date) {
    for (const key of ['workerId', 'contractorId', 'shiftId'] as const)
      if (value[key]) value[key] = value[key].toLowerCase();
    const length =
      (Date.parse(`${value.toDate}T00:00:00Z`) - Date.parse(`${value.fromDate}T00:00:00Z`)) /
        86400000 +
      1;
    if (!Number.isInteger(length) || length < 1 || length > 366)
      invalid('Select an inclusive date range of at most 366 days');
    const timezone = value.timezone ?? 'Asia/Ho_Chi_Minh';
    let today: string;
    try {
      today = workDateAt(now, timezone);
    } catch {
      invalid('Invalid report timezone');
    }
    const previousFrom = new Date(Date.parse(`${value.fromDate}T00:00:00Z`) - length * 86400000)
      .toISOString()
      .slice(0, 10);
    const previousTo = new Date(Date.parse(`${value.fromDate}T00:00:00Z`) - 86400000)
      .toISOString()
      .slice(0, 10);
    return {
      fromDate: value.fromDate,
      toDate: value.toDate,
      timezone,
      today,
      asOf: now.toISOString(),
      previousFrom,
      previousTo,
    };
  }

  private async workers(
    manager: EntityManager,
    actor: WorkforceActor,
    siteId: string,
    value: AttendanceReportDto,
  ): Promise<WorkerEntity[]> {
    const user = await manager
      .getRepository(UserEntity)
      .findOneBy({ id: actor.id, isActive: true, mustChangePassword: false });
    if (!user) forbidden();
    const roles = await manager
      .getRepository(UserRoleAssignmentEntity)
      .findBy({ userId: actor.id });
    const staff = roles.some(
      (r) =>
        (r.role === UserRole.ADMIN && r.siteId === null) ||
        (r.siteId === siteId &&
          [UserRole.SITE_MANAGER, UserRole.SECURITY_OFFICER].includes(r.role)),
    );
    const contractors: string[] = [];
    if (roles.some((r) => r.siteId === siteId && r.role === UserRole.CONTRACTOR_REPRESENTATIVE)) {
      const assignments = await manager
        .getRepository(ContractorRepresentativeAssignmentEntity)
        .findBy({ userId: actor.id, siteId });
      for (const a of assignments)
        if (await hasActiveContractorParticipation(manager, a.contractorId, siteId))
          contractors.push(a.contractorId);
    }
    const self = roles.some((r) => r.siteId === siteId && r.role === UserRole.WORKER)
      ? await manager
          .getRepository(WorkerEntity)
          .findOneBy({ userId: actor.id, siteId, isActive: true })
      : null;
    const selfAllowed =
      self?.contractorId &&
      (await hasActiveContractorParticipation(manager, self.contractorId, siteId));
    if (!staff && !contractors.length && !selfAllowed) forbidden();
    if (!(await manager.getRepository(SiteEntity).existsBy({ id: siteId }))) missing();
    if (
      value.shiftId &&
      !(await manager.getRepository(ShiftEntity).existsBy({ id: value.shiftId, siteId }))
    )
      forbidden();
    const query = manager
      .getRepository(WorkerEntity)
      .createQueryBuilder('worker')
      .where('worker.site_id=:siteId AND worker.is_active=true', { siteId });
    if (!staff) {
      const clauses: string[] = [];
      if (contractors.length) clauses.push('worker.contractor_id IN (:...contractors)');
      if (selfAllowed) clauses.push('worker.id=:selfId');
      query.andWhere(`(${clauses.join(' OR ')})`, { contractors, selfId: self?.id });
    }
    if (value.contractorId) {
      if (
        !staff &&
        !contractors.includes(value.contractorId) &&
        self?.contractorId !== value.contractorId
      )
        forbidden();
      query.andWhere('worker.contractor_id=:contractorId', { contractorId: value.contractorId });
    }
    const visible = await query
      .orderBy('worker.displayName', 'ASC')
      .addOrderBy('worker.id', 'ASC')
      .getMany();
    if (value.workerId && !visible.some((w) => w.id === value.workerId)) forbidden();
    const search = value.search?.trim().toLocaleLowerCase('vi');
    return visible.filter(
      (w) =>
        (!value.workerId || w.id === value.workerId) &&
        (!search ||
          w.displayName.toLocaleLowerCase('vi').includes(search) ||
          w.externalId.toLocaleLowerCase('vi').includes(search)),
    );
  }

  private async read(
    manager: EntityManager,
    actor: WorkforceActor,
    siteId: string,
    value: AttendanceReportDto,
    now: Date,
    includeDaily: boolean,
    compare: boolean,
  ) {
    const range = this.range(value, now);
    const workers = await this.workers(manager, actor, siteId, value);
    const metadata = {
      siteId,
      fromDate: range.fromDate,
      toDate: range.toDate,
      timezone: range.timezone,
      today: range.today,
      asOf: range.asOf,
    };
    if (!workers.length)
      return {
        metadata,
        rows: [] as AttendanceWorkerReport[],
        previous: { fromDate: range.previousFrom, toDate: range.previousTo, totalMinutes: 0 },
      };
    const ids = workers.map((w) => w.id);
    const parameters = {
      siteId,
      ids,
      from: value.fromDate,
      to: value.toDate,
      today: range.today,
      previousFrom: range.previousFrom,
      previousTo: range.previousTo,
    };
    const schedules = await manager
      .getRepository(WorkerScheduleEntity)
      .createQueryBuilder('s')
      .where('s.site_id=:siteId AND s.worker_id IN (:...ids) AND s.is_active=true', parameters)
      .andWhere(
        `(s.work_date BETWEEN :from AND :to OR s.work_date=:today${compare && value.shiftId ? ' OR s.work_date BETWEEN :previousFrom AND :previousTo' : ''})`,
      )
      .getMany();
    const shifts = schedules.length
      ? await manager
          .getRepository(ShiftEntity)
          .findBy({ siteId, id: In([...new Set(schedules.map((s) => s.shiftId))]) })
      : [];
    const daysQuery = manager
      .getRepository(AttendanceDayEntity)
      .createQueryBuilder('d')
      .where('d.site_id=:siteId AND d.worker_id IN (:...ids)', parameters)
      .andWhere(
        `(d.work_date BETWEEN :from AND :to OR d.work_date=:today${compare ? ' OR d.work_date BETWEEN :previousFrom AND :previousTo' : ''})`,
      );
    const days = await daysQuery.getMany();
    const sessions = days.length
      ? await manager
          .getRepository(AttendanceSessionEntity)
          .findBy({ siteId, dayId: In(days.map((d) => d.id)) })
      : [];
    const leaves = schedules.length
      ? await manager
          .getRepository(AbsenceRequestEntity)
          .findBy({
            siteId,
            workerScheduleId: In(schedules.map((s) => s.id)),
            status: AbsenceRequestStatus.APPROVED,
          })
      : [];
    const dates = reportDates(value.fromDate, value.toDate);
    const selectedSchedules = value.shiftId
      ? schedules.filter((s) => s.shiftId === value.shiftId)
      : schedules;
    const selectedIds = new Set(selectedSchedules.map((s) => s.id));
    const selectedWorkers = value.shiftId
      ? workers.filter((w) =>
          selectedSchedules.some(
            (s) =>
              s.workerId === w.id &&
              ((s.workDate >= value.fromDate && s.workDate <= value.toDate) ||
                s.workDate === range.today),
          ),
        )
      : workers;
    const rows = selectedWorkers
      .map((worker) =>
        workerAttendanceReport({
          worker,
          schedules: selectedSchedules.filter((s) => s.workerId === worker.id),
          shifts,
          days: days.filter(
            (d) =>
              d.workerId === worker.id &&
              (!value.shiftId || (d.scheduleId && selectedIds.has(d.scheduleId))),
          ),
          sessions: sessions.filter((s) => s.workerId === worker.id),
          leaves,
          dates,
          today: range.today,
          now,
          includeDaily,
        }),
      )
      .filter((w) => !value.todayStatus || w.todayStatus === value.todayStatus);
    const resultIds = new Set(rows.map((r) => r.workerId));
    // Previous-period hours use the same current roster, search and status scope.
    const previousMinutes = days
      .filter(
        (d) =>
          resultIds.has(d.workerId) &&
          d.workDate >= range.previousFrom &&
          d.workDate <= range.previousTo &&
          d.status === 'CONFIRMED' &&
          (!value.shiftId || (d.scheduleId && selectedIds.has(d.scheduleId))),
      )
      .reduce((total, d) => total + (d.confirmedMinutes ?? 0), 0);
    return {
      metadata,
      rows,
      previous: {
        fromDate: range.previousFrom,
        toDate: range.previousTo,
        totalMinutes: previousMinutes,
      },
    };
  }

  async summary(
    actor: WorkforceActor,
    siteValue: string,
    input: AttendanceReportDto,
    now = new Date(),
  ): Promise<AttendanceSummaryResponse> {
    const siteId = uuid(siteValue).toLowerCase(),
      value = command(AttendanceReportDto, input);
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const { metadata, rows, previous } = await this.read(
        manager,
        actor,
        siteId,
        value,
        now,
        false,
        true,
      );
      const metrics = emptyReportMetrics();
      for (const row of rows) {
        for (const key of [
          'regularMinutes',
          'overtimeMinutes',
          'totalMinutes',
          'provisionalMinutes',
          'confirmedDays',
          'requiredDays',
          'presentDays',
          'absentDays',
          'reviewDays',
        ] as const)
          metrics[key] += row[key];
      }
      metrics.attendanceRate = attendancePercentage(metrics.presentDays, metrics.requiredDays);
      metrics.isProvisional = metrics.reviewDays > 0;
      return {
        ...metadata,
        ...metrics,
        totalWorkers: rows.length,
        absentTodayCount: rows.filter((w) => w.todayStatus === 'ABSENT').length,
        overtimeWorkerCount: rows.filter((w) => w.overtimeMinutes > 0).length,
        previousPeriod: previous,
        workingMinutesChangePercent: previous.totalMinutes
          ? Math.round(
              ((metrics.totalMinutes - previous.totalMinutes) / previous.totalMinutes) * 10000,
            ) / 100
          : null,
      };
    });
  }
  async list(
    actor: WorkforceActor,
    siteValue: string,
    input: AttendanceWorkersDto,
    now = new Date(),
  ): Promise<AttendanceWorkersResponse> {
    const siteId = uuid(siteValue).toLowerCase(),
      value = command(AttendanceWorkersDto, input),
      pagination = page(value.offset, value.limit);
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const { metadata, rows } = await this.read(
        manager,
        actor,
        siteId,
        value,
        now,
        value.includeDaily === true,
        false,
      );
      return {
        ...metadata,
        items: rows.slice(pagination.offset, pagination.offset + pagination.limit),
        total: rows.length,
        ...pagination,
      };
    });
  }
}
