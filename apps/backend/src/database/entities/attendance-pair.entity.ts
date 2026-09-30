import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { AttendancePairStatus } from './enums.js';
import { ShiftEntity } from './shift.entity.js';
import { SiteEntity } from './site.entity.js';
import { UserEntity } from './user.entity.js';
import { WorkerEntity } from './worker.entity.js';

@Entity({ name: 'attendance_pair' })
@Index('idx_attendance_pair_site_work_date', ['siteId', 'workDate', 'workerId'])
@Check(
  'chk_attendance_pair_status',
  "status IN ('MATCHED', 'NEEDS_REVIEW', 'CALCULATED', 'CORRECTED', 'APPROVED', 'REJECTED')",
)
@Check('chk_attendance_pair_worked_minutes', 'worked_minutes IS NULL OR worked_minutes >= 0')
@Check('chk_attendance_pair_confirmed_minutes', 'confirmed_minutes IS NULL OR confirmed_minutes >= 0')
@Check('chk_attendance_pair_interval', 'check_out_at IS NULL OR check_in_at IS NULL OR check_out_at > check_in_at')
export class AttendancePairEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_attendance_pair_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_attendance_pair_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, { name: 'fk_attendance_pair_worker', onDelete: 'RESTRICT' })
  workerId!: string;

  @Column({ name: 'shift_id', type: 'uuid', nullable: true })
  @ForeignKey(() => ShiftEntity, { name: 'fk_attendance_pair_shift', onDelete: 'SET NULL' })
  shiftId!: string | null;

  @Column({ name: 'work_date', type: 'date' })
  workDate!: string;

  @Column({ name: 'check_in_at', type: 'timestamptz', nullable: true })
  checkInAt!: Date | null;

  @Column({ name: 'check_out_at', type: 'timestamptz', nullable: true })
  checkOutAt!: Date | null;

  @Column({ name: 'raw_event_refs', type: 'jsonb', default: () => "'[]'" })
  rawEventRefs!: unknown[];

  @Column({ type: 'varchar', length: 16 })
  status!: AttendancePairStatus;

  @Column({ name: 'worked_minutes', type: 'integer', nullable: true })
  workedMinutes!: number | null;

  @Column({ name: 'confirmed_minutes', type: 'integer', nullable: true })
  confirmedMinutes!: number | null;

  @Column({ name: 'confirmed_by_user_id', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_attendance_pair_confirmed_by', onDelete: 'RESTRICT' })
  confirmedByUserId!: string | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
