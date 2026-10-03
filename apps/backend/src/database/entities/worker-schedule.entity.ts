import { Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn, Unique } from 'typeorm';
import { ScheduleVersionEntity } from './schedule-version.entity.js';
import { ShiftEntity } from './shift.entity.js';
import { SiteEntity } from './site.entity.js';
import { WorkerEntity } from './worker.entity.js';

@Entity({ name: 'worker_schedule' })
@Unique('uq_worker_schedule_version_worker_shift_date', [
  'scheduleVersionId',
  'workerId',
  'shiftId',
  'workDate',
])
@Index('idx_worker_schedule_site_worker_date', ['siteId', 'workerId', 'workDate'])
@Index('uq_worker_schedule_active_worker_shift_date', ['siteId', 'workerId', 'shiftId', 'workDate'], {
  unique: true,
  where: 'is_active = true',
})
export class WorkerScheduleEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_worker_schedule_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_worker_schedule_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'schedule_version_id', type: 'uuid' })
  @ForeignKey(() => ScheduleVersionEntity, {
    name: 'fk_worker_schedule_version',
    onDelete: 'RESTRICT',
  })
  scheduleVersionId!: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, { name: 'fk_worker_schedule_worker', onDelete: 'RESTRICT' })
  workerId!: string;

  @Column({ name: 'shift_id', type: 'uuid' })
  @ForeignKey(() => ShiftEntity, { name: 'fk_worker_schedule_shift', onDelete: 'RESTRICT' })
  shiftId!: string;

  @Column({ name: 'work_date', type: 'date' })
  workDate!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
