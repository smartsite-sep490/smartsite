import { Check, Column, CreateDateColumn, Entity, ForeignKey, PrimaryColumn } from 'typeorm';
import { AiObservationEventEntity } from './ai-observation-event.entity.js';
import { SafetyAlertEntity } from './safety-alert.entity.js';

@Entity({ name: 'alert_detection_mapping' })
@Check('chk_mapping_person_observation_index', 'person_observation_index BETWEEN 0 AND 255')
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

  @Column({ name: 'person_observation_index', type: 'smallint', nullable: true })
  personObservationIndex!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
