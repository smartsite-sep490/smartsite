import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { ScheduleVersionEntity } from './schedule-version.entity.js';
import { ShiftRequestStatus } from './enums.js';
import { ShiftEntity } from './shift.entity.js';
import { SiteEntity } from './site.entity.js';
import { UserEntity } from './user.entity.js';
import { WorkerEntity } from './worker.entity.js';
import { WorkerScheduleEntity } from './worker-schedule.entity.js';

@Entity({ name: 'shift_swap_request' })
@Index('idx_shift_swap_site_status', ['siteId', 'status', 'createdAt'])
@Check(
  'chk_shift_swap_status',
  "status IN ('DRAFT', 'PENDING_COWORKER', 'PENDING_MANAGER', 'APPROVED', 'APPLIED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'CONFLICTED')",
)
@Check('chk_shift_swap_distinct_workers', 'requester_worker_id <> coworker_worker_id')
@Check('chk_shift_swap_reason_length', 'char_length(reason) BETWEEN 5 AND 1000')
export class ShiftSwapRequestEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_shift_swap_request_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_shift_swap_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'requester_worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, { name: 'fk_shift_swap_requester_worker', onDelete: 'RESTRICT' })
  requesterWorkerId!: string;

  @Column({ name: 'requester_worker_schedule_id', type: 'uuid' })
  @ForeignKey(() => WorkerScheduleEntity, {
    name: 'fk_shift_swap_requester_schedule',
    onDelete: 'RESTRICT',
  })
  requesterWorkerScheduleId!: string;

  @Column({ name: 'coworker_worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, { name: 'fk_shift_swap_coworker_worker', onDelete: 'RESTRICT' })
  coworkerWorkerId!: string;

  @Column({ name: 'coworker_worker_schedule_id', type: 'uuid' })
  @ForeignKey(() => WorkerScheduleEntity, {
    name: 'fk_shift_swap_coworker_schedule',
    onDelete: 'RESTRICT',
  })
  coworkerWorkerScheduleId!: string;

  @Column({ name: 'requester_shift_id', type: 'uuid' })
  @ForeignKey(() => ShiftEntity, { name: 'fk_shift_swap_requester_shift', onDelete: 'RESTRICT' })
  requesterShiftId!: string;

  @Column({ name: 'coworker_shift_id', type: 'uuid' })
  @ForeignKey(() => ShiftEntity, { name: 'fk_shift_swap_coworker_shift', onDelete: 'RESTRICT' })
  coworkerShiftId!: string;

  @Column({ name: 'expected_schedule_version_id', type: 'uuid' })
  @ForeignKey(() => ScheduleVersionEntity, {
    name: 'fk_shift_swap_expected_version',
    onDelete: 'RESTRICT',
  })
  expectedScheduleVersionId!: string;

  @Column({ type: 'varchar', length: 24 })
  status!: ShiftRequestStatus;

  @Column({ name: 'requested_by_user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_shift_swap_requested_by', onDelete: 'RESTRICT' })
  requestedByUserId!: string;

  @Column({ type: 'varchar', length: 1000 })
  reason!: string;

  @Column({ name: 'coworker_confirmed_at', type: 'timestamptz', nullable: true })
  coworkerConfirmedAt!: Date | null;

  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_shift_swap_reviewed_by', onDelete: 'RESTRICT' })
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
