import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { ScheduleVersionEntity } from './schedule-version.entity.js';
import { ShiftRequestStatus } from './enums.js';
import { ShiftEntity } from './shift.entity.js';
import { SiteEntity } from './site.entity.js';
import { UserEntity } from './user.entity.js';
import { WorkerEntity } from './worker.entity.js';
import { WorkerScheduleEntity } from './worker-schedule.entity.js';

@Entity({ name: 'shift_change_request' })
@Index('idx_shift_change_site_status', ['siteId', 'status', 'createdAt'])
@Check(
  'chk_shift_change_status',
  "status IN ('DRAFT', 'PENDING_COWORKER', 'PENDING_MANAGER', 'APPROVED', 'APPLIED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'CONFLICTED')",
)
@Check('chk_shift_change_reason_length', 'char_length(reason) BETWEEN 5 AND 1000')
export class ShiftChangeRequestEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_shift_change_request_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_shift_change_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, { name: 'fk_shift_change_worker', onDelete: 'RESTRICT' })
  workerId!: string;

  @Column({ name: 'worker_schedule_id', type: 'uuid' })
  @ForeignKey(() => WorkerScheduleEntity, {
    name: 'fk_shift_change_worker_schedule',
    onDelete: 'RESTRICT',
  })
  workerScheduleId!: string;

  @Column({ name: 'from_shift_id', type: 'uuid' })
  @ForeignKey(() => ShiftEntity, { name: 'fk_shift_change_from_shift', onDelete: 'RESTRICT' })
  fromShiftId!: string;

  @Column({ name: 'to_shift_id', type: 'uuid' })
  @ForeignKey(() => ShiftEntity, { name: 'fk_shift_change_to_shift', onDelete: 'RESTRICT' })
  toShiftId!: string;

  @Column({ name: 'expected_schedule_version_id', type: 'uuid' })
  @ForeignKey(() => ScheduleVersionEntity, {
    name: 'fk_shift_change_expected_version',
    onDelete: 'RESTRICT',
  })
  expectedScheduleVersionId!: string;

  @Column({ type: 'varchar', length: 24 })
  status!: ShiftRequestStatus;

  @Column({ name: 'requested_by_user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_shift_change_requested_by', onDelete: 'RESTRICT' })
  requestedByUserId!: string;

  @Column({ type: 'varchar', length: 1000 })
  reason!: string;

  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_shift_change_reviewed_by', onDelete: 'RESTRICT' })
  reviewedByUserId!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: 'review_reason', type: 'varchar', length: 1000, nullable: true })
  reviewReason!: string | null;

  @Column({ name: 'applied_at', type: 'timestamptz', nullable: true })
  appliedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
