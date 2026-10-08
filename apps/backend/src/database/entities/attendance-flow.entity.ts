import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SiteEntity } from './site.entity.js';
import { WorkerEntity } from './worker.entity.js';
import { UserEntity } from './user.entity.js';
import { WorkerSiteZoneAssignmentEntity } from './worker-site-zone-assignment.entity.js';
import { WorkerScheduleEntity } from './worker-schedule.entity.js';
import { GateEventEntity } from './access-flow.entity.js';

@Entity({ name: 'attendance_event' })
@Index('uq_attendance_event_gate', ['gateEventId'], { unique: true })
@Check(
  'ck_attendance_event_kind',
  "kind IN ('CHECK_IN','CHECK_OUT') AND method IN ('FACE','QR','MANUAL')",
)
export class AttendanceEventEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_attendance_event_id' }) id!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_attendance_event_site', onDelete: 'RESTRICT' })
  siteId!: string;
  @Column({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, { name: 'fk_attendance_event_worker', onDelete: 'RESTRICT' })
  workerId!: string;
  @Column({ name: 'worker_assignment_id', type: 'uuid', nullable: true })
  @ForeignKey(() => WorkerSiteZoneAssignmentEntity, {
    name: 'fk_attendance_event_assignment',
    onDelete: 'RESTRICT',
  })
  workerAssignmentId!: string | null;
  @Column({ name: 'shift_assignment_id', type: 'uuid', nullable: true })
  @ForeignKey(() => WorkerScheduleEntity, {
    name: 'fk_attendance_event_schedule',
    onDelete: 'RESTRICT',
  })
  shiftAssignmentId!: string | null;
  @Column({ type: 'varchar', length: 16 }) kind!: 'CHECK_IN' | 'CHECK_OUT';
  @Column({ type: 'varchar', length: 10 }) method!: 'FACE' | 'QR' | 'MANUAL';
  @Column({ name: 'gate_event_id', type: 'uuid', nullable: true })
  @ForeignKey(() => GateEventEntity, { name: 'fk_attendance_event_gate', onDelete: 'RESTRICT' })
  gateEventId!: string | null;
  @Column({ name: 'occurred_at', type: 'timestamptz' }) occurredAt!: Date;
  @Column({ name: 'recorded_by', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_attendance_event_recorder', onDelete: 'RESTRICT' })
  recordedBy!: string | null;
  @Column({ name: 'reason_code', type: 'varchar', length: 100 }) reasonCode!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ name: 'attendance_session' })
@Index('uq_attendance_session_in', ['checkInEventId'], { unique: true })
@Index('uq_attendance_session_out', ['checkOutEventId'], { unique: true })
@Index('uq_attendance_session_correction', ['appliedCorrectionId'], { unique: true })
@Index('uq_attendance_session_open', ['siteId', 'workerId'], {
  unique: true,
  where: 'check_out_event_id IS NULL AND effective_out_at IS NULL',
})
@Check(
  'ck_attendance_session_events',
  'check_in_event_id IS NOT NULL OR check_out_event_id IS NOT NULL',
)
@Check(
  'ck_attendance_session_distinct',
  'check_in_event_id IS NULL OR check_out_event_id IS NULL OR check_in_event_id <> check_out_event_id',
)
@Check(
  'ck_attendance_session_interval',
  'effective_in_at IS NULL OR effective_out_at IS NULL OR effective_out_at >= effective_in_at',
)
@Check(
  'ck_attendance_session_status',
  "status IN ('MATCHED','MISSING_IN','MISSING_OUT','NEEDS_REVIEW','CORRECTED')",
)
export class AttendanceSessionEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_attendance_session_id' })
  id!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_attendance_session_site', onDelete: 'RESTRICT' })
  siteId!: string;
  @Column({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, { name: 'fk_attendance_session_worker', onDelete: 'RESTRICT' })
  workerId!: string;
  @Column({ name: 'shift_assignment_id', type: 'uuid', nullable: true })
  @ForeignKey(() => WorkerScheduleEntity, {
    name: 'fk_attendance_session_schedule',
    onDelete: 'RESTRICT',
  })
  shiftAssignmentId!: string | null;
  @Column({ name: 'check_in_event_id', type: 'uuid', nullable: true })
  @ForeignKey(() => AttendanceEventEntity, {
    name: 'fk_attendance_session_in',
    onDelete: 'RESTRICT',
  })
  checkInEventId!: string | null;
  @Column({ name: 'check_out_event_id', type: 'uuid', nullable: true })
  @ForeignKey(() => AttendanceEventEntity, {
    name: 'fk_attendance_session_out',
    onDelete: 'RESTRICT',
  })
  checkOutEventId!: string | null;
  @Column({ name: 'effective_in_at', type: 'timestamptz', nullable: true })
  effectiveInAt!: Date | null;
  @Column({ name: 'effective_out_at', type: 'timestamptz', nullable: true })
  effectiveOutAt!: Date | null;
  @Column({ type: 'varchar', length: 16 }) status!:
    'MATCHED' | 'MISSING_IN' | 'MISSING_OUT' | 'NEEDS_REVIEW' | 'CORRECTED';
  @Column({ name: 'applied_correction_id', type: 'uuid', nullable: true })
  @ForeignKey(() => AttendanceCorrectionEntity, {
    name: 'fk_attendance_session_correction',
    onDelete: 'RESTRICT',
  })
  appliedCorrectionId!: string | null;
  @Column({ type: 'integer', default: 1 }) version!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'attendance_correction' })
@Check('ck_attendance_correction_interval', 'proposed_out_at >= proposed_in_at')
@Check('ck_attendance_correction_self_review', 'reviewed_by IS NULL OR reviewed_by <> requested_by')
@Check('ck_attendance_correction_status', "status IN ('PENDING','APPROVED','REJECTED','CANCELLED')")
export class AttendanceCorrectionEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_attendance_correction_id' })
  id!: string;
  @Column({ name: 'attendance_session_id', type: 'uuid' })
  @ForeignKey(() => AttendanceSessionEntity, {
    name: 'fk_attendance_correction_session',
    onDelete: 'RESTRICT',
  })
  attendanceSessionId!: string;
  @Column({ name: 'requested_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, {
    name: 'fk_attendance_correction_requester',
    onDelete: 'RESTRICT',
  })
  requestedBy!: string;
  @Column({ name: 'expected_session_version', type: 'integer' }) expectedSessionVersion!: number;
  @Column({ name: 'proposed_in_at', type: 'timestamptz' }) proposedInAt!: Date;
  @Column({ name: 'proposed_out_at', type: 'timestamptz' }) proposedOutAt!: Date;
  @Column({ type: 'text' }) reason!: string;
  @Column({ type: 'varchar', length: 16 }) status!:
    'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_attendance_correction_reviewer', onDelete: 'RESTRICT' })
  reviewedBy!: string | null;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true }) reviewedAt!: Date | null;
  @Column({ name: 'review_note', type: 'text', nullable: true }) reviewNote!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
