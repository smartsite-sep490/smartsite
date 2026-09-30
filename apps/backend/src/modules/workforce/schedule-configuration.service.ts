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
}
