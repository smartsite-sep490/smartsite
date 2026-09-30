import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { AbsenceRequestStatus } from './enums.js';
import { ShiftEntity } from './shift.entity.js';
import { SiteEntity } from './site.entity.js';
import { UserEntity } from './user.entity.js';
import { WorkerEntity } from './worker.entity.js';
import { WorkerScheduleEntity } from './worker-schedule.entity.js';

@Entity({ name: 'absence_request' })
@Index('idx_absence_request_site_status', ['siteId', 'status', 'createdAt'])
@Check(
  'chk_absence_request_status',
  "status IN ('PENDING_MANAGER', 'APPROVED', 'REJECTED', 'CANCELLED')",
)
@Check('chk_absence_request_reason_length', 'char_length(reason) BETWEEN 5 AND 1000')
@Check(
  'chk_absence_request_replacement_distinct',
  'replacement_worker_id IS NULL OR replacement_worker_id <> worker_id',
)
export class AbsenceRequestEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_absence_request_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_absence_request_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, { name: 'fk_absence_request_worker', onDelete: 'RESTRICT' })
  workerId!: string;

  @Column({ name: 'worker_schedule_id', type: 'uuid' })
  @ForeignKey(() => WorkerScheduleEntity, {
    name: 'fk_absence_request_worker_schedule',
    onDelete: 'RESTRICT',
  })
  workerScheduleId!: string;

  @Column({ name: 'shift_id', type: 'uuid' })
  @ForeignKey(() => ShiftEntity, { name: 'fk_absence_request_shift', onDelete: 'RESTRICT' })
  shiftId!: string;

  @Column({ name: 'replacement_worker_id', type: 'uuid', nullable: true })
  @ForeignKey(() => WorkerEntity, {
    name: 'fk_absence_request_replacement_worker',
    onDelete: 'RESTRICT',
  })
  replacementWorkerId!: string | null;

  @Column({ name: 'requested_by_user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_absence_request_requested_by', onDelete: 'RESTRICT' })
  requestedByUserId!: string;

  @Column({ type: 'varchar', length: 1000 })
  reason!: string;

  @Column({ type: 'varchar', length: 24 })
  status!: AbsenceRequestStatus;

  @Column({ name: 'is_understaffed', type: 'boolean', default: false })
  isUnderstaffed!: boolean;

  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_absence_request_reviewed_by', onDelete: 'RESTRICT' })
  reviewedByUserId!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
