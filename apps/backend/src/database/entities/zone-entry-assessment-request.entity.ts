import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
  type ValueTransformer,
} from 'typeorm';
import { AiObservationEventEntity } from './ai-observation-event.entity.js';
import { SiteEntity } from './site.entity.js';
import { ZoneEntity } from './zone.entity.js';

export type Mf06SubjectBindingStatus =
  'BOUND' | 'PERSON_NOT_FOUND' | 'AMBIGUOUS_PERSON_TRACK' | 'PERSON_BOX_UNAVAILABLE';
export type Mf06AssessmentPurpose = 'INITIAL_OBSERVATION_ASSESSMENT' | 'RETROSPECTIVE_REVIEW';

function safeIntegerTransformer(minimum: number): ValueTransformer {
  return {
    to(value: number): string {
      if (!Number.isSafeInteger(value) || value < minimum)
        throw new RangeError('Invalid MF06 request integer');
      return String(value);
    },
    from(value: string): number {
      if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(value))
        throw new RangeError('Invalid MF06 request integer');
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < minimum)
        throw new RangeError('Invalid MF06 request integer');
      return parsed;
    },
  };
}

/** Immutable technical request; BOUND does not identify a Worker or grant access. */
@Entity({ name: 'zone_entry_assessment_request' })
@Unique('uq_mf06_request_binding', [
  'eventId',
  'personObservationIndex',
  'zoneObservationIndex',
  'requestedPurpose',
  'requestRevision',
])
@ForeignKey(() => AiObservationEventEntity, ['eventId'], ['eventId'], {
  name: 'fk_mf06_request_event',
  onDelete: 'RESTRICT',
})
@ForeignKey(() => SiteEntity, ['siteId'], ['id'], {
  name: 'fk_mf06_request_site',
  onDelete: 'RESTRICT',
})
@ForeignKey(() => ZoneEntity, ['zoneId', 'siteId'], ['id', 'siteId'], {
  name: 'fk_mf06_request_zone_site',
  onDelete: 'RESTRICT',
})
@Index('idx_mf06_request_site_time', ['siteId', 'capturedAt', 'requestId'])
@Index('idx_mf06_request_event_zone', ['eventId', 'zoneObservationIndex'])
@Check(
  'chk_mf06_request_hashes',
  "payload_hash ~ '^[0-9a-f]{64}$' AND binding_hash ~ '^[0-9a-f]{64}$'",
)
@Check(
  'chk_mf06_request_indices',
  'zone_observation_index BETWEEN 0 AND 255 AND (person_observation_index IS NULL OR (person_observation_index BETWEEN 0 AND 255 AND person_observation_index <> zone_observation_index))',
)
@Check(
  'chk_mf06_request_binding',
  "(subject_binding_status IN ('BOUND','PERSON_BOX_UNAVAILABLE') AND person_observation_index IS NOT NULL) OR (subject_binding_status IN ('PERSON_NOT_FOUND','AMBIGUOUS_PERSON_TRACK') AND person_observation_index IS NULL)",
)
@Check(
  'chk_mf06_request_numbers',
  'track_id BETWEEN 0 AND 9007199254740991 AND geometry_version BETWEEN 1 AND 9007199254740991 AND request_revision BETWEEN 1 AND 2147483647',
)
@Check(
  'chk_mf06_request_purpose',
  "requested_purpose IN ('INITIAL_OBSERVATION_ASSESSMENT','RETROSPECTIVE_REVIEW')",
)
@Check('chk_mf06_request_camera_external', 'char_length(camera_external_id) BETWEEN 1 AND 128')
@Check('chk_mf06_request_times', 'isfinite(captured_at) AND isfinite(requested_at)')
export class ZoneEntryAssessmentRequestEntity {
  @PrimaryColumn({ name: 'request_id', type: 'uuid', primaryKeyConstraintName: 'pk_mf06_request' })
  requestId!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'payload_hash', type: 'char', length: 64 })
  payloadHash!: string;

  @Column({ name: 'person_observation_index', type: 'smallint', nullable: true })
  personObservationIndex!: number | null;

  @Column({ name: 'zone_observation_index', type: 'smallint' })
  zoneObservationIndex!: number;

  @Column({ name: 'subject_binding_status', type: 'varchar', length: 32 })
  subjectBindingStatus!: Mf06SubjectBindingStatus;

  @Column({ name: 'track_id', type: 'bigint', transformer: safeIntegerTransformer(0) })
  trackId!: number;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;

  @Column({ name: 'camera_id', type: 'uuid' })
  cameraId!: string;

  @Column({ name: 'camera_external_id', type: 'varchar', length: 128 })
  cameraExternalId!: string;

  @Column({ name: 'stream_session_id', type: 'uuid' })
  streamSessionId!: string;

  @Column({ name: 'region_id', type: 'uuid' })
  regionId!: string;

  @Column({ name: 'geometry_version', type: 'bigint', transformer: safeIntegerTransformer(1) })
  geometryVersion!: number;

  @Column({ name: 'zone_id', type: 'uuid' })
  zoneId!: string;

  @Column({ name: 'captured_at', type: 'timestamptz' })
  capturedAt!: Date;

  /** Storage-derived only. Authoritative consumers project UTC microseconds with SQL, never Date. */
  @Column({
    name: 'authority_captured_at',
    type: 'timestamptz',
    nullable: true,
    select: false,
    insert: false,
    update: false,
  })
  authorityCapturedAt?: Date | null;

  @Column({ name: 'requested_purpose', type: 'varchar', length: 32 })
  requestedPurpose!: Mf06AssessmentPurpose;

  @Column({ name: 'request_revision', type: 'integer' })
  requestRevision!: number;

  @Column({ name: 'binding_hash', type: 'char', length: 64 })
  bindingHash!: string;

  @CreateDateColumn({
    name: 'requested_at',
    type: 'timestamptz',
    default: () => 'statement_timestamp()',
  })
  requestedAt!: Date;
}
