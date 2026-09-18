import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'alert_detection_mapping' })
export class AlertDetectionMappingEntity {
  @PrimaryColumn({
    name: 'alert_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_alert_detection_mapping',
  })
  alertId!: string;

  @PrimaryColumn({
    name: 'event_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_alert_detection_mapping',
  })
  eventId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
