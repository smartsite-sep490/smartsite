import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { AttendancePairEntity } from './attendance-pair.entity.js';
import { AttendanceAnomalyCode } from './enums.js';
import { SiteEntity } from './site.entity.js';

@Entity({ name: 'attendance_anomaly' })
@Index('idx_attendance_anomaly_pair', ['attendancePairId', 'createdAt'])
@Check(
  'chk_attendance_anomaly_code',
  "code IN ('MISSING_IN', 'MISSING_OUT', 'OUT_WITHOUT_IN', 'DUPLICATE_IN', 'DUPLICATE_OUT', 'LATE_CHECKIN', 'EARLY_CHECKOUT', 'CROSS_MIDNIGHT')",
)
export class AttendanceAnomalyEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_attendance_anomaly_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_attendance_anomaly_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'attendance_pair_id', type: 'uuid' })
  @ForeignKey(() => AttendancePairEntity, {
    name: 'fk_attendance_anomaly_pair',
    onDelete: 'CASCADE',
  })
  attendancePairId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: AttendanceAnomalyCode;

  @Column({ type: 'varchar', length: 500, nullable: true })
  detail!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
