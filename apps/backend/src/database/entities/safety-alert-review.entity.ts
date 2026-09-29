import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { AlertStatus } from './enums.js';
import { SafetyAlertEntity } from './safety-alert.entity.js';
import { SiteEntity } from './site.entity.js';
import { UserEntity } from './user.entity.js';

@Entity({ name: 'safety_alert_review' })
@Check('chk_safety_alert_review_reason_length', 'char_length(reason) BETWEEN 5 AND 1000')
@Check('chk_safety_alert_review_revision', 'alert_revision >= 1')
@Index('idx_safety_alert_review_alert_created', ['alertId', 'createdAt'])
export class SafetyAlertReviewEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_safety_alert_review_id' })
  id!: string;

  @Column({ name: 'alert_id', type: 'uuid' })
  @ForeignKey(() => SafetyAlertEntity, {
    name: 'fk_safety_alert_review_alert',
    onDelete: 'RESTRICT',
  })
  alertId!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, {
    name: 'fk_safety_alert_review_site',
    onDelete: 'RESTRICT',
  })
  siteId!: string;

  @Column({ name: 'actor_user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, {
    name: 'fk_safety_alert_review_actor',
    onDelete: 'RESTRICT',
  })
  actorUserId!: string;

  @Column({ name: 'from_status', type: 'enum', enum: AlertStatus, enumName: 'alert_status' })
  fromStatus!: AlertStatus;

  @Column({ name: 'to_status', type: 'enum', enum: AlertStatus, enumName: 'alert_status' })
  toStatus!: AlertStatus;

  @Column({ type: 'varchar', length: 1000 })
  reason!: string;

  @Column({ name: 'alert_revision', type: 'integer' })
  alertRevision!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
