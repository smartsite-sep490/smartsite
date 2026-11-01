import { Check, Column, Entity, ForeignKey, Index, PrimaryColumn, Unique } from 'typeorm';
import { SiteEntity } from './site.entity.js';
import { CameraEntity } from './camera.entity.js';
import { AiObservationEventEntity } from './ai-observation-event.entity.js';
import { UserEntity } from './user.entity.js';

/** Immutable original anchor; prototype TRACKED storage does not qualify identity or delivery. */
@Entity({ name: 'safety_episode' })
@Unique('uq_safety_episode_id_site', ['id', 'siteId'])
@Unique('uq_safety_episode_event_subject', ['eventId', 'personObservationIndex'])
@Index('idx_safety_episode_site_first', { synchronize: false })
@Index('idx_safety_episode_camera', ['cameraId'])
@Check(
  'safety_episode_person_observation_index_check',
  'person_observation_index BETWEEN 0 AND 255',
)
@Check('safety_episode_payload_hash_check', "payload_hash ~ '^[0-9a-f]{64}$'")
@Check('safety_episode_content_revision_check', 'content_revision BETWEEN 1 AND 2147483647')
@Check('safety_episode_collection_state_check', "collection_state IN ('COLLECTING','SEALED')")
@Check('chk_safety_episode_interval', 'last_observed_at>=first_observed_at')
@Check(
  'chk_safety_episode_subject_kind',
  "(subject_kind='EVENT_LOCAL' AND tracking_segment_id IS NULL AND tracking_scope_sha256 IS NULL) OR (subject_kind='TRACKED' AND tracking_segment_id IS NOT NULL AND tracking_scope_sha256 IS NOT NULL AND tracking_scope_sha256 ~ '^[a-f0-9]{64}$')",
)
@Index('uq_safety_episode_tracking_segment', { synchronize: false })
export class SafetyEpisodeEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'safety_episode_pkey', update: false })
  id!: string;

  /** Migration-owned composite FK binds the technical segment, scope, Site and camera. */
  @Column({
    name: 'subject_kind',
    type: 'varchar',
    length: 16,
    default: 'EVENT_LOCAL',
    update: false,
  })
  subjectKind!: 'EVENT_LOCAL' | 'TRACKED';

  @Column({ name: 'tracking_segment_id', type: 'uuid', nullable: true, update: false })
  trackingSegmentId!: string | null;

  @Column({
    name: 'tracking_scope_sha256',
    type: 'char',
    length: 64,
    nullable: true,
    update: false,
  })
  trackingScopeSha256!: string | null;

  @Column({ name: 'site_id', type: 'uuid', update: false })
  @ForeignKey(() => SiteEntity, { name: 'safety_episode_site_id_fkey', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'camera_id', type: 'uuid', update: false })
  @ForeignKey(() => CameraEntity, { name: 'safety_episode_camera_id_fkey', onDelete: 'RESTRICT' })
  cameraId!: string;

  @Column({ name: 'event_id', type: 'uuid', update: false })
  @ForeignKey(() => AiObservationEventEntity, {
    name: 'safety_episode_event_id_fkey',
    onDelete: 'RESTRICT',
  })
  eventId!: string;

  @Column({ name: 'person_observation_index', type: 'smallint', update: false })
  personObservationIndex!: number;

  @Column({ name: 'payload_hash', type: 'char', length: 64, update: false })
  payloadHash!: string;

  @Column({ name: 'first_observed_at', type: 'timestamptz', update: false })
  firstObservedAt!: Date;

  @Column({ name: 'last_observed_at', type: 'timestamptz' })
  lastObservedAt!: Date;

  @Column({ name: 'content_revision', type: 'integer', default: 1 })
  contentRevision!: number;

  @Column({ name: 'collection_state', type: 'varchar', length: 16, default: 'COLLECTING' })
  collectionState!: 'COLLECTING' | 'SEALED';

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'clock_timestamp()',
    update: false,
  })
  createdAt!: Date;
}

@Entity({ name: 'safety_episode_recipient' })
@Unique('uq_safety_episode_recipient', ['recipientUserId', 'episodeId'])
@ForeignKey(() => SafetyEpisodeEntity, ['episodeId', 'siteId'], ['id', 'siteId'], {
  name: 'fk_safety_episode_recipient_scope',
  onDelete: 'RESTRICT',
})
@Index('idx_safety_episode_recipient_episode', ['episodeId', 'siteId'])
@Index('idx_safety_episode_recipient_list', { synchronize: false })
@Check('safety_episode_recipient_seen_revision_check', 'seen_revision>=0')
export class SafetyEpisodeRecipientEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'safety_episode_recipient_pkey',
    update: false,
  })
  id!: string;

  @Column({ name: 'episode_id', type: 'uuid', update: false })
  episodeId!: string;

  @Column({ name: 'site_id', type: 'uuid', update: false })
  siteId!: string;

  @Column({ name: 'recipient_user_id', type: 'uuid', update: false })
  @ForeignKey(() => UserEntity, {
    name: 'safety_episode_recipient_recipient_user_id_fkey',
    onDelete: 'RESTRICT',
  })
  recipientUserId!: string;

  @Column({ name: 'seen_revision', type: 'integer', default: 0 })
  seenRevision!: number;

  @Column({
    name: 'first_delivered_at',
    type: 'timestamptz',
    default: () => 'clock_timestamp()',
    update: false,
  })
  firstDeliveredAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'clock_timestamp()' })
  updatedAt!: Date;
}
