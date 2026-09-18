import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import { AlertStatus, AlertType } from './enums.js';

@Entity({ name: 'safety_alert' })
@Index('idx_alert_grouping', ['groupingKey', 'status'])
export class SafetyAlertEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;

  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId!: string | null;

  @Column({ name: 'candidate_worker_id', type: 'varchar', length: 128, nullable: true })
  candidateWorkerId!: string | null;

  @Column({ name: 'identity_similarity_score', type: 'numeric', precision: 5, scale: 4, nullable: true })
  identitySimilarityScore!: number | null;

  @Column({ name: 'identity_quality_score', type: 'numeric', precision: 5, scale: 4, nullable: true })
  identityQualityScore!: number | null;

  @Column({
    name: 'alert_type',
    type: 'enum',
    enum: AlertType,
    enumName: 'alert_type',
  })
  alertType!: AlertType;

  @Column({ name: 'candidate_subtype', type: 'varchar', length: 64, nullable: true })
  candidateSubtype!: string | null;

  @Column({ name: 'grouping_key', type: 'varchar', length: 255 })
  groupingKey!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: AlertStatus,
    enumName: 'alert_status',
    default: AlertStatus.PENDING_REVIEW,
  })
  status!: AlertStatus;

  @Column({ name: 'first_detected_at', type: 'timestamptz' })
  firstDetectedAt!: Date;

  @Column({ name: 'last_detected_at', type: 'timestamptz' })
  lastDetectedAt!: Date;

  @Column({ name: 'detection_count', type: 'integer', default: 1 })
  detectionCount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
