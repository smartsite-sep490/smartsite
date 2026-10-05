import {
  Column,
  Check,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AlertStatus, AlertType } from './enums.js';
import { numericTransformer } from './numeric.transformer.js';
import { SiteEntity } from './site.entity.js';
import { ZoneEntity } from './zone.entity.js';
import { IncidentEntity } from './safety-workflow.entity.js';

@Entity({ name: 'safety_alert' })
@Check('chk_safety_alert_revision', 'revision >= 0')
@Index('idx_alert_grouping', ['groupingKey', 'status'])
@Index('idx_alert_site_last_detected', { synchronize: false })
@Index('idx_alert_incident', { synchronize: false })
export class SafetyAlertEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid', primaryKeyConstraintName: 'pk_safety_alert_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_alert_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  @ForeignKey(() => ZoneEntity, { name: 'fk_alert_zone', onDelete: 'SET NULL' })
  zoneId!: string | null;

  @Column({ name: 'incident_id', type: 'uuid', nullable: true })
  @ForeignKey(() => IncidentEntity, {
    name: 'safety_alert_incident_id_fkey',
    onDelete: 'NO ACTION',
  })
  incidentId!: string | null;

  @Column({ name: 'candidate_worker_id', type: 'varchar', length: 128, nullable: true })
  candidateWorkerId!: string | null;

  @Column({
    name: 'identity_similarity_score',
    type: 'numeric',
    precision: 5,
    scale: 4,
    nullable: true,
    transformer: numericTransformer,
  })
  identitySimilarityScore!: number | null;

  @Column({
    name: 'identity_quality_score',
    type: 'numeric',
    precision: 5,
    scale: 4,
    nullable: true,
    transformer: numericTransformer,
  })
  identityQualityScore!: number | null;

  @Column({
    name: 'alert_type',
    type: 'enum',
    enum: AlertType,
    enumName: 'alert_type',
  })
  alertType!: AlertType;

  @Column({ name: 'candidate_subtype', type: 'varchar', length: 64 })
  candidateSubtype!: string;

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

  @Column({ type: 'integer', default: 0 })
  revision!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
