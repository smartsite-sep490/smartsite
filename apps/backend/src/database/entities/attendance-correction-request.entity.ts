import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { AttendancePairEntity } from './attendance-pair.entity.js';
import { AttendanceCorrectionStatus } from './enums.js';
import { SiteEntity } from './site.entity.js';
import { UserEntity } from './user.entity.js';

@Entity({ name: 'attendance_correction_request' })
@Index('idx_attendance_correction_pair_status', ['attendancePairId', 'status'])
@Check(
  'chk_attendance_correction_status',
  "status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED')",
)
@Check('chk_attendance_correction_reason_length', 'char_length(reason) BETWEEN 5 AND 1000')
@Check('chk_attendance_correction_minutes', 'requested_minutes IS NULL OR requested_minutes >= 0')
export class AttendanceCorrectionRequestEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_attendance_correction_request_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_attendance_correction_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'attendance_pair_id', type: 'uuid' })
  @ForeignKey(() => AttendancePairEntity, {
    name: 'fk_attendance_correction_pair',
    onDelete: 'RESTRICT',
  })
  attendancePairId!: string;

  @Column({ name: 'requested_minutes', type: 'integer', nullable: true })
  requestedMinutes!: number | null;

  @Column({ name: 'requested_check_in_at', type: 'timestamptz', nullable: true })
  requestedCheckInAt!: Date | null;

  @Column({ name: 'requested_check_out_at', type: 'timestamptz', nullable: true })
  requestedCheckOutAt!: Date | null;

  @Column({ name: 'requested_by_user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, {
    name: 'fk_attendance_correction_requested_by',
    onDelete: 'RESTRICT',
  })
  requestedByUserId!: string;

  @Column({ type: 'varchar', length: 1000 })
  reason!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: AttendanceCorrectionStatus;

  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, {
    name: 'fk_attendance_correction_reviewed_by',
    onDelete: 'RESTRICT',
  })
  reviewedByUserId!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: 'review_reason', type: 'varchar', length: 1000, nullable: true })
  reviewReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
