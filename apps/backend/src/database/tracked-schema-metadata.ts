import { Check, Column, Entity, ForeignKey, Index, PrimaryColumn, Unique } from 'typeorm';
import { AiObservationEventEntity } from './entities/ai-observation-event.entity.js';
import { CameraWorkerGenerationEntity } from './entities/camera-worker-generation.entity.js';
import { SafetyEpisodeEntity } from './entities/safety-episode.entity.js';

// Tracked writes use scoped SQL. These declarations describe the schema for the opt-in CLI.
const readThroughSql = { select: false, insert: false, update: false } as const;
const nullable = { ...readThroughSql, nullable: true } as const;
const generationScope = ['id', 'cameraId', 'siteId', 'streamSessionId'] satisfies [
  string,
  string,
  string,
  string,
];
const eventScope = [
  'eventId',
  'trackingScopeSha256',
  'trackingSiteId',
  'resolvedCameraId',
] satisfies [string, string, string, string];
const bundleScope = [
  'cameraId',
  'configurationVersion',
  'siteId',
  'viewRevision',
  'bundleSha256',
] satisfies [string, string, string, string, string];

@Entity({ name: 'camera_worker_generation' })
@Check(
  'chk_generation_observation_route',
  `((observation_route_mode IS NULL AND tracking_route_epoch IS NULL)
        OR (observation_route_mode='LEGACY' AND tracking_route_epoch IS NULL)
        OR (observation_route_mode='EPISODE_TRACKED' AND tracking_route_epoch IS NOT NULL)) IS TRUE`,
)
@Check(
  'chk_generation_tracked_wire_version',
  "(tracked_wire_version IS NULL OR ((observation_route_mode='EPISODE_TRACKED' AND tracked_wire_version IN ('1.5.0','1.6.0')) IS TRUE))",
)
@Unique('uq_generation_observation_route', [
  ...generationScope,
  'observationRouteMode',
  'trackingRouteEpoch',
])
class TrackedGenerationEntity extends CameraWorkerGenerationEntity {
  @Column({ ...nullable, name: 'observation_route_mode', type: 'varchar', length: 24 })
  observationRouteMode!: string | null;
  @Column({ ...nullable, name: 'tracking_route_epoch', type: 'uuid' })
  trackingRouteEpoch!: string | null;
  @Column({ ...nullable, name: 'tracked_wire_version', type: 'text' })
  trackedWireVersion!: string | null;
}

@Entity({ name: 'ai_observation_event' })
@Check(
  'chk_ai_event_admission_object',
  "admission_context IS NULL OR jsonb_typeof(admission_context)='object'",
)
@Check(
  'chk_ai_event_tracking_fields',
  `(num_nonnulls(tracking_scope_sha256,tracking_generation_id,tracking_site_id,tracking_frame_id,tracking_source_sequence,tracking_part_index,tracking_part_count,tracking_frame_state,tracking_pending_until,tracking_frame_result,tracking_transport_ack)=0) OR (
          num_nonnulls(tracking_scope_sha256,tracking_generation_id,tracking_site_id,tracking_frame_id,
            tracking_source_sequence,tracking_part_index,tracking_part_count,tracking_frame_state,
            tracking_pending_until,tracking_transport_ack)=10
          AND resolved_camera_id IS NOT NULL AND tracking_scope_sha256 ~ '^[a-f0-9]{64}$'
          AND tracking_source_sequence BETWEEN 0 AND 18446744073709551615
          AND tracking_part_count BETWEEN 1 AND 1024
          AND tracking_part_index>=0 AND tracking_part_index<tracking_part_count
          AND isfinite(tracking_pending_until)
          AND jsonb_typeof(tracking_transport_ack)='object'
          AND octet_length(tracking_transport_ack::text)<=1048576
          AND (tracking_frame_result IS NULL OR
            (jsonb_typeof(tracking_frame_result)='object' AND octet_length(tracking_frame_result::text)<=1048576))
          AND ((tracking_part_index>0 AND tracking_frame_state IN ('PART_STAGED','PART_EXPIRED') AND tracking_frame_result IS NULL)
            OR (tracking_part_index=0 AND tracking_frame_state IN ('PENDING_PARTS','PENDING_PREDECESSOR') AND tracking_frame_result IS NULL)
            OR (tracking_part_index=0 AND tracking_frame_state IN ('SEALED','REVIEW_ONLY') AND tracking_frame_result IS NOT NULL))
          AND (raw_payload->>'schemaVersion' IN ('1.5.0','1.6.0')
            AND lower(raw_payload->>'eventId')=event_id::text
            AND lower(raw_payload->>'streamSessionId')=stream_session_id::text
            AND raw_payload#>>'{framePartition,frameId}'=tracking_frame_id::text
            AND raw_payload#>>'{framePartition,sequenceNumber}'=tracking_source_sequence::text
            AND raw_payload#>>'{framePartition,partIndex}'=tracking_part_index::text
            AND raw_payload#>>'{framePartition,partCount}'=tracking_part_count::text) IS TRUE
        ) IS TRUE`,
)
@Check(
  'chk_ai_tracking_route',
  `(
      (tracking_scope_sha256 IS NULL AND safety_route_mode IS DISTINCT FROM 'EPISODE_TRACKED') OR
      (tracking_scope_sha256 IS NOT NULL AND safety_route_mode='EPISODE_TRACKED' AND safety_route_epoch IS NOT NULL)) IS TRUE`,
)
@Check(
  'chk_v16_requires_tracked_route',
  "raw_payload->>'schemaVersion' IS DISTINCT FROM '1.6.0' OR tracking_scope_sha256 IS NOT NULL",
)
@Unique('uq_ai_event_tracking_scope', eventScope)
@ForeignKey(
  'camera_worker_generation',
  ['trackingGenerationId', 'resolvedCameraId', 'trackingSiteId', 'streamSessionId'],
  generationScope,
  { name: 'fk_ai_event_tracking_generation', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'camera_worker_generation',
  [
    'trackingGenerationId',
    'resolvedCameraId',
    'trackingSiteId',
    'streamSessionId',
    'safetyRouteMode',
    'safetyRouteEpoch',
  ],
  [...generationScope, 'observationRouteMode', 'trackingRouteEpoch'],
  { name: 'fk_ai_tracking_route_owner', onDelete: 'RESTRICT' },
)
@Index('uq_ai_tracking_frame_part', { synchronize: false })
@Index('uq_ai_tracking_coordinator_sequence', { synchronize: false })
@Index('idx_ai_tracking_frame_parts', { synchronize: false })
@Index('idx_ai_tracking_watermark', { synchronize: false })
@Index('idx_ai_tracking_pending', { synchronize: false })
@Index('idx_ai_tracking_pending_coordinator', { synchronize: false })
class TrackedEventEntity extends AiObservationEventEntity {
  @Column({ ...nullable, name: 'admission_context', type: 'jsonb' })
  admissionContext!: unknown;
  @Column({ ...nullable, name: 'tracking_scope_sha256', type: 'char', length: 64 })
  trackingScopeSha256!: string | null;
  @Column({ ...nullable, name: 'tracking_generation_id', type: 'uuid' })
  trackingGenerationId!: string | null;
  @Column({ ...nullable, name: 'tracking_site_id', type: 'uuid' })
  trackingSiteId!: string | null;
  @Column({ ...nullable, name: 'tracking_frame_id', type: 'uuid' })
  trackingFrameId!: string | null;
  @Column({
    ...nullable,
    name: 'tracking_source_sequence',
    type: 'numeric',
    precision: 20,
    scale: 0,
  })
  trackingSourceSequence!: string | null;
  @Column({ ...nullable, name: 'tracking_part_index', type: 'smallint' })
  trackingPartIndex!: number | null;
  @Column({ ...nullable, name: 'tracking_part_count', type: 'smallint' })
  trackingPartCount!: number | null;
  @Column({ ...nullable, name: 'tracking_frame_state', type: 'varchar', length: 24 })
  trackingFrameState!: string | null;
  @Column({ ...nullable, name: 'tracking_pending_until', type: 'timestamptz' })
  trackingPendingUntil!: Date | null;
  @Column({ ...nullable, name: 'tracking_frame_result', type: 'jsonb' })
  trackingFrameResult!: unknown;
  @Column({ ...nullable, name: 'tracking_transport_ack', type: 'jsonb' })
  trackingTransportAck!: unknown;
}

@Entity({ name: 'ai_subject_segment' })
@Unique('uq_ai_subject_segment_scope', ['segmentId', 'scopeSha256', 'siteId', 'cameraId'])
@ForeignKey(
  'camera_worker_generation',
  ['generationId', 'cameraId', 'siteId', 'streamSessionId'],
  generationScope,
  { name: 'fk_ai_segment_generation', onDelete: 'RESTRICT' },
)
@ForeignKey('camera_configuration_bundle', bundleScope, bundleScope, {
  name: 'fk_ai_segment_bundle',
  onDelete: 'RESTRICT',
})
@ForeignKey(
  'ai_observation_event',
  ['firstEventId', 'scopeSha256', 'siteId', 'cameraId'],
  eventScope,
  { name: 'fk_ai_segment_first', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'ai_observation_event',
  ['headEventId', 'scopeSha256', 'siteId', 'cameraId'],
  eventScope,
  { name: 'fk_ai_segment_head', onDelete: 'RESTRICT' },
)
@Check(
  'chk_ai_segment_hashes',
  `scope_sha256 ~ '^[a-f0-9]{64}$' AND bundle_sha256 ~ '^[a-f0-9]{64}$' AND profile_sha256 ~ '^[a-f0-9]{64}$'`,
)
@Check('chk_ai_segment_source', `source_kind IN ('LIVE','REPLAY')`)
@Check(
  'chk_ai_segment_versions',
  `configuration_version BETWEEN 1 AND 9007199254740991 AND view_revision BETWEEN 1 AND 9007199254740991`,
)
@Check(
  'chk_ai_segment_references',
  `((first_event_id IS NULL AND first_person_observation_index IS NULL AND
          num_nonnulls(head_event_id,head_person_observation_index,head_source_sequence,head_captured_at)=0)
        OR (first_event_id IS NOT NULL AND first_person_observation_index BETWEEN 0 AND 255
          AND num_nonnulls(head_event_id,head_person_observation_index,head_source_sequence,head_captured_at)=4
          AND head_person_observation_index BETWEEN 0 AND 255 AND isfinite(head_captured_at)
          AND head_source_sequence BETWEEN 0 AND 18446744073709551615)) IS TRUE`,
)
@Check(
  'chk_ai_segment_lifecycle',
  `((state='ACTIVE' AND first_event_id IS NOT NULL AND num_nonnulls(retired_at,retirement_reason,retirement_event_id,retirement_provenance)=0)
        OR (state='RETIRED' AND retired_at IS NOT NULL AND isfinite(retired_at)
          AND retirement_reason ~ '^[A-Z_]{1,64}$' AND jsonb_typeof(retirement_provenance)='object'
          AND octet_length(retirement_provenance::text)<=1048576)) IS TRUE`,
)
@Index('idx_ai_segment_active_scope', { synchronize: false })
@Index('idx_ai_segment_active_capture', { synchronize: false })
@Index('idx_ai_segment_first_event', ['firstEventId'])
@Index('idx_ai_segment_head_event', ['headEventId'])
@Index('idx_ai_segment_retirement_event', ['retirementEventId'])
class TrackedSubjectSegmentEntity {
  @PrimaryColumn({
    name: 'segment_id',
    type: 'uuid',
    primaryKeyConstraintName: 'ai_subject_segment_pkey',
  })
  segmentId!: string;
  @Column({ name: 'scope_sha256', type: 'char', length: 64 })
  scopeSha256!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;
  @Column({ name: 'camera_id', type: 'uuid' })
  cameraId!: string;
  @Column({ name: 'generation_id', type: 'uuid' })
  generationId!: string;
  @Column({ name: 'stream_session_id', type: 'uuid' })
  streamSessionId!: string;
  @Column({ name: 'configuration_version', type: 'bigint' })
  configurationVersion!: string;
  @Column({ name: 'view_revision', type: 'bigint' })
  viewRevision!: string;
  @Column({ name: 'bundle_sha256', type: 'char', length: 64 })
  bundleSha256!: string;
  @Column({ name: 'profile_sha256', type: 'char', length: 64 })
  profileSha256!: string;
  @Column({ name: 'source_kind', type: 'varchar', length: 8 })
  sourceKind!: string;
  @Column({ name: 'first_event_id', type: 'uuid', nullable: true })
  firstEventId!: string | null;
  @Column({ name: 'first_person_observation_index', type: 'smallint', nullable: true })
  firstPersonObservationIndex!: number | null;
  @Column({ name: 'head_event_id', type: 'uuid', nullable: true })
  headEventId!: string | null;
  @Column({ name: 'head_person_observation_index', type: 'smallint', nullable: true })
  headPersonObservationIndex!: number | null;
  @Column({
    name: 'head_source_sequence',
    type: 'numeric',
    precision: 20,
    scale: 0,
    nullable: true,
  })
  headSourceSequence!: string | null;
  @Column({ name: 'head_captured_at', type: 'timestamptz', nullable: true })
  headCapturedAt!: Date | null;
  @Column({ name: 'state', type: 'varchar', length: 8 })
  state!: string;
  @Column({ name: 'retired_at', type: 'timestamptz', nullable: true })
  retiredAt!: Date | null;
  @Column({ name: 'retirement_reason', type: 'varchar', length: 64, nullable: true })
  retirementReason!: string | null;
  @Column({ name: 'retirement_event_id', type: 'uuid', nullable: true })
  @ForeignKey('ai_observation_event', {
    name: 'ai_subject_segment_retirement_event_id_fkey',
    onDelete: 'RESTRICT',
  })
  retirementEventId!: string | null;
  @Column({ name: 'retirement_provenance', type: 'jsonb', nullable: true })
  retirementProvenance!: unknown;
}

@Entity({ name: 'safety_episode' })
@Check(
  'chk_safety_episode_subject_kind',
  `(subject_kind='EVENT_LOCAL' AND tracking_segment_id IS NULL AND tracking_scope_sha256 IS NULL)
        OR (subject_kind='TRACKED' AND tracking_segment_id IS NOT NULL AND tracking_scope_sha256 IS NOT NULL
          AND tracking_scope_sha256 ~ '^[a-f0-9]{64}$')`,
)
@ForeignKey(
  'ai_subject_segment',
  ['trackingSegmentId', 'trackingScopeSha256', 'siteId', 'cameraId'],
  ['segmentId', 'scopeSha256', 'siteId', 'cameraId'],
  { name: 'fk_safety_episode_tracked_scope', onDelete: 'RESTRICT' },
)
@Index('uq_safety_episode_tracking_segment', { synchronize: false })
class TrackedEpisodeEntity extends SafetyEpisodeEntity {
  @Column({
    ...readThroughSql,
    name: 'subject_kind',
    type: 'varchar',
    length: 16,
    default: 'EVENT_LOCAL',
  })
  subjectKind!: string;
  @Column({ ...nullable, name: 'tracking_segment_id', type: 'uuid' })
  trackingSegmentId!: string | null;
  @Column({ ...nullable, name: 'tracking_scope_sha256', type: 'char', length: 64 })
  trackingScopeSha256!: string | null;
}

export function trackedSchemaEntities<T>(entities: readonly T[]) {
  const replacements = new Map<
    unknown,
    typeof TrackedEventEntity | typeof TrackedGenerationEntity | typeof TrackedEpisodeEntity
  >([
    [AiObservationEventEntity, TrackedEventEntity],
    [CameraWorkerGenerationEntity, TrackedGenerationEntity],
    [SafetyEpisodeEntity, TrackedEpisodeEntity],
  ]);
  return [
    ...entities.map((entity) => replacements.get(entity) ?? entity),
    TrackedSubjectSegmentEntity,
  ];
}
