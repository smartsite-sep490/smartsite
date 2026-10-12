import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import type { AttendanceDayStatus } from '@smartsite/contracts';
import { SiteEntity } from './site.entity.js';
import { WorkerEntity } from './worker.entity.js';
import { WorkerScheduleEntity } from './worker-schedule.entity.js';
import { UserEntity } from './user.entity.js';
import { ShiftEntity } from './shift.entity.js';

@Entity({ name: 'attendance_day' })
@Unique('uq_attendance_day_worker_date', ['siteId', 'workerId', 'workDate'])
@Index('idx_attendance_day_due', ['status', 'endsAt'])
@Check('attendance_day_status_check', "status IN ('IN_PROGRESS','NEEDS_REVIEW','CONFIRMED')")
@Check('attendance_day_regular_minutes_check', 'regular_minutes >= 0')
@Check('attendance_day_overtime_minutes_check', 'overtime_minutes >= 0')
@Check('attendance_day_provisional_minutes_check', 'provisional_minutes >= 0')
@Check('attendance_day_confirmed_minutes_check', 'confirmed_minutes >= 0')
@Check('attendance_day_version_check', 'version > 0')
@Check(
  'attendance_day_break_check',
  '(break_starts_at IS NULL AND break_ends_at IS NULL) OR (break_starts_at IS NOT NULL AND break_ends_at IS NOT NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND break_starts_at >= starts_at AND break_ends_at <= ends_at AND break_ends_at > break_starts_at)',
)
@Check('attendance_day_check', '(starts_at IS NULL AND ends_at IS NULL) OR ends_at > starts_at')
export class AttendanceDayEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'attendance_day_site_id_fkey', onDelete: 'RESTRICT' })
  siteId!: string;
  @Column({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, { name: 'attendance_day_worker_id_fkey', onDelete: 'RESTRICT' })
  workerId!: string;
  @Column({ name: 'work_date', type: 'date' }) workDate!: string;
  @Column({ type: 'varchar', length: 64 }) timezone!: string;
  @Column({ name: 'schedule_id', type: 'uuid', nullable: true })
  @ForeignKey(() => WorkerScheduleEntity, {
    name: 'attendance_day_schedule_id_fkey',
    onDelete: 'RESTRICT',
  })
  scheduleId!: string | null;
  @Column({ name: 'shift_name', type: 'varchar', length: 160, nullable: true }) shiftName!:
    string | null;
  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true }) startsAt!: Date | null;
  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true }) endsAt!: Date | null;
  @Column({ name: 'break_starts_at', type: 'timestamptz', nullable: true })
  breakStartsAt!: Date | null;
  @Column({ name: 'break_ends_at', type: 'timestamptz', nullable: true }) breakEndsAt!: Date | null;
  @Column({ type: 'varchar', length: 16 }) status!: AttendanceDayStatus;
  @Column({ name: 'regular_minutes', type: 'integer', default: 0 }) regularMinutes!: number;
  @Column({ name: 'overtime_minutes', type: 'integer', default: 0 }) overtimeMinutes!: number;
  @Column({ name: 'provisional_minutes', type: 'integer', default: 0 }) provisionalMinutes!: number;
  @Column({ name: 'confirmed_minutes', type: 'integer', nullable: true }) confirmedMinutes!:
    number | null;
  @Column({ type: 'jsonb', default: () => "'[]'" }) anomalies!: string[];
  @Column({ type: 'integer', default: 1 }) version!: number;
  @Column({ name: 'review_note', type: 'text', nullable: true }) reviewNote!: string | null;
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'attendance_day_reviewed_by_fkey', onDelete: 'RESTRICT' })
  reviewedBy!: string | null;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true }) reviewedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'overtime_request' })
@Index('idx_overtime_schedule', ['scheduleId', 'status'])
@Check('overtime_request_check', 'ends_at > starts_at')
@Check('overtime_request_status_check', "status IN ('PENDING','APPROVED','REJECTED')")
@Check('overtime_request_check1', 'reviewed_by IS NULL OR reviewed_by <> requested_by')
export class OvertimeRequestEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'overtime_request_site_id_fkey', onDelete: 'RESTRICT' })
  siteId!: string;
  @Column({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, { name: 'overtime_request_worker_id_fkey', onDelete: 'RESTRICT' })
  workerId!: string;
  @Column({ name: 'schedule_id', type: 'uuid' })
  @ForeignKey(() => WorkerScheduleEntity, {
    name: 'overtime_request_schedule_id_fkey',
    onDelete: 'RESTRICT',
  })
  scheduleId!: string;
  @Column({ name: 'expected_shift_id', type: 'uuid' })
  @ForeignKey(() => ShiftEntity, {
    name: 'overtime_request_expected_shift_id_fkey',
    onDelete: 'RESTRICT',
  })
  expectedShiftId!: string;
  @Column({ name: 'starts_at', type: 'timestamptz' }) startsAt!: Date;
  @Column({ name: 'ends_at', type: 'timestamptz' }) endsAt!: Date;
  @Column({ name: 'requested_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, {
    name: 'overtime_request_requested_by_fkey',
    onDelete: 'RESTRICT',
  })
  requestedBy!: string;
  @Column({ type: 'text' }) reason!: string;
  @Column({ type: 'varchar', length: 16 }) status!: 'PENDING' | 'APPROVED' | 'REJECTED';
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'overtime_request_reviewed_by_fkey', onDelete: 'RESTRICT' })
  reviewedBy!: string | null;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true }) reviewedAt!: Date | null;
  @Column({ name: 'review_note', type: 'text', nullable: true }) reviewNote!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
