import { CreateDateColumn, Entity, ForeignKey, PrimaryColumn } from 'typeorm';
import { AiObservationEventEntity } from './ai-observation-event.entity.js';
import { SafetyAlertEntity } from './safety-alert.entity.js';

@Entity({ name: 'alert_detection_mapping' })
export class AlertDetectionMappingEntity {
  @PrimaryColumn({
    name: 'alert_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_alert_detection_mapping',
  })
  @ForeignKey(() => SafetyAlertEntity, { name: 'fk_mapping_alert', onDelete: 'CASCADE' })
  alertId!: string;

  @PrimaryColumn({
    name: 'event_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_alert_detection_mapping',
  })
  @ForeignKey(() => AiObservationEventEntity, (event) => event.eventId, {
    name: 'fk_mapping_event',
    onDelete: 'CASCADE',
  })
  eventId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
