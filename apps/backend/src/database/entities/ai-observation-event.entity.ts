import { Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { CameraEntity } from './camera.entity.js';
import { EventProcessingStatus } from './enums.js';

@Entity({ name: 'ai_observation_event' })
@Index('idx_event_camera_session_captured', ['cameraExternalId', 'streamSessionId', 'capturedAt'])
@Index('uq_ai_event_frame_part', { synchronize: false })
@Index('idx_ai_event_source_frame', { synchronize: false })
export class AiObservationEventEntity {
  @PrimaryColumn({
    name: 'event_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_ai_observation_event_event_id',
  })
  eventId!: string;

  @Column({ name: 'payload_hash', type: 'char', length: 64 })
  payloadHash!: string;

  @Column({ name: 'camera_external_id', type: 'varchar', length: 128 })
  cameraExternalId!: string;

  @Column({ name: 'resolved_camera_id', type: 'uuid', nullable: true })
  @ForeignKey(() => CameraEntity, { name: 'fk_event_resolved_camera', onDelete: 'SET NULL' })
  resolvedCameraId!: string | null;

  @Column({ name: 'stream_session_id', type: 'uuid' })
  streamSessionId!: string;

  @Column({ name: 'captured_at', type: 'timestamptz' })
  capturedAt!: Date;

  @Column({ name: 'received_at', type: 'timestamptz', default: () => 'now()' })
  receivedAt!: Date;

  @Column({ name: 'raw_payload', type: 'jsonb' })
  rawPayload!: unknown;

  @Column({
    name: 'processing_status',
    type: 'enum',
    enum: EventProcessingStatus,
    enumName: 'event_processing_status',
  })
  processingStatus!: EventProcessingStatus;

  @Column({ name: 'processing_note', type: 'text', nullable: true })
  processingNote!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
