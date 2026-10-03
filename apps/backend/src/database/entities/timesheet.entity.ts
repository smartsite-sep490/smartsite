import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { SiteEntity } from './site.entity.js';
import { TimesheetStatus } from './enums.js';
import { UserEntity } from './user.entity.js';
import { WorkerEntity } from './worker.entity.js';

@Entity({ name: 'timesheet' })
@Index('idx_timesheet_site_period', ['siteId', 'periodStart', 'periodEnd', 'workerId'])
@Check('chk_timesheet_period', 'period_end >= period_start')
@Check(
  'chk_timesheet_status',
  "status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED')",
)
@Check('chk_timesheet_minutes', 'total_minutes >= 0')
export class TimesheetEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_timesheet_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_timesheet_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, { name: 'fk_timesheet_worker', onDelete: 'RESTRICT' })
  workerId!: string;

  @Column({ name: 'period_start', type: 'date' })
  periodStart!: string;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd!: string;

  @Column({ name: 'total_minutes', type: 'integer', default: 0 })
  totalMinutes!: number;

  @Column({ type: 'varchar', length: 24 })
  status!: TimesheetStatus;

  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_timesheet_approved_by', onDelete: 'RESTRICT' })
  approvedByUserId!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
